import type { DeviceRecord } from "../../types";
import {
  buildVisualKnowledgeCoverage,
  DEFAULT_VISUAL_KNOWLEDGE_INDEX,
  type VisualKnowledgeIndex,
} from "../../lib/visual-knowledge";
import type { PlanSegmentation } from "../plan-segmentation";
import { hasSwitchAssignment, switchDisplayLabel } from "../switch-segmentation";
import type { InsightGroup, ProjectInsights } from "./types";

function normalizeValue(value: string, fallback: string): string {
  const next = value.trim();
  return next || fallback;
}

function buildGroups(values: string[], fallback: string): InsightGroup[] {
  const counter = new Map<string, number>();

  values.forEach((value) => {
    const label = normalizeValue(value, fallback);
    counter.set(label, (counter.get(label) || 0) + 1);
  });

  return Array.from(counter.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.label.localeCompare(right.label);
    });
}

export function buildProjectInsights(
  records: DeviceRecord[],
  context: ProjectInsights["context"],
  segmentation: PlanSegmentation | null = null,
  knowledgeIndex: VisualKnowledgeIndex = DEFAULT_VISUAL_KNOWLEDGE_INDEX
): ProjectInsights {
  const segmentedSwitches = segmentation?.segments ?? [];
  const topSwitches = segmentedSwitches.length > 0
    ? segmentedSwitches.map((segment) => ({
        count: segment.deviceCount,
        label: segment.label,
      }))
    : buildGroups(
        records.map((record) => switchDisplayLabel(record, "")).filter(Boolean),
        ""
      );
  const topAreas = buildGroups(records.map((record) => record.area), "SIN AREA");
  const topNames = buildGroups(records.map((record) => record.name), "SIN NAME");
  const topPartNumbers = buildGroups(records.map((record) => record.partNumber), "SIN PART NUMBER");
  const switchCables = segmentedSwitches.length > 0
    ? segmentedSwitches.reduce<Record<string, number>>((acc, segment) => {
        acc[segment.label] = segment.totalCables;
        return acc;
      }, {})
    : records.reduce<Record<string, number>>((acc, record) => {
        const key = switchDisplayLabel(record, "");
        if (key) {
          acc[key] = (acc[key] ?? 0) + record.cables;
        }
        return acc;
      }, {});

  return {
    context,
    knowledge: buildVisualKnowledgeCoverage(records, knowledgeIndex),
    review: {
      missingPartNumber: records.filter((record) => !record.partNumber).length,
      missingPositions: records.filter((record) => !record.hasPosition).length,
      missingSwitch: records.filter((record) => !hasSwitchAssignment(record)).length,
      missingSwitchIds: records
        .filter((record) => !hasSwitchAssignment(record) && record.id !== null)
        .map((record) => record.id as number)
        .sort((a, b) => a - b)
    },
    totals: {
      areas: topAreas.length,
      cameras: records.filter((record) => record.category === "camera").length,
      estimatedCables: records.reduce((total, record) => total + record.cables, 0),
      f360: records.filter((record) => /F360/i.test(record.partNumber)).length,
      infrastructure: records.filter((record) => record.category === "infrastructure").length,
      monitors: records.filter((record) => record.category === "monitor").length,
      nameGroups: topNames.length,
      partGroups: topPartNumbers.length,
      positioned: records.filter((record) => record.hasPosition).length,
      ptz: records.filter((record) => record.category === "ptz").length,
      switches: segmentedSwitches.length > 0
        ? segmentation?.totals.physicalSwitches ?? topSwitches.length
        : topSwitches.length,
      totalDevices: records.length
    },
    switchCables,
    topAreas: topAreas.slice(0, 8),
    topNames: topNames.slice(0, 8),
    topPartNumbers: topPartNumbers.slice(0, 8),
    topSwitches: topSwitches.slice(0, 8)
  };
}
