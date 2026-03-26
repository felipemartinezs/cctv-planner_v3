import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFPageProxy, TextItem } from "pdfjs-dist/types/src/display/api";
import type { DeviceCategory, DeviceRecord, PlanMarker } from "../../types";
import { buildSwitchIdentity } from "../switch-segmentation";
import type { PdfDataParseResult, PdfDataTemplate } from "./types";
import { matchDeviceRule } from "../../config/device-rules";
import { estimateNetworkCables } from "../../lib/cable-planning";
import { readFileAsArrayBuffer } from "../../lib/file-io";
import { contextualizeIconDeviceForInstallation, resolveInstallationSpec } from "../../lib/installation-rules";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

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

const LINE_Y_TOLERANCE = 2;
const ROW_Y_TOLERANCE = 15;

interface TextFragment {
  text: string;
  x: number;
  y: number;
}

interface TextLine {
  id: number | null;
  items: TextFragment[];
  rawText: string;
  y: number;
}

function normalizeToken(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function appendFragment(current: string, next: string): string {
  const incoming = normalizeToken(next);
  if (!incoming) {
    return current;
  }
  if (!current) {
    return incoming;
  }
  if (
    current.endsWith("_") ||
    current.endsWith("-") ||
    incoming.startsWith("_") ||
    incoming.startsWith(")") ||
    incoming.startsWith(".")
  ) {
    return `${current}${incoming}`;
  }
  return `${current} ${incoming}`;
}

function textItemToFragment(item: TextItem): TextFragment | null {
  const text = normalizeToken(item.str);
  if (!text) {
    return null;
  }

  return {
    text,
    x: item.transform[4],
    y: item.transform[5]
  };
}

function detectLineId(line: TextLine): number | null {
  const match = line.items.find((item) => item.x < 65 && /^\d{1,3}$/.test(item.text));
  return match ? Number(match.text) : null;
}

function buildLines(items: TextItem[]): TextLine[] {
  const fragments = items
    .map(textItemToFragment)
    .filter((item): item is TextFragment => Boolean(item))
    .sort((left, right) => {
      if (right.y !== left.y) {
        return right.y - left.y;
      }
      return left.x - right.x;
    });

  const lines: TextLine[] = [];

  fragments.forEach((fragment) => {
    const current = lines.length > 0 ? lines[lines.length - 1] : undefined;
    if (current && Math.abs(current.y - fragment.y) <= LINE_Y_TOLERANCE) {
      current.items.push(fragment);
      return;
    }

    lines.push({
      id: null,
      items: [fragment],
      rawText: "",
      y: fragment.y
    });
  });

  return lines.map((line) => {
    const sortedItems = [...line.items].sort((left, right) => left.x - right.x);
    const rawText = sortedItems.map((item) => item.text).join(" ");
    const nextLine = {
      ...line,
      items: sortedItems,
      rawText
    };

    return {
      ...nextLine,
      id: detectLineId(nextLine)
    };
  });
}

async function getPageTextContentCompat(page: PDFPageProxy) {
  const anyPage = page as PDFPageProxy & {
    streamTextContent?: (params?: Record<string, unknown>) => ReadableStream<{
      items: TextItem[];
      lang?: string | null;
      styles?: Record<string, unknown>;
    }>;
  };

  if (typeof anyPage.streamTextContent === "function" && typeof ReadableStream !== "undefined") {
    const readableStream = anyPage.streamTextContent({});
    if (readableStream && typeof readableStream.getReader === "function") {
      const reader = readableStream.getReader();
      const textContent = {
        items: [] as TextItem[],
        styles: Object.create(null) as Record<string, unknown>,
        lang: null as string | null,
      };

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        const value = chunk.value;
        if (!value) {
          continue;
        }
        if (textContent.lang == null && typeof value.lang === "string") {
          textContent.lang = value.lang;
        }
        if (value.styles && typeof value.styles === "object") {
          Object.assign(textContent.styles, value.styles);
        }
        if (Array.isArray(value.items)) {
          for (let index = 0; index < value.items.length; index += 1) {
            textContent.items.push(value.items[index]);
          }
        }
      }

      return textContent;
    }
  }

  return page.getTextContent();
}

