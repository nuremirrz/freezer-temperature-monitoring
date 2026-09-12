import "../scripts/load-env";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { UnitType } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/auth/password";

/**
 * Pilot seed: 5 northern-NJ locations (Teaneck and neighbours), 1 gateway + 5 sensors each,
 * 8 units per location wired to sensor channels. Idempotent — safe to re-run; stale
 * placeholder sensors (FILL_ME_*) that are no longer in the plan are removed.
 *
 * Three real devices live in Teaneck; every other sensor is a FILL_ME_n placeholder
 * to be replaced with the real dev_eui when the hardware is installed.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

type NodeType = "LTC2" | "LHT65N";

const DEFAULT_RANGE: Record<UnitType, [number, number]> = {
  freezer: [-10, 10],
  walk_in_freezer: [-10, 10],
  walk_in_cooler: [-10, 10],
  ac: [55, 58],
};

interface UnitSeed {
  name: string;
  type: UnitType;
  model?: string;
  year?: number;
}

const UNITS: UnitSeed[] = [
  { name: "Freezer - Back", type: "freezer", model: "True T-49F", year: 2021 },
  { name: "Freezer - Front", type: "freezer", model: "True T-23F", year: 2020 },
  { name: "Reach-in Freezer", type: "freezer", model: "Turbo Air M3F47-2-N", year: 2022 },
  { name: "Walk-in Freezer", type: "walk_in_freezer", model: "Nor-Lake KLF7768-C", year: 2019 },
  { name: "Walk-in Cooler", type: "walk_in_cooler", model: "Nor-Lake KLB7768-C", year: 2019 },
  { name: "AC Unit - Dining", type: "ac", model: "Carrier 48TC-A04", year: 2018 },
  { name: "AC Unit - Kitchen", type: "ac", model: "Trane Precedent YSC060", year: 2018 },
  { name: "AC Unit - Drive Thru", type: "ac", model: "Lennox Landmark KGA060", year: 2020 },
];

interface SensorSeed {
  devEui: string;
  ttnDeviceId?: string;
  nodeType: NodeType;
  /** Uplink interval the device is configured with (default 300 s) */
  expectedIntervalSec?: number;
  /** Unit index per channel; LHT65N has a single probe → one entry. null = probe not wired. */
  channels: (number | null)[];
}

/** Generic layout: five LTC2 placeholders covering the 8 units, two spare probes. */
function placeholderPlan(firstNo: number): SensorSeed[] {
  const n = (i: number) => `FILL_ME_${firstNo + i}`;
  return [
    { devEui: n(0), nodeType: "LTC2", channels: [0, 1] }, // Freezer - Back, Freezer - Front
    { devEui: n(1), nodeType: "LTC2", channels: [2, 3] }, // Reach-in Freezer, Walk-in Freezer
    { devEui: n(2), nodeType: "LTC2", channels: [4, null] }, // Walk-in Cooler, spare
    { devEui: n(3), nodeType: "LTC2", channels: [5, 6] }, // AC Dining, AC Kitchen
    { devEui: n(4), nodeType: "LTC2", channels: [7, null] }, // AC Drive Thru, spare
  ];
}

/** Teaneck has the real hardware from the TTN test application. */
const TEANECK_SENSORS: SensorSeed[] = [
  // fixtures/ttn-uplink.json — two probes
  { devEui: "A84041784362379C", ttnDeviceId: "draginotst2", nodeType: "LTC2", channels: [0, 1] },
  // fixtures/ttn-uplink-lht65n.json — one probe, uplinks every 2 minutes
  { devEui: "A84041B54D625182", ttnDeviceId: "draginotst", nodeType: "LHT65N", expectedIntervalSec: 120, channels: [2] },
  // Type not confirmed yet — created as LHT65N; the first uplink's Node_type will correct it
  { devEui: "A8404113CA625184", ttnDeviceId: "dragino-irvine-1", nodeType: "LHT65N", channels: [3] },
  { devEui: "FILL_ME_4", nodeType: "LTC2", channels: [4, 5] }, // Walk-in Cooler, AC Dining
  { devEui: "FILL_ME_5", nodeType: "LTC2", channels: [6, 7] }, // AC Kitchen, AC Drive Thru
];

const LOCATIONS = [
  { name: "Burger King #1025", slug: "teaneck", address: "863 Cedar Ln", city: "Teaneck", zip: "07666", lat: 40.8976, lng: -74.016, gatewayEui: "A84041FFFF29BA77", sensors: TEANECK_SENSORS },
  { name: "Burger King #2741", slug: "hackensack", address: "410 Main St", city: "Hackensack", zip: "07601", lat: 40.8859, lng: -74.0435, sensors: placeholderPlan(6) },
  { name: "Burger King #1889", slug: "englewood", address: "35 Nathaniel Pl", city: "Englewood", zip: "07631", lat: 40.8929, lng: -73.9726, sensors: placeholderPlan(11) },
  { name: "Burger King #1120", slug: "fort-lee", address: "2160 Lemoine Ave", city: "Fort Lee", zip: "07024", lat: 40.8509, lng: -73.9701, sensors: placeholderPlan(16) },
  { name: "Burger King #1983", slug: "paramus", address: "240 Route 17 N", city: "Paramus", zip: "07652", lat: 40.9445, lng: -74.0754, sensors: placeholderPlan(21) },
];

