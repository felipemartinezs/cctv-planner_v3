import { useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import type { VisualDecisionRisk, VisualDecisionSource } from "../../types";
import {
  normalizeKnowledgeNamePattern,
  type VisualKnowledgeCoverage,
} from "../../lib/visual-knowledge";
import type { NamePatternKnowledgeRule, VisualKnowledgeSeed } from "../../config/visual-knowledge";

export interface PendingKnowledgePattern {
  count: number;
  deviceIds: number[];
  normalizedPattern: string;
  sampleNames: string[];
}

export interface VisualDecisionIssue {
  contextualizedFrom: string;
  deviceRuleDescription: string;
  deviceRuleId: string;
  displayedIconDevice: string;
  hasAmbiguousNameKnowledge: boolean;
  hasNameKnowledge: boolean;
  hasPartKnowledge: boolean;
  id: number;
  lookupMode: "exact" | "flexible" | "none";
  name: string;
  normalizedPattern: string;
  partKnowledgeIconChoices: number;
  partNumber: string;
  proposedIconDevice: string;
  rawIconDeviceProvided: boolean;
  risk: VisualDecisionRisk;
  source: VisualDecisionSource;
  suppressed: boolean;
}

interface KnowledgeStudioPanelProps {
  baseCoverage: VisualKnowledgeCoverage | null;
  baseIssues: VisualDecisionIssue[];
  effectiveCoverage: VisualKnowledgeCoverage | null;
  effectiveIssues: VisualDecisionIssue[];
  enabled: boolean;
  manualSeed: VisualKnowledgeSeed;
  pendingPatterns: PendingKnowledgePattern[];
  onClearRules: () => void;
  onDeleteRule: (normalizedPattern: string) => void;
  onToggleEnabled: () => void;
  onUpsertRule: (rule: NamePatternKnowledgeRule) => void;
}

interface RuleDraft {
  candidateIconDevices: string;
  candidatePartNumbers: string;
  namePattern: string;
  suggestedIconDevice: string;
  suggestedPartNumber: string;
}

const EMPTY_DRAFT: RuleDraft = {
  candidateIconDevices: "",
  candidatePartNumbers: "",
  namePattern: "",
  suggestedIconDevice: "",
  suggestedPartNumber: "",
};

function parseCsvList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function draftFromRule(rule: NamePatternKnowledgeRule): RuleDraft {
  return {
    candidateIconDevices: rule.candidateIconDevices.join(", "),
    candidatePartNumbers: rule.candidatePartNumbers.join(", "),
    namePattern: rule.namePattern,
    suggestedIconDevice: rule.suggestedIconDevice,
    suggestedPartNumber: rule.suggestedPartNumber,
  };
}

function normalizedRuleKey(value: string) {
  return normalizeKnowledgeNamePattern(value);
}

function downloadSeed(seed: VisualKnowledgeSeed) {
  const blob = new Blob([JSON.stringify(seed, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${seed.seedName || "visual-knowledge-overrides"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function KnowledgeStudioPanel({
  baseCoverage,
  baseIssues,
  effectiveCoverage,
  effectiveIssues,
  enabled,
  manualSeed,
  pendingPatterns,
  onClearRules,
  onDeleteRule,
  onToggleEnabled,
  onUpsertRule,
}: KnowledgeStudioPanelProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT);
  const [editingKey, setEditingKey] = useState("");

  const manualRules = useMemo(
    () =>
      manualSeed.namePatternRules
        .slice()
        .sort((left, right) =>
          normalizeKnowledgeNamePattern(left.namePattern).localeCompare(
            normalizeKnowledgeNamePattern(right.namePattern)
          )
        ),
    [manualSeed.namePatternRules]
  );

  const normalizedPreview = useMemo(
    () => normalizedRuleKey(draft.namePattern),
    [draft.namePattern]
  );

  const beforeKnownNames = baseCoverage?.recordsWithKnownNamePattern ?? 0;
  const afterKnownNames = effectiveCoverage?.recordsWithKnownNamePattern ?? 0;
  const beforeUnknownNames = baseCoverage?.unknownNamePatterns.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const afterUnknownNames =
    effectiveCoverage?.unknownNamePatterns.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const beforeKnownIcons = baseCoverage?.recordsWithKnownIconDevice ?? 0;
  const afterKnownIcons = effectiveCoverage?.recordsWithKnownIconDevice ?? 0;
  const beforeRiskyIcons = baseIssues.length;
  const afterRiskyIcons = effectiveIssues.length;

  function getRiskLabel(risk: VisualDecisionRisk) {
    if (risk === "abstain") {
      return t("knowledge.riskAbstain");
    }
    if (risk === "review") {
      return t("knowledge.riskReview");
    }
    return t("knowledge.riskSafe");
  }

  function getSourceLabel(source: VisualDecisionSource) {
    const mapping: Record<VisualDecisionSource, string> = {
      "ambiguous-name-suggestion": t("knowledge.sourceAmbiguousName"),
      "device-rule": t("knowledge.sourceDeviceRule"),
      "existing-icon-device": t("knowledge.sourceExistingIcon"),
      "fallback-device-task-type": t("knowledge.sourceTaskType"),
      "fallback-icon-device": t("knowledge.sourceFallbackIcon"),
      "fallback-part-number": t("knowledge.sourceFallbackPart"),
      "name-pattern": t("knowledge.sourceNamePattern"),
      none: t("knowledge.sourceNone"),
      "part-number": t("knowledge.sourcePartNumber"),
    };

    return mapping[source];
  }

  function describeIssue(issue: VisualDecisionIssue): string[] {
    const notes: string[] = [];
    if (issue.deviceRuleId) {
      notes.push(
        issue.deviceRuleDescription
          ? t("knowledge.noteDeviceRuleDetailed", {
              id: issue.deviceRuleId,
              value: issue.deviceRuleDescription,
            })
          : t("knowledge.noteDeviceRule", { id: issue.deviceRuleId })
      );
    }
    if (!issue.hasNameKnowledge && issue.normalizedPattern) {
      notes.push(t("knowledge.noteMissingNameKnowledge"));
    }
    if (issue.hasAmbiguousNameKnowledge) {
      notes.push(t("knowledge.noteAmbiguousNameKnowledge"));
    }
    if (issue.partKnowledgeIconChoices > 1) {
      notes.push(
        t("knowledge.noteVariantPartKnowledge", {
          count: issue.partKnowledgeIconChoices,
          value: issue.partNumber || t("common.noData"),
        })
      );
    } else if (!issue.hasPartKnowledge && issue.partNumber) {
      notes.push(t("knowledge.noteMissingPartKnowledge", { value: issue.partNumber }));
    }
    if (issue.contextualizedFrom) {
      notes.push(
        t("knowledge.noteContextualized", {
          from: issue.contextualizedFrom,
          to: issue.proposedIconDevice || t("common.noData"),
        })
      );
    }
    if (!issue.rawIconDeviceProvided && issue.proposedIconDevice) {
      notes.push(t("knowledge.noteSystemInferredIcon"));
    }
    if (issue.suppressed) {
      notes.push(t("knowledge.noteHiddenForSafety"));
    }
    return notes;
  }

  function resetDraft() {
    setDraft(EMPTY_DRAFT);
    setEditingKey("");
  }

  function loadPendingPattern(pattern: PendingKnowledgePattern) {
    setDraft((current) => ({
      ...current,
      namePattern: pattern.sampleNames[0] || pattern.normalizedPattern,
    }));
    setEditingKey("");
  }

  function loadRule(rule: NamePatternKnowledgeRule) {
    setDraft(draftFromRule(rule));
    setEditingKey(normalizedRuleKey(rule.namePattern));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const namePattern = draft.namePattern.trim();
    const suggestedPartNumber = draft.suggestedPartNumber.trim();
    const suggestedIconDevice = draft.suggestedIconDevice.trim();

    if (!namePattern || !suggestedPartNumber || !suggestedIconDevice) {
      return;
    }

    const candidatePartNumbers = parseCsvList(draft.candidatePartNumbers);
    const candidateIconDevices = parseCsvList(draft.candidateIconDevices);

    onUpsertRule({
      candidateIconDevices:
        candidateIconDevices.length > 0 ? candidateIconDevices : [suggestedIconDevice],
      candidatePartNumbers:
        candidatePartNumbers.length > 0 ? candidatePartNumbers : [suggestedPartNumber],
      iconConfidence: 1,
      namePattern,
      partConfidence: 1,
      suggestedIconDevice,
      suggestedPartNumber,
    });

    resetDraft();
  }

  return (
    <section className="knowledge-studio">
      <div className="panel-head">
        <div>
          <p className="eyebrow">{t("knowledge.eyebrow")}</p>
          <h2>{t("knowledge.title")}</h2>
        </div>
        <div className="insights-meta">
          <span>{t("knowledge.devOnly")}</span>
          <span>{t("knowledge.manualRules", { count: manualRules.length })}</span>
          <span>{t("knowledge.enabledState", { value: enabled ? t("common.yes") : t("common.no") })}</span>
        </div>
      </div>

      <div className="knowledge-studio__lede">
        <p>{t("knowledge.description")}</p>
      </div>

      <div className="knowledge-toggle-card">
        <div className="knowledge-toggle-card__copy">
          <strong>{t("knowledge.overrideControlTitle")}</strong>
          <span>{t("knowledge.overrideControlHelp", { value: enabled ? t("common.yes") : t("common.no") })}</span>
        </div>
        <button
          type="button"
          className={`secondary-action${enabled ? " secondary-action--active" : ""}`}
          onClick={onToggleEnabled}
        >
          {enabled ? t("knowledge.disableOverrides") : t("knowledge.enableOverrides")}
        </button>
      </div>

      <div className="snapshot-grid snapshot-grid--insights">
        <article className="snapshot-card">
          <span>{t("knowledge.beforeKnownNames")}</span>
          <strong>{beforeKnownNames}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("knowledge.afterKnownNames")}</span>
          <strong>{afterKnownNames}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("knowledge.beforeUnknownNames")}</span>
          <strong>{beforeUnknownNames}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("knowledge.afterUnknownNames")}</span>
          <strong>{afterUnknownNames}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("knowledge.beforeKnownIcons")}</span>
          <strong>{beforeKnownIcons}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("knowledge.afterKnownIcons")}</span>
          <strong>{afterKnownIcons}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("knowledge.beforeRiskyIcons")}</span>
          <strong>{beforeRiskyIcons}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("knowledge.afterRiskyIcons")}</span>
          <strong>{afterRiskyIcons}</strong>
        </article>
      </div>

      <div className="knowledge-studio__actions">
        <button
          type="button"
          className="secondary-action"
          onClick={() => downloadSeed(manualSeed)}
          disabled={manualRules.length === 0}
        >
          {t("knowledge.downloadJson")}
        </button>
        <button
          type="button"
          className="secondary-action"
          onClick={onClearRules}
          disabled={manualRules.length === 0}
        >
          {t("knowledge.clearRules")}
        </button>
      </div>

      <section className="insight-list-card knowledge-studio__card">
        <h3>{t("knowledge.issueListTitle")}</h3>
        {effectiveIssues.length > 0 ? (
          <div className="knowledge-issue-list">
            {effectiveIssues.map((issue) => (
              <article key={issue.id} className="knowledge-issue-card">
                <div className="knowledge-issue-card__top">
                  <div className="knowledge-issue-card__headline">
                    <strong>{t("knowledge.issueId", { id: issue.id })}</strong>
                    <span>{issue.name}</span>
                  </div>
                  <span className={`state-pill state-pill--${issue.risk === "abstain" ? "pending" : "active"}`}>
                    {getRiskLabel(issue.risk)}
                  </span>
                </div>
                <div className="knowledge-issue-card__meta">
                  <span>
                    <strong>{t("knowledge.issueSource")}:</strong> {getSourceLabel(issue.source)}
                  </span>
                  <span>
                    <strong>{t("knowledge.issuePart")}:</strong> {issue.partNumber || t("common.noData")}
                  </span>
                  <span>
                    <strong>{t("knowledge.issueProposedIcon")}:</strong>{" "}
                    {issue.proposedIconDevice || t("common.noData")}
                  </span>
                  <span>
                    <strong>{t("knowledge.issueDisplayedIcon")}:</strong>{" "}
                    {issue.displayedIconDevice || t("common.noIcon")}
                  </span>
                </div>
                <div className="knowledge-issue-card__notes">
                  {describeIssue(issue).map((note) => (
                    <p key={`${issue.id}-${note}`}>{note}</p>
                  ))}
                </div>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      namePattern: issue.name,
                    }))
                  }
                >
                  {t("knowledge.useInForm")}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="knowledge-studio__empty">{t("knowledge.noIssues")}</p>
        )}
      </section>

      <div className="insights-lists">
        <section className="insight-list-card knowledge-studio__card">
          <h3>{t("knowledge.pendingPatterns")}</h3>
          {pendingPatterns.length > 0 ? (
            <div className="knowledge-pattern-list">
              {pendingPatterns.map((pattern) => (
                <article key={pattern.normalizedPattern} className="knowledge-pattern-card">
                  <div className="knowledge-pattern-card__top">
                    <strong>{pattern.normalizedPattern}</strong>
                    <span>{t("knowledge.matchCount", { count: pattern.count })}</span>
                  </div>
                  <div className="knowledge-pattern-card__samples">
                    {pattern.sampleNames.slice(0, 2).map((sample) => (
                      <code key={sample}>{sample}</code>
                    ))}
                  </div>
                  <div className="knowledge-pattern-card__ids">
                    <span>{t("knowledge.deviceIds")}</span>
                    <code>
                      {pattern.deviceIds.length > 0
                        ? pattern.deviceIds.join(", ")
                        : t("knowledge.noDeviceIds")}
                    </code>
                  </div>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => loadPendingPattern(pattern)}
                  >
                    {t("knowledge.useInForm")}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="knowledge-studio__empty">{t("knowledge.noPendingPatterns")}</p>
          )}
        </section>

        <section className="insight-list-card knowledge-studio__card">
          <h3>{editingKey ? t("knowledge.editRule") : t("knowledge.newRule")}</h3>
          <form className="knowledge-form" onSubmit={handleSubmit}>
            <label className="knowledge-form__field">
              <span>{t("knowledge.fieldNamePattern")}</span>
              <textarea
                rows={3}
                value={draft.namePattern}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, namePattern: event.target.value }))
                }
                placeholder={t("knowledge.placeholderNamePattern")}
              />
            </label>

            <div className="knowledge-form__preview">
              <span>{t("knowledge.normalizedPreview")}</span>
              <code>{normalizedPreview || t("common.noData")}</code>
            </div>

            <label className="knowledge-form__field">
              <span>{t("knowledge.fieldSuggestedPart")}</span>
              <input
                type="text"
                value={draft.suggestedPartNumber}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    suggestedPartNumber: event.target.value,
                  }))
                }
                placeholder="MCLV-BAXFA51"
              />
            </label>

            <label className="knowledge-form__field">
              <span>{t("knowledge.fieldSuggestedIcon")}</span>
              <input
                type="text"
                value={draft.suggestedIconDevice}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    suggestedIconDevice: event.target.value,
                  }))
                }
                placeholder="MCLV-BAXFA51 43 LED Monitor"
              />
            </label>

            <label className="knowledge-form__field">
              <span>{t("knowledge.fieldCandidateParts")}</span>
              <input
                type="text"
                value={draft.candidatePartNumbers}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    candidatePartNumbers: event.target.value,
                  }))
                }
                placeholder="MCLV-BAXFA51"
              />
            </label>

            <label className="knowledge-form__field">
              <span>{t("knowledge.fieldCandidateIcons")}</span>
              <input
                type="text"
                value={draft.candidateIconDevices}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    candidateIconDevices: event.target.value,
                  }))
                }
                placeholder="MCLV-BAXFA51 43 LED Monitor"
              />
            </label>

            <div className="knowledge-studio__actions">
              <button type="submit" className="primary-action">
                {editingKey ? t("knowledge.saveRule") : t("knowledge.addRule")}
              </button>
              <button type="button" className="secondary-action" onClick={resetDraft}>
                {t("knowledge.resetForm")}
              </button>
            </div>
          </form>
        </section>
      </div>

      <section className="insight-list-card knowledge-studio__card">
        <h3>{t("knowledge.manualRuleList")}</h3>
        {manualRules.length > 0 ? (
          <div className="knowledge-rule-list">
            {manualRules.map((rule) => {
              const ruleKey = normalizedRuleKey(rule.namePattern);
              return (
                <article key={ruleKey} className="knowledge-rule-card">
                  <div className="knowledge-rule-card__copy">
                    <strong>{ruleKey}</strong>
                    <span>{rule.suggestedPartNumber}</span>
                    <span>{rule.suggestedIconDevice}</span>
                  </div>
                  <div className="knowledge-rule-card__actions">
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => loadRule(rule)}
                    >
                      {t("knowledge.editAction")}
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => onDeleteRule(ruleKey)}
                    >
                      {t("knowledge.deleteAction")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="knowledge-studio__empty">{t("knowledge.noManualRules")}</p>
        )}
      </section>
    </section>
  );
}
