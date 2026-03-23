import type { DeviceRecord, PlanData } from "../../types";
import { hasSwitchAssignment, resolveSwitchIdentity } from "../switch-segmentation";
import type {
  FloatingSegmentationDevice,
  PlanSegmentation,
  SegmentSummary,
  SegmentationPoint,
} from "./types";

const EPSILON = 1e-6;

function smoothGrid(
  input: Uint16Array,
  gridWidth: number,
  gridHeight: number,
  labelCount: number,
  passes = 1
): Uint16Array {
  let current = input;

  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Uint16Array(current);

    for (let y = 0; y < gridHeight; y += 1) {
      for (let x = 0; x < gridWidth; x += 1) {
        const votes = new Uint16Array(labelCount);

        for (let ny = Math.max(0, y - 1); ny <= Math.min(gridHeight - 1, y + 1); ny += 1) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(gridWidth - 1, x + 1); nx += 1) {
            const label = current[ny * gridWidth + nx];
            votes[label] += 1;
          }
        }

        let bestLabel = current[y * gridWidth + x];
        let bestVotes = -1;

        votes.forEach((count, label) => {
          if (count > bestVotes) {
            bestVotes = count;
            bestLabel = label;
          }
        });

        next[y * gridWidth + x] = bestLabel;
      }
    }

    current = next;
  }

  return current;
}

function segmentSummary(points: SegmentationPoint[], label: string): SegmentSummary {
  const segmentPoints = points.filter((point) => point.segmentLabel === label);
  const switches = new Set(segmentPoints.map((point) => point.switchName));
  const families = new Set(segmentPoints.map((point) => point.switchFamily).filter(Boolean));
  const xs = segmentPoints.map((point) => point.x);
  const ys = segmentPoints.map((point) => point.y);

  return {
    bounds: {
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys)
    },
    deviceCount: segmentPoints.length,
    label,
    switchFamily: families.values().next().value || "",
    switches: Array.from(switches).sort(),
    totalCables: segmentPoints.reduce((sum, p) => sum + p.cables, 0)
  };
}

function resolveEffectivePosition(record: DeviceRecord, plan: PlanData) {
  if (record.x !== null && record.y !== null) {
    return {
      x: record.x,
      y: record.y,
      source: "record" as const,
    };
  }

  if (record.id !== null) {
    const marker = plan.markers.get(record.id);
    if (marker) {
      return {
        x: marker.x,
        y: marker.y,
        source: "marker" as const,
      };
    }
  }

  return null;
}

function resolveRecordSwitch(record: DeviceRecord) {
  const identity = resolveSwitchIdentity(record);

  return {
    family: record.switchFamily || identity.family,
    hasSwitch: hasSwitchAssignment(record),
    name: record.switchName || identity.code,
    segmentLabel: record.switchSegment || identity.segmentLabel,
  };
}

function groupDevicesByPartNumber(devices: FloatingSegmentationDevice[]) {
  const grouped: Record<string, FloatingSegmentationDevice[]> = {};

  devices.forEach((device) => {
    if (!grouped[device.partNumber]) {
      grouped[device.partNumber] = [];
    }
    grouped[device.partNumber].push(device);
  });

  Object.values(grouped).forEach((entries) => {
    entries.sort((left, right) => left.id - right.id);
  });

  return grouped;
}

