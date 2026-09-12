import "./load-env";
import { prisma } from "../src/lib/db";
import type { UnitType } from "../src/generated/prisma/client";

/**
 * Creates BK6816 Norco and its equipment — the first real pilot restaurant.
 * Source: "Qimby units list.xlsx" (sheets Gateway / Sensors / Unit / BK_list).
 *
 *   npm run norco:setup
 *
 * Idempotent: re-running updates the rows in place and never touches readings.
 * It only adds — removing the demo restaurants is a separate, deliberate step
 * (`npm run demo:purge`).
 *
 * Sensors are wired to this equipment from data/sensors.csv afterwards:
 *   npm run sensors:import
 */

const LOCATION = {
  name: "Burger King #6816",
  address: "1666 Second St",
  city: "Norco",
  state: "CA",
  zip: "92860",
  // TODO: OpenStreetMap has no house number for this street — this is the centre of
  // Norco, so the pin is right to within about a kilometre. Replace with the exact
  // coordinates once someone reads them off the gateway or a phone at the store.
  lat: 33.9323307,
  lng: -117.5508901,
  timezone: "America/Los_Angeles",
};

const GATEWAY = { ttnGatewayId: "a84041ffff2e3af4", eui: "A84041FFFF2E3AF4" };

/**
 * Starting ranges. The client has not signed these off yet, and the ТЗ says each unit is
 * set by hand in the UI, so these are only sensible defaults to start from:
 *  - cooler/freezer: standard food-service holding temperatures;
 *  - AC: measured supply air on 2026-09-12 was 45.6–47.8 °F across the four units.
 */
interface UnitSeed {
  name: string;
  type: UnitType;
  rangeMinF: number;
  rangeMaxF: number;
  model?: string;
  serial?: string;
}

const UNITS: UnitSeed[] = [
  { name: "Walk-in Cooler", type: "walk_in_cooler", rangeMinF: 35, rangeMaxF: 41 },
  { name: "Walk-in Freezer", type: "walk_in_freezer", rangeMinF: 0, rangeMaxF: 10 },
  { name: "AC1 - Kitchen", type: "ac", rangeMinF: 45, rangeMaxF: 50, model: "48FCFM07A2A5A6U0A0", serial: "2419C85938" },
  { name: "AC2 - Dining", type: "ac", rangeMinF: 45, rangeMaxF: 50, model: "48KCNA06A2A5B6U0A0", serial: "2419C85977" },
  { name: "AC3 - Dining", type: "ac", rangeMinF: 45, rangeMaxF: 50, model: "48FCFM07A2A5A6U0A0", serial: "2419C85937" },
  { name: "AC4 - Kitchen", type: "ac", rangeMinF: 45, rangeMaxF: 50, model: "48KCNA06A2A5B6U0A0", serial: "2419C85976" },
];

const location = await prisma.location.upsert({
  where: { name: LOCATION.name },
  update: LOCATION,
  create: LOCATION,
});
console.log(`✓ ${location.name} — ${LOCATION.address}, ${LOCATION.city}, ${LOCATION.state} ${LOCATION.zip}`);

await prisma.gateway.upsert({
  where: { ttnGatewayId: GATEWAY.ttnGatewayId },
  update: { locationId: location.id, eui: GATEWAY.eui },
  create: { ...GATEWAY, locationId: location.id },
});
console.log(`✓ gateway ${GATEWAY.ttnGatewayId}`);

for (const u of UNITS) {
  // Ranges are edited in the app, so only seed them when the unit is new.
  const existing = await prisma.unit.findUnique({
    where: { locationId_name: { locationId: location.id, name: u.name } },
  });
  await prisma.unit.upsert({
    where: { locationId_name: { locationId: location.id, name: u.name } },
    update: {
      type: u.type,
      model: u.model ?? null,
      serial: u.serial ?? null,
      ...(existing ? {} : { rangeMinF: u.rangeMinF, rangeMaxF: u.rangeMaxF }),
    },
    create: {
      locationId: location.id,
      name: u.name,
      type: u.type,
      model: u.model ?? null,
      serial: u.serial ?? null,
      rangeMinF: u.rangeMinF,
      rangeMaxF: u.rangeMaxF,
    },
  });
  const range = existing ? `${existing.rangeMinF}…${existing.rangeMaxF} (kept)` : `${u.rangeMinF}…${u.rangeMaxF}`;
  console.log(`  ${existing ? "updated" : "created"}  ${u.name.padEnd(16)} ${range} °F`);
}

console.log(`\nDone. Next: npm run sensors:import`);
await prisma.$disconnect();
