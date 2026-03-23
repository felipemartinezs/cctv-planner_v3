import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export interface RenderedPlanPreview {
  height: number;
  url: string;
  width: number;
}

export async function renderPlanPreview(
  pdfUrl: string,
  planWidth: number
): Promise<RenderedPlanPreview> {
  const pdf = await getDocument(pdfUrl).promise;

  try {
    const page = await pdf.getPage(1);
    const deviceScale = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const viewportWidthTarget = Math.min(
      3600,
      Math.max(2200, Math.round(window.innerWidth * deviceScale * 2.2))
    );
    const scale = viewportWidthTarget / planWidth;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("No pude crear el canvas del plano.");
    }

    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);

    await page.render({
      canvas,
      canvasContext: context,
      viewport
    }).promise;

    return {
      height: canvas.height,
      url: canvas.toDataURL("image/png"),
      width: canvas.width
    };
  } finally {
    await pdf.destroy();
  }
}