async function main() {
  const plannedEuis = new Set<string>();

  for (const l of LOCATIONS) {
    const location = await prisma.location.upsert({
      where: { name: l.name },
      update: { address: l.address, city: l.city, state: "NJ", zip: l.zip, lat: l.lat, lng: l.lng },
      create: {
        name: l.name,
        address: l.address,
        city: l.city,
        state: "NJ",
        zip: l.zip,
        lat: l.lat,
        lng: l.lng,
        timezone: "America/New_York",
      },
    });

    await prisma.gateway.upsert({
      where: { ttnGatewayId: `lps8n-${l.slug}` },
      update: { locationId: location.id, ...(l.gatewayEui ? { eui: l.gatewayEui } : {}) },
      create: { ttnGatewayId: `lps8n-${l.slug}`, eui: l.gatewayEui ?? null, locationId: location.id },
    });

    const units = [];
    for (const u of UNITS) {
      const [rangeMinF, rangeMaxF] = DEFAULT_RANGE[u.type];
      units.push(
        await prisma.unit.upsert({
          where: { locationId_name: { locationId: location.id, name: u.name } },
          update: { type: u.type, model: u.model, year: u.year },
          create: {
            locationId: location.id,
            name: u.name,
            type: u.type,
            model: u.model,
            serial: `${l.slug.toUpperCase().slice(0, 3)}-${u.name.replace(/\W+/g, "").slice(0, 6).toUpperCase()}-${u.year ?? "0000"}`,
            year: u.year,
            rangeMinF,
            rangeMaxF,
          },
        }),
      );
    }

    for (const s of l.sensors) {
      plannedEuis.add(s.devEui);
      const sensor = await prisma.sensor.upsert({
        where: { devEui: s.devEui },
        update: {
          locationId: location.id,
          ttnDeviceId: s.ttnDeviceId ?? null,
          expectedIntervalSec: s.expectedIntervalSec ?? 300,
          // nodeType is left alone on update — real uplinks own it
        },
        create: {
          devEui: s.devEui,
          ttnDeviceId: s.ttnDeviceId ?? null,
          nodeType: s.nodeType,
          expectedIntervalSec: s.expectedIntervalSec ?? 300,
          locationId: location.id,
        },
      });

      const channelNos: number[] = [];
      for (let i = 0; i < s.channels.length; i++) {
        const channel = i + 1;
        const unitIdx = s.channels[i];
        channelNos.push(channel);
        await prisma.sensorChannel.upsert({
          where: { sensorId_channel: { sensorId: sensor.id, channel } },
          update: { unitId: unitIdx === null ? null : units[unitIdx].id },
          create: { sensorId: sensor.id, channel, unitId: unitIdx === null ? null : units[unitIdx].id },
        });
      }
      // e.g. a sensor that used to be LTC2 and is now LHT65N loses its channel 2
      await prisma.sensorChannel.deleteMany({ where: { sensorId: sensor.id, channel: { notIn: channelNos } } });
    }

    console.log(`✓ ${l.name} (${l.city}) — ${units.length} units, ${l.sensors.length} sensors`);
  }

  // Placeholders that fell out of the plan (never report, so they have no readings)
  const stale = await prisma.sensor.findMany({
    where: { devEui: { startsWith: "FILL_ME_" }, NOT: { devEui: { in: [...plannedEuis] } } },
    select: { id: true, devEui: true },
  });
  if (stale.length) {
    const ids = stale.map((s) => s.id);
    await prisma.sensorChannel.deleteMany({ where: { sensorId: { in: ids } } });
    await prisma.sensor.deleteMany({ where: { id: { in: ids }, readings: { none: {} } } });
    console.log(`– removed stale placeholders: ${stale.map((s) => s.devEui).join(", ")}`);
  }

  // Optional first admin for local/demo environments — only when both variables are set.
  if (process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD) {
    const email = process.env.SEED_ADMIN_EMAIL.trim().toLowerCase();
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: "Admin",
        passwordHash: await hashPassword(process.env.SEED_ADMIN_PASSWORD),
        role: "admin",
        emailVerifiedAt: new Date(),
      },
    });
    console.log(`✓ admin user ${email} (verified)`);
  }

  const counts = {
    locations: await prisma.location.count(),
    gateways: await prisma.gateway.count(),
    units: await prisma.unit.count(),
    sensors: await prisma.sensor.count(),
    channels: await prisma.sensorChannel.count({ where: { unitId: { not: null } } }),
  };
  console.log("Seed complete:", counts);
  console.log("Real devices (Teaneck): draginotst2 LTC2 → Freezer - Back / Freezer - Front; draginotst LHT65N → Reach-in Freezer; dragino-irvine-1 LHT65N → Walk-in Freezer");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
