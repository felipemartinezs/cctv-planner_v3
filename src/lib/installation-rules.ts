import type { DeviceCategory } from "../types";
import { normalizeIconKey } from "./icons";

const PTZ_PART_NUMBER_KEY = normalizeIconKey("CIP-QNP6250H");
const PTZ_OUTDOOR_ICON = "CIP-QNP6250H Outdoor";

interface InstallationRuleInput {
  area: string;
  category: DeviceCategory;
  iconDevice: string;
  name: string;
  partNumber: string;
}

export interface InstallationSpec {
  mountHeightFt: number | null;
  mountHeightNeedsFieldValidation: boolean;
  mountHeightRuleKey: string;
}

interface ContextualIconInput {
  iconDevice: string;
  installationSpec: InstallationSpec;
  partNumber: string;
}

function normalizeSource(...values: string[]) {
  return values
    .join(" ")
    .toUpperCase()
    .replace(/\u00A0/g, " ")
    .replace(/[_/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isOutdoorSource(source: string, iconDevice: string, partNumber: string) {
  const normalizedIcon = normalizeIconKey(iconDevice);
  const normalizedPart = normalizeIconKey(partNumber);

  if (normalizedIcon.includes("outdoor") || normalizedPart.includes("outdoor")) {
    return true;
  }

  return (
    /\bOUTDOOR\b/.test(source) ||
    /\bEXTERIOR\b/.test(source) ||
    /\bEXT\b/.test(source) ||
    /\bEXIT\b/.test(source)
  );
}

function isReceivingSource(source: string) {
  return /\bRCV\b/.test(source) || /\bRECEIVING\b/.test(source);
}

function isF360Source(source: string) {
  return /\bF360\b/.test(source) || /\bNDS-5704-F360\b/.test(source);
}

export function resolveInstallationSpec(input: InstallationRuleInput): InstallationSpec {
  const source = normalizeSource(
    input.name,
    input.partNumber,
    input.iconDevice,
    input.area
  );
  const isOutdoor = isOutdoorSource(source, input.iconDevice, input.partNumber);
  const isReceiving = isReceivingSource(source);
  const isF360 = isF360Source(source);

  if (input.category === "monitor") {
    return {
      mountHeightFt: 8,
      mountHeightNeedsFieldValidation: false,
      mountHeightRuleKey: "install.height.monitorIndoor",
    };
  }

  if (input.category === "ptz" && isOutdoor) {
    return {
      mountHeightFt: 16,
      mountHeightNeedsFieldValidation: false,
      mountHeightRuleKey: "install.height.ptzOutdoor",
    };
  }

  if (isF360 && isReceiving) {
    return {
      mountHeightFt: 16,
      mountHeightNeedsFieldValidation: false,
      mountHeightRuleKey: "install.height.f360Receiving",
    };
  }

  if (isF360 && !isOutdoor) {
    return {
      mountHeightFt: 12,
      mountHeightNeedsFieldValidation: true,
      mountHeightRuleKey: "install.height.f360OpenCeiling",
    };
  }

  if (input.category === "camera" && isOutdoor) {
    return {
      mountHeightFt: 12,
      mountHeightNeedsFieldValidation: false,
      mountHeightRuleKey: "install.height.cameraOutdoor",
    };
  }

  return {
    mountHeightFt: null,
    mountHeightNeedsFieldValidation: false,
    mountHeightRuleKey: "",
  };
}

export function contextualizeIconDeviceForInstallation(
  input: ContextualIconInput
): string {
  if (
    normalizeIconKey(input.partNumber) === PTZ_PART_NUMBER_KEY &&
    input.installationSpec.mountHeightRuleKey === "install.height.ptzOutdoor"
  ) {
    return PTZ_OUTDOOR_ICON;
  }

  return input.iconDevice;
}
