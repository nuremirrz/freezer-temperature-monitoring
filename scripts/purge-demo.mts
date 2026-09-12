import "./load-env";
import { prisma } from "../src/lib/db";

/**
 * Removes the seeded demo restaurants so only the real pilot locations are left
 * (the ТЗ for BK6816 asks for exactly one point on the map).
 *
 *   npm run demo:purge                      # dry run — prints what would go
 *   npm run demo:purge -- --yes             # actually delete
 *   npm run demo:purge -- --keep "Burger King #6816" --yes
 *
 * Everything below a location goes with it: units, sensors, probe mappings, readings
 * and alerts. Deleting a sensor does NOT lose future data — an uplink from a device we
 * no longer know is still stored in UnknownUplink, and re-importing the CSV brings the
 * device back.
 *
 * This is destructive and irreversible, so it refuses to run without --yes.
 */

const argv = process.argv.slice(2);
const confirmed = argv.includes("--yes");
const keep = new Set<string>();
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--keep" && argv[i + 1]) keep.add(argv[i + 1]);
}
if (!keep.size) keep.add("Burger King #6816");

const locations = await prisma.location.findMany({
  include: { units: { select: { id: true } }, sensors: { select: { id: true, devEui: true, ttnDeviceId: true } } },
  orderBy: { name: "asc" },
});

const doomed = locations.filter((l) => !keep.has(l.name));
const kept = locations.filter((l) => keep.has(l.name));

console.log(`Keeping:  ${kept.map((l) => l.name).join(", ") || "(nothing matched --keep!)"}`);
if (!doomed.length) {
  console.log("Nothing to remove.");
  await prisma.$disconnect();
  process.exit(0);
}

let totalReadings = 0;
for (const l of doomed) {
  const unitIds = l.units.map((u) => u.id);
  const readings = unitIds.length ? await prisma.reading.count({ where: { unitId: { in: unitIds } } }) : 0;
  totalReadings += readings;
  console.log(`\n${l.name} — ${l.city}, ${l.state}`);
  console.log(`  units: ${l.units.length}   readings: ${readings}   sensors: ${l.sensors.length}`);
  for (const s of l.sensors) console.log(`    ${s.devEui}  ${s.ttnDeviceId ?? "—"}`);
}

if (!confirmed) {
  console.log(
    `\nDry run: ${doomed.length} location(s), ${totalReadings} reading(s) would be deleted.` +
      `\nRe-run with --yes to do it. Nothing was changed.`,
  );
  await prisma.$disconnect();
  process.exit(0);
}

for (const l of doomed) {
  const unitIds = l.units.map((u) => u.id);
  const sensorIds = l.sensors.map((s) => s.id);
  await prisma.$transaction([
    prisma.reading.deleteMany({ where: { OR: [{ unitId: { in: unitIds } }, { sensorId: { in: sensorIds } }] } }),
    prisma.alert.deleteMany({ where: { unitId: { in: unitIds } } }),
    prisma.sensorChannel.deleteMany({ where: { sensorId: { in: sensorIds } } }),
    prisma.sensor.deleteMany({ where: { locationId: l.id } }),
    prisma.unit.deleteMany({ where: { locationId: l.id } }),
    prisma.gateway.deleteMany({ where: { locationId: l.id } }),
    prisma.location.delete({ where: { id: l.id } }),
  ]);
  console.log(`  ✗ removed ${l.name}`);
}

console.log(`\nDone. ${doomed.length} location(s) removed.`);
await prisma.$disconnect();
