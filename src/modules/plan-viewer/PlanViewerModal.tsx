import type { PlanData } from "../../types";
import type { PlanSegmentation } from "../plan-segmentation";

interface PlanViewerModalProps {
  onClose: () => void;
  open: boolean;
  plan: PlanData | null;
  segmentation: PlanSegmentation | null;
}

export function PlanViewerModal({ onClose, open, plan }: PlanViewerModalProps) {
  if (!open || !plan) {
    return null;
  }

  return (
    <div className="pdf-modal" role="dialog" aria-modal="true" aria-label="Plano pagina 1">
      <div className="pdf-modal__header">
        <div>
          <p className="eyebrow">Plano de campo</p>
          <h2>{plan.title}</h2>
        </div>
        <div className="pdf-modal__actions">
          <button
            type="button"
            className="secondary-action"
            onClick={() => window.open(plan.viewerUrl, "_blank", "noopener,noreferrer")}
          >
            Abrir PDF
          </button>
          <button type="button" className="primary-action" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>

      <div className="pdf-modal__body">
        <iframe
          key={plan.viewerUrl}
          title="Plano pagina 1"
          src={plan.viewerUrl}
          className="pdf-modal__frame"
        />
      </div>
    </div>
  );
}
