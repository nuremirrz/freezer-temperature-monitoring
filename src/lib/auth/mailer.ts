import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outgoing e-mail. With SMTP_URL set, messages go through that SMTP server (the provider is a
 * third-party service — its choice must be approved as "sensitive data" before it is configured).
 * Without it, messages are printed to the server console — good enough for development.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type MailerMode = "smtp" | "console";

export function mailerMode(): MailerMode {
  return process.env.SMTP_URL ? "smtp" : "console";
}

export interface MailStatus {
  /** Where mail is going: "smtp" when a server is configured, "console" otherwise. */
  channel: MailerMode;
  lastOkAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  /** Failures since this process started. */
  failures: number;
}

let lastOkAt: string | null = null;
let lastFailedAt: string | null = null;
let lastError: string | null = null;
let failures = 0;

export function mailStatus(): MailStatus {
  return { channel: mailerMode(), lastOkAt, lastFailedAt, lastError, failures };
}

let transport: Transporter | null = null;

/**
 * Sends one message. Never throws.
 *
 * A wrong password in SMTP_URL used to take the whole request down with it, and registration
 * was the bad case: the account is created first, so the caller got a 500 *after* the row
 * existed, and every retry walked into the same failing send — an account nobody could finish
 * signing up for and nobody could register again. Mail is a side effect of those flows, not
 * their purpose, so a dead mail server must not decide whether they succeed.
 *
 * The failure is not swallowed, it is recorded: /api/health reports it, which is how the
 * silent Telegram outage of 11–13 Sep is not repeated here.
 *
 * @returns whether the message actually went out
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (mailerMode() === "console") {
    console.log(`[mail] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
    return true;
  }
  try {
    transport ??= nodemailer.createTransport(process.env.SMTP_URL);
    await transport.sendMail({
      from: process.env.MAIL_FROM ?? "Qimby <no-reply@qimby.app>",
      // A no-reply address that silently swallows replies is worse than no address at all: the
      // one person who writes back to say "the link didn't work" is the one worth hearing from.
      ...(process.env.MAIL_REPLY_TO ? { replyTo: process.env.MAIL_REPLY_TO } : {}),
      ...mail,
    });
    lastOkAt = new Date().toISOString();
    return true;
  } catch (err) {
    lastFailedAt = new Date().toISOString();
    lastError = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    failures++;
    // Nothing here is secret — nodemailer's errors carry the server's reply, not the password.
    console.error(`[mail] failed to=${mail.to} subject="${mail.subject}": ${lastError}`);
    return false;
  }
}

/** Test seam: forget the cached transport and the recorded outcomes. */
export function resetMailerForTests(): void {
  transport = null;
  lastOkAt = lastFailedAt = lastError = null;
  failures = 0;
}
