/* eslint-disable @typescript-eslint/no-explicit-any -- a scenario script that inspects dozens
   of result shapes; typing each `r` would triple its length and add nothing it checks */
import "./load-env";
// Never let this reach a mailbox: with neither configured, the mailer prints to the console.
delete process.env.BREVO_API_KEY;
delete process.env.SMTP_URL;

import { prisma } from "../src/lib/db";
import { visibleLocationIds } from "../src/lib/auth/access";
import type { CurrentSession } from "../src/lib/auth/session";
import { inviteUser, listTeam, updateMember, deactivateMember, resendInvite, revokeInvite } from "../src/lib/auth/team";
import { listDistricts, createDistrict, updateDistrict, deleteDistrict } from "../src/lib/auth/districts";
import { listOrganization, createLocation, updateLocation } from "../src/lib/auth/locations";
import type { Geocoder } from "../src/lib/geocode";
import { updatePassport } from "../src/lib/units/passport";
import { insertReadings, writeErrorStatus } from "../src/lib/readings/write";
import { resolveWindow } from "../src/lib/readings/window";
import { readingSeries, weatherSeries } from "../src/lib/readings/series";
import { insertWeather, sampleWeather, backfillWeather } from "../src/lib/weather/store";
import { zonedParts } from "../src/lib/tz";
import { runOfflineCheck } from "../src/lib/alerts/service";
import { addPhoto, deletePhoto, photoContent, listPhotos } from "../src/lib/units/photos";
import { localStorage as localPhotoStorage, type ObjectStorage } from "../src/lib/storage";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Runs the team and district services end to end against a throwaway database, through every
 * corner case the spec lists. Refuses to run anywhere that looks like production.
 *
 *   docker run -d --name qimby-dev -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=qimby -p 55432:5432 postgres:18
 *   DATABASE_URL=postgres://postgres:dev@127.0.0.1:55432/qimby npx prisma migrate deploy
 *   DATABASE_URL=postgres://postgres:dev@127.0.0.1:55432/qimby npm run test:integration
 *
 * Not part of `npm test`: it needs a database, and the unit suite must stay runnable without one.
 */
