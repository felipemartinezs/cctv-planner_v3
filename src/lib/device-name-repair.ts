const CANONICAL_DEVICE_NAME_TOKENS = new Set([
  "BULLPEN",
  "CENTER",
  "CHECKOUT",
  "COSMETICS",
  "EMGX",
  "END",
  "ENTRY",
  "EPVM",
  "EXIT",
  "FRONT",
  "GARDEN",
  "GM",
  "KIOSK",
  "LOTTERY",
  "MONEY",
  "PVM",
  "RECEIVING",
  "SELF",
  "SPORTING",
  "SUBJECT",
  "VM",
]);

function isWordToken(value: string) {
  return /^[A-Z0-9]+$/i.test(value);
}

function isSpaceSeparator(value: string) {
  return /^\s+$/.test(value);
}

function shouldMergeWordTokens(left: string, right: string) {
  const merged = `${left}${right}`.toUpperCase();
  if (!CANONICAL_DEVICE_NAME_TOKENS.has(merged)) {
    return false;
  }

  return left.length <= 2 || right.length <= 2;
}

// Strip de ruido inyectado por la extraccion de texto del PDF cuando el
// tag descriptor "PLACEHOLDER PVM ICON" (o variantes) se inserta MID-palabra
// y parte tokens canonicos como BULLPEN, PVM, GM, etc.
//
// Casos reales observados en SAN_LEANDRO / SAN_DIEGO (abril 2026):
//   "SAL_COSMETICS_BULLPE PLACEHOLDER PVM ICON N_PVM_01"
//         ->  "SAL_COSMETICS_BULLPEN_PVM_01"
//   "FRNT_GM_FRONT_END_P PLACEHOLDER PVM ICON VM_01"
//         ->  "FRNT_GM_FRONT_END_PVM_01"
//   "FRNT_SELF_CHECKOUT_BULLPEN_EXIT_PVM_01_G PLACEHOLDER PVM ICON M"
//         ->  "FRNT_SELF_CHECKOUT_BULLPEN_EXIT_PVM_01_GM"
//
// Condicion: la inyeccion SOLO se elimina cuando esta rodeada de caracter
// alfanumerico a ambos lados (es decir, parte un token). Si aparece al
// final del nombre como tag descriptor legitimo, se deja intacta.
const MID_WORD_NOISE_INSERTS = [
  /(\w)\s+PLACEHOLDER\s+PVM\s+ICON\s+(\w)/gi,
];

function stripMidWordNoiseInserts(value: string): string {
  let result = value;
  for (const pattern of MID_WORD_NOISE_INSERTS) {
    result = result.replace(pattern, "$1$2");
  }
  return result;
}

export function repairExtractedDeviceName(value: string): string {
  const trimmed = value.replace(/\u00a0/g, " ").trim();
  if (!trimmed) {
    return "";
  }

  const denoised = stripMidWordNoiseInserts(trimmed);
  const compactSeparators = denoised.replace(/\s*([_/\-])\s*/g, "$1");
  const tokens = compactSeparators.split(/([ _/\-]+)/).filter((token) => token.length > 0);

  for (let index = 0; index < tokens.length - 2; index += 1) {
    const left = tokens[index];
    const separator = tokens[index + 1];
    const right = tokens[index + 2];

    if (!isWordToken(left) || !isSpaceSeparator(separator) || !isWordToken(right)) {
      continue;
    }

    if (!shouldMergeWordTokens(left, right)) {
      continue;
    }

    tokens.splice(index, 3, `${left}${right}`);
    index = Math.max(index - 2, -1);
  }

  return tokens.join("").replace(/\s+/g, " ").trim();
}

export function wasDeviceNameRepaired(rawName: string, repairedName: string): boolean {
  return rawName.trim() !== repairedName.trim();
}
