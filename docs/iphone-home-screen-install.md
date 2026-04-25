# Agregar CCTV Field Planner al inicio del iPhone

Esta guia describe como un tecnico de campo instala la app web (no nativa) de
CCTV Field Planner como icono en la pantalla de inicio de su iPhone, y como
funciona la implementacion del lado de la app.

> Importante: iOS no permite que un sitio se instale automaticamente. El
> usuario tiene que hacer "Add to Home Screen" manualmente desde Safari.

## Mensaje para enviar al tecnico

> Open this link in Safari. Tap Share, then Add to Home Screen. After that,
> you can open CCTV Field Planner directly from the icon on your iPhone.

Version en espanol:

> Abre este enlace en Safari. Toca Compartir y elige "Agregar a pantalla de
> inicio". Despues podras abrir CCTV Field Planner directamente desde el icono
> en tu iPhone.

## Pasos para el tecnico

1. Abre el enlace de la app **en Safari** (no Chrome ni una app embebida tipo
   Gmail, WhatsApp, Instagram, etc.).
2. Toca el boton **Compartir** (cuadrado con flecha hacia arriba) en la barra
   inferior.
3. Desplaza el menu y selecciona **"Agregar a pantalla de inicio"**
   ("Add to Home Screen").
4. Confirma con **Agregar**.
5. Cierra Safari y abre la app desde el nuevo icono. Se abrira en pantalla
   completa, sin barra de URL.

Si no aparece la opcion **Agregar a pantalla de inicio**, casi siempre es
porque el enlace se abrio dentro de la app de mensajeria. La solucion es
copiar la URL y pegarla manualmente en Safari.

## Lo que la app hace por su cuenta

- `index.html` declara las meta tags de iOS:
  - `apple-mobile-web-app-capable`
  - `apple-mobile-web-app-status-bar-style`
  - `apple-mobile-web-app-title`
  - `apple-touch-icon` (apuntando a `/apple-touch-icon.png`)
  - `theme-color`
  - `viewport` con `viewport-fit=cover` para respetar el notch.
- El web manifest (`/manifest.webmanifest`) lo genera `vite-plugin-pwa` con
  `display: standalone`, `start_url: /` e iconos PNG/SVG en distintos tamanos.
- Iconos servidos desde `public/`:
  - `apple-touch-icon.png` (180x180, usado por iOS al "instalar")
  - `pwa-icon-192.png`, `pwa-icon-512.png` (manifest estandar)
  - `pwa-icon.svg`, `favicon.svg` (vectorial)
- En tiempo de ejecucion, `src/modules/ios-install/IosInstallPrompt.tsx`
  detecta si el usuario esta en **iPhone/iPad + Safari + no standalone** y:
  - Muestra un banner discreto con la instruccion corta.
  - Ofrece un boton **"Como instalar"** que abre un modal con los pasos.
  - Cuando el banner se cierra, deja un boton flotante
    **"Agregar al inicio"** para que el tecnico vuelva a ver las
    instrucciones cuando quiera.
  - Si la app ya esta corriendo en standalone (display-mode: standalone o
    `navigator.standalone === true`), no muestra nada.
  - El estado "cerrado" del banner se guarda en `localStorage` con la clave
    `ccp.ios-install.banner.dismissed.v1`.

## Como verificar despues de desplegar

1. Abre la URL desplegada en Safari del iPhone.
2. Confirma que aparece el banner inferior con "Instalar en el iPhone".
3. Sigue los pasos Compartir -> Agregar a pantalla de inicio.
4. El icono debe verse con el logo de CCTV Field Planner (no un screenshot).
5. Al abrirlo desde el icono, la app debe aparecer en pantalla completa
   (sin barra de Safari) y el banner ya no debe mostrarse.

## Limitaciones conocidas de iOS

- No hay API equivalente a `beforeinstallprompt` (Chrome/Android). No se puede
  forzar la instalacion ni mostrar un prompt nativo.
- El usuario debe estar en Safari. Webviews dentro de otras apps (Gmail,
  WhatsApp, Instagram, Slack, etc.) no muestran "Add to Home Screen".
- El icono es el `apple-touch-icon.png` declarado, no el SVG.
- Si se cambia el icono, iOS puede cachearlo: el tecnico tendria que borrar
  y volver a agregar el acceso para verlo actualizado.
