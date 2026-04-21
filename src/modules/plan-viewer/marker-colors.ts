// Camino C: asignacion de color por familia de part number.
//
// El marker original del PDF de SiteOwl es una gota naranja con el ID en
// blanco al centro y un pico inferior que apunta a la posicion exacta del
// dispositivo. Replicamos esa forma pero coloreamos la gota segun la familia
// del device — asi el tecnico distingue de un vistazo PTZ / domes / monitores
// sin tener que abrir la tarjeta lateral.
//
// =================== AVOID LIST — QTS CCTV COLOR SCHEME ===================
// Los siguientes tonos estan RESERVADOS para las marcas de avance sobre el
// plano y NO deben usarse como color de gota de dispositivo:
//
//     Amarillo  #FFE600  ->  Wire Ran
//     Azul      #00B0F0  ->  Camera Installed
//     Verde     #00B050  ->  Connected to Switch
//
// Definicion de los tonos de avance: PlanSegmentationModal.tsx
//   > OPERATIONAL_PROGRESS_VISUALS
//   > OPERATIONAL_PROGRESS_COMPLETE_VISUAL
//
// Si un tecnico ve amarillo/azul/verde sobre el plano, debe significar
// AVANCE — nunca el color base de un dispositivo.
// =========================================================================
//
// Regla general post-QTS (abril 2026, reemplaza la paleta original que
// usaba azul para F360, verde para PTZ y gradiente amarillo para monitores;
// esa paleta chocaba con el QTS CCTV Color Scheme):
//   Micross 8011 / domes fijos ....... rojo
//   F360 fisheye panoramicas ......... violeta   (antes azul)
//   PTZ .............................. naranja   (antes verde)
//   Monitores (PVM) 10" ............. rosa claro    (antes amarillo claro)
//   Monitores 24" ................... rosa medio    (antes amarillo medio)
//   Monitores 32" ................... rosa oscuro   (antes amarillo oscuro)
//   Monitores 43" ................... magenta profundo (antes mostaza)
//   Self checkout (MCL*) ............. neutro (gris)
//   Manned checkout (BNB/PSA) ........ cafe
//   Camaras exteriores .............. turquesa (se queda: es distinguible
//                                               del azul QTS #00B0F0 por
//                                               ser mas verdoso y oscuro)
//
// Fallback: gris pizarra. Asi nunca queda un marker sin color y seguimos
// viendo la posicion en planos que tengan part numbers nuevos.

export interface MarkerColor {
  fill: string;
  stroke: string;
  textColor: string;
  family: string;
}

// Paleta base — tonos saturados que se leen bien sobre planos grises
// impresos a baja resolucion. Texto blanco salvo en la gota "rosa claro"
// donde un texto oscuro da mejor contraste (igual patron que tenia el
// amarillo claro pre-QTS).
const WHITE = "#ffffff";

const COLORS = {
  red:           { fill: "#d33a2c", stroke: "#7a1b12", textColor: WHITE,     family: "Dome fijo (Micross 8011)" },
  violet:        { fill: "#8e24aa", stroke: "#4a148c", textColor: WHITE,     family: "F360 panoramica" },
  orange:        { fill: "#e65100", stroke: "#8b2d00", textColor: WHITE,     family: "PTZ" },
  pinkLight:     { fill: "#f48fb1", stroke: "#ad1457", textColor: "#3a0a20", family: "Monitor 10\"" },
  pinkMid:       { fill: "#ec407a", stroke: "#880e4f", textColor: WHITE,     family: "Monitor 24\"" },
  pinkDark:      { fill: "#ad1457", stroke: "#560027", textColor: WHITE,     family: "Monitor 32\"" },
  magentaDark:   { fill: "#6a0a3a", stroke: "#28001a", textColor: WHITE,     family: "Monitor 43\"" },
  brown:         { fill: "#6b3f22", stroke: "#2f1808", textColor: WHITE,     family: "Manned checkout (BNB/PSA)" },
  neutralGray:   { fill: "#6e7681", stroke: "#2d333b", textColor: WHITE,     family: "Self checkout" },
  teal:          { fill: "#0f8b8d", stroke: "#054446", textColor: WHITE,     family: "Exterior" },
  slate:         { fill: "#4b5663", stroke: "#1b2028", textColor: WHITE,     family: "Sin clasificar" },
} as const satisfies Record<string, MarkerColor>;

