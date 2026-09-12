import "./load-env";
import { prisma } from "../src/lib/db";

/**
 * Removes the synthetic readings that were sent to BK6816 Norco on 2026-09-12 while
 * verifying the UI, and the alerts they raised. Nothing else is touched: the location,
 * its equipment and the sensor mapping are the real configuration and stay.
 *
 *   npm run clean:testdata              # dry run
 *   npm run clean:testdata -- --yes
 *
 * After this the Norco units correctly read as "no data yet" until the TTN webhook
 * starts delivering real uplinks.
 */

const confirmed = process.argv.includes("--yes");

// The fixture run: every synthetic reading landed inside this window.
const FROM = new Date("2026-09-12T15:08:40Z");
const TO = new Date("2026-09-12T15:10:00Z");

const location = await prisma.location.findUnique({
  where: { name: "Burger King #6816" },
  include: { units: { select: { id: true, name: true } } },
});
if (!location) {
  console.log("Burger King #6816 is not in this database — nothing to do.");
  await prisma.$disconnect();
  process.exit(0);
}
const unitIds = location.units.map((u) => u.id);

const readings = await prisma.reading.findMany({
  where: { unitId: { in: unitIds }, measuredAt: { gte: FROM, lte: TO } },
  select: { id: true, tempF: true, measuredAt: true, unitId: true },
  orderBy: { measuredAt: "asc" },
});
const alerts = await prisma.alert.findMany({
  where: { unitId: { in: unitIds } },
  select: { id: true, type: true, openedAt: true, resolvedAt: true, unitId: true },
});
const byUnit = new Map(location.units.map((u) => [u.id, u.name]));

console.log(`Synthetic readings (${readings.length}):`);
for (const r of readings) console.log(`  ${r.measuredAt.toISOString()}  ${r.tempF}°F  ${byUnit.get(r.unitId)}`);
console.log(`\nAlerts raised by them (${alerts.length}):`);
for (const a of alerts) {
  console.log(`  ${a.type.padEnd(18)} ${byUnit.get(a.unitId)}  ${a.resolvedAt ? "resolved" : "OPEN"}`);
}

// Any reading outside the window would be a real uplink — refuse to guess.
const realReadings = await prisma.reading.count({
  where: { unitId: { in: unitIds }, OR: [{ measuredAt: { lt: FROM } }, { measuredAt: { gt: TO } }] },
});
if (realReadings) {
  console.log(`\n⚠ ${realReadings} reading(s) outside the fixture window — those look real and are kept.`);
}

if (!confirmed) {
  console.log("\nDry run. Re-run with --yes to delete. Nothing was changed.");
  await prisma.$disconnect();
  process.exit(0);
}

const [delReadings, delAlerts] = await prisma.$transaction([
  prisma.reading.deleteMany({ where: { id: { in: readings.map((r) => r.id) } } }),
  prisma.alert.deleteMany({ where: { id: { in: alerts.map((a) => a.id) } } }),
]);
// The sensors keep lastSeenAt from the fixtures, which would hide a genuine silence.
const clearedSensors = await prisma.sensor.updateMany({
  where: { locationId: location.id, lastSeenAt: { gte: FROM, lte: TO } },
  data: { lastSeenAt: null, batteryV: null, batteryPct: null, batStatus: null, ambientTempF: null, ambientHum: null, lastRssi: null, lastSnr: null },
});

console.log(`\nDeleted ${delReadings.count} reading(s), ${delAlerts.count} alert(s); reset ${clearedSensors.count} sensor(s) to "never seen".`);
await prisma.$disconnect();
