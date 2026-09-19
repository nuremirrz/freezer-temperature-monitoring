import "./load-env";
import { mailerMode, mailStatus, sendMail } from "../src/lib/auth/mailer";
import { resetPasswordMail } from "../src/lib/auth/emails";

/**
 * Sends one real e-mail, so the mailbox can be proven before Render depends on it.
 *
 *   SMTP_URL="smtp://…" MAIL_FROM="Qimby <…>" npm run mail:test -- --to you@example.com
 *
 * It sends the password-reset template rather than a "test" line, because what matters is not
 * that SMTP connects — it is whether this exact message reaches an inbox instead of spam. The
 * link inside is deliberately dead: nothing is written, no account is touched, no database is
 * read. Credentials come from the environment and are never printed back.
 */

const to = process.argv[process.argv.indexOf("--to") + 1];
if (!to || !to.includes("@")) {
  console.error("Укажи получателя:  npm run mail:test -- --to you@example.com");
  process.exit(1);
}

const from = process.env.MAIL_FROM ?? "(не задан — уйдёт значение по умолчанию)";
// load-env announces DATABASE_URL on every script; say plainly that this one ignores it.
console.log(`(база данных не используется — скрипт только отправляет письмо)\n`);
console.log(`канал:      ${mailerMode()}`);
console.log(`отправитель: ${from}`);
console.log(`reply-to:   ${process.env.MAIL_REPLY_TO ?? "(не задан)"}`);
console.log(`получатель: ${to}`);

if (mailerMode() === "console") {
  console.log(`\nSMTP_URL не задан, поэтому письмо не уйдёт — оно будет напечатано ниже.`);
}

const mail = resetPasswordMail(to, "https://example.invalid/reset?token=mail-test-not-a-real-link");

// sendMail reports failure rather than throwing, so that a dead mail server cannot take a
// registration down with it. That makes the return value the only thing worth checking here.
const ok = await sendMail(mail);

if (mailerMode() === "console") {
  console.log(`\nЭто был вывод в консоль, а не письмо. Задай SMTP_URL, чтобы отправить по-настоящему.`);
  process.exit(0);
}

if (ok) {
  console.log(`\n✓ Сервер принял письмо. Тема: "${mail.subject}"`);
  console.log(`  Принял — не значит «доставил»: проверь «Входящие», а если пусто, «Спам» и «Промоакции».`);
  process.exit(0);
}

const err = mailStatus().lastError ?? "(без подробностей)";
console.error(`\n✗ Не отправилось: ${err}`);
if (/Invalid login|535|BadCredentials/i.test(err)) {
  console.error(`\n  Google не принял логин с паролем. Обычно это одно из трёх:`);
  console.error(`    • в SMTP_URL обычный пароль от ящика, а нужен пароль приложения;`);
  console.error(`    • в пароле остались пробелы — Google показывает его группами, это оформление;`);
  console.error(`    • на ящике не включена двухфакторка.`);
} else if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EDNS/i.test(err)) {
  console.error(`\n  До сервера не достучались: проверь адрес и порт (smtp.gmail.com:587).`);
}
process.exit(1);
