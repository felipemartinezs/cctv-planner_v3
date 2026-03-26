import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export interface RenderedPlanPreview {
  height: number;
  revokeUrl: boolean;
  url: string;
  width: number;
}

interface RenderPlanPreviewOptions {
  maxWidth?: number;
  minWidth?: number;
  preferLossless?: boolean;
  targetWidth?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function renderPlanPreview(
  pdfUrl: string,
  planWidth: number,
  options: RenderPlanPreviewOptions = {}
): Promise<RenderedPlanPreview> {
  const pdf = await getDocument(pdfUrl).promise;

  try {
    const page = await pdf.getPage(1);
    const deviceScale = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth || 0 : 0;
    const requestedWidth =
      options.targetWidth ??
      Math.round(Math.max(900, viewportWidth || 900) * deviceScale * 2.25);
    const viewportWidthTarget = clamp(
      requestedWidth,
      options.minWidth ?? 1800,
      options.maxWidth ?? 2600
    );
    const scale = viewportWidthTarget / Math.max(planWidth, 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("No pude crear el canvas del plano.");
    }

    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    await page.render({
      canvas,
      canvasContext: context,
      viewport
    }).promise;

    const mimeType = options.preferLossless ? "image/png" : "image/jpeg";
    const imageQuality = options.preferLossless ? undefined : 0.92;

    if (typeof canvas.toBlob === "function") {
      const previewBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, mimeType, imageQuality)
      );
      if (previewBlob) {
        return {
          height: canvas.height,
          revokeUrl: true,
          url: URL.createObjectURL(previewBlob),
          width: canvas.width
        };
      }
    }

    return {
      height: canvas.height,
      revokeUrl: false,
      url: canvas.toDataURL(mimeType, imageQuality),
      width: canvas.width
    };
  } finally {
    await pdf.destroy();
  }
}
