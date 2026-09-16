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
 * Thresholds as the client set them (Trello "Пофиксить все Normal range", 13 Sep, and the
 * chart spec in the ТЗ of the same day).
 *
 * Two bands per unit, because they answer different questions. `range` is the normal band —
 * the table's "Normal Range" and the chart's green zone. `alert` is where someone gets woken
 * up. A walk-in freezer is normal to 10 °F and alarming from 20 °F, and over the last day it
 * was above 10 °F ninety per cent of the time: defrost cycles, deliveries, an open door.
 * Alerting on all of that would train everyone to ignore the alerts.
 *
 * The low ends of the alert bands are deliberately out of reach. For refrigeration the danger
 * is warmth; the client named only upper thresholds. The cooler's 32 °F "Freeze Risk" line is
 * drawn on the chart but does not raise anything until someone asks for it.
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

const UNITS: UnitSeed[] = [
  // Normal band = green, alert band = where red starts; the gap between them is the amber
  // Warning. Straight from the client's table of 16 Sep.
  { name: "Walk-in Cooler", type: "walk_in_cooler", rangeMinF: 33, rangeMaxF: 40, alertMinF: 33, alertMaxF: 50 },
  // No floor: a freezer is never too cold, so the low alert sits out of reach on purpose
  { name: "Walk-in Freezer", type: "walk_in_freezer", rangeMinF: 0, rangeMaxF: 10, alertMinF: -40, alertMaxF: 20 },
  // A kitchen is allowed to run warmer than a dining room — 80 against 75
  { name: "AC1 - Kitchen", type: "ac", rangeMinF: 65, rangeMaxF: 80, alertMinF: 65, alertMaxF: 85, probeMinF: 50, probeMaxF: 60, model: "48FCFM07A2A5A6U0A0", serial: "2419C85938" },
  { name: "AC2 - Dining", type: "ac", rangeMinF: 65, rangeMaxF: 75, alertMinF: 65, alertMaxF: 80, probeMinF: 50, probeMaxF: 60, model: "48KCNA06A2A5B6U0A0", serial: "2419C85977" },
  { name: "AC3 - Dining", type: "ac", rangeMinF: 65, rangeMaxF: 75, alertMinF: 65, alertMaxF: 80, probeMinF: 50, probeMaxF: 60, model: "48FCFM07A2A5A6U0A0", serial: "2419C85937" },
  { name: "AC4 - Kitchen", type: "ac", rangeMinF: 65, rangeMaxF: 80, alertMinF: 65, alertMaxF: 85, probeMinF: 50, probeMaxF: 60, model: "48KCNA06A2A5B6U0A0", serial: "2419C85976" },
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

const forceRanges = process.argv.includes("--ranges");

for (const u of UNITS) {
  // Ranges are editable in the app, so re-running does not quietly undo someone's change —
  // unless --ranges says to apply the file's numbers on purpose.
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
    create: { locationId: location.id, name: u.name, type: u.type, model: u.model ?? null, serial: u.serial ?? null, ...thresholds },
  });
  const applied = !existing || forceRanges;
  const shown = applied ? thresholds : existing;
  console.log(
    `  ${(!existing ? "created" : forceRanges ? "updated" : "kept   ")}  ${u.name.padEnd(16)} ` +
      `норма ${shown.rangeMinF}…${shown.rangeMaxF} · тревога ${shown.alertMinF ?? "—"}…${shown.alertMaxF ?? "—"}` +
      (u.probeMinF !== undefined ? ` · дакт ${shown.probeMinF ?? "—"}…${shown.probeMaxF ?? "—"}` : ""),
  );
}

console.log(`\nDone. Next: npm run sensors:import`);
await prisma.$disconnect();
