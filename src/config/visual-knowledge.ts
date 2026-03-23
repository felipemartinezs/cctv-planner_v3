import mantecaVisualKnowledgeSeed from "./manteca-visual-knowledge.json";

export interface PartNumberKnowledgeProfile {
  iconDevices: string[];
  partNumber: string;
}

export interface NamePatternKnowledgeRule {
  candidateIconDevices: string[];
  candidatePartNumbers: string[];
  iconConfidence: number;
  namePattern: string;
  partConfidence: number;
  suggestedIconDevice: string;
  suggestedPartNumber: string;
}

export interface VisualKnowledgeSeed {
  namePatternRules: NamePatternKnowledgeRule[];
  partNumberProfiles: PartNumberKnowledgeProfile[];
  seedName: string;
}

export const VISUAL_KNOWLEDGE_SEEDS: VisualKnowledgeSeed[] = [
  mantecaVisualKnowledgeSeed as VisualKnowledgeSeed,
];

export const DEFAULT_VISUAL_KNOWLEDGE_SEED = VISUAL_KNOWLEDGE_SEEDS[0];
