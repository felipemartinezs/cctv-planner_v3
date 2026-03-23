import type { ProjectInsights } from "./types";

interface ProjectInsightsPanelProps {
  insights: ProjectInsights | null;
}

function templateLabel(value: string): string {
  if (value === "rich-table") {
    return "Tabla rica";
  }
  if (value === "simple-table") {
    return "Tabla simple";
  }
  return "Sin clasificar";
}

export function ProjectInsightsPanel({ insights }: ProjectInsightsPanelProps) {
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
          <p className="eyebrow">Datos Parseados</p>
          <h2>Resumen del PDF</h2>
        </div>
        <div className="insights-meta">
          <span>{templateLabel(insights.context.template)}</span>
          <span>{insights.context.dataPages} paginas de datos</span>
          <span>{insights.context.recordsParsed} registros</span>
          <span>Base visual: {insights.knowledge.seedName}</span>
        </div>
      </div>

      <div className="snapshot-grid snapshot-grid--insights">
        <article className="snapshot-card">
          <span>Dispositivos</span>
          <strong>{insights.totals.totalDevices}</strong>
        </article>
        <article className="snapshot-card">
          <span>Camaras</span>
          <strong>{insights.totals.cameras}</strong>
        </article>
        <article className="snapshot-card">
          <span>F360</span>
          <strong>{insights.totals.f360}</strong>
        </article>
        <article className="snapshot-card">
          <span>PTZ</span>
          <strong>{insights.totals.ptz}</strong>
        </article>
        <article className="snapshot-card">
          <span>Monitores</span>
          <strong>{insights.totals.monitors}</strong>
        </article>
        <article className="snapshot-card">
          <span>Switches</span>
          <strong>{insights.totals.switches}</strong>
        </article>
        <article className="snapshot-card">
          <span>Areas</span>
          <strong>{insights.totals.areas}</strong>
        </article>
        <article className="snapshot-card">
          <span>Grupos Name</span>
          <strong>{insights.totals.nameGroups}</strong>
        </article>
        <article className="snapshot-card">
          <span>Grupos Part Number</span>
          <strong>{insights.totals.partGroups}</strong>
        </article>
        <article className="snapshot-card">
          <span>Cables estimados</span>
          <strong>{insights.totals.estimatedCables}</strong>
        </article>
      </div>

      <div className="snapshot-grid snapshot-grid--insights">
        <article className="snapshot-card">
          <span>Base Manteca Part #</span>
          <strong>{insights.knowledge.seededPartNumbers}</strong>
        </article>
        <article className="snapshot-card">
          <span>Base Manteca Names</span>
          <strong>{insights.knowledge.seededNamePatterns}</strong>
        </article>
        <article className="snapshot-card">
          <span>Registros con Part # conocido</span>
          <strong>{insights.knowledge.recordsWithKnownPartNumber}</strong>
        </article>
        <article className="snapshot-card">
          <span>Registros con Name conocido</span>
          <strong>{insights.knowledge.recordsWithKnownNamePattern}</strong>
        </article>
        <article className="snapshot-card">
          <span>Registros con icono semilla</span>
          <strong>{insights.knowledge.recordsWithKnownIconDevice}</strong>
        </article>
        <article className="snapshot-card">
          <span>Icono semilla unico</span>
          <strong>{insights.knowledge.recordsWithSingleIconDeviceKnowledge}</strong>
        </article>
        <article className="snapshot-card">
          <span>Variantes conocidas</span>
          <strong>{insights.knowledge.recordsWithVariantIconDeviceKnowledge}</strong>
        </article>
        <article className="snapshot-card">
          <span>Sin Part # pero sugeridos</span>
          <strong>{insights.knowledge.recordsMissingPartNumberWithSuggestion}</strong>
        </article>
        <article className="snapshot-card">
          <span>Patrones ambiguos activos</span>
          <strong>{insights.knowledge.ambiguousNamePatternMatches}</strong>
        </article>
        <article className="snapshot-card">
          <span>Conflictos Name vs Part #</span>
          <strong>{insights.knowledge.namePartConflicts}</strong>
        </article>
        <article className="snapshot-card">
          <span>Seed sin icono asignado</span>
          <strong>{insights.knowledge.recordsWithSeededPartButNoIconDevice}</strong>
        </article>
      </div>

      <div className="insights-lists">
        <section className="insight-list-card">
          <h3>Top switches</h3>
          <ul className="insight-list">
            {insights.topSwitches.map((item) => {
              const cables = insights.switchCables[item.label] ?? 0;
              return (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <span style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted, #6b7a99)", fontWeight: 500 }}>
                      {cables} cable{cables !== 1 ? "s" : ""}
                    </span>
                    <strong>{item.count}</strong>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="insight-list-card">
          <h3>Top part numbers</h3>
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
          <h3>Top areas</h3>
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
          <h3>Top names</h3>
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
          <h3>Part numbers fuera de base</h3>
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
              Todo el proyecto actual cae dentro de la base semilla de Part Number.
            </p>
          )}
        </section>

        <section className="insight-list-card">
          <h3>Name patterns nuevos</h3>
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
              Los names del proyecto actual ya tienen huella dentro de Manteca.
            </p>
          )}
        </section>

        <section className="insight-list-card">
          <h3>Seed sin icono asignado</h3>
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
              Los Part Numbers semilla usados en este proyecto ya traen icono asignado.
            </p>
          )}
        </section>

        <section className="insight-list-card">
          <h3>Patrones ambiguos conocidos</h3>
          {hasAmbiguousPatterns ? (
            <ul className="insight-list">
              {insights.knowledge.ambiguousNamePatterns.map((item) => (
                <li key={item.label}>
                  <span>
                    {item.label}
                    <span style={{ display: "block", fontSize: "0.72rem", opacity: 0.72 }}>
                      Part: {item.candidatePartNumbers.join(" / ")} · conf. {Math.round(item.partConfidence * 100)}%
                    </span>
                    <span style={{ display: "block", fontSize: "0.72rem", opacity: 0.72 }}>
                      Icono: {item.candidateIconDevices.join(" / ")} · conf. {Math.round(item.iconConfidence * 100)}%
                    </span>
                  </span>
                  <strong>{item.count}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "var(--text-muted, #6b7a99)", margin: 0 }}>
              No hay patrones ambiguos activos en este proyecto.
            </p>
          )}
        </section>

        <section className="insight-list-card">
          <h3>Part numbers con variantes</h3>
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
              No hay part numbers con variantes activas en este proyecto.
            </p>
          )}
        </section>
      </div>

      <div className="review-strip">
        <span>Sin part number: {insights.review.missingPartNumber}</span>
        <span>
          Sin switch: {insights.review.missingSwitch}
          {insights.review.missingSwitchIds.length > 0 && (
            <span style={{ marginLeft: "0.4rem", opacity: 0.7, fontWeight: 400 }}>
              (ID: {insights.review.missingSwitchIds.join(", ")})
            </span>
          )}
        </span>
        <span>Sin posicion: {insights.review.missingPositions}</span>
      </div>
    </section>
  );
}
