import { useI18n } from "../../i18n";
import type { ProjectInsights } from "./types";

interface ProjectInsightsPanelProps {
  insights: ProjectInsights | null;
}

function templateLabel(
  value: string,
  t: (key: string, vars?: Record<string, string | number | boolean | undefined>) => string
): string {
  if (value === "rich-table") {
    return t("insights.template.rich");
  }
  if (value === "simple-table") {
    return t("insights.template.simple");
  }
  return t("insights.template.unknown");
}

export function ProjectInsightsPanel({ insights }: ProjectInsightsPanelProps) {
  const { t } = useI18n();

  if (!insights) {
    return null;
  }

  const hasUnknownPartNumbers = insights.knowledge.unknownPartNumbers.length > 0;
  const hasUnknownNamePatterns = insights.knowledge.unknownNamePatterns.length > 0;
  const hasPartNumbersMissingIconDevice = insights.knowledge.partNumbersMissingIconDevice.length > 0;
  const hasAmbiguousPatterns = insights.knowledge.ambiguousNamePatterns.length > 0;

  return (
    <section className="insights-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">{t("insights.eyebrow")}</p>
          <h2>{t("insights.title")}</h2>
        </div>
        <div className="insights-meta">
          <span>{templateLabel(insights.context.template, t)}</span>
          <span>{t("insights.dataPages", { count: insights.context.dataPages })}</span>
          <span>{t("insights.records", { count: insights.context.recordsParsed })}</span>
          <span>{t("insights.visualBase", { seed: insights.knowledge.seedName })}</span>
        </div>
      </div>

      <div className="snapshot-grid snapshot-grid--insights">
        <article className="snapshot-card">
          <span>{t("insights.devices")}</span>
          <strong>{insights.totals.totalDevices}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.cameras")}</span>
          <strong>{insights.totals.cameras}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.f360")}</span>
          <strong>{insights.totals.f360}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.ptz")}</span>
          <strong>{insights.totals.ptz}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.monitors")}</span>
          <strong>{insights.totals.monitors}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.switches")}</span>
          <strong>{insights.totals.switches}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.areas")}</span>
          <strong>{insights.totals.areas}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.nameGroups")}</span>
          <strong>{insights.totals.nameGroups}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.partGroups")}</span>
          <strong>{insights.totals.partGroups}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.estimatedCables")}</span>
          <strong>{insights.totals.estimatedCables}</strong>
        </article>
      </div>

      <div className="snapshot-grid snapshot-grid--insights">
        <article className="snapshot-card">
          <span>{t("insights.seedPartBase")}</span>
          <strong>{insights.knowledge.seededPartNumbers}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.seedNameBase")}</span>
          <strong>{insights.knowledge.seededNamePatterns}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.knownPartRecords")}</span>
          <strong>{insights.knowledge.recordsWithKnownPartNumber}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.knownNameRecords")}</span>
          <strong>{insights.knowledge.recordsWithKnownNamePattern}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.seedIconRecords")}</span>
          <strong>{insights.knowledge.recordsWithKnownIconDevice}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.singleSeedIcon")}</span>
          <strong>{insights.knowledge.recordsWithSingleIconDeviceKnowledge}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.knownVariants")}</span>
          <strong>{insights.knowledge.recordsWithVariantIconDeviceKnowledge}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.suggestedWithoutPart")}</span>
          <strong>{insights.knowledge.recordsMissingPartNumberWithSuggestion}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.activeAmbiguousPatterns")}</span>
          <strong>{insights.knowledge.ambiguousNamePatternMatches}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.namePartConflicts")}</span>
          <strong>{insights.knowledge.namePartConflicts}</strong>
        </article>
        <article className="snapshot-card">
          <span>{t("insights.seedWithoutIcon")}</span>
          <strong>{insights.knowledge.recordsWithSeededPartButNoIconDevice}</strong>
        </article>
      </div>

      <div className="insights-lists">
        <section className="insight-list-card">
          <h3>{t("insights.topSwitches")}</h3>
          <ul className="insight-list">
            {insights.topSwitches.map((item) => {
              const cables = insights.switchCables[item.label] ?? 0;
              return (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <span style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted, #6b7a99)", fontWeight: 500 }}>
                      {cables} {cables === 1 ? t("common.cableSingular") : t("common.cablePlural")}
                    </span>
                    <strong>{item.count}</strong>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="insight-list-card">
          <h3>{t("insights.topPartNumbers")}</h3>
          <ul className="insight-list">
            {insights.topPartNumbers.map((item) => (
              <li key={item.label}>
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="insight-list-card">
          <h3>{t("insights.topAreas")}</h3>
          <ul className="insight-list">
            {insights.topAreas.map((item) => (
              <li key={item.label}>
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="insight-list-card">
          <h3>{t("insights.topNames")}</h3>
          <ul className="insight-list">
            {insights.topNames.map((item) => (
              <li key={item.label}>
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="insights-lists">
        <section className="insight-list-card">
          <h3>{t("insights.outsideBaseParts")}</h3>
          {hasUnknownPartNumbers ? (
            <ul className="insight-list">
              {insights.knowledge.unknownPartNumbers.map((item) => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "var(--text-muted, #6b7a99)", margin: 0 }}>
              {t("insights.projectInsidePartSeed")}
            </p>
          )}
        </section>

        <section className="insight-list-card">
          <h3>{t("insights.newNamePatterns")}</h3>
          {hasUnknownNamePatterns ? (
            <ul className="insight-list">
              {insights.knowledge.unknownNamePatterns.map((item) => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "var(--text-muted, #6b7a99)", margin: 0 }}>
              {t("insights.projectNamesKnown")}
            </p>
          )}
        </section>

        <section className="insight-list-card">
          <h3>{t("insights.seedWithoutIcon")}</h3>
          {hasPartNumbersMissingIconDevice ? (
            <ul className="insight-list">
              {insights.knowledge.partNumbersMissingIconDevice.map((item) => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "var(--text-muted, #6b7a99)", margin: 0 }}>
              {t("insights.seedPartsAlreadyHaveIcon")}
            </p>
          )}
        </section>

        <section className="insight-list-card">
          <h3>{t("insights.knownAmbiguousPatterns")}</h3>
          {hasAmbiguousPatterns ? (
            <ul className="insight-list">
              {insights.knowledge.ambiguousNamePatterns.map((item) => (
                <li key={item.label}>
                  <span>
                    {item.label}
                    <span style={{ display: "block", fontSize: "0.72rem", opacity: 0.72 }}>
                      {t("insights.seedPart")}: {item.candidatePartNumbers.join(" / ")} · {t("insights.confidenceShort")} {Math.round(item.partConfidence * 100)}%
                    </span>
                    <span style={{ display: "block", fontSize: "0.72rem", opacity: 0.72 }}>
                      {t("insights.icon")}: {item.candidateIconDevices.join(" / ")} · {t("insights.confidenceShort")} {Math.round(item.iconConfidence * 100)}%
                    </span>
                  </span>
                  <strong>{item.count}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "var(--text-muted, #6b7a99)", margin: 0 }}>
              {t("insights.noActiveAmbiguousPatterns")}
            </p>
          )}
        </section>

        <section className="insight-list-card">
          <h3>{t("insights.partNumbersWithVariants")}</h3>
          {insights.knowledge.partNumbersWithVariantChoices.length > 0 ? (
            <ul className="insight-list">
              {insights.knowledge.partNumbersWithVariantChoices.map((item) => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "var(--text-muted, #6b7a99)", margin: 0 }}>
              {t("insights.noActivePartVariants")}
            </p>
          )}
        </section>
      </div>

      <div className="review-strip">
        <span>{t("insights.missingPartNumber", { count: insights.review.missingPartNumber })}</span>
        <span>
          {t("insights.missingSwitch", { count: insights.review.missingSwitch })}
          {insights.review.missingSwitchIds.length > 0 && (
            <span style={{ marginLeft: "0.4rem", opacity: 0.7, fontWeight: 400 }}>
              {t("insights.idList", { ids: insights.review.missingSwitchIds.join(", ") })}
            </span>
          )}
        </span>
        <span>{t("insights.missingPositions", { count: insights.review.missingPositions })}</span>
      </div>
    </section>
  );
}
