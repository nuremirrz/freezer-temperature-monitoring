import "./load-env";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { BACKUP_MODELS, BACKED_UP_MODELS, type BackupMeta } from "../src/lib/backup/manifest";

/**
 * Writes a backup folder into a database.
 *
 *   npm run db:restore -- --from backups/qimby-… --to postgres://…/qimby --yes
 *
 * The target is never taken from DATABASE_URL. On this machine that variable points at
 * production, and a restore is the one operation where that default would be unrecoverable —
 * so it has to be named on the command line, every time.
 *
 * Three refusals stand in the way of the obvious accidents: restoring onto the host the backup
 * came from, restoring onto a schema older than the data, and restoring into a database that
 * already has rows. Each can be overridden deliberately; none can be tripped over.
 */

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const has = (name: string): boolean => process.argv.includes(name);

const from = arg("--from");
const to = arg("--to");
const confirmed = has("--yes");

if (!from || !to) {
  console.error("Нужны оба пути:  npm run db:restore -- --from <папка> --to <URL> --yes");
  process.exit(1);
}

const meta = JSON.parse(await readFile(path.join(from, "meta.json"), "utf8")) as BackupMeta;
const targetHost = /@([^/?]+)/.exec(to)?.[1] ?? "unknown";
const expected = Object.values(meta.counts).reduce((a, b) => a + b, 0);

console.log(`копия:  ${from}`);
console.log(`снята:  ${meta.takenAt} с ${meta.sourceHost}`);
console.log(`строк:  ${expected}`);
if (meta.skipped && Object.keys(meta.skipped).length) {
  console.log(`пропущено при съёме: ${Object.keys(meta.skipped).join(", ")} — все войдут заново`);
}
console.log(`схема:  ${meta.lastMigration ?? "—"}`);
console.log(`\nкуда:   ${targetHost}\n`);

if (targetHost === meta.sourceHost && !has("--force-same-host")) {
  console.error(`Отказ: это тот самый сервер, с которого снята копия.`);
  console.error(`Если ты правда восстанавливаешь поверх источника, добавь --force-same-host.`);
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: to });
const db = new PrismaClient({ adapter });

const applied = await db.$queryRawUnsafe<{ migration_name: string }[]>(
  `select migration_name from _prisma_migrations where finished_at is not null`,
).catch(() => {
  console.error(`Отказ: в целевой базе нет таблиц. Сначала создай схему:`);
  console.error(`  DATABASE_URL="${to}" npx prisma migrate deploy`);
  process.exit(1);
});

if (meta.lastMigration && !applied.some((m) => m.migration_name === meta.lastMigration)) {
  console.error(`Отказ: целевая схема не знает миграцию ${meta.lastMigration}.`);
  console.error(`Данные новее схемы — часть столбцов потерялась бы молча. Накати миграции:`);
  console.error(`  DATABASE_URL="${to}" npx prisma migrate deploy`);
  process.exit(1);
}

const existing: Record<string, number> = {};
for (const m of BACKUP_MODELS) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  existing[m.name] = await (db as any)[m.delegate].count();
}
const occupied = Object.entries(existing).filter(([, n]) => n > 0);

if (occupied.length && !has("--wipe")) {
  console.error(`Отказ: в целевой базе уже есть данные —`);
  for (const [name, n] of occupied) console.error(`  ${name}: ${n}`);
  console.error(`\nДобавь --wipe, чтобы очистить эти таблицы перед восстановлением.`);
  process.exit(1);
}

if (!confirmed) {
  console.log(`Пробный прогон: всё проверено, ничего не записано. Повтори с --yes.`);
  await db.$disconnect();
  process.exit(0);
}

if (occupied.length) {
  // Reverse order: children before the rows they point at.
  for (const m of [...BACKUP_MODELS].reverse()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)[m.delegate].deleteMany({});
  }
  console.log(`Целевые таблицы очищены.\n`);
}

const CHUNK = 1_000;
let written = 0;

const missing: string[] = [];

for (const model of BACKED_UP_MODELS) {
  const file = path.join(from, `${model.name}.ndjson.gz`);
  // An older copy has no file for a table that did not exist when it was taken. That is not a
  // damaged backup, it is an honest one — the table stays empty and the restore goes on.
  if (!existsSync(file)) {
    missing.push(model.name);
    console.log(`  · ${model.name.padEnd(16)} нет в копии — таблица останется пустой`);
    continue;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (db as any)[model.delegate];
  let buffer: unknown[] = [];
  let n = 0;

  const flush = async (): Promise<void> => {
    if (!buffer.length) return;
    // Prisma takes ISO-8601 strings for DateTime columns, so rows go back exactly as exported.
    await delegate.createMany({ data: buffer });
    n += buffer.length;
    buffer = [];
  };

  const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    buffer.push(JSON.parse(line));
    if (buffer.length >= CHUNK) await flush();
  }
  await flush();

  const expectedRows = meta.counts[model.name] ?? 0;
  const mark = n === expectedRows ? "✓" : "✗";
  console.log(`  ${mark} ${model.name.padEnd(16)} ${String(n).padStart(7)} из ${expectedRows}`);
  if (n !== expectedRows) {
    console.error(`\nОстановлено: записалось не всё. База в промежуточном состоянии.`);
    await db.$disconnect();
    process.exit(1);
  }
  written += n;
}

console.log(`\n✓ Восстановлено строк: ${written} из ${expected}`);
if (missing.length) {
  console.log(`Копия старее текущей схемы, пустыми остались: ${missing.join(", ")}`);
}
await db.$disconnect();
