import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { attachIcons, buildMetrics, countBy, normalizeRows, parseTabularFile } from "./lib/normalize";
import { getNamePatternKnowledge } from "./lib/visual-knowledge";
import { loadIconsFromDirectory, loadIconsFromManifest, loadIconsFromZip, mergeIconMaps } from "./lib/icons";
import { loadPlan } from "./lib/pdf";
import type { DeviceCategory, DeviceRecord, ImportBundle, PlanData } from "./types";
import { mergeDeviceRecords } from "./modules/device-records";
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

const EMPTY_IMPORT: ImportBundle = {
  records: [],
  metrics: {
    totalDevices: 0,
    positionedDevices: 0,
    areas: 0,
    switches: 0,
    estimatedCables: 0,
    cameras: 0,
    monitors: 0
  },
  missingPositions: 0
};

const STORAGE_KEY = "cctv-field-task-statuses-v1";
const SHOW_FIELD_TASK_ICONS = false;
const BUILD_LABEL = __APP_BUILD_ID__.replace("T", " ").replace(/\.\d+Z$/, "Z");

function compactSwitchLabel(record: DeviceRecord): string {
  return switchDisplayLabel(record);
}

function fileLabel(file: File | null): string {
  return file ? file.name : "Sin archivo";
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
  const digest = await window.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
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

function categoryLabel(category: DeviceCategory): string {
  switch (category) {
    case "ptz":
      return "PTZ";
    case "camera":
      return "Camara";
    case "monitor":
      return "Monitor";
    case "mount":
      return "Mount";
    case "infrastructure":
      return "Infra";
    default:
      return "Revisar";
  }
}

function taskTitle(record: DeviceRecord): string {
  switch (record.category) {
    case "ptz":
      return "Instalar camara PTZ";
    case "camera":
      return "Instalar camara";
    case "monitor":
      return "Instalar monitor";
    case "infrastructure":
      return "Instalar equipo de soporte";
    default:
      return "Revisar punto";
  }
}

function primaryInstall(record: DeviceRecord): string {
  return record.iconDevice || record.partNumber || record.deviceTaskType || "Equipo por confirmar";
}

function shouldRenderRecordIcon(record: DeviceRecord): boolean {
  return SHOW_FIELD_TASK_ICONS && Boolean(record.iconUrl);
}

function cableNote(record: DeviceRecord): string {
  if (record.cables === 0) {
    return "Sin cable de red en esta regla";
  }
  if (record.cables === 2) {
    return "Correr 2 cables CAT5";
  }
  return "Correr 1 cable CAT5";
}

function stateLabel(value: TaskState): string {
  switch (value) {
    case "active":
      return "En proceso";
    case "done":
      return "Hecho";
    default:
      return "Pendiente";
  }
}

function normalizeState(raw: string | null | undefined): TaskState {
  if (raw === "active" || raw === "done") {
    return raw;
  }
  return "pending";
}

function ambiguityFor(record: DeviceRecord) {
  const knowledge = getNamePatternKnowledge(record.name);
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

function taskWarnings(record: DeviceRecord): string[] {
  const warnings: string[] = [];
  if (!record.partNumber) {
    warnings.push("Sin part number");
  }
  if (!hasSwitchAssignment(record)) {
    warnings.push("Sin switch asignado");
  }
  if (!record.hasPosition) {
    warnings.push("Sin ubicacion exacta en plano");
  }
  if (ambiguityFor(record)) {
    warnings.push("Validar visualmente en campo");
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

export default function App() {
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [extraDataFile, setExtraDataFile] = useState<File | null>(null);
  const [mappingFile, setMappingFile] = useState<File | null>(null);
  const [iconZipFile, setIconZipFile] = useState<File | null>(null);
  const [iconFolderFiles, setIconFolderFiles] = useState<File[]>([]);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [bundle, setBundle] = useState<ImportBundle>(EMPTY_IMPORT);
  const [insights, setInsights] = useState<ProjectInsights | null>(null);
  const [segmentation, setSegmentation] = useState<PlanSegmentation | null>(null);
  const [taskStates, setTaskStates] = useState<Record<string, TaskState>>({});
  const [selectedKey, setSelectedKey] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskState>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | DeviceCategory>("all");
  const [showPdfViewer, setShowPdfViewer] = useState(false);
  const [showSegmentationModal, setShowSegmentationModal] = useState(false);
  const [status, setStatus] = useState("Carga el PDF y pulsa Procesar.");
  const [processedAt, setProcessedAt] = useState("");
  const [iconCount, setIconCount] = useState(0);
  const [bundledIconCount, setBundledIconCount] = useState(0);
  const [iconFileFingerprint, setIconFileFingerprint] = useState("");
  const [iconDebugInfo, setIconDebugInfo] = useState<IconDebugInfo | null>(null);
  const [bundledIconMap, setBundledIconMap] = useState<Map<string, string>>(new Map());
  const [rawIconMap, setRawIconMap] = useState<Map<string, string>>(new Map());
  const [isBusy, setIsBusy] = useState(false);
  const iconFolderInputRef = useRef<HTMLInputElement | null>(null);
  const deferredSearch = useDeferredValue(search);
  const iconSourceLabel = useMemo(() => {
    const bundledLabel = bundledIconCount > 0 ? `Libreria interna · ${bundledIconCount} iconos` : "Libreria interna pendiente";
    if (iconZipFile) {
      const suffix = iconFileFingerprint ? ` · sha16 ${iconFileFingerprint}` : "";
      return `${bundledLabel} + ${iconZipFile.name} · ${formatFileSize(iconZipFile.size)}${suffix} · ${iconCount} iconos`;
    }
    if (iconFolderFiles.length > 0) {
      return `${bundledLabel} + folder extra · ${iconFolderFiles.length} archivos · ${iconCount} iconos`;
    }
    return bundledIconCount > 0 ? `${bundledLabel} · ${iconCount || bundledIconCount} iconos` : "Sin libreria de iconos cargada";
  }, [bundledIconCount, iconCount, iconFileFingerprint, iconFolderFiles.length, iconZipFile]);
  const iconDebugLabel = useMemo(() => {
    if (!iconDebugInfo) {
      return "";
    }
    const mod = iconDebugInfo.lastModifiedLabel ? ` · mod ${iconDebugInfo.lastModifiedLabel}` : "";
    return `Debug ZIP: BNB ${iconDebugInfo.bnb ? "si" : "no"} · PSA ${iconDebugInfo.psa ? "si" : "no"} · CIP ${iconDebugInfo.cip ? "si" : "no"}${mod}`;
  }, [iconDebugInfo]);

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
      Object.entries(parsed).forEach(([key, value]) => {
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
    if (bundle.records.length === 0) {
      return;
    }

    setBundle((current) => {
      if (current.records.length === 0) {
        return current;
      }

      const nextRecords = attachIcons(current.records, rawIconMap);
      const changed = nextRecords.some((record, index) => {
        const previous = current.records[index];
        return (
          previous?.iconUrl !== record.iconUrl ||
          previous?.iconDevice !== record.iconDevice ||
          previous?.partNumber !== record.partNumber ||
          previous?.cables !== record.cables
        );
      });

      if (!changed) {
        return current;
      }

      return {
        ...current,
        records: nextRecords,
      };
    });
  }, [rawIconMap]);

  useEffect(() => {
    return () => {
      if (plan?.blobUrl) {
        URL.revokeObjectURL(plan.blobUrl);
      }
    };
  }, [plan?.blobUrl]);

  async function handleProcess() {
    if (!planFile) {
      setStatus("Falta seleccionar el PDF del plano.");
      return;
    }

    setIsBusy(true);
    setShowPdfViewer(false);
    setStatus("Procesando PDF y datos...");

    try {
      const nextPlan = await loadPlan(planFile);
      const isExtraPdf = extraDataFile?.type === "application/pdf" ||
        extraDataFile?.name.toLowerCase().endsWith(".pdf");

      const [parsedPdf, primaryRows, parsedExtraPdf, extraRows] = await Promise.all([
        parsePdfDataRecords(planFile, nextPlan.markers),
        dataFile ? parseTabularFile(dataFile) : Promise.resolve([]),
        extraDataFile && isExtraPdf ? parsePdfDataRecords(extraDataFile, nextPlan.markers, 1) : Promise.resolve(null),
        extraDataFile && !isExtraPdf ? parseTabularFile(extraDataFile) : Promise.resolve([])
      ]);

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

      // Aplicar la semilla visual siempre, aunque no haya iconos cargados,
      // para que segmentacion y conteos usen el part number normalizado.
      records = attachIcons(records, new Map());

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
        records = attachIcons(records, nextRawIconMap);
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
        records = attachIcons(records, nextRawIconMap);
        nextIconCount = nextRawIconMap.size;
        nextIconDebugInfo = buildIconDebugInfo(nextRawIconMap);
        console.log("[icons] Carpeta cargada:", nextRawIconMap.size, "entradas. Primeras 8 claves:", Array.from(nextRawIconMap.keys()).slice(0, 8));
      } else if (records.length > 0 && nextBundledMap.size > 0) {
        records = attachIcons(records, nextBundledMap);
      } else {
        console.log("[icons] Sin ZIP ni carpeta. iconZipFile:", !!iconZipFile, "iconFolderFiles:", iconFolderFiles.length);
      }

      const nextBundle = {
        records,
        metrics: buildMetrics(records),
        missingPositions: records.filter((record) => !record.hasPosition).length
      };
      const nextSegmentation = buildPlanSegmentation(records, nextPlan);
      const nextInsights = buildProjectInsights(records, {
        dataPages: parsedPdf.dataPages,
        rawRows: parsedPdf.rawRows,
        recordsParsed: records.length,
        template: parsedPdf.template
      }, nextSegmentation);

      startTransition(() => {
        if (plan?.blobUrl) {
          URL.revokeObjectURL(plan.blobUrl);
        }
        setPlan(nextPlan);
        setBundle(nextBundle);
        setInsights(nextInsights);
        setSegmentation(nextSegmentation);
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
            ? `Listo. ${records.length} registros · ${parsedPdf.dataPages} pags. datos · ${nextPlan.markers.size} marcadores · ${nextIconCount} iconos disponibles${extraDataFile ? ` · extra: ${parsedExtraPdf?.records.length ?? extraRows.length} reg.` : ""}.`
            : `Listo. Sin registros. Marcadores: ${nextPlan.markers.size}. Iconos disponibles: ${nextIconCount}.`
        );
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No pude procesar el plano.");
    } finally {
      setIsBusy(false);
    }
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
      primaryInstall(record).toLowerCase().includes(searchValue) ||
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

  const selectedWarnings = selectedRecord ? taskWarnings(selectedRecord) : [];
  const selectedAmbiguity = selectedRecord ? ambiguityFor(selectedRecord) : null;
  const canViewPlan = Boolean(plan?.viewerUrl);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>CCTV Field Planner</h1>
        </div>
        <div className="status-block">
          <span className={`status-pill ${isBusy ? "status-pill--busy" : ""}`}>{status}</span>
          {processedAt && <span className="status-note">Ultimo proceso: {processedAt}</span>}
        </div>
      </header>

      <section className="ingest-card">
        <div className="ingest-card__header">
          <div>
            <p className="eyebrow">Entrada</p>
            <h2>Cargar proyecto</h2>
          </div>
          <div className="ingest-card__actions">
            <button type="button" className="primary-action" disabled={isBusy || !planFile} onClick={handleProcess}>
              {isBusy ? "Procesando..." : "Procesar"}
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={!canViewPlan}
              onClick={() => setShowPdfViewer(true)}
            >
              Ver pagina 1
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={!canViewPlan || !segmentation}
              onClick={() => setShowSegmentationModal(true)}
            >
              Ver segmentacion
            </button>
          </div>
        </div>

        <div className="upload-grid">
          <label className="upload-card">
            <span>PDF del plano</span>
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => setPlanFile(event.target.files?.[0] || null)}
            />
            <strong>{fileLabel(planFile)}</strong>
          </label>
          <label className="upload-card">
            <span>CSV base (opcional)</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setDataFile(event.target.files?.[0] || null)}
            />
            <strong>{fileLabel(dataFile)}</strong>
          </label>
          <label className="upload-card">
            <span>PDF / CSV adicional (opcional)</span>
            <input
              type="file"
              accept="application/pdf,.pdf,.csv,text/csv"
              onChange={(event) => setExtraDataFile(event.target.files?.[0] || null)}
            />
            <strong>{fileLabel(extraDataFile)}</strong>
          </label>
          <label className="upload-card">
            <span>CSV de partes / iconos</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setMappingFile(event.target.files?.[0] || null)}
            />
            <strong>{fileLabel(mappingFile)}</strong>
          </label>
          <label className="upload-card">
            <span>ZIP de iconos extra (opcional)</span>
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
            <strong>{fileLabel(iconZipFile)}</strong>
            <small>Libreria interna incluida; usa esto solo para iconos extra.</small>
          </label>
          <label className="upload-card">
            <span>Folder de iconos extra (opcional)</span>
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
            <strong>{iconFolderFiles.length ? `${iconFolderFiles.length} archivos` : "Sin folder"}</strong>
            <small>Opcional. Sirve para agregar o corregir iconos nuevos.</small>
          </label>
        </div>
      </section>

      <ProjectInsightsPanel insights={insights} />

      <section className="snapshot-grid">
        <article className="snapshot-card">
          <span>Pendientes</span>
          <strong>{taskStateCounts.pending}</strong>
        </article>
        <article className="snapshot-card">
          <span>En proceso</span>
          <strong>{taskStateCounts.active}</strong>
        </article>
        <article className="snapshot-card">
          <span>Hechas</span>
          <strong>{taskStateCounts.done}</strong>
        </article>
        <article className="snapshot-card">
          <span>Con posicion</span>
          <strong>{insights?.totals.positioned ?? bundle.metrics.positionedDevices}</strong>
        </article>
        <article className="snapshot-card">
          <span>Sin switch</span>
          <strong>{insights?.review.missingSwitch ?? 0}</strong>
        </article>
        <article className="snapshot-card">
          <span>Iconos</span>
          <strong>{iconCount}</strong>
          <small style={{ color: "rgba(255,255,255,0.56)", lineHeight: 1.3 }}>{iconSourceLabel}</small>
          {iconDebugInfo && (
            <small style={{ color: "rgba(255,255,255,0.44)", lineHeight: 1.3 }}>
              BNB {iconDebugInfo.bnb ? "si" : "no"} · PSA {iconDebugInfo.psa ? "si" : "no"} · CIP {iconDebugInfo.cip ? "si" : "no"}
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
              <p className="eyebrow">Trabajo</p>
              <h2>Field Tasks</h2>
            </div>
            <button
              type="button"
              className="secondary-action"
              disabled={!canViewPlan}
              onClick={() => setShowPdfViewer(true)}
            >
              Plano pagina 1
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={!canViewPlan || !segmentation}
              onClick={() => setShowSegmentationModal(true)}
            >
              Segmentacion
            </button>
          </div>

          <div className="filter-row">
            <input
              className="search-input"
              type="search"
              placeholder="Buscar tarea, area, switch o equipo"
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
                {value === "all" ? "Todas" : stateLabel(value)}
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
                {value === "all" ? "Categorias" : categoryLabel(value)}
              </button>
            ))}
          </div>

          <div className="task-list">
            {orderedRecords.length === 0 && (
              <div className="empty-inline">
                No hay tareas visibles. Procesa el proyecto o cambia los filtros.
              </div>
            )}

            {orderedRecords.map((record) => {
              const currentState = getTaskState(record);
              const warnings = taskWarnings(record);
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
                        <img src={record.iconUrl} alt={primaryInstall(record)} />
                      ) : (
                        <span>{record.id ?? categoryLabel(record.category).slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="task-card__copy">
                      <strong>{record.name || `ID ${record.id}`}</strong>
                      <span>{taskTitle(record)}</span>
                    </div>
                    <span className={`state-pill state-pill--${currentState}`}>{stateLabel(currentState)}</span>
                  </div>

                  <div className="task-card__meta">
                    <span>Equipo: {primaryInstall(record)}</span>
                    <span>Part: {record.partNumber || "Sin dato"}</span>
                    <span>Area: {record.area}</span>
                    <span>Red: {compactSwitchLabel(record)}</span>
                    <span>{cableNote(record)}</span>
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
              <p className="eyebrow">Detalle</p>
              <h2>Punto de instalacion</h2>
            </div>
          </div>

          {selectedRecord ? (
            <div className="detail-stack">
              <section className="focus-card">
                <div className="focus-card__top">
                  <div className="task-card__icon task-card__icon--large">
                    {shouldRenderRecordIcon(selectedRecord) ? (
                      <img src={selectedRecord.iconUrl} alt={primaryInstall(selectedRecord)} />
                    ) : (
                      <span>{selectedRecord.id ?? categoryLabel(selectedRecord.category).slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>
                  <div>
                    <p className="eyebrow">{stateLabel(getTaskState(selectedRecord))}</p>
                    <h3>{selectedRecord.name || `ID ${selectedRecord.id}`}</h3>
                    <p>{taskTitle(selectedRecord)}</p>
                  </div>
                </div>

                <div className="detail-actions">
                  <button
                    type="button"
                    className={`state-button ${getTaskState(selectedRecord) === "pending" ? "state-button--active" : ""}`}
                    onClick={() => updateTaskState(selectedRecord.key, "pending")}
                  >
                    Pendiente
                  </button>
                  <button
                    type="button"
                    className={`state-button ${getTaskState(selectedRecord) === "active" ? "state-button--active" : ""}`}
                    onClick={() => updateTaskState(selectedRecord.key, "active")}
                  >
                    En proceso
                  </button>
                  <button
                    type="button"
                    className={`state-button ${getTaskState(selectedRecord) === "done" ? "state-button--active" : ""}`}
                    onClick={() => updateTaskState(selectedRecord.key, "done")}
                  >
                    Hecho
                  </button>
                </div>
              </section>

              <section className="instruction-card">
                <h3>Accion recomendada</h3>
                <ul className="instruction-list">
                  <li>Instalar: {primaryInstall(selectedRecord)}</li>
                  <li>Ubicacion: {selectedRecord.area}</li>
                  <li>Red: {compactSwitchLabel(selectedRecord)}</li>
                  <li>Cableado: {cableNote(selectedRecord)}</li>
                  <li>Referencia: pagina {selectedRecord.sourcePage ?? 1}</li>
                </ul>
              </section>

              <section className="detail-grid">
                <article>
                  <span>ID</span>
                  <strong>{selectedRecord.id ?? "Sin ID"}</strong>
                </article>
                <article>
                  <span>Equipo</span>
                  <strong>{primaryInstall(selectedRecord)}</strong>
                </article>
                <article>
                  <span>Icon device</span>
                  <strong>{selectedRecord.iconDevice || "Sin dato"}</strong>
                </article>
                <article>
                  <span>Part number</span>
                  <strong>{selectedRecord.partNumber || "Sin dato"}</strong>
                </article>
                <article>
                  <span>Switch / hub</span>
                  <strong>{compactSwitchLabel(selectedRecord)}</strong>
                </article>
                <article>
                  <span>Cables</span>
                  <strong>{selectedRecord.cables}</strong>
                </article>
                <article>
                  <span>Posicion en plano</span>
                  <strong>{selectedRecord.hasPosition ? "Si" : "No"}</strong>
                </article>
              </section>

              {selectedAmbiguity && (
                <section className="instruction-card instruction-card--warning">
                  <h3>Opciones por validar</h3>
                  <ul className="instruction-list">
                    {selectedAmbiguity.candidatePartNumbers.length > 1 && (
                      <li>
                        Part numbers posibles: {selectedAmbiguity.candidatePartNumbers.join(" / ")}
                      </li>
                    )}
                    {selectedAmbiguity.candidateIconDevices.length > 1 && (
                      <li>
                        Icon devices posibles: {selectedAmbiguity.candidateIconDevices.join(" / ")}
                      </li>
                    )}
                    <li>Confirmar visualmente en campo antes de cerrar este punto.</li>
                  </ul>
                </section>
              )}

              {selectedWarnings.length > 0 && (
                <section className="instruction-card instruction-card--warning">
                  <h3>Alertas</h3>
                  <ul className="instruction-list">
                    {selectedWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="instruction-card">
                <h3>Referencia del proyecto</h3>
                <p className="reference-line">
                  Switches: {summaryLine(topSwitches, "Sin datos")}
                </p>
                <p className="reference-line">Areas: {summaryLine(topAreas, "Sin datos")}</p>
                <p className="reference-line">
                  Part numbers: {summaryLine(topParts, "Sin datos")}
                </p>
                <div className="detail-actions">
                  <button
                    type="button"
                    className="primary-action"
                    disabled={!canViewPlan}
                    onClick={() => setShowPdfViewer(true)}
                  >
                    Ver plano
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
                    Abrir PDF
                  </button>
                </div>
              </section>
            </div>
          ) : (
            <div className="detail-empty">
              Selecciona una tarea para ver qué instalar, cuántos cables correr y qué revisar.
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
        open={showSegmentationModal}
        buildLabel={BUILD_LABEL}
        iconDebugLabel={iconDebugLabel}
        iconSourceLabel={iconSourceLabel}
        plan={plan}
        records={bundle.records}
        rawIconMap={rawIconMap}
        segmentation={segmentation}
        onClose={() => setShowSegmentationModal(false)}
      />
    </div>
  );
}
