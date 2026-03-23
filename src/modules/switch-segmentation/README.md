## Switch Segmentation Identity

Esta capa separa tres conceptos:

- `code`: switch fisico, por ejemplo `S-GM-2`
- `family`: familia, por ejemplo `S-GM`
- `segmentLabel`: etiqueta de segmento, por ejemplo `S-GM`

Regla actual:

- `S-GM-2`, `S-GM-3`, etc. se unifican visualmente en `S-GM`
- los demas switches conservan su codigo completo como segmento