function detectTemplate(lines: TextLine[]): PdfDataTemplate {
  const text = lines
    .slice(0, 12)
    .map((line) => line.rawText.toLowerCase())
    .join(" ");

  if (text.includes("abbreviated name") && text.includes("device/task type")) {
    return "rich-table";
  }
  if (text.includes("part number") && text.includes("hub")) {
    return "simple-table";
  }
  return "unknown";
}

function isHeaderLine(line: TextLine): boolean {
  const text = line.rawText.toLowerCase();
  return (
    text.includes("part number") ||
    text.includes("device/task type") ||
    text.includes("abbreviated name") ||
    text === "name"
  );
}

function columnFor(
  template: PdfDataTemplate,
  x: number
): "name" | "abbreviatedName" | "deviceTaskType" | "partNumber" | "hub" | null {
  if (template === "rich-table") {
    if (x >= 100 && x < 240) {
      return "name";
    }
    if (x >= 240 && x < 370) {
      return "abbreviatedName";
    }
    if (x >= 370 && x < 505) {
      return "deviceTaskType";
    }
    if (x >= 505 && x < 640) {
      return "partNumber";
    }
    if (x >= 640) {
      return "hub";
    }
    return null;
  }

  if (x >= 110 && x < 330) {
    return "name";
  }
  if (x >= 330 && x < 540) {
    return "partNumber";
  }
  if (x >= 540) {
    return "hub";
  }
  return null;
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

function lineDistance(startY: number, candidateY: number): number {
  return Math.abs(startY - candidateY);
}

function lineBuckets(
  template: PdfDataTemplate,
  lines: TextLine[]
): Record<"name" | "abbreviatedName" | "deviceTaskType" | "partNumber" | "hub", TextFragment[]> {
  const buckets = {
    name: [] as TextFragment[],
    abbreviatedName: [] as TextFragment[],
    deviceTaskType: [] as TextFragment[],
    partNumber: [] as TextFragment[],
    hub: [] as TextFragment[]
  };

  lines.forEach((line) => {
    line.items.forEach((item) => {
      const column = columnFor(template, item.x);
      if (!column) {
        return;
      }
      buckets[column].push(item);
    });
  });

  return buckets;
}

function joinFragments(items: TextFragment[]): string {
  return [...items]
    .sort((left, right) => {
      if (right.y !== left.y) {
        return right.y - left.y;
      }
      return left.x - right.x;
    })
    .reduce((accumulator, item) => appendFragment(accumulator, item.text), "");
}

function buildRecord(
  id: number,
  pageNumber: number,
  template: PdfDataTemplate,
  lines: TextLine[],
  markers: Map<number, PlanMarker>
): DeviceRecord | null {
  const buckets = lineBuckets(template, lines);
  const name = joinFragments(buckets.name);
  const abbreviatedName = joinFragments(buckets.abbreviatedName);
  const deviceTaskType = joinFragments(buckets.deviceTaskType);
  const partNumber = joinFragments(buckets.partNumber);
  const hub = joinFragments(buckets.hub);

  if (!name && !abbreviatedName && !partNumber && !hub) {
    return null;
  }

  const marker = markers.get(id) || null;
  const resolvedName = name || abbreviatedName || `ID ${id}`;
  const deviceRule = matchDeviceRule(resolvedName);
  const resolvedPartNumber = partNumber || deviceRule?.inferredPartNumber || "";
  const category = categorizeRecord(resolvedPartNumber, deviceTaskType, resolvedName);
  const switchIdentity = buildSwitchIdentity(hub);
  const area = extractArea(resolvedName);
  const resolvedIconDevice = deviceRule?.inferredIconDevice || deviceTaskType || resolvedPartNumber;
  const installationSpec = resolveInstallationSpec({
    area,
    category,
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
          category,
          iconDevice: contextualIconDevice,
          name: resolvedName,
          partNumber: resolvedPartNumber,
        });

  return {
    key: `id:${id}`,
    id,
    name: resolvedName,
    abbreviatedName,
    partNumber: resolvedPartNumber,
    hub,
    switchName: switchIdentity.code,
    switchFamily: switchIdentity.family,
    switchSegment: switchIdentity.segmentLabel,
    x: marker?.x ?? null,
    y: marker?.y ?? null,
    sourcePage: pageNumber,
    iconDevice: contextualIconDevice,
    deviceTaskType,
    area,
    category,
    cables: estimateNetworkCables(resolvedName, resolvedPartNumber, category),
    mountHeightFt: finalInstallationSpec.mountHeightFt,
    mountHeightNeedsFieldValidation: finalInstallationSpec.mountHeightNeedsFieldValidation,
    mountHeightRuleKey: finalInstallationSpec.mountHeightRuleKey,
    hasPosition: marker !== null,
    iconUrl: "",
    raw: {
      source: "pdf",
      template,
      page: String(pageNumber),
      hub,
      name: resolvedName,
      part_number: partNumber,
      device_task_type: deviceTaskType
    }
  };
}

function parsePageLines(
  lines: TextLine[],
  template: PdfDataTemplate,
  markers: Map<number, PlanMarker>,
  pageNumber: number
) {
  const startLines = lines.filter((line) => line.id !== null && !isHeaderLine(line));
  const rowMap = new Map<number, TextLine[]>();

  startLines.forEach((line) => {
    if (line.id === null) {
      return;
    }
    rowMap.set(line.id, [line]);
  });

  lines
    .filter((line) => line.id === null && !isHeaderLine(line))
    .forEach((line) => {
      let closestId: number | null = null;
      let smallestDistance = Number.POSITIVE_INFINITY;

      startLines.forEach((startLine) => {
        if (startLine.id === null) {
          return;
        }
        const distance = lineDistance(startLine.y, line.y);
        if (distance < smallestDistance) {
          smallestDistance = distance;
          closestId = startLine.id;
        }
      });

      if (closestId === null || smallestDistance > ROW_Y_TOLERANCE) {
        return;
      }

      const current = rowMap.get(closestId);
      if (current) {
        current.push(line);
      }
    });

  return startLines
    .map((line) => {
      if (line.id === null) {
        return null;
      }
      return buildRecord(line.id, pageNumber, template, rowMap.get(line.id) || [line], markers);
    })
    .filter((record): record is DeviceRecord => Boolean(record))
    .sort((left, right) => {
      if (left.id === null && right.id === null) {
        return 0;
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

async function readPdfSource(source: File | ArrayBuffer | Uint8Array) {
  if (source instanceof File) {
    return new Uint8Array(await readFileAsArrayBuffer(source));
  }
  if (source instanceof Uint8Array) {
    return new Uint8Array(source);
  }
  return new Uint8Array(source.slice(0));
}

export async function parsePdfDataRecords(
  file: File | ArrayBuffer | Uint8Array,
  markers: Map<number, PlanMarker>,
  startPage = 2
): Promise<PdfDataParseResult> {
  const buffer = await readPdfSource(file);
  const pdf = await getDocument({ data: buffer }).promise;
  try {
    const effectiveStart = Math.min(startPage, pdf.numPages);
    const firstDataPage = await pdf.getPage(effectiveStart);
    const firstDataContent = await getPageTextContentCompat(firstDataPage);
    const template = detectTemplate(buildLines(firstDataContent.items as TextItem[]));

    const records: DeviceRecord[] = [];
    let rawRows = 0;

    for (let pageNumber = effectiveStart; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await getPageTextContentCompat(page);
      const lines = buildLines(textContent.items as TextItem[]);
      const pageRecords = parsePageLines(lines, template, markers, pageNumber);
      rawRows += pageRecords.length;
      records.push(...pageRecords);
    }

    return {
      template,
      records,
      dataPages: Math.max(pdf.numPages - 1, 0),
      rawRows
    };
  } finally {
    await pdf.destroy();
  }
}
