# CCTV Field Planner MVP

Primer MVP web, pensado para validar el flujo de campo en smartphone.

## Arranque

```bash
npm install
npm run dev
```

Build de produccion:

```bash
npm run build
```

## Flujo actual

1. Carga el PDF del plano.
2. Opcionalmente carga el CSV base si quieres complementar datos.
3. Opcionalmente carga `Camera Symbols.zip` o el folder de iconos.
4. Pulsa `Procesar`.
5. Revisa `Resumen del PDF` para ver los datos parseados.
6. Abre `Ver pagina 1`.
7. Activa o desactiva la segmentacion sobre ese mismo plano.
8. Trabaja desde `Field Tasks` y usa ese mismo plano como referencia.

## Qué hace este MVP

- Parsea las paginas de datos del PDF.
- Convierte los registros en tareas de campo.
- Muestra conteos reales de camaras, F360, switches, areas, grupos `name` y grupos `part number`.
- Unifica la familia `S-GM-2`, `S-GM-3`, etc. como segmento `S-GM`.
- Dibuja una capa de segmentacion por switch sobre el mismo plano pagina 1.
- Muestra qué instalar, dónde, con cuántos cables y a qué switch/hub va.
- Permite marcar tareas como `Pendiente`, `En proceso` o `Hecho`.
- Mantiene el PDF como referencia secundaria en visor real.
- Si el CSV no trae `x,y`, intenta usar los IDs detectados dentro del PDF.
- Resume cargas por switch, áreas y cableado estimado.

## Suposiciones actuales

- El plano util siempre está en la pagina 1.
- Las paginas 2+ del PDF contienen las tablas de trabajo.
- El calculo de cables usa:
  - 1 cable por dispositivo
  - 2 cables para EVPM/PVM10 en cosmetics, sporting goods y baby formula
  - 2 cables para monitores dobles de liquor

## Siguiente iteracion sugerida

- Probar con Manteca y Placerville.
- Ajustar las reglas de normalizacion.
- Agregar checklist de campo por dispositivo.
