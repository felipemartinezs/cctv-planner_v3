import Papa from "papaparse";
import type { DeviceCategory, DeviceRecord, Metrics, PlanMarker } from "../types";
import { buildSwitchIdentity, switchDisplayLabel } from "../modules/switch-segmentation";
import { matchDeviceRule } from "../config/device-rules";
import { estimateNetworkCables } from "./cable-planning";
import { lookupIcon, normalizeIconKey } from "./icons";
import { contextualizeIconDeviceForInstallation, resolveInstallationSpec } from "./installation-rules";
import { getNamePatternKnowledge, resolveRecordVisualKnowledge } from "./visual-knowledge";

const HEADER_ALIASES: Record<string, string[]> = {
  id: ["id", "index"],
  name: ["name"],
  abbreviatedName: ["abbreviated_name"],
  partNumber: ["part_number", "partnumber"],
  hub: ["hub"],
  switchName: ["switch", "switch_name"],
  x: ["x"],
  y: ["y"],
  sourcePage: ["source_page", "page"],
  iconDevice: ["icon_device"],
  deviceTaskType: ["device_task_type", "device_type", "type"]
};

const PREFIXES = new Set([
  "AA",
  "EMGX",
  "ENT",
  "EXT",
  "FRNT",
  "INT",
  "MONITOR",
  "POS",
  "PTZ",
  "PVM",
  "RX",
  "SAL",
  "STK",
  "VMS"
]);

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeToken(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function detectHeaderLine(rawText: string): string {
  const lines = rawText.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    const normalized = line.toLowerCase();
    return (
      line.includes(",") &&
      (normalized.includes("part") ||
        normalized.includes("name") ||
        normalized.includes("switch") ||
        normalized.includes("hub"))
    );
  });
  return headerIndex === -1 ? rawText : lines.slice(headerIndex).join("\n");
}

function findCell(row: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    if (alias in row && normalizeToken(row[alias])) {
      return normalizeToken(row[alias]);
    }
  }
  return "";
}

function parseCsvText(rawText: string): Record<string, string>[] {
  const trimmed = detectHeaderLine(rawText);
  const parsed = Papa.parse<Record<string, string>>(trimmed, {
    header: true,
    skipEmptyLines: true
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message || "No pude leer el CSV.");
  }

  return parsed.data.map((row) => {
    const normalizedRow: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      normalizedRow[normalizeHeader(key)] = normalizeToken(value || "");
    }
    return normalizedRow;
  });
}

export async function parseTabularFile(file: File): Promise<Record<string, string>[]> {
  const text = await file.text();
  return parseCsvText(text);
}

