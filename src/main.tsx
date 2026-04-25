import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { I18nProvider } from "./i18n";
import IosInstallPrompt from "./modules/ios-install/IosInstallPrompt";
import "./styles.css";

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateSW(true);
  },
  onOfflineReady() {
    console.info("[pwa] App lista para uso offline.");
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
      <IosInstallPrompt />
    </I18nProvider>
  </React.StrictMode>
);