// Helper local: normaliza un part number o nombre para matching tolerante.
function normalize(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

// Mapa directo por part number exacto (tomado de manteca-visual-knowledge.json).
// Si un proyecto nuevo trae part numbers distintos, caen por las reglas
// heuristicas de `resolveMarkerColor` (por prefijo / substring).
const DIRECT_MAP: Record<string, MarkerColor> = {
  // Domes fijos Hanwha/Axis — rojo.
  "CIP-QND8011":     COLORS.red,
  "CIP-AX4115":      COLORS.red,
  "CB-AXTU9001":     COLORS.red,

  // F360 fisheye panoramica — violeta (antes azul; QTS reservo azul para "Camera Installed").
  "NDS-5704-F360-W": COLORS.violet,

  // Exterior — turquesa (distinguible del azul QTS #00B0F0 por ser mas verdoso).
  "NDE-5704-AL-W":   COLORS.teal,

  // PTZ — naranja (antes verde; QTS reservo verde para "Connected to Switch").
  "CIP-QNP6250H":    COLORS.orange,
  "NDP-5522-Z30C-W": COLORS.orange,

  // Monitores PVM por tamano — gradiente rosa claro a magenta profundo
  // (antes gradiente amarillo; QTS reservo amarillo para "Wire Ran").
  "PVM10-B-2086-WMT":    COLORS.pinkLight,
  "DE-HASPD-24-MONITOR": COLORS.pinkMid,
  "GVM32-0-3011-B":      COLORS.pinkDark,
  // 43" tipico: si aparece un part number 43" en el futuro, cae por
  // heuristica `MONITOR-43` mas abajo (magentaDark).

  // Manned checkout — cafe (BNB = Bunker / PSA = Self-Serve Aisle).
  "BNB-SCB-1KIT":    COLORS.brown,
  "PSA-W4-BAXFA51":  COLORS.brown,

  // Self checkout (MCL* = Member checkout lanes) — neutro gris.
  "MCLB-BAXFA51":    COLORS.neutralGray,
  "MCLV-BAXFA51":    COLORS.neutralGray,

  // Tower / misc — slate como placeholder visible.
  "3680 TOWER":      COLORS.slate,
};

// Reglas heuristicas por substring del part number. Se aplican despues del
// mapa directo para cubrir part numbers que no hayamos visto aun.
function heuristicByPartNumber(partKey: string): MarkerColor | null {
  if (!partKey) return null;

  // Monitores por tamano en el nombre del part (gradiente rosa post-QTS).
  if (/\b(10|10IN|10-IN)\b/.test(partKey) && /MONITOR|PVM/.test(partKey)) return COLORS.pinkLight;
  if (/\b(24|24IN|24-IN)\b/.test(partKey) && /MONITOR|PVM|HASPD/.test(partKey)) return COLORS.pinkMid;
  if (/\b(32|32IN|32-IN)\b/.test(partKey) && /MONITOR|PVM|GVM/.test(partKey)) return COLORS.pinkDark;
  if (/\b(43|43IN|43-IN)\b/.test(partKey) && /MONITOR|PVM/.test(partKey)) return COLORS.magentaDark;
  if (/MONITOR|PVM|GVM/.test(partKey)) return COLORS.pinkMid;

  // Camaras.
  if (/F360|FISHEYE|PANORAMIC/.test(partKey)) return COLORS.violet;
  if (/PTZ|QNP|NDP/.test(partKey)) return COLORS.orange;
  if (/QND|AX4115|TU9001|DOME/.test(partKey)) return COLORS.red;
  if (/\bNDE\b|EXTERIOR|OUTDOOR|OGP|GRC/.test(partKey)) return COLORS.teal;

  // POS.
  if (/BNB|PSA/.test(partKey)) return COLORS.brown;
  if (/\bMCL[BV]?\b|SELF[- ]?CHECK|SCO/.test(partKey)) return COLORS.neutralGray;

  return null;
}

export function resolveMarkerColor(partNumber: string, deviceName?: string): MarkerColor {
  const partKey = normalize(partNumber);
  const direct = DIRECT_MAP[partKey];
  if (direct) return direct;

  const heuristic = heuristicByPartNumber(partKey);
  if (heuristic) return heuristic;

  if (deviceName) {
    const nameKey = normalize(deviceName);
    if (/F360|FISHEYE|PANORAMIC/.test(nameKey)) return COLORS.violet;
    if (/\bPTZ\b/.test(nameKey)) return COLORS.orange;
    if (/MONITOR|PVM/.test(nameKey)) return COLORS.pinkMid;
    if (/BNB|PSA|MANNED/.test(nameKey)) return COLORS.brown;
    if (/SELF[- ]?CHECK|\bSCO\b/.test(nameKey)) return COLORS.neutralGray;
    if (/EXTERIOR|OUTDOOR|\bOGP\b|\bGRC\b/.test(nameKey)) return COLORS.teal;
  }

  return COLORS.slate;
}

// Exportado para pruebas / debug en devtools.
export const MARKER_PALETTE = COLORS;
