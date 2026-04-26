# CCTV Field Planner v3

Aplicacion web orientada a tecnicos de campo para convertir PDFs de CCTV en tareas accionables, conteos reales y una vista de segmentacion tactil sobre el plano.

El proyecto nace de una friccion operativa concreta: recibir informacion de proyecto distribuida entre un plano austero con IDs y tablas separadas con `Name`, `Part Number` y `Hub`, lo que obliga a mas interpretacion manual para preparar y ejecutar trabajo en campo.

## Produccion

https://cctv-planner-491120.uc.r.appspot.com (Google App Engine)

> **Deploy siempre a Google App Engine.** Nunca usar Netlify, Vercel ni otro provider.
> Proyecto GCP: `cctv-planner-491120` · Runtime: `nodejs24` · Servicio: `default` (ver `app.yaml`).
>
> ```bash
> npm run build
> gcloud app deploy --quiet --project=cctv-planner-491120
> ```
>
> Referencia rapida en `.windsurf/workflows/deploy.md` (slash command `/deploy`).

## Reportes y presentaciones

- Tecnico: `reporte/index.html`
- Ejecutivo: `reporte/index-cio.html`
- Ejecutivo bilingue: `reporte/index-cio-bilingual.html`

Versiones publicadas:

- https://cctv-planner-491120.uc.r.appspot.com/reporte/index.html
- https://cctv-planner-491120.uc.r.appspot.com/reporte/index-cio.html
- https://cctv-planner-491120.uc.r.appspot.com/reporte/index-cio-bilingual.html

## Asset para LinkedIn

- Cover editable: `reporte/social/linkedin-cover.html`
- Preview movil: `reporte/assets/linkedin-mobile-preview.png`
- PNG exportado: `reporte/assets/linkedin-cover.png`

Mensaje base sugerido:

`La informacion ya existia. Faltaba volverla operativa.`

## Estado actual

- Pensada primero para iPhone — toda la UX esta optimizada para uso en campo.
- Selector de idioma `ES / EN` con persistencia local.
- Procesa el PDF en el navegador y ahora expone una API ligera para persistencia operativa por proyecto.
- Ya puede publicar PDFs como proyectos compartidos y reabrirlos desde una biblioteca basica dentro de la app.
- Usa la pagina 1 como plano de referencia.
- Usa las paginas de datos del PDF para construir `DeviceRecord[]`.
- Incluye una libreria interna de iconos universal en `public/device-icons/Camera Symbols`.
- Puede recibir iconos extra por ZIP o folder solo como suplemento opcional.
- Mantiene avance operativo por dispositivo con cache local y sincronizacion compartida por proyecto cuando el backend esta disponible.

## Documentacion de flujo operativo

- Flujo colaborativo propuesto para tecnico / gerencia: [docs/operational-progress-flow.md](docs/operational-progress-flow.md)
- Este documento separa claramente:
  - lo que la app ya hace hoy
  - la base ya implementada de progreso persistente por proyecto
  - la capa futura de progreso en tiempo real por tienda / gerencia
  - el flujo iPhone-first para evitar errores operativos

## Arranque local

```bash
npm install
npm run dev
```

En desarrollo, las APIs compartidas quedan disponibles dentro del mismo `vite dev server` y persisten en:

- `.runtime-data/operational-progress.json`
- `.runtime-data/published-projects.json`
- `.runtime-data/published-project-files/`

Build de produccion:

```bash
npm run build
```

## Flujo principal

1. Cargar el `PDF del plano`.
2. Opcionalmente cargar:
   - `CSV base`
   - `PDF / CSV adicional`
   - `CSV de partes / iconos`
   - `ZIP de iconos extra`
   - `Folder de iconos extra`
3. Pulsar `Procesar`.
4. Revisar:
   - `Project Insights`
   - `Field Tasks`
   - `Ver pagina 1`
   - `Segmentacion`

En el flujo normal de campo, el unico archivo realmente obligatorio es el `PDF del plano`.

## Qué hace la app

- Parsea paginas de datos del PDF.
- Convierte registros en tareas de campo.
- Unifica y limpia informacion de `switch`, `part number`, `area`, `icon device` y posicion.
- Muestra conteos reales de:
  - camaras
  - PTZ
  - F360
  - monitores
  - switches
  - areas
  - cables
