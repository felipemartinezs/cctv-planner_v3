import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { DeviceRecord, PlanData } from "../../types";
import { lookupIcon, normalizeIconKey } from "../../lib/icons";
import { getNamePatternKnowledge, getPartNumberKnowledge } from "../../lib/visual-knowledge";
import type { PlanSegmentation } from "../plan-segmentation";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const RENDER_SCALE = 2;
const MAX_SELECTED_PART_NUMBERS = 2;
const PART_MARKER_COLOR = "rgba(20, 58, 110, 0.88)";
const PART_MARKER_PULSE_MS = 1550;
const PTZ_PART_NUMBER = "CIP-QNP6250H";
const PTZ_OUTDOOR_RULE_KEY = "install.height.ptzOutdoor";
const PTZ_CEILING_ICON = "CIP-QNP6250H Ceiling";
const PTZ_PENDANT_ICON = "CIP-QNP6250H Pendant";
const PTZ_OUTDOOR_ICON = "CIP-QNP6250H Outdoor";
const POS_BNB_ICON = "BNB-SCB-1KIT";
const POS_PSA_ICON = "PSA-W4-BAXFA51";

interface PlanSegmentationModalProps {
  buildLabel: string;
  iconDebugLabel: string;
  open: boolean;
  iconSourceLabel: string;
  plan: PlanData | null;
  records: DeviceRecord[];
  rawIconMap: Map<string, string>;
  segmentation: PlanSegmentation | null;
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
  switchName: string;
  visualChoices: VisualChoice[];
  x: number;
  y: number;
}

