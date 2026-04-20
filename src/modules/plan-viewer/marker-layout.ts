/**
 * marker-layout.ts
 *
 * Calcula el layout visual de los markers (iconos + IDs) cuando el tecnico
 * selecciona uno o varios part numbers en PlanSegmentationModal.
 *
 * Problema: en zonas densas (farmacia, self-checkout, AP office) varios
 * dispositivos caen dentro de un radio pequeno y sus IDs se encimen, haciendo
 * dificil identificar cada device individual.
 *
 * Enfoque (port del `icon/place_icons_by_pdf_text.py` + extension con leader
 * lines que alla quedaron comentadas):
 *  1. Construimos grafo de vecindad por distancia euclidiana <= clusterRadius.
 *  2. BFS para agrupar en componentes conexos. Componentes con >= minClusterSize
 *     son clusters; los demas quedan como puntos aislados.
 *  3. Para cada cluster, calculamos centroide y radio exterior. Cada miembro
 *     recibe una posicion de etiqueta sobre un anillo (labelRadius = maxR + offset)
 *     en su angulo natural (desde el centroide).
 *  4. Anti-colision angular: si dos etiquetas consecutivas (ordenadas por
 *     angulo) quedan a menos de labelMinArcGap radianes, empujamos la siguiente
 *     hacia adelante. Si aun asi no entran, distribuimos equidistantemente.
 *  5. Clamp de cada labelX/labelY al area util del canvas.
 *
 * Complexity: O(N^2) — N tipicamente <= 60 markers simultaneos (2 part numbers
 * seleccionados, ~30 devices cada uno). Corre en una sola vez via useMemo
 * cuando cambia la seleccion — no es per-frame.
 */

export interface VisibleMarker {
  /** Identificador unico del device (DeviceRecord.key / SegmentationPoint.key). */
  key: string;
  /** ID numerico visible del dispositivo (lo que se dibuja en el texto). */
  id: number;
  /** Coordenada X en pixeles del canvas (ya multiplicado por W/seg.width). */
  x: number;
  /** Coordenada Y en pixeles del canvas. */
  y: number;
}

export interface MarkerPlacement {
  /** Donde se dibuja el texto del ID (puede estar desplazado del anchor). */
  labelX: number;
  labelY: number;
  /**
   * true si el marker esta en un cluster y su label esta desplazado del anchor.
   * El consumidor dibuja una leader line de (marker.x, marker.y) a (labelX, labelY).
   */
  showLeader: boolean;
}

export interface MarkerLayoutOptions {
  /** Radio (canvas px) para considerar 2 markers vecinos en BFS. */
  clusterRadius: number;
  /** Minimo miembros de un componente para tratarlo como cluster. */
  minClusterSize: number;
  /** Separacion (canvas px) entre el borde del cluster y el anillo de labels. */
  labelOffset: number;
  /** Separacion angular minima (radianes) entre 2 labels consecutivas. */
  labelMinArcGap: number;
  /** Dimensiones del canvas para clamp. */
  canvasWidth: number;
  canvasHeight: number;
  /** Margen interior del canvas donde no se permite poner labels. */
  canvasPadding: number;
}

/**
 * Devuelve un Map<markerKey, MarkerPlacement>.
 * Todo marker de entrada tiene entry en el Map de salida.
 * Si no hay cluster o el layout no aplica, placement tiene (labelX,labelY) = (x,y)
 * y showLeader = false — el consumidor debe pintar igual que V1.
 */
