import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n";

const DISMISS_KEY = "ccp.ios-install.banner.dismissed.v1";

// iOS menu labels are intentionally kept in English because the technician's
// iPhone interface is in English. The surrounding explanation is translated.
const IOS_LABELS = {
  share: "Share",
  addToHome: "Add to Home Screen",
  add: "Add",
} as const;

type Copy = {
  bannerTitle: string;
  bannerBody: (share: string, addToHome: string) => React.ReactNode;
  bannerCta: string;
  bannerClose: string;
  fab: string;
  modalTitle: string;
  modalIntro: string;
  step1: (safari: string) => React.ReactNode;
  step2: (share: string) => React.ReactNode;
  step3: (addToHome: string) => React.ReactNode;
  step4: (add: string) => React.ReactNode;
  note: string;
  ok: string;
  ariaDialog: string;
  ariaModal: string;
  ariaFab: string;
  ariaClose: string;
};

const COPY: Record<"en" | "es", Copy> = {
  en: {
    bannerTitle: "Install on your iPhone",
    bannerBody: (share, addToHome) => (
      <>
        Tap{" "}
        <span aria-label={share} role="img">
          &#x2B06;&#xFE0F;
        </span>{" "}
        <strong>{share}</strong> in Safari and choose{" "}
        <strong>{addToHome}</strong>.
      </>
    ),
    bannerCta: "How to install",
    bannerClose: "Close",
    fab: "Add to Home Screen",
    modalTitle: "Add to your iPhone Home Screen",
    modalIntro:
      "Follow these steps in Safari to get the app icon on your Home Screen:",
    step1: (safari) => (
      <>
        Open this site in <strong>{safari}</strong> (not Chrome or another
        app).
      </>
    ),
    step2: (share) => (
      <>
        Tap the <strong>{share}</strong> button{" "}
        <span aria-hidden="true">&#x2B06;&#xFE0F;</span> in the bottom toolbar.
      </>
    ),
    step3: (addToHome) => (
      <>
        Scroll down and choose <strong>&ldquo;{addToHome}&rdquo;</strong>.
      </>
    ),
    step4: (add) => (
      <>
        Tap <strong>{add}</strong> at the top right. The CCTV Field Planner
        icon will appear on your Home Screen.
      </>
    ),
    note: "iOS does not allow auto-install. You have to use the Share menu.",
    ok: "Got it",
    ariaDialog: "Install on Home Screen",
    ariaModal: "How to add to your iPhone Home Screen",
    ariaFab: "How to add this app to the iPhone Home Screen",
    ariaClose: "Close notice",
  },
  es: {
    bannerTitle: "Instalar en el iPhone",
    bannerBody: (share, addToHome) => (
      <>
        Toca{" "}
        <span aria-label={share} role="img">
          &#x2B06;&#xFE0F;
        </span>{" "}
        <strong>{share}</strong> en Safari y elige{" "}
        <strong>{addToHome}</strong>.
      </>
    ),
    bannerCta: "Como instalar",
    bannerClose: "Cerrar",
    fab: "Add to Home Screen",
    modalTitle: "Agregar al inicio del iPhone",
    modalIntro:
      "Sigue estos pasos en Safari para obtener el icono de la app en tu pantalla de inicio:",
    step1: (safari) => (
      <>
        Abre este sitio en <strong>{safari}</strong> (no Chrome ni otra app
        como WhatsApp o Gmail).
      </>
    ),
    step2: (share) => (
      <>
        Toca el boton <strong>{share}</strong>{" "}
        <span aria-hidden="true">&#x2B06;&#xFE0F;</span> en la barra inferior
        de Safari.
      </>
    ),
    step3: (addToHome) => (
      <>
        Desplazate hacia abajo y elige{" "}
        <strong>&ldquo;{addToHome}&rdquo;</strong>.
      </>
    ),
    step4: (add) => (
      <>
        Toca <strong>{add}</strong> arriba a la derecha. El icono de CCTV
        Field Planner apareceria en tu pantalla de inicio.
      </>
    ),
    note: 'iOS no permite instalar automaticamente. Tienes que usar el menu "Share".',
    ok: "Entendido",
    ariaDialog: "Instalar en pantalla de inicio",
    ariaModal: "Como agregar al inicio del iPhone",
    ariaFab: "Como agregar esta app al inicio del iPhone",
    ariaClose: "Cerrar aviso",
  },
};

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIPhoneOrIPad = /iPhone|iPad|iPod/i.test(ua);
  const isIpadOs =
    /Macintosh/i.test(ua) &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1;
  return isIPhoneOrIPad || isIpadOs;
}

