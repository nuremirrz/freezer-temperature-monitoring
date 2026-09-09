import "dotenv/config";
import { runOfflineCheck } from "../src/lib/alerts/service";
import { prisma } from "../src/lib/db";

/**
 * One pass of the offline check — for cron / a process manager when the Next.js server
 * runs with OFFLINE_CHECK_DISABLED=1 (e.g. `* * * * * cd /app && npx tsx scripts/offline-check.mts`).
 */
const result = await runOfflineCheck();
console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
await prisma.$disconnect();
