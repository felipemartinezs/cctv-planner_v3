import { useEffect, useMemo, useState } from "react";

const DISMISS_KEY = "ccp.ios-install.banner.dismissed.v1";

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIPhoneOrIPad = /iPhone|iPad|iPod/i.test(ua);
  // iPadOS 13+ identifies as Mac but is touch-capable
  const isIpadOs =
    /Macintosh/i.test(ua) &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1;
  return isIPhoneOrIPad || isIpadOs;
}

function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // Exclude in-app webviews (CriOS = Chrome iOS, FxiOS = Firefox iOS, EdgiOS, etc.)
  // and social in-app browsers (FBAN/FBAV = Facebook, Instagram, Line, etc.).
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
        <div
          role="dialog"
          aria-label="Instalar en la pantalla de inicio"
          style={bannerStyle}
        >
          <div style={bannerTextStyle}>
            <strong>Instalar en el iPhone</strong>
            <span style={{ opacity: 0.85 }}>
              Toca{" "}
              <span aria-label="Compartir" role="img">
                &#x2B06;&#xFE0F;
              </span>{" "}
              Compartir y elige &ldquo;Agregar a pantalla de inicio&rdquo;.
            </span>
          </div>
          <div style={bannerActionsStyle}>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              style={primaryButtonStyle}
            >
              Como instalar
            </button>
            <button
              type="button"
              onClick={dismissBanner}
              style={ghostButtonStyle}
              aria-label="Cerrar aviso"
            >
              Cerrar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          style={fabStyle}
          aria-label="Como agregar esta app al inicio del iPhone"
        >
          Agregar al inicio
        </button>
      )}

      {modalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Como agregar al inicio del iPhone"
          style={modalBackdropStyle}
          onClick={(event) => {
            if (event.target === event.currentTarget) setModalOpen(false);
          }}
        >
          <div style={modalCardStyle}>
            <h2 style={{ margin: 0, fontSize: 20, color: "#14213d" }}>
              Agregar al inicio del iPhone
            </h2>
            <p style={{ margin: "8px 0 16px", color: "#333" }}>
              Sigue estos pasos en Safari para obtener el icono de la app en tu
              pantalla de inicio:
            </p>
            <ol style={{ margin: 0, paddingLeft: 20, color: "#333", lineHeight: 1.5 }}>
              <li>
                Abre este sitio en <strong>Safari</strong> (no Chrome ni otra
                app).
              </li>
              <li>
                Toca el boton <strong>Compartir</strong>{" "}
                <span aria-hidden="true">&#x2B06;&#xFE0F;</span> en la barra
                inferior.
              </li>
              <li>
                Desplazate y elige{" "}
                <strong>&ldquo;Agregar a pantalla de inicio&rdquo;</strong>.
              </li>
              <li>
                Toca <strong>Agregar</strong>. Veras el icono de CCTV Field
                Planner en tu pantalla de inicio.
              </li>
            </ol>
            <p style={{ margin: "16px 0 0", color: "#555", fontSize: 13 }}>
              iOS no permite instalar la app automaticamente, tienes que
              hacerlo desde el menu Compartir.
            </p>
            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={primaryButtonStyle}
              >
                Entendido
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
