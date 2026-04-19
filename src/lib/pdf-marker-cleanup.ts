/**
 * pdf-marker-cleanup.ts
 *
 * Port directo a TypeScript de `make_markers_transparent_all.py --mode delete`
 * del proyecto `clean/`. Elimina los operadores de pintado de las "gotas"
 * naranjas (marcadores de ID) dentro del content stream del PDF y fuerza el
 * texto del ID a negro.
 *
 * El resultado es un PDF donde los puntos rojos/naranjas se quitan sin dejar
 * rastro visual — equivalente a `plan_all_markers_deleted.pdf`.
 *
 * Esta limpieza se corre UNA sola vez al cargar el PDF en `loadPlan()`. El
 * raster generado con pdfjs ya no tendrá los puntos, así que el overlay de
 * iconos en canvas no necesita parches visuales.
 *
 * iPhone: pdf-lib es relativamente ligero. El costo adicional al cargar un PDF
 * de ~2 MB es del orden de 200-600 ms en iPhone (similar al parseo actual).
 */

import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from "pdf-lib";

// Color naranja especifico de los marcadores (constante del Python).
// RGB normalizado: 249, 105, 14 -> 0.97647 0.41176 0.0549
const ORANGE_RG_PATTERN = /0\.97647\s+0\.41176\s+0\.0549\s+rg/g;
const ORANGE_RG_ESCAPED = String.raw`0\.97647\s+0\.41176\s+0\.0549\s+rg`;

export interface MarkerCleanupResult {
  bytes: Uint8Array;
  markersEdited: number;
  markersFound: number;
  pagesTouched: number;
  timingMs: number;
}

/**
 * Busca todos los bloques de marcador en el content stream y devuelve
 * sus posiciones. Un bloque es:
 *   ORANGE_RG ... (digito) Tj
 * sin cruzarse con el siguiente ORANGE_RG.
 */
function extractMarkerBlocks(stream: string, maxSpan = 6000) {
  const regex = new RegExp(
    // ORANGE_RG seguido de cualquier cosa que no sea otro ORANGE_RG (para no
    // comerse al siguiente marcador), hasta encontrar el número del ID en Tj.
    `${ORANGE_RG_ESCAPED}(?:(?!${ORANGE_RG_ESCAPED})[\\s\\S]){0,${maxSpan}}?\\(\\s*(\\d{1,4})\\s*\\)\\s*Tj`,
    "g"
  );

  const blocks: Array<{ start: number; end: number; device: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(stream)) !== null) {
    blocks.push({
      start: match.index,
      end: match.index + match[0].length,
      device: match[1],
    });
  }

  return blocks;
}

/**
 * Edita un marcador dentro de [start, boundary):
 *  - inserta `q 0 0 0 RG 0.7 w` tras el `rg` del naranja
 *  - reemplaza los operadores de pintado (`f`, `fStar`, `B`, `BStar`, `b`, `bStar`)
 *    por `n` (no pinta), dejando la gota invisible
 *  - cierra estado grafico con `Q` antes del BT del numero
 *  - fuerza el texto del numero a negro insertando `0 0 0 rg` tras BT
 */
function editOneMarker(
  stream: string,
  start: number,
  boundary: number,
  device: string
): { stream: string; changed: boolean } {
  const seg = stream.slice(start, boundary);

  const rgPos = seg.indexOf(" rg");
  if (rgPos < 0) return { stream, changed: false };

  // Localizar el Tj del numero de dispositivo dentro del segmento.
  const escapedDevice = device.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tjMatch = new RegExp(`\\(\\s*${escapedDevice}\\s*\\)\\s*Tj`).exec(seg);
  if (!tjMatch || tjMatch.index === undefined) return { stream, changed: false };
  const textPos = tjMatch.index;

  // El BT de apertura del bloque de texto del numero.
  const btPosRel = seg.lastIndexOf("BT", textPos);
  if (btPosRel < 0) return { stream, changed: false };

  let shapes = seg.slice(0, btPosRel);
  const textSeg = seg.slice(btPosRel);

  // Insertar stroke settings despues del " rg" del naranja (aunque con "n" no
  // se pinta, replicamos el Python que tambien inserta este bloque).
  const insertAfter = rgPos + 3; // " rg".length
  shapes = shapes.slice(0, insertAfter) + "\nq 0 0 0 RG 0.7 w\n" + shapes.slice(insertAfter);

  // Reemplazar operadores de pintado por "n" (no pinta nada).
  // (?<!\w) y (?!\w) aseguran que matcheamos el operador completo.
  shapes = shapes.replace(/(?<!\w)(f\*|f|B\*|B|b\*|b)(?!\w)/g, "n");

  // Cerrar estado grafico antes de entrar al texto.
  shapes = shapes + "\nQ\n";

  // Forzar el numero a negro insertando "0 0 0 rg" justo despues de BT.
  let newTextSeg = textSeg;
  if (textSeg.startsWith("BT")) {
    newTextSeg = "BT\n0 0 0 rg\n" + textSeg.slice(2);
  }

  const newSeg = shapes + newTextSeg;
  return {
    stream: stream.slice(0, start) + newSeg + stream.slice(boundary),
    changed: true,
  };
}

/**
 * Resuelve las referencias de `Contents` de una pagina a los PDFRawStream.
 * `Contents` puede ser un solo ref, un stream directo, o un array de refs.
 */
