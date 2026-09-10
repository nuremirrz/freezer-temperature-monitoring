import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db";

/**
 * Applies data/sensors.csv to the database: creates or updates each sensor and
 * wires its probes to equipment. Idempotent — re-running a corrected file fixes
 * the mapping without touching the readings already collected.
 *
 *   npm run sensors:import                    # apply data/sensors.csv
 *   npm run sensors:import -- --file other.csv --dry-run
 */

interface Row {
  line: number;
  location: string;
  devEui: string;
  deviceId: string;
  nodeType: string;
  interval: number;
  channel: number;
  unit: string;
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const dryRun = process.argv.includes("--dry-run");
const file = arg("file") ?? "data/sensors.csv";

const text = readFileSync(file, "utf8");
const rows: Row[] = [];
const problems: string[] = [];

text.split(/\r?\n/).forEach((raw, i) => {
  const line = i + 1;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) return;
  const cells = trimmed.split(",").map((c) => c.trim());
  if (cells[0].toLowerCase() === "location") return; // header

  if (cells.length < 7) {
    problems.push(`line ${line}: expected 7 columns, got ${cells.length}`);
    return;
  }
  const [location, devEui, deviceId, nodeType, interval, channel, unit] = cells;

  if (!/^[0-9A-Fa-f]{16}$/.test(devEui)) problems.push(`line ${line}: dev_eui "${devEui}" is not 16 hex characters`);
  if (!["1", "2"].includes(channel)) problems.push(`line ${line}: channel must be 1 or 2, got "${channel}"`);
  if (nodeType && !["LTC2", "LHT65N"].includes(nodeType.toUpperCase()))
    problems.push(`line ${line}: unknown node_type "${nodeType}"`);
  if (nodeType.toUpperCase() === "LHT65N" && channel === "2")
    problems.push(`line ${line}: LHT65N has a single probe, channel 2 is not possible`);

  rows.push({
    line,
    location,
    devEui: devEui.toUpperCase(),
    deviceId,
    nodeType: nodeType.toUpperCase(),
    interval: Number(interval) || 300,
    channel: Number(channel),
    unit,
  });
});

// Every probe of a device must agree on the device's own attributes
const byEui = new Map<string, Row[]>();
for (const r of rows) byEui.set(r.devEui, [...(byEui.get(r.devEui) ?? []), r]);
for (const [eui, group] of byEui) {
  const locations = new Set(group.map((r) => r.location));
  if (locations.size > 1) problems.push(`${eui}: rows disagree on the location (${[...locations].join(" / ")})`);
  const channels = group.map((r) => r.channel);
  if (new Set(channels).size !== channels.length) problems.push(`${eui}: the same channel appears twice`);
}

// Names must match what is already in the database
const locations = await prisma.location.findMany({ include: { units: true } });
const locByName = new Map(locations.map((l) => [l.name, l]));
for (const r of rows) {
  const loc = locByName.get(r.location);
  if (!loc) {
    problems.push(`line ${r.line}: no location named "${r.location}"`);
    continue;
  }
  if (r.unit && !loc.units.some((u) => u.name === r.unit))
    problems.push(`line ${r.line}: "${r.location}" has no equipment named "${r.unit}"`);
}

if (problems.length) {
  console.error(`${problems.length} problem(s) in ${file}:\n  ` + problems.join("\n  "));
  console.error("\nNothing was written. Fix the file and run again.");
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`${file}: ${rows.length} probes across ${byEui.size} sensors, no problems found.`);
if (dryRun) {
  for (const [eui, group] of byEui) {
    console.log(`  ${eui} @ ${group[0].location}`);
    for (const r of group) console.log(`      ch${r.channel} → ${r.unit || "(not connected)"}`);
  }
  console.log("\n--dry-run: nothing written.");
  await prisma.$disconnect();
  process.exit(0);
}

let created = 0;
let updated = 0;
for (const [eui, group] of byEui) {
  const loc = locByName.get(group[0].location)!;
  const existing = await prisma.sensor.findUnique({ where: { devEui: eui } });

  const sensor = await prisma.sensor.upsert({
    where: { devEui: eui },
    update: {
      locationId: loc.id,
      ttnDeviceId: group[0].deviceId || null,
      expectedIntervalSec: group[0].interval,
      // nodeType is owned by the device: only seed it when we have never heard from it
      ...(existing?.nodeType ? {} : { nodeType: group[0].nodeType || null }),
    },
    create: {
      devEui: eui,
      ttnDeviceId: group[0].deviceId || null,
      nodeType: group[0].nodeType || null,
      expectedIntervalSec: group[0].interval,
      locationId: loc.id,
    },
  });
  if (existing) updated++;
  else created++;

  for (const r of group) {
    const unitId = r.unit ? (loc.units.find((u) => u.name === r.unit)?.id ?? null) : null;
    await prisma.sensorChannel.upsert({
      where: { sensorId_channel: { sensorId: sensor.id, channel: r.channel } },
      update: { unitId },
      create: { sensorId: sensor.id, channel: r.channel, unitId },
    });
  }
  // A device that lost a probe in the new file should lose the mapping too
  await prisma.sensorChannel.deleteMany({
    where: { sensorId: sensor.id, channel: { notIn: group.map((r) => r.channel) } },
  });

  console.log(`  ✓ ${eui} @ ${loc.name}: ${group.map((r) => `ch${r.channel}→${r.unit || "—"}`).join(", ")}`);
}

console.log(`\nDone. ${created} sensor(s) created, ${updated} updated.`);
console.log("Placeholders (FILL_ME_*) left untouched — delete them from the database once every real sensor is in.");
await prisma.$disconnect();
