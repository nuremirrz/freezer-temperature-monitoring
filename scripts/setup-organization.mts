import "./load-env";
import { prisma } from "../src/lib/db";

/**
 * Creates the customer's organization and puts the estate inside it.
 *
 *   npm run org:setup -- --name "Burger King — Steven"
 *
 * Idempotent: the organization is found by name or created, and only what is still outside an
 * organization is moved in. Running it twice changes nothing.
 *
 * What it does not do is decide who anyone is. Every customer-side account is attached to the
 * organization so that its owner will see them in the Team list, but their roles stay as they
 * are — that is the owner's decision, made on that screen, not a script's guess.
 */

const nameFlag = process.argv.indexOf("--name");
const name = nameFlag > -1 ? process.argv[nameFlag + 1]?.trim() : undefined;
if (!name) {
  console.error('Нужно имя:  npm run org:setup -- --name "Burger King — Steven"');
  process.exit(1);
}

const existing = await prisma.organization.findFirst({ where: { name } });
const org = existing ?? (await prisma.organization.create({ data: { name } }));
console.log(`${existing ? "есть" : "создана"}: ${org.name}  (${org.id})`);

// Every location outside an organization belongs to this one. There is one customer today;
// a second will bring its own locations and its own run of this script with its own name.
const locations = await prisma.location.updateMany({
  where: { organizationId: null },
  data: { organizationId: org.id },
});
console.log(`рестораны привязаны: ${locations.count}`);

// Same for accounts — except Qimby's own team, who stand above every organization.
const users = await prisma.user.updateMany({
  where: { organizationId: null, role: { not: "admin" } },
  data: { organizationId: org.id },
});
console.log(`аккаунты привязаны: ${users.count}`);

console.log(`\nВ организации сейчас:`);
const members = await prisma.user.findMany({
  where: { organizationId: org.id },
  select: { email: true, role: true, status: true },
  orderBy: { createdAt: "asc" },
});
for (const m of members) console.log(`  ${m.email.padEnd(26)} ${m.role.padEnd(16)} ${m.status}`);
const owners = members.filter((m) => m.role === "owner" && m.status === "active").length;
if (!owners) {
  console.log(`\n  владельца нет — организация ждёт приглашения (npm run access:grant -- --invite --role owner …)`);
}

const locs = await prisma.location.findMany({ where: { organizationId: org.id }, select: { name: true, districtId: true } });
console.log(`\nРестораны:`);
for (const l of locs) console.log(`  ${l.name.padEnd(22)} ${l.districtId ? "в дистрикте" : "без дистрикта"}`);

await prisma.$disconnect();