function resolveContentStreams(
  pdfDoc: PDFDocument,
  pageRef: PDFRef
): Array<{ ref: PDFRef | null; stream: PDFRawStream }> {
  const pageObj = pdfDoc.context.lookup(pageRef);
  if (!pageObj || !("get" in pageObj)) return [];

  // Buscar la entrada Contents.
  const contentsObj = (pageObj as { get: (key: unknown) => unknown }).get(
    // Usar PDFName desde el context para no depender de imports adicionales.
    pdfDoc.context.obj("Contents")
  );
  if (!contentsObj) return [];

  const streams: Array<{ ref: PDFRef | null; stream: PDFRawStream }> = [];

  const collect = (value: unknown, ref: PDFRef | null) => {
    if (value instanceof PDFRawStream) {
      streams.push({ ref, stream: value });
      return;
    }
    if (value instanceof PDFArray) {
      // Algunos PDFs anidan Contents como Ref -> Array -> [Ref, Ref, ...].
      value.asArray().forEach((item) => {
        if (item instanceof PDFRef) {
          collect(pdfDoc.context.lookup(item), item);
        } else {
          collect(item, null);
        }
      });
      return;
    }
    // Stream comprimido con filtro no raw (raro en Contents): lo dejamos intacto.
  };

  if (contentsObj instanceof PDFRef) {
    collect(pdfDoc.context.lookup(contentsObj), contentsObj);
  } else {
    collect(contentsObj, null);
  }

  return streams;
}

/**
 * Decodifica un PDFRawStream (maneja FlateDecode / sin filtro) y devuelve
 * el contenido como string latin1.
 */
function decodeStreamAsLatin1(stream: PDFRawStream): string {
  const decoded = decodePDFRawStream(stream).decode();
  // latin1 preserva bytes 0-255 1:1 — esto es crucial para no corromper
  // binarios dentro del content stream (imagenes inline, etc.).
  return new TextDecoder("latin1").decode(decoded);
}

function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * Reemplaza el contenido decodificado de un PDFRawStream con nuevos bytes.
 * Si el stream original tenia un filtro (p.ej. FlateDecode), lo removemos
 * para que los bytes nuevos se guarden tal cual. pdf-lib se encargara de
 * recomprimir al serializar si corresponde.
 */
function replaceStreamContents(
  pdfDoc: PDFDocument,
  entry: { ref: PDFRef | null; stream: PDFRawStream },
  newBytes: Uint8Array
) {
  const context = pdfDoc.context;
  const newStream = context.stream(newBytes);

  if (entry.ref) {
    // Reemplaza la entrada en el tabla de objetos conservando el ref.
    context.assign(entry.ref, newStream);
  } else {
    // Stream inline — pdf-lib no soporta esto facilmente. Lo saltamos.
    // En practica Contents suele venir como ref, no inline.
  }
}

/**
 * Funcion principal: toma los bytes de un PDF y devuelve los bytes del PDF
 * limpio (sin gotas naranja, numeros forzados a negro).
 *
 * Si el PDF no tiene marcadores naranja (p.ej. ya fue procesado o es de otra
 * tienda con otro color), el resultado es equivalente al input.
 */
export async function removeOrangeMarkersFromPdf(
  inputBytes: Uint8Array
): Promise<MarkerCleanupResult> {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

  const pdfDoc = await PDFDocument.load(inputBytes, {
    updateMetadata: false,
    ignoreEncryption: true,
  });

  let markersFound = 0;
  let markersEdited = 0;
  let pagesTouched = 0;

  const pages = pdfDoc.getPages();
  for (const page of pages) {
    const pageRef = page.ref;
    const streams = resolveContentStreams(pdfDoc, pageRef);
    if (streams.length === 0) continue;

    // Concatenar todos los streams de la pagina como hace el Python con
    // "".join(streams). Necesitamos mapear offsets para saber a que stream
    // corresponde cada bloque editado.
    const decoded = streams.map((entry) => decodeStreamAsLatin1(entry.stream));
    const concat = decoded.join("");

    if (!ORANGE_RG_PATTERN.test(concat)) {
      continue;
    }

    const blocks = extractMarkerBlocks(concat);
    if (blocks.length === 0) continue;

    markersFound += blocks.length;
    pagesTouched += 1;

    // Ordenar por aparicion.
    blocks.sort((a, b) => a.start - b.start);

    // Calcular boundary de cada bloque = inicio del siguiente o final del stream.
    const withBoundaries = blocks.map((block, index) => ({
      ...block,
      boundary: index + 1 < blocks.length ? blocks[index + 1].start : concat.length,
    }));

    // Editar en reversa para preservar offsets del inicio.
    let modified = concat;
    for (let i = withBoundaries.length - 1; i >= 0; i -= 1) {
      const block = withBoundaries[i];
      const result = editOneMarker(modified, block.start, block.boundary, block.device);
      if (result.changed) {
        modified = result.stream;
        markersEdited += 1;
      }
    }

    // Guardar todo el contenido concatenado en el primer stream y vaciar los
    // demas. Esto es equivalente al patron del Python.
    const firstEntry = streams[0];
    replaceStreamContents(pdfDoc, firstEntry, encodeLatin1(modified));
    for (let i = 1; i < streams.length; i += 1) {
      replaceStreamContents(pdfDoc, streams[i], encodeLatin1(""));
    }
  }

  const outputBytes = await pdfDoc.save({
    useObjectStreams: true,
  });

  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();

  return {
    bytes: outputBytes,
    markersEdited,
    markersFound,
    pagesTouched,
    timingMs: t1 - t0,
  };
}
