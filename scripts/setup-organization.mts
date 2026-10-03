import "./load-env";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { generateToken } from "../src/lib/auth/tokens";
import { sendMail, mailerMode } from "../src/lib/auth/mailer";
import { inviteMail } from "../src/lib/auth/emails";
import { INVITE_TTL_MS } from "../src/lib/auth/team";

/**
 * Brings a customer on board: an organization of theirs, and an invitation to its first owner.
 *
 *   npm run org:setup -- --name "Burger King — Steven" --owner steven@example.com
 *   npm run org:setup -- --name "Burger King — Steven" --attach "Burger King #6816" --attach "Burger King #6399"
 *   npm run org:setup -- --name "Burger King — Steven" --owner steven@example.com --resend
 *   npm run org:setup -- --name "Burger King — Steven" --owner owner@qimby.test --print-link
 *   npm run org:setup -- --name "Burger King — Steven" --attach-user tech@example.com
 *   npm run org:setup -- --name "Burger King — Steven" --telegram -1001234567890   # its own alert chat
 *   npm run org:setup -- --name "Burger King — Steven" --telegram-off              # back to the default group
 *
 * The flow agreed with the client on 30 Sep 2026: we create the organization and send the owner
 * one e-mail; the owner signs in through that link and adds their own people and restaurants.
 * So this creates an **empty** organization and attaches nothing it was not told to. An earlier
 * version pulled in every restaurant and account that had no organization, which was right when
 * there was one customer and is a way to hand one customer's restaurants to another now that
 * there are two. `--attach` names a restaurant explicitly, and `--attach-user` an account, for
 * the estate and the people that predate this. An account keeps its role and its grants; it only
 * gains an organization, so the owner sees it on the Team page and can manage it there.
 *
 * The invitation is the same single-use, 72-hour link the Team page sends: the owner chooses a
 * password through it and that confirms the address. It goes out through whatever mailer the
 * environment has (Brevo in production); without one, or with --print-link, the link is printed
 * here to be passed on — which is also how a placeholder owner on an address nobody reads gets
 * in, until the real one is invited from the Team page and the placeholder deactivated.
 *
 * Idempotent: the organization is found by name, a restaurant already inside is left alone, and
 * an owner already invited is invited again only with --resend. An owner who is already active
 * needs nothing from here.
 */

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1]?.trim() : undefined; };
const all = (n: string) => argv.reduce<string[]>((acc, a, i) => (a === `--${n}` && argv[i + 1] ? [...acc, argv[i + 1].trim()] : acc), []);

const name = flag("name");
const ownerEmail = flag("owner")?.toLowerCase();
const attach = all("attach");
const attachUsers = all("attach-user").map((e) => e.toLowerCase());
const resend = argv.includes("--resend");
const printLink = argv.includes("--print-link");
const telegramChat = flag("telegram");
const telegramOff = argv.includes("--telegram-off");
const base = (process.env.APP_URL ?? "https://qimby.onrender.com").replace(/\/+$/, "");

if (!name) {
  console.error('Нужно имя:  npm run org:setup -- --name "Burger King — Steven" [--owner e-mail] [--attach "Ресторан"]…');
  process.exit(1);
}
if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ownerEmail)) {
  console.error(`не похоже на e-mail: ${ownerEmail}`);
  process.exit(1);
}

// ---- 1. the organization, empty unless it already exists ----
const existing = await prisma.organization.findFirst({ where: { name } });
const org = existing ?? (await prisma.organization.create({ data: { name } }));
console.log(`${existing ? "есть" : "создана"}: ${org.name}  (${org.id})`);

// ---- 2. restaurants named on the command line, and only those ----
for (const locName of attach) {
  const loc = await prisma.location.findUnique({ where: { name: locName }, select: { id: true, organizationId: true } });
  if (!loc) {
    const known = await prisma.location.findMany({ where: { organizationId: null }, select: { name: true }, orderBy: { name: "asc" } });
    console.error(`  ✗ ресторана "${locName}" нет. Без организации сейчас: ${known.map((l) => `"${l.name}"`).join(", ") || "(никого)"}`);
    process.exit(1);
  }
  if (loc.organizationId === org.id) {
    console.log(`  = ${locName} уже здесь`);
  } else if (loc.organizationId) {
    console.error(`  ✗ ${locName} принадлежит другой организации — сначала реши, чей он`);
    process.exit(1);
  } else {
    await prisma.location.update({ where: { id: loc.id }, data: { organizationId: org.id } });
    console.log(`  + ${locName} привязан`);
  }
}

// ---- 2b. accounts named on the command line, and only those ----
for (const email of attachUsers) {
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, organizationId: true } });
  if (!u) {
    console.error(`  ✗ аккаунта ${email} нет — пригласи его с экрана Team, когда владелец войдёт`);
    process.exit(1);
  }
  if (u.role === "admin") {
    console.error(`  ✗ ${email} — admin, команда Qimby стоит вне организаций`);
    process.exit(1);
  }
  if (u.organizationId === org.id) {
    console.log(`  = ${email} уже здесь`);
  } else if (u.organizationId) {
    console.error(`  ✗ ${email} состоит в другой организации — сначала реши, чей он`);
    process.exit(1);
  } else {
    await prisma.user.update({ where: { id: u.id }, data: { organizationId: org.id } });
    console.log(`  + ${email} (${u.role}) введён в организацию`);
  }
}

