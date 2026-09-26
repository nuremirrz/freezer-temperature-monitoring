import "./load-env";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { prisma } from "../src/lib/db";
import { parseTtnUplink } from "../src/lib/ttn/parse";

/**
 * Replays uplinks from TTN's Message Storage into our database.
 *
 *   TTN_API_KEY=… npm run recover:ttn                        # fetch all TTN holds, save to disk, dry run
 *   TTN_API_KEY=… npm run recover:ttn -- --yes               # same, and write to the database
 *   npm run recover:ttn -- --load backups/ttn-….ndjson --yes  # replay a saved file, no TTN needed
 *
 * For when our side was down and the webhooks fell on the floor. TTN does not retry a failed
 * webhook, but the Storage integration keeps uplinks for a while — the docs say 24 hours on the
 * Sandbox, the console has shown more — so an outage shorter than that loses nothing, provided
 * the messages are pulled before the window closes. Pulling and writing are separate steps on
 * purpose: every fetch is saved to disk first, so the TTN clock and the database clock stop
 * being the same deadline. The saved file holds production readings; it lives under backups/,
 * which git ignores, and is deleted when it has served.
 *
 * Writing runs the packets through the same parser and the same AC room/duct rule as the live
 * ingest. The unique key on (sensor, channel, measuredAt) makes it safe to run twice: whatever
 * the live path did record is skipped, not doubled. Recovered readings raise no alerts — a storm
 * of yesterday's warnings helps nobody — and each sensor's "last seen" is moved forward so the
 * offline check stops mourning devices that were talking all along.
 */

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
const APP = arg("--app") ?? "bk-la-qimby";
const HOST = arg("--host") ?? "nam1.cloud.thethings.network";
const loadFrom = arg("--load");
const afterArg = arg("--after");
const before = arg("--before");
const write = process.argv.includes("--yes");
const KEY = process.env.TTN_API_KEY;
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
const saveTo = arg("--save") ?? `backups/ttn-uplinks-${stamp}.ndjson`;

for (const t of [afterArg, before]) if (t && Number.isNaN(Date.parse(t))) { console.error(`не похоже на время: ${t}`); process.exit(1); }

interface Stored { result: { end_device_ids: { device_id: string; dev_eui: string }; received_at: string; uplink_message: unknown } }
type Record_ = Stored["result"];
let records: Record_[] = [];

if (loadFrom) {
  // ---- 1a. replay from a file saved by an earlier run ----
  const text = await readFile(loadFrom, "utf8");
  records = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Record_);
  const afterMs = afterArg ? Date.parse(afterArg) : -Infinity;
  const beforeMs = before ? Date.parse(before) : Infinity;
  records = records.filter((r) => { const t = Date.parse(r.received_at); return t >= afterMs && t < beforeMs; });
  console.log(`из файла ${loadFrom}: ${records.length} пакетов${afterArg || before ? " в заданном окне" : ""}`);
} else {
  // ---- 1b. fetch everything TTN still holds ----
  if (!KEY) { console.error("Нужен TTN_API_KEY в окружении (права ключа: Read application traffic), или --load <файл>"); process.exit(1); }
  // Ask from a week back: TTN answers with whatever it actually kept.
  const after = afterArg ?? new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  console.log(`TTN ${APP} @ ${HOST}, запрашиваю с ${after}${before ? ` по ${before}` : ""}`);
  const seen = new Set<string>();
  let cursor = after;
  const LIMIT = 1000;
  // Pages until a page brings nothing new. Not "until a short page": TTN may cap `limit` below
  // what we asked, and a short first page would then look like the end of the data.
  for (let page = 1; page <= 500; page++) {
    const url = new URL(`https://${HOST}/api/v3/as/applications/${APP}/packages/storage/uplink_message`);
    url.searchParams.set("after", cursor);
    if (before) url.searchParams.set("before", before);
    url.searchParams.set("limit", String(LIMIT));
    url.searchParams.set("order", "received_at");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}`, Accept: "text/event-stream" } });
    if (!res.ok) {
      console.error(`TTN ответил ${res.status}: ${(await res.text()).slice(0, 300)}`);
      process.exit(1);
    }
    const fresh: Record_[] = [];
    for (const line of (await res.text()).split("\n")) {
      if (!line.trim()) continue;
      const r = (JSON.parse(line) as Stored).result;
      const key = `${r.end_device_ids.dev_eui}|${r.received_at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(r);
    }
    if (!fresh.length) break;
    records.push(...fresh);
    process.stdout.write(`  страница ${page}: +${fresh.length}\r`);
    const newest = fresh.reduce((m, r) => (r.received_at > m ? r.received_at : m), cursor);
    if (newest <= cursor) break;
    cursor = newest;
  }
  if (!records.length) {
    console.log(`TTN ничего не хранит после ${after}: либо окно уже закрылось, либо ключ смотрит не в то приложение`);
    process.exit(0);
  }
  records.sort((a, b) => a.received_at.localeCompare(b.received_at));
  await mkdir(dirname(saveTo), { recursive: true });
  await writeFile(saveTo, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`получено из TTN: ${records.length} пакетов — сохранено в ${saveTo}`);
}

