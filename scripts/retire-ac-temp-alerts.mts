import "./load-env";
import { prodIfAsked } from "./prod-url";

/**
 * Closes the temp-out-of-range alerts that air conditioners are still holding.
 *
 *   npm run alerts:retire-ac                     # report only
 *   npm run alerts:retire-ac -- --apply          # close them
 *   npm run alerts:retire-ac -- --apply --prod   # the production database, URL typed blind
 *
 * Why this is needed once. Until the AC cooling rule, an air conditioner raised the same alert
 * a freezer does: the room left its band for an hour. It no longer does — an AC is judged by
 * the drop across it instead (src/lib/alerts/cooling.ts), and the new rule only ever opens and
 * closes `not_cooling`. So nothing will ever look at an AC's old temp alert again: it would
 * stay open for good, keeping the unit red on every screen and the restaurant red behind it.
 *
 * Closing them is not hiding a fault. Any AC that is genuinely not cooling gets a fresh
 * `not_cooling` alert within forty-five minutes of the next uplink, with its own message. This
 * run is the "closed and reopened by the new logic" step, and the alerts stay in history —
 * resolved, not deleted.
 *
 * It sends no notifications: these are not recoveries anyone should be told about. Run it in
 * the same sitting as the deploy, so no AC sits red in between.
 */

const apply = process.argv.includes("--apply");
await prodIfAsked();
// Imported only now: the client reads DATABASE_URL the moment it is created
const { prisma } = await import("../src/lib/db");

const open = await prisma.alert.findMany({
  where: { type: "temp_out_of_range", resolvedAt: null, unit: { type: "ac" } },
  include: { unit: { select: { name: true, location: { select: { name: true } } } } },
  orderBy: { openedAt: "asc" },
});

if (!open.length) {
  console.log("Открытых temp-алертов на кондиционерах нет — закрывать нечего.");
} else {
  const now = new Date();
  const days = (d: Date) => ((now.getTime() - d.getTime()) / 86_400_000).toFixed(1);
  console.log(`${"ресторан · юнит".padEnd(44)} ${"открыт".padStart(12)} ${"дней".padStart(6)}   пик`);
  for (const a of open) {
    const where = `${a.unit.location.name} · ${a.unit.name}`;
    const peak = a.peakTempF === null ? "—" : `${a.peakTempF.toFixed(1)}°F`;
    console.log(
      `${where.padEnd(44)} ${a.openedAt.toISOString().slice(0, 10).padStart(12)} ${days(a.openedAt).padStart(6)}   ${peak}`,
    );
  }

  if (!apply) {
    console.log(`\n${open.length} алерт(ов) будет закрыто. Это отчёт — добавь --apply, чтобы закрыть.`);
  } else {
    const { count } = await prisma.alert.updateMany({
      where: { id: { in: open.map((a) => a.id) } },
      data: { resolvedAt: now },
    });
    console.log(`\nЗакрыто: ${count}. Уведомления не отправлялись.`);
    console.log("Кондиционер, который действительно не холодит, поднимет not_cooling в течение 45 минут.");
  }
}

await prisma.$disconnect();
