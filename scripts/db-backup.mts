import "./load-env";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { BACKUP_MODELS, assertModelsCoverSchema, type BackupMeta } from "../src/lib/backup/manifest";

/**
 * Writes every row in the database to a folder of gzipped NDJSON, one file per table.
 *
 *   npm run db:backup                     # into backups/<timestamp>/
 *   npm run db:backup -- --out /some/dir
 *
 * Why not pg_dump: the schema already lives in git as Prisma migrations, so a copy of the data
 * is a complete backup — restore is `prisma migrate deploy` and then `npm run db:restore`. That
 * removes the one thing a dump normally drags along, a pg_dump binary matching the server's
 * major version, and it makes the result readable: NDJSON converts to CSV in one line, which is
 * the same file the client keeps asking about for Google Sheets.
 *
 * Rows are streamed in pages, so this stays flat in memory as the readings pile up.
 */

const PAGE = 5_000;

const outFlag = process.argv.indexOf("--out");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
const outDir = outFlag > -1 ? process.argv[outFlag + 1] : path.join("backups", `qimby-${stamp}`);

await assertModelsCoverSchema();
await mkdir(outDir, { recursive: true });

const url = process.env.DATABASE_URL ?? "";
const host = /@([^/?]+)/.exec(url)?.[1] ?? "unknown";
console.log(`источник: ${host}`);
console.log(`куда:     ${outDir}\n`);

const counts: Record<string, number> = {};
const skipped: Record<string, number> = {};

for (const model of BACKUP_MODELS) {
  if (model.ephemeral) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    skipped[model.name] = await (prisma as any)[model.delegate].count();
    console.log(`  ${model.name.padEnd(16)} ${String(skipped[model.name]).padStart(7)} строк — пропущено намеренно`);
    continue;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prisma as any)[model.delegate];
  const total: number = await delegate.count();
  const file = path.join(outDir, `${model.name}.ndjson.gz`);

  async function* rows(): AsyncGenerator<string> {
    let cursor: Record<string, unknown> | undefined;
    for (;;) {
      const page = await delegate.findMany({
        take: PAGE,
        orderBy: { [model.cursor]: "asc" },
        ...(cursor ? { cursor, skip: 1 } : {}),
      });
      if (!page.length) return;
      // One JSON object per line: appendable, streamable, and readable without a parser.
      yield page.map((r: unknown) => JSON.stringify(r)).join("\n") + "\n";
      if (page.length < PAGE) return;
      cursor = { [model.cursor]: page[page.length - 1][model.cursor] };
    }
  }

  await pipeline(Readable.from(rows()), createGzip(), createWriteStream(file));
  counts[model.name] = total;
  console.log(`  ${model.name.padEnd(16)} ${String(total).padStart(7)} строк`);
}

const migrations = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
  `select migration_name from _prisma_migrations where finished_at is not null
   order by finished_at desc limit 1`,
);
const version = await prisma.$queryRawUnsafe<{ version: string }[]>("select version()");

const meta: BackupMeta = {
  takenAt: new Date().toISOString(),
  sourceHost: host, // host only — never the credentials in DATABASE_URL
  postgres: version[0].version.split(",")[0],
  lastMigration: migrations[0]?.migration_name ?? null,
  counts,
  skipped,
};
await writeFile(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`\nВсего строк: ${total}`);
if (Object.keys(skipped).length) {
  console.log(`Не попало в копию: ${Object.entries(skipped).map(([k, v]) => `${k} (${v})`).join(", ")} — живые ключи входа`);
}
console.log(`Последняя миграция: ${meta.lastMigration ?? "—"}`);
console.log(`\nВосстановить:  npm run db:restore -- --from ${outDir} --to <URL>`);
await prisma.$disconnect();
