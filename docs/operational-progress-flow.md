# Flujo Operativo Colaborativo

Estado: base parcialmente implementada.

Implementado hoy:

- progreso operativo local por dispositivo dentro de segmentacion
- confirmacion en dos toques + deshacer
- reflejo visual compacto del avance dentro del marker
- cache local por proyecto
- API compartida por proyecto para persistencia y sincronizacion basica
- biblioteca minima de proyectos publicados dentro de la app
- publicacion basica del PDF actual como proyecto compartido
- reapertura de tiendas publicadas desde la biblioteca interna

Pendiente:

- filtros / busqueda / administracion formal de proyectos publicados
- autenticacion y roles reales
- actividad historica visible en UI
- snapshots / cierres
- activacion real de persistencia compartida en GCP
- tiempo real mas fino que el polling actual

## Objetivo

Convertir la vista de segmentacion en una herramienta operativa compartida donde:

- gerencia publica proyectos a partir de PDFs ya liberados
- el tecnico trabaja un solo plano a la vez desde iPhone
- varios tecnicos pueden trabajar la misma tienda sin mezclarse con otras tiendas
- gerencia puede ver resumen por tienda y detalle del mismo plano marcado
- el progreso queda disponible en vivo y tambien para consulta posterior

## Principios

- iPhone-first: la experiencia principal vive en telefono
- un tecnico trabaja un solo proyecto / plano activo a la vez
- el PDF sigue siendo la referencia visual del proyecto
- el progreso se guarda como capa operativa, no dentro del PDF original
- es mejor pedir confirmacion que aceptar toques accidentales

## Roles

### Gerencia

- carga y publica el PDF de una tienda cuando el proyecto queda liberado
- define que tiendas estan disponibles para operacion
- ve resumen de avance por tienda
- puede abrir una tienda especifica y ver el mismo plano marcado
- consulta actividad e historico

### Tecnico

- no carga PDFs en operacion normal
- busca la tienda ya publicada
- abre un solo plano a la vez
- marca avances por dispositivo desde iPhone

### Supervisor

Rol futuro sugerido:

- revisa avances
- corrige errores
- valida o cierra proyecto

## Identidad del proyecto

Cada proyecto debe tener un `projectId` unico. Ejemplo:

`walmart-2648-san-leandro-2026-04-12`

Campos base recomendados:

- `storeNumber`
- `storeName`
- `city`
- `state`
- `sourcePdfName`
- `releasedAt`
- `planVersion`
- `status`

Esto evita mezclar:

- dos tiendas distintas
- dos visitas distintas de la misma tienda
- dos PDFs diferentes del mismo sitio

## Flujo operativo

### 1. Publicacion de proyecto

1. Gerencia carga el PDF liberado.
2. La app extrae metadatos de tienda desde el nombre del archivo y/o el contenido.
3. Gerencia confirma y publica el proyecto.
4. El proyecto queda visible para tecnicos autorizados.

### 2. Trabajo tecnico en campo

1. El tecnico abre la app en iPhone.
2. Busca su tienda por numero o nombre.
3. Entra al proyecto publicado.
4. Ve el plano de segmentacion.
5. Toca un ID.
6. Se abre una `bottom sheet` operativa.
7. Marca:
   - `Cable corrido`
   - `Dispositivo instalado`
   - `Conectado a switch`
8. El cambio se guarda y se refleja en tiempo real para cualquier persona viendo esa misma tienda.

### 3. Seguimiento gerencial

Gerencia tiene dos niveles de vista:

- resumen de tiendas
- detalle de una tienda

En el resumen solo se ven agregados por tienda. Al entrar a una tienda concreta, gerencia ve el mismo plano marcado que ve el equipo de campo.

## Comportamiento en tiempo real

La unidad compartida no es el telefono; es el `projectId`.

Eso significa:

- si cuatro tecnicos trabajan la misma tienda, todos entran al mismo proyecto
- si uno marca un ID en amarillo, los demas ven ese mismo cambio
- si gerencia abre esa misma tienda, ve ese mismo amarillo en el mismo plano
- las demas tiendas no se afectan

Resumen:

- misma tienda = mismo estado compartido
- tiendas distintas = estados separados

## Seguridad contra errores de uso

El flujo debe asumir errores reales de campo:

- telefono en bolsillo
- toques accidentales
- prisa al final del turno

