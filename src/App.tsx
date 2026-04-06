import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { attachIcons, buildMetrics, countBy, normalizeRows, parseTabularFile } from "./lib/normalize";
import { readFileAsArrayBuffer } from "./lib/file-io";
import {
  buildVisualKnowledgeCoverage,
  createVisualKnowledgeIndex,
  getNamePatternKnowledge,
  normalizeKnowledgeNamePattern,
  type VisualKnowledgeIndex,
} from "./lib/visual-knowledge";
import { loadIconsFromDirectory, loadIconsFromManifest, loadIconsFromZip, mergeIconMaps } from "./lib/icons";
import { loadPlan } from "./lib/pdf";
import { useI18n } from "./i18n";
import type { DeviceCategory, DeviceRecord, ImportBundle, PlanData } from "./types";
import {
  VISUAL_KNOWLEDGE_SEEDS,
  type NamePatternKnowledgeRule,
  type VisualKnowledgeSeed,
} from "./config/visual-knowledge";
import { mergeDeviceRecords } from "./modules/device-records";
import { KnowledgeStudioPanel, type PendingKnowledgePattern } from "./modules/knowledge-studio";
import { parsePdfDataRecords } from "./modules/pdf-data-parser";
import {
  buildProjectInsights,
  ProjectInsightsPanel,
  type ProjectInsights
} from "./modules/project-insights";
import { buildPlanSegmentation, type PlanSegmentation } from "./modules/plan-segmentation";
import { PlanViewerModal, PlanSegmentationModal } from "./modules/plan-viewer";
import { hasSwitchAssignment, switchDisplayLabel } from "./modules/switch-segmentation";

type TaskState = "pending" | "active" | "done";

const STORAGE_KEY = "cctv-field-task-statuses-v1";
const KNOWLEDGE_OVERRIDES_STORAGE_KEY = "cctv-visual-knowledge-overrides-v1";
const KNOWLEDGE_ENABLED_STORAGE_KEY = "cctv-visual-knowledge-enabled-v1";
const SHOW_FIELD_TASK_ICONS = false;
const BUILD_LABEL = __APP_BUILD_ID__.replace("T", " ").replace(/\.\d+Z$/, "Z");
const EMPTY_MANUAL_VISUAL_KNOWLEDGE_SEED: VisualKnowledgeSeed = {
  seedName: "manual-dev-overrides",
  partNumberProfiles: [],
  namePatternRules: [],
};

function revokePlanResources(plan: PlanData | null) {
  if (!plan) {
    return;
  }
  if (plan.blobUrl) {
    URL.revokeObjectURL(plan.blobUrl);
  }
  if (plan.previewUrl && plan.previewUrl.startsWith("blob:") && plan.previewUrl !== plan.blobUrl) {
    URL.revokeObjectURL(plan.previewUrl);
  }
}

function compactSwitchLabel(record: DeviceRecord): string {
  return switchDisplayLabel(record);
}

function fileLabel(file: File | null, fallback: string): string {
  return file ? file.name : fallback;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTime(value: number): string {
  return new Date(value).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

async function fingerprintFile(file: File): Promise<string> {
  if (!window.crypto || !window.crypto.subtle) {
    return "";
  }
  const digest = await window.crypto.subtle.digest("SHA-256", await readFileAsArrayBuffer(file));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

interface IconDebugInfo {
  bnb: boolean;
  cip: boolean;
  lastModifiedLabel: string;
  psa: boolean;
  sampleKeys: string[];
}

type StatusDescriptor =
  | { kind: "raw"; text: string }
  | {
      kind: "translated";
      key: string;
      vars?: Record<string, string | number | boolean | undefined>;
    };

function buildIconDebugInfo(iconMap: Map<string, string>, lastModifiedLabel = ""): IconDebugInfo {
  return {
    bnb: iconMap.has("bnbscb1kit"),
    cip: Boolean(
      iconMap.has("cipqnd8011") ||
        iconMap.has("hanwha5mpindoormicrodomefixed") ||
        iconMap.has("camerasymbolscipqnd")
    ),
    lastModifiedLabel,
    psa: iconMap.has("psaw4baxfa51"),
    sampleKeys: Array.from(iconMap.keys()).slice(0, 8),
  };
}

function categoryLabel(
  category: DeviceCategory,
  t: (key: string, vars?: Record<string, string | number | boolean | undefined>) => string
): string {
  switch (category) {
    case "ptz":
      return "PTZ";
    case "camera":
      return t("filter.category.camera");
    case "monitor":
      return t("filter.category.monitor");
    case "mount":
      return t("filter.category.mount");
    case "infrastructure":
      return t("filter.category.infrastructure");
    default:
      return t("filter.category.unknown");
  }
}

function taskTitle(
  record: DeviceRecord,
  t: (key: string, vars?: Record<string, string | number | boolean | undefined>) => string
): string {
  switch (record.category) {
    case "ptz":
      return t("task.title.ptz");
    case "camera":
      return t("task.title.camera");
    case "monitor":
      return t("task.title.monitor");
    case "infrastructure":
      return t("task.title.infrastructure");
    default:
      return t("task.title.unknown");
  }
}

function primaryInstall(
  record: DeviceRecord,
  t: (key: string, vars?: Record<string, string | number | boolean | undefined>) => string
): string {
  return record.iconDevice || record.partNumber || record.deviceTaskType || t("task.primaryUnknown");
}

function installationHeightLabel(record: DeviceRecord): string {
  return record.mountHeightFt !== null ? `${record.mountHeightFt} ft` : "";
}

function installationHeightRuleText(
  record: DeviceRecord,
  t: (key: string, vars?: Record<string, string | number | boolean | undefined>) => string
): string {
  return record.mountHeightRuleKey ? t(record.mountHeightRuleKey) : "";
}

function shouldRenderRecordIcon(record: DeviceRecord): boolean {
  return SHOW_FIELD_TASK_ICONS && Boolean(record.iconUrl);
}

function cableNote(
  record: DeviceRecord,
  t: (key: string, vars?: Record<string, string | number | boolean | undefined>) => string
): string {
  if (record.cables === 0) {
    return t("task.cable.none");
  }
  if (record.cables === 2) {
    return t("task.cable.two");
  }
  return t("task.cable.one");
}

function stateLabel(
  value: TaskState,
  t: (key: string, vars?: Record<string, string | number | boolean | undefined>) => string
): string {
  switch (value) {
    case "active":
      return t("state.active");
    case "done":
      return t("state.done");
    default:
      return t("state.pending");
  }
}

function normalizeState(raw: string | null | undefined): TaskState {
  if (raw === "active" || raw === "done") {
    return raw;
  }
  return "pending";
}

function ambiguityFor(record: DeviceRecord, visualKnowledgeIndex: VisualKnowledgeIndex) {
  const knowledge = getNamePatternKnowledge(record.name, visualKnowledgeIndex);
  if (!knowledge) {
    return null;
  }

  if (
    knowledge.candidatePartNumbers.length <= 1 &&
    knowledge.candidateIconDevices.length <= 1
  ) {
    return null;
  }

  return knowledge;
}

function taskWarnings(
  record: DeviceRecord,
  visualKnowledgeIndex: VisualKnowledgeIndex,
  t: (key: string, vars?: Record<string, string | number | boolean | undefined>) => string
): string[] {
  const warnings: string[] = [];
  if (!record.partNumber) {
    warnings.push(t("task.warning.noPartNumber"));
  }
  if (!hasSwitchAssignment(record)) {
    warnings.push(t("task.warning.noSwitch"));
  }
  if (!record.hasPosition) {
    warnings.push(t("task.warning.noPosition"));
  }
  if (ambiguityFor(record, visualKnowledgeIndex)) {
    warnings.push(t("task.warning.validateField"));
  }
  if (record.mountHeightNeedsFieldValidation) {
    warnings.push(t("task.warning.validateHeight"));
  }
  return warnings;
}

function summaryLine(values: Array<[string, number]>, fallback: string): string {
  if (values.length === 0) {
    return fallback;
  }
  return values
    .slice(0, 3)
    .map(([label, count]) => `${label} (${count})`)
    .join(" • ");
}

function sanitizeManualList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    )
  );
}

