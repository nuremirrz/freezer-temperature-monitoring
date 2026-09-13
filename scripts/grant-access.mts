import "./load-env";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";

/**
 * Creates or updates an account and grants it locations.
 *
 *   ACCOUNT_PASSWORD='…' npm run access:grant -- --email ceo@example.com --location "Burger King #6816"
 *   npm run access:grant -- --email ceo@example.com --location "Burger King #6816"   # grant only
 *   npm run access:grant -- --email me@qimby.app --role admin
 *   npm run access:grant -- --email ceo@example.com --revoke "Burger King #6816"
 *   npm run access:grant -- --email ceo@example.com --list
 *
 * The password never appears on the command line — it comes from ACCOUNT_PASSWORD, so it
 * stays out of the shell history, and it is hashed before it reaches the database.
 *
 * An account made here is marked confirmed, because we are vouching for the address
 * ourselves: no e-mail is sent and none needs to arrive, which matters while there is still
 * no mail provider configured.
 */

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const all = (name: string) =>
  argv.reduce<string[]>((acc, a, i) => (a === `--${name}` && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);

const email = flag("email")?.trim().toLowerCase();
const role = (flag("role") ?? "client") as "admin" | "client";
const name = flag("name");
const locations = all("location");
const revoke = all("revoke");
const listOnly = argv.includes("--list");
const password = process.env.ACCOUNT_PASSWORD;

if (!email) {
  console.error("--email is required");
  process.exit(1);
}
if (!["admin", "client"].includes(role)) {
  console.error(`--role must be admin or client, got "${role}"`);
  process.exit(1);
}

// Names must match what is in the database, so a typo fails loudly instead of granting nothing
const wanted = [...locations, ...revoke];
const found = wanted.length
  ? await prisma.location.findMany({ where: { name: { in: wanted } }, select: { id: true, name: true } })
  : [];
const missing = wanted.filter((n) => !found.some((l) => l.name === n));
if (missing.length) {
  console.error(`no location named: ${missing.map((m) => `"${m}"`).join(", ")}`);
  const known = await prisma.location.findMany({ select: { name: true }, orderBy: { name: "asc" } });
  console.error(`known locations: ${known.map((l) => `"${l.name}"`).join(", ") || "(none)"}`);
  await prisma.$disconnect();
  process.exit(1);
}
const idOf = (n: string) => found.find((l) => l.name === n)!.id;

let user = await prisma.user.findUnique({ where: { email } });

if (!user) {
  if (listOnly) {
    console.error(`no account for ${email}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (!password) {
    console.error("ACCOUNT_PASSWORD is not set — needed to create a new account");
    await prisma.$disconnect();
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("ACCOUNT_PASSWORD must be at least 8 characters");
    await prisma.$disconnect();
    process.exit(1);
  }
  user = await prisma.user.create({
    data: {
      email,
      name: name ?? null,
      role,
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`✓ created ${email} (${role}), confirmed — no e-mail needed`);
} else if (!listOnly) {
  user = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(password ? { passwordHash: await hashPassword(password) } : {}),
      ...(flag("role") ? { role } : {}),
      ...(name ? { name } : {}),
      ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }),
    },
  });
  console.log(`✓ ${email} already existed${password ? " — password replaced" : ""}`);
  if (password) {
    // A new password must not leave old browsers signed in
    const { count } = await prisma.session.deleteMany({ where: { userId: user.id } });
    if (count) console.log(`  signed out of ${count} existing session(s)`);
  }
}

for (const n of locations) {
  await prisma.locationAccess.upsert({
    where: { userId_locationId: { userId: user.id, locationId: idOf(n) } },
    update: {},
    create: { userId: user.id, locationId: idOf(n) },
  });
  console.log(`  + ${n}`);
}
for (const n of revoke) {
  await prisma.locationAccess.deleteMany({ where: { userId: user.id, locationId: idOf(n) } });
  console.log(`  − ${n}`);
}

const granted = await prisma.locationAccess.findMany({
  where: { userId: user.id },
  include: { location: { select: { name: true } } },
});
console.log(`\n${user.email} · role ${user.role}`);
console.log(
  user.role === "admin"
    ? "  sees every location (role admin ignores the grants)"
    : granted.length
      ? `  sees: ${granted.map((g) => g.location.name).join(", ")}`
      : "  sees nothing — grant a location with --location",
);
await prisma.$disconnect();
