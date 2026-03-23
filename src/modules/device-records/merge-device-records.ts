import type { DeviceRecord } from "../../types";

function pickText(primary: string, secondary: string): string {
  return secondary || primary;
}

function pickNumber(primary: number | null, secondary: number | null): number | null {
  return secondary ?? primary;
}

export function mergeDeviceRecords(
  primaryRecords: DeviceRecord[],
  supplementalRecords: DeviceRecord[]
): DeviceRecord[] {
  const merged = new Map<string, DeviceRecord>();

  primaryRecords.forEach((record) => {
    merged.set(record.key, record);
  });

  supplementalRecords.forEach((record) => {
    const current = merged.get(record.key);
    if (!current) {
      merged.set(record.key, record);
      return;
    }

    const x = pickNumber(current.x, record.x);
    const y = pickNumber(current.y, record.y);

    merged.set(record.key, {
      ...current,
      name: pickText(current.name, record.name),
      abbreviatedName: pickText(current.abbreviatedName, record.abbreviatedName),
      partNumber: pickText(current.partNumber, record.partNumber),
      hub: pickText(current.hub, record.hub),
      switchName: pickText(current.switchName, record.switchName),
      switchFamily: pickText(current.switchFamily, record.switchFamily),
      switchSegment: pickText(current.switchSegment, record.switchSegment),
      x,
      y,
      sourcePage: pickNumber(current.sourcePage, record.sourcePage),
      iconDevice: pickText(current.iconDevice, record.iconDevice),
      deviceTaskType: pickText(current.deviceTaskType, record.deviceTaskType),
      area: pickText(current.area, record.area),
      category: record.category === "unknown" ? current.category : record.category,
      cables: record.cables || current.cables,
      hasPosition: x !== null && y !== null,
      iconUrl: pickText(current.iconUrl, record.iconUrl),
      raw: {
        ...current.raw,
        ...record.raw
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
