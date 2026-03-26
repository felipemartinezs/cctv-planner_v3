export type DeviceCategory =
  | "ptz"
  | "camera"
  | "monitor"
  | "mount"
  | "infrastructure"
  | "unknown";

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
