import type { DeviceRecord } from "../../types";
import { matchDeviceRule } from "../../config/device-rules";
import { cableInstructionOverride } from "../../lib/cable-planning";
import { hasSwitchAssignment, switchDisplayLabel } from "../switch-segmentation";
import type {
  FieldAggregate,
  FieldIntelligenceSnapshot,
  FieldOverlayMarker,
  FieldPriority,
  FieldTaskPacket,
  FieldWorkCluster
} from "./types";

function switchCodeFor(record: DeviceRecord): string {
  return switchDisplayLabel(record, "UNASSIGNED");
}

function installLabelFor(record: DeviceRecord): string {
  return record.iconDevice || record.partNumber || record.deviceTaskType || "EQUIPO POR CONFIRMAR";
}

function titleFor(record: DeviceRecord): string {
  switch (record.category) {
    case "ptz":
      return "Instalar camara PTZ";
    case "camera":
      return "Instalar camara";
    case "monitor":
      return "Instalar monitor";
    case "infrastructure":
      return "Instalar equipo de soporte";
    default:
      return "Revisar punto";
  }
}

function cableTextFor(record: DeviceRecord): string {
  const override = cableInstructionOverride(record.name, record.partNumber);
  if (override) {
    return override;
  }
  if (record.cables === 0) {
    return "Sin cable de red";
  }
  const rule = matchDeviceRule(record.name);
  if (rule) {
    const parts = [`${rule.cablesCAT5} cable${rule.cablesCAT5 !== 1 ? "s" : ""} CAT5`];
    if (rule.cablesPower > 0) {
      parts.push(`${rule.cablesPower} cable 12/2 power`);
    }
    return `Correr ${parts.join(" + ")}`;
  }
  if (record.cables === 2) {
    return "Correr 2 cables CAT5";
  }
  return "Correr 1 cable CAT5";
}

function warningsFor(record: DeviceRecord): string[] {
  const warnings: string[] = [];

  if (!record.partNumber) {
    warnings.push("Sin part number");
  }
  if (!hasSwitchAssignment(record)) {
    warnings.push("Sin switch/hub");
  }
  if (!record.hasPosition) {
    warnings.push("Sin posicion en plano");
  }
  if (record.category === "unknown") {
    warnings.push("Categoria pendiente de clasificar");
  }

  return warnings;
}

function notesFor(record: DeviceRecord): string[] {
  const notes = [
    `Instalar: ${installLabelFor(record)}`,
    `Area: ${record.area}`,
    `Red: ${switchCodeFor(record)}`,
    cableTextFor(record)
  ];

  const rule = matchDeviceRule(record.name);
  if (rule?.installerNote) {
    notes.push(rule.installerNote);
  }

  if (record.sourcePage !== null) {
    notes.push(`Pagina fuente: ${record.sourcePage}`);
  }

  return notes;
}

function priorityFor(record: DeviceRecord, warnings: string[]): FieldPriority {
  if (warnings.length > 0) {
    return "critical";
  }
  if (record.cables > 1 || record.category === "monitor" || record.category === "infrastructure") {
    return "attention";
  }
  return "normal";
}

function cableBadgeFor(record: DeviceRecord): string {
  return record.cables > 1 ? `${record.cables}x` : `${record.cables}`;
}

function overlayFor(record: DeviceRecord, warnings: string[], priority: FieldPriority): FieldOverlayMarker {
  return {
    key: record.key,
    id: record.id,
    x: record.x,
    y: record.y,
    label: record.id !== null ? String(record.id) : record.name,
    installLabel: installLabelFor(record),
    switchCode: switchCodeFor(record),
    cableBadge: cableBadgeFor(record),
    priority,
    category: record.category,
    iconUrl: record.iconUrl,
    hasWarnings: warnings.length > 0
  };
}

