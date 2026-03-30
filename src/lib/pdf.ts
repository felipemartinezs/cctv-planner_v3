import { GlobalWorkerOptions, Util, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFPageProxy, TextItem } from "pdfjs-dist/types/src/display/api";
import type { PlanData, PlanMarker } from "../types";
import { readFileAsArrayBuffer } from "./file-io";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface MarkerCandidate {
  id: number;
  height: number;
  label: string;
  x: number;
  y: number;
}

function markerFromTextItem(
  item: TextItem,
  viewportWidth: number,
  viewportHeight: number
): MarkerCandidate[] {
  let tx;
  try {
    tx = Util.transform([1, 0, 0, -1, 0, viewportHeight], item.transform);
  } catch (error) {
    throw formatLoadPlanError("marker-transform", error);
  }
  const rawLabel = item.str;
  const normalizedLabel = rawLabel.trim();
  const y = tx[5] - item.height / 2;

  if (y < 0 || y > viewportHeight) {
    return [];
  }

  if (/^\d{1,3}$/.test(normalizedLabel)) {
    const x = tx[4] + item.width / 2;
    if (x < 0 || x > viewportWidth) {
      return [];
    }

    return [
      {
        id: Number(normalizedLabel),
        height: item.height,
        label: normalizedLabel,
        x,
        y,
      } satisfies MarkerCandidate,
    ];
  }

  if (!/^\d{1,3}(?:\s+\d{1,3})+$/.test(normalizedLabel) || rawLabel.length === 0) {
    return [];
  }

  const unitWidth = item.width / rawLabel.length;
  const matches: Array<{ index: number; label: string }> = [];
  const matcher = /\d{1,3}/g;
  let match = matcher.exec(rawLabel);
  while (match) {
    matches.push({
      index: match.index ?? 0,
      label: match[0],
    });
    match = matcher.exec(rawLabel);
  }

  return matches
    .map((match) => {
      const label = match.label;
      const start = match.index;
      const x = tx[4] + unitWidth * (start + label.length / 2);

      if (x < 0 || x > viewportWidth) {
        return null;
      }

      return {
        id: Number(label),
        height: item.height,
        label,
        x,
        y,
      } satisfies MarkerCandidate;
    })
    .filter((candidate): candidate is MarkerCandidate => Boolean(candidate));
}

function shouldReplaceMarker(current: MarkerCandidate, next: MarkerCandidate) {
  if (Math.abs(next.height - current.height) > 0.5) {
    return next.height > current.height;
  }

  return next.y < current.y;
}

async function extractMarkers(page: PDFPageProxy) {
  let viewport;
  try {
    viewport = page.getViewport({ scale: 1 });
  } catch (error) {
    throw formatLoadPlanError("extract-markers/get-viewport", error);
  }

  let textContent;
  try {
    textContent = await getPageTextContentCompat(page);
  } catch (error) {
    throw formatLoadPlanError("extract-markers/get-text-content", error);
  }

  const markers = new Map<number, PlanMarker>();
  const candidates = new Map<number, MarkerCandidate>();
  const items = Array.isArray(textContent.items) ? textContent.items : Array.from(textContent.items || []);

  try {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item || typeof item !== "object" || !("str" in item) || typeof item.str !== "string") {
        continue;
      }

      const textItem = item as TextItem;
      const points = markerFromTextItem(textItem, viewport.width, viewport.height);
      for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
        const point = points[pointIndex];
        const existing = candidates.get(point.id);
        if (!existing || shouldReplaceMarker(existing, point)) {
          candidates.set(point.id, point);
          markers.set(point.id, {
            id: point.id,
            x: point.x,
            y: point.y,
            label: point.label
          });
        }
      }
    }
  } catch (error) {
    throw formatLoadPlanError("extract-markers/iterate-items", error);
  }

  return {
    width: viewport.width,
    height: viewport.height,
    markers
  };
}

async function getPageTextContentCompat(page: PDFPageProxy) {
  const anyPage = page as PDFPageProxy & {
    streamTextContent?: (params?: Record<string, unknown>) => ReadableStream<{
      items: TextItem[];
      lang?: string | null;
      styles?: Record<string, unknown>;
    }>;
  };

  if (typeof anyPage.streamTextContent === "function" && typeof ReadableStream !== "undefined") {
    const readableStream = anyPage.streamTextContent({});
    if (readableStream && typeof readableStream.getReader === "function") {
      const reader = readableStream.getReader();
      const textContent = {
        items: [] as TextItem[],
        styles: Object.create(null) as Record<string, unknown>,
        lang: null as string | null,
      };

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        const value = chunk.value;
        if (!value) {
          continue;
        }
        if (textContent.lang == null && typeof value.lang === "string") {
          textContent.lang = value.lang;
        }
        if (value.styles && typeof value.styles === "object") {
          Object.assign(textContent.styles, value.styles);
        }
        if (Array.isArray(value.items)) {
          for (let index = 0; index < value.items.length; index += 1) {
            textContent.items.push(value.items[index]);
          }
        }
      }

      return textContent;
    }
  }

  return page.getTextContent();
}

