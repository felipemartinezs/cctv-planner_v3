## PDF Data Parser

Esta capa parsea las paginas de datos del PDF, separada del visor del plano.

Responsabilidades:

- Leer paginas 2+ del PDF.
- Detectar el template de tabla.
- Convertir filas del PDF en `DeviceRecord[]`.
- Mantener el visor fuera de esta capa.
