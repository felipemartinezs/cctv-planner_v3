import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch";
import { useI18n } from "../../i18n";
import type {
  DeviceRecord,
  OperationalDeviceProgress,
  OperationalProgressStep,
  PlanData,
} from "../../types";
import { lookupIcon, normalizeIconKey } from "../../lib/icons";
import {
  DEFAULT_VISUAL_KNOWLEDGE_INDEX,
  getNamePatternKnowledge,
  getPartNumberKnowledge,
  type VisualKnowledgeIndex,
} from "../../lib/visual-knowledge";
import type { PlanSegmentation } from "../plan-segmentation";
import {
  releaseRenderedPlanDocument,
  renderPlanPreview,
  renderPlanViewportTile,
  type RenderedPlanPreview,
  type RenderedPlanViewportTile,
} from "./render-page-preview";
import {
  computeMarkerLayout,
  type MarkerPlacement,
  type VisibleMarker,
} from "./marker-layout";
import { resolveMarkerColor, type MarkerColor } from "./marker-colors";

const RENDER_SCALE = 2;
const MAX_SELECTED_PART_NUMBERS = 2;
const PART_MARKER_COLOR = "rgba(20, 58, 110, 0.88)";
const PART_MARKER_PULSE_MS = 1550;
const INTERACTIVE_MIN_SCALE = 0.18;
const MOBILE_MIN_SCALE_RATIO = 0.9;
const DESKTOP_MIN_SCALE_RATIO = 0.72;
const MIN_PINCH_DISTANCE = 24;
const OPERATIONAL_PROGRESS_UNDO_MS = 6000;
const PTZ_PART_NUMBER = "CIP-QNP6250H";
const PTZ_OUTDOOR_RULE_KEY = "install.height.ptzOutdoor";
const PTZ_CEILING_ICON = "CIP-QNP6250H Ceiling";
const PTZ_PENDANT_ICON = "CIP-QNP6250H Pendant";
const PTZ_OUTDOOR_ICON = "CIP-QNP6250H Outdoor";
const POS_BNB_ICON = "BNB-SCB-1KIT";
const POS_PSA_ICON = "PSA-W4-BAXFA51";

// Camino C: marker principal es una GOTA coloreada (forma original de SiteOwl)
// con el ID blanco al centro. La punta de la gota apunta a (x, y) — la
// posicion exacta del dispositivo en el plano — y el color del relleno
// representa la familia del part number (ver marker-colors.ts).
// Cuando este flag esta activo, los iconos PNG solo se usan en la tarjeta
// lateral / preview, NO sobre el plano.
const USE_COLORED_TEARDROPS = true;

// V1 legacy: Dibujar el icono real del dispositivo sobre el plano en vez del
// circulo azul clasico. Mantenemos el flag para poder volver rapido al modo
// iconos si Camino C no convence en campo. Solo se aplica cuando
// USE_COLORED_TEARDROPS === false.
const SHOW_ICON_MARKERS = true;
// Lado del icono en pixels del canvas base (antes del zoom de react-zoom-pan-pinch).
// ~14px * RENDER_SCALE queda ligeramente mas grande que el circulo azul (R=7*RS)
// y se ve nitido en iPhone con el escalado del wrapper.
const ICON_MARKER_SIZE = 14 * RENDER_SCALE;

// Dimensiones de la gota. La cabeza circular es donde va el ID; el pico
// inferior marca la posicion exacta del device (igual que el marker naranja
// del PDF original de SiteOwl). Tamano un poco mas grande que el marker V1
// para cubrir OPACAMENTE el label baked del PDF (que si no se ve de fondo
// creando doble numeracion).
// Camino C fine-tuning (Felipe, abril 2026):
//   v1: 13/8  — muy grande, tapaba detalle del plano
//   v2: 10/6  — 75% de v1, seguia grande en zonas densas
//   v3: 7/4   — otro 70% sobre v2 (~54% del original)
//   v4: 6/3   — otro 85% sobre v3 (~46% del original). Felipe valido que
//              "se ve mucho mejor" y pidio ajustar un 15% mas. A este
//              tamano la gota cubre el label baked del PDF por poco y
//              el ID de 2 digitos (mayoria de devices) sigue legible en
//              iPhone. Si bajamos mas, el texto pierde contraste contra
//              el stroke del perimetro.
const TEARDROP_HEAD_RADIUS = 6 * RENDER_SCALE;
const TEARDROP_TIP_LENGTH = 3 * RENDER_SCALE;

// V2: leader lines para zonas densas (farmacia, self-checkout, AP office).
// Cuando varios markers caen cerca, sus IDs se encimen y el tecnico no puede
// distinguir cual corresponde a cual. Detectamos clusters por proximidad y
// desplazamos la etiqueta (ID) a un anillo al rededor del cluster, conectandola
// al anchor del icono con una linea fina. El icono NO se mueve — queda en su
// posicion exacta sobre el plano.
const SHOW_LEADER_LINES = true;
// Radio de vecindad en pixels de canvas. ~40 pt * RENDER_SCALE cubre los
// cumulos tipicos (2 a 6 camaras pegadas) sin unir zonas separadas. Ajustar si
// aparecen falsos clusters.
const CLUSTER_RADIUS_CANVAS = 40 * RENDER_SCALE;
// Necesitamos >= 3 para considerar cluster. 2 dispositivos no justifican
// leader lines (ocupan menos que el anillo y se entienden con el halo V1).
const MIN_CLUSTER_SIZE = 3;
// Separacion del anillo de etiquetas respecto al borde del cluster.
const LABEL_OFFSET_CANVAS = 12 * RENDER_SCALE;
// Gap angular minimo entre 2 labels consecutivas (radianes). ~24 grados
// garantiza que el ancho tipico de un pill de ID (2-3 digitos) no choque con
// el vecino.
const LABEL_MIN_ARC_GAP = 0.42;
// Padding interior del canvas donde no se permite poner la etiqueta.
const LABEL_CANVAS_PADDING = 14 * RENDER_SCALE;

interface PlanSegmentationModalProps {
  buildLabel: string;
  deviceProgressByKey: Record<string, OperationalDeviceProgress>;
  iconDebugLabel: string;
  open: boolean;
  iconSourceLabel: string;
  onChangeDeviceProgress: (deviceKey: string, nextProgress: OperationalDeviceProgress) => void;
  projectProgressScope: string;
  projectProgressStatusLabel: string;
  plan: PlanData | null;
  records: DeviceRecord[];
  rawIconMap: Map<string, string>;
  segmentation: PlanSegmentation | null;
  visualKnowledgeIndex?: VisualKnowledgeIndex;
  onClose: () => void;
}

interface Xform {
  x: number;
  y: number;
  s: number;
}

interface GestureState {
  moved: boolean;
  mode: "idle" | "pan" | "pinch";
  startDistance: number;
  startMidpointX: number;
  startMidpointY: number;
  startTouchX: number;
  startTouchY: number;
  startXform: Xform;
}

interface TouchPointLike {
  clientX: number;
  clientY: number;
}

interface VisualChoice {
  iconDevice: string;
  iconUrl: string;
  shortLabel: string;
}

interface InteractiveDevice {
  ambiguityHint: string;
  cables: number;
  iconDevice: string;
  iconUrl: string;
  id: number;
  key: string;
  mountHeightFt: number | null;
  mountHeightNeedsFieldValidation: boolean;
  mountHeightRuleText: string;
  name: string;
  partNumber: string;
  segmentLabel: string;
  suggestedSegmentLabel: string;
  suggestedSwitchName: string;
  switchName: string;
  visualChoices: VisualChoice[];
  x: number;
  y: number;
}

interface DevicePreviewState {
  device: InteractiveDevice;
  maxHeight: number;
  x: number;
  y: number;
}

interface PendingProgressAction {
  deviceKey: string;
  nextValue: boolean;
  step: OperationalProgressStep;
}

interface UndoProgressAction {
  deviceKey: string;
  message: string;
  previousProgress: OperationalDeviceProgress;
}

interface PlanRasterState extends RenderedPlanPreview {}

interface PlanViewportRasterState extends RenderedPlanViewportTile {}

interface RasterLike {
  revokeUrl: boolean;
  url: string;
}

interface SegmentProgressSummary {
  cableRunCount: number;
  completeCount: number;
  installedCount: number;
  notStartedCount: number;
  partialCount: number;
  remainingCount: number;
  switchConnectedCount: number;
  totalDevices: number;
}

const EMPTY_OPERATIONAL_PROGRESS: OperationalDeviceProgress = {
  cableRun: false,
  installed: false,
  switchConnected: false,
  updatedAt: 0,
};

const OPERATIONAL_PROGRESS_DRAW_ORDER: OperationalProgressStep[] = [
  "cableRun",
  "installed",
  "switchConnected",
];

const OPERATIONAL_PROGRESS_VISUALS: Record<
  OperationalProgressStep,
  { fill: string; glow: string; stroke: string }
> = {
  cableRun: {
    fill: "rgba(255, 205, 72, 0.24)",
    glow: "rgba(255, 205, 72, 0.18)",
    stroke: "rgba(255, 205, 72, 0.94)",
  },
  installed: {
    fill: "rgba(95, 176, 255, 0.24)",
    glow: "rgba(95, 176, 255, 0.18)",
    stroke: "rgba(95, 176, 255, 0.94)",
  },
  switchConnected: {
    fill: "rgba(88, 214, 141, 0.24)",
    glow: "rgba(88, 214, 141, 0.18)",
    stroke: "rgba(88, 214, 141, 0.94)",
  },
};