Protecciones recomendadas desde la primera version:

- tocar un ID no guarda nada por si solo
- el toque solo abre la `bottom sheet`
- cada accion operativa requiere confirmacion
- despues de guardar aparece `Deshacer`
- revertir un avance confirmado pide validacion
- toda accion registra auditoria

Auditoria minima por cambio:

- `updatedAt`
- `updatedBy`
- `updatedFrom`
- `action`

## Estados operativos propuestos

Por dispositivo:

- `cableRun`
- `installed`
- `switchConnected`

Color operativo sugerido:

- amarillo = cable corrido
- azul = dispositivo instalado
- verde = conectado a switch

Regla visual:

- el plano no debe llenarse de UI extra
- el color debe vivir como acento del marker o de la capa operativa
- la ficha operativa debe resolver la accion, no el marker

## Porcentajes y barras de progreso

La propuesta no usa solo un porcentaje ciego. Se recomiendan cuatro indicadores:

- `Cable % = cables corridos / cables esperados`
- `Instalacion % = dispositivos instalados / dispositivos totales`
- `Switch % = dispositivos conectados / dispositivos conectables`
- `Global % = hitos completados / hitos esperados`

Esto permite que tecnico y gerencia entiendan mejor donde va el trabajo.

## Historico y consulta posterior

El plano marcado debe permanecer disponible.

Se recomiendan dos niveles:

- estado vivo actual
- snapshots o cierres historicos

Con eso, gerencia puede:

- ver el estado en vivo
- volver mas tarde y revisar como iba una tienda
- consultar un cierre o corte historico

## Modelo de datos propuesto

Estructura sugerida:

- `projects/{projectId}`
- `projects/{projectId}/deviceProgress/{deviceKey}`
- `projects/{projectId}/activity/{eventId}`
- `projects/{projectId}/snapshots/{snapshotId}`

### `projects/{projectId}`

Resumen del proyecto:

- identidad de tienda
- metadatos del plano
- porcentajes agregados
- conteos principales
- ultima actividad

### `projects/{projectId}/deviceProgress/{deviceKey}`

Estado vivo por dispositivo:

- `deviceId`
- `partNumber`
- `segmentLabel`
- `switchName`
- `cableRun`
- `installed`
- `switchConnected`
- `updatedAt`
- `updatedBy`

### `projects/{projectId}/activity/{eventId}`

Historial de eventos:

- quien hizo el cambio
- cuando
- sobre que ID
- que accion ejecutó
- valor anterior / valor nuevo si hace falta

### `projects/{projectId}/snapshots/{snapshotId}`

Cortes historicos:

- progreso agregado
- referencia del plano
- fecha de captura
- contexto de cierre o corte

## Vista tecnico

La prioridad en iPhone es velocidad y seguridad.

La ficha operativa sugerida:

- ID
- part number
- nombre
- segmento
- switch
- estado actual
- acciones grandes y faciles de tocar

No se recomienda operar desde la tarjeta flotante actual. La propuesta base es una `bottom sheet`.

## Vista gerencia

### Resumen de tiendas

- tienda
- porcentaje global
- cable %
- instalacion %
- switch %
- ultima actividad
- estado general

### Detalle de tienda

- plano marcado
- progreso en vivo
- actividad reciente
- filtros por segmento o estado

## Concurrencia

Si varios tecnicos trabajan la misma tienda:

- todos escriben en el mismo proyecto
- cada dispositivo mantiene su propio estado
- los cambios se propagan a todos los clientes conectados a esa tienda

Regla importante:

- no concentrar todo el avance de la tienda en un solo documento gigante

## Estado actual vs capa futura

Hoy la app:

- procesa el PDF localmente
- genera segmentacion
- guarda un estado simple `pending / active / done` en `localStorage`

La capa futura propuesta agrega:

- progreso por dispositivo
- tiempo real por tienda
- resumen gerencial
- historico
- control de errores de uso

## Orden recomendado de implementacion

1. Definir `projectId`, roles y modelo de datos.
2. Diseñar la `bottom sheet` iPhone-first.
3. Implementar avance local con confirmacion + deshacer.
4. Pintar el progreso en el plano.
5. Conectar persistencia compartida en tiempo real.
6. Crear resumen gerencial por tienda.
7. Agregar snapshots e historico.
8. Despues medir si el avance va en tiempo, atrasado o adelantado.