const host = /@([^/?]+)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "";
if (!/^(localhost|127\.0\.0\.1)/.test(host)) {
  console.error(`ОТКАЗ: это не локальная база (${host})`);
  process.exit(1);
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail && !ok ? `  — ${detail}` : ""}`);
}
const session = (u: { id: string }): Promise<CurrentSession> =>
  prisma.user.findUniqueOrThrow({ where: { id: u.id } }).then((user) => ({ sessionId: "t", user, expiresAt: new Date(Date.now() + 1e6) }));
const console_log = console.log;
console.log = (...a: unknown[]) => { if (!String(a[0]).startsWith("[mail]")) console_log(...a); };

// ---- clean slate: the whole database, children before parents ----
// A throwaway database is the contract, but `prisma dev` serves one store whatever name the
// URL carries, so the seed's equipment may be here too. Everything goes — before the run, and
// again after it, so the scenarios' restaurants never mix into a developer's local data.
async function wipe() {
await prisma.unitPhoto.deleteMany();
await prisma.unitChange.deleteMany();
await prisma.reading.deleteMany();
await prisma.alert.deleteMany();
await prisma.sensorChannel.deleteMany();
await prisma.sensor.deleteMany();
await prisma.gateway.deleteMany();
await prisma.unit.deleteMany();
await prisma.unknownUplink.deleteMany();
await prisma.userDistrict.deleteMany();
await prisma.locationAccess.deleteMany();
await prisma.user.deleteMany();
await prisma.district.deleteMany();
await prisma.weatherReading.deleteMany();
await prisma.location.deleteMany();
await prisma.organization.deleteMany();
}
await wipe();

// ---- seed ----
const org = await prisma.organization.create({ data: { name: "Test Org" } });
const mk = (name: string) =>
  prisma.location.create({ data: { name, address: "1 st", city: "X", state: "CA", zip: "00000", lat: 0, lng: 0, organizationId: org.id } });
const [L1, L2, L3] = await Promise.all([mk("Loc 1"), mk("Loc 2"), mk("Loc 3")]);
const mkUser = (email: string, role: "owner" | "district_manager" | "technician" | "admin", orgId: string | null = org.id) =>
  prisma.user.create({ data: { email, role, status: "active", organizationId: orgId, passwordHash: "x", emailVerifiedAt: new Date() } });
const owner = await mkUser("owner@t.io", "owner");
const dm = await mkUser("dm@t.io", "district_manager");
const tech = await mkUser("tech@t.io", "technician");
await mkUser("dev@t.io", "admin", null);
const S = { owner: await session(owner), dm: await session(dm), tech: await session(tech) };
const BASE = "https://example.invalid";

console.log("\n=== дистрикты ===");
let r: any = await listDistricts(S.owner);
check("владелец видит 0 дистриктов и 3 неразмещённых", r.ok && r.data.districts.length === 0 && r.data.unassigned.length === 3);
r = await createDistrict(S.owner, { name: "North" });
check("создание дистрикта", r.ok && r.data.name === "North");
const D1 = r.data.id;
r = await createDistrict(S.owner, { name: "North" });
check("повтор имени → 409", !r.ok && r.status === 409, `${r.code}`);
r = await createDistrict(S.dm, { name: "Mine" });
check("менеджер не создаёт дистрикты → 403", !r.ok && r.status === 403);
r = await updateDistrict(S.owner, D1, { locationIds: [L1.id, L2.id] });
check("привязка двух локаций", r.ok && r.data.locations.length === 2);
r = await listDistricts(S.owner);
check("неразмещённой осталась одна", r.ok && r.data.unassigned.length === 1 && r.data.unassigned[0].id === L3.id);
r = await updateDistrict(S.owner, D1, { locationIds: [L1.id, "nope"] });
check("несуществующая локация → 400", !r.ok && r.status === 400, `${r.code}`);

console.log("\n=== скоуп менеджера через дистрикт ===");
r = await updateMember(S.owner, dm.id, { districtIds: [D1] });
check("менеджеру назначен дистрикт", r.ok && r.data.districts.length === 1);
let vis = await visibleLocationIds(await session(dm));
check("менеджер видит ровно L1 и L2", vis !== "all" && vis.length === 2 && vis.includes(L1.id) && vis.includes(L2.id));
r = await updateDistrict(S.owner, D1, { locationIds: [L1.id] });
vis = await visibleLocationIds(await session(dm));
check("локацию убрали из дистрикта → менеджер сразу её не видит, без правок на нём", vis !== "all" && vis.length === 1 && vis[0] === L1.id);

console.log("\n=== приглашения ===");
r = await inviteUser(S.dm, { email: "t2@t.io", role: "technician", locationIds: [L1.id] }, BASE);
check("менеджер приглашает техника на свою локацию", r.ok && r.data.status === "invited" && r.data.invite && !r.data.invite.expired);
const t2 = r.data;
r = await inviteUser(S.dm, { email: "t3@t.io", role: "technician", locationIds: [L3.id] }, BASE);
check("менеджер НЕ может выдать локацию вне своего охвата → 403", !r.ok && r.status === 403 && r.code === "beyond_reach", `${r.code}`);
r = await inviteUser(S.dm, { email: "dm2@t.io", role: "district_manager" }, BASE);
check("менеджер НЕ может создать менеджера → 403", !r.ok && r.status === 403);
r = await inviteUser(S.tech, { email: "x@t.io", role: "technician" }, BASE);
check("техник не приглашает никого → 403", !r.ok && r.status === 403);
r = await inviteUser(S.owner, { email: "t2@t.io", role: "technician" }, BASE);
check("повторное приглашение того же email → 409 user_exists", !r.ok && r.status === 409 && r.code === "user_exists", `${r.code}`);
r = await inviteUser(S.owner, { email: "admin-wannabe@t.io", role: "admin" as never }, BASE);
check("роль admin по приглашению не выдаётся", !r.ok && r.status === 403);
const tok = await prisma.authToken.findFirst({ where: { userId: t2.id, usedAt: null } });
const ttlH = tok ? (tok.expiresAt.getTime() - Date.now()) / 36e5 : 0;
check("срок приглашения ≈ 72 часа", ttlH > 71.9 && ttlH <= 72, `${ttlH.toFixed(2)} ч`);

console.log("\n=== список команды ===");
r = await listTeam(S.owner);
const emails = r.ok ? r.data.map((m: any) => m.email) : [];
check("владелец видит всех своих (4) и не видит admin", r.ok && emails.length === 4 && !emails.includes("dev@t.io"), emails.join(","));
r = await listTeam(S.dm);
check("менеджер видит только техников на своих локациях (t2)", r.ok && r.data.length === 1 && r.data[0].email === "t2@t.io", r.ok ? r.data.map((m: any) => m.email).join(",") : r.code);
r = await listTeam(S.tech);
check("техник команду не видит → 403", !r.ok && r.status === 403);

console.log("\n=== повтор и отзыв приглашения ===");
r = await resendInvite(S.owner, t2.id, BASE);
check("повторная отправка", r.ok && r.data.status === "invited");
const live = await prisma.authToken.count({ where: { userId: t2.id, usedAt: null } });
check("старая ссылка погашена, живая ровно одна", live === 1, `${live}`);
r = await resendInvite(S.owner, tech.id, BASE);
check("повтор для активного → 409", !r.ok && r.status === 409);
r = await revokeInvite(S.owner, t2.id);
check("отзыв неиспользованного приглашения", r.ok);
check("аккаунт удалён, email свободен", (await prisma.user.findUnique({ where: { email: "t2@t.io" } })) === null);
r = await revokeInvite(S.owner, tech.id);
check("отзыв для активного → 409, надо деактивировать", !r.ok && r.status === 409);

console.log("\n=== последний владелец ===");
r = await deactivateMember(S.owner, owner.id);
check("единственный владелец не может деактивировать себя → 409", !r.ok && r.code === "last_owner", `${r.code}`);
r = await updateMember(S.owner, owner.id, { role: "technician" });
check("…и не может снять с себя роль → 409", !r.ok && r.code === "last_owner", `${r.code}`);
r = await inviteUser(S.owner, { email: "o2@t.io", role: "owner" }, BASE);
check("приглашён второй владелец", r.ok && r.data.role === "owner");
const o2 = r.data;
r = await deactivateMember(S.owner, owner.id);
check("второй ещё не активен → всё ещё 409", !r.ok && r.code === "last_owner");
await prisma.user.update({ where: { id: o2.id }, data: { status: "active" } });
r = await deactivateMember(S.owner, owner.id);
check("второй активен → первый может деактивироваться", r.ok && r.data.status === "deactivated");
check("сессии деактивированного удалены", (await prisma.session.count({ where: { userId: owner.id } })) === 0);
const S2 = { owner: await session(o2) };

console.log("\n=== смена роли и удаление дистрикта ===");
r = await updateMember(S2.owner, dm.id, { role: "technician" });
check("DM → техник: скоуп дистриктов очищен", r.ok && r.data.role === "technician" && r.data.districts.length === 0 && r.data.locations.length === 0);
r = await updateMember(S2.owner, dm.id, { role: "district_manager", districtIds: [D1] });
check("обратно в DM с дистриктом", r.ok && r.data.districts.length === 1);
r = await deleteDistrict(S2.owner, D1);
check("удаление дистрикта, 1 локация осиротела", r.ok && r.data.orphanedLocations === 1, JSON.stringify(r));
vis = await visibleLocationIds(await session(dm));
check("менеджер после удаления дистрикта видит ничего", vis !== "all" && vis.length === 0);
r = await listDistricts(S2.owner);
check("все 3 локации снова неразмещённые", r.ok && r.data.unassigned.length === 3);


console.log("\n=== рестораны: таблица владельца ===");
// No network in a test: the geocoder is a stub that answers with a point derived from the street.
const pin: Geocoder = async (a) => (a.address.includes("nowhere") ? null : { lat: 33 + a.address.length, lng: -117, precision: "address" });
r = await listOrganization(S2.owner);
check("владелец видит таблицу: 3 ресторана, все открыты", r.ok && r.data.locations.length === 3 && r.data.locations.every((l: any) => l.active), r.ok ? "" : `${r.code}`);
check("в таблице есть кого назначать: менеджеры и техники организации", r.ok && r.data.managers.length >= 1 && r.data.technicians.length >= 1);
const NEW = { name: "Loc 4", address: "77 Main St", city: "Norco", state: "CA", zip: "92860" };
r = await createLocation(S2.owner, NEW, pin);
check("владелец добавляет ресторан; адрес поставлен на карту, зона по штату", r.ok && r.data.lat === 33 + NEW.address.length && r.data.timezone === "America/Los_Angeles", r.ok ? "" : `${r.code}`);
const L4 = r.data.id;
r = await createLocation(S2.owner, NEW, pin);
check("повтор имени → 409", !r.ok && r.status === 409 && r.code === "location_exists", `${r.code}`);
r = await createLocation(S.dm, { ...NEW, name: "Loc 5" }, pin);
check("менеджер не добавляет рестораны → 403", !r.ok && r.status === 403);
r = await createLocation(S2.owner, { ...NEW, name: "Loc 6", address: "nowhere" }, pin);
check("адрес не найден → 422, ресторан не создан", !r.ok && r.status === 422 && r.code === "address_not_found", `${r.code}`);
r = await updateLocation(S2.owner, L4, { name: "Loc 4 renamed" }, pin);
check("переименование", r.ok && r.data.name === "Loc 4 renamed" && r.data.lat === 33 + NEW.address.length);
r = await updateLocation(S2.owner, L4, { name: "Loc 1" }, pin);
check("переименование в занятое имя → 409", !r.ok && r.status === 409);
r = await updateLocation(S2.owner, L4, { address: "1 Short" }, pin);
check("смена адреса ставит пин заново", r.ok && r.data.lat === 33 + "1 Short".length);

console.log("\n=== люди на ресторане ===");
vis = await visibleLocationIds(await session(dm));
check("менеджер пока не видит ничего", vis !== "all" && vis.length === 0);
r = await updateLocation(S2.owner, L4, { managerIds: [dm.id], technicianIds: [tech.id] }, pin);
check("назначены менеджер и техник", r.ok && r.data.managers.length === 1 && r.data.technicians.length === 1, r.ok ? "" : `${r.code}`);
vis = await visibleLocationIds(await session(dm));
check("менеджер видит ресторан напрямую, без дистрикта", vis !== "all" && vis.includes(L4));
vis = await visibleLocationIds(await session(tech));
check("техник тоже", vis !== "all" && vis.includes(L4));
r = await updateLocation(S2.owner, L4, { technicianIds: [dm.id] }, pin);
check("менеджер в колонке техников → 400", !r.ok && r.status === 400 && r.code === "unknown_person", `${r.code}`);
r = await updateLocation(S2.owner, L4, { managerIds: [] }, pin);
vis = await visibleLocationIds(await session(dm));
check("снятый менеджер сразу не видит", r.ok && vis !== "all" && !vis.includes(L4));

console.log("\n=== закрытие ресторана ===");
const unit = await prisma.unit.create({ data: { locationId: L4, type: "freezer", name: "F", rangeMinF: -10, rangeMaxF: 10 } });
const alert = await prisma.alert.create({ data: { unitId: unit.id, type: "temp_out_of_range" } });
r = await updateLocation(S2.owner, L4, { active: false }, pin);
check("закрыт", r.ok && !r.data.active && r.data.deactivatedAt !== null);
vis = await visibleLocationIds(await session(tech));
check("техник закрытый ресторан не видит", vis !== "all" && !vis.includes(L4));
vis = await visibleLocationIds(S2.owner);
check("владелец в списках тоже не видит", vis !== "all" && !vis.includes(L4));
r = await listDistricts(S2.owner);
check("в дистриктах его нет", r.ok && !r.data.unassigned.some((l: any) => l.id === L4));
const a = await prisma.alert.findUniqueOrThrow({ where: { id: alert.id } });
check("открытый алерт закрыт вместе с рестораном", a.resolvedAt !== null);
r = await listOrganization(S2.owner);
check("в таблице владельца он остался, последним и закрытым", r.ok && r.data.locations.at(-1).id === L4 && !r.data.locations.at(-1).active);
r = await updateLocation(S2.owner, L4, { active: true }, pin);
vis = await visibleLocationIds(await session(tech));
check("открыт заново — техник снова видит", r.ok && r.data.active && vis !== "all" && vis.includes(L4));

console.log("\n=== паспорт юнита ===");
// L4 is the restaurant the technician was placed on from the owner's table above
const pUnit = await prisma.unit.create({ data: { locationId: L4, type: "ac", name: "AC-P", rangeMinF: 65, rangeMaxF: 80 } });
r = await updatePassport(await session(tech), pUnit.id, { model: "TRANE 4TTR3036", capacitor: "45/5 µF, 370V" });
check("техник заполняет паспорт на своей точке", r.ok && r.data.model === "TRANE 4TTR3036" && r.data.changed.length === 2, r.ok ? "" : `${r.code}`);
check("паспорт помнит, кто и когда", r.ok && r.data.updatedBy?.id === tech.id && r.data.updatedAt !== null);
r = await updatePassport(await session(tech), pUnit.id, { model: "TRANE 4TTR3036" });
check("повтор того же значения ничего не меняет", r.ok && r.data.changed.length === 0);
r = await updatePassport(await session(tech), pUnit.id, { serial: "NEW-001", capacitor: null });
check("серийник записан, капаситор очищен", r.ok && r.data.serial === "NEW-001" && r.data.capacitor === null);
const log = await prisma.unitChange.findMany({ where: { unitId: pUnit.id }, orderBy: { id: "asc" } });
check("лог: 4 изменения, старые значения сохранены", log.length === 4 && log.some((c) => c.field === "capacitor" && c.oldValue === "45/5 µF, 370V" && c.newValue === null), `${log.length}`);
r = await updatePassport(S2.owner, pUnit.id, { year: 2014 });
check("владелец тоже правит паспорт", r.ok && r.data.year === 2014);
const stranger = await mkUser("stranger@t.io", "technician");
r = await updatePassport(await session(stranger), pUnit.id, { year: 2015 });
check("техник без этой точки → 404", !r.ok && r.status === 404, `${r.code}`);

console.log("\n=== фото шильдика ===");
const photoDir = await mkdtemp(join(tmpdir(), "qimby-photos-"));
const store = localPhotoStorage(photoDir);
const jpeg = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]), contentType: "image/jpeg", width: 1600, height: 1200 };
const techS = await session(tech);
r = await addPhoto(techS, pUnit.id, jpeg, store);
check("техник добавляет фото на своей точке", r.ok, r.ok ? "" : `${r.code}`);
const firstPhoto = r.ok ? r.data.id : "";
const firstRow = await prisma.unitPhoto.findUniqueOrThrow({ where: { id: firstPhoto } });
check("файл лёг в хранилище", (await stat(join(photoDir, firstRow.path))).size === jpeg.bytes.byteLength);
for (let k = 0; k < 4; k++) await addPhoto(techS, pUnit.id, jpeg, store);
r = await addPhoto(techS, pUnit.id, jpeg, store);
check("шестое фото → 409", !r.ok && r.status === 409 && r.code === "too_many", r.ok ? "" : `${r.code}`);
r = await addPhoto(techS, pUnit.id, { ...jpeg, contentType: "application/pdf" }, store);
check("не картинка → 415", !r.ok && r.status === 415);
r = await addPhoto(await session(stranger), pUnit.id, jpeg, store);
check("техник без этой точки → 404", !r.ok && r.status === 404);
r = await listPhotos(techS, pUnit.id);
check("список: пять фото, можно править", r.ok && r.data.photos.length === 5 && r.data.canEdit);
r = await photoContent(techS, pUnit.id, firstPhoto, store);
check("фото отдаётся тому, кто видит юнит", r.ok && "bytes" in r.data && r.data.bytes.byteLength === jpeg.bytes.byteLength);
r = await photoContent(await session(stranger), pUnit.id, firstPhoto, store);
check("чужому — 404", !r.ok && r.status === 404);
r = await deletePhoto(techS, pUnit.id, firstPhoto, store);
const gone = await stat(join(photoDir, firstRow.path)).then(() => false, () => true);
check("удаление убирает и запись, и файл", r.ok && gone && (await prisma.unitPhoto.count({ where: { id: firstPhoto } })) === 0);
const off: ObjectStorage = { mode: "off", put: async () => { throw new Error("off"); }, remove: async () => {}, signedUrl: async () => null, read: async () => { throw new Error("off"); } };
r = await addPhoto(techS, pUnit.id, jpeg, off);
check("хранилище не настроено → 503, ничего не записано", !r.ok && r.status === 503 && r.code === "storage_off");

console.log("\n=== запись показаний: дубль молча, всё остальное громко ===");
const wSensor = await prisma.sensor.create({ data: { devEui: "A8404100000000FF", locationId: L4 } });
const row = { unitId: pUnit.id, sensorId: wSensor.id, channel: 1, tempF: 70, probeTempF: 55, measuredAt: new Date("2026-10-03T10:00:00Z") };
let w = await insertReadings(prisma, [row]);
check("первая запись проходит", w.length === 1);
w = await insertReadings(prisma, [row]);
check("тот же датчик, канал и время — пропущен без ошибки", w.length === 0);
// The September failure: the id counter behind the rows. A skip-any-conflict insert lost
// every reading this way without a word; the targeted one must throw.
// Point the counter at an id that is already taken: the next insert must collide on it.
await prisma.$executeRawUnsafe(`SELECT setval('"Reading_id_seq"', (SELECT min(id) FROM "Reading"), false)`);
let threw = false;
try {
  await insertReadings(prisma, [{ ...row, measuredAt: new Date("2026-10-03T10:05:00Z") }]);
} catch {
  threw = true;
}
check("сломанный счётчик — ошибка, а не тишина", threw);
check("ошибка записи видна в счётчике для health", writeErrorStatus().failures >= 1);
await prisma.$executeRawUnsafe(`SELECT setval('"Reading_id_seq"', (SELECT max(id) FROM "Reading"), true)`);

console.log("\n=== график: окно и корзины по часам ресторана ===");
// A restaurant in Los Angeles with a unit that reported every hour for three days around the
// night the clocks went forward (8 Mar 2026, 2 AM → 3 AM). Buckets must be cut on its own clock.
const laLoc = await prisma.location.create({ data: { name: "LA", address: "1", city: "LA", state: "CA", zip: "90001", lat: 34, lng: -118, organizationId: org.id, timezone: "America/Los_Angeles" } });
const laUnit = await prisma.unit.create({ data: { locationId: laLoc.id, type: "freezer", name: "F-LA", rangeMinF: -10, rangeMaxF: 10 } });
const laSensor = await prisma.sensor.create({ data: { devEui: "A8404100000000AA", locationId: laLoc.id } });
const marchStart = Date.UTC(2026, 2, 7, 8); // 7 Mar, midnight PST
await insertReadings(prisma, Array.from({ length: 72 }, (_, i) => ({ unitId: laUnit.id, sensorId: laSensor.id, channel: 1, tempF: i % 10, probeTempF: null, measuredAt: new Date(marchStart + i * 3_600_000) })));
const LA = "America/Los_Angeles";
const localHM = (iso: string) => { const p = zonedParts(Date.parse(iso), LA); return [p.h, p.mi] as const; };

let wr = resolveWindow({ from: "2026-01-01T08:00:00Z", to: "2026-10-01T07:00:00Z" }, Date.UTC(2026, 9, 3, 17));
check("девять месяцев → корзины по 12 часов", wr.ok && wr.window.bucketMinutes === 720, JSON.stringify(wr));
let series = wr.ok ? await readingSeries(prisma, laUnit.id, wr.window, LA) : [];
// 72 hours from midnight 7 Mar, one of the days 23 hours long, reach midnight on the 10th: seven buckets
check("все корзины начинаются в местную полночь или полдень", series.length === 7 && series.every((pt) => { const [h, m] = localHM(pt.t); return (h === 0 || h === 12) && m === 0; }), series.map((pt) => pt.t).join(","));
check("ни одно показание не потеряно при усреднении", series.reduce((a, pt) => a + (pt.n ?? 0), 0) === 72);
const shortNight = series.find((pt) => pt.t === "2026-03-08T08:00:00.000Z");
check("корзина ночи перевода часов короче: 11 показаний, не 12", shortNight?.n === 11, `n=${shortNight?.n}`);
check("после перевода полдень — уже 19:00 UTC, и корзина там есть", series.some((pt) => pt.t === "2026-03-08T19:00:00.000Z"));
check("в корзине есть min и max", series.every((pt) => pt.min !== undefined && pt.max !== undefined && pt.min <= pt.tempF && pt.tempF <= pt.max));

wr = resolveWindow({ from: "2026-03-08T08:00:00Z", to: "2026-03-09T08:00:00Z" }, Date.UTC(2026, 9, 3, 17));
series = wr.ok ? await readingSeries(prisma, laUnit.id, wr.window, LA) : [];
check("сутки → сырые показания, включая оба края", wr.ok && wr.window.bucketMinutes === null && series.length === 25, `${series.length}`);
check("показания в сыром виде без min/max", series.every((pt) => pt.min === undefined));

wr = resolveWindow({ range: "1w" }, Date.now());
series = wr.ok ? await readingSeries(prisma, laUnit.id, wr.window, LA) : [];
check("пресет за неделю: мартовских показаний в нём нет", wr.ok && wr.window.live && series.length === 0);
check("период длиннее года отклоняется", !resolveWindow({ from: "2025-01-01T00:00:00Z", to: "2026-03-01T00:00:00Z" }).ok);

console.log("\n=== погода: воздух снаружи для графика AC ===");
// Open-Meteo stands in for itself: a fetcher that answers with a fixed sample and counts calls
let weatherCalls = 0;
const fakeMeteo = (async (url: string) => {
  weatherCalls++;
  const u = new URL(url);
  if (u.searchParams.has("hourly")) {
    // The hours asked for: from `past_days` ago (forecast) or `start_date` (archive), to now
    const start = u.searchParams.has("past_days")
      ? Date.now() - Number(u.searchParams.get("past_days")) * 86_400_000
      : Date.parse(u.searchParams.get("start_date")!);
    const time: number[] = [];
    for (let t = Math.ceil(start / 3_600_000) * 3_600_000; t <= Date.now(); t += 3_600_000) time.push(t / 1000);
    return new Response(JSON.stringify({ hourly: { time, temperature_2m: time.map((_, i) => 50 + (i % 20)), weather_code: time.map(() => 1) } }));
  }
  return new Response(JSON.stringify({ current: { time: 1_790_000_000, temperature_2m: 66.5, weather_code: 3 } }));
}) as unknown as typeof fetch;
let ws = await sampleWeather(prisma, Date.now(), fakeMeteo);
check("проба раз в четверть часа: по одной на открытый ресторан", ws !== null && ws.sampled >= 5 && ws.stored === ws.sampled, JSON.stringify(ws));
const callsAfterFirst = weatherCalls;
ws = await sampleWeather(prisma, Date.now(), fakeMeteo);
check("минуту спустя — ничего не запрашивается", ws === null && weatherCalls === callsAfterFirst);
ws = await sampleWeather(prisma, Date.now() + 16 * 60_000, fakeMeteo);
check("тот же штамп Open-Meteo второй раз — строки не прибавилось, ошибки нет", ws !== null && ws.stored === 0 && ws.sampled >= 5, JSON.stringify(ws));
const closedLoc = await prisma.location.create({ data: { name: "Closed", address: "1", city: "X", state: "NJ", zip: "07601", lat: 0, lng: 0, organizationId: org.id, deactivatedAt: new Date() } });
ws = await sampleWeather(prisma, Date.now() + 32 * 60_000, fakeMeteo);
check("закрытый ресторан не опрашивается", ws !== null && (await prisma.weatherReading.count({ where: { locationId: closedLoc.id } })) === 0);
const twoDaysAgo = Date.now() - 86_400_000 * 2;
const bf = await backfillWeather(prisma, twoDaysAgo, fakeMeteo);
const laRow = bf.find((r) => r.name === "LA");
check("бэкфилл: двое суток по часам получены и записаны для LA", laRow !== undefined && laRow.fetched >= 47 && laRow.fetched <= 49 && laRow.stored === laRow.fetched, JSON.stringify(laRow));
check("повторный бэкфилл ничего не дублирует", (await backfillWeather(prisma, twoDaysAgo, fakeMeteo)).every((r) => r.stored === 0));

wr = resolveWindow({ from: new Date(twoDaysAgo).toISOString(), to: new Date().toISOString() });
let wsr = wr.ok ? await weatherSeries(prisma, laLoc.id, wr.window, LA) : [];
// One hour either way: the window's edges and the fake's first hour are rounded differently
check("двое суток → погода по часам, как записана", wsr.length >= 47 && wsr.length <= 49 && wsr.every((pt) => pt.tempF >= 50 && pt.tempF < 70), `${wsr.length}`);
wr = resolveWindow({ from: "2026-01-01T08:00:00Z", to: new Date().toISOString() });
wsr = wr.ok ? await weatherSeries(prisma, laLoc.id, wr.window, LA) : [];
check("длинное окно → погода в тех же корзинах, что показания (местная полночь/полдень)", wsr.length >= 4 && wsr.length <= 6 && wsr.every((pt) => { const [h, m] = localHM(pt.t); return (h === 0 || h === 12) && m === 0; }), wsr.map((pt) => pt.t).join(","));
const firstStamp = await prisma.weatherReading.findFirstOrThrow({ where: { locationId: laLoc.id }, orderBy: { measuredAt: "asc" } });
check("ручная запись погоды — дубль по штампу молча", (await insertWeather(prisma, laLoc.id, [{ at: firstStamp.measuredAt.getTime(), tempF: 1, code: null }])) === 0);

console.log("\n=== admin при единственной организации ===");
const dev = await prisma.user.findUniqueOrThrow({ where: { email: "dev@t.io" } });
const S3 = { admin: await session(dev) };
r = await listDistricts(S3.admin);
check("admin без явной организации попадает в единственную", r.ok && r.data.unassigned.length === 5, r.ok ? "" : `${r.code}`); // 3 seeded + the reopened Loc 4 + the LA one from the chart scenarios
r = await createDistrict(S3.admin, { name: "By admin" });
check("admin создаёт дистрикт в единственной организации", r.ok && r.data.name === "By admin");
r = await inviteUser(S3.admin, { email: "byadmin@t.io", role: "technician", locationIds: [L1.id] }, BASE);
check("admin приглашает в единственную организацию", r.ok && r.data.status === "invited");
r = await listTeam(S3.admin);
check("admin видит всех, кроме admin-ов", r.ok && !r.data.some((m: any) => m.role === "admin") && r.data.length >= 5);

console.log("\n=== чужая организация ===");
const org2 = await prisma.organization.create({ data: { name: "Other" } });
r = await listDistricts(S3.admin);
check("две организации → admin обязан назвать, какую → 400", !r.ok && r.status === 400 && r.code === "organization_required", `${r.code}`);
r = await listDistricts(S3.admin, org2.id);
check("…а с явной — работает", r.ok && r.data.districts.length === 0);
const foreign = await mkUser("f@t.io", "technician", org2.id);
r = await updateMember(S2.owner, foreign.id, { name: "hacked" });
check("чужой пользователь → 404, не 403", !r.ok && r.status === 404);
r = await deactivateMember(S2.owner, foreign.id);
check("деактивация чужого → 404", !r.ok && r.status === 404);
const foreignLoc = await prisma.location.create({ data: { name: "Theirs", address: "1", city: "X", state: "NJ", zip: "07601", lat: 0, lng: 0, organizationId: org2.id } });
r = await updateLocation(S2.owner, foreignLoc.id, { name: "mine now" }, pin);
check("чужой ресторан → 404", !r.ok && r.status === 404);
r = await listOrganization(S3.admin);
check("две организации → admin называет, какую → 400", !r.ok && r.status === 400 && r.code === "organization_required");
r = await listOrganization(S3.admin, org2.id);
check("…с явной admin видит её таблицу", r.ok && r.data.locations.length === 1);

console.log("\n=== алерты уходят в чат своей организации ===");
// Two customers, one with its own chat. A silent sensor at each opens an offline alert; the
// notifier here is the console one, which prints the chat it would have posted to.
const chatOrg = await prisma.organization.create({ data: { name: "Chat Org", telegramChatId: "-1009990001" } });
const mkSilent = async (orgId: string, name: string, eui: string) => {
  const l = await prisma.location.create({ data: { name, address: "1", city: "X", state: "CA", zip: "90000", lat: 0, lng: 0, organizationId: orgId } });
  const u = await prisma.unit.create({ data: { locationId: l.id, type: "walk_in_freezer", name: "WIF", rangeMinF: 0, rangeMaxF: 10 } });
  const sn = await prisma.sensor.create({ data: { devEui: eui, locationId: l.id, lastSeenAt: new Date(Date.now() - 6 * 3600_000) } });
  await prisma.sensorChannel.create({ data: { sensorId: sn.id, channel: 1, unitId: u.id } });
};
await mkSilent(chatOrg.id, "Chat Org Restaurant", "A8404100000000C1");
await mkSilent(org.id, "Default Chat Restaurant", "A8404100000000C2");
const said: string[] = [];
const before = console.log;
console.log = (...a: unknown[]) => { const line = String(a[0]); if (line.startsWith("[notify")) said.push(line); else before(...a); };
await runOfflineCheck();
await new Promise((res) => setTimeout(res, 300)); // notifications are fire-and-forget
console.log = before;
const toChatOrg = said.filter((l) => l.includes("Chat Org Restaurant"));
const toDefault = said.filter((l) => l.includes("Default Chat Restaurant"));
check("алерт ресторана со своим чатом ушёл в этот чат", toChatOrg.length > 0 && toChatOrg.every((l) => l.startsWith("[notify → -1009990001]")), said.join(" | "));
check("алерт ресторана без своего чата ушёл в общую группу, а не в чужой чат", toDefault.length > 0 && toDefault.every((l) => l.startsWith("[notify] ")), said.join(" | "));

console.log(`\n${failed === 0 ? "✓" : "✗"} прошло ${passed}, упало ${failed}`);
await wipe();
console.log("база очищена; локальные данные: npx prisma db seed && npm run locations:setup && npm run test:accounts");
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
