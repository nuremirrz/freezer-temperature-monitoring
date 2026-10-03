import "./load-env";
import { createInterface } from "node:readline";

/**
 * Fill the outdoor-temperature history for every open restaurant from Open-Meteo, hourly.
 *
 *   npm run weather:backfill                  # the last 365 days, local database
 *   npm run weather:backfill -- --days 30
 *   npm run weather:backfill -- --prod        # asks for the production URL, typed blind
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

/** A line typed without echo, so a database URL never lands on the screen or in history. */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // readline has no "silent" mode; muting its echo is the documented way around that
    const r = rl as unknown as { _writeToOutput: (s: string) => void };
    const echo = r._writeToOutput;
    process.stdout.write(prompt);
    r._writeToOutput = () => {};
    rl.question("", (answer) => {
      r._writeToOutput = echo;
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

if (args.includes("--prod")) {
  const url = await askHidden("Paste the production database URL and press Enter (nothing will show): ");
  if (!/^postgres(ql)?:\/\//.test(url)) {
    console.error(`That is not a database URL (${url.length} characters read). Nothing was done.`);
    process.exit(2);
  }
  process.env.DATABASE_URL = url;
  console.log(`\u001b[33m⚠ REMOTE db\u001b[0m → ${/@([^/?]+)/.exec(url)?.[1]}`);
}

// Imported only now: the client reads DATABASE_URL the moment it is created
const { prisma } = await import("../src/lib/db");
const { backfillWeather } = await import("../src/lib/weather/store");

console.log(`last ${days} days, by the hour`);
const rows = await backfillWeather(prisma, Date.now() - days * 86_400_000);
for (const r of rows) console.log(`  ${r.name}: ${r.fetched} hours fetched, ${r.stored} new`);
if (!rows.length) console.log("  no open restaurants");
await prisma.$disconnect();
