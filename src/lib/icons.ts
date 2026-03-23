import JSZip from "jszip";
import type { IconAsset } from "../types";

export function normalizeIconKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

interface RawIconInput {
  path: string;
  url: string;
}

interface RawIconAliasInput {
  alias: string;
  path: string;
}

export interface IconManifestEntry {
  path: string;
  url: string;
}

export interface IconAliasManifestEntry {
  alias: string;
  path: string;
}

export interface IconManifest {
  aliases: IconAliasManifestEntry[];
  generatedAt: string;
  iconCount: number;
  icons: IconManifestEntry[];
  root: string;
}

interface ResolvedIconEntry {
  folderId: string;
  leafDirKey: string;
  sourceId: string;
  stemKey: string;
  url: string;
}

const ICON_QUERY_ALIASES: Record<string, string[]> = {
  [normalizeIconKey("CIP-QND8011")]: [
    "HANWHA 5MP INDOOR Micro Dome Fixed",
    "HANWHA 5MP INDOOR Micro Dome Fixed Camera",
  ],
  [normalizeIconKey("CIP-QNP6250H Ceiling")]: [
    "HANWHA CIP-QNP6250H 1080P Indoor Recessed Ceiling PTZ Dome",
  ],
  [normalizeIconKey("CIP-QNP6250H Outdoor")]: [
    "HANWHA CIP-QNP6250H 1080P Outdoor PTZ Dome",
  ],
  [normalizeIconKey("CIP-QNP6250H Pendant")]: [
    "HANWHA CIP-QNP6250H 1080P Indoor PTZ Dome",
    "HANWHA CIP-QNP6250H 1080P Indoor Dome",
  ],
  [normalizeIconKey("DE-HASPD-24-MONITOR")]: [
    '24" LED Monitor Desk Mount/Wall Mount',
    "24 LED Monitor Desk MountWall Mount",
  ],
  [normalizeIconKey("NDE-5704-AL-W")]: [
    "Bosch NDE-5704-AL-W 8 Megapixel OUTDOOR Verifocal Fixed Camera",
  ],
  [normalizeIconKey("NDE-5704-AL-W OUTDOOR")]: [
    "Bosch NDE-5704-AL-W 8 Megapixel OUTDOOR Verifocal Fixed Camera",
  ],
  [normalizeIconKey("NDS-5704-F360-W")]: [
    "Bosch NDS-5704-F360 12 Megapixel INDOOR Panoramic Camera",
  ],
  [normalizeIconKey("NDS-5704-F360 INDOOR")]: [
    "Bosch NDS-5704-F360 12 Megapixel INDOOR Panoramic Camera",
  ],
  [normalizeIconKey("PVM10-B-2086-WMT")]: [
    '10" ePVM Monitor w/intergrated camera',
    "10 ePVM Monitor wintergrated camera",
  ],
  [normalizeIconKey("MCLV-BAXFA51 43 LED Monitor")]: [
    '43" LED Monitor Ceiling Mount',
    "43 LED Monitor Ceiling Mount",
  ],
  [normalizeIconKey("MCLV-BAXFA51 43 LED Monitor 43 Back to Back")]: [
    '43" Ceiling Mount Monitor-Back to Back',
    "43 Ceiling Mount Monitor-Back to Back",
  ],
  [normalizeIconKey("MCLV-BAXFA51 32")]: [
    '32" LED Monitor Ceiling Mount',
    '32" LED Monitor Wall Mount',
    "32 LED Monitor Ceiling Mount",
    "32 LED Monitor Wall Mount",
    "32 LED Monitor Single Fuel Mount",
  ],
};

const MIN_FUZZY_ICON_SCORE = 5_000;

function shouldUseFolderAlias(key: string): boolean {
  return key.length >= 6 && /\d/.test(key);
}

function folderAliases(path: string): string[] {
  const parts = splitIconPath(path);
  const aliases = new Set<string>();

  parts.forEach((segment) => {
    const key = normalizeIconKey(segment);
    if (shouldUseFolderAlias(key)) {
      aliases.add(key);
    }
  });

  const fullPathKey = normalizeIconKey(parts.join(" "));
  if (shouldUseFolderAlias(fullPathKey)) {
    aliases.add(fullPathKey);
  }

  return Array.from(aliases);
}

function splitIconPath(path: string): string[] {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !segment.startsWith(".") && !segment.startsWith("._"));
}

function stripExtension(value: string): string {
  return value.replace(/\.[^.]+$/, "");
}