// ---- 3. the first owner, by invitation ----
if (ownerEmail) {
  let user = await prisma.user.findUnique({ where: { email: ownerEmail } });
  let mustSend = false;
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: ownerEmail,
        role: "owner",
        status: "invited",
        organizationId: org.id,
        // No password works until the invitee sets one through the link
        passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
      },
    });
    console.log(`\nвладелец: ${ownerEmail} — аккаунт создан, ждёт приглашения`);
    mustSend = true;
  } else if (user.organizationId && user.organizationId !== org.id) {
    console.error(`\n✗ ${ownerEmail} уже состоит в другой организации`);
    process.exit(1);
  } else if (user.status === "active") {
    console.log(`\nвладелец: ${ownerEmail} уже активен${user.role === "owner" ? "" : ` (роль ${user.role}, не owner — поменяй на экране Team)`}`);
  } else if (user.status === "deactivated") {
    console.error(`\n✗ ${ownerEmail} деактивирован — верни его к жизни на экране Team, приглашать заново нельзя`);
    process.exit(1);
  } else {
    // invited, not yet through the link
    if (user.organizationId !== org.id || user.role !== "owner") {
      user = await prisma.user.update({ where: { id: user.id }, data: { organizationId: org.id, role: "owner" } });
    }
    console.log(`\nвладелец: ${ownerEmail} уже приглашён${resend ? ", отправляю заново" : " — добавь --resend, чтобы отправить письмо ещё раз"}`);
    mustSend = resend;
  }

  if (mustSend) {
    // A fresh link supersedes any unused one, same as the app's own flow
    await prisma.authToken.updateMany({ where: { userId: user.id, type: "password_reset", usedAt: null }, data: { usedAt: new Date() } });
    const { raw, hash } = generateToken();
    await prisma.authToken.create({ data: { id: hash, userId: user.id, type: "password_reset", expiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
    const link = `${base}/reset-password?token=${raw}`;
    const mode = mailerMode();
    if (mode === "console" || printLink) {
      console.log(`  ${printLink ? "по просьбе" : "почта не настроена"} — передай ссылку сам, она одноразовая и живёт 72 часа:\n  ${link}`);
    } else {
      const ok = await sendMail(inviteMail(ownerEmail, link, { organization: org.name, invitedBy: "Qimby", role: "owner", ttlHours: INVITE_TTL_MS / 3_600_000 }));
      console.log(ok ? `  письмо ушло через ${mode}` : `  ✗ письмо не ушло — вот ссылка, передай сам:\n  ${link}`);
    }
  }
}

// ---- 3b. where this customer's alerts go ----
if (telegramChat || telegramOff) {
  if (telegramChat && !/^-?\d{5,20}$/.test(telegramChat)) {
    console.error(`  ✗ "${telegramChat}" не похоже на chat id. Найти его: npm run telegram -- --token <bot>`);
    process.exit(1);
  }
  await prisma.organization.update({ where: { id: org.id }, data: { telegramChatId: telegramOff ? null : telegramChat } });
  if (telegramOff) {
    console.log(`\nалерты ${org.name} теперь идут в общую группу`);
  } else {
    console.log(`\nалерты ${org.name} теперь идут в чат ${telegramChat}`);
    // Prove the bot is in that chat before anyone relies on it
    if (process.env.TELEGRAM_BOT_TOKEN) {
      const { sendTelegram } = await import("../src/lib/notify/telegram");
      try {
        await sendTelegram(`✅ Qimby: сюда будут приходить алерты по ресторанам «${org.name}».`, telegramChat);
        console.log(`  проверочное сообщение ушло`);
      } catch (err) {
        console.error(`  ✗ не дошло: ${err instanceof Error ? err.message : err}\n  бот добавлен в эту группу? Пока не исправишь, алерты этого клиента не дойдут.`);
        process.exit(1);
      }
    } else {
      console.log(`  TELEGRAM_BOT_TOKEN не задан здесь — проверочное сообщение не отправлено`);
    }
  }
}

// ---- 4. what the organization looks like now ----
const [members, locs] = await Promise.all([
  prisma.user.findMany({ where: { organizationId: org.id }, select: { email: true, role: true, status: true }, orderBy: { createdAt: "asc" } }),
  prisma.location.findMany({ where: { organizationId: org.id }, select: { name: true, deactivatedAt: true }, orderBy: { name: "asc" } }),
]);
const current = await prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { telegramChatId: true } });
console.log(`\nАлерты: ${current.telegramChatId ? `свой чат ${current.telegramChatId}` : "общая группа (TELEGRAM_CHAT_ID)"}`);
console.log(`\nВ организации сейчас:`);
for (const m of members) console.log(`  ${m.email.padEnd(28)} ${m.role.padEnd(16)} ${m.status}`);
if (!members.some((m) => m.role === "owner")) console.log(`  владельца нет — добавь --owner e-mail`);
console.log(`\nРестораны: ${locs.length ? "" : "пока нет — владелец добавит их сам на экране Restaurants & people"}`);
for (const l of locs) console.log(`  ${l.name}${l.deactivatedAt ? "  (закрыт)" : ""}`);
const orphans = await prisma.location.count({ where: { organizationId: null } });
if (orphans) console.log(`\nБез организации остаётся ресторанов: ${orphans} — --attach "имя", если они этого клиента`);
const loose = await prisma.user.findMany({ where: { organizationId: null, role: { not: "admin" } }, select: { email: true, role: true } });
if (loose.length) console.log(`Без организации остаются аккаунты: ${loose.map((u) => `${u.email} (${u.role})`).join(", ")} — --attach-user e-mail, если они этого клиента`);

await prisma.$disconnect();