export function computeMarkerLayout(
  points: VisibleMarker[],
  options: MarkerLayoutOptions
): Map<string, MarkerPlacement> {
  const layout = new Map<string, MarkerPlacement>();
  if (points.length === 0) return layout;

  const {
    clusterRadius,
    minClusterSize,
    labelOffset,
    labelMinArcGap,
    canvasWidth,
    canvasHeight,
    canvasPadding,
  } = options;

  // Default: cada marker tiene su label sobre si mismo (V1).
  for (const p of points) {
    layout.set(p.key, { labelX: p.x, labelY: p.y, showLeader: false });
  }

  if (points.length < minClusterSize) return layout;

  // 1. Grafo de vecindad (O(N^2), N pequeno).
  const R2 = clusterRadius * clusterRadius;
  const neighbors = new Map<string, string[]>();
  for (const p of points) neighbors.set(p.key, []);
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      if (dx * dx + dy * dy <= R2) {
        neighbors.get(points[i].key)!.push(points[j].key);
        neighbors.get(points[j].key)!.push(points[i].key);
      }
    }
  }

  // 2. BFS para componentes conexos.
  const byKey = new Map(points.map((p) => [p.key, p]));
  const visited = new Set<string>();
  const clusters: VisibleMarker[][] = [];

  for (const start of points) {
    if (visited.has(start.key)) continue;
    const component: VisibleMarker[] = [];
    const queue: string[] = [start.key];
    visited.add(start.key);
    while (queue.length) {
      const cur = queue.pop()!;
      const m = byKey.get(cur);
      if (!m) continue;
      component.push(m);
      const ns = neighbors.get(cur) ?? [];
      for (const nb of ns) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    if (component.length >= minClusterSize) {
      clusters.push(component);
    }
  }

  // 3. Layout radial por cluster.
  for (const cluster of clusters) {
    // Centroide.
    let cx = 0;
    let cy = 0;
    for (const m of cluster) {
      cx += m.x;
      cy += m.y;
    }
    cx /= cluster.length;
    cy /= cluster.length;

    // Radio exterior del cluster desde el centroide.
    let maxR = 0;
    for (const m of cluster) {
      const d = Math.hypot(m.x - cx, m.y - cy);
      if (d > maxR) maxR = d;
    }
    const labelRadius = Math.max(maxR + labelOffset, labelOffset);

    // Angulo natural de cada miembro desde el centroide.
    interface Angled {
      m: VisibleMarker;
      angle: number;
    }
    const angled: Angled[] = cluster.map((m) => ({
      m,
      angle: Math.atan2(m.y - cy, m.x - cx),
    }));
    angled.sort((a, b) => a.angle - b.angle);

    // 4. Anti-colision angular.
    // Caso A: el cluster no cabe ni repartiendo 2*PI en N ranuras => distribuimos
    // equidistantemente, perdiendo un poco de correspondencia angular pero
    // garantizando que las labels no se encimen. La leader line mantiene la
    // asociacion visual.
    const minTotal = angled.length * labelMinArcGap;
    if (minTotal >= 2 * Math.PI - 0.001) {
      for (let i = 0; i < angled.length; i += 1) {
        angled[i].angle = (i / angled.length) * 2 * Math.PI - Math.PI;
      }
    } else {
      // Caso B: empujamos cada label hacia adelante si su hueco con la anterior
      // es menor al minimo. Manejamos wrap-around con un segundo pase.
      for (let pass = 0; pass < 3; pass += 1) {
        let changed = false;
        for (let i = 1; i < angled.length; i += 1) {
          const gap = angled[i].angle - angled[i - 1].angle;
          if (gap < labelMinArcGap) {
            angled[i].angle = angled[i - 1].angle + labelMinArcGap;
            changed = true;
          }
        }
        // Wrap: primera + 2*PI debe estar a >= min del ultimo.
        const first = angled[0].angle;
        const last = angled[angled.length - 1].angle;
        if (first + 2 * Math.PI - last < labelMinArcGap) {
          // Empuja el ultimo hacia atras, no el primero (el primero ya fijo el
          // origen natural y queremos preservarlo). Si es necesario, re-pasamos.
          angled[angled.length - 1].angle = first + 2 * Math.PI - labelMinArcGap;
          // El ultimo puede ahora chocar con el penultimo — reiteramos.
          changed = true;
        }
        if (!changed) break;
      }
    }

    // 5. Posicion final + clamp al canvas.
    for (const { m, angle } of angled) {
      let lx = cx + Math.cos(angle) * labelRadius;
      let ly = cy + Math.sin(angle) * labelRadius;
      lx = Math.max(canvasPadding, Math.min(canvasWidth - canvasPadding, lx));
      ly = Math.max(canvasPadding, Math.min(canvasHeight - canvasPadding, ly));
      layout.set(m.key, { labelX: lx, labelY: ly, showLeader: true });
    }
  }

  return layout;
}
