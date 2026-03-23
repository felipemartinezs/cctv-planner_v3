import type { DeviceCategory, DeviceRecord } from "../../types";

export type FieldPriority = "critical" | "attention" | "normal";

export interface FieldOverlayMarker {
  key: string;
  id: number | null;
  x: number | null;
  y: number | null;
  label: string;
  installLabel: string;
  switchCode: string;
  cableBadge: string;
  priority: FieldPriority;
  category: DeviceCategory;
  iconUrl: string;
  hasWarnings: boolean;
}

export interface FieldTaskPacket {
  key: string;
  id: number | null;
  title: string;
  installLabel: string;
  area: string;
  switchCode: string;
  category: DeviceCategory;
  priority: FieldPriority;
  cables: number;
  cableText: string;
  warnings: string[];
  notes: string[];
  sequence: number;
  hasPosition: boolean;
  overlay: FieldOverlayMarker;
  source: DeviceRecord;
}

export interface FieldWorkCluster {
  key: string;
  label: string;
  area: string;
  switchCode: string;
  taskCount: number;
  cableCount: number;
  reviewCount: number;
  packetKeys: string[];
}

export interface FieldAggregate {
  key: string;
  label: string;
  taskCount: number;
  cableCount: number;
  reviewCount: number;
}

export interface FieldIntelligenceSummary {
  totalTasks: number;
  positionedTasks: number;
  twoCableTasks: number;
  missingAssignments: number;
  missingParts: number;
  missingPositions: number;
}

export interface FieldIntelligenceSnapshot {
  packets: FieldTaskPacket[];
  overlays: FieldOverlayMarker[];
  clusters: FieldWorkCluster[];
  switchSummary: FieldAggregate[];
  areaSummary: FieldAggregate[];
  reviewQueue: FieldTaskPacket[];
  summary: FieldIntelligenceSummary;
}