function toNumber(value: string): number | null {
  const compact = value.replace(/,/g, "");
  if (!compact) {
    return null;
  }

  const parsed = Number(compact);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildRecordKey(id: number | null, name: string, rowIndex: number): string {
  if (id !== null) {
    return `id:${id}`;
  }
  if (name) {
    return `name:${normalizeKey(name)}`;
  }
  return `row:${rowIndex}`;
}

function extractArea(name: string): string {
  const compact = name.replace(/\s+/g, "_");
  const rawTokens = compact
    .split(/[_/]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const filtered = rawTokens.filter((token) => {
    if (PREFIXES.has(token)) {
      return false;
    }
    if (/^\d+$/.test(token)) {
      return false;
    }
    if (/^\d+\d$/.test(token)) {
      return false;
    }
    return true;
  });

  return filtered.length > 0 ? filtered.join(" ") : "SIN AREA";
}

function categorizeRecord(
  partNumber: string,
  deviceTaskType: string,
  name: string
): DeviceCategory {
  const source = `${partNumber} ${deviceTaskType} ${name}`.toUpperCase();

  if (source.includes("MOUNT")) {
    return "mount";
  }
  if (source.includes("PTZ") || source.includes("QNP6250")) {
    return "ptz";
  }
  if (
    source.includes("MONITOR") ||
    source.includes("PVM") ||
    source.includes("GVM32") ||
    source.includes("MCLV-")
  ) {
    return "monitor";
  }
  if (
    source.includes("NDS-") ||
    source.includes("NDE-") ||
    source.includes("NDV-") ||
    source.includes("NBN-") ||
    source.includes("CIP-QND") ||
    source.includes("BNB-") ||
    source.includes("PSA-") ||
    source.includes("CIP-AX") ||
    source.includes("MCLB-")
  ) {
    return "camera";
  }
  if (source.includes("3680") || source.includes("CONTROL BOARD") || source.includes("DVR")) {
    return "infrastructure";
  }
  return "unknown";
}

function fillPositionFromPdf(id: number | null, markers: Map<number, PlanMarker>): PlanMarker | null {
  if (id === null) {
    return null;
  }
  return markers.get(id) || null;
}

function mergeValue(current: string, next: string): string {
  return current || next;
}

function mergeNumber(current: number | null, next: number | null): number | null {
  return current ?? next;
}

function lookupExactIcon(iconMap: Map<string, string>, value: string): string {
  if (!value) {
    return "";
  }
  return iconMap.get(normalizeIconKey(value)) ?? "";
}

export function normalizeRows(
  primaryRows: Record<string, string>[],
  secondaryRows: Record<string, string>[],
  markers: Map<number, PlanMarker>
): DeviceRecord[] {
  const merged = new Map<string, DeviceRecord>();

  const allRows = [...primaryRows, ...secondaryRows];

  allRows.forEach((row, rowIndex) => {
    const id = toNumber(findCell(row, HEADER_ALIASES.id));
    const name = findCell(row, HEADER_ALIASES.name);
    const abbreviatedName = findCell(row, HEADER_ALIASES.abbreviatedName);
    const partNumber = findCell(row, HEADER_ALIASES.partNumber);
    const hub = findCell(row, HEADER_ALIASES.hub);
    const switchName = findCell(row, HEADER_ALIASES.switchName);
    const switchIdentity = buildSwitchIdentity(switchName || hub);
    const x = toNumber(findCell(row, HEADER_ALIASES.x));
    const y = toNumber(findCell(row, HEADER_ALIASES.y));
    const sourcePage = toNumber(findCell(row, HEADER_ALIASES.sourcePage));
    const iconDevice = findCell(row, HEADER_ALIASES.iconDevice);
    const deviceTaskType = findCell(row, HEADER_ALIASES.deviceTaskType);
    const key = buildRecordKey(id, name, rowIndex);

    const marker = (x !== null && y !== null) ? null : fillPositionFromPdf(id, markers);
    const resolvedName = name || abbreviatedName;
    const deviceRule = matchDeviceRule(resolvedName);
    const resolvedPartNumber = partNumber || deviceRule?.inferredPartNumber || "";
    const resolvedIconDevice = iconDevice || deviceRule?.inferredIconDevice || "";
    const resolvedCategory = categorizeRecord(resolvedPartNumber, deviceTaskType, resolvedName);
    const area = extractArea(resolvedName);
    const installationSpec = resolveInstallationSpec({
      area,
      category: resolvedCategory,
      iconDevice: resolvedIconDevice,
      name: resolvedName,
      partNumber: resolvedPartNumber,
    });
    const contextualIconDevice = contextualizeIconDeviceForInstallation({
      iconDevice: resolvedIconDevice,
      installationSpec,
      partNumber: resolvedPartNumber,
    });
    const finalInstallationSpec =
      contextualIconDevice === resolvedIconDevice
        ? installationSpec
        : resolveInstallationSpec({
            area,
            category: resolvedCategory,
            iconDevice: contextualIconDevice,
            name: resolvedName,
            partNumber: resolvedPartNumber,
          });
    const baseRecord: DeviceRecord = {
      key,
      id,
      name: resolvedName,
      abbreviatedName,
      partNumber: resolvedPartNumber,
      hub,
      switchName: switchIdentity.code,
      switchFamily: switchIdentity.family,
      switchSegment: switchIdentity.segmentLabel,
      x: x ?? marker?.x ?? null,
      y: y ?? marker?.y ?? null,
      sourcePage,
      iconDevice: contextualIconDevice,
      deviceTaskType,
      area,
      category: resolvedCategory,
      cables: estimateNetworkCables(resolvedName, resolvedPartNumber, resolvedCategory),
      mountHeightFt: finalInstallationSpec.mountHeightFt,
      mountHeightNeedsFieldValidation: finalInstallationSpec.mountHeightNeedsFieldValidation,
      mountHeightRuleKey: finalInstallationSpec.mountHeightRuleKey,
      hasPosition: (x ?? marker?.x ?? null) !== null && (y ?? marker?.y ?? null) !== null,
      iconUrl: "",
      raw: row
    };

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, baseRecord);
      return;
    }

    const nextCategory =
      existing.category === "unknown" ? resolvedCategory : existing.category;
    const nextName = mergeValue(existing.name, baseRecord.name);
    const nextPart = mergeValue(existing.partNumber, baseRecord.partNumber);
    const nextIconDevice = mergeValue(existing.iconDevice, baseRecord.iconDevice);
    const nextArea = existing.area === "SIN AREA" ? baseRecord.area : existing.area;
    const nextInstallationSpec = resolveInstallationSpec({
      area: nextArea,
      category: nextCategory,
      iconDevice: nextIconDevice,
      name: nextName,
      partNumber: nextPart,
    });
    const mergedContextualIconDevice = contextualizeIconDeviceForInstallation({
      iconDevice: nextIconDevice,
      installationSpec: nextInstallationSpec,
      partNumber: nextPart,
    });
    const mergedInstallationSpec =
      mergedContextualIconDevice === nextIconDevice
        ? nextInstallationSpec
        : resolveInstallationSpec({
            area: nextArea,
            category: nextCategory,
            iconDevice: mergedContextualIconDevice,
            name: nextName,
            partNumber: nextPart,
          });

    merged.set(key, {
      ...existing,
      name: nextName,
      abbreviatedName: mergeValue(existing.abbreviatedName, baseRecord.abbreviatedName),
      partNumber: nextPart,
      hub: mergeValue(existing.hub, baseRecord.hub),
      switchName: mergeValue(existing.switchName, baseRecord.switchName),
      switchFamily: mergeValue(existing.switchFamily, baseRecord.switchFamily),
      switchSegment: mergeValue(existing.switchSegment, baseRecord.switchSegment),
      x: mergeNumber(existing.x, baseRecord.x),
      y: mergeNumber(existing.y, baseRecord.y),
      sourcePage: mergeNumber(existing.sourcePage, baseRecord.sourcePage),
      iconDevice: mergedContextualIconDevice,
      deviceTaskType: mergeValue(existing.deviceTaskType, baseRecord.deviceTaskType),
      area: nextArea,
      category: nextCategory,
      cables: estimateNetworkCables(nextName, nextPart, nextCategory),
      mountHeightFt: mergedInstallationSpec.mountHeightFt,
      mountHeightNeedsFieldValidation: mergedInstallationSpec.mountHeightNeedsFieldValidation,
      mountHeightRuleKey: mergedInstallationSpec.mountHeightRuleKey,
      hasPosition:
        mergeNumber(existing.x, baseRecord.x) !== null &&
        mergeNumber(existing.y, baseRecord.y) !== null,
      raw: {
        ...baseRecord.raw,
        ...existing.raw
      }
    });
  });

  return Array.from(merged.values()).sort((left, right) => {
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
}

export function attachIcons(
  records: DeviceRecord[],
  iconMap: Map<string, string>
): DeviceRecord[] {
  return records.map((record) => {
    const knowledge = resolveRecordVisualKnowledge(record);
    const nameKnowledge = getNamePatternKnowledge(record.name);
    const resolvedPartNumber = knowledge?.partNumber || record.partNumber;
    const resolvedIconDevice = knowledge?.iconDevice || record.iconDevice;
    const installationSpec = resolveInstallationSpec({
      area: record.area,
      category: record.category,
      iconDevice: resolvedIconDevice,
      name: record.name,
      partNumber: resolvedPartNumber,
    });
    const contextualIconDevice = contextualizeIconDeviceForInstallation({
      iconDevice: resolvedIconDevice,
      installationSpec,
      partNumber: resolvedPartNumber,
    });
    const finalInstallationSpec =
      contextualIconDevice === resolvedIconDevice
        ? installationSpec
        : resolveInstallationSpec({
            area: record.area,
            category: record.category,
            iconDevice: contextualIconDevice,
            name: record.name,
            partNumber: resolvedPartNumber,
          });
    const preferredAmbiguousIcon =
      !knowledge &&
      nameKnowledge &&
      (nameKnowledge.candidatePartNumbers.length > 1 ||
        nameKnowledge.candidateIconDevices.length > 1)
        ? nameKnowledge.suggestedIconDevice
        : "";
    const iconUrl = knowledge
      ? lookupExactIcon(iconMap, contextualIconDevice) ||
        lookupExactIcon(iconMap, resolvedPartNumber) ||
        lookupIcon(iconMap, contextualIconDevice) ||
        lookupIcon(iconMap, resolvedPartNumber) ||
        lookupIcon(iconMap, record.deviceTaskType)
      : lookupExactIcon(iconMap, preferredAmbiguousIcon) ||
        lookupIcon(iconMap, preferredAmbiguousIcon) ||
        lookupExactIcon(iconMap, contextualIconDevice) ||
        lookupExactIcon(iconMap, resolvedPartNumber) ||
        lookupIcon(iconMap, contextualIconDevice) ||
        lookupIcon(iconMap, resolvedPartNumber) ||
        lookupIcon(iconMap, record.deviceTaskType);

    return {
      ...record,
      cables: estimateNetworkCables(record.name, resolvedPartNumber, record.category),
      iconDevice: contextualIconDevice,
      mountHeightFt: finalInstallationSpec.mountHeightFt,
      mountHeightNeedsFieldValidation: finalInstallationSpec.mountHeightNeedsFieldValidation,
      mountHeightRuleKey: finalInstallationSpec.mountHeightRuleKey,
      partNumber: resolvedPartNumber,
      iconUrl
    };
  });
}

export function buildMetrics(records: DeviceRecord[]): Metrics {
  const areas = new Set(records.map((record) => record.area));
  const switches = new Set(
    records
      .map((record) => switchDisplayLabel(record, ""))
      .filter(Boolean)
      .map((value) => value.toUpperCase())
  );

  let cameras = 0;
  let monitors = 0;
  let estimatedCables = 0;

  records.forEach((record) => {
    if (record.category === "camera" || record.category === "ptz") {
      cameras += 1;
    }
    if (record.category === "monitor") {
      monitors += 1;
    }
    estimatedCables += record.cables;
  });

  return {
    totalDevices: records.length,
    positionedDevices: records.filter((record) => record.hasPosition).length,
    areas: areas.size,
    switches: switches.size,
    estimatedCables,
    cameras,
    monitors
  };
}

export function countBy(records: DeviceRecord[], field: "switchName" | "partNumber" | "area") {
  const counter = new Map<string, number>();
  records.forEach((record) => {
    const rawValue = record[field] || "SIN DATO";
    const value = normalizeToken(rawValue);
    counter.set(value, (counter.get(value) || 0) + 1);
  });
  return Array.from(counter.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8);
}
