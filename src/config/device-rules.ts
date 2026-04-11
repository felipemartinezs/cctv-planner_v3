import { repairExtractedDeviceName } from "../lib/device-name-repair";

/**
 * DEVICE KNOWLEDGE BASE
 * ---------------------
 * Rules that infer device metadata (type, cable count, installer notes)
 * from the device NAME when no Part Number is present or when the name
 * carries more specific information than the part number alone.
 *
 * HOW TO ADD A RULE:
 *  1. Add a new entry to DEVICE_RULES below.
 *  2. `namePattern` is a case-insensitive regex tested against the full device name.
 *  3. The first matching rule wins.
 *  4. Re-build / hot-reload — no other files need to change.
 *
 * CABLE FIELDS:
 *  cablesCAT5  — number of CAT5/network cables to run to this device
 *  cablesPower — number of 12/2 power cables to run (0 if device uses existing power)
 */

export interface DeviceRule {
  id: string;
  description: string;
  namePattern: string;
  deviceType: string;
  inferredIconDevice?: string;
  inferredPartNumber?: string;
  cablesCAT5: number;
  cablesPower: number;
  installerNote?: string;
}

export const DEVICE_RULES: DeviceRule[] = [
  {
    id: "emergency-exit-pvm-32",
    description: "PVM 32\" para salida de emergencia / EMGX",
    namePattern:
      "(?:^|[_ ])EMGX(?:$|[_ ]).*(?:EPVM|PVM)|(?:EPVM|PVM).*(?:^|[_ ])EMGX(?:$|[_ ])",
    deviceType: "PVM 32\"",
    inferredIconDevice: "MCLV-BAXFA51 32",
    inferredPartNumber: "MCLV-BAXFA51",
    cablesCAT5: 2,
    cablesPower: 1,
    installerNote:
      "PVM 32\" de salida de emergencia — correr 2 CAT5 (uno por pantalla) + 1 cable 12/2 power",
  },
  {
    id: "liquor-pvm-43",
    description: "Monitor VPM 43\" en área Liquor (back-to-back, dual feed)",
    namePattern: "SAL_LIQUOR_PVM",
    deviceType: "PVM 43\" back-to-back",
    inferredIconDevice: "MCLV-BAXFA51 43 LED Monitor 43 Back to Back",
    inferredPartNumber: "MCLB-BAXFA51",
    cablesCAT5: 2,
    cablesPower: 1,
    installerNote: "Monitor dual 43\" back-to-back — correr 2 CAT5 (uno por pantalla) + 1 cable 12/2 power",
  },
  {
    id: "salesfloor-evpm-10",
    description: "Monitor EVPM 10\" en Cosmetics / Sporting Goods / Baby Formula",
    namePattern:
      "(?:COSMETICS|SPORTING(?:[_ ]G[_ ]OODS|[_ ]GOODS)|BABY[_ ]FORMULA).*(?:EPVM|PVM)|(?:EPVM|PVM).*(?:COSMETICS|SPORTING(?:[_ ]G[_ ]OODS|[_ ]GOODS)|BABY[_ ]FORMULA)",
    deviceType: "EVPM 10\"",
    inferredIconDevice: "PVM10-B-2086-WMT",
    inferredPartNumber: "PVM10-B-2086-WMT",
    cablesCAT5: 2,
    cablesPower: 1,
    installerNote:
      "Monitor dual EVPM 10\" — correr 2 CAT5 (uno por pantalla) + 1 cable 12/2 power; validar visualmente si cae en Cosmetics, Sporting Goods o Baby Formula",
  },
  {
    id: "salesfloor-evpm-10-placeholder-double",
    description: "Monitor EVPM 10\" placeholder doble en Pharmacy / Razor Blades",
    namePattern:
      "(?:RAZOR[_ ]BLADES|PHARMACY).*(?:PLACEHOLDER[_ ]DOUBLE|PLACEHOLDER.*DOUBLE).*(?:EPVM|PVM)|(?:EPVM|PVM).*(?:RAZOR[_ ]BLADES|PHARMACY).*(?:PLACEHOLDER[_ ]DOUBLE|PLACEHOLDER.*DOUBLE)",
    deviceType: "EVPM 10\"",
    inferredIconDevice: "PVM10-B-2086-WMT",
    inferredPartNumber: "PVM10-B-2086-WMT",
    cablesCAT5: 2,
    cablesPower: 1,
    installerNote:
      "Monitor dual EVPM 10\" — correr 2 CAT5 (uno por pantalla) + 1 cable 12/2 power; validar visualmente si cae en Pharmacy o Razor Blades",
  },
  {
    id: "pickup-opd-ods-pvm-24",
    description: "PVM 24\" con encoder para OPD / ODS / OGD / OGP / pickup door",
    namePattern:
      "(?:PICKUP[_ ]DOOR|(?:^|[_ ])OPD(?:$|[_ ])|(?:^|[_ ])ODS(?:$|[_ ])|(?:^|[_ ])OGD(?:$|[_ ])|(?:^|[_ ])OGP(?:$|[_ ])).*(?:EPVM|PVM)|(?:EPVM|PVM).*(?:PICKUP[_ ]DOOR|(?:^|[_ ])OPD(?:$|[_ ])|(?:^|[_ ])ODS(?:$|[_ ])|(?:^|[_ ])OGD(?:$|[_ ])|(?:^|[_ ])OGP(?:$|[_ ]))",
    deviceType: "PVM 24\" con encoder",
    inferredIconDevice: "DE-HASPD 24 LED Monitor Desk MountWall Mount",
    inferredPartNumber: "DE-HASPD-24-MONITOR",
    cablesCAT5: 2,
    cablesPower: 1,
    installerNote: "PVM 24\" con encoder — correr 2 CAT5 (monitor + encoder) + 1 cable 12/2 power",
  },
  {
    id: "front-end-pvm-43",
    description: "PVM 43\" para front end / bullpen exit",
    namePattern:
      "(?:FRNT[_ ].*FRONT[_ ]END|FRNT[_ ].*BULLPEN[_ ]EXIT).*(?:EPVM|PVM)|(?:EPVM|PVM).*(?:FRNT[_ ].*FRONT[_ ]END|FRNT[_ ].*BULLPEN[_ ]EXIT)",
    deviceType: "PVM 43\"",
    inferredIconDevice: "MCLV-BAXFA51 43 LED Monitor",
    inferredPartNumber: "MCLV-BAXFA51",
    cablesCAT5: 2,
    cablesPower: 1,
    installerNote: "PVM 43\" de front end — correr 2 CAT5 (uno por pantalla) + 1 cable 12/2 power",
  },
  {
    id: "garden-center-pvm-32",
    description: "PVM 32\" para garden center / salidas de piso de venta",
    namePattern:
      "(?:GARDEN[_ ]CEN(?:TER| TER)?|(?:^|[_ ])EXIT(?:$|[_ ])).*(?:EPVM|PVM)|(?:EPVM|PVM).*(?:GARDEN[_ ]CEN(?:TER| TER)?|(?:^|[_ ])EXIT(?:$|[_ ]))",
    deviceType: "PVM 32\"",
    inferredIconDevice: "MCLV-BAXFA51 32",
    inferredPartNumber: "MCLV-BAXFA51",
    cablesCAT5: 2,
    cablesPower: 1,
    installerNote: "PVM 32\" — correr 2 CAT5 (uno por pantalla) + 1 cable 12/2 power",
  },
];

/** Returns the first matching rule for a given device name, or null. */
export function matchDeviceRule(name: string): DeviceRule | null {
  const upper = repairExtractedDeviceName(name).toUpperCase();
  return (
    DEVICE_RULES.find((rule) => new RegExp(rule.namePattern, "i").test(upper)) ?? null
  );
}
