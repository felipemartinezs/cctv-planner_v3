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
import {
  fetchOperationalProject,
  syncOperationalDeviceProgress,
  syncOperationalProjectSnapshot,
} from "./lib/operational-progress-api";
import {
  createPublishedProject,
  downloadPublishedProjectPdf,
  listPublishedProjects,
  uploadPublishedProjectPdf,
} from "./lib/project-library-api";
import { useI18n } from "./i18n";
import type {
  DeviceCategory,
  DeviceRecord,
  ImportBundle,
  OperationalDeviceProgress,
  OperationalProgressStep,
  OperationalProjectMeta,
  OperationalStepStamp,
  OperationalStepStamps,
  PlanData,
  PublishedProjectDraft,
  PublishedProjectRecord,
} from "./types";
import { useTechnicianIdentity } from "./lib/technician-identity";
import { TechnicianOnboardingModal } from "./modules/technician-identity";
import {
  VISUAL_KNOWLEDGE_SEEDS,
  type NamePatternKnowledgeRule,
  type VisualKnowledgeSeed,
} from "./config/visual-knowledge";
import { mergeDeviceRecords } from "./modules/device-records";
import {
  KnowledgeStudioPanel,
  type NameRepairFinding,
  type PendingKnowledgePattern,
  type VisualDecisionIssue,
} from "./modules/knowledge-studio";
import { parsePdfDataRecords } from "./modules/pdf-data-parser";
import {
  buildProjectInsights,
  ProjectInsightsPanel,
  type ProjectInsights
} from "./modules/project-insights";
import { buildPlanSegmentation, type PlanSegmentation } from "./modules/plan-segmentation";
import { PlanViewerModal, PlanSegmentationModal } from "./modules/plan-viewer";
import { hasSwitchAssignment, switchDisplayLabel } from "./modules/switch-segmentation";
import { wasDeviceNameRepaired } from "./lib/device-name-repair";

type TaskState = "pending" | "active" | "done";

const STORAGE_KEY = "cctv-field-task-statuses-v1";
const OPERATIONAL_PROGRESS_STORAGE_KEY = "cctv-operational-device-progress-v1";
const KNOWLEDGE_OVERRIDES_STORAGE_KEY = "cctv-visual-knowledge-overrides-v1";
const KNOWLEDGE_ENABLED_STORAGE_KEY = "cctv-visual-knowledge-enabled-v1";
const SHOW_FIELD_TASK_ICONS = false;
const BUILD_LABEL = __APP_BUILD_ID__.replace("T", " ").replace(/\.\d+Z$/, "Z");
const EMPTY_MANUAL_VISUAL_KNOWLEDGE_SEED: VisualKnowledgeSeed = {
  seedName: "manual-dev-overrides",
  partNumberProfiles: [],
  namePatternRules: [],
};
const EMPTY_OPERATIONAL_PROGRESS: OperationalDeviceProgress = {
  cableRun: false,
  installed: false,
  switchConnected: false,
  updatedAt: 0,
};

type OperationalSyncMode = "local" | "syncing" | "shared";

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

function slugifyProjectValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function normalizeStampForHydration(value: unknown): OperationalStepStamp | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as { by?: unknown; at?: unknown };
  const by = raw.by as { id?: unknown; name?: unknown; initials?: unknown } | undefined;
  if (!by || typeof by !== "object") {
    return null;
  }
  const id = typeof by.id === "string" ? by.id : "";
  const name = typeof by.name === "string" ? by.name : "";
  const initials =
    typeof by.initials === "string" && by.initials
      ? by.initials
      : name
        ? name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((token) => token[0])
            .join("")
            .toUpperCase()
        : "";
  if (!id || !name) {
    return null;
  }
  const at =
    typeof raw.at === "number" && Number.isFinite(raw.at) ? (raw.at as number) : 0;
  return { by: { id, name, initials }, at };
}

function normalizeStampsForHydration(
  value: unknown,
  activeSteps: { cableRun: boolean; installed: boolean; switchConnected: boolean }
): OperationalStepStamps | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const result: OperationalStepStamps = {};
  (Object.keys(activeSteps) as OperationalProgressStep[]).forEach((step) => {
    if (!activeSteps[step]) {
      return;
    }
    const stamp = normalizeStampForHydration(raw[step]);
    if (stamp) {
      result[step] = stamp;
    }
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeOperationalProgress(raw: unknown): OperationalDeviceProgress | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const input = raw as Partial<OperationalDeviceProgress>;
  const steps = {
    cableRun: Boolean(input.cableRun),
    installed: Boolean(input.installed),
    switchConnected: Boolean(input.switchConnected),
  };
  const stamps = normalizeStampsForHydration(
    (input as { stamps?: unknown }).stamps,
    steps
  );
  return {
    ...steps,
    updatedAt:
      typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt)
        ? input.updatedAt
        : 0,
    ...(stamps ? { stamps } : {}),
  };
}

