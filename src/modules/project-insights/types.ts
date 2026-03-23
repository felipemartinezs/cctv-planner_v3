import type { VisualKnowledgeCoverage } from "../../lib/visual-knowledge";

export interface InsightGroup {
  count: number;
  label: string;
}

export interface ProjectInsights {
  context: {
    dataPages: number;
    rawRows: number;
    recordsParsed: number;
    template: string;
  };
  review: {
    missingPartNumber: number;
    missingPositions: number;
    missingSwitch: number;
    missingSwitchIds: number[];
  };
  totals: {
    areas: number;
    cameras: number;
    estimatedCables: number;
    f360: number;
    infrastructure: number;
    monitors: number;
    nameGroups: number;
    partGroups: number;
    positioned: number;
    ptz: number;
    switches: number;
    totalDevices: number;
  };
  knowledge: VisualKnowledgeCoverage;
  switchCables: Record<string, number>;
  topAreas: InsightGroup[];
  topNames: InsightGroup[];
  topPartNumbers: InsightGroup[];
  topSwitches: InsightGroup[];
}
