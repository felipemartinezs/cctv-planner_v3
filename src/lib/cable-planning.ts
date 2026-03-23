import { matchDeviceRule } from "../config/device-rules";
import type { DeviceCategory } from "../types";

const ZERO_CABLE_PART_PATTERNS = [
  /^CM-/,
  /^HW-/,
  /^NDA-/,
  /^PNDT/,
  /^POLE/,
  /^3680/,
  /^CB-AXTU9001/
];

function normalizeKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

export function isSharedPvmCamera(name: string, partNumber: string): boolean {
  const partKey = normalizeKey(partNumber);
  if (partKey !== "CIPAX4115") {
    return false;
  }

  const nameKey = normalizeKey(name);
  return (
    nameKey.includes("COSMETICS") ||
    nameKey.includes("SPORTINGGOODS") ||
    nameKey.includes("BABYFORMULA")
  );
}

export function estimateNetworkCables(
  name: string,
  partNumber: string,
  category: DeviceCategory
): number {
  if (category === "mount" || category === "infrastructure") {
    return 0;
  }
  if (isSharedPvmCamera(name, partNumber)) {
    return 0;
  }
  if (ZERO_CABLE_PART_PATTERNS.some((pattern) => pattern.test(partNumber.toUpperCase()))) {
    return 0;
  }

  const rule = matchDeviceRule(name);
  if (rule) {
    return rule.cablesCAT5;
  }

  return 1;
}

export function cableInstructionOverride(name: string, partNumber: string): string | null {
  if (!isSharedPvmCamera(name, partNumber)) {
    return null;
  }

  return "Sin CAT5 independiente - camara enlazada al PVM local en circuito cerrado";
}
