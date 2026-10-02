import "./load-env";
import { prisma } from "../src/lib/db";

/**
 * Takes every probe off a unit and, if asked, forgets what those probes wrote.
 *
 *   npm run unit:detach -- --location "Burger King #6399" --unit "AC2 - Kitchen"
 *   npm run unit:detach -- --location "Burger King #6399" --unit "AC2 - Kitchen" --purge --yes
 *
 * For a unit whose probe is wrong — Whittier's AC2 and AC3 shipped with one probe, and their
 * second channel reports the inside of the device's own box, which was being shown as the
 * room. Detached, the unit reads Offline, which is the honest state until the right probe is
 * fitted. --purge deletes the unit's readings and alerts too, because numbers from the wrong
 * place are worse than no numbers. Without --yes nothing is written.
 */

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
const locationName = arg("--location");
const unitName = arg("--unit");
const purge = process.argv.includes("--purge");
const yes = process.argv.includes("--yes");
if (!locationName || !unitName) {
  console.error('Нужны оба:  npm run unit:detach -- --location "Burger King #6399" --unit "AC2 - Kitchen" [--purge] [--yes]');
  process.exit(1);
}

const unit = await prisma.unit.findFirst({
  where: { name: unitName, location: { name: locationName } },
  include: { channels: { include: { sensor: { select: { devEui: true } } } }, _count: { select: { readings: true, alerts: true } } },
});
if (!unit) {
  console.error(`Нет юнита "${unitName}" в "${locationName}"`);
  process.exit(1);
}
console.log(`${locationName} · ${unit.name}`);
console.log(`  щупов привязано: ${unit.channels.length}${unit.channels.map((c) => `  ${c.sensor.devEui} ch${c.channel}`).join("")}`);
console.log(`  показаний: ${unit._count.readings}, алертов: ${unit._count.alerts}`);

if (!yes) {
  console.log(`\nПробный прогон. С --yes: отвязать щупы${purge ? ", удалить показания и алерты" : ""}.`);
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.$transaction(async (tx) => {
  const ch = await tx.sensorChannel.updateMany({ where: { unitId: unit.id }, data: { unitId: null } });
  console.log(`\n  отвязано щупов: ${ch.count}`);
  if (purge) {
    const a = await tx.alert.deleteMany({ where: { unitId: unit.id } });
    const r = await tx.reading.deleteMany({ where: { unitId: unit.id } });
    console.log(`  удалено показаний: ${r.count}, алертов: ${a.count}`);
  }
});
console.log(`  юнит теперь Offline, пока щуп не привяжут снова через data/sensors.csv`);
await prisma.$disconnect();