interface DevicePreviewState {
  device: InteractiveDevice;
  x: number;
  y: number;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
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

export function PlanSegmentationModal({
  buildLabel,
  iconDebugLabel,
  open,
  iconSourceLabel,
  plan,
  records,
  rawIconMap,
  segmentation,
  onClose,
}: PlanSegmentationModalProps) {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const partNumCanvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfReady, setPdfReady] = useState(false);
  const [xform, setXform] = useState<Xform>({ x: 0, y: 0, s: 1 });
  const [selectedLabel, setSelectedLabel] = useState("");
  const [selectedPartNumbers, setSelectedPartNumbers] = useState<string[]>([]);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined"
      ? window.innerWidth <= 720 || window.innerHeight <= 520
      : false
  );
  const [controlsExpanded, setControlsExpanded] = useState(() =>
    typeof window !== "undefined"
      ? !(window.innerWidth <= 720 || window.innerHeight <= 520)
      : true
  );
  const [devicePreview, setDevicePreview] = useState<DevicePreviewState | null>(null);
  const dragging = useRef(false);
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
  const pointerMovedRef = useRef(false);
  const [navigating, setNavigating] = useState(false);

  function matchesSelectedSegment(segmentLabel: string) {
    return !selectedLabel || segmentLabel === selectedLabel;
  }

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

    Object.values(segmentation.partNumberNoSwitch)
      .flat()
      .filter((device) => matchesSelectedSegment(device.segmentLabel))
      .forEach((device) => bump(device.partNumber));

    Object.values(segmentation.partNumberUnpositioned)
      .flat()
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

    const noSwitchDevices = selectedPartNumbers
      .flatMap((partNumber) => segmentation.partNumberNoSwitch[partNumber] ?? [])
      .filter((device) => matchesSelectedSegment(device.segmentLabel))
      .slice()
      .sort((a, b) => a.id - b.id);

    const unpositionedDevices = selectedPartNumbers
      .flatMap((partNumber) => segmentation.partNumberUnpositioned[partNumber] ?? [])
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

  const selectedPartVisuals = useMemo(() => {
    return selectedPartNumbers.map((partNumber) => {
      const candidates = records.filter((record) => record.partNumber === partNumber);
      const contextualCandidates = candidates.filter((record) =>
        matchesSelectedSegment(record.switchSegment)
      );
      const recordsInScope = contextualCandidates.length > 0 ? contextualCandidates : candidates;
      const partKnowledge = getPartNumberKnowledge(partNumber);
      const preferred =
        recordsInScope.find((record) => record.iconUrl) ??
        recordsInScope.find((record) => record.iconDevice) ??
        recordsInScope[0] ??
        null;
      const scopedNamePatternChoices = recordsInScope.flatMap((record) => {
        const knowledge = getNamePatternKnowledge(record.name);
        return knowledge?.candidateIconDevices ?? [];
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
        partNumber === PTZ_PART_NUMBER || isPosAmbiguousPartNumber(partNumber)
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
            : visualChoices[0]?.iconDevice || matchedIconCandidate || preferred?.iconDevice || partNumber,
        iconOptions: partKnowledge?.iconDevices ?? [],
        iconUrl: visualChoices[0]?.iconUrl || matchedIconUrl || preferred?.iconUrl,
        matchedIconCandidate: matchedIconCandidate || "",
        matchMode,
        preferredHadIconUrl: Boolean(preferred?.iconUrl),
        partNumber,
        visualChoices,
      };
    });
  }, [rawIconMap, records, selectedLabel, selectedPartNumbers, t]);

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
        meta: `${selectedPartSummary.plotted}/${selectedPartSummary.total} · ${partLabel}`,
      };
    }

    const segmented = segmentation.totals.segmentedPoints;
    const noSwitch = Object.values(segmentation.partNumberNoSwitch).reduce(
      (sum, entries) => sum + entries.length,
      0
    );
    const noPos = Object.values(segmentation.partNumberUnpositioned).reduce(
      (sum, entries) => sum + entries.length,
      0
    );
    const total = segmented + noSwitch + noPos;

    return {
      label: selectedLabel || t("segmentation.all"),
      meta: `${segmented}/${total} ${t("common.devicePlural")}`,
    };
  }, [segmentation, selectedLabel, selectedPartNumbers, selectedPartSummary, t]);

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
        record.iconUrl ||
        lookupIcon(rawIconMap, record.partNumber) ||
        lookupIcon(rawIconMap, record.iconDevice) ||
        "";
      const nameKnowledge = getNamePatternKnowledge(record.name);
      const visualChoices =
        record.partNumber === PTZ_PART_NUMBER || isPosAmbiguousPartNumber(record.partNumber)
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

      devicesByKey.set(record.key, {
        ambiguityHint: getVisualAmbiguityHint(record.partNumber, visualChoices, t),
        iconDevice:
          visualChoices.length > 1
            ? record.partNumber === PTZ_PART_NUMBER
              ? `${t("segmentation.ptzInterior")} · ${visualChoices.map((choice) => choice.shortLabel).join(" / ")}`
              : `${t("segmentation.posAmbiguousTitle")} · ${visualChoices.map((choice) => choice.shortLabel).join(" / ")}`
            : visualChoices[0]?.iconDevice || record.iconDevice || record.partNumber,
        iconUrl: visualChoices[0]?.iconUrl || resolvedIconUrl,
        id: record.id,
        key: record.key,
        mountHeightFt: record.mountHeightFt,
        mountHeightNeedsFieldValidation: record.mountHeightNeedsFieldValidation,
        mountHeightRuleText: record.mountHeightRuleKey ? t(record.mountHeightRuleKey) : "",
        name: record.abbreviatedName || record.name,
        partNumber: record.partNumber,
        segmentLabel: record.switchSegment,
        switchName: record.switchName || record.hub || t("common.noSwitch"),
        visualChoices,
        x,
        y,
      });
    });

    return Array.from(devicesByKey.values());
  }, [plan, rawIconMap, records, t]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleResize = () => {
      setIsMobileViewport(window.innerWidth <= 720 || window.innerHeight <= 520);
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
    }
  }, [open]);

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

  // Render PDF to canvas at RENDER_SCALE resolution
  useEffect(() => {
    let live = true;
    setPdfReady(false);

    async function render() {
      if (!open || !plan || !pdfCanvasRef.current) {
        return;
      }
      const pdf = await getDocument(plan.blobUrl).promise;
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: RENDER_SCALE });
      const canvas = pdfCanvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      await pdf.destroy();
      if (live) {
        setPdfReady(true);
      }
    }

    render();
    return () => {
      live = false;
    };
  }, [open, plan]);

  // Fit the whole plan inside the viewport
  const fitToViewport = useCallback(() => {
    if (!viewportRef.current || !plan) {
      return;
    }
    const vw = viewportRef.current.clientWidth;
    const vh = viewportRef.current.clientHeight;
    const s = Math.min(vw / plan.width, vh / plan.height) * 0.97;
    setXform({
      s,
      x: (vw - plan.width * s) / 2,
      y: (vh - plan.height * s) / 2,
    });
  }, [plan]);

  useEffect(() => {
    if (pdfReady) {
      fitToViewport();
    }
  }, [pdfReady, fitToViewport]);

  // Draw segmentation overlay at the same pixel dimensions as the PDF canvas
  useEffect(() => {
    if (!pdfReady || !segmentation || !pdfCanvasRef.current || !overlayCanvasRef.current) {
      return;
    }
    const pdfCanvas = pdfCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    const ctx = overlay.getContext("2d");
    if (!ctx) {
      return;
    }

    overlay.width = pdfCanvas.width;
    overlay.height = pdfCanvas.height;

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

  }, [pdfReady, segmentation, selectedLabel]);

  // Dibujar capa de part numbers — círculos por dispositivo
  useEffect(() => {
    if (!pdfReady || !pdfCanvasRef.current || !partNumCanvasRef.current) {
      return;
    }
    const pdfCanvas = pdfCanvasRef.current;
    const canvas = partNumCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    canvas.width = pdfCanvas.width;
    canvas.height = pdfCanvas.height;
    let frameId = 0;

    const draw = (timeMs: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (selectedPartNumbers.length === 0 || !segmentation) {
        return;
      }

      const seg = segmentation;
      const W = canvas.width;
      const H = canvas.height;
      const R = 11 * RENDER_SCALE;
      const FONT_SIZE = 10 * RENDER_SCALE;

      // Grupo 1: dispositivos con switch asignado — círculo azul sólido
      ctx.setLineDash([]);
      seg.points
        .filter(
          (p) =>
            selectedPartNumberSet.has(p.partNumber) &&
            (!selectedLabel || p.segmentLabel === selectedLabel) &&
            p.x >= 0 &&
            p.y >= 0
        )
        .forEach((point) => {
          const x = (point.x / seg.width) * W;
          const y = (point.y / seg.height) * H;
          drawMarkerPulse(ctx, x, y, R, timeMs);
          ctx.beginPath();
          ctx.arc(x, y, R, 0, Math.PI * 2);
          ctx.strokeStyle = PART_MARKER_COLOR;
          ctx.lineWidth = 3 * RENDER_SCALE;
          ctx.stroke();
          ctx.font = `700 ${FONT_SIZE}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = PART_MARKER_COLOR;
          ctx.fillText(String(point.id), x, y);
        });

      // Grupo 2: dispositivos posicionados pero sin switch — círculo naranja punteado
      const noSwitchPoints = selectedPartNumbers
        .flatMap((partNumber) => seg.partNumberNoSwitch[partNumber] ?? [])
        .filter(
          (pt) =>
            matchesSelectedSegment(pt.segmentLabel) &&
            pt.canNavigate &&
            pt.x !== null &&
            pt.y !== null
        );
      if (noSwitchPoints.length > 0) {
        ctx.setLineDash([5 * RENDER_SCALE, 4 * RENDER_SCALE]);
        ctx.lineWidth = 3 * RENDER_SCALE;
        noSwitchPoints.forEach((pt) => {
          const x = ((pt.x as number) / seg.width) * W;
          const y = ((pt.y as number) / seg.height) * H;
          drawMarkerPulse(ctx, x, y, R, timeMs);
          ctx.beginPath();
          ctx.arc(x, y, R, 0, Math.PI * 2);
          ctx.strokeStyle = PART_MARKER_COLOR;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = `700 ${FONT_SIZE}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = PART_MARKER_COLOR;
          ctx.fillText(String(pt.id), x, y);
          ctx.setLineDash([5 * RENDER_SCALE, 4 * RENDER_SCALE]);
        });
        ctx.setLineDash([]);
      }

      if (devicePreview) {
        const x = (devicePreview.device.x / seg.width) * W;
        const y = (devicePreview.device.y / seg.height) * H;
        ctx.setLineDash([]);
        drawMarkerPulse(ctx, x, y, R + 2 * RENDER_SCALE, timeMs);
        ctx.beginPath();
        ctx.arc(x, y, R + 4 * RENDER_SCALE, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 198, 92, 0.96)";
        ctx.lineWidth = 3.5 * RENDER_SCALE;
        ctx.stroke();
      }

      frameId = requestAnimationFrame(draw);
    };

    frameId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [devicePreview, pdfReady, segmentation, selectedLabel, selectedPartNumberSet, selectedPartNumbers]);

  // Wheel zoom toward cursor
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !open) {
      return;
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const rect = viewport!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setXform((prev) => {
        const newS = clamp(prev.s * factor, 0.05, 20);
        const stX = (mx - prev.x) / prev.s;
        const stY = (my - prev.y) / prev.s;
        return { s: newS, x: mx - stX * newS, y: my - stY * newS };
      });
    }
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [open]);

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
    const TARGET_SCALE = 4;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    setNavigating(true);
    setXform({
      s: TARGET_SCALE,
      x: vw / 2 - stageX * TARGET_SCALE,
      y: vh / 2 - stageY * TARGET_SCALE,
    });
    setTimeout(() => setNavigating(false), 550);
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    pointerMovedRef.current = false;
    dragging.current = true;
    dragOrigin.current = { mx: e.clientX, my: e.clientY, tx: xform.x, ty: xform.y };
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
    setXform((prev) => ({
      s: prev.s,
      x: dragOrigin.current.tx + dx,
      y: dragOrigin.current.ty + dy,
    }));
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
      const touchPoint = getTouchPoint(e.touches[0]);
      gestureRef.current = {
        mode: "pan",
        startDistance: 0,
        startMidpointX: 0,
        startMidpointY: 0,
        startTouchX: touchPoint.x,
        startTouchY: touchPoint.y,
        startXform: xform,
        moved: false,
      };
      return;
    }

    if (e.touches.length >= 2) {
      const [touchA, touchB] = [e.touches[0], e.touches[1]];
      const midpoint = midpointBetweenTouches(touchA, touchB);
      gestureRef.current = {
        mode: "pinch",
        startDistance: distanceBetweenTouches(touchA, touchB),
        startMidpointX: midpoint.x,
        startMidpointY: midpoint.y,
        startTouchX: midpoint.x,
        startTouchY: midpoint.y,
        startXform: xform,
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
      setXform({
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
      const midpoint = midpointBetweenTouches(touchA, touchB);
      const start = gestureRef.current;
      if (Math.abs(distance - start.startDistance) > 4) {
        gestureRef.current.moved = true;
      }
      const newS = clamp(
        start.startXform.s * (distance / Math.max(start.startDistance, 1)),
        0.05,
        20
      );
      const stageX = (start.startMidpointX - start.startXform.x) / start.startXform.s;
      const stageY = (start.startMidpointY - start.startXform.y) / start.startXform.s;
      setXform({
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
        startXform: xform,
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
      startXform: xform,
      moved: false,
    };
  }

  function findDeviceNearStagePoint(stageX: number, stageY: number) {
    const threshold = Math.max(20, 28 / Math.max(xform.s, 0.35));
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

    const cardWidth = 272;
    const cardHeight = 176;
    const relativeX = clientX - rect.left;
    const relativeY = clientY - rect.top;
    const x = clamp(relativeX + 12, 12, Math.max(12, rect.width - cardWidth - 12));
    const y = clamp(relativeY - cardHeight - 12, 12, Math.max(12, rect.height - cardHeight - 12));

    setDevicePreview({
      device,
      x,
      y,
    });
  }

  function inspectDeviceAtClientPoint(clientX: number, clientY: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const stageX = (clientX - rect.left - xform.x) / xform.s;
    const stageY = (clientY - rect.top - xform.y) / xform.s;
    const device = findDeviceNearStagePoint(stageX, stageY);

    if (!device) {
      setDevicePreview(null);
      return;
    }

    openDevicePreview(device, clientX, clientY);
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
            cursor: dragging.current ? "grabbing" : "grab",
            touchAction: "none",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={resetPointerDrag}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
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
              <button type="button" className="secondary-action" onClick={fitToViewport}>
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

          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: plan.width,
              height: plan.height,
              transform: `translate(${xform.x}px, ${xform.y}px) scale(${xform.s})`,
              transformOrigin: "0 0",
              willChange: "transform",
              transition: navigating ? "transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)" : undefined,
            }}
          >
            <canvas
              ref={pdfCanvasRef}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
            />
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

          {devicePreview && (
            <div
              className="segmentation-device-preview"
              style={{
                left: devicePreview.x,
                top: devicePreview.y,
              }}
            >
              <button
                type="button"
                className="segmentation-device-preview__close"
                onClick={() => setDevicePreview(null)}
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
                {devicePreview.device.segmentLabel && (
                  <span>
                    <strong>{t("segmentation.segment")}:</strong> {devicePreview.device.segmentLabel}
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
            </div>
          )}
        </div>

        {segmentation && (
          <div
            className={`segmentation-controls${
              isMobileViewport ? " segmentation-controls--mobile" : ""
            }${controlsExpanded ? " segmentation-controls--open" : ""}`}
          >
            <div className="segmentation-controls__summary">
              <div className="segmentation-controls__summary-copy">
                <span className="segmentation-controls__summary-label">
                  {mobileSummary.label}
                </span>
                <strong>{mobileSummary.meta}</strong>
              </div>
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
                  const noSwitch = Object.values(segmentation.partNumberNoSwitch).reduce((sum, entries) => sum + entries.length, 0);
                  const noPos = Object.values(segmentation.partNumberUnpositioned).reduce((sum, entries) => sum + entries.length, 0);
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
                    {seg.switches.length > 0 && (
                      <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.38)", fontWeight: 400 }}>
                        {seg.switches.join(" · ")}
                      </span>
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
