import {
  VISUAL_KNOWLEDGE_SEEDS,
  type NamePatternKnowledgeRule,
  type PartNumberKnowledgeProfile,
} from "../config/visual-knowledge";
import type { DeviceRecord } from "../types";

export interface KnowledgeCoverageGroup {
  count: number;
  label: string;
}

export interface KnowledgePatternCoverage extends KnowledgeCoverageGroup {
  candidateIconDevices: string[];
  candidatePartNumbers: string[];
  iconConfidence: number;
  partConfidence: number;
}

export interface VisualKnowledgeResolution {
  iconDevice: string;
  matchedBy: "existing-icon-device" | "name-pattern" | "part-number";
  namePattern: string;
  partNumber: string;
}

export interface VisualKnowledgeCoverage {
  ambiguousNamePatternMatches: number;
  namePartConflicts: number;
  partNumbersMissingIconDevice: KnowledgeCoverageGroup[];
  partNumbersWithVariantChoices: KnowledgeCoverageGroup[];
  recordsMissingPartNumberWithSuggestion: number;
  recordsWithKnownIconDevice: number;
  recordsWithKnownNamePattern: number;
  recordsWithKnownPartNumber: number;
  recordsWithSingleIconDeviceKnowledge: number;
  recordsWithSeededPartButNoIconDevice: number;
  recordsWithVariantIconDeviceKnowledge: number;
  seedName: string;
  seededNamePatterns: number;
  seededPartNumbers: number;
  unknownNamePatterns: KnowledgeCoverageGroup[];
  unknownPartNumbers: KnowledgeCoverageGroup[];
  ambiguousNamePatterns: KnowledgePatternCoverage[];
}

function normalizePartNumberKey(value: string): string {
  return value.trim().toUpperCase();
}

function includesNormalizedValue(values: string[], expected: string): boolean {
  const expectedKey = normalizePartNumberKey(expected);
  if (!expectedKey) {
    return false;
  }

  return values.some((value) => normalizePartNumberKey(value) === expectedKey);
}