function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/(CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo|mercury)/i.test(ua)) {
    return false;
  }
  if (/(FBAN|FBAV|Instagram|Line\/|Twitter|LinkedInApp|WhatsApp)/i.test(ua)) {
    return false;
  }
  return /Safari/i.test(ua);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(display-mode: standalone)").matches;
  }
  return false;
}

export default function IosInstallPrompt() {
  const { lang } = useI18n();
  const copy = COPY[lang === "en" ? "en" : "es"];
  const eligible = useMemo(() => isIos() && isSafari() && !isStandalone(), []);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  if (!eligible) return null;

  const dismissBanner = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      {!dismissed ? (
        <div role="dialog" aria-label={copy.ariaDialog} style={bannerStyle}>
          <div style={bannerTextStyle}>
            <strong>{copy.bannerTitle}</strong>
            <span style={{ opacity: 0.85 }}>
              {copy.bannerBody(IOS_LABELS.share, IOS_LABELS.addToHome)}
            </span>
          </div>
          <div style={bannerActionsStyle}>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              style={primaryButtonStyle}
            >
              {copy.bannerCta}
            </button>
            <button
              type="button"
              onClick={dismissBanner}
              style={ghostButtonStyle}
              aria-label={copy.ariaClose}
            >
              {copy.bannerClose}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          style={fabStyle}
          aria-label={copy.ariaFab}
        >
          {copy.fab}
        </button>
      )}

      {modalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={copy.ariaModal}
          style={modalBackdropStyle}
          onClick={(event) => {
            if (event.target === event.currentTarget) setModalOpen(false);
          }}
        >
          <div style={modalCardStyle}>
            <h2 style={{ margin: 0, fontSize: 20, color: "#14213d" }}>
              {copy.modalTitle}
            </h2>
            <p style={{ margin: "8px 0 16px", color: "#333" }}>
              {copy.modalIntro}
            </p>
            <ol
              style={{
                margin: 0,
                paddingLeft: 20,
                color: "#333",
                lineHeight: 1.5,
              }}
            >
              <li>{copy.step1("Safari")}</li>
              <li>{copy.step2(IOS_LABELS.share)}</li>
              <li>{copy.step3(IOS_LABELS.addToHome)}</li>
              <li>{copy.step4(IOS_LABELS.add)}</li>
            </ol>
            <p style={{ margin: "16px 0 0", color: "#555", fontSize: 13 }}>
              {copy.note}
            </p>
            <div
              style={{
                marginTop: 20,
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={primaryButtonStyle}
              >
                {copy.ok}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

const bannerStyle: React.CSSProperties = {
  position: "fixed",
  left: 12,
  right: 12,
  bottom: "max(12px, env(safe-area-inset-bottom))",
  zIndex: 9998,
  background: "#14213d",
  color: "#f7f4ee",
  borderRadius: 14,
  padding: "12px 14px",
  boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
  display: "flex",
  alignItems: "center",
  gap: 12,
  fontSize: 14,
  flexWrap: "wrap",
};

const bannerTextStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  flex: "1 1 180px",
  minWidth: 0,
};

const bannerActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexShrink: 0,
};

const primaryButtonStyle: React.CSSProperties = {
  background: "#fca311",
  color: "#14213d",
  border: "none",
  borderRadius: 10,
  padding: "8px 12px",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};

const ghostButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "#f7f4ee",
  border: "1px solid rgba(247,244,238,0.4)",
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 14,
  cursor: "pointer",
};

const fabStyle: React.CSSProperties = {
  position: "fixed",
  right: 12,
  bottom: "max(12px, env(safe-area-inset-bottom))",
  zIndex: 9997,
  background: "#14213d",
  color: "#fca311",
  border: "1px solid #fca311",
  borderRadius: 999,
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 700,
  boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
  cursor: "pointer",
};

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(20,33,61,0.55)",
  zIndex: 9999,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  padding: 12,
  paddingBottom: "max(12px, env(safe-area-inset-bottom))",
};

const modalCardStyle: React.CSSProperties = {
  background: "#fffdf7",
  borderRadius: 18,
  padding: "20px 18px",
  maxWidth: 480,
  width: "100%",
  boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
};
