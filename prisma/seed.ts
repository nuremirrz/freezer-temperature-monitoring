import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { UnitType } from "../src/generated/prisma/client";

/**
 * Pilot seed: 5 northern-NJ locations (Teaneck and neighbours), 1 gateway + 5 sensors each,
 * 8 units per location wired to sensor channels. Idempotent — safe to re-run.
 *
 * Sensor EUIs are placeholders (FILL_ME_n) except Teaneck sensor #1, which is the real test
 * device from the TTN fixture so `npm run fixture` lands as readings right away.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

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
  serial?: string;
  year?: number;
}

// Sensor n → [channel1 unit index, channel2 unit index] (null = probe not connected)
const CHANNEL_MAP: [number | null, number | null][] = [
  [0, 1], // Freezer - Back, Freezer - Front
  [2, 3], // Reach-in Freezer, Walk-in Freezer
  [4, null], // Walk-in Cooler, spare probe
  [5, 6], // AC Dining, AC Kitchen
  [7, null], // AC Drive Thru, spare probe
];

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

const LOCATIONS = [
  { name: "Burger King #1025", slug: "teaneck", address: "863 Cedar Ln", city: "Teaneck", zip: "07666", lat: 40.8976, lng: -74.016, gatewayEui: "A84041FFFF29BA77" },
  { name: "Burger King #2741", slug: "hackensack", address: "410 Main St", city: "Hackensack", zip: "07601", lat: 40.8859, lng: -74.0435 },
  { name: "Burger King #1889", slug: "englewood", address: "35 Nathaniel Pl", city: "Englewood", zip: "07631", lat: 40.8929, lng: -73.9726 },
  { name: "Burger King #1120", slug: "fort-lee", address: "2160 Lemoine Ave", city: "Fort Lee", zip: "07024", lat: 40.8509, lng: -73.9701 },
  { name: "Burger King #1983", slug: "paramus", address: "240 Route 17 N", city: "Paramus", zip: "07652", lat: 40.9445, lng: -74.0754 },
];

// The real test device from fixtures/ttn-uplink.json
const FIXTURE_SENSOR = { devEui: "A84041784362379C", ttnDeviceId: "draginotst2" };

async function main() {
  let sensorNo = 0;

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

    for (let i = 0; i < CHANNEL_MAP.length; i++) {
      sensorNo++;
      const isFixtureDevice = sensorNo === 1;
      const devEui = isFixtureDevice ? FIXTURE_SENSOR.devEui : `FILL_ME_${sensorNo}`;

      const sensor = await prisma.sensor.upsert({
        where: { devEui },
        update: { locationId: location.id },
        create: {
          devEui,
          ttnDeviceId: isFixtureDevice ? FIXTURE_SENSOR.ttnDeviceId : null,
          locationId: location.id,
        },
      });

      const [c1, c2] = CHANNEL_MAP[i];
      for (const [channel, unitIdx] of [
        [1, c1],
        [2, c2],
      ] as const) {
        await prisma.sensorChannel.upsert({
          where: { sensorId_channel: { sensorId: sensor.id, channel } },
          update: { unitId: unitIdx === null ? null : units[unitIdx].id },
          create: { sensorId: sensor.id, channel, unitId: unitIdx === null ? null : units[unitIdx].id },
        });
      }
    }

    console.log(`✓ ${l.name} (${l.city}) — ${units.length} units, 5 sensors`);
  }

  const counts = {
    locations: await prisma.location.count(),
    gateways: await prisma.gateway.count(),
    units: await prisma.unit.count(),
    sensors: await prisma.sensor.count(),
    channels: await prisma.sensorChannel.count({ where: { unitId: { not: null } } }),
  };
  console.log("Seed complete:", counts);
  console.log(`Fixture device ${FIXTURE_SENSOR.devEui} is wired to Teaneck (Freezer - Back / Freezer - Front).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