export function normalizeKnowledgeNamePattern(value: string): string {
  const normalized = value
    .toUpperCase()
    .replace(/\u00a0/g, " ")
    .replace(/\//g, " ")
    .replace(/[_\s]+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  const withoutPureNumberTokens = normalized
    .split(" ")
    .filter(Boolean)
    .filter((token) => !/^\d+$/.test(token))
    .join(" ");

  return withoutPureNumberTokens
    .replace(/\b0+(\d+)\b/g, "$1")
    .replace(/\b(?:0?\d|[1-9]\d{1,2})\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bumpCounter(counter: Map<string, number>, key: string) {
  if (!key) {
    return;
  }
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function toCoverageGroups(counter: Map<string, number>): KnowledgeCoverageGroup[] {
  return Array.from(counter.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.label.localeCompare(right.label);
    });
}

function buildPartNumberProfiles(): Map<string, PartNumberKnowledgeProfile> {
  const merged = new Map<string, PartNumberKnowledgeProfile>();

  VISUAL_KNOWLEDGE_SEEDS.forEach((seed) => {
    seed.partNumberProfiles.forEach((profile) => {
      const key = normalizePartNumberKey(profile.partNumber);
      const existing = merged.get(key);

      if (!existing) {
        merged.set(key, {
          iconDevices: [...profile.iconDevices],
          partNumber: profile.partNumber,
        });
        return;
      }

      const nextDevices = new Set([...existing.iconDevices, ...profile.iconDevices]);
      merged.set(key, {
        iconDevices: Array.from(nextDevices).sort((left, right) => left.localeCompare(right)),
        partNumber: existing.partNumber,
      });
    });
  });

  return merged;
}

function buildNamePatternRules(): Map<string, NamePatternKnowledgeRule> {
  const merged = new Map<string, NamePatternKnowledgeRule>();

  VISUAL_KNOWLEDGE_SEEDS.forEach((seed) => {
    seed.namePatternRules.forEach((rule) => {
      const key = normalizeKnowledgeNamePattern(rule.namePattern);
      const existing = merged.get(key);

      if (!existing) {
        merged.set(key, {
          candidateIconDevices: [...rule.candidateIconDevices],
          candidatePartNumbers: [...rule.candidatePartNumbers],
          iconConfidence: rule.iconConfidence,
          namePattern: rule.namePattern,
          partConfidence: rule.partConfidence,
          suggestedIconDevice: rule.suggestedIconDevice,
          suggestedPartNumber: rule.suggestedPartNumber,
        });
        return;
      }

      const nextCandidates = Array.from(
        new Set([...existing.candidatePartNumbers, ...rule.candidatePartNumbers])
      ).sort((left, right) => left.localeCompare(right));
      const nextIconDevices = Array.from(
        new Set([...existing.candidateIconDevices, ...rule.candidateIconDevices])
      ).sort((left, right) => left.localeCompare(right));
      const shouldPromotePart =
        rule.partConfidence > existing.partConfidence ||
        (rule.partConfidence === existing.partConfidence &&
          rule.candidatePartNumbers.length < existing.candidatePartNumbers.length);
      const shouldPromoteIcon =
        rule.iconConfidence > existing.iconConfidence ||
        (rule.iconConfidence === existing.iconConfidence &&
          rule.candidateIconDevices.length < existing.candidateIconDevices.length);

      merged.set(key, {
        candidateIconDevices: nextIconDevices,
        candidatePartNumbers: nextCandidates,
        iconConfidence: Math.max(existing.iconConfidence, rule.iconConfidence),
        namePattern: existing.namePattern,
        partConfidence: Math.max(existing.partConfidence, rule.partConfidence),
        suggestedIconDevice: shouldPromoteIcon
          ? rule.suggestedIconDevice
          : existing.suggestedIconDevice,
        suggestedPartNumber: shouldPromotePart
          ? rule.suggestedPartNumber
          : existing.suggestedPartNumber,
      });
    });
  });

  return merged;
}

const partNumberProfiles = buildPartNumberProfiles();
const namePatternRules = buildNamePatternRules();

export function getPartNumberKnowledge(
  partNumber: string
): PartNumberKnowledgeProfile | null {
  return partNumberProfiles.get(normalizePartNumberKey(partNumber)) ?? null;
}

export function getNamePatternKnowledge(
  name: string
): NamePatternKnowledgeRule | null {
  return namePatternRules.get(normalizeKnowledgeNamePattern(name)) ?? null;
}

export function resolveRecordVisualKnowledge(
  record: Pick<DeviceRecord, "iconDevice" | "name" | "partNumber">
): VisualKnowledgeResolution | null {
  const currentPartNumber = record.partNumber.trim();
  const currentIconDevice = record.iconDevice.trim();
  const currentPartKey = normalizePartNumberKey(currentPartNumber);
  const currentIconKey = normalizePartNumberKey(currentIconDevice);
  const namePattern = normalizeKnowledgeNamePattern(record.name);
  const nameKnowledge = namePattern ? namePatternRules.get(namePattern) ?? null : null;
  const partKnowledge = currentPartKey ? partNumberProfiles.get(currentPartKey) ?? null : null;

  if (nameKnowledge) {
    const suggestedPartNumber = nameKnowledge.suggestedPartNumber.trim();
    const suggestedIconDevice = nameKnowledge.suggestedIconDevice.trim();
    const hasSpecificNameRule =
      nameKnowledge.candidatePartNumbers.length === 1 &&
      nameKnowledge.candidateIconDevices.length === 1;
    const hasHighConfidenceRule =
      nameKnowledge.partConfidence >= 0.999 &&
      nameKnowledge.iconConfidence >= 0.999;
    const partMatchesName =
      !currentPartKey ||
      includesNormalizedValue(nameKnowledge.candidatePartNumbers, currentPartNumber) ||
      normalizePartNumberKey(suggestedPartNumber) === currentPartKey;
    const canOverrideUnknownPart =
      Boolean(currentPartKey) &&
      !partKnowledge &&
      hasHighConfidenceRule;

    if (
      (hasSpecificNameRule || hasHighConfidenceRule) &&
      (partMatchesName || canOverrideUnknownPart) &&
      (suggestedPartNumber || suggestedIconDevice)
    ) {
      return {
        iconDevice: suggestedIconDevice || currentIconDevice,
        matchedBy: "name-pattern",
        namePattern,
        partNumber: suggestedPartNumber || currentPartNumber,
      };
    }
  }

  if (partKnowledge) {
    if (currentIconKey && includesNormalizedValue(partKnowledge.iconDevices, currentIconDevice)) {
      return {
        iconDevice: currentIconDevice,
        matchedBy: "existing-icon-device",
        namePattern,
        partNumber: partKnowledge.partNumber,
      };
    }

    if (partKnowledge.iconDevices.length === 1) {
      return {
        iconDevice: partKnowledge.iconDevices[0],
        matchedBy: "part-number",
        namePattern,
        partNumber: partKnowledge.partNumber,
      };
    }
  }

  return null;
}

export function buildVisualKnowledgeCoverage(
  records: DeviceRecord[]
): VisualKnowledgeCoverage {
  const unknownPartNumbers = new Map<string, number>();
  const unknownNamePatterns = new Map<string, number>();
  const partNumbersMissingIconDevice = new Map<string, number>();
  const partNumbersWithVariantChoices = new Map<string, number>();
  const ambiguousPatternMatches = new Map<
    string,
    { count: number; rule: NamePatternKnowledgeRule }
  >();

  let recordsWithKnownPartNumber = 0;
  let recordsWithKnownNamePattern = 0;
  let recordsWithKnownIconDevice = 0;
  let recordsWithSingleIconDeviceKnowledge = 0;
  let recordsWithVariantIconDeviceKnowledge = 0;
  let recordsMissingPartNumberWithSuggestion = 0;
  let recordsWithSeededPartButNoIconDevice = 0;
  let ambiguousNamePatternMatches = 0;
  let namePartConflicts = 0;

  records.forEach((record) => {
    const partNumberKey = normalizePartNumberKey(record.partNumber);
    const namePattern = normalizeKnowledgeNamePattern(record.name);
    const partKnowledge = partNumberKey ? partNumberProfiles.get(partNumberKey) ?? null : null;
    const nameKnowledge = namePattern ? namePatternRules.get(namePattern) ?? null : null;

    if (partKnowledge) {
      recordsWithKnownPartNumber += 1;
      if (partKnowledge.iconDevices.length > 0) {
        recordsWithKnownIconDevice += 1;
        if (partKnowledge.iconDevices.length === 1) {
          recordsWithSingleIconDeviceKnowledge += 1;
        } else {
          recordsWithVariantIconDeviceKnowledge += 1;
          bumpCounter(partNumbersWithVariantChoices, partKnowledge.partNumber);
        }
      } else {
        recordsWithSeededPartButNoIconDevice += 1;
        bumpCounter(partNumbersMissingIconDevice, partKnowledge.partNumber);
      }
    } else if (partNumberKey) {
      bumpCounter(unknownPartNumbers, partNumberKey);
    }

    if (nameKnowledge) {
      recordsWithKnownNamePattern += 1;

      if (!partNumberKey) {
        recordsMissingPartNumberWithSuggestion += 1;
      }

      if (
        nameKnowledge.candidatePartNumbers.length > 1 ||
        nameKnowledge.candidateIconDevices.length > 1
      ) {
        ambiguousNamePatternMatches += 1;
        const current = ambiguousPatternMatches.get(nameKnowledge.namePattern);
        if (current) {
          current.count += 1;
        } else {
          ambiguousPatternMatches.set(nameKnowledge.namePattern, {
            count: 1,
            rule: nameKnowledge,
          });
        }
      }

      if (
        partNumberKey &&
        !nameKnowledge.candidatePartNumbers.includes(partNumberKey) &&
        nameKnowledge.suggestedPartNumber !== partNumberKey
      ) {
        namePartConflicts += 1;
      }
    } else if (namePattern) {
      bumpCounter(unknownNamePatterns, namePattern);
    }
  });

  const ambiguousNamePatterns = Array.from(ambiguousPatternMatches.entries())
    .map(([label, value]) => ({
      candidateIconDevices: value.rule.candidateIconDevices,
      candidatePartNumbers: value.rule.candidatePartNumbers,
      iconConfidence: value.rule.iconConfidence,
      count: value.count,
      label,
      partConfidence: value.rule.partConfidence,
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.label.localeCompare(right.label);
    });

  return {
    ambiguousNamePatternMatches,
    ambiguousNamePatterns: ambiguousNamePatterns.slice(0, 8),
    namePartConflicts,
    partNumbersMissingIconDevice: toCoverageGroups(partNumbersMissingIconDevice).slice(0, 8),
    partNumbersWithVariantChoices: toCoverageGroups(partNumbersWithVariantChoices).slice(0, 8),
    recordsMissingPartNumberWithSuggestion,
    recordsWithKnownIconDevice,
    recordsWithKnownNamePattern,
    recordsWithKnownPartNumber,
    recordsWithSingleIconDeviceKnowledge,
    recordsWithSeededPartButNoIconDevice,
    recordsWithVariantIconDeviceKnowledge,
    seedName: VISUAL_KNOWLEDGE_SEEDS.map((seed) => seed.seedName).join(" + "),
    seededNamePatterns: namePatternRules.size,
    seededPartNumbers: partNumberProfiles.size,
    unknownNamePatterns: toCoverageGroups(unknownNamePatterns).slice(0, 8),
    unknownPartNumbers: toCoverageGroups(unknownPartNumbers).slice(0, 8),
  };
}
