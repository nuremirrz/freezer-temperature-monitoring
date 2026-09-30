import "./load-env";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";

/**
 * Puts one account of every role into a LOCAL database, so each screen can be looked at
 * through the eyes it was built for.
 *
 *   npm run test:accounts
 *
 * Refuses anywhere that is not localhost: these are known passwords in a public repository,
 * and they must never exist on a customer's site. Idempotent — run it again and it repairs
 * whatever was changed by hand.
 *
 * What it builds, on top of whatever locations the local database already has:
 *
 *   organization  "Test Org"         every location and every non-admin account attached
 *
 *   owner@qimby.test      owner             sees the whole organization, runs Team and Restaurants
 *   dm@qimby.test         district_manager  assigned to the first half of the restaurants
 *   tech@qimby.test       technician        assigned to two restaurants, one from each half
 *   admin@qimby.test      admin             Qimby's own team, outside every organization
 *
 * And a second, unrelated customer, to see that the wall between organizations holds:
 *
 *   organization  "Other Org"        two restaurants of its own, no sensors, no district
 *   owner2@qimby.test     owner             sees Other Org and nothing of Test Org
 *   tech2@qimby.test      technician        one of the two Other Org restaurants
 *
 * The password is the same for every account: see PASSWORD below.
 */

const PASSWORD = "qimby-test-2026";
const ORG = "Test Org";
const OTHER = "Other Org";

const host = /@([^/?]+)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "";
if (!/^(localhost|127\.0\.0\.1|\[::1\])/.test(host)) {
  console.error(`ОТКАЗ: это не локальная база (${host}). Тестовые аккаунты с известным паролем живут только на ноутбуке.`);
  process.exit(1);
}

// ---- the other customer, built first so its restaurants never fall into Test Org below ----
const other =
  (await prisma.organization.findFirst({ where: { name: OTHER } })) ??
  (await prisma.organization.create({ data: { name: OTHER } }));
const OTHER_LOCATIONS = [
  { name: "Wendy's #4401", address: "1 Test Ave", city: "Paramus", state: "NJ", zip: "07652", lat: 40.9445, lng: -74.0754 },
  { name: "Wendy's #4402", address: "2 Test Ave", city: "Hackensack", state: "NJ", zip: "07601", lat: 40.8859, lng: -74.0435 },
];
const otherLocs = [];
for (const l of OTHER_LOCATIONS) {
  otherLocs.push(
    await prisma.location.upsert({
      where: { name: l.name },
      update: { organizationId: other.id },
      create: { ...l, organizationId: other.id },
      select: { id: true, name: true },
    }),
  );
}
console.log(`организация: ${other.name}  (${otherLocs.map((l) => l.name).join(", ")})`);

const locations = await prisma.location.findMany({
  where: { organizationId: { not: other.id } },
  orderBy: { name: "asc" },
  select: { id: true, name: true },
});
if (locations.length < 2) {
  console.error("В базе меньше двух ресторанов — нечего делить на районы. Сначала: npx prisma db seed");
  process.exit(1);
}

// ---- organization ----
const org =
  (await prisma.organization.findFirst({ where: { name: ORG } })) ??
  (await prisma.organization.create({ data: { name: ORG } }));
await prisma.location.updateMany({ where: { organizationId: null }, data: { organizationId: org.id } });
console.log(`организация: ${org.name}`);

// ---- two halves: the manager gets the first, the technician one restaurant from each ----
const half = Math.ceil(locations.length / 2);
const plan = { North: locations.slice(0, half), South: locations.slice(half) };

// ---- accounts ----
type Role = "owner" | "district_manager" | "technician" | "admin";
const passwordHash = await hashPassword(PASSWORD);
async function account(email: string, name: string, role: Role, organizationId: string | null) {
  const data = { name, role, status: "active" as const, passwordHash, emailVerifiedAt: new Date(), organizationId };
  const user = await prisma.user.upsert({ where: { email }, update: data, create: { email, ...data } });
  // A fresh password must not leave an old browser signed in
  await prisma.session.deleteMany({ where: { userId: user.id } });
  return user;
}

const owner = await account("owner@qimby.test", "Test Owner", "owner", org.id);
const dm = await account("dm@qimby.test", "Test District Manager", "district_manager", org.id);
const tech = await account("tech@qimby.test", "Test Technician", "technician", org.id);
await account("admin@qimby.test", "Qimby Admin", "admin", null);
await account("owner2@qimby.test", "Other Owner", "owner", other.id);
const tech2 = await account("tech2@qimby.test", "Other Technician", "technician", other.id);
await prisma.locationAccess.deleteMany({ where: { userId: tech2.id } });
await prisma.locationAccess.create({ data: { userId: tech2.id, locationId: otherLocs[0].id } });

// The manager is assigned restaurant by restaurant, the way the owner's table does it
await prisma.userDistrict.deleteMany({ where: { userId: dm.id } });
await prisma.locationAccess.deleteMany({ where: { userId: dm.id } });
for (const l of plan.North) await prisma.locationAccess.create({ data: { userId: dm.id, locationId: l.id } });

// The technician gets one location from each district, so both managers see them
const techLocs = [plan.North[0], plan.South[0]].filter(Boolean);
await prisma.locationAccess.deleteMany({ where: { userId: tech.id } });
for (const l of techLocs) await prisma.locationAccess.create({ data: { userId: tech.id, locationId: l.id } });

// The owner needs no grants: visibility comes from the organization
void owner;

console.log(`
аккаунты (пароль у всех один, см. PASSWORD в этом файле):
  owner@qimby.test   owner             вся организация
  dm@qimby.test      district_manager  ${plan.North.map((l) => l.name).join(", ")}
  tech@qimby.test    technician        ${techLocs.map((l) => l.name).join(", ")}
  admin@qimby.test   admin             вне организации, видит всё
  owner2@qimby.test  owner             ${other.name} целиком, ничего из ${org.name}
  tech2@qimby.test   technician        ${otherLocs[0].name}
`);
await prisma.$disconnect();