function sanitizeManualRule(raw: unknown): NamePatternKnowledgeRule | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const input = raw as Partial<NamePatternKnowledgeRule>;
  const namePattern = typeof input.namePattern === "string" ? input.namePattern.trim() : "";
  const suggestedPartNumber =
    typeof input.suggestedPartNumber === "string" ? input.suggestedPartNumber.trim() : "";
  const suggestedIconDevice =
    typeof input.suggestedIconDevice === "string" ? input.suggestedIconDevice.trim() : "";

  if (!namePattern || !suggestedPartNumber || !suggestedIconDevice) {
    return null;
  }

  const candidatePartNumbers = sanitizeManualList(input.candidatePartNumbers);
  const candidateIconDevices = sanitizeManualList(input.candidateIconDevices);

  return {
    candidateIconDevices:
      candidateIconDevices.length > 0 ? candidateIconDevices : [suggestedIconDevice],
    candidatePartNumbers:
      candidatePartNumbers.length > 0 ? candidatePartNumbers : [suggestedPartNumber],
    iconConfidence:
      typeof input.iconConfidence === "number" && Number.isFinite(input.iconConfidence)
        ? input.iconConfidence
        : 1,
    namePattern,
    partConfidence:
      typeof input.partConfidence === "number" && Number.isFinite(input.partConfidence)
        ? input.partConfidence
        : 1,
    suggestedIconDevice,
    suggestedPartNumber,
  };
}

function sanitizeManualSeed(raw: unknown): VisualKnowledgeSeed {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_MANUAL_VISUAL_KNOWLEDGE_SEED };
  }

  const input = raw as Partial<VisualKnowledgeSeed>;
  const seen = new Map<string, NamePatternKnowledgeRule>();

  if (Array.isArray(input.namePatternRules)) {
    input.namePatternRules.forEach((rule) => {
      const sanitized = sanitizeManualRule(rule);
      if (!sanitized) {
        return;
      }
      seen.set(normalizeKnowledgeNamePattern(sanitized.namePattern), sanitized);
    });
  }

  return {
    seedName:
      typeof input.seedName === "string" && input.seedName.trim()
        ? input.seedName.trim()
        : EMPTY_MANUAL_VISUAL_KNOWLEDGE_SEED.seedName,
    partNumberProfiles: [],
    namePatternRules: Array.from(seen.values()),
  };
}

