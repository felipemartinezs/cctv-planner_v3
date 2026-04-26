import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { I18nProvider } from "./i18n";
import IosInstallPrompt from "./modules/ios-install/IosInstallPrompt";
import "./styles.css";

let swRegistration: ServiceWorkerRegistration | undefined;

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    swRegistration = registration;
    // Auto-check for updates every 60s while the tab stays open.
    if (registration) {
      setInterval(() => {
        registration.update().catch(() => {});
      }, 60 * 1000);
    }
  },
  onNeedRefresh() {
    // A new build is ready: activate it and reload immediately.
    updateSW(true);
  },
  onOfflineReady() {
    console.info("[pwa] App lista para uso offline.");
  },
});

// iOS Safari PWAs do not fire the standard "update" tick when resumed from the
// Home Screen, so poke the SW every time the app becomes visible again.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      swRegistration?.update().catch(() => {});
    }
  });
  window.addEventListener("focus", () => {
    swRegistration?.update().catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
      <IosInstallPrompt />
    </I18nProvider>
  </React.StrictMode>
);
