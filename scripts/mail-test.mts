import "./load-env";
import { mailerMode, sendMail } from "../src/lib/auth/mailer";
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
try {
  await sendMail(mail);
  if (mailerMode() === "console") {
    console.log(`\nЭто был вывод в консоль, а не письмо. Задай SMTP_URL, чтобы отправить по-настоящему.`);
  } else {
    console.log(`\n✓ Сервер принял письмо. Тема: "${mail.subject}"`);
    console.log(`  Принял — не значит «доставил»: проверь «Входящие», а если пусто, «Спам» и «Промоакции».`);
  }
} catch (e) {
  const err = e as { code?: string; response?: string; message: string };
  console.error(`\n✗ Не отправилось: ${err.message}`);
  if (err.code) console.error(`  код: ${err.code}`);
  if (err.response) console.error(`  ответ сервера: ${err.response}`);
  if (err.code === "EAUTH") {
    console.error(`  Обычно это значит: двухфакторка не включена, либо в SMTP_URL обычный пароль,`);
    console.error(`  а не пароль приложения, либо в нём остались пробелы.`);
  }
  process.exit(1);
}
