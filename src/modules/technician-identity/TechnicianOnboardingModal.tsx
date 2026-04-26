import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { computeInitials, normalizeName } from "../../lib/technician-identity";
import type { TechnicianIdentity } from "../../types";

interface TechnicianOnboardingModalProps {
  open: boolean;
  initialName?: string;
  mode?: "onboarding" | "edit";
  onSubmit: (name: string) => void;
  onCancel?: () => void;
  existingIdentity?: TechnicianIdentity | null;
}

export function TechnicianOnboardingModal({
  open,
  initialName,
  mode = "onboarding",
  onSubmit,
  onCancel,
  existingIdentity,
}: TechnicianOnboardingModalProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(initialName ?? existingIdentity?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initialName ?? existingIdentity?.name ?? "");
      setError(null);
      const handle = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 80);
      return () => window.clearTimeout(handle);
    }
  }, [open, initialName, existingIdentity]);

  const trimmed = useMemo(() => normalizeName(value), [value]);
  const previewInitials = useMemo(
    () => (trimmed.length >= 2 ? computeInitials(trimmed) : ""),
    [trimmed]
  );

  if (!open) {
    return null;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (trimmed.length < 2) {
      setError(t("technician.onboarding.error"));
      return;
    }
    onSubmit(trimmed);
  }

  const isEdit = mode === "edit";

  return (
    <div
      className="technician-onboarding"
      role="dialog"
      aria-modal="true"
      aria-labelledby="technician-onboarding-title"
    >
      <div className="technician-onboarding__backdrop" />
      <form className="technician-onboarding__panel" onSubmit={handleSubmit}>
        <h2 id="technician-onboarding-title" className="technician-onboarding__title">
          {isEdit ? t("technician.menu.editTitle") : t("technician.onboarding.title")}
        </h2>
        <p className="technician-onboarding__subtitle">
          {t("technician.onboarding.subtitle")}
        </p>
        <label className="technician-onboarding__label" htmlFor="technician-name">
          {t("technician.onboarding.label")}
        </label>
        <input
          id="technician-name"
          ref={inputRef}
          className="technician-onboarding__input"
          type="text"
          autoComplete="name"
          autoCapitalize="words"
          spellCheck={false}
          value={value}
          placeholder={t("technician.onboarding.placeholder")}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
        />
        {previewInitials && (
          <p className="technician-onboarding__initials">
            {t("technician.onboarding.initialsPreview", { initials: previewInitials })}
          </p>
        )}
        {error && <p className="technician-onboarding__error">{error}</p>}
        <p className="technician-onboarding__privacy">
          {t("technician.onboarding.privacy")}
        </p>
        <div className="technician-onboarding__actions">
          {isEdit && onCancel && (
            <button
              type="button"
              className="technician-onboarding__cancel"
              onClick={onCancel}
            >
              {t("technician.menu.cancel")}
            </button>
          )}
          <button type="submit" className="technician-onboarding__submit">
            {isEdit ? t("technician.menu.save") : t("technician.onboarding.continue")}
          </button>
        </div>
      </form>
    </div>
  );
}

export default TechnicianOnboardingModal;