- Genera segmentacion por switch sobre el mismo plano.
- Permite filtrar por `part number`, incluyendo multi-seleccion conservadora.
- Permite tocar un `ID` en el plano para abrir una ficha visual del dispositivo.
- Permite marcar progreso operativo por dispositivo dentro de segmentacion:
  - `Cable corrido`
  - `Instalado`
  - `Conectado a switch`
- Refleja ese progreso en el marker del plano con micro-marcadores compactos pensados para zonas densas.
- Mantiene estados de tarea:
  - `Pendiente`
  - `En proceso`
  - `Hecho`
- Guarda esos estados en `localStorage`.
- Guarda tambien progreso operativo por proyecto:
  - cache local en navegador
  - sincronizacion compartida por API cuando el backend responde
- Puede publicar el PDF actual como tienda/proyecto compartido.
- Puede listar y volver a abrir tiendas publicadas desde la misma app.

## Libreria de iconos

La app ya incluye una libreria interna de iconos universal:

- Ruta fuente: `public/device-icons/Camera Symbols`
- Manifiesto generado: `public/device-icons/index.json`

Eso significa:

- no es necesario cargar `Camera Symbols.zip` en cada uso
- los iconos base ya forman parte de la app
- el ZIP o folder de iconos ahora sirven solo para agregar o corregir iconos nuevos

## Segmentacion y UX de campo

La vista de segmentacion ya tiene varias ayudas pensadas para trabajo real:

- prioridad al plano en movil
- panel de controles compacto / overlay
- pan con un dedo
- pinch-to-zoom con dos dedos (iOS nativo, sin crashes)
- `Ajustar vista` en movil
- inspeccion por toque sobre el `ID`
- referencia visual por `part number`
- UI bilingue `ES / EN`

### Calidad de imagen en iPhone

La vista de segmentacion ahora usa un render hibrido pensado para iPhone:

1. **Plano base ligero** — se abre rapido para no castigar memoria al entrar en segmentacion.
2. **Raster mas nitido en segundo plano** — reemplaza la base cuando hace falta mejorar claridad general.
3. **Detalle por viewport** — al acercarse, solo la zona visible del plano se vuelve a renderizar con mas detalle, sin cargar una imagen gigante completa.

El plano se despliega como capas `<img>` en lugar de depender solo de un `<canvas>` gigante, lo que ayuda a que iOS Safari mantenga mejor la nitidez y la estabilidad durante pan / zoom.

### Markers Camino C — gotas de color por familia

La vista de segmentacion ya no depende de iconos sobre el plano. En su lugar dibuja una **gota de color** con la misma forma que el marker naranja original del PDF de SiteOwl:

- la **punta apunta hacia abajo** y toca exactamente la posicion del dispositivo
- el **ID del dispositivo** va en blanco negrita al centro de la cabeza circular
- la gota es **opaca**, asi cubre el label baked del PDF y evita doble numeracion
- aparece **directo al abrir el plano**, sin necesidad de seleccionar un part number — vista rapida inmediata para campo

El color de la gota depende de la familia del part number, asi el tecnico distingue de un vistazo sin abrir la ficha lateral:

- **rojo** — domes fijos (Micross 8011 / Axis 4115 / TU9001)
- **azul royal** (`#1f6feb`) — F360 fisheye panoramica
- **violeta** — PTZ (QNP / NDP)
- **rosa claro / medio / oscuro / magenta profundo** — monitores 10" / 24" / 32" / 43"
- **turquesa** — camaras exteriores (NDE, OGP, GRC)
- **cafe** — manned checkout (BNB / PSA)
- **gris neutro** — self checkout (MCLB / MCLV)
- **slate** — fallback cuando el part number no esta clasificado

> Nota sobre el azul de F360: el tono `#1f6feb` es un azul **royal saturado profundo**, distinto del azul QTS `#00B0F0` que es **celeste/cielo brillante** y esta reservado para la marca "Camera Installed". En pantalla se leen claramente como tonos separados. Felipe confirmo en campo que la distincion funciona; si algun dia se confunden, la alternativa prevista es mover F360 a navy `#0d47a1`. El naranja quedo descartado de la paleta por decision explicita.

La clasificacion vive en `src/modules/plan-viewer/marker-colors.ts`. Cubre los part numbers que ya tenemos sembrados en `manteca-visual-knowledge.json` con un mapa directo, y cae a reglas heuristicas por prefijo / substring para part numbers nuevos.