const OPERATIONAL_PROGRESS_COMPLETE_VISUAL = {
  fill: "rgba(41, 199, 122, 0.98)",
  glow: "rgba(41, 199, 122, 0.28)",
  stroke: "rgba(194, 255, 221, 0.96)",
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function percentage(completed: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return Math.round((completed / total) * 100);
}

function buildBasePlanRaster(plan: PlanData): PlanRasterState {
  return {
    height: plan.previewHeight,
    revokeUrl: false,
    url: plan.previewUrl,
    width: plan.previewWidth,
  };
}

function revokePlanRaster(raster: RasterLike | null) {
  if (!raster?.revokeUrl) {
    return;
  }
  URL.revokeObjectURL(raster.url);
}

function isPtzCeilingIcon(value: string) {
  return normalizeIconKey(value) === normalizeIconKey(PTZ_CEILING_ICON);
}

function isPtzPendantIcon(value: string) {
  return normalizeIconKey(value) === normalizeIconKey(PTZ_PENDANT_ICON);
}

function isPtzOutdoorIcon(value: string) {
  return normalizeIconKey(value) === normalizeIconKey(PTZ_OUTDOOR_ICON);
}

function isPosBnbIcon(value: string) {
  return normalizeIconKey(value) === normalizeIconKey(POS_BNB_ICON);
}

function isPosPsaIcon(value: string) {
  return normalizeIconKey(value) === normalizeIconKey(POS_PSA_ICON);
}

function isPosAmbiguousPartNumber(value: string) {
  const normalized = normalizeIconKey(value);
  return normalized === normalizeIconKey(POS_BNB_ICON) || normalized === normalizeIconKey(POS_PSA_ICON);
}

function formatVisualChoiceLabel(value: string) {
  if (isPtzCeilingIcon(value)) {
    return "Ceiling";
  }
  if (isPtzPendantIcon(value)) {
    return "Pendant";
  }
  if (isPtzOutdoorIcon(value)) {
    return "Outdoor";
  }
  if (isPosBnbIcon(value)) {
    return "SCO";
  }
  if (isPosPsaIcon(value)) {
    return "Manned";
  }
  return value;
}

function flattenRecordGroups<T>(groups: Record<string, T[]>): T[] {
  const flattened: T[] = [];
  Object.keys(groups).forEach((key) => {
    const entries = groups[key] ?? [];
    entries.forEach((entry) => flattened.push(entry));
  });
  return flattened;
}

function collectGroupedEntries<T>(keys: string[], groups: Record<string, T[]>): T[] {
  const collected: T[] = [];
  keys.forEach((key) => {
    const entries = groups[key] ?? [];
    entries.forEach((entry) => collected.push(entry));
  });
  return collected;
}

function groupedEntryCount<T>(groups: Record<string, T[]>): number {
  let total = 0;
  Object.keys(groups).forEach((key) => {
    total += (groups[key] ?? []).length;
  });
  return total;
}

function getVisualAmbiguityHint(
  partNumber: string,
  visualChoices: VisualChoice[],
  t: (key: string, vars?: Record<string, string | number | boolean | undefined>) => string
) {
  if (visualChoices.length < 2) {
    return "";
  }

  if (partNumber === PTZ_PART_NUMBER) {
    return t("segmentation.validatePtz");
  }

  if (isPosAmbiguousPartNumber(partNumber)) {
    return t("segmentation.validatePos");
  }

  return "";
}

function buildVisualChoices(
  iconDevices: string[],
  rawIconMap: Map<string, string>,
  fallback?: { iconDevice: string; iconUrl?: string }
): VisualChoice[] {
  const uniqueCandidates = Array.from(
    new Set(iconDevices.map((value) => value.trim()).filter(Boolean))
  );
  const hasInteriorPtz = uniqueCandidates.some(
    (value) => isPtzCeilingIcon(value) || isPtzPendantIcon(value)
  );
  const hasOutdoorPtz = uniqueCandidates.some((value) => isPtzOutdoorIcon(value));
  const hasPosAmbiguity =
    uniqueCandidates.some((value) => isPosBnbIcon(value)) &&
    uniqueCandidates.some((value) => isPosPsaIcon(value));

  const preferredCandidates =
    hasInteriorPtz && !hasOutdoorPtz
      ? [PTZ_CEILING_ICON, PTZ_PENDANT_ICON]
      : hasPosAmbiguity
        ? [POS_BNB_ICON, POS_PSA_ICON]
      : hasOutdoorPtz && !hasInteriorPtz
        ? [PTZ_OUTDOOR_ICON]
        : hasInteriorPtz && hasOutdoorPtz
          ? [PTZ_CEILING_ICON, PTZ_PENDANT_ICON, PTZ_OUTDOOR_ICON]
          : uniqueCandidates;

  const choices = preferredCandidates
    .map((candidate) => {
      const iconUrl = lookupIcon(rawIconMap, candidate);
      if (!iconUrl) {
        return null;
      }
      return {
        iconDevice: candidate,
        iconUrl,
        shortLabel: formatVisualChoiceLabel(candidate),
      };
    })
    .filter((choice): choice is VisualChoice => Boolean(choice));

  if (choices.length > 0) {
    return choices;
  }

  if (fallback?.iconUrl) {
    return [
      {
        iconDevice: fallback.iconDevice,
        iconUrl: fallback.iconUrl,
        shortLabel: formatVisualChoiceLabel(fallback.iconDevice),
      },
    ];
  }

  return [];
}

function resolvePtzVisualCandidates(
  records: Array<Pick<DeviceRecord, "category" | "iconDevice" | "mountHeightRuleKey" | "partNumber">>
): string[] {
  if (records.length === 0) {
    return [PTZ_CEILING_ICON, PTZ_PENDANT_ICON];
  }

  const hasOutdoor = records.some(
    (record) =>
      record.mountHeightRuleKey === PTZ_OUTDOOR_RULE_KEY ||
      isPtzOutdoorIcon(record.iconDevice)
  );
  const hasInterior = records.some(
    (record) =>
      (record.category === "ptz" ||
        normalizeIconKey(record.partNumber) === normalizeIconKey(PTZ_PART_NUMBER)) &&
      !(
        record.mountHeightRuleKey === PTZ_OUTDOOR_RULE_KEY ||
        isPtzOutdoorIcon(record.iconDevice)
      )
  );

  if (hasOutdoor && !hasInterior) {
    return [PTZ_OUTDOOR_ICON];
  }
  if (hasInterior && !hasOutdoor) {
    return [PTZ_CEILING_ICON, PTZ_PENDANT_ICON];
  }
  return [PTZ_CEILING_ICON, PTZ_PENDANT_ICON, PTZ_OUTDOOR_ICON];
}

function colorFor(index: number, alpha: number): string {
  const hue = (index * 57) % 360;
  return `hsla(${hue} 72% 48% / ${alpha})`;
}

function detectCompactViewport() {
  if (typeof window === "undefined") {
    return false;
  }
  const lowSpace = window.innerWidth <= 720 || window.innerHeight <= 520;
  const coarsePointer =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return lowSpace || coarsePointer;
}

function drawMarkerPulse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  timeMs: number
) {
  const phase = (timeMs % PART_MARKER_PULSE_MS) / PART_MARKER_PULSE_MS;
  const breathe = 0.5 + 0.5 * Math.sin((timeMs / PART_MARKER_PULSE_MS) * Math.PI * 2);
  const haloRadius = radius + 4 * RENDER_SCALE + breathe * 3 * RENDER_SCALE;
  const waveRadius = radius + 3 * RENDER_SCALE + phase * 9 * RENDER_SCALE;
  const haloAlpha = 0.08 + breathe * 0.08;
  const waveAlpha = 0.35 * (1 - phase);

  ctx.beginPath();
  ctx.arc(x, y, haloRadius, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(80, 160, 255, ${haloAlpha.toFixed(3)})`;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, waveRadius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(80, 160, 255, ${waveAlpha.toFixed(3)})`;
  ctx.lineWidth = 2 * RENDER_SCALE;
  ctx.stroke();
}

function activeOperationalSteps(progress: OperationalDeviceProgress): OperationalProgressStep[] {
  return OPERATIONAL_PROGRESS_DRAW_ORDER.filter((step) => progress[step]);
}

function countOperationalProgressSteps(progress: OperationalDeviceProgress) {
  return activeOperationalSteps(progress).length;
}

function isOperationalProgressComplete(progress: OperationalDeviceProgress) {
  return progress.cableRun && progress.installed && progress.switchConnected;
}

function drawOperationalProgressLines(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  steps: OperationalProgressStep[]
) {
  if (steps.length === 0) {
    return;
  }

  if (steps.length === OPERATIONAL_PROGRESS_DRAW_ORDER.length) {
    const dotRadius = 2.75 * RENDER_SCALE;
    const dotY = y + 6.7 * RENDER_SCALE;

    ctx.beginPath();
    ctx.arc(x, dotY, dotRadius + 1.25 * RENDER_SCALE, 0, Math.PI * 2);
    ctx.fillStyle = OPERATIONAL_PROGRESS_COMPLETE_VISUAL.glow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, dotY, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = OPERATIONAL_PROGRESS_COMPLETE_VISUAL.fill;
    ctx.fill();
    ctx.strokeStyle = OPERATIONAL_PROGRESS_COMPLETE_VISUAL.stroke;
    ctx.lineWidth = 0.85 * RENDER_SCALE;
    ctx.stroke();
    return;
  }

  const lineLength = 5.4 * RENDER_SCALE;
  const lineWidth = 1.3 * RENDER_SCALE;
  const lineCenterY = y + 6.7 * RENDER_SCALE;
  const slotOffsets = [-1.6, 0, 1.6];

  OPERATIONAL_PROGRESS_DRAW_ORDER.forEach((step, index) => {
    if (!steps.includes(step)) {
      return;
    }
    const visual = OPERATIONAL_PROGRESS_VISUALS[step];
    const lineY = lineCenterY + slotOffsets[index] * RENDER_SCALE;

    ctx.beginPath();
    ctx.moveTo(x - lineLength / 2, lineY);
    ctx.lineTo(x + lineLength / 2, lineY);
    ctx.strokeStyle = visual.stroke;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.stroke();
  });
}

export function PlanSegmentationModal({
  buildLabel,
  deviceProgressByKey,
  iconDebugLabel,
  open,
  iconSourceLabel,
  onChangeDeviceProgress,
  projectProgressScope,
  projectProgressStatusLabel,
  plan,
  records,
  rawIconMap,
  segmentation,
  visualKnowledgeIndex = DEFAULT_VISUAL_KNOWLEDGE_INDEX,
  onClose,
}: PlanSegmentationModalProps) {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ReactZoomPanPinchContentRef | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const partNumCanvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfReady, setPdfReady] = useState(false);
  const [xform, setXform] = useState<Xform>({ x: 0, y: 0, s: 1 });
  const [selectedLabel, setSelectedLabel] = useState("");
  const [selectedPartNumbers, setSelectedPartNumbers] = useState<string[]>([]);
  const [isMobileViewport, setIsMobileViewport] = useState(() => detectCompactViewport());
  const [viewportSize, setViewportSize] = useState(() => ({
    height: typeof window === "undefined" ? 0 : window.innerHeight,
    width: typeof window === "undefined" ? 0 : window.innerWidth,
  }));
  const [controlsExpanded, setControlsExpanded] = useState(() => !detectCompactViewport());
  const [devicePreview, setDevicePreview] = useState<DevicePreviewState | null>(null);
  const [pendingProgressAction, setPendingProgressAction] = useState<PendingProgressAction | null>(null);
  const [undoProgressAction, setUndoProgressAction] = useState<UndoProgressAction | null>(null);
  const [planRaster, setPlanRaster] = useState<PlanRasterState | null>(
    () => (plan ? buildBasePlanRaster(plan) : null)
  );
  const [focusRaster, setFocusRaster] = useState<PlanViewportRasterState | null>(null);
  const [isTransformReady, setIsTransformReady] = useState(false);
  const [isTransformInteracting, setIsTransformInteracting] = useState(false);
  const dragging = useRef(false);
  const xformRef = useRef<Xform>({ x: 0, y: 0, s: 1 });
  const pendingXformRef = useRef<Xform | null>(null);
  const xformFrameRef = useRef(0);
  const dragOrigin = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });
  const gestureRef = useRef<GestureState>({
    moved: false,
    mode: "idle",
    startDistance: 0,
    startMidpointX: 0,
    startMidpointY: 0,
    startTouchX: 0,
    startTouchY: 0,
    startXform: { x: 0, y: 0, s: 1 },
  });
  const planRasterRef = useRef<PlanRasterState | null>(plan ? buildBasePlanRaster(plan) : null);
  const focusRasterRef = useRef<PlanViewportRasterState | null>(null);
  const focusRasterRequestRef = useRef("");
  const pointerMovedRef = useRef(false);
  const suppressInspectUntilRef = useRef(0);
  const [navigating, setNavigating] = useState(false);

  // Cache de HTMLImageElement por iconUrl. Se carga perezosamente la primera
  // vez que se intenta dibujar un icono; cuando termina la descarga, bump del
  // contador `iconImageVersion` fuerza un redraw del canvas.
  const iconImageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [iconImageVersion, setIconImageVersion] = useState(0);

  const getReadyIconImage = useCallback((url: string | undefined): HTMLImageElement | null => {
    if (!url) return null;
    const cache = iconImageCacheRef.current;
    const cached = cache.get(url);
    if (cached) {
      return cached.complete && cached.naturalWidth > 0 ? cached : null;
    }
    if (typeof Image === "undefined") return null;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => setIconImageVersion((v) => v + 1);
    img.onerror = () => {
      // Dejamos el entry en cache aunque haya fallado para no intentar de nuevo
      // en cada frame. El fallback (circulo) se encarga del render visual.
    };
    img.src = url;
    cache.set(url, img);
    return null;
  }, []);

  function commitXform(next: Xform) {
    xformRef.current = next;
    setXform(next);
  }

  function scheduleXform(next: Xform) {
    xformRef.current = next;
    pendingXformRef.current = next;
    if (xformFrameRef.current) {
      return;
    }
    xformFrameRef.current = requestAnimationFrame(() => {
      xformFrameRef.current = 0;
      const pending = pendingXformRef.current;
      if (!pending) {
        return;
      }
      pendingXformRef.current = null;
      setXform(pending);
    });
  }

  function matchesSelectedSegment(segmentLabel: string) {
    return !selectedLabel || segmentLabel === selectedLabel;
  }

  function markTransformInteraction() {
    suppressInspectUntilRef.current = Date.now() + 180;
  }

  function applyTransform(next: Xform, animationTime = 0) {
    xformRef.current = next;
    setXform(next);
    transformRef.current?.setTransform(next.x, next.y, next.s, animationTime, "easeOutCubic");
  }

  const canInteractWithPlan = pdfReady && isTransformReady;

  // Part numbers disponibles filtrados por segmento activo, ordenados por cantidad.
  // Siempre incluye también los part numbers flotantes para que se puedan revisar
  // aunque no formen parte de un segmento dibujado en el plano.
  const partNumberCounts = useMemo(() => {
    if (!segmentation) return [];
    const counts = new Map<string, number>();

    const bump = (partNumber: string) => {
      if (!partNumber) {
        return;
      }
      counts.set(partNumber, (counts.get(partNumber) ?? 0) + 1);
    };

    segmentation.points
      .filter((point) => matchesSelectedSegment(point.segmentLabel))
      .forEach((point) => bump(point.partNumber));

    flattenRecordGroups(segmentation.partNumberNoSwitch)
      .filter((device) => matchesSelectedSegment(device.segmentLabel))
      .forEach((device) => bump(device.partNumber));

    flattenRecordGroups(segmentation.partNumberUnpositioned)
      .filter((device) => matchesSelectedSegment(device.segmentLabel))
      .forEach((device) => bump(device.partNumber));

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([pn, count]) => ({ pn, count }));
  }, [segmentation, selectedLabel]);

  const selectedPartNumberSet = useMemo(
    () => new Set(selectedPartNumbers),
    [selectedPartNumbers]
  );

  const selectedPartSummary = useMemo(() => {
    if (!segmentation || selectedPartNumbers.length === 0) {
      return null;
    }

    const matchesSelectedPartNumber = (partNumber: string) =>
      selectedPartNumberSet.has(partNumber);

    const plottedDevices = segmentation.points.filter(
      (point) =>
        matchesSelectedPartNumber(point.partNumber) &&
        matchesSelectedSegment(point.segmentLabel)
    );

    const noSwitchDevices = collectGroupedEntries(
      selectedPartNumbers,
      segmentation.partNumberNoSwitch
    )
      .filter((device) => matchesSelectedSegment(device.segmentLabel))
      .slice()
      .sort((a, b) => a.id - b.id);

    const unpositionedDevices = collectGroupedEntries(
      selectedPartNumbers,
      segmentation.partNumberUnpositioned
    )
      .filter((device) => matchesSelectedSegment(device.segmentLabel))
      .slice()
      .sort((a, b) => a.id - b.id);

    return {
      noSwitchDevices,
      plotted: plottedDevices.length,
      plottedDevices,
      total: plottedDevices.length + noSwitchDevices.length + unpositionedDevices.length,
      unpositionedDevices,
    };
  }, [segmentation, selectedLabel, selectedPartNumberSet, selectedPartNumbers]);

  const noSwitchSuggestionByKey = useMemo(() => {
    const suggestions = new Map<string, { suggestedSegmentLabel: string; suggestedSwitchName: string }>();
    if (!segmentation) {
      return suggestions;
    }

    segmentation.missingSwitchDevices.forEach((device) => {
      if (!device.suggestedSegmentLabel && !device.suggestedSwitchName) {
        return;
      }
      suggestions.set(device.key, {
        suggestedSegmentLabel: device.suggestedSegmentLabel || "",
        suggestedSwitchName: device.suggestedSwitchName || "",
      });
    });

    return suggestions;
  }, [segmentation]);

  const selectedPartVisuals = useMemo(() => {
    return selectedPartNumbers.map((partNumber) => {
      const candidates = records.filter((record) => record.partNumber === partNumber);
      const contextualCandidates = candidates.filter((record) =>
        matchesSelectedSegment(record.switchSegment)
      );
      const recordsInScope = contextualCandidates.length > 0 ? contextualCandidates : candidates;
      const partKnowledge = getPartNumberKnowledge(partNumber, visualKnowledgeIndex);
      const preferred =
        recordsInScope.find((record) => record.iconUrl) ??
        recordsInScope.find((record) => record.iconDevice) ??
        recordsInScope[0] ??
        null;
      const allSuppressed = recordsInScope.length > 0 && recordsInScope.every((record) => record.visualDecision?.suppressed);
      const scopedNamePatternChoices: string[] = [];
      recordsInScope.forEach((record) => {
        const knowledge = getNamePatternKnowledge(record.name, visualKnowledgeIndex);
        (knowledge?.candidateIconDevices ?? []).forEach((candidate) => {
          scopedNamePatternChoices.push(candidate);
        });
      });
      const iconCandidates = Array.from(
        new Set(
          (
            partNumber === PTZ_PART_NUMBER
              ? resolvePtzVisualCandidates(recordsInScope)
              : [
                  partNumber,
                  preferred?.partNumber || "",
                  preferred?.iconDevice || "",
                  ...scopedNamePatternChoices,
                  ...(partKnowledge?.iconDevices ?? []),
                ]
          ).filter(Boolean)
        )
      );
      const matchedIconCandidate = iconCandidates.find((candidate) => lookupIcon(rawIconMap, candidate));
      const matchedIconUrl = matchedIconCandidate ? lookupIcon(rawIconMap, matchedIconCandidate) : "";
      const visualChoices =
        allSuppressed
          ? []
          : partNumber === PTZ_PART_NUMBER || isPosAmbiguousPartNumber(partNumber)
          ? buildVisualChoices(iconCandidates, rawIconMap, {
              iconDevice: matchedIconCandidate || preferred?.iconDevice || partNumber,
              iconUrl: matchedIconUrl || preferred?.iconUrl,
            })
          : buildVisualChoices(
              [matchedIconCandidate || preferred?.iconDevice || partNumber],
              rawIconMap,
              {
                iconDevice: matchedIconCandidate || preferred?.iconDevice || partNumber,
                iconUrl: matchedIconUrl || preferred?.iconUrl,
              }
            );
      const exactAvailability = iconCandidates.map((candidate) => ({
        available: rawIconMap.has(normalizeIconKey(candidate)),
        label: candidate,
      }));
      const matchMode = matchedIconCandidate
        ? rawIconMap.has(normalizeIconKey(matchedIconCandidate))
          ? t("segmentation.match.exact")
          : t("segmentation.match.flexible")
        : t("segmentation.match.none");

      return {
        ambiguityHint: getVisualAmbiguityHint(partNumber, visualChoices, t),
        exactAvailability,
        iconDevice:
          visualChoices.length > 1
            ? partNumber === PTZ_PART_NUMBER
              ? `${t("segmentation.ptzInterior")} · ${visualChoices.map((choice) => choice.shortLabel).join(" / ")}`
              : `${t("segmentation.posAmbiguousTitle")} · ${visualChoices.map((choice) => choice.shortLabel).join(" / ")}`
            : visualChoices[0]?.iconDevice ||
              (allSuppressed ? "" : matchedIconCandidate || preferred?.iconDevice || partNumber),
        iconOptions: partKnowledge?.iconDevices ?? [],
        iconUrl: allSuppressed ? "" : visualChoices[0]?.iconUrl || matchedIconUrl || preferred?.iconUrl,
        matchedIconCandidate: matchedIconCandidate || "",
        matchMode,
        preferredHadIconUrl: Boolean(preferred?.iconUrl),
        partNumber,
        visualChoices,
      };
    });
  }, [rawIconMap, records, selectedLabel, selectedPartNumbers, t, visualKnowledgeIndex]);

  const interactiveDevices = useMemo<InteractiveDevice[]>(() => {
    const devicesByKey = new Map<string, InteractiveDevice>();

    records.forEach((record) => {
      if (record.id === null) {
        return;
      }

      const marker = plan?.markers.get(record.id) ?? null;
      const x = record.x ?? marker?.x ?? null;
      const y = record.y ?? marker?.y ?? null;
      if (x === null || y === null) {
        return;
      }

      const resolvedIconUrl =
        record.visualDecision?.suppressed
          ? ""
          : record.iconUrl ||
            lookupIcon(rawIconMap, record.partNumber) ||
            lookupIcon(rawIconMap, record.iconDevice) ||
            "";
      const nameKnowledge = getNamePatternKnowledge(record.name, visualKnowledgeIndex);
      const visualChoices =
        record.visualDecision?.suppressed
          ? []
          : record.partNumber === PTZ_PART_NUMBER || isPosAmbiguousPartNumber(record.partNumber)
          ? buildVisualChoices(
              record.partNumber === PTZ_PART_NUMBER
                ? resolvePtzVisualCandidates([record])
                : [
                    ...(nameKnowledge?.candidateIconDevices ?? []),
                    record.iconDevice,
                    record.partNumber,
                  ],
              rawIconMap,
              {
                iconDevice: record.iconDevice || record.partNumber,
                iconUrl: resolvedIconUrl,
              }
            )
          : buildVisualChoices([record.iconDevice || record.partNumber], rawIconMap, {
              iconDevice: record.iconDevice || record.partNumber,
              iconUrl: resolvedIconUrl,
            });
      const switchSuggestion = noSwitchSuggestionByKey.get(record.key);

      devicesByKey.set(record.key, {
        ambiguityHint: getVisualAmbiguityHint(record.partNumber, visualChoices, t),
        cables: record.cables,
        iconDevice:
          visualChoices.length > 1
            ? record.partNumber === PTZ_PART_NUMBER
              ? `${t("segmentation.ptzInterior")} · ${visualChoices.map((choice) => choice.shortLabel).join(" / ")}`
              : `${t("segmentation.posAmbiguousTitle")} · ${visualChoices.map((choice) => choice.shortLabel).join(" / ")}`
            : visualChoices[0]?.iconDevice ||
              (record.visualDecision?.suppressed ? "" : record.iconDevice || record.partNumber),
        iconUrl: record.visualDecision?.suppressed ? "" : visualChoices[0]?.iconUrl || resolvedIconUrl,
        id: record.id,
        key: record.key,
        mountHeightFt: record.mountHeightFt,
        mountHeightNeedsFieldValidation: record.mountHeightNeedsFieldValidation,
        mountHeightRuleText: record.mountHeightRuleKey ? t(record.mountHeightRuleKey) : "",
        name: record.abbreviatedName || record.name,
        partNumber: record.partNumber,
        segmentLabel: record.switchSegment,
        suggestedSegmentLabel: switchSuggestion?.suggestedSegmentLabel || "",
        suggestedSwitchName: switchSuggestion?.suggestedSwitchName || "",
        switchName: record.switchName || record.hub || t("common.noSwitch"),
        visualChoices,
        x,
        y,
      });
    });

    return Array.from(devicesByKey.values());
  }, [noSwitchSuggestionByKey, plan, rawIconMap, records, t, visualKnowledgeIndex]);

  // Lookup rapido para el render de markers: key del device -> iconUrl.
  // Usamos la misma resolucion que ya existe en interactiveDevices (respeta
  // visualDecision.suppressed, visualChoices, PTZ, POS ambiguo, etc.).
  const iconUrlByDeviceKey = useMemo(() => {
    const map = new Map<string, string>();
    interactiveDevices.forEach((device) => {
      if (device.iconUrl) {
        map.set(device.key, device.iconUrl);
      }
    });
    return map;
  }, [interactiveDevices]);

  // Camino C: color de la gota por device key. Usamos partNumber + name del
  // InteractiveDevice (que ya reparo abreviaciones y consulta visual knowledge)
  // como entrada a resolveMarkerColor. Para puntos Grupo 2 (sin switch) el
  // device puede no estar en interactiveDevices — por eso el render cae a una
  // resolucion directa por partNumber (ver drawDeviceMarker).
  const markerColorByDeviceKey = useMemo(() => {
    const map = new Map<string, MarkerColor>();
    interactiveDevices.forEach((device) => {
      map.set(device.key, resolveMarkerColor(device.partNumber, device.name));
    });
    return map;
  }, [interactiveDevices]);

  // Precarga anticipada: arrancamos la descarga de todos los iconos unicos en
  // cuanto tenemos la lista de devices, asi cuando el tecnico hace tap en un
  // part number ya estan en cache y no se ve el flicker de "primero circulo,
  // luego icono".
  useEffect(() => {
    if (!SHOW_ICON_MARKERS) return;
    const unique = new Set<string>();
    iconUrlByDeviceKey.forEach((url) => {
      if (url) unique.add(url);
    });
    unique.forEach((url) => {
      getReadyIconImage(url);
    });
  }, [iconUrlByDeviceKey, getReadyIconImage]);

  // V2: layout de markers (clusters + leader lines). Se recalcula solo cuando
  // cambia la seleccion o la segmentacion — no es per-frame. Usa coordenadas
  // de canvas (planRaster.width/height) para que el clustering considere la
  // distancia visual real, no la distancia en el espacio del PDF.
  const markerLayoutByKey = useMemo<Map<string, MarkerPlacement>>(() => {
    const empty = new Map<string, MarkerPlacement>();
    if (!SHOW_LEADER_LINES) return empty;
    if (!segmentation) return empty;
    const canvasW = planRaster?.width ?? 0;
    const canvasH = planRaster?.height ?? 0;
    if (canvasW === 0 || canvasH === 0) return empty;
    if (selectedPartNumbers.length === 0) return empty;

    const seg = segmentation;
    const visible: VisibleMarker[] = [];

    // Grupo 1: puntos con switch asignado.
    seg.points.forEach((p) => {
      if (!selectedPartNumberSet.has(p.partNumber)) return;
      if (selectedLabel && p.segmentLabel !== selectedLabel) return;
      if (p.x < 0 || p.y < 0) return;
      visible.push({
        key: p.key,
        id: p.id,
        x: (p.x / seg.width) * canvasW,
        y: (p.y / seg.height) * canvasH,
      });
    });

    // Grupo 2: posicionados sin switch (circulo punteado).
    const noSwitchPoints = collectGroupedEntries(
      selectedPartNumbers,
      seg.partNumberNoSwitch
    );
    noSwitchPoints.forEach((pt) => {
      if (selectedLabel && pt.segmentLabel !== selectedLabel) return;
      if (!pt.canNavigate) return;
      if (pt.x === null || pt.y === null) return;
      visible.push({
        key: pt.key,
        id: pt.id,
        x: (pt.x / seg.width) * canvasW,
        y: (pt.y / seg.height) * canvasH,
      });
    });

    return computeMarkerLayout(visible, {
      clusterRadius: CLUSTER_RADIUS_CANVAS,
      minClusterSize: MIN_CLUSTER_SIZE,
      labelOffset: LABEL_OFFSET_CANVAS,
      labelMinArcGap: LABEL_MIN_ARC_GAP,
      canvasWidth: canvasW,
      canvasHeight: canvasH,
      canvasPadding: LABEL_CANVAS_PADDING,
    });
  }, [
    planRaster?.height,
    planRaster?.width,
    segmentation,
    selectedLabel,
    selectedPartNumberSet,
    selectedPartNumbers,
  ]);

  const progressSummary = useMemo(() => {
    const totalDevices = interactiveDevices.length;
    const cableEligibleDevices = interactiveDevices.filter((device) => device.cables > 0).length;
    const cableExpectedUnits = interactiveDevices.reduce(
      (sum, device) => sum + Math.max(0, device.cables),
      0
    );

    let cableCompletedDevices = 0;
    let cableCompletedUnits = 0;
    let completeCount = 0;
    let installedCount = 0;
    let notStartedCount = 0;
    let partialCount = 0;
    let switchConnectedCount = 0;
    const segmentSummaryByLabel: Record<string, SegmentProgressSummary> = {};

    interactiveDevices.forEach((device) => {
      const progress = deviceProgressByKey[device.key] ?? EMPTY_OPERATIONAL_PROGRESS;
      const completedSteps = countOperationalProgressSteps(progress);
      const deviceSegmentLabel = device.segmentLabel || device.suggestedSegmentLabel;
      const segmentSummary = deviceSegmentLabel
        ? (segmentSummaryByLabel[deviceSegmentLabel] ??= {
            cableRunCount: 0,
            completeCount: 0,
            installedCount: 0,
            notStartedCount: 0,
            partialCount: 0,
            remainingCount: 0,
            switchConnectedCount: 0,
            totalDevices: 0,
          })
        : null;

      if (segmentSummary) {
        segmentSummary.totalDevices += 1;
      }

      if (progress.cableRun) {
        cableCompletedDevices += 1;
        cableCompletedUnits += Math.max(0, device.cables);
        if (segmentSummary) {
          segmentSummary.cableRunCount += 1;
        }
      }
      if (progress.installed) {
        installedCount += 1;
        if (segmentSummary) {
          segmentSummary.installedCount += 1;
        }
      }
      if (progress.switchConnected) {
        switchConnectedCount += 1;
        if (segmentSummary) {
          segmentSummary.switchConnectedCount += 1;
        }
      }

      if (completedSteps === 0) {
        notStartedCount += 1;
        if (segmentSummary) {
          segmentSummary.notStartedCount += 1;
        }
      } else if (completedSteps === OPERATIONAL_PROGRESS_DRAW_ORDER.length) {
        completeCount += 1;
        if (segmentSummary) {
          segmentSummary.completeCount += 1;
        }
      } else {
        partialCount += 1;
        if (segmentSummary) {
          segmentSummary.partialCount += 1;
        }
      }
    });

    const overallExpectedMilestones = cableEligibleDevices + totalDevices + totalDevices;
    const overallCompletedMilestones =
      cableCompletedDevices + installedCount + switchConnectedCount;
    const remainingCount = totalDevices - completeCount;

    Object.values(segmentSummaryByLabel).forEach((segmentSummary) => {
      segmentSummary.remainingCount = segmentSummary.totalDevices - segmentSummary.completeCount;
    });

    return {
      cableCompletedDevices,
      cableCompletedUnits,
      cableEligibleDevices,
      cableExpectedUnits,
      cablePercent: percentage(cableCompletedUnits, cableExpectedUnits),
      completeCount,
      installedCount,
      installedPercent: percentage(installedCount, totalDevices),
      notStartedCount,
      overallPercent: percentage(overallCompletedMilestones, overallExpectedMilestones),
      partialCount,
      remainingCount,
      segmentSummaryByLabel,
      switchConnectedCount,
      switchPercent: percentage(switchConnectedCount, totalDevices),
      totalDevices,
    };
  }, [deviceProgressByKey, interactiveDevices]);

  const progressStepDefinitions = useMemo(
    () => [
      {
        accentClass: "segmentation-progress-action--cable",
        compactLabel: t("segmentation.progress.cableCompact"),
        key: "cableRun" as const,
        label: t("segmentation.progress.cable"),
      },
      {
        accentClass: "segmentation-progress-action--installed",
        compactLabel: t("segmentation.progress.installedCompact"),
        key: "installed" as const,
        label: t("segmentation.progress.installed"),
      },
      {
        accentClass: "segmentation-progress-action--switch",
        compactLabel: t("segmentation.progress.switchCompact"),
        key: "switchConnected" as const,
        label: t("segmentation.progress.switch"),
      },
    ],
    [t]
  );

  const progressLegendDefinitions = useMemo(
    () => [
      ...progressStepDefinitions,
      {
        accentClass: "segmentation-progress-action--complete",
        key: "complete",
        label: t("segmentation.progress.complete"),
      },
    ],
    [progressStepDefinitions, t]
  );

  const mobileSummary = useMemo(() => {
    if (!segmentation) {
      return { label: t("segmentation.summary.plan"), meta: "" };
    }

    if (selectedPartSummary) {
      const partLabel =
        selectedPartNumbers.length === 1
          ? selectedPartNumbers[0]
          : t("segmentation.partNumbersSelected", { count: selectedPartNumbers.length });
      return {
        label: selectedLabel || t("segmentation.all"),
        meta: `${selectedPartSummary.plotted}/${selectedPartSummary.total} · ${partLabel}${
          projectProgressScope
            ? ` · ${progressSummary.overallPercent}% ${t("segmentation.progress.overall").toLowerCase()}`
            : ""
        }`,
      };
    }

    const segmented = segmentation.totals.segmentedPoints;
    const noSwitch = segmentation.missingSwitchDevices.length;
    const noPos = groupedEntryCount(segmentation.partNumberUnpositioned);
    const total = segmented + noSwitch + noPos;

    return {
      label: selectedLabel || t("segmentation.all"),
      meta: `${segmented}/${total} ${t("common.devicePlural")}${
        projectProgressScope
          ? ` · ${progressSummary.overallPercent}% ${t("segmentation.progress.overall").toLowerCase()}`
          : ""
      }`,
    };
  }, [
    progressSummary.overallPercent,
    projectProgressScope,
    segmentation,
    selectedLabel,
    selectedPartNumbers,
    selectedPartSummary,
    t,
  ]);

  const selectedSegmentProgressSummary = useMemo(() => {
    if (!selectedLabel) {
      return null;
    }

    return progressSummary.segmentSummaryByLabel[selectedLabel] ?? null;
  }, [progressSummary.segmentSummaryByLabel, selectedLabel]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleResize = () => {
      setIsMobileViewport(detectCompactViewport());
      setViewportSize({
        height: window.innerHeight,
        width: window.innerWidth,
      });
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    setControlsExpanded(!isMobileViewport);
  }, [isMobileViewport, open]);

  useEffect(() => {
    if (!open) {
      setDevicePreview(null);
      setIsTransformInteracting(false);
      setIsTransformReady(false);
      setPendingProgressAction(null);
      setUndoProgressAction(null);
    }
  }, [open]);

  useEffect(() => {
    setIsTransformReady(false);
    setIsTransformInteracting(false);
    setDevicePreview(null);
    setPendingProgressAction(null);
    setUndoProgressAction(null);
    commitXform({ x: 0, y: 0, s: 1 });
  }, [plan?.blobUrl]);

  useEffect(() => {
    planRasterRef.current = planRaster;
  }, [planRaster]);

  useEffect(() => {
    focusRasterRef.current = focusRaster;
  }, [focusRaster]);

  useEffect(() => {
    return () => {
      revokePlanRaster(planRasterRef.current);
      revokePlanRaster(focusRasterRef.current);
    };
  }, []);

  useEffect(() => {
    const activeBlobUrl = plan?.blobUrl ?? "";
    return () => {
      if (activeBlobUrl) {
        void releaseRenderedPlanDocument(activeBlobUrl);
      }
    };
  }, [plan?.blobUrl]);

  useEffect(() => {
    setPlanRaster((current) => {
      const next = plan ? buildBasePlanRaster(plan) : null;
      if (current && current.url !== next?.url) {
        revokePlanRaster(current);
      }
      return next;
    });
    setFocusRaster((current) => {
      if (current) {
        revokePlanRaster(current);
      }
      return null;
    });
    focusRasterRequestRef.current = "";
  }, [plan]);

  useEffect(() => {
    if (open || !plan) {
      return;
    }
    setPlanRaster((current) => {
      const next = buildBasePlanRaster(plan);
      if (current && current.url !== next.url) {
        revokePlanRaster(current);
      }
      return next;
    });
  }, [open, plan]);

  useEffect(() => {
    xformRef.current = xform;
  }, [xform]);

  useEffect(() => {
    return () => {
      if (xformFrameRef.current) {
        cancelAnimationFrame(xformFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setDevicePreview((current) => {
      if (!current) {
        return current;
      }
      return interactiveDevices.find((device) => device.key === current.device.key)
        ? current
        : null;
    });
  }, [interactiveDevices]);

  useEffect(() => {
    if (!pendingProgressAction) {
      return;
    }

    const deviceStillVisible =
      devicePreview?.device.key === pendingProgressAction.deviceKey ||
      interactiveDevices.some((device) => device.key === pendingProgressAction.deviceKey);
    if (!deviceStillVisible) {
      setPendingProgressAction(null);
    }
  }, [devicePreview?.device.key, interactiveDevices, pendingProgressAction]);

  useEffect(() => {
    if (!undoProgressAction) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setUndoProgressAction(null);
    }, OPERATIONAL_PROGRESS_UNDO_MS);

    return () => window.clearTimeout(timeoutId);
  }, [undoProgressAction]);

  useEffect(() => {
    if (!open || selectedPartVisuals.length === 0) {
      return;
    }

    console.log(
      "[segmentation-icons] selectedPartVisuals",
      selectedPartVisuals.map((item) => ({
        exactAvailability: item.exactAvailability,
        hasIconUrl: Boolean(item.iconUrl),
        iconDevice: item.iconDevice,
        matchMode: item.matchMode,
        matchedIconCandidate: item.matchedIconCandidate,
        partNumber: item.partNumber,
        preferredHadIconUrl: item.preferredHadIconUrl,
      }))
    );
  }, [open, selectedPartVisuals]);

  useEffect(() => {
    if (!open || !plan || !plan.blobUrl) {
      return;
    }

    const deviceScale = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth || 0 : 0;
    const requestedWidth = clamp(
      Math.round(Math.max(900, viewportWidth || 900) * deviceScale * 2.5),
      1400,
      2600
    );

    if (plan.previewWidth >= requestedWidth - 64) {
      return;
    }

    let live = true;
    renderPlanPreview(plan.blobUrl, plan.width, {
      maxWidth: 2600,
      minWidth: 1400,
      preferLossless: true,
      targetWidth: requestedWidth,
    })
      .then((rendered) => {
        if (!live) {
          revokePlanRaster(rendered);
          return;
        }
        setPlanRaster((current) => {
          if (current && current.url !== rendered.url) {
            revokePlanRaster(current);
          }
          return rendered;
        });
      })
      .catch((error) => {
        console.warn("[segmentation] No pude generar la vista nitida del plano:", error);
      });

    return () => {
      live = false;
    };
  }, [open, plan]);


  useEffect(() => {
    if (!open || !plan) {
      setPdfReady(false);
      return;
    }
    setPdfReady(false);
  }, [open, plan]);

  // The plan is displayed via <img> so iOS Safari composites against the
  // raster's natural size instead of only the CSS box, which helps preserve
  // detail while we swap in sharper viewport tiles on demand.
  useEffect(() => {
    if (!open || !planRaster) {
      setPdfReady(false);
      return;
    }
    setPdfReady(true);
  }, [open, planRaster]);

  // Prevent iOS Safari from intercepting multi-touch gestures when the user
  // pinches past the app's maxScale — without this the browser attempts a
  // native page zoom and crashes the view.
  useEffect(() => {
    if (!open) {
      return;
    }
    const el = viewportRef.current;
    if (!el) {
      return;
    }
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener("gesturestart", prevent, { passive: false });
    el.addEventListener("gesturechange", prevent, { passive: false });
    el.addEventListener("gestureend", prevent, { passive: false });
    return () => {
      el.removeEventListener("gesturestart", prevent);
      el.removeEventListener("gesturechange", prevent);
      el.removeEventListener("gestureend", prevent);
    };
  }, [open]);

  const getFitScale = useCallback(() => {
    if (!viewportRef.current || !plan) {
      return 1;
    }
    const vw = viewportRef.current.clientWidth;
    const vh = viewportRef.current.clientHeight;
    return Math.min(vw / plan.width, vh / plan.height) * 0.97;
  }, [plan]);

  const getMinScale = useCallback(() => {
    const fitScale = getFitScale();
    const ratio = isMobileViewport ? MOBILE_MIN_SCALE_RATIO : DESKTOP_MIN_SCALE_RATIO;
    return Math.max(INTERACTIVE_MIN_SCALE, fitScale * ratio);
  }, [getFitScale, isMobileViewport]);

  const getMaxScale = useCallback(() => (isMobileViewport ? 8 : 20), [isMobileViewport]);

  const currentMinScale = useMemo(() => getMinScale(), [getMinScale]);
  const currentMaxScale = useMemo(() => getMaxScale(), [getMaxScale]);

  const stepZoom = useCallback((factor: number) => {
    if (!canInteractWithPlan) {
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const prev = xformRef.current;
    const minScale = getMinScale();
    const maxScale = getMaxScale();
    const nextScale = clamp(prev.s * factor, minScale, maxScale);
    if (Math.abs(nextScale - prev.s) < 0.001) {
      return;
    }
    const centerX = viewport.clientWidth / 2;
    const centerY = viewport.clientHeight / 2;
    const stageX = (centerX - prev.x) / prev.s;
    const stageY = (centerY - prev.y) / prev.s;
    markTransformInteraction();
    applyTransform({
      s: nextScale,
      x: centerX - stageX * nextScale,
      y: centerY - stageY * nextScale,
    });
  }, [canInteractWithPlan, getMaxScale, getMinScale]);

  // Fit the whole plan inside the viewport
  const fitToViewport = useCallback(() => {
    if (!viewportRef.current || !plan) {
      return;
    }
    const vw = viewportRef.current.clientWidth;
    const vh = viewportRef.current.clientHeight;
    const s = getFitScale();
    applyTransform({
      s,
      x: (vw - plan.width * s) / 2,
      y: (vh - plan.height * s) / 2,
    });
  }, [getFitScale, plan]);

  useEffect(() => {
    if (pdfReady && isTransformReady) {
      fitToViewport();
    }
  }, [fitToViewport, isTransformReady, pdfReady]);

  useEffect(() => {
    if (!open || !plan || !pdfReady || !viewportRef.current) {
      setFocusRaster((current) => {
        if (current) {
          revokePlanRaster(current);
        }
        return null;
      });
      focusRasterRequestRef.current = "";
      return;
    }

    const viewport = viewportRef.current;
    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    if (!viewportWidth || !viewportHeight) {
      return;
    }

    const fitScale = getFitScale();
    const focusActivationScale = Math.max(
      fitScale * (isMobileViewport ? 1.18 : 1.1),
      INTERACTIVE_MIN_SCALE
    );

    if (xform.s <= focusActivationScale) {
      setFocusRaster((current) => {
        if (current) {
          revokePlanRaster(current);
        }
        return null;
      });
      focusRasterRequestRef.current = "";
      return;
    }

    const visibleLeft = clamp(-xform.x / xform.s, 0, plan.width);
    const visibleTop = clamp(-xform.y / xform.s, 0, plan.height);
    const visibleRight = clamp((viewportWidth - xform.x) / xform.s, 0, plan.width);
    const visibleBottom = clamp((viewportHeight - xform.y) / xform.s, 0, plan.height);

    if (visibleRight - visibleLeft < 1 || visibleBottom - visibleTop < 1) {
      return;
    }

    const overscanPixels = isMobileViewport ? 112 : 164;
    const overscanX = Math.min(plan.width * 0.08, overscanPixels / Math.max(xform.s, 0.35));
    const overscanY = Math.min(plan.height * 0.08, overscanPixels / Math.max(xform.s, 0.35));
    const regionLeft = clamp(Math.floor(visibleLeft - overscanX), 0, Math.max(0, plan.width - 1));
    const regionTop = clamp(Math.floor(visibleTop - overscanY), 0, Math.max(0, plan.height - 1));
    const regionRight = clamp(Math.ceil(visibleRight + overscanX), regionLeft + 1, plan.width);
    const regionBottom = clamp(Math.ceil(visibleBottom + overscanY), regionTop + 1, plan.height);
    const regionWidth = Math.max(1, regionRight - regionLeft);
    const regionHeight = Math.max(1, regionBottom - regionTop);

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const targetPixelWidth =
      (viewportWidth + overscanPixels * 2) * dpr * (isMobileViewport ? 1.08 : 1.22);
    const targetPixelHeight =
      (viewportHeight + overscanPixels * 2) * dpr * (isMobileViewport ? 1.08 : 1.22);
    const pixelBudget = isMobileViewport ? 4_600_000 : 8_200_000;
    const area = Math.max(regionWidth * regionHeight, 1);
    const scaleForViewport = Math.max(
      targetPixelWidth / regionWidth,
      targetPixelHeight / regionHeight
    );
    const scaleForBudget = Math.sqrt(pixelBudget / area);
    const renderScale = clamp(
      Math.min(scaleForViewport, scaleForBudget, isMobileViewport ? 2.3 : 3.2),
      0.6,
      4
    );

    const requestKey = [
      plan.blobUrl,
      regionLeft,
      regionTop,
      regionWidth,
      regionHeight,
      Math.round(renderScale * 100),
    ].join(":");

    if (requestKey === focusRasterRequestRef.current && focusRasterRef.current) {
      return;
    }

    let live = true;
    const timeoutId = window.setTimeout(() => {
      focusRasterRequestRef.current = requestKey;
      renderPlanViewportTile(plan.blobUrl, {
        preferLossless: false,
        region: {
          height: regionHeight,
          width: regionWidth,
          x: regionLeft,
          y: regionTop,
        },
        scale: renderScale,
      })
        .then((rendered) => {
          if (!live || focusRasterRequestRef.current !== requestKey) {
            revokePlanRaster(rendered);
            return;
          }
          setFocusRaster((current) => {
            if (current && current.url !== rendered.url) {
              revokePlanRaster(current);
            }
            return rendered;
          });
        })
        .catch((error) => {
          if (focusRasterRequestRef.current === requestKey) {
            focusRasterRequestRef.current = "";
          }
          console.warn("[segmentation] No pude generar el detalle del viewport:", error);
        });
    }, isTransformInteracting ? 400 : 150);

    return () => {
      live = false;
      window.clearTimeout(timeoutId);
    };
  }, [
    controlsExpanded,
    getFitScale,
    isMobileViewport,
    isTransformInteracting,
    open,
    pdfReady,
    plan,
    viewportSize.height,
    viewportSize.width,
    xform.s,
    xform.x,
    xform.y,
  ]);

  // Draw segmentation overlay at the same pixel dimensions as the PDF canvas
  useEffect(() => {
    if (!pdfReady || !segmentation || !planRaster || !overlayCanvasRef.current) {
      return;
    }
    const overlay = overlayCanvasRef.current;
    const ctx = overlay.getContext("2d");
    if (!ctx) {
      return;
    }

    overlay.width = planRaster.width;
    overlay.height = planRaster.height;

    const seg = segmentation;
    const W = overlay.width;
    const H = overlay.height;
    ctx.clearRect(0, 0, W, H);

    // Fallback mode: no positioned points → skip Voronoi grid drawing
    if (seg.gridWidth === 0 || seg.gridHeight === 0) {
      return;
    }

    const cw = W / seg.gridWidth;
    const ch = H / seg.gridHeight;

    // Fill segment regions
    for (let gy = 0; gy < seg.gridHeight; gy += 1) {
      for (let gx = 0; gx < seg.gridWidth; gx += 1) {
        const li = seg.grid[gy * seg.gridWidth + gx];
        const label = seg.labels[li];
        const active = !selectedLabel || label === selectedLabel;
        ctx.fillStyle = colorFor(li, active ? 0.22 : 0.05);
        ctx.fillRect(gx * cw, gy * ch, cw + 1, ch + 1);
      }
    }

    // Boundary lines between segments
    ctx.lineWidth = RENDER_SCALE;
    for (let gy = 0; gy < seg.gridHeight; gy += 1) {
      for (let gx = 0; gx < seg.gridWidth; gx += 1) {
        const idx = gy * seg.gridWidth + gx;
        const cur = seg.grid[idx];

        if (gx < seg.gridWidth - 1) {
          const right = seg.grid[idx + 1];
          if (cur !== right) {
            const active =
              !selectedLabel ||
              seg.labels[cur] === selectedLabel ||
              seg.labels[right] === selectedLabel;
            ctx.strokeStyle = active ? "rgba(17,32,51,0.5)" : "rgba(17,32,51,0.1)";
            ctx.beginPath();
            ctx.moveTo((gx + 1) * cw, gy * ch);
            ctx.lineTo((gx + 1) * cw, (gy + 1) * ch);
            ctx.stroke();
          }
        }

        if (gy < seg.gridHeight - 1) {
          const down = seg.grid[idx + seg.gridWidth];
          if (cur !== down) {
            const active =
              !selectedLabel ||
              seg.labels[cur] === selectedLabel ||
              seg.labels[down] === selectedLabel;
            ctx.strokeStyle = active ? "rgba(17,32,51,0.5)" : "rgba(17,32,51,0.1)";
            ctx.beginPath();
            ctx.moveTo(gx * cw, (gy + 1) * ch);
            ctx.lineTo((gx + 1) * cw, (gy + 1) * ch);
            ctx.stroke();
          }
        }
      }
    }

  }, [pdfReady, planRaster?.height, planRaster?.width, segmentation, selectedLabel]);

  // Dibujar capa de part numbers — círculos por dispositivo
  useEffect(() => {
    if (!pdfReady || !planRaster || !partNumCanvasRef.current || !segmentation) {
      return;
    }
    const canvas = partNumCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    canvas.width = planRaster.width;
    canvas.height = planRaster.height;
    const allowAnimatedMarkers = !isMobileViewport && selectedPartNumbers.length > 0;
    let frameId = 0;

    const draw = (timeMs: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const seg = segmentation;
      const W = canvas.width;
      const H = canvas.height;
      const R = 7 * RENDER_SCALE;
      const FONT_SIZE = 8 * RENDER_SCALE;

      // Helper local (mismo contexto de `ctx`, `R`, `FONT_SIZE`) para pintar un
      // marker de dispositivo con icono (si el iconUrl resuelve) o circulo
      // azul (fallback). En ambos casos pinta el ID del device encima con halo
      // blanco para que siga legible sobre el icono o sobre el plano.
      //
      // V2: si el marker es parte de un cluster denso, el ID se dibuja
      // desplazado (labelX, labelY) sobre un pill blanco, conectado al
      // anchor del icono con una linea fina. El icono NUNCA se mueve del
      // anchor original — es la etiqueta la que sale a ventilar.
      const LEADER_STROKE = "rgba(20, 58, 110, 0.78)";
      const PILL_FILL = "rgba(255, 255, 255, 0.96)";
      const PILL_STROKE = "rgba(20, 58, 110, 0.55)";

      const drawRoundRect = (
        rx: number,
        ry: number,
        rw: number,
        rh: number,
        rr: number
      ) => {
        // Safari <= 15 no soporta ctx.roundRect — usamos arcTo para cubrir
        // todas las versiones de WebKit relevantes en iPhone.
        const r = Math.min(rr, rw / 2, rh / 2);
        ctx.beginPath();
        ctx.moveTo(rx + r, ry);
        ctx.lineTo(rx + rw - r, ry);
        ctx.arcTo(rx + rw, ry, rx + rw, ry + r, r);
        ctx.lineTo(rx + rw, ry + rh - r);
        ctx.arcTo(rx + rw, ry + rh, rx + rw - r, ry + rh, r);
        ctx.lineTo(rx + r, ry + rh);
        ctx.arcTo(rx, ry + rh, rx, ry + rh - r, r);
        ctx.lineTo(rx, ry + r);
        ctx.arcTo(rx, ry, rx + r, ry, r);
        ctx.closePath();
      };

      // Helper: dibuja una gota (teardrop) identica al marker original de
      // SiteOwl. La punta apunta hacia abajo y toca exactamente (tipX, tipY)
      // — la posicion del dispositivo. El circulo superior tiene radio headR
      // y esta centrado en (tipX, tipY - headR - tipLen). Retorna el centro
      // del circulo para pintar el ID dentro.
      //
      // Construccion: las tangentes al circulo desde la punta tocan el
      // circulo a ±theta de la vertical. El arco superior va de la tangente
      // izquierda sobre el TOP del circulo a la tangente derecha.
      const drawTeardropPath = (tipX: number, tipY: number, headR: number, tipLen: number) => {
        const cx = tipX;
        const cy = tipY - (headR + tipLen);
        const dist = headR + tipLen;
        const sinTheta = Math.min(headR / Math.max(dist, headR + 0.001), 0.999);
        const theta = Math.asin(sinTheta);
        // Angulos de contacto en coordenadas canvas (y-abajo, 0 = derecha,
        // PI/2 = abajo). La punta esta debajo del centro → PI/2. Las
        // tangentes estan a ±(PI/2 - theta) de la recta centro-punta.
        const rightAngle = theta;          // 0..PI/2 — debajo del ecuador a la derecha
        const leftAngle = Math.PI - theta; // PI/2..PI — debajo del ecuador a la izquierda
        const rightX = cx + headR * Math.cos(rightAngle);
        const rightY = cy + headR * Math.sin(rightAngle);
        const leftX = cx + headR * Math.cos(leftAngle);
        const leftY = cy + headR * Math.sin(leftAngle);

        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(leftX, leftY);
        // Arco pasando por ARRIBA del circulo (de leftAngle a rightAngle).
        // En canvas (y-abajo) "anticlockwise=false" con leftAngle > rightAngle
        // avanza en angulos crecientes: PI-theta → PI → 3PI/2 (tope) → 2PI → theta.
        // Ese camino cruza el TOP del circulo (3PI/2 = arriba visual).
        ctx.arc(cx, cy, headR, leftAngle, rightAngle, false);
        // arc dejo el cursor en (rightX, rightY); cerramos al tip.
        ctx.lineTo(tipX, tipY);
        ctx.closePath();

        return { centerX: cx, centerY: cy };
      };

      const drawColoredTeardrop = (
        tipX: number,
        tipY: number,
        idLabel: string,
        color: MarkerColor,
        variant: "solid" | "dashed"
      ) => {
        ctx.save();
        if (variant === "dashed") {
          ctx.setLineDash([3 * RENDER_SCALE, 2 * RENDER_SCALE]);
        } else {
          ctx.setLineDash([]);
        }
        const geom = drawTeardropPath(tipX, tipY, TEARDROP_HEAD_RADIUS, TEARDROP_TIP_LENGTH);
        // Fill opaco (sin sombra/halo) para que la gota CUBRA el label baked
        // del PDF. Si dejamos sombra, se notaria un parche alrededor que el
        // tecnico lee como suciedad en el plano.
        ctx.fillStyle = color.fill;
        ctx.fill();
        ctx.lineWidth = 1 * RENDER_SCALE;
        ctx.strokeStyle = color.stroke;
        ctx.stroke();

        // ID grande y blanco al centro del circulo — igual que el original.
        // Escalamos el tipo con la cantidad de digitos para que 3 o 4 digitos
        // no se desborden.
        // Font escalado junto con la cabeza (ahora 6*RS). Limite practico
        // de legibilidad en iPhone — si bajamos mas, el texto se pierde
        // contra el stroke oscuro. Mantenemos peso 700 para densidad.
        //   2 digitos: 6*RS | 3 digitos: 5*RS | 4+ digitos: 4*RS
        const labelLen = idLabel.length;
        const fontPx =
          labelLen >= 4
            ? 4 * RENDER_SCALE
            : labelLen === 3
            ? 5 * RENDER_SCALE
            : 6 * RENDER_SCALE;
        ctx.font = `700 ${fontPx}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = color.textColor;
        ctx.fillText(idLabel, geom.centerX, geom.centerY);
        ctx.restore();
      };

      const drawDeviceMarker = (
        x: number,
        y: number,
        deviceKey: string,
        idLabel: string,
        variant: "solid" | "dashed",
        partNumber: string,
        deviceName?: string
      ) => {
        // Camino C: gota coloreada con ID dentro, SIEMPRE en (x, y).
        // Sin desplazamiento ni leader lines — la gota cubre opacamente el
        // label baked del PDF y en clusters densos se encimen igual que en
        // el marcador naranja original. Esto preserva la metafora
        // inmediata: un solo numero, un solo color, la punta marca donde
        // esta el dispositivo.
        if (USE_COLORED_TEARDROPS) {
          const color =
            markerColorByDeviceKey.get(deviceKey) ?? resolveMarkerColor(partNumber, deviceName);
          drawColoredTeardrop(x, y, idLabel, color, variant);
          return;
        }

        // --- Legacy V2.2: iconos PNG con pill separado + leader lines. Se
        // deja intacto por si USE_COLORED_TEARDROPS se apaga. ---
        const placement = markerLayoutByKey.get(deviceKey);
        const labelX = placement ? placement.labelX : x;
        const labelY = placement ? placement.labelY : y;
        const showLeader = placement?.showLeader === true;
        const iconUrl = SHOW_ICON_MARKERS ? iconUrlByDeviceKey.get(deviceKey) : undefined;
        const iconImg = iconUrl ? getReadyIconImage(iconUrl) : null;

        ctx.save();
        ctx.font = `700 ${FONT_SIZE}px system-ui, sans-serif`;
        const metrics = ctx.measureText(idLabel);
        const textW = metrics.width;
        const padX = 4 * RENDER_SCALE;
        const padY = 2.5 * RENDER_SCALE;
        const pillW = Math.max(textW + padX * 2, 14 * RENDER_SCALE);
        const pillH = FONT_SIZE + padY * 2;
        ctx.restore();

        let pillCX: number;
        let pillCY: number;
        if (showLeader) {
          pillCX = labelX;
          pillCY = labelY;
        } else {
          pillCX = x;
          pillCY = y + ICON_MARKER_SIZE / 2 + pillH / 2 + 2 * RENDER_SCALE;
          if (pillCY + pillH / 2 > canvas.height - 2 * RENDER_SCALE) {
            pillCY = y - ICON_MARKER_SIZE / 2 - pillH / 2 - 2 * RENDER_SCALE;
          }
        }

        if (showLeader) {
          ctx.save();
          ctx.setLineDash([]);
          const dx = pillCX - x;
          const dy = pillCY - y;
          const dist = Math.hypot(dx, dy) || 1;
          const ux = dx / dist;
          const uy = dy / dist;
          const iconEdge = ICON_MARKER_SIZE / 2 + 0.5 * RENDER_SCALE;
          const pillEdge = Math.min(pillW, pillH) / 2;
          const startX = x + ux * iconEdge;
          const startY = y + uy * iconEdge;
          const endX = pillCX - ux * pillEdge;
          const endY = pillCY - uy * pillEdge;
          ctx.strokeStyle = LEADER_STROKE;
          ctx.lineWidth = 1 * RENDER_SCALE;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();
          ctx.restore();
        }

        if (iconImg) {
          const size = ICON_MARKER_SIZE;
          const tilePad = 2 * RENDER_SCALE;
          const tileSize = size + tilePad * 2;
          const tileRadius = 3 * RENDER_SCALE;
          ctx.save();
          drawRoundRect(
            x - tileSize / 2,
            y - tileSize / 2,
            tileSize,
            tileSize,
            tileRadius
          );
          ctx.fillStyle = "rgba(255, 255, 255, 1)";
          ctx.fill();
          ctx.lineWidth = 0.9 * RENDER_SCALE;
          ctx.strokeStyle = PILL_STROKE;
          ctx.stroke();
          ctx.drawImage(iconImg, x - size / 2, y - size / 2, size, size);
          ctx.restore();
        } else {
          ctx.save();
          if (variant === "dashed") {
            ctx.setLineDash([5 * RENDER_SCALE, 4 * RENDER_SCALE]);
          } else {
            ctx.setLineDash([]);
          }
          ctx.beginPath();
          ctx.arc(x, y, R, 0, Math.PI * 2);
          ctx.strokeStyle = PART_MARKER_COLOR;
          ctx.lineWidth = 1.5 * RENDER_SCALE;
          ctx.stroke();
          ctx.restore();
        }

        ctx.save();
        const pillX = pillCX - pillW / 2;
        const pillY = pillCY - pillH / 2;
        drawRoundRect(pillX, pillY, pillW, pillH, pillH / 2);
        ctx.fillStyle = PILL_FILL;
        ctx.fill();
        ctx.lineWidth = 0.9 * RENDER_SCALE;
        ctx.strokeStyle = PILL_STROKE;
        ctx.stroke();
        ctx.font = `700 ${FONT_SIZE}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = PART_MARKER_COLOR;
        ctx.fillText(idLabel, pillCX, pillCY);
        ctx.restore();
      };

      interactiveDevices.forEach((device) => {
        const progress = deviceProgressByKey[device.key] ?? EMPTY_OPERATIONAL_PROGRESS;
        const steps = activeOperationalSteps(progress);
        const deviceSegment = device.segmentLabel || device.suggestedSegmentLabel;
        if (steps.length === 0) {
          return;
        }
        const x = (device.x / seg.width) * W;
        const y = (device.y / seg.height) * H;
        const isInSelectedSegment = !selectedLabel || deviceSegment === selectedLabel;
        ctx.save();
        if (!isInSelectedSegment) {
          ctx.globalAlpha = 0.34;
        }
        drawOperationalProgressLines(
          ctx,
          x,
          y,
          isOperationalProgressComplete(progress) ? OPERATIONAL_PROGRESS_DRAW_ORDER : steps
        );
        ctx.restore();
      });

      // Camino C: las gotas de color se dibujan SIEMPRE (sin esperar a que
      // el tecnico seleccione un part number). Esto da "vista rapida
      // inmediata" apenas abre el plano: ve todas las camaras coloreadas por
      // familia. La seleccion de part number simplemente reduce la muestra
      // cuando el tecnico quiere enfocarse en un tipo de dispositivo.
      //
      // Modo legacy (iconos): solo renderiza al seleccionar, igual que antes.
      const hasFilter = selectedPartNumbers.length > 0;
      if (!hasFilter && !USE_COLORED_TEARDROPS) {
        if (devicePreview) {
          const x = (devicePreview.device.x / seg.width) * W;
          const y = (devicePreview.device.y / seg.height) * H;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(x, y, R + 4 * RENDER_SCALE, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255, 198, 92, 0.96)";
          ctx.lineWidth = 2 * RENDER_SCALE;
          ctx.stroke();
        }
        return;
      }

      // Grupo 1: dispositivos con switch asignado — gota coloreada (o icono
      // en modo legacy). Con teardrops: muestra TODOS cuando no hay filtro,
      // o solo los partNumbers seleccionados si el tecnico filtro.
      ctx.setLineDash([]);
      seg.points
        .filter(
          (p) =>
            (!hasFilter || selectedPartNumberSet.has(p.partNumber)) &&
            (!selectedLabel || p.segmentLabel === selectedLabel) &&
            p.x >= 0 &&
            p.y >= 0
        )
        .forEach((point) => {
          const x = (point.x / seg.width) * W;
          const y = (point.y / seg.height) * H;
          // Pulse halo solo en modo legacy (iconos). Con gotas de color la
          // onda de halo se ve como parches azules que tapan detalles del plano.
          if (allowAnimatedMarkers && !USE_COLORED_TEARDROPS) {
            drawMarkerPulse(ctx, x, y, R, timeMs);
          }
          drawDeviceMarker(x, y, point.key, String(point.id), "solid", point.partNumber);
        });

      // Grupo 2: dispositivos posicionados pero sin switch. Cuando no hay
      // filtro (vista completa de Camino C) incluimos todos; cuando hay
      // filtro respetamos la seleccion.
      const noSwitchKeys = hasFilter
        ? selectedPartNumbers
        : Object.keys(seg.partNumberNoSwitch);
      const noSwitchPoints = collectGroupedEntries(noSwitchKeys, seg.partNumberNoSwitch)
        .filter(
          (pt) =>
            matchesSelectedSegment(pt.segmentLabel) &&
            pt.canNavigate &&
            pt.x !== null &&
            pt.y !== null
        );
      if (noSwitchPoints.length > 0) {
        noSwitchPoints.forEach((pt) => {
          const x = ((pt.x as number) / seg.width) * W;
          const y = ((pt.y as number) / seg.height) * H;
          if (allowAnimatedMarkers && !USE_COLORED_TEARDROPS) {
            drawMarkerPulse(ctx, x, y, R, timeMs);
          }
          // Mismo render que Grupo 1; si no hay icono, el fallback pinta
          // circulo punteado para seguir distinguiendo "sin switch".
          drawDeviceMarker(x, y, pt.key, String(pt.id), "dashed", pt.partNumber);
        });
      }

      if (devicePreview) {
        const x = (devicePreview.device.x / seg.width) * W;
        const y = (devicePreview.device.y / seg.height) * H;
        ctx.setLineDash([]);
        if (allowAnimatedMarkers) {
          drawMarkerPulse(ctx, x, y, R + 2 * RENDER_SCALE, timeMs);
        }
        ctx.beginPath();
        ctx.arc(x, y, R + 4 * RENDER_SCALE, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 198, 92, 0.96)";
        ctx.lineWidth = 2 * RENDER_SCALE;
        ctx.stroke();
      }

      if (allowAnimatedMarkers) {
        frameId = requestAnimationFrame(draw);
      }
    };

    if (allowAnimatedMarkers) {
      frameId = requestAnimationFrame(draw);
    } else {
      draw(performance.now());
    }

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [
    devicePreview,
    deviceProgressByKey,
    getReadyIconImage,
    iconImageVersion,
    iconUrlByDeviceKey,
    interactiveDevices,
    isMobileViewport,
    markerColorByDeviceKey,
    markerLayoutByKey,
    pdfReady,
    planRaster?.height,
    planRaster?.width,
    segmentation,
    selectedLabel,
    selectedPartNumberSet,
    selectedPartNumbers
  ]);

  // Sync selectedLabel y selectedPartNumber cuando cambia la segmentación
  useEffect(() => {
    if (!segmentation) {
      setSelectedLabel("");
      setSelectedPartNumbers([]);
      return;
    }
    setSelectedLabel((cur) => (cur && segmentation.labels.includes(cur) ? cur : ""));
    setSelectedPartNumbers([]);
  }, [segmentation]);

  // Resetear part number al cambiar de segmento
  useEffect(() => {
    setSelectedPartNumbers([]);
  }, [selectedLabel]);

  function navigateToPoint(stageX: number, stageY: number) {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const TARGET_SCALE = isMobileViewport ? 3.2 : 4;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    setNavigating(true);
    applyTransform({
      s: TARGET_SCALE,
      x: vw / 2 - stageX * TARGET_SCALE,
      y: vh / 2 - stageY * TARGET_SCALE,
    }, 280);
    setTimeout(() => setNavigating(false), 550);
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    pointerMovedRef.current = false;
    dragging.current = true;
    dragOrigin.current = { mx: e.clientX, my: e.clientY, tx: xformRef.current.x, ty: xformRef.current.y };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging.current) {
      return;
    }
    const dx = e.clientX - dragOrigin.current.mx;
    const dy = e.clientY - dragOrigin.current.my;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      pointerMovedRef.current = true;
    }
    scheduleXform({
      s: xformRef.current.s,
      x: dragOrigin.current.tx + dx,
      y: dragOrigin.current.ty + dy,
    });
  }

  function handleMouseUp(e: React.MouseEvent<HTMLDivElement>) {
    const wasMoved = pointerMovedRef.current;
    dragging.current = false;
    pointerMovedRef.current = false;
    if (!wasMoved) {
      inspectDeviceAtClientPoint(e.clientX, e.clientY);
    }
  }

  function resetPointerDrag() {
    dragging.current = false;
    pointerMovedRef.current = false;
  }

  function getTouchPoint(touch: TouchPointLike) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    };
  }

  function distanceBetweenTouches(touchA: TouchPointLike, touchB: TouchPointLike) {
    const pointA = getTouchPoint(touchA);
    const pointB = getTouchPoint(touchB);
    return Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
  }

  function midpointBetweenTouches(touchA: TouchPointLike, touchB: TouchPointLike) {
    const pointA = getTouchPoint(touchA);
    const pointB = getTouchPoint(touchB);
    return {
      x: (pointA.x + pointB.x) / 2,
      y: (pointA.y + pointB.y) / 2,
    };
  }

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 1) {
      e.preventDefault();
      const touchPoint = getTouchPoint(e.touches[0]);
      gestureRef.current = {
        mode: "pan",
        startDistance: 0,
        startMidpointX: 0,
        startMidpointY: 0,
        startTouchX: touchPoint.x,
        startTouchY: touchPoint.y,
        startXform: xformRef.current,
        moved: false,
      };
      return;
    }

    if (e.touches.length >= 2) {
      e.preventDefault();
      const [touchA, touchB] = [e.touches[0], e.touches[1]];
      const midpoint = midpointBetweenTouches(touchA, touchB);
      gestureRef.current = {
        mode: "pinch",
        startDistance: Math.max(distanceBetweenTouches(touchA, touchB), MIN_PINCH_DISTANCE),
        startMidpointX: midpoint.x,
        startMidpointY: midpoint.y,
        startTouchX: midpoint.x,
        startTouchY: midpoint.y,
        startXform: xformRef.current,
        moved: false,
      };
    }
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (!viewportRef.current) {
      return;
    }

    if (gestureRef.current.mode === "pan" && e.touches.length === 1) {
      e.preventDefault();
      const touchPoint = getTouchPoint(e.touches[0]);
      const dx = touchPoint.x - gestureRef.current.startTouchX;
      const dy = touchPoint.y - gestureRef.current.startTouchY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        gestureRef.current.moved = true;
      }
      scheduleXform({
        s: gestureRef.current.startXform.s,
        x: gestureRef.current.startXform.x + dx,
        y: gestureRef.current.startXform.y + dy,
      });
      return;
    }

    if (e.touches.length >= 2) {
      e.preventDefault();
      const [touchA, touchB] = [e.touches[0], e.touches[1]];
      const distance = distanceBetweenTouches(touchA, touchB);
      if (!Number.isFinite(distance) || distance < 1) {
        return;
      }
      const midpoint = midpointBetweenTouches(touchA, touchB);
      const start = gestureRef.current;
      const maxScale = getMaxScale();
      const minScale = getMinScale();
      if (Math.abs(distance - start.startDistance) > 4) {
        gestureRef.current.moved = true;
      }
      const newS = clamp(
        start.startXform.s * (distance / Math.max(start.startDistance, MIN_PINCH_DISTANCE)),
        minScale,
        maxScale
      );
      const stageX = (start.startMidpointX - start.startXform.x) / start.startXform.s;
      const stageY = (start.startMidpointY - start.startXform.y) / start.startXform.s;
      scheduleXform({
        s: newS,
        x: midpoint.x - stageX * newS,
        y: midpoint.y - stageY * newS,
      });
    }
  }

  function handleTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    const finishingPanTap =
      gestureRef.current.mode === "pan" &&
      !gestureRef.current.moved &&
      e.touches.length === 0 &&
      e.changedTouches.length > 0;

    if (e.touches.length === 1) {
      const touchPoint = getTouchPoint(e.touches[0]);
      gestureRef.current = {
        mode: "pan",
        startDistance: 0,
        startMidpointX: 0,
        startMidpointY: 0,
        startTouchX: touchPoint.x,
        startTouchY: touchPoint.y,
        startXform: xformRef.current,
        moved: false,
      };
      return;
    }

    if (finishingPanTap) {
      const touch = e.changedTouches[0];
      inspectDeviceAtClientPoint(touch.clientX, touch.clientY);
    }

    gestureRef.current = {
      mode: "idle",
      startDistance: 0,
      startMidpointX: 0,
      startMidpointY: 0,
      startTouchX: 0,
      startTouchY: 0,
      startXform: xformRef.current,
      moved: false,
    };
  }

  function findDeviceNearStagePoint(stageX: number, stageY: number) {
    const touchRadiusPx = isMobileViewport ? 32 : 24;
    const threshold = touchRadiusPx / Math.max(xformRef.current.s, 0.35);
    let best: InteractiveDevice | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    interactiveDevices.forEach((device) => {
      const dx = device.x - stageX;
      const dy = device.y - stageY;
      const distance = Math.hypot(dx, dy);
      if (distance <= threshold && distance < bestDistance) {
        best = device;
        bestDistance = distance;
      }
    });

    return best;
  }

  function openDevicePreview(device: InteractiveDevice, clientX: number, clientY: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    if (isMobileViewport) {
      setControlsExpanded(false);
    }
    setPendingProgressAction(null);

    const margin = 12;
    const cardWidth = 272;
    const preferredHeight = isMobileViewport ? 520 : 440;
    const relativeX = clientX - rect.left;
    const relativeY = clientY - rect.top;
    const maxHeight = clamp(rect.height - margin * 2, 220, preferredHeight);
    const spaceBelow = rect.height - relativeY - margin;
    const spaceAbove = relativeY - margin;
    const openBelow = spaceBelow >= Math.min(280, maxHeight * 0.65) || spaceBelow >= spaceAbove;
    const x = clamp(relativeX + 12, margin, Math.max(margin, rect.width - cardWidth - margin));
    const desiredY = openBelow ? relativeY + 12 : relativeY - maxHeight - 12;
    const y = clamp(desiredY, margin, Math.max(margin, rect.height - maxHeight - margin));

    setDevicePreview({
      device,
      maxHeight,
      x,
      y,
    });
  }

  function inspectDeviceAtClientPoint(clientX: number, clientY: number) {
    if (Date.now() < suppressInspectUntilRef.current) {
      return;
    }
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const currentXform = xformRef.current;
    const stageX = (clientX - rect.left - currentXform.x) / currentXform.s;
    const stageY = (clientY - rect.top - currentXform.y) / currentXform.s;
    const device = findDeviceNearStagePoint(stageX, stageY);

    if (!device) {
      setPendingProgressAction(null);
      setDevicePreview(null);
      return;
    }

    openDevicePreview(device, clientX, clientY);
  }

  function progressForDevice(deviceKey: string) {
    return deviceProgressByKey[deviceKey] ?? EMPTY_OPERATIONAL_PROGRESS;
  }

  function completedStepsFor(progress: OperationalDeviceProgress) {
    return [progress.cableRun, progress.installed, progress.switchConnected].filter(Boolean).length;
  }

  function commitProgress(deviceKey: string, nextProgress: OperationalDeviceProgress, message: string) {
    const previousProgress = progressForDevice(deviceKey);
    onChangeDeviceProgress(deviceKey, {
      ...nextProgress,
      updatedAt: Date.now(),
    });
    setUndoProgressAction({
      deviceKey,
      message,
      previousProgress,
    });
    setPendingProgressAction(null);
  }

  function toggleProgressStep(deviceKey: string, step: OperationalProgressStep, label: string) {
    const currentProgress = progressForDevice(deviceKey);
    const nextValue = !currentProgress[step];

    if (
      pendingProgressAction?.deviceKey === deviceKey &&
      pendingProgressAction.step === step &&
      pendingProgressAction.nextValue === nextValue
    ) {
      commitProgress(
        deviceKey,
        {
          ...currentProgress,
          [step]: nextValue,
        },
        nextValue
          ? t("segmentation.progress.saved", { step: label })
          : t("segmentation.progress.cleared", { step: label })
      );
      return;
    }

    setPendingProgressAction({
      deviceKey,
      nextValue,
      step,
    });
  }

  function undoLastProgressAction() {
    if (!undoProgressAction) {
      return;
    }
    onChangeDeviceProgress(undoProgressAction.deviceKey, undoProgressAction.previousProgress);
    setUndoProgressAction(null);
    setPendingProgressAction(null);
  }

  function handlePartNumberSelect(partNumber: string) {
    if (!partNumber) {
      return;
    }

    setSelectedPartNumbers((current) => {
      if (current.includes(partNumber) || current.length >= MAX_SELECTED_PART_NUMBERS) {
        return current;
      }
      return [...current, partNumber];
    });
  }

  function removeSelectedPartNumber(partNumber: string) {
    setSelectedPartNumbers((current) =>
      current.filter((value) => value !== partNumber)
    );
  }

  const previewProgress = devicePreview
    ? progressForDevice(devicePreview.device.key)
    : EMPTY_OPERATIONAL_PROGRESS;
  const previewCompletedSteps = completedStepsFor(previewProgress);

  if (!open || !plan) {
    return null;
  }

  return (
    <div
      className={`pdf-modal${isMobileViewport ? " pdf-modal--compact" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={t("segmentation.aria")}
      style={{ gridTemplateRows: "auto minmax(0,1fr)" }}
    >
      <div className="pdf-modal__header">
        <div>
          <p className="eyebrow">{t("segmentation.eyebrow")}</p>
          <h2>{plan.title}</h2>
          <p
            style={{
              margin: "0.18rem 0 0",
              color: "rgba(255,255,255,0.56)",
              fontSize: "0.78rem",
              lineHeight: 1.35,
            }}
          >
            {iconSourceLabel} · Build {buildLabel}
          </p>
          {iconDebugLabel && (
            <p
              style={{
                margin: "0.14rem 0 0",
                color: "rgba(255,255,255,0.44)",
                fontSize: "0.72rem",
                lineHeight: 1.35,
              }}
            >
              {iconDebugLabel}
            </p>
          )}
        </div>
        <div className="pdf-modal__actions">
          {!isMobileViewport && (
            <>
              <button
                type="button"
                className="secondary-action"
                onClick={() => stepZoom(1 / 1.35)}
                aria-label={t("common.zoomOut")}
                disabled={!canInteractWithPlan}
              >
                -
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() => stepZoom(1.35)}
                aria-label={t("common.zoomIn")}
                disabled={!canInteractWithPlan}
              >
                +
              </button>
            </>
          )}
          {!isMobileViewport && (
            <button type="button" className="secondary-action" onClick={fitToViewport}>
              {t("segmentation.fitView")}
            </button>
          )}
          <button type="button" className="primary-action" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>

      <div
        className={`segmentation-modal__workspace${
          isMobileViewport ? " segmentation-modal__workspace--mobile" : ""
        }`}
      >
        <div
          ref={viewportRef}
          className="pdf-modal__body segmentation-modal__viewport"
          style={{
            overflow: "hidden",
            position: "relative",
            padding: 0,
            touchAction: "none",
          }}
        >
          {!pdfReady && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#888",
              fontSize: "0.95rem",
            }}
          >
              {t("segmentation.loadingPlan")}
            </div>
          )}

          {isMobileViewport && (
            <div className="segmentation-modal__floating-tools">
              <button
                type="button"
                className="secondary-action"
                onClick={() => stepZoom(1 / 1.35)}
                aria-label={t("common.zoomOut")}
                disabled={!canInteractWithPlan}
              >
                -
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() => stepZoom(1.35)}
                aria-label={t("common.zoomIn")}
                disabled={!canInteractWithPlan}
              >
                +
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={fitToViewport}
                disabled={!canInteractWithPlan}
              >
                {t("segmentation.fit")}
              </button>
              {segmentation && (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => setControlsExpanded((current) => !current)}
                >
                  {controlsExpanded ? t("segmentation.widePlan") : t("segmentation.controls")}
                </button>
              )}
            </div>
          )}

          <TransformWrapper
            ref={transformRef}
            minScale={currentMinScale}
            maxScale={currentMaxScale}
            limitToBounds={false}
            centerZoomedOut
            smooth={false}
            alignmentAnimation={{ disabled: true }}
            velocityAnimation={{ disabled: true }}
            pinch={{ disabled: false, step: 0.9 }}
            wheel={{ disabled: false, step: 0.14, touchPadDisabled: false }}
            doubleClick={{ disabled: true }}
            panning={{
              disabled: !canInteractWithPlan,
              velocityDisabled: true,
              allowLeftClickPan: !isMobileViewport,
              allowMiddleClickPan: false,
              allowRightClickPan: false,
            }}
            onInit={() => setIsTransformReady(true)}
            onPanningStart={() => setIsTransformInteracting(true)}
            onPanning={() => markTransformInteraction()}
            onPanningStop={() => setIsTransformInteracting(false)}
            onPinchingStart={() => {
              setIsTransformInteracting(true);
              markTransformInteraction();
            }}
            onPinching={() => markTransformInteraction()}
            onPinchingStop={() => setIsTransformInteracting(false)}
            onZoom={() => markTransformInteraction()}
            onTransformed={(_, state) => {
              scheduleXform({
                s: state.scale,
                x: state.positionX,
                y: state.positionY,
              });
            }}
          >
            <TransformComponent
              wrapperStyle={{
                width: "100%",
                height: "100%",
                touchAction: "none",
                cursor: isMobileViewport ? "default" : isTransformInteracting ? "grabbing" : "grab",
              }}
              contentStyle={{
                width: `${plan.width}px`,
                height: `${plan.height}px`,
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: plan.width,
                  height: plan.height,
                  willChange: navigating ? "transform" : undefined,
                }}
                onClick={(e) => {
                  if (!canInteractWithPlan) {
                    return;
                  }
                  inspectDeviceAtClientPoint(e.clientX, e.clientY);
                }}
              >
                {planRaster && (
                  <img
                    src={planRaster.url}
                    alt=""
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
                  />
                )}
                {focusRaster && (
                  <img
                    src={focusRaster.url}
                    alt=""
                    style={{
                      position: "absolute",
                      left: focusRaster.planX,
                      top: focusRaster.planY,
                      width: focusRaster.planWidth,
                      height: focusRaster.planHeight,
                      display: "block",
                      pointerEvents: "none",
                    }}
                  />
                )}
                <canvas
                  ref={overlayCanvasRef}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    display: "block",
                    pointerEvents: "none",
                  }}
                />
                <canvas
                  ref={partNumCanvasRef}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    display: "block",
                    pointerEvents: "none",
                  }}
                />
              </div>
            </TransformComponent>
          </TransformWrapper>

          {devicePreview && (
            <div
              className={`segmentation-device-preview${
                isMobileViewport ? " segmentation-device-preview--sheet" : ""
              }`}
              style={{
                left: isMobileViewport ? undefined : devicePreview.x,
                maxHeight: isMobileViewport ? undefined : devicePreview.maxHeight,
                top: isMobileViewport ? undefined : devicePreview.y,
              }}
            >
              <button
                type="button"
                className="segmentation-device-preview__close"
                onClick={() => {
                  setPendingProgressAction(null);
                  setDevicePreview(null);
                }}
                aria-label={t("segmentation.closeDevicePreview", { id: devicePreview.device.id })}
              >
                ×
              </button>
              <div className="segmentation-device-preview__top">
                {devicePreview.device.visualChoices.length > 1 ? (
                  <div className="segmentation-visual-choice-strip segmentation-visual-choice-strip--compact">
                    {devicePreview.device.visualChoices.map((choice) => (
                      <div key={choice.iconDevice} className="segmentation-visual-choice">
                        <div className="segmentation-visual-choice__thumb">
                          <img src={choice.iconUrl} alt={choice.iconDevice} />
                        </div>
                        <span className="segmentation-visual-choice__label">
                          {choice.shortLabel}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="segmentation-device-preview__icon">
                    {devicePreview.device.iconUrl ? (
                      <img
                        src={devicePreview.device.iconUrl}
                        alt={devicePreview.device.iconDevice}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                          padding: "0.28rem",
                        }}
                      />
                    ) : (
                      <span>{t("common.noIcon")}</span>
                    )}
                  </div>
                )}
                <div className="segmentation-device-preview__copy">
                  <span className="segmentation-device-preview__eyebrow">
                    ID {devicePreview.device.id}
                  </span>
                  <strong>{devicePreview.device.partNumber}</strong>
                  <span>{devicePreview.device.iconDevice}</span>
                  {devicePreview.device.ambiguityHint && (
                    <span className="segmentation-device-preview__hint">
                      {devicePreview.device.ambiguityHint}
                    </span>
                  )}
                </div>
              </div>
              <div className="segmentation-device-preview__meta">
                <span>
                  <strong>{t("segmentation.switch")}:</strong> {devicePreview.device.switchName}
                </span>
                {!devicePreview.device.segmentLabel && devicePreview.device.suggestedSwitchName && (
                  <span>
                    <strong>{t("segmentation.suggestedSwitch")}:</strong> {devicePreview.device.suggestedSwitchName}
                  </span>
                )}
                {devicePreview.device.segmentLabel && (
                  <span>
                    <strong>{t("segmentation.segment")}:</strong> {devicePreview.device.segmentLabel}
                  </span>
                )}
                {!devicePreview.device.segmentLabel && devicePreview.device.suggestedSegmentLabel && (
                  <span>
                    <strong>{t("segmentation.suggestedSegment")}:</strong> {devicePreview.device.suggestedSegmentLabel}
                  </span>
                )}
                <span>
                  <strong>{t("segmentation.name")}:</strong> {devicePreview.device.name}
                </span>
                {devicePreview.device.mountHeightFt !== null && (
                  <span>
                    <strong>{t("segmentation.height")}:</strong> {devicePreview.device.mountHeightFt} ft
                  </span>
                )}
                {devicePreview.device.mountHeightRuleText && (
                  <span>
                    <strong>{t("segmentation.heightRule")}:</strong> {devicePreview.device.mountHeightRuleText}
                  </span>
                )}
                {devicePreview.device.mountHeightNeedsFieldValidation && (
                  <span className="segmentation-device-preview__hint">
                    {t("task.warning.validateHeight")}
                  </span>
                )}
              </div>
              <div className="segmentation-device-progress">
                <div className="segmentation-device-progress__header">
                  <div>
                    <span className="segmentation-device-progress__eyebrow">
                      {t("segmentation.progress.title")}
                    </span>
                    <strong>
                      {previewCompletedSteps}/3 {t("segmentation.progress.stepsCompleted")}
                    </strong>
                  </div>
                  <span className="segmentation-device-progress__status">
                    {previewProgress.updatedAt
                      ? t("segmentation.progress.updatedAt", {
                          time: new Date(previewProgress.updatedAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          }),
                        })
                      : t("segmentation.progress.noProgress")}
                  </span>
                </div>
                <div className="segmentation-device-progress__actions">
                  {progressStepDefinitions.map((definition) => {
                    const currentValue = previewProgress[definition.key];
                    const isConfirming =
                      pendingProgressAction?.deviceKey === devicePreview.device.key &&
                      pendingProgressAction.step === definition.key;
                    const nextValue = isConfirming ? pendingProgressAction.nextValue : !currentValue;
                    return (
                      <button
                        key={definition.key}
                        type="button"
                        className={`segmentation-progress-action ${definition.accentClass}${
                          currentValue ? " segmentation-progress-action--done" : ""
                        }${isConfirming ? " segmentation-progress-action--confirm" : ""}`}
                        disabled={!projectProgressScope}
                        onClick={() =>
                          toggleProgressStep(
                            devicePreview.device.key,
                            definition.key,
                            definition.label
                          )
                        }
                      >
                        <span className="segmentation-progress-action__swatch" aria-hidden="true" />
                        <span className="segmentation-progress-action__eyebrow">
                          {isConfirming
                            ? nextValue
                              ? t("segmentation.progress.confirmShort")
                              : t("segmentation.progress.removeShort")
                            : currentValue
                              ? t("segmentation.progress.marked")
                              : t("segmentation.progress.pending")}
                        </span>
                        <strong>{definition.compactLabel}</strong>
                        <span className="segmentation-progress-action__hint">
                          {isConfirming
                            ? t("segmentation.progress.confirmHint")
                            : currentValue
                              ? t("segmentation.progress.clearHint")
                              : t("segmentation.progress.markHint")}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {pendingProgressAction?.deviceKey === devicePreview.device.key && (
                  <p className="segmentation-device-progress__confirm-note">
                    {t("segmentation.progress.confirmNote")}
                  </p>
                )}
              </div>
            </div>
          )}

          {undoProgressAction && (
            <div className="segmentation-progress-toast" role="status" aria-live="polite">
              <span>{undoProgressAction.message}</span>
              <button type="button" onClick={undoLastProgressAction}>
                {t("segmentation.progress.undo")}
              </button>
            </div>
          )}
        </div>

        {segmentation && (
          <div
            className={`segmentation-controls${
              isMobileViewport ? " segmentation-controls--mobile" : ""
            }${controlsExpanded ? " segmentation-controls--open" : " segmentation-controls--collapsed"}${
              isMobileViewport && devicePreview ? " segmentation-controls--hidden" : ""
            }`}
          >
            <div className="segmentation-controls__summary">
              <div className="segmentation-controls__summary-copy">
                <span className="segmentation-controls__summary-label">
                  {mobileSummary.label}
                </span>
                <strong>{mobileSummary.meta}</strong>
                {projectProgressScope && progressSummary.totalDevices > 0 && (
                  <span className="segmentation-controls__summary-progress">
                    {t("segmentation.progress.overall")}: {progressSummary.overallPercent}% · {t("segmentation.progress.cable")}: {progressSummary.cablePercent}% · {t("segmentation.progress.installed")}: {progressSummary.installedPercent}% · {t("segmentation.progress.switch")}: {progressSummary.switchPercent}%
                  </span>
                )}
              </div>
              {!isMobileViewport && (
                <button
                  type="button"
                  className="segment-toggle-pill"
                  onClick={() => setControlsExpanded((current) => !current)}
                >
                  {controlsExpanded ? t("common.hide") : t("common.openPanel")}
                </button>
              )}
              {isMobileViewport && (
                <button
                  type="button"
                  className="segment-toggle-pill"
                  onClick={() => setControlsExpanded((current) => !current)}
                >
                  {controlsExpanded ? t("common.hide") : t("common.openPanel")}
                </button>
              )}
            </div>

            <div className="segmentation-controls__body">
              {projectProgressScope && progressSummary.totalDevices > 0 && (
                <div className="segmentation-progress-summary">
                  <div className="segmentation-progress-summary__top">
                    <div>
                      <span className="segmentation-progress-summary__eyebrow">
                        {t("segmentation.progress.title")}
                      </span>
                      <strong>{progressSummary.overallPercent}%</strong>
                    </div>
                    <span className="segmentation-progress-summary__scope">
                      {projectProgressStatusLabel}
                    </span>
                  </div>
                  <div className="segmentation-progress-summary__legend">
                    <span className="segmentation-progress-summary__legend-label">
                      {t("segmentation.onPlan")}
                    </span>
                    {progressLegendDefinitions.map((definition) => (
                      <span
                        key={definition.key}
                        className={`segmentation-progress-summary__legend-item ${definition.accentClass}`}
                      >
                        <span className="segmentation-progress-summary__legend-dot" />
                        {definition.label}
                      </span>
                    ))}
                  </div>
                  <div className="segmentation-progress-summary__grid">
                    <div className="segmentation-progress-summary__card segmentation-progress-summary__card--cable">
                      <span>{t("segmentation.progress.cable")}</span>
                      <strong>{progressSummary.cablePercent}%</strong>
                      <small>
                        {progressSummary.cableCompletedUnits}/{progressSummary.cableExpectedUnits} {t("common.cablePlural")}
                      </small>
                    </div>
                    <div className="segmentation-progress-summary__card segmentation-progress-summary__card--installed">
                      <span>{t("segmentation.progress.installed")}</span>
                      <strong>{progressSummary.installedPercent}%</strong>
                      <small>
                        {progressSummary.installedCount}/{progressSummary.totalDevices} {t("common.devicePlural")}
                      </small>
                    </div>
                    <div className="segmentation-progress-summary__card segmentation-progress-summary__card--switch">
                      <span>{t("segmentation.progress.switch")}</span>
                      <strong>{progressSummary.switchPercent}%</strong>
                      <small>
                        {progressSummary.switchConnectedCount}/{progressSummary.totalDevices} {t("common.devicePlural")}
                      </small>
                    </div>
                  </div>
                  <div className="segmentation-progress-summary__status-grid">
                    <div className="segmentation-progress-summary__status-card segmentation-progress-summary__status-card--complete">
                      <span>{t("segmentation.progress.complete")}</span>
                      <strong>{progressSummary.completeCount}</strong>
                      <small>
                        {t("segmentation.progress.ofTotalDevices", {
                          count: progressSummary.completeCount,
                          total: progressSummary.totalDevices,
                        })}
                      </small>
                    </div>
                    <div className="segmentation-progress-summary__status-card segmentation-progress-summary__status-card--remaining">
                      <span>{t("segmentation.progress.remaining")}</span>
                      <strong>{progressSummary.remainingCount}</strong>
                      <small>{t("segmentation.progress.remainingHint")}</small>
                    </div>
                    <div className="segmentation-progress-summary__status-card segmentation-progress-summary__status-card--partial">
                      <span>{t("segmentation.progress.partial")}</span>
                      <strong>{progressSummary.partialCount}</strong>
                      <small>{t("segmentation.progress.partialHint")}</small>
                    </div>
                    <div className="segmentation-progress-summary__status-card segmentation-progress-summary__status-card--pending">
                      <span>{t("segmentation.progress.notStarted")}</span>
                      <strong>{progressSummary.notStartedCount}</strong>
                      <small>{t("segmentation.progress.notStartedHint")}</small>
                    </div>
                  </div>
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  padding: "0.55rem 1rem 0.4rem",
                  overflowX: "auto",
                  scrollbarWidth: "none",
                  alignItems: "center",
                }}
              >
                <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", fontWeight: 700, flexShrink: 0, letterSpacing: "0.04em", textTransform: "uppercase" }}>{t("segmentation.segment")}</span>
                {(() => {
                  const segmented = segmentation.totals.segmentedPoints;
                  const noSwitch = segmentation.missingSwitchDevices.length;
                  const noPos = groupedEntryCount(segmentation.partNumberUnpositioned);
                  const total = segmented + noSwitch + noPos;
                  return (
                    <span style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.38)", fontWeight: 500, flexShrink: 0, marginLeft: "0.25rem" }}>
                      {t("segmentation.summary.devices", {
                        noPosition: noPos || undefined,
                        noSwitch: noSwitch || undefined,
                        segmented,
                        total,
                      })}
                    </span>
                  );
                })()}
                <button
                  type="button"
                  className={`segment-toggle-pill${!selectedLabel ? " segment-toggle-pill--active" : ""}`}
                  style={{ flexShrink: 0 }}
                  onClick={() => setSelectedLabel("")}
                >
                  {t("segmentation.all")}
                </button>
                {segmentation.segments.map((segment) => {
                  const li = segmentation.labels.indexOf(segment.label);
                  return (
                    <button
                      key={segment.label}
                      type="button"
                      className={`segment-toggle-pill${selectedLabel === segment.label ? " segment-toggle-pill--active" : ""}`}
                      style={{ flexShrink: 0 }}
                      onClick={() =>
                        setSelectedLabel((cur) => (cur === segment.label ? "" : segment.label))
                      }
                    >
                      <span
                        className="segment-toggle-pill__dot"
                        style={{ background: colorFor(li, 0.85) }}
                      />
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.1rem" }}>
                        <span>{segment.label}</span>
                        <span style={{ fontSize: "0.7rem", opacity: 0.8, fontWeight: 500, lineHeight: 1 }}>
                          {segment.totalCables} {segment.totalCables === 1 ? t("common.cableSingular") : t("common.cablePlural")}
                        </span>
                        {segment.suggestedCables > 0 && (
                          <span style={{ fontSize: "0.64rem", opacity: 0.62, fontWeight: 500, lineHeight: 1 }}>
                            {t("segmentation.includesSuggestedCables", { count: segment.suggestedCables })}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              {selectedLabel && (() => {
                const seg = segmentation.segments.find((s) => s.label === selectedLabel);
                if (!seg) return null;
                return (
                  <div
                    style={{
                      display: "flex",
                      gap: "1.5rem",
                      padding: "0.3rem 1rem",
                      alignItems: "center",
                      borderTop: "1px solid rgba(255,255,255,0.07)",
                      background: "rgba(255,255,255,0.04)",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.9)", fontWeight: 700 }}>
                      {seg.label}
                    </span>
                    <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>
                      {seg.deviceCount} {seg.deviceCount === 1 ? t("common.deviceSingular") : t("common.devicePlural")}
                    </span>
                    <span style={{ fontSize: "0.75rem", color: "rgba(120,200,255,0.85)", fontWeight: 700 }}>
                      {seg.totalCables} {seg.totalCables === 1 ? t("common.cableSingular") : t("common.cablePlural")} CAT5
                    </span>
                    {seg.suggestedCables > 0 && (
                      <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>
                        {t("segmentation.cableBreakdown", {
                          confirmed: seg.confirmedCables,
                          suggested: seg.suggestedCables,
                        })}
                      </span>
                    )}
                    {seg.switches.length > 0 && (
                      <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.38)", fontWeight: 400 }}>
                        {seg.switches.join(" · ")}
                      </span>
                    )}
                    {selectedSegmentProgressSummary && (
                      <>
                        <span className="segmentation-segment-progress-pill segmentation-segment-progress-pill--complete">
                          <strong>
                            {selectedSegmentProgressSummary.completeCount}/
                            {selectedSegmentProgressSummary.totalDevices}
                          </strong>
                          <small>{t("segmentation.progress.complete")}</small>
                        </span>
                        <span className="segmentation-segment-progress-pill segmentation-segment-progress-pill--remaining">
                          <strong>{selectedSegmentProgressSummary.remainingCount}</strong>
                          <small>{t("segmentation.progress.remaining")}</small>
                        </span>
                        <span className="segmentation-segment-progress-pill segmentation-segment-progress-pill--partial">
                          <strong>{selectedSegmentProgressSummary.partialCount}</strong>
                          <small>{t("segmentation.progress.partial")}</small>
                        </span>
                        <span className="segmentation-segment-progress-pill segmentation-segment-progress-pill--pending">
                          <strong>{selectedSegmentProgressSummary.notStartedCount}</strong>
                          <small>{t("segmentation.progress.notStarted")}</small>
                        </span>
                      </>
                    )}
                  </div>
                );
              })()}

              <div
                style={{
                  display: "flex",
                  gap: "0.6rem",
                  padding: "0.4rem 1rem 0.55rem",
                  alignItems: "center",
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  flexWrap: "wrap",
                }}
              >
            <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", fontWeight: 700, flexShrink: 0, letterSpacing: "0.04em", textTransform: "uppercase" }}>{t("segmentation.partNumber")}</span>
            <select
              value=""
              onChange={(e) => handlePartNumberSelect(e.target.value)}
              disabled={selectedPartNumbers.length >= MAX_SELECTED_PART_NUMBERS}
              style={{
                background: "rgba(255,255,255,0.08)",
                border:
                  selectedPartNumbers.length >= MAX_SELECTED_PART_NUMBERS
                    ? "1px solid rgba(255,220,160,0.28)"
                    : "1px solid rgba(255,255,255,0.18)",
                borderRadius: 8,
                color: "white",
                padding: "0.35rem 0.7rem",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor:
                  selectedPartNumbers.length >= MAX_SELECTED_PART_NUMBERS
                    ? "not-allowed"
                    : "pointer",
                minWidth: 220,
                maxWidth: 380,
                opacity: selectedPartNumbers.length >= MAX_SELECTED_PART_NUMBERS ? 0.75 : 1,
              }}
            >
              <option value="" style={{ background: "#0a2744" }}>
                {selectedPartNumbers.length === 0
                  ? t("segmentation.selectPartNumber")
                  : selectedPartNumbers.length < MAX_SELECTED_PART_NUMBERS
                    ? t("segmentation.addPartNumber")
                    : t("segmentation.maxPartNumbers")}
              </option>
              {partNumberCounts.map(({ pn, count }) => (
                <option
                  key={pn}
                  value={pn}
                  style={{ background: "#0a2744" }}
                  disabled={selectedPartNumbers.includes(pn)}
                >
                  {pn} ({count} {count === 1 ? t("common.deviceSingular") : t("common.devicePlural")}{selectedLabel ? ` ${t("segmentation.inSegment", { label: selectedLabel })}` : ""})
                </option>
              ))}
            </select>
            {selectedPartNumbers.length > 0 && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.45rem",
                  flexWrap: "wrap",
                }}
              >
                {selectedPartNumbers.map((partNumber) => {
                  const count =
                    partNumberCounts.find(({ pn }) => pn === partNumber)?.count ??
                    segmentation?.partNumberTotals[partNumber] ??
                    0;
                  return (
                    <span
                      key={partNumber}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.4rem",
                        background: "rgba(255,255,255,0.09)",
                        border: "1px solid rgba(255,255,255,0.16)",
                        borderRadius: 999,
                        padding: "0.18rem 0.35rem 0.18rem 0.65rem",
                        color: "white",
                        fontSize: "0.76rem",
                        fontWeight: 700,
                      }}
                    >
                      <span>
                        {partNumber}
                        {count > 0 ? ` (${count})` : ""}
                      </span>
                      <button
                        type="button"
                        aria-label={`Quitar ${partNumber}`}
                        onClick={() => removeSelectedPartNumber(partNumber)}
                        style={{
                          background: "rgba(255,255,255,0.14)",
                          border: "1px solid rgba(255,255,255,0.18)",
                          borderRadius: 999,
                          color: "rgba(255,255,255,0.92)",
                          cursor: "pointer",
                          fontSize: "0.72rem",
                          fontWeight: 900,
                          lineHeight: 1,
                          padding: "0.1rem 0.42rem",
                        }}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
                <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", fontWeight: 600 }}>
                  {t("segmentation.selectedCount", { count: selectedPartNumbers.length, max: MAX_SELECTED_PART_NUMBERS })}
                </span>
              </div>
            )}
            {selectedPartVisuals.length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: "0.6rem",
                  flexWrap: "wrap",
                  width: "100%",
                }}
              >
                {selectedPartVisuals.map((item) => (
                  <div
                    key={item.partNumber}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.65rem",
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 12,
                      padding: "0.45rem 0.6rem",
                      minWidth: 240,
                      maxWidth: 420,
                    }}
                  >
                    <div
                      style={{
                        width: item.visualChoices.length > 1 ? 126 : 54,
                        minWidth: item.visualChoices.length > 1 ? 126 : 54,
                        height: item.visualChoices.length > 1 ? "auto" : 54,
                        borderRadius: 10,
                        background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(240,246,252,0.98))",
                        border: "1px solid rgba(110,150,190,0.24)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        flexShrink: 0,
                        padding: item.visualChoices.length > 1 ? "0.35rem" : 0,
                      }}
                    >
                      {item.visualChoices.length > 1 ? (
                        <div className="segmentation-visual-choice-strip">
                          {item.visualChoices.map((choice) => (
                            <div key={choice.iconDevice} className="segmentation-visual-choice">
                              <div className="segmentation-visual-choice__thumb">
                                <img src={choice.iconUrl} alt={choice.iconDevice} />
                              </div>
                              <span className="segmentation-visual-choice__label">
                                {choice.shortLabel}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : item.iconUrl ? (
                        <img
                          src={item.iconUrl}
                          alt={item.iconDevice}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            padding: "0.25rem",
                            background: "rgba(255,255,255,0.98)",
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            color: "rgba(55,85,115,0.72)",
                            fontSize: "0.62rem",
                            fontWeight: 700,
                            letterSpacing: "0.04em",
                            textTransform: "uppercase",
                            textAlign: "center",
                            padding: "0.3rem",
                            lineHeight: 1.2,
                          }}
                        >
                          {t("common.noIcon")}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.18rem", minWidth: 0 }}>
                      <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                        {t("segmentation.visualReference")}
                      </span>
                      <strong
                        style={{
                          color: "white",
                          fontSize: "0.82rem",
                          fontWeight: 700,
                          lineHeight: 1.2,
                          wordBreak: "break-word",
                        }}
                      >
                        {item.partNumber}
                      </strong>
                      <span
                        style={{
                          color: "rgba(255,255,255,0.72)",
                          fontSize: "0.74rem",
                          fontWeight: 500,
                          lineHeight: 1.2,
                          wordBreak: "break-word",
                        }}
                      >
                        {item.iconDevice}
                      </span>
                      {item.ambiguityHint && (
                        <span
                          style={{
                            color: "rgba(255,236,196,0.88)",
                            fontSize: "0.7rem",
                            lineHeight: 1.35,
                            wordBreak: "break-word",
                          }}
                        >
                          {item.ambiguityHint}
                        </span>
                      )}
                      {item.iconOptions.length > 1 && (
                        <span
                          style={{
                            color: "rgba(255,255,255,0.48)",
                            fontSize: "0.7rem",
                            lineHeight: 1.3,
                            wordBreak: "break-word",
                          }}
                        >
                          {t("segmentation.knownOptions", { options: item.iconOptions.join(" / ") })}
                        </span>
                      )}
                      {item.exactAvailability.length > 0 && (
                        <span
                          style={{
                            color: "rgba(255,255,255,0.48)",
                            fontSize: "0.68rem",
                            lineHeight: 1.35,
                            wordBreak: "break-word",
                          }}
                        >
                          {t("segmentation.activeZip", {
                            values: item.exactAvailability
                              .map((entry) => `${entry.label} ${entry.available ? t("segmentation.debugYes") : t("segmentation.debugNo")}`)
                              .join(" / "),
                          })}
                        </span>
                      )}
                      <span
                        style={{
                          color: "rgba(255,255,255,0.42)",
                          fontSize: "0.68rem",
                          lineHeight: 1.3,
                          wordBreak: "break-word",
                        }}
                        >
                        {t("segmentation.match", {
                          candidate: item.matchedIconCandidate || undefined,
                          hadRecordIcon: item.preferredHadIconUrl,
                          mode: item.matchMode,
                        })}
                      </span>
                      <span
                        style={{
                          color: "rgba(255,255,255,0.38)",
                          fontSize: "0.68rem",
                          lineHeight: 1.3,
                          wordBreak: "break-word",
                        }}
                        >
                        {t("segmentation.sourceIcons", { source: iconSourceLabel })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selectedPartSummary && (() => {
              const { noSwitchDevices, plotted, total, unpositionedDevices } = selectedPartSummary;
              return (
                <>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      background: "rgba(20,58,110,0.72)",
                      border: "1px solid rgba(255,255,255,0.22)",
                      borderRadius: 999,
                      padding: "0.3rem 0.75rem",
                      color: "white",
                      fontSize: "0.82rem",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        background: "rgba(255,255,255,0.9)",
                        color: "rgba(20,58,110,1)",
                        borderRadius: 999,
                        padding: "0 0.45rem",
                        height: "1.5rem",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.78rem",
                        fontWeight: 900,
                      }}
                    >
                      {plotted}
                    </span>
                    {selectedLabel ? t("segmentation.inSegment", { label: selectedLabel }) : t("segmentation.onPlan")}
                    {selectedPartNumbers.length > 1 && (
                      <span style={{ opacity: 0.8, fontSize: "0.75rem", fontWeight: 600 }}>
                        · {t("segmentation.partNumbersSelected", { count: selectedPartNumbers.length })}
                      </span>
                    )}
                    {total > 0 && (
                      <span style={{ opacity: 0.6, fontSize: "0.75rem", fontWeight: 600 }}>
                        / {total} {t("common.total")}
                      </span>
                    )}
                  </span>
                  {(() => {
                    return noSwitchDevices.length > 0 ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          background: "rgba(180,90,10,0.62)",
                          border: "1px solid rgba(255,180,80,0.4)",
                          borderRadius: 999,
                          padding: "0.3rem 0.6rem",
                          color: "rgba(255,220,160,1)",
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                        className="badge-alert-pulse"
                      >
                        ⚠ {t("common.noSwitch")}:
                        {noSwitchDevices.map((pt) => (
                          <button
                            key={pt.key}
                            type="button"
                            title={
                              pt.canNavigate && pt.x !== null && pt.y !== null
                                ? t("segmentation.goToId", { id: pt.id })
                                : t("segmentation.noCoordsOrMarker", { id: pt.id })
                            }
                            disabled={!pt.canNavigate || pt.x === null || pt.y === null}
                            onClick={() => {
                              if (pt.canNavigate && pt.x !== null && pt.y !== null) {
                                navigateToPoint(pt.x, pt.y);
                              }
                            }}
                            style={{
                              background: "rgba(255,255,255,0.18)",
                              border: "1px solid rgba(255,220,160,0.5)",
                              borderRadius: 999,
                              color:
                                pt.canNavigate && pt.x !== null && pt.y !== null
                                  ? "rgba(255,240,200,1)"
                                  : "rgba(255,240,200,0.55)",
                              cursor:
                                pt.canNavigate && pt.x !== null && pt.y !== null
                                  ? "pointer"
                                  : "not-allowed",
                              fontSize: "0.75rem",
                              fontWeight: 800,
                              opacity:
                                pt.canNavigate && pt.x !== null && pt.y !== null ? 1 : 0.7,
                              padding: "0.05rem 0.5rem",
                              lineHeight: 1.4,
                            }}
                          >
                            {pt.id}
                          </button>
                        ))}
                      </span>
                    ) : null;
                  })()}
                  {unpositionedDevices.length > 0 && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.35rem",
                        background: "rgba(160,30,30,0.62)",
                        border: "1px solid rgba(255,150,150,0.35)",
                        borderRadius: 999,
                        padding: "0.3rem 0.75rem",
                        color: "rgba(255,210,210,1)",
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      ✕ {t("common.noPosition")}:
                      {unpositionedDevices
                        .slice()
                        .sort((a, b) => a.id - b.id)
                        .map((device) => (
                          <button
                            key={device.key}
                            type="button"
                            title={
                              device.canNavigate && device.x !== null && device.y !== null
                                ? t("segmentation.goToId", { id: device.id })
                                : t("segmentation.cannotCenter", { id: device.id })
                            }
                            disabled={!device.canNavigate || device.x === null || device.y === null}
                            onClick={() => {
                              if (device.canNavigate && device.x !== null && device.y !== null) {
                                navigateToPoint(device.x, device.y);
                              }
                            }}
                            style={{
                              background: "rgba(255,255,255,0.18)",
                              border: "1px solid rgba(255,210,210,0.45)",
                              borderRadius: 999,
                              color:
                                device.canNavigate && device.x !== null && device.y !== null
                                  ? "rgba(255,240,240,1)"
                                  : "rgba(255,240,240,0.6)",
                              cursor:
                                device.canNavigate && device.x !== null && device.y !== null
                                  ? "pointer"
                                  : "not-allowed",
                              fontSize: "0.75rem",
                              fontWeight: 800,
                              opacity:
                                device.canNavigate && device.x !== null && device.y !== null
                                  ? 1
                                  : 0.72,
                              padding: "0.05rem 0.5rem",
                              lineHeight: 1.4,
                            }}
                          >
                            {device.id}
                          </button>
                        ))}
                    </span>
                  )}
                  <button
                    type="button"
                    className="segment-toggle-pill"
                    style={{ flexShrink: 0, opacity: 0.7 }}
                    onClick={() => setSelectedPartNumbers([])}
                  >
                    {t("segmentation.clear")}
                  </button>
                </>
              );
            })()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
