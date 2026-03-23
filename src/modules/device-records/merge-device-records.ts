import type { DeviceRecord } from "../../types";
import { contextualizeIconDeviceForInstallation, resolveInstallationSpec } from "../../lib/installation-rules";

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
    const partNumber = pickText(current.partNumber, record.partNumber);
    const iconDevice = pickText(current.iconDevice, record.iconDevice);
    const area = pickText(current.area, record.area);
    const category = record.category === "unknown" ? current.category : record.category;
    const name = pickText(current.name, record.name);
    const installationSpec = resolveInstallationSpec({
      area,
      category,
      iconDevice,
      name,
      partNumber,
    });
    const contextualIconDevice = contextualizeIconDeviceForInstallation({
      iconDevice,
      installationSpec,
      partNumber,
    });
    const finalInstallationSpec =
      contextualIconDevice === iconDevice
        ? installationSpec
        : resolveInstallationSpec({
            area,
            category,
            iconDevice: contextualIconDevice,
            name,
            partNumber,
          });

    merged.set(record.key, {
      ...current,
      name,
      abbreviatedName: pickText(current.abbreviatedName, record.abbreviatedName),
      partNumber,
      hub: pickText(current.hub, record.hub),
      switchName: pickText(current.switchName, record.switchName),
      switchFamily: pickText(current.switchFamily, record.switchFamily),
      switchSegment: pickText(current.switchSegment, record.switchSegment),
      x,
      y,
      sourcePage: pickNumber(current.sourcePage, record.sourcePage),
      iconDevice: contextualIconDevice,
      deviceTaskType: pickText(current.deviceTaskType, record.deviceTaskType),
      area,
      category,
      cables: record.cables || current.cables,
      mountHeightFt: finalInstallationSpec.mountHeightFt,
      mountHeightNeedsFieldValidation: finalInstallationSpec.mountHeightNeedsFieldValidation,
      mountHeightRuleKey: finalInstallationSpec.mountHeightRuleKey,
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
