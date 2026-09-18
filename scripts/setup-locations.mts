import "./load-env";
import { prisma } from "../src/lib/db";
import type { UnitType } from "../src/generated/prisma/client";

/**
 * Creates the pilot restaurants and their equipment.
 * Source: "Qimby units list.xlsx" (sheets Gateway / Sensors / Unit / BK_list).
 *
 *   npm run locations:setup                  # add anything missing, keep existing ranges
 *   npm run locations:setup -- --ranges      # also push the thresholds below onto existing units
 *
 * Idempotent, and it only ever adds — retiring a restaurant is a separate, deliberate step
 * (`npm run demo:purge`). Ranges are editable in the app, so a plain run will not quietly
 * undo someone's change; --ranges says to apply this file's numbers on purpose.
 *
 * Sensors are wired to this equipment from data/sensors.csv afterwards:
 *   npm run sensors:import
 */

/**
 * Two bands per unit, from the client's table of 16 Sep.
 *
 * `range` is the normal band — the table's "Normal Range" and the chart's green zone.
 * `alert` is where an hour out of range wakes somebody. The gap between them is the amber
 * Warning: a freezer in defrost, an AC that just cycled off.
 *
 * A freezer's low alert sits out of reach on purpose — it cannot be too cold. A kitchen is
 * allowed to run warmer than a dining room, 80 against 75.
 */
interface UnitSeed {
  name: string;
  type: UnitType;
  rangeMinF: number;
  rangeMaxF: number;
  alertMinF: number;
  alertMaxF: number;
  /** AC only: the duct probe's own normal band, drawn on the chart */
  probeMinF?: number;
  probeMaxF?: number;
  model?: string;
  serial?: string;
}

const COOLER = { type: "walk_in_cooler", rangeMinF: 33, rangeMaxF: 40, alertMinF: 33, alertMaxF: 50 } as const;
const FREEZER = { type: "walk_in_freezer", rangeMinF: 0, rangeMaxF: 10, alertMinF: -40, alertMaxF: 20 } as const;
const AC_KITCHEN = { type: "ac", rangeMinF: 65, rangeMaxF: 80, alertMinF: 65, alertMaxF: 85, probeMinF: 50, probeMaxF: 60 } as const;
const AC_DINING = { type: "ac", rangeMinF: 65, rangeMaxF: 75, alertMinF: 65, alertMaxF: 80, probeMinF: 50, probeMaxF: 60 } as const;

interface LocationSeed {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  timezone: string;
  gateway: { ttnGatewayId: string; eui: string };
  units: UnitSeed[];
}

const LOCATIONS: LocationSeed[] = [
  {
    name: "Burger King #6816",
    address: "1666 Second St",
    city: "Norco",
    state: "CA",
    zip: "92860",
    // The restaurant itself, from OpenStreetMap's "Burger King, 1666, 2nd Street, Norco"
    lat: 33.9091466,
    lng: -117.559842,
    timezone: "America/Los_Angeles",
    gateway: { ttnGatewayId: "a84041ffff2e3af4", eui: "A84041FFFF2E3AF4" },
    units: [
      { name: "Walk-in Cooler", ...COOLER },
      { name: "Walk-in Freezer", ...FREEZER },
      { name: "AC1 - Kitchen", ...AC_KITCHEN, model: "48FCFM07A2A5A6U0A0", serial: "2419C85938" },
      { name: "AC2 - Dining", ...AC_DINING, model: "48KCNA06A2A5B6U0A0", serial: "2419C85977" },
      { name: "AC3 - Dining", ...AC_DINING, model: "48FCFM07A2A5A6U0A0", serial: "2419C85937" },
      { name: "AC4 - Kitchen", ...AC_KITCHEN, model: "48KCNA06A2A5B6U0A0", serial: "2419C85976" },
    ],
  },
  {
    name: "Burger King #6399",
    address: "11125 Washington Blvd",
    city: "Whittier",
    state: "CA",
    zip: "90606",
    lat: 33.9726544,
    lng: -118.0731357,
    timezone: "America/Los_Angeles",
    gateway: { ttnGatewayId: "a8404120e40c4169", eui: "A8404120E40C4169" },
    // Models and serials are not in the inventory yet — the installers ran out of time.
    units: [
      { name: "Walk-in Cooler", ...COOLER },
      { name: "Walk-in Freezer", ...FREEZER },
      { name: "AC1 - Kitchen", ...AC_KITCHEN },
      { name: "AC2 - Kitchen", ...AC_KITCHEN },
      { name: "AC3 - Dining", ...AC_DINING },
    ],
  },
];

const forceRanges = process.argv.includes("--ranges");

for (const seed of LOCATIONS) {
  const { gateway, units, ...fields } = seed;
  const location = await prisma.location.upsert({
    where: { name: fields.name },
    update: fields,
    create: fields,
  });
  console.log(`\n✓ ${location.name} — ${fields.address}, ${fields.city}, ${fields.state} ${fields.zip}`);

  await prisma.gateway.upsert({
    where: { ttnGatewayId: gateway.ttnGatewayId },
    update: { locationId: location.id, eui: gateway.eui },
    create: { ...gateway, locationId: location.id },
  });
  console.log(`  шлюз ${gateway.ttnGatewayId}`);

  for (const u of units) {
    const existing = await prisma.unit.findUnique({
      where: { locationId_name: { locationId: location.id, name: u.name } },
    });
    const thresholds = {
      rangeMinF: u.rangeMinF,
      rangeMaxF: u.rangeMaxF,
      alertMinF: u.alertMinF,
      alertMaxF: u.alertMaxF,
      probeMinF: u.probeMinF ?? null,
      probeMaxF: u.probeMaxF ?? null,
    };
    await prisma.unit.upsert({
      where: { locationId_name: { locationId: location.id, name: u.name } },
      update: {
        type: u.type,
        model: u.model ?? null,
        serial: u.serial ?? null,
        ...(existing && !forceRanges ? {} : thresholds),
      },
      create: {
        locationId: location.id,
        name: u.name,
        type: u.type,
        model: u.model ?? null,
        serial: u.serial ?? null,
        ...thresholds,
      },
    });
    const shown = !existing || forceRanges ? thresholds : existing;
    console.log(
      `  ${(!existing ? "создан" : forceRanges ? "обновлён" : "оставлен").padEnd(9)} ${u.name.padEnd(16)} ` +
        `норма ${shown.rangeMinF}…${shown.rangeMaxF} · тревога ${shown.alertMinF ?? "—"}…${shown.alertMaxF ?? "—"}` +
        (u.probeMinF !== undefined ? ` · дакт ${shown.probeMinF ?? "—"}…${shown.probeMaxF ?? "—"}` : ""),
    );
  }
}

console.log(`\nГотово. Дальше: npm run sensors:import`);
await prisma.$disconnect();