function isSupportedIconPath(path: string): boolean {
  if (path.includes("__MACOSX") || !/\.(png|svg)$/i.test(path)) {
    return false;
  }
  return splitIconPath(path).length > 0;
}

function isSupportedAliasPath(path: string): boolean {
  if (path.includes("__MACOSX") || !/\.(txt)$/i.test(path)) {
    return false;
  }
  return splitIconPath(path).length > 0;
}

function iconPriority(path: string): number {
  return /\.svg$/i.test(path) ? 2 : 1;
}

function buildResolvedEntries(inputs: RawIconInput[]): ResolvedIconEntry[] {
  const bestBySourceId = new Map<
    string,
    { entry: ResolvedIconEntry; priority: number; order: number }
  >();

  inputs.forEach((input, order) => {
    if (!isSupportedIconPath(input.path)) {
      return;
    }

    const parts = splitIconPath(input.path);
    const stem = stripExtension(parts[parts.length - 1] || "");
    const leafDir = parts.length > 1 ? parts[parts.length - 2] : "";
    const folderId = parts.slice(0, -1).join("/");
    const sourceId = `${folderId}/${stem}`;
    const entry: ResolvedIconEntry = {
      folderId,
      leafDirKey: normalizeIconKey(leafDir),
      sourceId,
      stemKey: normalizeIconKey(stem),
      url: input.url,
    };
    const nextPriority = iconPriority(input.path);
    const current = bestBySourceId.get(sourceId);

    if (
      !current ||
      nextPriority > current.priority ||
      (nextPriority === current.priority && order > current.order)
    ) {
      bestBySourceId.set(sourceId, { entry, priority: nextPriority, order });
    }
  });

  return Array.from(bestBySourceId.values()).map(({ entry }) => entry);
}

