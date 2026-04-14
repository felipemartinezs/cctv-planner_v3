import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const pdfLoadingTaskCache = new Map<string, ReturnType<typeof getDocument>>();

export interface RenderedPlanPreview {
  height: number;
  revokeUrl: boolean;
  url: string;
  width: number;
}

export interface PlanViewportRegion {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface RenderedPlanViewportTile extends RenderedPlanPreview {
  planHeight: number;
  planWidth: number;
  planX: number;
  planY: number;
  scale: number;
}

interface RenderPlanPreviewOptions {
  maxWidth?: number;
  minWidth?: number;
  preferLossless?: boolean;
  targetWidth?: number;
}

interface RenderPlanViewportOptions {
  preferLossless?: boolean;
  region: PlanViewportRegion;
  scale: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getPdfLoadingTask(pdfUrl: string) {
  let loadingTask = pdfLoadingTaskCache.get(pdfUrl);
  if (!loadingTask) {
    loadingTask = getDocument(pdfUrl);
    pdfLoadingTaskCache.set(pdfUrl, loadingTask);
  }
  return loadingTask;
}

async function getPdfPage(pdfUrl: string) {
  const loadingTask = getPdfLoadingTask(pdfUrl);
  const pdf = await loadingTask.promise;
  return pdf.getPage(1);
}

async function canvasToPreview(
  canvas: HTMLCanvasElement,
  preferLossless = false
): Promise<RenderedPlanPreview> {
  const mimeType = preferLossless ? "image/png" : "image/jpeg";
  const imageQuality = preferLossless ? undefined : 0.92;

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
}

export async function renderPlanPreview(
  pdfUrl: string,
  planWidth: number,
  options: RenderPlanPreviewOptions = {}
): Promise<RenderedPlanPreview> {
  const page = await getPdfPage(pdfUrl);
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

  const result = await canvasToPreview(canvas, options.preferLossless);
  canvas.width = 0;
  canvas.height = 0;
  return result;
}

export async function renderPlanViewportTile(
  pdfUrl: string,
  options: RenderPlanViewportOptions
): Promise<RenderedPlanViewportTile> {
  const page = await getPdfPage(pdfUrl);
  const region = {
    height: Math.max(1, options.region.height),
    width: Math.max(1, options.region.width),
    x: Math.max(0, options.region.x),
    y: Math.max(0, options.region.y)
  };
  const scale = Math.max(0.25, options.scale);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("No pude crear el canvas de detalle del plano.");
  }

  canvas.width = Math.max(1, Math.round(region.width * scale));
  canvas.height = Math.max(1, Math.round(region.height * scale));
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  await page.render({
    canvas,
    canvasContext: context,
    transform: [1, 0, 0, 1, -region.x * scale, -region.y * scale],
    viewport
  }).promise;

  const preview = await canvasToPreview(canvas, options.preferLossless);
  canvas.width = 0;
  canvas.height = 0;
  return {
    ...preview,
    planHeight: region.height,
    planWidth: region.width,
    planX: region.x,
    planY: region.y,
    scale
  };
}

export async function releaseRenderedPlanDocument(pdfUrl: string) {
  const loadingTask = pdfLoadingTaskCache.get(pdfUrl);
  if (!loadingTask) {
    return;
  }

  pdfLoadingTaskCache.delete(pdfUrl);

  try {
    await loadingTask.destroy();
  } catch {
    try {
      const pdf = await loadingTask.promise;
      await pdf.destroy();
    } catch {
      // Ignore cleanup failures for cached preview documents.
    }
  }
}
