export interface SwitchIdentity {
  code: string;
  family: string;
  segmentLabel: string;
}

export interface SwitchIdentitySource {
  hub?: string;
  switchName?: string;
  switchSegment?: string;
}

const SWITCH_CODE_PATTERN = /\b(S-[A-Z]+(?:-\d+)?)\b/i;
const SWITCH_FAMILY_PATTERN = /^(S-[A-Z]+)-\d+$/i;
const GM_FAMILY_PATTERN = /^S-GM-\d+$/i;

export function extractSwitchCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return "";
  }

  const match = normalized.match(SWITCH_CODE_PATTERN);
  return match ? match[1].toUpperCase() : "";
}

export function switchFamilyFor(code: string): string {
  const normalized = extractSwitchCode(code);
  if (!normalized) {
    return "";
  }

  const match = normalized.match(SWITCH_FAMILY_PATTERN);
  return match ? match[1].toUpperCase() : normalized;
}

export function segmentLabelFor(code: string, mergeGmFamily = true): string {
  const normalized = extractSwitchCode(code);
  if (!normalized) {
    return "";
  }

  if (mergeGmFamily && GM_FAMILY_PATTERN.test(normalized)) {
    return "S-GM";
  }

  return normalized;
}

export function buildSwitchIdentity(rawValue: string, mergeGmFamily = true): SwitchIdentity {
  const code = extractSwitchCode(rawValue);
  return {
    code,
    family: switchFamilyFor(code),
    segmentLabel: segmentLabelFor(code, mergeGmFamily)
  };
}

function rawSwitchValue(source: string | SwitchIdentitySource): string {
  if (typeof source === "string") {
    return source;
  }

  return source.switchName || source.switchSegment || source.hub || "";
}

export function resolveSwitchIdentity(
  source: string | SwitchIdentitySource,
  mergeGmFamily = true
): SwitchIdentity {
  return buildSwitchIdentity(rawSwitchValue(source), mergeGmFamily);
}

export function hasSwitchAssignment(source: string | SwitchIdentitySource): boolean {
  const identity = resolveSwitchIdentity(source);
  return Boolean(identity.code || identity.segmentLabel);
}

export function switchDisplayLabel(
  source: string | SwitchIdentitySource,
  fallback = "Sin switch"
): string {
  const identity = resolveSwitchIdentity(source);
  return identity.code || identity.segmentLabel || fallback;
}
