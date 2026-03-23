# CCTV Field Planner v3

Aplicacion web orientada a tecnicos de campo para convertir PDFs de CCTV en tareas accionables, conteos reales y una vista de segmentacion tactil sobre el plano.

## Estado actual

- Pensada primero para smartphone.
- Selector de idioma `ES / EN` con persistencia local.
- Procesa el PDF en el navegador.
- Usa la pagina 1 como plano de referencia.
- Usa las paginas de datos del PDF para construir `DeviceRecord[]`.
- Incluye una libreria interna de iconos universal en `public/device-icons/Camera Symbols`.
- Puede recibir iconos extra por ZIP o folder solo como suplemento opcional.

## Arranque local

```bash
npm install
npm run dev
```

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
- Mantiene estados de tarea:
  - `Pendiente`
  - `En proceso`
  - `Hecho`
- Guarda esos estados en `localStorage`.

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
- pinch-to-zoom con dos dedos
- `Ajustar vista` en movil
- inspeccion por toque sobre el `ID`
- referencia visual por `part number`
- UI bilingue `ES / EN`

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
- PWA: `vite-plugin-pwa`
- parsing PDF: `pdfjs-dist`
- parsing tabular: `papaparse`
- iconos ZIP: `jszip`

## Proximo trabajo recomendado

1. Agregar reglas formales de altura de instalacion.
2. Preparar despliegue en Google App Engine.
3. Definir control de acceso con Google IAP.
4. Evaluar logs funcionales y, mas adelante, consultas AI acotadas.
