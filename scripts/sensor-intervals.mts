import "./load-env";
import { prodIfAsked } from "./prod-url";
import { offlineAfterSec } from "../src/lib/alerts/rules";

/**
 * Compares how often each sensor actually reports against how often we expect it to.
 *
 *   npm run sensors:intervals
 *   npm run sensors:intervals -- --prod    # the production database; asks for the URL, typed blind
 *
 * The expected figure comes from data/sensors.csv and drives one thing only: when a sensor
 * counts as offline (3 × interval + 60 s). It does not configure the device — the device's
 * own transmit interval is set on the device.
 *
 * When the two disagree the alert is wrong in one of two ways, and both are bad. Expect too
 * often and every reporting cycle opens a false offline alert: bk6399-whitter-ac1 sent one
 * every 20 minutes for two days, 137 of them, because we expected 5. Expect too rarely and a
 * genuinely dead sensor goes unnoticed for hours.
 *
 * Two figures, because they answer two different questions. The median gap says how the device
 * behaves normally, and a threshold at or below it means every cycle raises a false alarm. The
 * worst gap says whether it ever went quiet long enough to raise one anyway — and that is the
 * figure the median is built to hide. San Bernardino's walk-in sensor sent a false offline alert
 * every twenty minutes for a morning while its median sat at a healthy five.
 *
 * Both are measured between uplinks, not between rows: a device with two probes wired to two
 * units writes two readings at the same instant, and counting that pair as a gap of zero put the
 * median at zero and the verdict at a tick.
 */

const WINDOW_H = 24;
const MAX_ROWS = 2000;

await prodIfAsked();
// Imported only now: the client reads DATABASE_URL the moment it is created
const { prisma } = await import("../src/lib/db");

const sensors = await prisma.sensor.findMany({
  include: { location: true },
  orderBy: [{ locationId: "asc" }, { ttnDeviceId: "asc" }],
});

let problems = 0;
let worstOverall: string | null = null;
console.log(`Промежутки между пакетами за последние ${WINDOW_H} ч.\n`);
console.log(
  `${"датчик".padEnd(34)}${"ресторан".padEnd(10)}${"ждём".padEnd(9)}${"обычно".padEnd(9)}${"худший".padEnd(11)}${"порог".padEnd(10)}вердикт`,
);

for (const s of sensors) {
  const rows = await prisma.reading.findMany({
    where: { sensorId: s.id, measuredAt: { gte: new Date(Date.now() - WINDOW_H * 3600_000) } },
    orderBy: { measuredAt: "desc" },
    take: MAX_ROWS,
    select: { measuredAt: true },
    distinct: ["measuredAt"],
  });
  const name = (s.ttnDeviceId ?? s.devEui).padEnd(34);
  if (rows.length < 5) {
    console.log(`${name}${s.location.name.slice(-4).padEnd(10)}— мало данных за ${WINDOW_H} ч`);
    continue;
  }
  const gaps: { min: number; endedAt: Date }[] = [];
  for (let i = 1; i < rows.length; i++) {
    gaps.push({ min: (rows[i - 1].measuredAt.getTime() - rows[i].measuredAt.getTime()) / 6e4, endedAt: rows[i - 1].measuredAt });
  }
  const sorted = [...gaps].sort((a, b) => a.min - b.min);
  const observed = sorted[sorted.length >> 1].min;
  const worst = sorted[sorted.length - 1];
  const expected = s.expectedIntervalSec / 60;
  const threshold = offlineAfterSec(s.expectedIntervalSec) / 60;

  // Два разных перекоса. Порог ниже обычного шага — тревога звенит каждый цикл. Порог выше
  // обычного шага, но провалы его перебивают — тревога звенит столько раз, сколько было провалов.
  const stepTooFast = threshold <= observed * 1.2;
  const dropouts = gaps.filter((g) => g.min > threshold).length;
  const bad = stepTooFast || dropouts > 0;
  if (bad) problems++;

  if (dropouts && !stepTooFast) {
    worstOverall = `${(s.ttnDeviceId ?? s.devEui)} — ${worst.min.toFixed(0)} мин, закончился ${worst.endedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
  const verdict = stepTooFast
    ? "✗ порог ниже реального шага — ложные offline каждый цикл"
    : dropouts
      ? `✗ провалов сверх порога: ${dropouts} — столько же ложных offline`
      : "✓";
  console.log(
    `${name}${s.location.name.slice(-4).padEnd(10)}` +
      `${(expected.toFixed(0) + " мин").padEnd(9)}${(observed.toFixed(0) + " мин").padEnd(9)}` +
      `${(worst.min.toFixed(0) + " мин").padEnd(11)}${(threshold.toFixed(0) + " мин").padEnd(10)}` +
      verdict,
  );
}

console.log(
  problems
    ? `\n✗ Датчиков с проблемой: ${problems}.\n  «порог ниже реального шага» — поправь 5-й столбец в data/sensors.csv и прогони npm run sensors:import\n  «провалов сверх порога» — ожидание верное, но связь рвалась; смотри время последнего провала: ${worstOverall ?? "—"}`
    : `\n✓ У всех датчиков ожидаемый интервал согласован с реальным.`,
);
await prisma.$disconnect();
process.exit(problems ? 1 : 0);