export function buildPlanSegmentation(
  records: DeviceRecord[],
  plan: PlanData,
  gridWidth = 170,
  kNeighbors = 5
): PlanSegmentation | null {
  const points: SegmentationPoint[] = records
    .map((record) => {
      const position = resolveEffectivePosition(record, plan);
      const switchInfo = resolveRecordSwitch(record);
      if (
        record.id === null ||
        !position ||
        !switchInfo.hasSwitch
      ) {
        return null;
      }

      return {
        id: record.id,
        key: record.key,
        cables: record.cables,
        partNumber: record.partNumber,
        segmentLabel: switchInfo.segmentLabel,
        switchFamily: switchInfo.family,
        switchName: switchInfo.name,
        x: position.x,
        y: position.y
      } satisfies SegmentationPoint;
    })
    .filter((point): point is SegmentationPoint => Boolean(point));

  const unpositionedDevices: FloatingSegmentationDevice[] = [];
  const noSwitchDevices: FloatingSegmentationDevice[] = [];

  records.forEach((record) => {
    if (!record.partNumber || record.id === null) {
      return;
    }

    const position = resolveEffectivePosition(record, plan);
    const switchInfo = resolveRecordSwitch(record);

    if (!switchInfo.hasSwitch) {
      noSwitchDevices.push({
        id: record.id,
        key: record.key,
        canNavigate: Boolean(position),
        partNumber: record.partNumber,
        positionSource: position?.source ?? "none",
        segmentLabel: switchInfo.segmentLabel,
        switchFamily: switchInfo.family,
        switchName: switchInfo.name,
        issues: ["missing-switch"],
        x: position?.x ?? null,
        y: position?.y ?? null,
      });
      return;
    }

    if (!position) {
      unpositionedDevices.push({
        id: record.id,
        key: record.key,
        canNavigate: false,
        partNumber: record.partNumber,
        positionSource: "none",
        segmentLabel: switchInfo.segmentLabel,
        switchFamily: switchInfo.family,
        switchName: switchInfo.name,
        issues: ["missing-position"],
        x: null,
        y: null,
      });
    }
  });

  const partNumberUnpositioned = groupDevicesByPartNumber(unpositionedDevices);
  const partNumberNoSwitch = groupDevicesByPartNumber(noSwitchDevices);

  if (points.length === 0) {
    // Fallback: no hay dispositivos con posición en el plano.
    // Construir segmentación agrupando por switchName directo desde los records.
    const switchRecords = records.filter(
      (r) => r.id !== null && resolveRecordSwitch(r).hasSwitch
    );
    if (switchRecords.length === 0) {
      return null;
    }

    const partNumberTotalsNoPos: Record<string, number> = {};
    records.forEach((r) => {
      if (r.partNumber) {
        partNumberTotalsNoPos[r.partNumber] = (partNumberTotalsNoPos[r.partNumber] ?? 0) + 1;
      }
    });

    const groupMap = new Map<string, DeviceRecord[]>();
    switchRecords.forEach((r) => {
      const label = resolveRecordSwitch(r).segmentLabel;
      if (!groupMap.has(label)) groupMap.set(label, []);
      groupMap.get(label)!.push(r);
    });

    // Crear points con coordenadas centinela (-1,-1) para que partNumberCounts
    // funcione al filtrar por segmento (los dots se omiten en el canvas)
    const fallbackPoints: SegmentationPoint[] = switchRecords
      .filter((r) => r.id !== null)
      .map((r) => {
        const switchInfo = resolveRecordSwitch(r);
        return {
          id: r.id as number,
          key: r.key,
          cables: r.cables,
          partNumber: r.partNumber,
          segmentLabel: switchInfo.segmentLabel,
          switchFamily: switchInfo.family,
          switchName: switchInfo.name,
          x: r.x ?? -1,
          y: r.y ?? -1
        };
      });

    const fallbackLabels = Array.from(groupMap.keys()).sort();
    const fallbackSegments: SegmentSummary[] = fallbackLabels.map((label) => {
      const grp = groupMap.get(label)!;
      const switchNames = Array.from(
        new Set(grp.map((r) => resolveRecordSwitch(r).name).filter(Boolean))
      ).sort();
      const family = grp.map((r) => resolveRecordSwitch(r).family).find(Boolean) || "";
      return {
        bounds: { x0: 0, x1: 0, y0: 0, y1: 0 },
        deviceCount: grp.length,
        label,
        switchFamily: family,
        switches: switchNames,
        totalCables: grp.reduce((s, r) => s + r.cables, 0)
      };
    });

    return {
      grid: new Uint16Array(0),
      gridHeight: 0,
      gridWidth: 0,
      height: plan.height,
      labels: fallbackLabels,
      points: fallbackPoints,
      segments: fallbackSegments.sort((a, b) => b.deviceCount - a.deviceCount),
      partNumberTotals: partNumberTotalsNoPos,
      partNumberUnpositioned,
      partNumberNoSwitch,
      totals: {
        gmMemberSwitches: 0,
        physicalSwitches: fallbackSegments.length,
        segmentedPoints: 0,
        segments: fallbackLabels.length
      },
      width: plan.width
    };
  }

  const labels = Array.from(new Set(points.map((point) => point.segmentLabel))).sort();
  const labelToIndex = new Map(labels.map((label, index) => [label, index]));
  const gridHeight = Math.max(120, Math.round(gridWidth * (plan.height / plan.width)));
  const grid = new Uint16Array(gridWidth * gridHeight);

  for (let gy = 0; gy < gridHeight; gy += 1) {
    const y = ((gy + 0.5) / gridHeight) * plan.height;

    for (let gx = 0; gx < gridWidth; gx += 1) {
      const x = ((gx + 0.5) / gridWidth) * plan.width;
      const nearest = [...points]
        .map((point) => ({
          distance: (point.x - x) ** 2 + (point.y - y) ** 2,
          labelIndex: labelToIndex.get(point.segmentLabel) || 0
        }))
        .sort((left, right) => left.distance - right.distance)
        .slice(0, Math.min(kNeighbors, points.length));

      const scores = new Float64Array(labels.length);
      nearest.forEach((entry) => {
        scores[entry.labelIndex] += 1 / (entry.distance + EPSILON);
      });

      let bestLabelIndex = 0;
      let bestScore = -1;
      scores.forEach((score, index) => {
        if (score > bestScore) {
          bestScore = score;
          bestLabelIndex = index;
        }
      });

      grid[gy * gridWidth + gx] = bestLabelIndex;
    }
  }

  const smoothedGrid = smoothGrid(grid, gridWidth, gridHeight, labels.length, 1);
  const segments = labels
    .map((label) => segmentSummary(points, label))
    .sort((left, right) => right.deviceCount - left.deviceCount);
  const gmMemberSwitches = new Set(
    points.filter((point) => point.switchFamily === "S-GM").map((point) => point.switchName)
  );

  const partNumberTotals: Record<string, number> = {};
  records.forEach((record) => {
    if (record.partNumber) {
      partNumberTotals[record.partNumber] = (partNumberTotals[record.partNumber] ?? 0) + 1;
    }
  });

  return {
    grid: smoothedGrid,
    gridHeight,
    gridWidth,
    height: plan.height,
    labels,
    partNumberTotals,
    partNumberUnpositioned,
    partNumberNoSwitch,
    points,
    segments,
    totals: {
      gmMemberSwitches: gmMemberSwitches.size,
      physicalSwitches: new Set(points.map((point) => point.switchName)).size,
      segmentedPoints: points.length,
      segments: labels.length
    },
    width: plan.width
  };
}
