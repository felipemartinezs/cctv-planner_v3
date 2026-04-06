export type DeviceCategory =
  | "ptz"
  | "camera"
  | "monitor"
  | "mount"
  | "infrastructure"
  | "unknown";

export type VisualDecisionSource =
  | "name-pattern"
  | "part-number"
  | "existing-icon-device"
  | "device-rule"
  | "ambiguous-name-suggestion"
  | "fallback-icon-device"
  | "fallback-part-number"
  | "fallback-device-task-type"
  | "none";

export type VisualDecisionRisk = "safe" | "review" | "abstain";

export interface VisualDecisionAudit {
  contextualizedFrom: string;
  deviceRuleDescription: string;
  deviceRuleId: string;
  finalIconDevice: string;
  finalIconUrl: string;
  hasAmbiguousNameKnowledge: boolean;
  hasNameKnowledge: boolean;
  hasPartKnowledge: boolean;
  iconLookupMode: "exact" | "flexible" | "none";
  knowledgeMatchedBy: "existing-icon-device" | "name-pattern" | "part-number" | "";
  namePattern: string;
  partKnowledgeIconChoices: number;
  proposedIconDevice: string;
  proposedIconUrl: string;
  rawIconDeviceProvided: boolean;
  rawPartNumberProvided: boolean;
  resolvedPartNumber: string;
  risk: VisualDecisionRisk;
  source: VisualDecisionSource;
  suppressed: boolean;
}

export interface PlanMarker {
  id: number;
  x: number;
  y: number;
  label: string;
}

export interface PlanData {
  width: number;
  height: number;
  blobUrl: string;
  previewUrl: string;
  previewWidth: number;
  previewHeight: number;
  viewerUrl: string;
  markers: Map<number, PlanMarker>;
  pageCount: number;
  title: string;
}

export interface DeviceRecord {
  key: string;
  id: number | null;
  name: string;
  rawName: string;
  abbreviatedName: string;
  partNumber: string;
  hub: string;
  switchName: string;
  switchFamily: string;
  switchSegment: string;
  x: number | null;
  y: number | null;
  sourcePage: number | null;
  iconDevice: string;
  deviceTaskType: string;
  area: string;
  category: DeviceCategory;
  cables: number;
  mountHeightFt: number | null;
  mountHeightNeedsFieldValidation: boolean;
  mountHeightRuleKey: string;
  hasPosition: boolean;
  iconUrl: string;
  visualDecision?: VisualDecisionAudit;
  raw: Record<string, string>;
}

export interface Metrics {
  totalDevices: number;
  positionedDevices: number;
  areas: number;
  switches: number;
  estimatedCables: number;
  cameras: number;
  monitors: number;
}

export interface ImportBundle {
  records: DeviceRecord[];
  metrics: Metrics;
  missingPositions: number;
}

export interface IconAsset {
  name: string;
  url: string;
  sourcePath: string;
}
