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

// ---- clean slate ----
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

console.log("\n=== admin при единственной организации ===");
const dev = await prisma.user.findUniqueOrThrow({ where: { email: "dev@t.io" } });
const S3 = { admin: await session(dev) };
r = await listDistricts(S3.admin);
check("admin без явной организации попадает в единственную", r.ok && r.data.unassigned.length === 3, r.ok ? "" : `${r.code}`);
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

console.log(`\n${failed === 0 ? "✓" : "✗"} прошло ${passed}, упало ${failed}`);
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