export default function App() {
  const { lang, setLang, t } = useI18n();
  const showKnowledgeStudio = import.meta.env.DEV;
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [extraDataFile, setExtraDataFile] = useState<File | null>(null);
  const [mappingFile, setMappingFile] = useState<File | null>(null);
  const [iconZipFile, setIconZipFile] = useState<File | null>(null);
  const [iconFolderFiles, setIconFolderFiles] = useState<File[]>([]);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [sourceRecords, setSourceRecords] = useState<DeviceRecord[]>([]);
  const [insightContext, setInsightContext] = useState<ProjectInsights["context"] | null>(null);
  const [taskStates, setTaskStates] = useState<Record<string, TaskState>>({});
  const [selectedKey, setSelectedKey] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskState>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | DeviceCategory>("all");
  const [showPdfViewer, setShowPdfViewer] = useState(false);
  const [showSegmentationModal, setShowSegmentationModal] = useState(false);
  const [status, setStatus] = useState<StatusDescriptor>({
    kind: "translated",
    key: "status.initial",
  });
  const [processedAt, setProcessedAt] = useState("");
  const [iconCount, setIconCount] = useState(0);
  const [bundledIconCount, setBundledIconCount] = useState(0);
  const [iconFileFingerprint, setIconFileFingerprint] = useState("");
  const [iconDebugInfo, setIconDebugInfo] = useState<IconDebugInfo | null>(null);
  const [bundledIconMap, setBundledIconMap] = useState<Map<string, string>>(new Map());
  const [rawIconMap, setRawIconMap] = useState<Map<string, string>>(new Map());
  const [manualKnowledgeSeed, setManualKnowledgeSeed] = useState<VisualKnowledgeSeed>(
    EMPTY_MANUAL_VISUAL_KNOWLEDGE_SEED
  );
  const [manualKnowledgeEnabled, setManualKnowledgeEnabled] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const iconFolderInputRef = useRef<HTMLInputElement | null>(null);
  const deferredSearch = useDeferredValue(search);
  const statusText = useMemo(
    () => (status.kind === "raw" ? status.text : t(status.key, status.vars)),
    [status, t]
  );
  const iconSourceLabel = useMemo(() => {
    const bundledLabel =
      bundledIconCount > 0
        ? `${t("icons.internalLibrary")} · ${bundledIconCount} ${t("snapshot.icons").toLowerCase()}`
        : t("icons.internalLibraryPending");
    if (iconZipFile) {
      const suffix = iconFileFingerprint ? ` · sha16 ${iconFileFingerprint}` : "";
      return `${bundledLabel} + ${iconZipFile.name} · ${formatFileSize(iconZipFile.size)}${suffix} · ${iconCount} ${t("snapshot.icons").toLowerCase()}`;
    }
    if (iconFolderFiles.length > 0) {
      return `${bundledLabel} + ${t("ingest.extraFolder").toLowerCase()} · ${iconFolderFiles.length} ${t("common.filePlural")} · ${iconCount} ${t("snapshot.icons").toLowerCase()}`;
    }
    return bundledIconCount > 0
      ? `${bundledLabel} · ${iconCount || bundledIconCount} ${t("snapshot.icons").toLowerCase()}`
      : t("icons.noLibrary");
  }, [bundledIconCount, iconCount, iconFileFingerprint, iconFolderFiles.length, iconZipFile, t]);
  const iconDebugLabel = useMemo(() => {
    if (!iconDebugInfo) {
      return "";
    }
    const mod = iconDebugInfo.lastModifiedLabel ? ` · mod ${iconDebugInfo.lastModifiedLabel}` : "";
    return `Debug ZIP: BNB ${iconDebugInfo.bnb ? t("common.yes") : t("common.no")} · PSA ${
      iconDebugInfo.psa ? t("common.yes") : t("common.no")
    } · CIP ${iconDebugInfo.cip ? t("common.yes") : t("common.no")}${mod}`;
  }, [iconDebugInfo, t]);
  const baseVisualKnowledgeIndex = useMemo(
    () => createVisualKnowledgeIndex(VISUAL_KNOWLEDGE_SEEDS),
    []
  );
  const effectiveVisualKnowledgeIndex = useMemo(
    () =>
      createVisualKnowledgeIndex(
        showKnowledgeStudio && manualKnowledgeEnabled && manualKnowledgeSeed.namePatternRules.length > 0
          ? [...VISUAL_KNOWLEDGE_SEEDS, manualKnowledgeSeed]
          : VISUAL_KNOWLEDGE_SEEDS
      ),
    [manualKnowledgeEnabled, manualKnowledgeSeed, showKnowledgeStudio]
  );
  const baseResolvedRecords = useMemo(
    () => attachIcons(sourceRecords, rawIconMap, baseVisualKnowledgeIndex),
    [baseVisualKnowledgeIndex, rawIconMap, sourceRecords]
  );
  const resolvedRecords = useMemo(
    () => attachIcons(sourceRecords, rawIconMap, effectiveVisualKnowledgeIndex),
    [effectiveVisualKnowledgeIndex, rawIconMap, sourceRecords]
  );
  const bundle = useMemo<ImportBundle>(
    () => ({
      records: resolvedRecords,
      metrics: buildMetrics(resolvedRecords),
      missingPositions: resolvedRecords.filter((record) => !record.hasPosition).length,
    }),
    [resolvedRecords]
  );
  const segmentation = useMemo<PlanSegmentation | null>(
    () => (plan ? buildPlanSegmentation(resolvedRecords, plan) : null),
    [plan, resolvedRecords]
  );
  const insights = useMemo<ProjectInsights | null>(() => {
    if (!insightContext) {
      return null;
    }

    return buildProjectInsights(
      resolvedRecords,
      {
        ...insightContext,
        recordsParsed: resolvedRecords.length,
      },
      segmentation,
      effectiveVisualKnowledgeIndex
    );
  }, [effectiveVisualKnowledgeIndex, insightContext, resolvedRecords, segmentation]);
  const baseKnowledgeCoverage = useMemo(
    () => buildVisualKnowledgeCoverage(baseResolvedRecords, baseVisualKnowledgeIndex),
    [baseResolvedRecords, baseVisualKnowledgeIndex]
  );
  const pendingKnowledgePatterns = useMemo<PendingKnowledgePattern[]>(() => {
    const grouped = new Map<string, { count: number; sampleNames: string[] }>();

    sourceRecords.forEach((record) => {
      const normalized = normalizeKnowledgeNamePattern(record.name);
      if (!normalized) {
        return;
      }
      if (getNamePatternKnowledge(record.name, baseVisualKnowledgeIndex)) {
        return;
      }

      const current = grouped.get(normalized) ?? { count: 0, sampleNames: [] };
      current.count += 1;
      if (current.sampleNames.length < 3 && !current.sampleNames.includes(record.name)) {
        current.sampleNames.push(record.name);
      }
      grouped.set(normalized, current);
    });

    return Array.from(grouped.entries())
      .map(([normalizedPattern, value]) => ({
        count: value.count,
        normalizedPattern,
        sampleNames: value.sampleNames,
      }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.normalizedPattern.localeCompare(right.normalizedPattern);
      })
      .slice(0, 10);
  }, [baseVisualKnowledgeIndex, sourceRecords]);

  useEffect(() => {
    if (!iconFolderInputRef.current) {
      return;
    }
    iconFolderInputRef.current.setAttribute("webkitdirectory", "");
    iconFolderInputRef.current.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrateBundledIcons() {
      try {
        const nextBundledMap = await loadIconsFromManifest();
        if (cancelled) {
          return;
        }
        setBundledIconMap(nextBundledMap);
        setBundledIconCount(nextBundledMap.size);
        if (!iconZipFile && iconFolderFiles.length === 0 && rawIconMap.size === 0) {
          setIconCount(nextBundledMap.size);
          setRawIconMap(nextBundledMap);
          setIconDebugInfo(buildIconDebugInfo(nextBundledMap));
        }
      } catch (error) {
        console.warn("[icons] No pude cargar la libreria interna:", error);
      }
    }

    hydrateBundledIcons();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, string>;
      const next: Record<string, TaskState> = {};
      Object.keys(parsed).forEach((key) => {
        const value = parsed[key];
        next[key] = normalizeState(value);
      });
      setTaskStates(next);
    } catch {
      // ignore persisted state errors
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(taskStates));
  }, [taskStates]);

  useEffect(() => {
    if (!showKnowledgeStudio) {
      return;
    }

    try {
      const rawSeed = window.localStorage.getItem(KNOWLEDGE_OVERRIDES_STORAGE_KEY);
      if (rawSeed) {
        setManualKnowledgeSeed(sanitizeManualSeed(JSON.parse(rawSeed)));
      }

      const rawEnabled = window.localStorage.getItem(KNOWLEDGE_ENABLED_STORAGE_KEY);
      if (rawEnabled === "true" || rawEnabled === "false") {
        setManualKnowledgeEnabled(rawEnabled === "true");
      }
    } catch {
      // ignore malformed development knowledge state
    }
  }, [showKnowledgeStudio]);

  useEffect(() => {
    if (!showKnowledgeStudio) {
      return;
    }

    window.localStorage.setItem(
      KNOWLEDGE_OVERRIDES_STORAGE_KEY,
      JSON.stringify(manualKnowledgeSeed)
    );
  }, [manualKnowledgeSeed, showKnowledgeStudio]);

  useEffect(() => {
    if (!showKnowledgeStudio) {
      return;
    }

    window.localStorage.setItem(
      KNOWLEDGE_ENABLED_STORAGE_KEY,
      String(manualKnowledgeEnabled)
    );
  }, [manualKnowledgeEnabled, showKnowledgeStudio]);

  useEffect(() => {
    return () => {
      revokePlanResources(plan);
    };
  }, [plan]);

  async function handleProcess() {
    if (!planFile) {
      setStatus({ kind: "translated", key: "status.missingPlan" });
      return;
    }

    setIsBusy(true);
    setShowPdfViewer(false);
    setShowSegmentationModal(false);
    setStatus({ kind: "translated", key: "status.processing" });
    let processStep = "init";

    try {
      processStep = "read-plan-file";
      const planBytes = new Uint8Array(await readFileAsArrayBuffer(planFile));
      processStep = "load-plan";
      const nextPlan = await loadPlan(new Uint8Array(planBytes), planFile.name);
      const isExtraPdf = extraDataFile?.type === "application/pdf" ||
        extraDataFile?.name.toLowerCase().endsWith(".pdf");
      processStep = "parse-main-pdf";
      const parsedPdf = await parsePdfDataRecords(new Uint8Array(planBytes), nextPlan.markers);
      processStep = "parse-primary-tabular";
      const primaryRows = dataFile ? await parseTabularFile(dataFile) : [];
      const parsedExtraPdf =
        extraDataFile && isExtraPdf
          ? (processStep = "parse-extra-pdf", await parsePdfDataRecords(extraDataFile, nextPlan.markers, 1))
          : null;
      processStep = "parse-extra-tabular";
      const extraRows =
        extraDataFile && !isExtraPdf
          ? await parseTabularFile(extraDataFile)
          : [];

      const csvRecords = primaryRows.length
        ? normalizeRows(primaryRows, [], nextPlan.markers).filter((record) => record.category !== "mount")
        : [];
      const extraCsvRecords = extraRows.length
        ? normalizeRows(extraRows, [], nextPlan.markers).filter((record) => record.category !== "mount")
        : [];

      let records = parsedPdf.records.filter((record) => record.category !== "mount");
      if (parsedExtraPdf) {
        records = mergeDeviceRecords(records, parsedExtraPdf.records.filter((r) => r.category !== "mount"));
      }
      if (csvRecords.length > 0) {
        records = mergeDeviceRecords(records, csvRecords);
      }
      if (extraCsvRecords.length > 0) {
        records = mergeDeviceRecords(records, extraCsvRecords);
      }

      let nextBundledMap = bundledIconMap;
      if (records.length > 0 && nextBundledMap.size === 0) {
        try {
          nextBundledMap = await loadIconsFromManifest();
        } catch (error) {
          console.warn("[icons] No pude recargar la libreria interna durante el proceso:", error);
        }
      }

      let nextIconCount = nextBundledMap.size;
      let nextIconFingerprint = "";
      let nextIconDebugInfo: IconDebugInfo | null = nextBundledMap.size
        ? buildIconDebugInfo(nextBundledMap)
        : null;
      let nextRawIconMap = nextBundledMap;

      if (records.length > 0 && iconZipFile) {
        const [loadedSupplementalMap, fingerprint] = await Promise.all([
          loadIconsFromZip(iconZipFile),
          fingerprintFile(iconZipFile),
        ]);
        nextRawIconMap = mergeIconMaps(nextBundledMap, loadedSupplementalMap);
        nextIconCount = nextRawIconMap.size;
        nextIconFingerprint = fingerprint;
        nextIconDebugInfo = buildIconDebugInfo(nextRawIconMap, formatDateTime(iconZipFile.lastModified));
        console.log("[icons] ZIP cargado:", {
          bnb: nextIconDebugInfo.bnb,
          cip: nextIconDebugInfo.cip,
          file: iconZipFile.name,
          lastModified: nextIconDebugInfo.lastModifiedLabel,
          mapSize: nextRawIconMap.size,
          psa: nextIconDebugInfo.psa,
          sampleKeys: nextIconDebugInfo.sampleKeys,
          sha16: fingerprint,
          size: iconZipFile.size,
        });
      } else if (records.length > 0 && iconFolderFiles.length > 0) {
        const loadedSupplementalMap = await loadIconsFromDirectory(iconFolderFiles);
        nextRawIconMap = mergeIconMaps(nextBundledMap, loadedSupplementalMap);
        nextIconCount = nextRawIconMap.size;
        nextIconDebugInfo = buildIconDebugInfo(nextRawIconMap);
        console.log("[icons] Carpeta cargada:", nextRawIconMap.size, "entradas. Primeras 8 claves:", Array.from(nextRawIconMap.keys()).slice(0, 8));
      } else {
        console.log("[icons] Sin ZIP ni carpeta. iconZipFile:", !!iconZipFile, "iconFolderFiles:", iconFolderFiles.length);
      }

      processStep = "commit-ui-state";
      startTransition(() => {
        revokePlanResources(plan);
        setPlan(nextPlan);
        setSourceRecords(records);
        setInsightContext({
          dataPages: parsedPdf.dataPages,
          rawRows: parsedPdf.rawRows,
          recordsParsed: records.length,
          template: parsedPdf.template,
        });
        setSelectedKey(records[0]?.key || "");
        setBundledIconMap(nextBundledMap);
        setBundledIconCount(nextBundledMap.size);
        setIconCount(nextIconCount);
        setIconFileFingerprint(nextIconFingerprint);
        setIconDebugInfo(nextIconDebugInfo);
        setRawIconMap(nextRawIconMap);
        setProcessedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        setStatus(
          records.length
            ? {
                kind: "translated",
                key: "status.readyRecords",
                vars: {
                  extra: extraDataFile ? parsedExtraPdf?.records.length ?? extraRows.length : undefined,
                  icons: nextIconCount,
                  markers: nextPlan.markers.size,
                  pages: parsedPdf.dataPages,
                  records: records.length,
                },
              }
            : {
                kind: "translated",
                key: "status.readyEmpty",
                vars: {
                  icons: nextIconCount,
                  markers: nextPlan.markers.size,
                },
              }
        );
      });
    } catch (error) {
      console.error("[process] Error procesando PDF", {
        error,
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : typeof error,
        processStep,
        stack: error instanceof Error ? error.stack : undefined,
      });
      setStatus(
        error instanceof Error
          ? { kind: "raw", text: `${error.message} [step: ${processStep}]` }
          : { kind: "translated", key: "status.processError" }
      );
    } finally {
      setIsBusy(false);
    }
  }

  function handleToggleManualKnowledge() {
    setManualKnowledgeEnabled((current) => !current);
  }

  function handleUpsertManualRule(rule: NamePatternKnowledgeRule) {
    const sanitizedRule = sanitizeManualRule(rule);
    if (!sanitizedRule) {
      return;
    }

    setManualKnowledgeSeed((current) => {
      const ruleKey = normalizeKnowledgeNamePattern(sanitizedRule.namePattern);
      const nextRules = current.namePatternRules.filter(
        (item) => normalizeKnowledgeNamePattern(item.namePattern) !== ruleKey
      );
      nextRules.push(sanitizedRule);

      return {
        ...current,
        namePatternRules: nextRules
          .slice()
          .sort((left, right) =>
            normalizeKnowledgeNamePattern(left.namePattern).localeCompare(
              normalizeKnowledgeNamePattern(right.namePattern)
            )
          ),
      };
    });
    setManualKnowledgeEnabled(true);
  }

  function handleDeleteManualRule(normalizedPattern: string) {
    setManualKnowledgeSeed((current) => ({
      ...current,
      namePatternRules: current.namePatternRules.filter(
        (rule) => normalizeKnowledgeNamePattern(rule.namePattern) !== normalizedPattern
      ),
    }));
  }

  function handleClearManualRules() {
    setManualKnowledgeSeed({ ...EMPTY_MANUAL_VISUAL_KNOWLEDGE_SEED });
    setManualKnowledgeEnabled(false);
  }

  function getTaskState(record: DeviceRecord): TaskState {
    return normalizeState(taskStates[record.key]);
  }

  function updateTaskState(recordKey: string, nextState: TaskState) {
    setTaskStates((current) => ({
      ...current,
      [recordKey]: nextState
    }));
  }

  const filteredRecords = bundle.records.filter((record) => {
    const searchValue = deferredSearch.trim().toLowerCase();
    const matchesSearch =
      !searchValue ||
      record.name.toLowerCase().includes(searchValue) ||
      primaryInstall(record, t).toLowerCase().includes(searchValue) ||
      record.area.toLowerCase().includes(searchValue) ||
      compactSwitchLabel(record).toLowerCase().includes(searchValue);

    const matchesStatus = statusFilter === "all" || getTaskState(record) === statusFilter;
    const matchesCategory = categoryFilter === "all" || record.category === categoryFilter;

    return matchesSearch && matchesStatus && matchesCategory;
  });

  const orderedRecords = [...filteredRecords].sort((left, right) => {
    const stateOrder: Record<TaskState, number> = { pending: 0, active: 1, done: 2 };
    const stateDiff = stateOrder[getTaskState(left)] - stateOrder[getTaskState(right)];
    if (stateDiff !== 0) {
      return stateDiff;
    }
    if (left.id === null && right.id === null) {
      return left.name.localeCompare(right.name);
    }
    if (left.id === null) {
      return 1;
    }
    if (right.id === null) {
      return -1;
    }
    return left.id - right.id;
  });

  const selectedRecord =
    orderedRecords.find((record) => record.key === selectedKey) ||
    bundle.records.find((record) => record.key === selectedKey) ||
    null;

  const topSwitches = countBy(bundle.records, "switchName");
  const topAreas = countBy(bundle.records, "area");
  const topParts = countBy(bundle.records, "partNumber");

  const taskStateCounts = bundle.records.reduce(
    (accumulator, record) => {
      accumulator[getTaskState(record)] += 1;
      return accumulator;
    },
    { pending: 0, active: 0, done: 0 }
  );

  const selectedWarnings = selectedRecord
    ? taskWarnings(selectedRecord, effectiveVisualKnowledgeIndex, t)
    : [];
  const selectedAmbiguity = selectedRecord
    ? ambiguityFor(selectedRecord, effectiveVisualKnowledgeIndex)
    : null;
  const canViewPlan = Boolean(plan?.viewerUrl);
  const reportLinks = [
    {
      href: "/reporte/index.html",
      label: t("reports.technical"),
      description: t("reports.technicalDescription"),
    },
    {
      href: "/reporte/index-cio.html",
      label: t("reports.executive"),
      description: t("reports.executiveDescription"),
    },
    {
      href: "/reporte/index-cio-bilingual.html",
      label: t("reports.bilingual"),
      description: t("reports.bilingualDescription"),
    },
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>CCTV Field Planner</h1>
        </div>
        <div className="status-block">
          <div className="topbar__utility-row">
            <div className="report-menu" aria-label={t("reports.aria")}>
              <span className="report-menu__label">{t("reports.label")}</span>
              <div className="report-menu__links">
                {reportLinks.map((report) => (
                  <a
                    key={report.href}
                    className="report-link"
                    href={report.href}
                    target="_blank"
                    rel="noreferrer"
                    title={t("reports.openInNewTab")}
                  >
                    {report.label}
                  </a>
                ))}
              </div>
            </div>
            <div className="language-toggle" role="group" aria-label="Language selector">
              <button
                type="button"
                className={`language-toggle__button${lang === "es" ? " language-toggle__button--active" : ""}`}
                onClick={() => setLang("es")}
              >
                {t("language.es")}
              </button>
              <button
                type="button"
                className={`language-toggle__button${lang === "en" ? " language-toggle__button--active" : ""}`}
                onClick={() => setLang("en")}
              >
                {t("language.en")}
              </button>
            </div>
          </div>
          <span className={`status-pill ${isBusy ? "status-pill--busy" : ""}`}>{statusText}</span>
          {processedAt && <span className="status-note">{t("status.processedAt", { time: processedAt })}</span>}
        </div>
      </header>

      <section className="report-hub-card">
        <div className="report-hub-card__header">
          <div>
            <p className="eyebrow">{t("reports.cardEyebrow")}</p>
            <h2>{t("reports.cardTitle")}</h2>
          </div>
          <p className="report-hub-card__description">{t("reports.cardDescription")}</p>
        </div>
        <div className="report-hub-grid">
          {reportLinks.map((report) => (
            <a
              key={report.href}
              className="report-hub-link"
              href={report.href}
              target="_blank"
              rel="noreferrer"
              title={t("reports.openInNewTab")}
            >
              <strong>{report.label}</strong>
              <span>{report.description}</span>
              <small>{t("reports.openInNewTab")}</small>
            </a>
          ))}
        </div>
      </section>

      <section className="ingest-card">
        <div className="ingest-card__header">
          <div>
            <p className="eyebrow">{t("ingest.eyebrow")}</p>
            <h2>{t("ingest.title")}</h2>
          </div>
          <div className="ingest-card__actions">
            <button type="button" className="primary-action" disabled={isBusy || !planFile} onClick={handleProcess}>
              {isBusy ? t("ingest.processing") : t("ingest.process")}
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={!canViewPlan}
              onClick={() => setShowPdfViewer(true)}
            >
              {t("ingest.viewPage1")}
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={!canViewPlan || !segmentation}
              onClick={() => setShowSegmentationModal(true)}
            >
              {t("ingest.viewSegmentation")}
            </button>
          </div>
        </div>

        <div className="upload-grid">
          <label className="upload-card">
            <span>{t("ingest.planPdf")}</span>
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => setPlanFile(event.target.files?.[0] || null)}
            />
            <strong>{fileLabel(planFile, t("common.noFile"))}</strong>
          </label>
          <label className="upload-card">
            <span>{t("ingest.baseCsv")}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setDataFile(event.target.files?.[0] || null)}
            />
            <strong>{fileLabel(dataFile, t("common.noFile"))}</strong>
          </label>
          <label className="upload-card">
            <span>{t("ingest.extraData")}</span>
            <input
              type="file"
              accept="application/pdf,.pdf,.csv,text/csv"
              onChange={(event) => setExtraDataFile(event.target.files?.[0] || null)}
            />
            <strong>{fileLabel(extraDataFile, t("common.noFile"))}</strong>
          </label>
          <label className="upload-card">
            <span>{t("ingest.mappingCsv")}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setMappingFile(event.target.files?.[0] || null)}
            />
            <strong>{fileLabel(mappingFile, t("common.noFile"))}</strong>
          </label>
          <label className="upload-card">
            <span>{t("ingest.extraZip")}</span>
            <input
              type="file"
              accept=".zip,application/zip"
              onClick={(event) => {
                event.currentTarget.value = "";
              }}
              onChange={(event) => {
                const nextFile = event.target.files?.[0] || null;
                console.log("[icons] Archivo ZIP elegido:", nextFile ? {
                  lastModified: formatDateTime(nextFile.lastModified),
                  name: nextFile.name,
                  size: nextFile.size,
                  type: nextFile.type,
                } : "sin archivo");
                setIconFolderFiles([]);
                setIconCount(bundledIconCount);
                setIconFileFingerprint("");
                setIconDebugInfo(bundledIconMap.size ? buildIconDebugInfo(bundledIconMap) : null);
                setRawIconMap(bundledIconMap);
                setIconZipFile(nextFile);
              }}
            />
            <strong>{fileLabel(iconZipFile, t("common.noFile"))}</strong>
            <small>{t("ingest.extraZipHelp")}</small>
          </label>
          <label className="upload-card">
            <span>{t("ingest.extraFolder")}</span>
            <input
              ref={iconFolderInputRef}
              type="file"
              multiple
              onChange={(event) => {
                setIconZipFile(null);
                setIconCount(bundledIconCount);
                setIconFileFingerprint("");
                setIconDebugInfo(bundledIconMap.size ? buildIconDebugInfo(bundledIconMap) : null);
                setRawIconMap(bundledIconMap);
                setIconFolderFiles(Array.from(event.target.files || []));
              }}
            />
            <strong>
              {iconFolderFiles.length
                ? `${iconFolderFiles.length} ${t("common.filePlural")}`
                : t("common.noFolder")}
            </strong>
            <small>{t("ingest.extraFolderHelp")}</small>
          </label>
        </div>
      </section>

      <ProjectInsightsPanel insights={insights} />

      {showKnowledgeStudio && (
        <KnowledgeStudioPanel
          baseCoverage={baseKnowledgeCoverage}
          effectiveCoverage={insights?.knowledge ?? baseKnowledgeCoverage}
          enabled={manualKnowledgeEnabled}
          manualSeed={manualKnowledgeSeed}
          pendingPatterns={pendingKnowledgePatterns}
          onClearRules={handleClearManualRules}
          onDeleteRule={handleDeleteManualRule}
          onToggleEnabled={handleToggleManualKnowledge}
          onUpsertRule={handleUpsertManualRule}
        />
      )}

      <section className="snapshot-grid">
        <article className="snapshot-card">
          <span>{t("snapshot.pending")}</span>
          <strong>{taskStateCounts.pending}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("snapshot.active")}</span>
          <strong>{taskStateCounts.active}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("snapshot.done")}</span>
          <strong>{taskStateCounts.done}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("snapshot.positioned")}</span>
          <strong>{insights?.totals.positioned ?? bundle.metrics.positionedDevices}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("snapshot.noSwitch")}</span>
          <strong>{insights?.review.missingSwitch ?? 0}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("snapshot.icons")}</span>
          <strong>{iconCount}</strong>
          <small style={{ color: "rgba(255,255,255,0.56)", lineHeight: 1.3 }}>{iconSourceLabel}</small>
          {iconDebugInfo && (
            <small style={{ color: "rgba(255,255,255,0.44)", lineHeight: 1.3 }}>
              BNB {iconDebugInfo.bnb ? t("common.yes") : t("common.no")} · PSA{" "}
              {iconDebugInfo.psa ? t("common.yes") : t("common.no")} · CIP{" "}
              {iconDebugInfo.cip ? t("common.yes") : t("common.no")}
              {iconDebugInfo.lastModifiedLabel ? ` · mod ${iconDebugInfo.lastModifiedLabel}` : ""}
            </small>
          )}
          <small style={{ color: "rgba(255,255,255,0.38)", lineHeight: 1.3 }}>Build {BUILD_LABEL}</small>
        </article>
      </section>

      <main className="operations-grid">
        <section className="tasks-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">{t("work.eyebrow")}</p>
              <h2>{t("work.title")}</h2>
            </div>
            <button
              type="button"
              className="secondary-action"
              disabled={!canViewPlan}
              onClick={() => setShowPdfViewer(true)}
            >
              {t("work.page1Plan")}
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={!canViewPlan || !segmentation}
              onClick={() => setShowSegmentationModal(true)}
            >
              {t("work.segmentation")}
            </button>
          </div>

          <div className="filter-row">
            <input
              className="search-input"
              type="search"
              placeholder={t("work.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="chip-row">
            {(["all", "pending", "active", "done"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`filter-chip ${statusFilter === value ? "filter-chip--active" : ""}`}
                onClick={() => setStatusFilter(value)}
              >
                {value === "all" ? t("filter.allTasks") : stateLabel(value, t)}
              </button>
            ))}
          </div>

          <div className="chip-row">
            {(["all", "camera", "ptz", "monitor", "infrastructure", "unknown"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`filter-chip ${categoryFilter === value ? "filter-chip--active" : ""}`}
                onClick={() => setCategoryFilter(value)}
              >
                {value === "all" ? t("filter.categories") : categoryLabel(value, t)}
              </button>
            ))}
          </div>

          <div className="task-list">
            {orderedRecords.length === 0 && (
              <div className="empty-inline">
                {t("task.emptyVisible")}
              </div>
            )}

            {orderedRecords.map((record) => {
              const currentState = getTaskState(record);
              const warnings = taskWarnings(record, effectiveVisualKnowledgeIndex, t);
              return (
                <button
                  key={record.key}
                  type="button"
                  className={`task-card ${selectedRecord?.key === record.key ? "task-card--selected" : ""}`}
                  onClick={() => setSelectedKey(record.key)}
                >
                  <div className="task-card__top">
                    <div className="task-card__icon">
                      {shouldRenderRecordIcon(record) ? (
                        <img src={record.iconUrl} alt={primaryInstall(record, t)} />
                      ) : (
                        <span>{record.id ?? categoryLabel(record.category, t).slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="task-card__copy">
                      <strong>{record.name || `ID ${record.id}`}</strong>
                      <span>{taskTitle(record, t)}</span>
                    </div>
                    <span className={`state-pill state-pill--${currentState}`}>{stateLabel(currentState, t)}</span>
                  </div>

                  <div className="task-card__meta">
                    <span>{t("task.meta.equipment")}: {primaryInstall(record, t)}</span>
                    <span>{t("task.meta.part")}: {record.partNumber || t("common.noInfo")}</span>
                    <span>{t("task.meta.area")}: {record.area}</span>
                    <span>{t("task.meta.network")}: {compactSwitchLabel(record)}</span>
                    {installationHeightLabel(record) && (
                      <span>{t("task.meta.height")}: {installationHeightLabel(record)}</span>
                    )}
                    <span>{cableNote(record, t)}</span>
                  </div>

                  {warnings.length > 0 && (
                    <div className="warning-row">
                      {warnings.map((warning) => (
                        <span key={warning} className="warning-chip">
                          {warning}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="detail-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">{t("detail.eyebrow")}</p>
              <h2>{t("detail.title")}</h2>
            </div>
          </div>

          {selectedRecord ? (
            <div className="detail-stack">
              <section className="focus-card">
                <div className="focus-card__top">
                  <div className="task-card__icon task-card__icon--large">
                    {shouldRenderRecordIcon(selectedRecord) ? (
                      <img src={selectedRecord.iconUrl} alt={primaryInstall(selectedRecord, t)} />
                    ) : (
                      <span>{selectedRecord.id ?? categoryLabel(selectedRecord.category, t).slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>
                  <div>
                    <p className="eyebrow">{stateLabel(getTaskState(selectedRecord), t)}</p>
                    <h3>{selectedRecord.name || `ID ${selectedRecord.id}`}</h3>
                    <p>{taskTitle(selectedRecord, t)}</p>
                  </div>
                </div>

                <div className="detail-actions">
                  <button
                    type="button"
                    className={`state-button ${getTaskState(selectedRecord) === "pending" ? "state-button--active" : ""}`}
                    onClick={() => updateTaskState(selectedRecord.key, "pending")}
                  >
                    {t("state.pending")}
                  </button>
                  <button
                    type="button"
                    className={`state-button ${getTaskState(selectedRecord) === "active" ? "state-button--active" : ""}`}
                    onClick={() => updateTaskState(selectedRecord.key, "active")}
                  >
                    {t("state.active")}
                  </button>
                  <button
                    type="button"
                    className={`state-button ${getTaskState(selectedRecord) === "done" ? "state-button--active" : ""}`}
                    onClick={() => updateTaskState(selectedRecord.key, "done")}
                  >
                    {t("state.done")}
                  </button>
                </div>
              </section>

              <section className="instruction-card">
                <h3>{t("detail.recommendedAction")}</h3>
                <ul className="instruction-list">
                  <li>{t("detail.install")}: {primaryInstall(selectedRecord, t)}</li>
                  <li>{t("detail.location")}: {selectedRecord.area}</li>
                  <li>{t("detail.network")}: {compactSwitchLabel(selectedRecord)}</li>
                  <li>{t("detail.wiring")}: {cableNote(selectedRecord, t)}</li>
                  {installationHeightLabel(selectedRecord) && (
                    <li>{t("detail.mountHeight")}: {installationHeightLabel(selectedRecord)}</li>
                  )}
                  {installationHeightRuleText(selectedRecord, t) && (
                    <li>{t("detail.heightRule")}: {installationHeightRuleText(selectedRecord, t)}</li>
                  )}
                  <li>{t("detail.reference")}: {t("detail.referencePage", { page: selectedRecord.sourcePage ?? 1 })}</li>
                </ul>
              </section>

              <section className="detail-grid">
                <article>
                  <span>{t("detail.id")}</span>
                  <strong>{selectedRecord.id ?? t("common.noId")}</strong>
                </article>
                <article>
                  <span>{t("detail.equipment")}</span>
                  <strong>{primaryInstall(selectedRecord, t)}</strong>
                </article>
                <article>
                  <span>{t("detail.iconDevice")}</span>
                  <strong>{selectedRecord.iconDevice || t("common.noInfo")}</strong>
                </article>
                <article>
                  <span>{t("detail.partNumber")}</span>
                  <strong>{selectedRecord.partNumber || t("common.noInfo")}</strong>
                </article>
                <article>
                  <span>{t("detail.switchHub")}</span>
                  <strong>{compactSwitchLabel(selectedRecord)}</strong>
                </article>
                <article>
                  <span>{t("detail.cables")}</span>
                  <strong>{selectedRecord.cables}</strong>
                </article>
                {installationHeightLabel(selectedRecord) && (
                  <article>
                    <span>{t("detail.mountHeight")}</span>
                    <strong>{installationHeightLabel(selectedRecord)}</strong>
                  </article>
                )}
                {installationHeightRuleText(selectedRecord, t) && (
                  <article>
                    <span>{t("detail.heightRule")}</span>
                    <strong>{installationHeightRuleText(selectedRecord, t)}</strong>
                  </article>
                )}
                <article>
                  <span>{t("detail.positionInPlan")}</span>
                  <strong>{selectedRecord.hasPosition ? t("common.yes") : t("common.no")}</strong>
                </article>
              </section>

              {selectedAmbiguity && (
                <section className="instruction-card instruction-card--warning">
                  <h3>{t("detail.optionsToValidate")}</h3>
                  <ul className="instruction-list">
                    {selectedAmbiguity.candidatePartNumbers.length > 1 && (
                      <li>
                        {t("detail.possiblePartNumbers")}: {selectedAmbiguity.candidatePartNumbers.join(" / ")}
                      </li>
                    )}
                    {selectedAmbiguity.candidateIconDevices.length > 1 && (
                      <li>
                        {t("detail.possibleIconDevices")}: {selectedAmbiguity.candidateIconDevices.join(" / ")}
                      </li>
                    )}
                    <li>{t("detail.confirmField")}</li>
                  </ul>
                </section>
              )}

              {selectedWarnings.length > 0 && (
                <section className="instruction-card instruction-card--warning">
                  <h3>{t("detail.alerts")}</h3>
                  <ul className="instruction-list">
                    {selectedWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="instruction-card">
                <h3>{t("detail.projectReference")}</h3>
                <p className="reference-line">
                  {t("detail.switches")}: {summaryLine(topSwitches, t("common.noData"))}
                </p>
                <p className="reference-line">{t("detail.areas")}: {summaryLine(topAreas, t("common.noData"))}</p>
                <p className="reference-line">
                  {t("detail.partNumbers")}: {summaryLine(topParts, t("common.noData"))}
                </p>
                <div className="detail-actions">
                  <button
                    type="button"
                    className="primary-action"
                    disabled={!canViewPlan}
                    onClick={() => setShowPdfViewer(true)}
                  >
                    {t("detail.viewPlan")}
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={!canViewPlan}
                    onClick={() => {
                      if (!plan) {
                        return;
                      }
                      window.open(plan.viewerUrl, "_blank", "noopener,noreferrer");
                    }}
                  >
                    {t("detail.openPdf")}
                  </button>
                </div>
              </section>
            </div>
          ) : (
            <div className="detail-empty">
              {t("detail.empty")}
            </div>
          )}
        </aside>
      </main>

      <PlanViewerModal
        open={showPdfViewer}
        plan={plan}
        segmentation={segmentation}
        onClose={() => setShowPdfViewer(false)}
      />
      <PlanSegmentationModal
        key={plan?.blobUrl ?? "no-plan"}
        open={showSegmentationModal}
        buildLabel={BUILD_LABEL}
        iconDebugLabel={iconDebugLabel}
        iconSourceLabel={iconSourceLabel}
        plan={plan}
        records={bundle.records}
        rawIconMap={rawIconMap}
        segmentation={segmentation}
        visualKnowledgeIndex={effectiveVisualKnowledgeIndex}
        onClose={() => setShowSegmentationModal(false)}
      />
    </div>
  );
}
