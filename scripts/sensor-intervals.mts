import "./load-env";
import { prisma } from "../src/lib/db";
import { offlineAfterSec } from "../src/lib/alerts/rules";

/**
 * Compares how often each sensor actually reports against how often we expect it to.
 *
 *   npm run sensors:intervals
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
 * The observed figure is the median gap over recent readings — a median so one lost packet
 * does not double the answer.
 */

const SAMPLE = 30;

const sensors = await prisma.sensor.findMany({
  include: { location: true },
  orderBy: [{ locationId: "asc" }, { ttnDeviceId: "asc" }],
});

let problems = 0;
console.log(
  `${"датчик".padEnd(22)}${"ресторан".padEnd(10)}${"ждём".padEnd(9)}${"шлёт".padEnd(9)}${"offline через".padEnd(15)}вердикт`,
);

for (const s of sensors) {
  const rows = await prisma.reading.findMany({
    where: { sensorId: s.id },
    orderBy: { measuredAt: "desc" },
    take: SAMPLE,
    select: { measuredAt: true },
  });
  if (rows.length < 5) {
    console.log(`${(s.ttnDeviceId ?? s.devEui).padEnd(22)}${s.location.name.slice(-4).padEnd(10)}— мало данных`);
    continue;
  }
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    gaps.push((rows[i - 1].measuredAt.getTime() - rows[i].measuredAt.getTime()) / 6e4);
  }
  gaps.sort((a, b) => a - b);
  const observed = gaps[gaps.length >> 1];
  const expected = s.expectedIntervalSec / 60;
  const threshold = offlineAfterSec(s.expectedIntervalSec) / 60;

  // Порог должен быть заметно больше реального шага, иначе тревога срабатывает сама по себе.
  const bad = threshold <= observed * 1.2;
  if (bad) problems++;

  console.log(
    `${(s.ttnDeviceId ?? s.devEui).padEnd(22)}${s.location.name.slice(-4).padEnd(10)}` +
      `${(expected.toFixed(0) + " мин").padEnd(9)}${(observed.toFixed(0) + " мин").padEnd(9)}` +
      `${(threshold.toFixed(0) + " мин").padEnd(15)}` +
      (bad ? `✗ порог ниже реального шага — ложные offline` : "✓"),
  );
}

console.log(
  problems
    ? `\n✗ Датчиков с неверным ожиданием: ${problems}. Поправь 5-й столбец в data/sensors.csv и прогони npm run sensors:import`
    : `\n✓ У всех датчиков ожидаемый интервал согласован с реальным.`,
);
await prisma.$disconnect();
process.exit(problems ? 1 : 0);