function sequenceSort(left: DeviceRecord, right: DeviceRecord): number {
  if (left.hasPosition && right.hasPosition && left.y !== null && right.y !== null) {
    if (left.y !== right.y) {
      return left.y - right.y;
    }
    if (left.x !== null && right.x !== null && left.x !== right.x) {
      return left.x - right.x;
    }
  }

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
}

function aggregatePackets(
  packets: FieldTaskPacket[],
  groupBy: (packet: FieldTaskPacket) => string
): FieldAggregate[] {
  const groups = new Map<string, FieldAggregate>();

  packets.forEach((packet) => {
    const key = groupBy(packet);
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        key,
        label: key,
        taskCount: 1,
        cableCount: packet.cables,
        reviewCount: packet.warnings.length > 0 ? 1 : 0
      });
      return;
    }

    current.taskCount += 1;
    current.cableCount += packet.cables;
    current.reviewCount += packet.warnings.length > 0 ? 1 : 0;
  });

  return Array.from(groups.values()).sort((left, right) => right.taskCount - left.taskCount);
}

function clusterPackets(packets: FieldTaskPacket[]): FieldWorkCluster[] {
  const clusters = new Map<string, FieldWorkCluster>();

  packets.forEach((packet) => {
    const key = `${packet.switchCode}__${packet.area}`;
    const current = clusters.get(key);
    if (!current) {
      clusters.set(key, {
        key,
        label: `${packet.switchCode} / ${packet.area}`,
        area: packet.area,
        switchCode: packet.switchCode,
        taskCount: 1,
        cableCount: packet.cables,
        reviewCount: packet.warnings.length > 0 ? 1 : 0,
        packetKeys: [packet.key]
      });
      return;
    }

    current.taskCount += 1;
    current.cableCount += packet.cables;
    current.reviewCount += packet.warnings.length > 0 ? 1 : 0;
    current.packetKeys.push(packet.key);
  });

  return Array.from(clusters.values()).sort((left, right) => {
    if (right.reviewCount !== left.reviewCount) {
      return right.reviewCount - left.reviewCount;
    }
    return right.taskCount - left.taskCount;
  });
}

export function buildFieldIntelligence(records: DeviceRecord[]): FieldIntelligenceSnapshot {
  const actionableRecords = [...records]
    .filter((record) => record.category !== "mount")
    .sort(sequenceSort);

  const packets = actionableRecords.map((record, index) => {
    const warnings = warningsFor(record);
    const priority = priorityFor(record, warnings);
    const overlay = overlayFor(record, warnings, priority);

    return {
      key: record.key,
      id: record.id,
      title: titleFor(record),
      installLabel: installLabelFor(record),
      area: record.area,
      switchCode: switchCodeFor(record),
      category: record.category,
      priority,
      cables: record.cables,
      cableText: cableTextFor(record),
      warnings,
      notes: notesFor(record),
      sequence: index + 1,
      hasPosition: record.hasPosition,
      overlay,
      source: record
    } satisfies FieldTaskPacket;
  });

  const overlays = packets.map((packet) => packet.overlay);
  const reviewQueue = packets.filter((packet) => packet.priority === "critical");
  const clusters = clusterPackets(packets);
  const switchSummary = aggregatePackets(packets, (packet) => packet.switchCode);
  const areaSummary = aggregatePackets(packets, (packet) => packet.area);

  return {
    packets,
    overlays,
    clusters,
    switchSummary,
    areaSummary,
    reviewQueue,
    summary: {
      totalTasks: packets.length,
      positionedTasks: packets.filter((packet) => packet.hasPosition).length,
      twoCableTasks: packets.filter((packet) => packet.cables > 1).length,
      missingAssignments: packets.filter((packet) => packet.switchCode === "UNASSIGNED").length,
      missingParts: packets.filter((packet) => packet.warnings.includes("Sin part number")).length,
      missingPositions: packets.filter((packet) => !packet.hasPosition).length
    }
  };
}