if (!records.length) { console.log("пакетов нет, делать нечего"); process.exit(0); }
records.sort((a, b) => a.received_at.localeCompare(b.received_at));
console.log(`окно данных: с ${records[0].received_at.slice(0, 16)} по ${records.at(-1)!.received_at.slice(0, 16)} UTC`);

// ---- 2. parse, and count per device ----
type Parsed = ReturnType<typeof parseTtnUplink>;
const perDevice = new Map<string, { ok: number; bad: number; first: string; last: string }>();
const parsed: { devEui: string; uplink: Parsed }[] = [];
for (const r of records) {
  const p = parseTtnUplink(r, new Date(r.received_at));
  const id = r.end_device_ids.device_id;
  const d = perDevice.get(id) ?? { ok: 0, bad: 0, first: r.received_at, last: r.received_at };
  if (p.ok) d.ok++; else d.bad++;
  d.last = r.received_at;
  perDevice.set(id, d);
  parsed.push({ devEui: r.end_device_ids.dev_eui.toUpperCase(), uplink: p });
}
console.log(`\nпо устройствам:`);
for (const [id, d] of [...perDevice].sort()) {
  console.log(`  ${id.padEnd(22)} ${String(d.ok).padStart(4)} пакетов${d.bad ? `, ${d.bad} не разобрано` : ""}   ${d.first.slice(5, 16)} → ${d.last.slice(5, 16)}`);
}

if (!write) {
  console.log(`\nПробный прогон, база не тронута. Повтори с --yes, чтобы записать${loadFrom ? "" : `, или позже: --load ${saveTo} --yes`}.`);
  process.exit(0);
}

// ---- 3. map to units the way the live ingest does, and write ----
const sensors = await prisma.sensor.findMany({
  include: { channels: { include: { unit: { select: { id: true, name: true, type: true } } } }, location: { select: { name: true } } },
});
const byEui = new Map(sensors.map((s) => [s.devEui, s]));
const rows: { unitId: string; sensorId: string; channel: number; tempF: number; probeTempF: number | null; measuredAt: Date }[] = [];
const perUnit = new Map<string, number>();
let unknownDevice = 0;

for (const { devEui, uplink } of parsed) {
  if (!uplink.ok) continue;
  const sensor = byEui.get(devEui);
  if (!sensor) { unknownDevice++; continue; }
  const u = uplink.uplink;
  for (const ch of u.channels) {
    const mapping = sensor.channels.find((c) => c.channel === ch.channel);
    if (!mapping?.unitId || !mapping.unit) continue;
    // Same rule as src/app/api/ingest/ttn/route.ts and backfill-unknown.mts: an AC is judged by
    // the room — the built-in air sensor where there is one, the mapped probe where there is
    // not — and keeps the other number as the duct. Three copies of this rule is two too many;
    // it belongs in one shared function, after the outage.
    const isAC = mapping.unit.type === "ac";
    const hasBuiltInAir = u.ambientTempF !== undefined;
    const tempF = isAC && hasBuiltInAir ? u.ambientTempF : ch.tempF;
    const probeTempF = !isAC ? null : hasBuiltInAir ? ch.tempF : (u.channels.find((c) => c.channel !== ch.channel)?.tempF ?? null);
    if (tempF === undefined) continue;
    rows.push({ unitId: mapping.unitId, sensorId: sensor.id, channel: ch.channel, tempF, probeTempF, measuredAt: u.receivedAt });
    const label = `${sensor.location.name} · ${mapping.unit.name}`;
    perUnit.set(label, (perUnit.get(label) ?? 0) + 1);
  }
}
console.log(`\nк записи: ${rows.length} показаний${unknownDevice ? ` (пакетов от неизвестных устройств: ${unknownDevice}, они пропущены)` : ""}`);
for (const [label, n] of [...perUnit].sort()) console.log(`  ${label.padEnd(38)} ${String(n).padStart(4)}`);

const res = await prisma.reading.createMany({ data: rows, skipDuplicates: true });
console.log(`\nзаписано новых: ${res.count}   уже были, пропущено: ${rows.length - res.count}`);

// The offline check reads lastSeenAt; a recovered packet counts as the device having spoken.
let bumped = 0;
for (const s of sensors) {
  let latest: Date | undefined;
  for (const p of parsed) {
    if (p.devEui !== s.devEui || !p.uplink.ok) continue;
    if (!latest || p.uplink.uplink.receivedAt > latest) latest = p.uplink.uplink.receivedAt;
  }
  if (latest && (!s.lastSeenAt || latest > s.lastSeenAt)) {
    await prisma.sensor.update({ where: { id: s.id }, data: { lastSeenAt: latest } });
    bumped++;
  }
}
console.log(`lastSeenAt сдвинут вперёд у ${bumped} датчиков`);
await prisma.$disconnect();
