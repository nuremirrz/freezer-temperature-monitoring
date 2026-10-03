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
import { runOfflineCheck } from "../src/lib/alerts/service";

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
// URL carries, so the seed's equipment may be here too. Everything goes.
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
await prisma.location.deleteMany();
await prisma.organization.deleteMany();

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

console.log("\n=== admin при единственной организации ===");
const dev = await prisma.user.findUniqueOrThrow({ where: { email: "dev@t.io" } });
const S3 = { admin: await session(dev) };
r = await listDistricts(S3.admin);
check("admin без явной организации попадает в единственную", r.ok && r.data.unassigned.length === 4, r.ok ? "" : `${r.code}`); // 3 seeded + the reopened Loc 4
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
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
