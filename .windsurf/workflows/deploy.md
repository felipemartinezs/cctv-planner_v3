---
description: Deploy a Google App Engine (standard, nodejs24). NUNCA Netlify, Vercel u otro provider.
---

Este proyecto SIEMPRE se despliega a Google App Engine en el proyecto `cctv-planner-491120`.
URL de produccion: https://cctv-planner-491120.uc.r.appspot.com

No usar `deploy_web_app`, ni Netlify, ni Vercel, ni ningun otro proveedor.

## Pasos

1. Verificar que el build de Vite compila sin errores.
// turbo
```bash
npm run build
```

2. Desplegar a App Engine (usa `app.yaml` del repo, runtime `nodejs24`, servicio `default`).
// turbo
```bash
gcloud app deploy --quiet --project=cctv-planner-491120
```

3. (Opcional) Abrir la app desplegada.
```bash
gcloud app browse --project=cctv-planner-491120
```

## Notas

- El proyecto de GCP ya esta configurado en el gcloud local (`gcloud config get-value project` -> `cctv-planner-491120`).
- `app.yaml` define: runtime nodejs24, service default, instance F1, Datastore + GCS para operational progress y library.
- El servidor es `server.mjs` (Node + Express) que sirve el build estatico de Vite.
- Para previews locales usar `npm run dev`. Para verificar el build `npm run preview` o `npm run start` (sirve `dist/`).
