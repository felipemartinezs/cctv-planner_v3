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

export function repairExtractedDeviceName(value: string): string {
  const trimmed = value.replace(/\u00a0/g, " ").trim();
  if (!trimmed) {
    return "";
  }

  const compactSeparators = trimmed.replace(/\s*([_/\-])\s*/g, "$1");
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