async function readPlanSource(source: File | ArrayBuffer | Uint8Array) {
  if (source instanceof File) {
    return new Uint8Array(await readFileAsArrayBuffer(source));
  }
  if (source instanceof Uint8Array) {
    return new Uint8Array(source);
  }
  return new Uint8Array(source.slice(0));
}

function toStrictArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function formatLoadPlanError(stage: string, error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : JSON.stringify(error);
  return new Error(`loadPlan/${stage}: ${message}`);
}

async function renderPlanPreviewFromPage(page: PDFPageProxy, baseWidth: number) {
  if (typeof document === "undefined") {
    throw new Error("No pude crear la vista previa del plano en este entorno.");
  }

  const isCoarsePointer =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const isLikelyIOS =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/i.test(navigator.userAgent);
  const compactPreview = isCoarsePointer || isLikelyIOS;
  const targetWidth = compactPreview ? 1400 : 1800;
  const previewScale = Math.min(
    compactPreview ? 1.25 : 2,
    Math.max(compactPreview ? 0.75 : 1.1, targetWidth / Math.max(baseWidth, 1))
  );
  const viewport = page.getViewport({ scale: previewScale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("No pude crear el canvas de vista previa.");
  }

  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  await page.render({ canvas, canvasContext: context, viewport }).promise;

  let previewUrl = "";
  if (typeof canvas.toBlob === "function") {
    const previewBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (previewBlob) {
      previewUrl = URL.createObjectURL(previewBlob);
    }
  }

  if (!previewUrl) {
    previewUrl = canvas.toDataURL("image/png");
  }

  return {
    previewHeight: canvas.height,
    previewUrl,
    previewWidth: canvas.width,
  };
}

export async function loadPlan(
  source: File | ArrayBuffer | Uint8Array,
  title = source instanceof File ? source.name : "Plan.pdf"
): Promise<PlanData> {
  let buffer: Uint8Array;
  try {
    buffer = await readPlanSource(source);
  } catch (error) {
    throw formatLoadPlanError("read-source", error);
  }

  const blobBytes = new Uint8Array(buffer);
  let blob: Blob | File;
  try {
    blob =
      source instanceof File
        ? source
        : new Blob([toStrictArrayBuffer(blobBytes)], { type: "application/pdf" });
  } catch (error) {
    throw formatLoadPlanError("create-blob", error);
  }

  let pdf;
  try {
    pdf = await getDocument({ data: buffer }).promise;
  } catch (error) {
    throw formatLoadPlanError("get-document", error);
  }

  try {
    let page;
    try {
      page = await pdf.getPage(1);
    } catch (error) {
      throw formatLoadPlanError("get-page-1", error);
    }

    let markerData;
    try {
      markerData = await extractMarkers(page);
    } catch (error) {
      throw formatLoadPlanError("extract-markers", error);
    }

    let blobUrl: string;
    try {
      blobUrl = URL.createObjectURL(blob);
    } catch (error) {
      throw formatLoadPlanError("create-object-url", error);
    }

    let preview;
    try {
      preview = await renderPlanPreviewFromPage(page, markerData.width);
    } catch (error) {
      throw formatLoadPlanError("render-preview", error);
    }

    const viewerUrl = `${blobUrl}#page=1&zoom=page-width`;
    const pageCount = pdf.numPages;
    await pdf.destroy();

    return {
      width: markerData.width,
      height: markerData.height,
      blobUrl,
      previewUrl: preview.previewUrl,
      previewWidth: preview.previewWidth,
      previewHeight: preview.previewHeight,
      viewerUrl,
      markers: markerData.markers,
      pageCount,
      title
    };
  } catch (error) {
    const message =
      error instanceof Error && error.message.startsWith("loadPlan/")
        ? error.message
        : formatLoadPlanError("finalize", error).message;
    try {
      await pdf.destroy();
    } catch {
      // Ignore cleanup failure while reporting the original load-plan error.
    }
    throw new Error(message);
  }
}
