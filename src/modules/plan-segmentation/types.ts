export interface SegmentationPoint {
  id: number;
  key: string;
  cables: number;
  partNumber: string;
  segmentLabel: string;
  switchFamily: string;
  switchName: string;
  x: number;
  y: number;
}

export interface FloatingSegmentationDevice {
  id: number;
  key: string;
  canNavigate: boolean;
  partNumber: string;
  positionSource: "marker" | "none" | "record";
  segmentLabel: string;
  switchFamily: string;
  switchName: string;
  issues: Array<"missing-position" | "missing-switch">;
  x: number | null;
  y: number | null;
}

export interface SegmentSummary {
  bounds: {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
  };
  deviceCount: number;
  label: string;
  switchFamily: string;
  switches: string[];
  totalCables: number;
}

export interface PlanSegmentation {
  grid: Uint16Array;
  gridHeight: number;
  gridWidth: number;
  height: number;
  labels: string[];
  points: SegmentationPoint[];
  segments: SegmentSummary[];
  partNumberTotals: Record<string, number>;
  partNumberUnpositioned: Record<string, FloatingSegmentationDevice[]>;
  partNumberNoSwitch: Record<string, FloatingSegmentationDevice[]>;
  totals: {
    gmMemberSwitches: number;
    physicalSwitches: number;
    segmentedPoints: number;
    segments: number;
  };
  width: number;
}