**Restriccion QTS:** los tonos **amarillo** (`#FFE600`), **azul** (`#00B0F0`) y **verde** (`#00B050`) estan reservados para las marcas de avance sobre el plano (Wire Ran / Camera Installed / Connected to Switch — QTS CCTV Color Scheme). Ninguna gota de dispositivo debe usar estos tonos, para que un tecnico nunca confunda un ID con una marca de avance. Por eso la paleta actual reemplazo la combinacion original (azul / verde / amarillos) por violeta / naranja / gradiente rosa.

#### Ajuste de tamano para campo

El tamano de la gota se afino iterativamente probando en iPhone sobre planos densos (farmacia, self-checkout, AP office):

| version | radio cabeza | largo punta | tamano relativo |
| ------- | ------------ | ----------- | --------------- |
| v1      | 13 * RS      | 8 * RS      | 100% (muy grande, tapaba detalle) |
| v2      | 10 * RS      | 6 * RS      | 75% de v1 |
| v3      | 7 * RS       | 4 * RS      | ~54% del original |
| **v4**  | **6 * RS**   | **3 * RS**  | **~46% del original** — tamano actual |

`RS` = `RENDER_SCALE` del canvas de markers. La fuente del ID dentro de la gota se escala con la cabeza: 2 digitos `6*RS`, 3 digitos `5*RS`, 4+ digitos `4*RS`. Si se siente necesario reducir aun mas, el plan es activar **zoom adaptativo** (la gota mantiene su tamano en pantalla mientras el plano se escala) en lugar de seguir bajando el font.

## Ambigüedades ya resueltas visualmente

### PTZ interior

Para `PTZ` interiores no se fuerza una certeza falsa.

- interior: muestra `Ceiling` y `Pendant`
- exterior: muestra solo `Outdoor`

### POS

Para nombres `POS_XX`, cuando el PDF no permite distinguir correctamente:

- `SCO -> BNB-SCB-1KIT`
- `Manned -> PSA-W4-BAXFA51`

Se muestran ambos iconos como ayuda visual sin duplicar conteos.

## Reglas y conocimiento ya integrados

- resolucion de iconos por nombre tecnico, alias y coincidencia flexible
- conocimiento visual sembrado para Manteca
- soporte para ambigüedad controlada
- reglas de cableado para PVM, EVPM, liquor, pickup y otros casos
- criterio `EMGX` tratado como salida de emergencia con monitor de `32"`

## Suposiciones actuales

- el plano util esta en la pagina 1
- las paginas 2+ contienen tablas de trabajo
- la app puede trabajar totalmente del lado cliente
- los iconos base viven dentro de la app

## Arquitectura actual

- frontend: React + Vite
- API operativa compartida: middleware Node reutilizado en `vite` y `server.mjs`
- PWA: `vite-plugin-pwa`
- parsing PDF: `pdfjs-dist`
- parsing tabular: `papaparse`
- iconos ZIP: `jszip`
- almacenamiento compartido:
  - desarrollo local: archivo `.runtime-data/operational-progress.json`
  - produccion App Engine actual: Cloud Datastore via `@google-cloud/datastore`
- biblioteca de proyectos:
  - desarrollo local: `.runtime-data/published-projects.json` + `.runtime-data/published-project-files/`
  - produccion App Engine actual: Cloud Datastore + Cloud Storage

## Proximo trabajo recomendado

1. Agregar reglas formales de altura de instalacion.
2. Definir control de acceso con Google IAP (actualmente sin autenticacion).
3. Refinar administracion de proyectos publicados (archivar, reemplazar PDF y permisos de gerencia).
4. Refinar la biblioteca de proyectos con filtros, busqueda y publicacion administrada por gerencia.
5. Agregar actividad historica, snapshots y filtros de inconsistencias.
6. Evaluar logs funcionales y, mas adelante, consultas AI acotadas.
7. Explorar renderizado vectorial SVG desde pdfjs para calidad perfecta a cualquier zoom.
8. **Zoom adaptativo para clusters densos** — mantener el tamano de la gota Camino C constante en pantalla mientras el plano escala, y emitir badges de cluster cuando varios markers quedan superpuestos al nivel de zoom actual.
