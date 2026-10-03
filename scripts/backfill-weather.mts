import "./load-env";
import { prisma } from "../src/lib/db";
import { backfillWeather } from "../src/lib/weather/store";

/**
 * Fill the outdoor-temperature history for every open restaurant from Open-Meteo, hourly.
 *
 *   npm run weather:backfill                 # the last 365 days
 *   npm run weather:backfill -- --days 30
 *
 * Safe to repeat: an hour already stored stays as it is. The minute loop keeps the store
 * current from here on; this is for the past, and for a gap after the site was down.
 */
const args = process.argv.slice(2);
const daysArg = args.indexOf("--days");
const days = daysArg >= 0 ? Number(args[daysArg + 1]) : 365;
if (!Number.isFinite(days) || days <= 0 || days > 366) {
  console.error("--days must be between 1 and 366");
  process.exit(2);
}

const host = /@([^/?]+)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "";
console.log(`db → ${host}; last ${days} days, by the hour`);
const rows = await backfillWeather(prisma, Date.now() - days * 86_400_000);
for (const r of rows) console.log(`  ${r.name}: ${r.fetched} hours fetched, ${r.stored} new`);
if (!rows.length) console.log("  no open restaurants");
await prisma.$disconnect();