function buildProjectProgressScope(
  file: File,
  title: string,
  markerCount: number,
  fingerprint: string
) {
  const base = slugifyProjectValue(title || file.name) || "project";
  const uniqueToken =
    fingerprint ||
    [file.size, file.lastModified, markerCount].filter(Boolean).join("-") ||
    "local";
  return `${base}__${uniqueToken}`;
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

async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  if (!window.crypto || !window.crypto.subtle) {
    return "";
  }
  const strictBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const digest = await window.crypto.subtle.digest("SHA-256", strictBuffer);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

function bytesToStrictArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function inferPublishedProjectDraft(fileName: string, preferredTitle = ""): PublishedProjectDraft {
  const trimmedFileName = fileName.trim();
  const fileBaseName = trimmedFileName.replace(/\.pdf$/i, "").trim();
  const titleCandidate = preferredTitle.trim();
  const sourceTitle = titleCandidate || fileBaseName;
  const retailMatch = sourceTitle.match(/walmart retail-([^]+?)-cctv/i);
  const extractedLabel = (retailMatch?.[1] || sourceTitle)
    .replace(/^siteowl[-_\s]*multi[-_\s]*plan[-_\s]*report[-_\s]*/i, "")
    .trim();

  const storeMatch = extractedLabel.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  const storeCode = storeMatch?.[1]?.trim() || "";
  const locationLabel = (storeMatch?.[2] || extractedLabel)
    .replace(/\s+/g, " ")
    .trim();
  const locationMatch = locationLabel.match(/^(.+?)(?:,\s*([A-Z]{2}))?$/);
  const city = locationMatch?.[1]?.trim() || locationLabel;
  const region = locationMatch?.[2]?.trim() || "";
  const normalizedTitle = storeCode
    ? `${storeCode} ${city}${region ? `, ${region}` : ""}`
    : locationLabel || fileBaseName;

  return {
    city,
    region,
    sourcePdfName: trimmedFileName || "project-plan.pdf",
    storeCode,
    title: normalizedTitle,
  };
}

function mergeOperationalProgressMaps(
  base: Record<string, OperationalDeviceProgress>,
  incoming: Record<string, OperationalDeviceProgress>
) {
  const merged = { ...base };

  Object.keys(incoming).forEach((deviceKey) => {
    const nextValue = normalizeOperationalProgress(incoming[deviceKey]);
    if (!nextValue) {
      return;
    }

    const currentValue = normalizeOperationalProgress(merged[deviceKey]);
    if (!currentValue || nextValue.updatedAt >= currentValue.updatedAt) {
      if (nextValue.cableRun || nextValue.installed || nextValue.switchConnected) {
        merged[deviceKey] = nextValue;
      } else {
        delete merged[deviceKey];
      }
    }
  });

  return merged;
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

function buildVisualDecisionIssues(records: DeviceRecord[]): VisualDecisionIssue[] {
  return records
    .filter(
      (record): record is DeviceRecord & {
        id: number;
        visualDecision: NonNullable<DeviceRecord["visualDecision"]>;
      } => record.id !== null && Boolean(record.visualDecision) && record.visualDecision!.risk !== "safe"
    )
    .map((record) => ({
      contextualizedFrom: record.visualDecision.contextualizedFrom,
      deviceRuleDescription: record.visualDecision.deviceRuleDescription,
      deviceRuleId: record.visualDecision.deviceRuleId,
      displayedIconDevice: record.iconDevice,
      hasAmbiguousNameKnowledge: record.visualDecision.hasAmbiguousNameKnowledge,
      hasNameKnowledge: record.visualDecision.hasNameKnowledge,
      hasPartKnowledge: record.visualDecision.hasPartKnowledge,
      id: record.id,
      lookupMode: record.visualDecision.iconLookupMode,
      name: record.name,
      normalizedPattern: record.visualDecision.namePattern,
      partKnowledgeIconChoices: record.visualDecision.partKnowledgeIconChoices,
      partNumber: record.partNumber,
      proposedIconDevice: record.visualDecision.proposedIconDevice,
      rawIconDeviceProvided: record.visualDecision.rawIconDeviceProvided,
      risk: record.visualDecision.risk,
      source: record.visualDecision.source,
      suppressed: record.visualDecision.suppressed,
    }))
    .sort((left, right) => {
      const riskRank = { abstain: 2, review: 1, safe: 0 } as const;
      if (riskRank[right.risk] !== riskRank[left.risk]) {
        return riskRank[right.risk] - riskRank[left.risk];
      }
      return left.id - right.id;
    });
}

function buildNameRepairFindings(records: DeviceRecord[]): NameRepairFinding[] {
  return records
    .filter(
      (record): record is DeviceRecord & { id: number } =>
        record.id !== null && wasDeviceNameRepaired(record.rawName, record.name)
    )
    .map((record) => ({
      id: record.id,
      rawName: record.rawName,
      repairedName: record.name,
    }))
    .sort((left, right) => left.id - right.id);
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
  const [activeProjectScope, setActiveProjectScope] = useState("");
  const [activeOperationalProjectMeta, setActiveOperationalProjectMeta] =
    useState<OperationalProjectMeta | null>(null);
  const [operationalProgressStore, setOperationalProgressStore] = useState<
    Record<string, Record<string, OperationalDeviceProgress>>
  >({});
  const [operationalSyncMode, setOperationalSyncMode] = useState<OperationalSyncMode>("local");
  const [publishedProjects, setPublishedProjects] = useState<PublishedProjectRecord[]>([]);
  const [isLibraryBusy, setIsLibraryBusy] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskState>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | DeviceCategory>("all");
  const [showPdfViewer, setShowPdfViewer] = useState(false);
  const [showSegmentationModal, setShowSegmentationModal] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentView, setCurrentView] = useState<
    "main" | "reports" | "admin" | "insights" | "knowledge" | "about"
  >("main");
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
  const {
    identity: technicianIdentity,
    isReady: technicianIdentityReady,
    setIdentityFromName: setTechnicianIdentityFromName,
  } = useTechnicianIdentity();
  const [showTechnicianEditor, setShowTechnicianEditor] = useState(false);
  const iconFolderInputRef = useRef<HTMLInputElement | null>(null);
  const operationalProgressStoreRef = useRef(operationalProgressStore);
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
    [VISUAL_KNOWLEDGE_SEEDS]
  );
  const effectiveVisualKnowledgeIndex = useMemo(
    () =>
      createVisualKnowledgeIndex(
        showKnowledgeStudio && manualKnowledgeEnabled && manualKnowledgeSeed.namePatternRules.length > 0
          ? [...VISUAL_KNOWLEDGE_SEEDS, manualKnowledgeSeed]
          : VISUAL_KNOWLEDGE_SEEDS
      ),
    [VISUAL_KNOWLEDGE_SEEDS, manualKnowledgeEnabled, manualKnowledgeSeed, showKnowledgeStudio]
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
  const activeOperationalProgress = useMemo(
    () => (activeProjectScope ? operationalProgressStore[activeProjectScope] ?? {} : {}),
    [activeProjectScope, operationalProgressStore]
  );
  const projectProgressStatusLabel = useMemo(() => {
    if (!activeProjectScope) {
      return t("segmentation.progress.localProject");
    }
    if (operationalSyncMode === "shared") {
      return t("segmentation.progress.sharedProject");
    }
    if (operationalSyncMode === "syncing") {
      return t("segmentation.progress.syncingProject");
    }
    return t("segmentation.progress.localProject");
  }, [activeProjectScope, operationalSyncMode, t]);
  const baseKnowledgeCoverage = useMemo(
    () => buildVisualKnowledgeCoverage(baseResolvedRecords, baseVisualKnowledgeIndex),
    [baseResolvedRecords, baseVisualKnowledgeIndex]
  );
  const baseVisualDecisionIssues = useMemo(
    () => buildVisualDecisionIssues(baseResolvedRecords),
    [baseResolvedRecords]
  );
  const effectiveVisualDecisionIssues = useMemo(
    () => buildVisualDecisionIssues(resolvedRecords),
    [resolvedRecords]
  );
  const nameRepairFindings = useMemo(
    () => buildNameRepairFindings(sourceRecords),
    [sourceRecords]
  );
  const pendingKnowledgePatterns = useMemo<PendingKnowledgePattern[]>(() => {
    const grouped = new Map<string, { count: number; deviceIds: number[]; sampleNames: string[] }>();

    sourceRecords.forEach((record) => {
      const normalized = normalizeKnowledgeNamePattern(record.name);
      if (!normalized) {
        return;
      }
      if (getNamePatternKnowledge(record.name, baseVisualKnowledgeIndex)) {
        return;
      }

      const current = grouped.get(normalized) ?? { count: 0, deviceIds: [], sampleNames: [] };
      current.count += 1;
      if (record.id !== null && !current.deviceIds.includes(record.id)) {
        current.deviceIds.push(record.id);
      }
      if (current.sampleNames.length < 3 && !current.sampleNames.includes(record.name)) {
        current.sampleNames.push(record.name);
      }
      grouped.set(normalized, current);
    });

    return Array.from(grouped.entries())
      .map(([normalizedPattern, value]) => ({
        count: value.count,
        deviceIds: value.deviceIds.slice().sort((left, right) => left - right),
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

  async function refreshPublishedProjectLibrary() {
    try {
      const projects = await listPublishedProjects(24);
      setPublishedProjects(projects);
    } catch (error) {
      console.warn("[project-library] Could not refresh published projects:", error);
    }
  }

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
    try {
      const raw = window.localStorage.getItem(OPERATIONAL_PROGRESS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      const next: Record<string, Record<string, OperationalDeviceProgress>> = {};
      Object.keys(parsed).forEach((projectScope) => {
        const scoped = parsed[projectScope];
        if (!scoped || typeof scoped !== "object") {
          return;
        }
        const scopedProgress: Record<string, OperationalDeviceProgress> = {};
        Object.keys(scoped).forEach((deviceKey) => {
          const normalized = normalizeOperationalProgress(scoped[deviceKey]);
          if (
            normalized &&
            (normalized.cableRun || normalized.installed || normalized.switchConnected)
          ) {
            scopedProgress[deviceKey] = normalized;
          }
        });
        if (Object.keys(scopedProgress).length > 0) {
          next[projectScope] = scopedProgress;
        }
      });
      setOperationalProgressStore(next);
    } catch {
      // ignore malformed operational progress state
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      OPERATIONAL_PROGRESS_STORAGE_KEY,
      JSON.stringify(operationalProgressStore)
    );
  }, [operationalProgressStore]);

  useEffect(() => {
    operationalProgressStoreRef.current = operationalProgressStore;
  }, [operationalProgressStore]);

  useEffect(() => {
    void refreshPublishedProjectLibrary();
  }, []);

  useEffect(() => {
    if (!activeOperationalProjectMeta) {
      setOperationalSyncMode("local");
      return;
    }

    let live = true;
    let hasSeededLocalSnapshot = false;

    const pullRemoteProject = async () => {
      try {
        const remoteProject = await fetchOperationalProject(activeOperationalProjectMeta.scope);
        if (!live) {
          return;
        }

        let nextRemoteProgress = remoteProject.deviceProgressByKey;
        const localSnapshot =
          operationalProgressStoreRef.current[activeOperationalProjectMeta.scope] ?? {};

        if (!hasSeededLocalSnapshot && Object.keys(localSnapshot).length > 0) {
          hasSeededLocalSnapshot = true;
          const seededProject = await syncOperationalProjectSnapshot(
            activeOperationalProjectMeta.scope,
            activeOperationalProjectMeta,
            localSnapshot
          );
          if (!live) {
            return;
          }
          nextRemoteProgress = seededProject.deviceProgressByKey;
        }

        setOperationalProgressStore((current) => {
          const currentProject = current[activeOperationalProjectMeta.scope] ?? {};
          const mergedProject = mergeOperationalProgressMaps(currentProject, nextRemoteProgress);
          if (Object.keys(mergedProject).length === 0) {
            if (!(activeOperationalProjectMeta.scope in current)) {
              return current;
            }
            const { [activeOperationalProjectMeta.scope]: _removed, ...rest } = current;
            return rest;
          }
          return {
            ...current,
            [activeOperationalProjectMeta.scope]: mergedProject,
          };
        });
        setOperationalSyncMode("shared");
      } catch (error) {
        if (!live) {
          return;
        }
        console.warn("[operational-progress] Remote project sync unavailable, using local cache:", error);
        setOperationalSyncMode("local");
      }
    };

    setOperationalSyncMode("syncing");
    void pullRemoteProject();
    const intervalId = window.setInterval(() => {
      void pullRemoteProject();
    }, 12000);

    return () => {
      live = false;
      window.clearInterval(intervalId);
    };
  }, [activeOperationalProjectMeta]);

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

  function setOperationalDeviceProgress(
    deviceKey: string,
    nextProgress: OperationalDeviceProgress,
    changedStep?: OperationalProgressStep
  ) {
    if (!activeProjectScope || !deviceKey) {
      return;
    }

    const stampTimestamp =
      typeof nextProgress.updatedAt === "number" && Number.isFinite(nextProgress.updatedAt)
        ? nextProgress.updatedAt
        : Date.now();

    const incomingStamps: OperationalStepStamps =
      nextProgress.stamps && typeof nextProgress.stamps === "object"
        ? { ...nextProgress.stamps }
        : {};

    if (changedStep) {
      const stepActive = Boolean(nextProgress[changedStep]);
      if (stepActive && technicianIdentity) {
        incomingStamps[changedStep] = {
          by: technicianIdentity,
          at: stampTimestamp,
        };
      } else if (!stepActive) {
        delete incomingStamps[changedStep];
      }
    }

    const cleanedStamps: OperationalStepStamps = {};
    (Object.keys(incomingStamps) as OperationalProgressStep[]).forEach((step) => {
      if (nextProgress[step]) {
        const stamp = incomingStamps[step];
        if (stamp) {
          cleanedStamps[step] = stamp;
        }
      }
    });

    const normalized: OperationalDeviceProgress = {
      cableRun: Boolean(nextProgress.cableRun),
      installed: Boolean(nextProgress.installed),
      switchConnected: Boolean(nextProgress.switchConnected),
      updatedAt: stampTimestamp,
      ...(Object.keys(cleanedStamps).length > 0 ? { stamps: cleanedStamps } : {}),
    };

    setOperationalProgressStore((current) => {
      const currentProject = current[activeProjectScope] ?? {};
      const nextProject = { ...currentProject };

      if (normalized.cableRun || normalized.installed || normalized.switchConnected) {
        nextProject[deviceKey] = normalized;
      } else {
        delete nextProject[deviceKey];
      }

      if (Object.keys(nextProject).length === 0) {
        const { [activeProjectScope]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [activeProjectScope]: nextProject,
      };
    });

    if (!activeOperationalProjectMeta) {
      return;
    }

    setOperationalSyncMode("syncing");
    void syncOperationalDeviceProgress(
      activeOperationalProjectMeta.scope,
      activeOperationalProjectMeta,
      deviceKey,
      normalized
    )
      .then(() => {
        setOperationalSyncMode("shared");
      })
      .catch((error) => {
        console.warn("[operational-progress] Device progress stayed local after sync failure:", error);
        setOperationalSyncMode("local");
      });
  }

  async function processPlanPayload(options: {
    forcedProjectMeta?: PublishedProjectRecord | null;
    planBytes: Uint8Array;
    planFileName: string;
    sourceFile?: File | null;
  }) {
    const { forcedProjectMeta = null, planBytes, planFileName, sourceFile = null } = options;
    setIsBusy(true);
    setShowPdfViewer(false);
    setShowSegmentationModal(false);
    setStatus({ kind: "translated", key: "status.processing" });
    let processStep = "init";

    try {
      processStep = "load-plan";
      const nextPlan = await loadPlan(new Uint8Array(planBytes), planFileName);
      processStep = "fingerprint-plan";
      const planFingerprint = sourceFile
        ? await fingerprintFile(sourceFile)
        : await fingerprintBytes(planBytes);
      const nextProjectScope = forcedProjectMeta?.scope
        ? forcedProjectMeta.scope
        : buildProjectProgressScope(
            sourceFile ||
              new File([bytesToStrictArrayBuffer(planBytes)], planFileName, {
                type: "application/pdf",
              }),
            nextPlan.title,
            nextPlan.markers.size,
            planFingerprint
          );
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
      if (records.length > 0) {
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
      } else if (records.length > 0 && iconFolderFiles.length > 0) {
        const loadedSupplementalMap = await loadIconsFromDirectory(iconFolderFiles);
        nextRawIconMap = mergeIconMaps(nextBundledMap, loadedSupplementalMap);
        nextIconCount = nextRawIconMap.size;
        nextIconDebugInfo = buildIconDebugInfo(nextRawIconMap);
      }

      processStep = "commit-ui-state";
      startTransition(() => {
        revokePlanResources(plan);
        if (sourceFile) {
          setPlanFile(sourceFile);
        }
        setActiveProjectScope(nextProjectScope);
        setActiveOperationalProjectMeta({
          markerCount: nextPlan.markers.size,
          scope: nextProjectScope,
          sourcePdfName: forcedProjectMeta?.sourcePdfName || planFileName,
          title: forcedProjectMeta?.title || nextPlan.title,
        });
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

  async function handleProcess() {
    if (!planFile) {
      setStatus({ kind: "translated", key: "status.missingPlan" });
      return;
    }
    const planBytes = new Uint8Array(await readFileAsArrayBuffer(planFile));
    await processPlanPayload({
      planBytes,
      planFileName: planFile.name,
      sourceFile: planFile,
    });
  }

  async function handlePublishCurrentPlan() {
    if (!planFile) {
      setStatus({ kind: "translated", key: "status.missingPlan" });
      return;
    }

    setIsLibraryBusy(true);
    try {
      const draft = inferPublishedProjectDraft(planFile.name, plan?.title || "");
      const createdProject = await createPublishedProject(draft);
      const uploadedProject = await uploadPublishedProjectPdf(createdProject.scope, planFile);
      await refreshPublishedProjectLibrary();

      if (plan) {
        const nextMeta: OperationalProjectMeta = {
          markerCount: plan.markers.size,
          scope: uploadedProject.scope,
          sourcePdfName: uploadedProject.sourcePdfName,
          title: uploadedProject.title,
        };
        const currentProgressSnapshot =
          activeProjectScope && activeProjectScope !== uploadedProject.scope
            ? operationalProgressStoreRef.current[activeProjectScope] ?? {}
            : operationalProgressStoreRef.current[uploadedProject.scope] ?? {};

        if (Object.keys(currentProgressSnapshot).length > 0) {
          setOperationalProgressStore((current) => ({
            ...current,
            [uploadedProject.scope]: mergeOperationalProgressMaps(
              current[uploadedProject.scope] ?? {},
              currentProgressSnapshot
            ),
          }));
          void syncOperationalProjectSnapshot(
            uploadedProject.scope,
            nextMeta,
            currentProgressSnapshot
          ).catch((error) => {
            console.warn("[project-library] Could not seed published project progress:", error);
          });
        }

        setActiveProjectScope(uploadedProject.scope);
        setActiveOperationalProjectMeta(nextMeta);
      }

      setStatus({
        kind: "raw",
        text: `Proyecto publicado: ${uploadedProject.title}`,
      });
    } catch (error) {
      console.error("[project-library] Could not publish current plan:", error);
      setStatus({
        kind: "raw",
        text:
          error instanceof Error
            ? `No pude publicar el proyecto: ${error.message}`
            : "No pude publicar el proyecto.",
      });
    } finally {
      setIsLibraryBusy(false);
    }
  }

  async function handleOpenPublishedProject(project: PublishedProjectRecord) {
    setIsLibraryBusy(true);
    try {
      const filePayload = await downloadPublishedProjectPdf(project.scope);
      const file = new File([bytesToStrictArrayBuffer(filePayload.bytes)], filePayload.fileName, {
        lastModified: project.updatedAt,
        type: "application/pdf",
      });

      setDataFile(null);
      setExtraDataFile(null);
      setMappingFile(null);
      setStatus({
        kind: "raw",
        text: `Abriendo proyecto publicado: ${project.title}`,
      });

      await processPlanPayload({
        forcedProjectMeta: project,
        planBytes: filePayload.bytes,
        planFileName: filePayload.fileName,
        sourceFile: file,
      });
    } catch (error) {
      console.error("[project-library] Could not open published project:", error);
      setStatus({
        kind: "raw",
        text:
          error instanceof Error
            ? `No pude abrir el proyecto publicado: ${error.message}`
            : "No pude abrir el proyecto publicado.",
      });
    } finally {
      setIsLibraryBusy(false);
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
        <div className="topbar__row">
          <div className="topbar__title-group">
            <button
              type="button"
              className="hamburger-button"
              onClick={() => setDrawerOpen(true)}
              aria-label={t("menu.open")}
              aria-expanded={drawerOpen}
              aria-controls="app-drawer"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <h1>CCTV Field Planner</h1>
          </div>
          <div className="topbar__utility-row">
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
        </div>
        <div className="status-block">
          <span className={`status-pill ${isBusy ? "status-pill--busy" : ""}`}>{statusText}</span>
          {processedAt && <span className="status-note">{t("status.processedAt", { time: processedAt })}</span>}
        </div>
      </header>

      {currentView === "main" && (
      <>
      <section className="project-library-card">
        <div className="project-library-card__header">
          <div>
            <p className="eyebrow">{t("library.eyebrow")}</p>
            <h2>{t("library.title")}</h2>
          </div>
          <div className="project-library-card__actions">
            <button
              type="button"
              className="secondary-action"
              disabled={isLibraryBusy}
              onClick={() => {
                setIsLibraryBusy(true);
                void refreshPublishedProjectLibrary().finally(() => setIsLibraryBusy(false));
              }}
            >
              {t("library.refresh")}
            </button>
            <button
              type="button"
              className="primary-action"
              disabled={isLibraryBusy || !planFile}
              onClick={handlePublishCurrentPlan}
            >
              {isLibraryBusy ? t("library.publishing") : t("library.publishCurrent")}
            </button>
          </div>
        </div>

        <p className="project-library-card__description">{t("library.description")}</p>

        {planFile && (
          <div className="project-library-card__draft">
            <strong>{t("library.readyToPublish")}</strong>
            <span>
              {(() => {
                const inferred = inferPublishedProjectDraft(planFile.name, plan?.title || "");
                return `${inferred.title} · ${planFile.name}`;
              })()}
            </span>
          </div>
        )}

        <div className="project-library-grid">
          {publishedProjects.length === 0 ? (
            <div className="empty-inline">{t("library.empty")}</div>
          ) : (
            publishedProjects.map((project) => (
              <article
                key={project.scope}
                className={`project-library-item${
                  activeProjectScope === project.scope ? " project-library-item--active" : ""
                }`}
              >
                <div className="project-library-item__copy">
                  <strong>{project.title}</strong>
                  <span>{project.sourcePdfName}</span>
                  <small>
                    {project.storeCode ? `${project.storeCode} · ` : ""}
                    {project.city || t("common.noData")}
                    {project.region ? `, ${project.region}` : ""}
                    {` · ${t("library.updatedAt", { time: formatDateTime(project.updatedAt) })}`}
                  </small>
                  <small>
                    {project.pdfAvailable
                      ? t("library.available", {
                          mode: `${project.storageMode} / ${project.pdfStorageMode}`,
                          size: formatFileSize(project.pdfSizeBytes),
                        })
                      : t("library.missingPdf")}
                  </small>
                </div>
                <div className="project-library-item__actions">
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={isLibraryBusy || !project.pdfAvailable}
                    onClick={() => void handleOpenPublishedProject(project)}
                  >
                    {t("library.open")}
                  </button>
                  <button
                    type="button"
                    className="primary-action"
                    disabled={
                      activeProjectScope !== project.scope ||
                      !canViewPlan ||
                      !segmentation
                    }
                    onClick={() => setShowSegmentationModal(true)}
                    title={t("work.segmentation")}
                  >
                    {t("work.segmentation")}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

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
      </>
      )}

      {currentView !== "main" && (
        <main className="app-page">
          <header className="app-page__header">
            <button
              type="button"
              className="app-page__back"
              onClick={() => setCurrentView("main")}
              aria-label={t("page.back")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
              <span>{t("page.back")}</span>
            </button>
            <h2 className="app-page__title">
              {currentView === "reports" && t("menu.section.reports")}
              {currentView === "admin" && t("menu.section.admin")}
              {currentView === "insights" && t("menu.section.insights")}
              {currentView === "knowledge" && t("menu.section.knowledge")}
              {currentView === "about" && t("menu.section.about")}
            </h2>
          </header>

          <div className="app-page__body">
            {currentView === "reports" && (
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
            )}

            {currentView === "admin" && (
              <section className="ingest-card">
                <div className="ingest-card__header">
                  <div>
                    <p className="eyebrow">{t("ingest.eyebrow")}</p>
                    <h2>{t("ingest.title")}</h2>
                  </div>
                  <div className="ingest-card__actions">
                    <button
                      type="button"
                      className="primary-action"
                      disabled={isBusy || !planFile}
                      onClick={handleProcess}
                    >
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
            )}

            {currentView === "insights" && (
              <ProjectInsightsPanel insights={insights} />
            )}

            {currentView === "knowledge" && showKnowledgeStudio && (
              <KnowledgeStudioPanel
                baseCoverage={baseKnowledgeCoverage}
                baseIssues={baseVisualDecisionIssues}
                effectiveCoverage={insights?.knowledge ?? baseKnowledgeCoverage}
                effectiveIssues={effectiveVisualDecisionIssues}
                enabled={manualKnowledgeEnabled}
                manualSeed={manualKnowledgeSeed}
                nameRepairs={nameRepairFindings}
                pendingPatterns={pendingKnowledgePatterns}
                onClearRules={handleClearManualRules}
                onDeleteRule={handleDeleteManualRule}
                onToggleEnabled={handleToggleManualKnowledge}
                onUpsertRule={handleUpsertManualRule}
              />
            )}

            {currentView === "about" && (
              <div className="app-drawer__about">
                {technicianIdentity && (
                  <div className="app-drawer__about-item app-drawer__technician">
                    <span>{t("technician.menu.workingAs", { name: "" }).replace(/:\s*$/, "")}</span>
                    <strong>
                      <span className="technician-badge" aria-hidden="true">
                        {technicianIdentity.initials}
                      </span>
                      {technicianIdentity.name}
                    </strong>
                    <button
                      type="button"
                      className="app-drawer__technician-edit"
                      onClick={() => {
                        setShowTechnicianEditor(true);
                        setDrawerOpen(false);
                      }}
                    >
                      {t("technician.menu.edit")}
                    </button>
                  </div>
                )}
                <div className="app-drawer__about-item">
                  <span>{t("menu.about.iconSource")}</span>
                  <strong>
                    {iconCount} {t("snapshot.icons").toLowerCase()}
                  </strong>
                  <small>{iconSourceLabel}</small>
                </div>
                {iconDebugInfo && (
                  <div className="app-drawer__about-item">
                    <span>{t("menu.about.iconDebug")}</span>
                    <small>
                      BNB {iconDebugInfo.bnb ? t("common.yes") : t("common.no")} · PSA{" "}
                      {iconDebugInfo.psa ? t("common.yes") : t("common.no")} · CIP{" "}
                      {iconDebugInfo.cip ? t("common.yes") : t("common.no")}
                      {iconDebugInfo.lastModifiedLabel ? ` · mod ${iconDebugInfo.lastModifiedLabel}` : ""}
                    </small>
                  </div>
                )}
                <div className="app-drawer__about-item">
                  <span>{t("menu.about.build")}</span>
                  <strong>{BUILD_LABEL}</strong>
                </div>
              </div>
            )}
          </div>
        </main>
      )}

      <aside
        id="app-drawer"
        className={`app-drawer${drawerOpen ? " app-drawer--open" : ""}`}
        aria-hidden={!drawerOpen}
      >
        <div
          className="app-drawer__scrim"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
        <div
          className="app-drawer__panel"
          role="dialog"
          aria-modal="true"
          aria-label={t("menu.title")}
        >
          <div className="app-drawer__header">
            <h2>{t("menu.title")}</h2>
            <button
              type="button"
              className="app-drawer__close"
              onClick={() => setDrawerOpen(false)}
              aria-label={t("menu.close")}
            >
              ×
            </button>
          </div>

          <nav className="app-drawer__nav">
            <button
              type="button"
              className={`app-drawer__nav-button${currentView === "main" ? " app-drawer__nav-button--active" : ""}`}
              onClick={() => { setCurrentView("main"); setDrawerOpen(false); }}
            >
              {t("menu.section.main")}
            </button>
            <button
              type="button"
              className={`app-drawer__nav-button${currentView === "reports" ? " app-drawer__nav-button--active" : ""}`}
              onClick={() => { setCurrentView("reports"); setDrawerOpen(false); }}
            >
              {t("menu.section.reports")}
            </button>
            <button
              type="button"
              className={`app-drawer__nav-button${currentView === "admin" ? " app-drawer__nav-button--active" : ""}`}
              onClick={() => { setCurrentView("admin"); setDrawerOpen(false); }}
            >
              {t("menu.section.admin")}
            </button>
            <button
              type="button"
              className={`app-drawer__nav-button${currentView === "insights" ? " app-drawer__nav-button--active" : ""}`}
              onClick={() => { setCurrentView("insights"); setDrawerOpen(false); }}
            >
              {t("menu.section.insights")}
            </button>
            {showKnowledgeStudio && (
              <button
                type="button"
                className={`app-drawer__nav-button${currentView === "knowledge" ? " app-drawer__nav-button--active" : ""}`}
                onClick={() => { setCurrentView("knowledge"); setDrawerOpen(false); }}
              >
                {t("menu.section.knowledge")}
              </button>
            )}
            <button
              type="button"
              className={`app-drawer__nav-button${currentView === "about" ? " app-drawer__nav-button--active" : ""}`}
              onClick={() => { setCurrentView("about"); setDrawerOpen(false); }}
            >
              {t("menu.section.about")}
            </button>
          </nav>
        </div>
      </aside>

      <PlanViewerModal
        open={showPdfViewer}
        plan={plan}
        segmentation={segmentation}
        onClose={() => setShowPdfViewer(false)}
      />
      <PlanSegmentationModal
        key={activeProjectScope || "no-plan"}
        open={showSegmentationModal}
        buildLabel={BUILD_LABEL}
        deviceProgressByKey={activeOperationalProgress}
        iconDebugLabel={iconDebugLabel}
        iconSourceLabel={iconSourceLabel}
        projectProgressScope={activeProjectScope}
        projectProgressStatusLabel={projectProgressStatusLabel}
        plan={plan}
        records={bundle.records}
        rawIconMap={rawIconMap}
        segmentation={segmentation}
        visualKnowledgeIndex={effectiveVisualKnowledgeIndex}
        onChangeDeviceProgress={setOperationalDeviceProgress}
        onClose={() => setShowSegmentationModal(false)}
      />
      <TechnicianOnboardingModal
        open={technicianIdentityReady && !technicianIdentity}
        mode="onboarding"
        onSubmit={(name) => {
          setTechnicianIdentityFromName(name);
        }}
      />
      <TechnicianOnboardingModal
        open={showTechnicianEditor && Boolean(technicianIdentity)}
        mode="edit"
        existingIdentity={technicianIdentity}
        onSubmit={(name) => {
          setTechnicianIdentityFromName(name);
          setShowTechnicianEditor(false);
        }}
        onCancel={() => setShowTechnicianEditor(false)}
      />
    </div>
  );
}
