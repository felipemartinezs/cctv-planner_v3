// Camino C: asignacion de color por familia de part number.
//
// El marker original del PDF de SiteOwl es una gota naranja con el ID en
// blanco al centro y un pico inferior que apunta a la posicion exacta del
// dispositivo. Replicamos esa forma pero coloreamos la gota segun la familia
// del device — asi el tecnico distingue de un vistazo PTZ / domes / monitores
// sin tener que abrir la tarjeta lateral.
//
// Regla general (fija solicitada por Felipe):
//   Micross 8011 / domes fijos ....... rojo
//   F360 fisheye panoramicas ......... azul
//   PTZ .............................. verde
//   Monitores (PVM) 10" ............. amarillo claro
//   Monitores 24" ................... amarillo medio
//   Monitores 32" ................... amarillo oscuro
//   Monitores 43" ................... mostaza / ambar oscuro
//   Self checkout (MCL*) ............. neutro (gris) — "no necesitan color"
//   Manned checkout (BNB/PSA) ........ cafe
//   Camaras exteriores .............. turquesa (para no chocar con PTZ verde)
//
// Fallback: gris pizarra. Asi nunca queda un marker sin color y seguimos
// viendo la posicion en planos que tengan part numbers nuevos.

export interface MarkerColor {
  fill: string;
  stroke: string;
  textColor: string;
  family: string;
}

// Paleta base — colores saturados que se leen bien sobre planos grises
// impresos a baja resolucion. Texto blanco en todos para mantener la
// consistencia con la gota original del PDF.
const WHITE = "#ffffff";

const COLORS = {
  red:          { fill: "#d33a2c", stroke: "#7a1b12", textColor: WHITE, family: "Dome fijo (Micross 8011)" },
  blue:         { fill: "#1f6feb", stroke: "#0b2f6b", textColor: WHITE, family: "F360 panoramica" },
  green:        { fill: "#1f9d55", stroke: "#0b4a27", textColor: WHITE, family: "PTZ" },
  yellowLight:  { fill: "#f7d046", stroke: "#8a6b0f", textColor: "#1e1a0a", family: "Monitor 10\"" },
  yellowMid:    { fill: "#e0a43a", stroke: "#6f4c0b", textColor: WHITE, family: "Monitor 24\"" },
  yellowDark:   { fill: "#b67322", stroke: "#5a3608", textColor: WHITE, family: "Monitor 32\"" },
  mustard:      { fill: "#8a4d14", stroke: "#3f1f04", textColor: WHITE, family: "Monitor 43\"" },
  brown:        { fill: "#6b3f22", stroke: "#2f1808", textColor: WHITE, family: "Manned checkout (BNB/PSA)" },
  neutralGray:  { fill: "#6e7681", stroke: "#2d333b", textColor: WHITE, family: "Self checkout" },
  teal:         { fill: "#0f8b8d", stroke: "#054446", textColor: WHITE, family: "Exterior" },
  slate:        { fill: "#4b5663", stroke: "#1b2028", textColor: WHITE, family: "Sin clasificar" },
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

  // F360 fisheye panoramica — azul.
  "NDS-5704-F360-W": COLORS.blue,

  // Exterior — turquesa (no confundir con PTZ verde).
  "NDE-5704-AL-W":   COLORS.teal,

  // PTZ — verde.
  "CIP-QNP6250H":    COLORS.green,
  "NDP-5522-Z30C-W": COLORS.green,

  // Monitores PVM por tamano — gradiente amarillo a mostaza.
  "PVM10-B-2086-WMT":    COLORS.yellowLight,
  "DE-HASPD-24-MONITOR": COLORS.yellowMid,
  "GVM32-0-3011-B":      COLORS.yellowDark,
  // 43" tipico: si aparece un part number 43" en el futuro, cae por
  // heuristica `MONITOR-43` mas abajo.

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

  // Monitores por tamano en el nombre del part.
  if (/\b(10|10IN|10-IN)\b/.test(partKey) && /MONITOR|PVM/.test(partKey)) return COLORS.yellowLight;
  if (/\b(24|24IN|24-IN)\b/.test(partKey) && /MONITOR|PVM|HASPD/.test(partKey)) return COLORS.yellowMid;
  if (/\b(32|32IN|32-IN)\b/.test(partKey) && /MONITOR|PVM|GVM/.test(partKey)) return COLORS.yellowDark;
  if (/\b(43|43IN|43-IN)\b/.test(partKey) && /MONITOR|PVM/.test(partKey)) return COLORS.mustard;
  if (/MONITOR|PVM|GVM/.test(partKey)) return COLORS.yellowMid;

  // Camaras.
  if (/F360|FISHEYE|PANORAMIC/.test(partKey)) return COLORS.blue;
  if (/PTZ|QNP|NDP/.test(partKey)) return COLORS.green;
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
    if (/F360|FISHEYE|PANORAMIC/.test(nameKey)) return COLORS.blue;
    if (/\bPTZ\b/.test(nameKey)) return COLORS.green;
    if (/MONITOR|PVM/.test(nameKey)) return COLORS.yellowMid;
    if (/BNB|PSA|MANNED/.test(nameKey)) return COLORS.brown;
    if (/SELF[- ]?CHECK|\bSCO\b/.test(nameKey)) return COLORS.neutralGray;
    if (/EXTERIOR|OUTDOOR|\bOGP\b|\bGRC\b/.test(nameKey)) return COLORS.teal;
  }

  return COLORS.slate;
}

// Exportado para pruebas / debug en devtools.
export const MARKER_PALETTE = COLORS;