function normalizeAliasText(value: string): string[] {
  return value
    .replace(/\u00a0/g, " ")
    .split(/\r?\n+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function buildIconMap(
  inputs: RawIconInput[],
  aliasInputs: RawIconAliasInput[] = []
): Map<string, string> {
  const resolvedEntries = buildResolvedEntries(inputs);
  const folderCounts = new Map<string, number>();
  const aliasPriority = new Map<string, number>();
  const iconMap = new Map<string, string>();
  const singleIconByFolder = new Map<string, string>();

  resolvedEntries.forEach((entry) => {
    folderCounts.set(entry.folderId, (folderCounts.get(entry.folderId) ?? 0) + 1);
  });

  function setAlias(key: string, url: string, priority: number) {
    if (!key) {
      return;
    }
    const currentPriority = aliasPriority.get(key) ?? -1;
    if (priority >= currentPriority) {
      aliasPriority.set(key, priority);
      iconMap.set(key, url);
    }
  }

  resolvedEntries.forEach((entry) => {
    setAlias(entry.stemKey, entry.url, 3);

    const folderHasSingleIcon = (folderCounts.get(entry.folderId) ?? 0) === 1;
    if (folderHasSingleIcon) {
      singleIconByFolder.set(entry.folderId, entry.url);
      setAlias(entry.leafDirKey, entry.url, entry.leafDirKey === entry.stemKey ? 3 : 2);
    }

    folderAliases(entry.folderId).forEach((alias) => {
      setAlias(alias, entry.url, 1);
    });
  });

  aliasInputs.forEach((input) => {
    if (!isSupportedAliasPath(input.path)) {
      return;
    }

    const parts = splitIconPath(input.path);
    const folderId = parts.slice(0, -1).join("/");
    const targetUrl = singleIconByFolder.get(folderId);

    if (!targetUrl) {
      return;
    }

    normalizeAliasText(input.alias).forEach((alias) => {
      setAlias(normalizeIconKey(alias), targetUrl, 2);
    });
  });

  return iconMap;
}

function longestCommonPrefixLength(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function matchScore(query: string, candidate: string): number {
  if (!query || !candidate) {
    return Number.NEGATIVE_INFINITY;
  }
  if (query === candidate) {
    return 10_000 + candidate.length;
  }

  let score = Number.NEGATIVE_INFINITY;

  if (query.length >= 6 && candidate.includes(query)) {
    score = Math.max(score, 8_000 + query.length * 4 - (candidate.length - query.length));
  }

  if (candidate.length >= 6 && query.includes(candidate)) {
    score = Math.max(score, 7_000 + candidate.length * 4 - (query.length - candidate.length));
  }

  const prefixLength = longestCommonPrefixLength(query, candidate);
  if (prefixLength >= 8) {
    score = Math.max(score, 6_000 + prefixLength * 5 - Math.abs(candidate.length - query.length));
  }

  const minPartialLength = Math.max(6, Math.floor(query.length * 0.6));

  for (let end = query.length - 1; end >= minPartialLength; end -= 1) {
    const partial = query.slice(0, end);
    if (candidate.includes(partial)) {
      score = Math.max(score, 5_000 + partial.length * 3 - (candidate.length - partial.length));
      break;
    }
  }

  for (let start = 1; start <= query.length - minPartialLength; start += 1) {
    const partial = query.slice(start);
    if (candidate.includes(partial)) {
      score = Math.max(
        score,
        4_000 + partial.length * 2 - start - (candidate.length - partial.length)
      );
      break;
    }
  }

  return score;
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function loadIconsFromZip(file: File): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && isSupportedIconPath(entry.name));
  const aliasEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && isSupportedAliasPath(entry.name)
  );
  const inputs = await Promise.all(
    entries.map(async (entry) => {
      const base64 = await entry.async("base64");
      const mime = /\.svg$/i.test(entry.name) ? "image/svg+xml" : "image/png";
      return {
        path: entry.name,
        url: `data:${mime};base64,${base64}`,
      };
    })
  );
  const aliasInputs = await Promise.all(
    aliasEntries.map(async (entry) => ({
      alias: await entry.async("text"),
      path: entry.name,
    }))
  );

  return buildIconMap(inputs, aliasInputs);
}

export async function loadIconsFromDirectory(
  files: FileList | File[] | null
): Promise<Map<string, string>> {
  if (!files) {
    return new Map();
  }

  const inputs = await Promise.all(
    Array.from(files).map(async (file) => {
      const relativePath = file.webkitRelativePath || file.name;
      if (!isSupportedIconPath(relativePath)) {
        return null;
      }

      return {
        path: relativePath,
        url: await fileToDataUrl(file),
      };
    })
  );
  const aliasInputs = await Promise.all(
    Array.from(files).map(async (file) => {
      const relativePath = file.webkitRelativePath || file.name;
      if (!isSupportedAliasPath(relativePath)) {
        return null;
      }

      return {
        alias: await file.text(),
        path: relativePath,
      };
    })
  );

  return buildIconMap(
    inputs.filter((input): input is RawIconInput => Boolean(input)),
    aliasInputs.filter((input): input is RawIconAliasInput => Boolean(input))
  );
}

export async function loadIconsFromManifest(
  manifestUrl = "/device-icons/index.json"
): Promise<Map<string, string>> {
  const response = await fetch(manifestUrl, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`No pude cargar la libreria interna de iconos (${response.status}).`);
  }

  const manifest = (await response.json()) as IconManifest;
  return buildIconMap(manifest.icons, manifest.aliases);
}

export function mergeIconMaps(...maps: Array<Map<string, string>>): Map<string, string> {
  const merged = new Map<string, string>();
  maps.forEach((map) => {
    map.forEach((url, key) => {
      merged.set(key, url);
    });
  });
  return merged;
}

export function lookupIcon(iconMap: Map<string, string> | undefined, value: string): string {
  if (!iconMap || !value) {
    return "";
  }

  const baseKey = normalizeIconKey(value);
  if (!baseKey) {
    return "";
  }

  const variants = [
    value,
    ...(ICON_QUERY_ALIASES[baseKey] ?? []),
  ];

  let bestMatch = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestKey = "";

  variants.forEach((variant) => {
    const key = normalizeIconKey(variant);
    if (!key) {
      return;
    }

    const exact = iconMap.get(key);
    if (exact) {
      bestMatch = exact;
      bestScore = 20_000 + key.length;
      bestKey = key;
      return;
    }

    for (const [candidate, url] of iconMap.entries()) {
      const score = matchScore(key, candidate);
      if (
        score > bestScore ||
        (score === bestScore && candidate.length > bestKey.length)
      ) {
        bestScore = score;
        bestKey = candidate;
        bestMatch = url;
      }
    }
  });

  if (!Number.isFinite(bestScore)) {
    return "";
  }

  return bestScore >= MIN_FUZZY_ICON_SCORE ? bestMatch : "";
}

export function summarizeIcons(iconMap: Map<string, string>): IconAsset[] {
  return Array.from(iconMap.entries())
    .slice(0, 12)
    .map(([name, url]) => ({
      name,
      url,
      sourcePath: name
    }));
}
