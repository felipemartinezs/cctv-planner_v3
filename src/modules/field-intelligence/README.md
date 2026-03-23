# Field Intelligence Module

Esta capa transforma `DeviceRecord[]` en estructuras orientadas al tecnico de campo.

## Objetivo

No mostrar el PDF de nuevo.

Si no responder:

- que instalar
- donde
- a que switch va
- cuantos cables correr
- que puntos necesitan revision
- como agrupar trabajo por area o switch

## Entrada

- `DeviceRecord[]`

La entrada viene de la capa de normalizacion existente y no toca la logica del visor.

## Salida

- `FieldTaskPacket[]`
  Cada punto convertido en tarea accionable.
- `FieldOverlayMarker[]`
  Datos listos para futuras superposiciones sobre el plano.
- `FieldWorkCluster[]`
  Paquetes de trabajo por `switch + area`.
- `switchSummary` y `areaSummary`
  Resumen operativo.
- `reviewQueue`
  Puntos que requieren atencion manual.

## Idea de despliegue para el tecnico

1. Pantalla principal: `Field Tasks`
2. Tap en un punto: `Point Detail`
3. Boton secundario: `Ver plano`
4. Filtros rapidos:
   - pendientes de revision
   - 2 cables
   - por switch
   - por area

## Notas

- Este modulo esta separado a proposito del visor del plano.
- La siguiente capa puede consumir `FieldOverlayMarker[]` sin mezclar logica de parsing ni de render.
