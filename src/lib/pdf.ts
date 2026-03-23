import { GlobalWorkerOptions, Util, getDocument } from "pdfjs-dist";
import { PDFDocument } from "pdf-lib";
import type { PDFPageProxy, TextItem } from "pdfjs-dist/types/src/display/api";
import type { PlanData, PlanMarker } from "../types";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
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
  const tx = Util.transform([1, 0, 0, -1, 0, viewportHeight], item.transform);
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
  const matches = Array.from(rawLabel.matchAll(/\d{1,3}/g));

  return matches
    .map((match) => {
      const label = match[0];
      const start = match.index ?? 0;
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
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const markers = new Map<number, PlanMarker>();
  const candidates = new Map<number, MarkerCandidate>();

  textContent.items.forEach((item) => {
    if (!("str" in item) || typeof item.str !== "string") {
      return;
    }

    const textItem = item as TextItem;
    const points = markerFromTextItem(textItem, viewport.width, viewport.height);
    points.forEach((point) => {
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
    });
  });

  return {
    width: viewport.width,
    height: viewport.height,
    markers
  };
}

export async function loadPlan(file: File): Promise<PlanData> {
  const buffer = await file.arrayBuffer();
  const fullDocument = await PDFDocument.load(buffer);
  const firstPageDocument = await PDFDocument.create();
  const [firstPage] = await firstPageDocument.copyPages(fullDocument, [0]);
  firstPageDocument.addPage(firstPage);
  const firstPageBytes = await firstPageDocument.save();
  const firstPageBlob = new Blob([Uint8Array.from(firstPageBytes)], { type: "application/pdf" });
  const pdf = await getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);
  const markerData = await extractMarkers(page);
  const blobUrl = URL.createObjectURL(firstPageBlob);
  const viewerUrl = `${blobUrl}#page=1&zoom=page-width`;

  return {
    width: markerData.width,
    height: markerData.height,
    blobUrl,
    viewerUrl,
    markers: markerData.markers,
    pageCount: pdf.numPages,
    title: file.name
  };
}
