import nodemailer, { type Transporter } from "nodemailer";
import { resolve4 } from "node:dns/promises";

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

export type MailerMode = "brevo" | "smtp" | "console";

/**
 * How mail leaves the building.
 *
 * "brevo" goes out over HTTPS and is preferred wherever it is configured, because SMTP does not
 * work everywhere: Render blocks outbound 587 and 465, so the same credentials that send fine
 * from a laptop time out in production. Port 443 is never blocked — it is the web.
 */
export function mailerMode(): MailerMode {
  if (process.env.BREVO_API_KEY) return "brevo";
  if (process.env.SMTP_URL) return "smtp";
  return "console";
}

const DEFAULT_FROM = "Qimby <no-reply@qimby.app>";

export interface Address {
  email: string;
  name?: string;
}

/** Splits `Name <a@b.c>` into its parts; a bare address comes back without a name. */
export function parseAddress(value: string): Address {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (!m) return { email: value.trim() };
  const name = m[1].replace(/^"|"$/g, "").trim();
  return name ? { email: m[2].trim(), name } : { email: m[2].trim() };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Brevo's transactional endpoint. Throws with the server's own words when it refuses. */
async function sendViaBrevo(mail: Mail): Promise<void> {
  const replyTo = process.env.MAIL_REPLY_TO;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY as string,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: parseAddress(process.env.MAIL_FROM ?? DEFAULT_FROM),
      to: [{ email: mail.to }],
      subject: mail.subject,
      // htmlContent is required by the API; a plain-text-only mail still needs a body.
      htmlContent: mail.html ?? `<pre>${escapeHtml(mail.text)}</pre>`,
      textContent: mail.text,
      ...(replyTo ? { replyTo: parseAddress(replyTo) } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brevo ${res.status}: ${body.slice(0, 200)}`);
  }
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
 * Builds the SMTP transport, pinned to an IPv4 address.
 *
 * Render's containers have no route out over IPv6, and smtp.gmail.com publishes both an A and
 * an AAAA record. nodemailer resolves the name itself and reached for the AAAA, which failed
 * with ENETUNREACH while the same URL worked from a laptop — the one difference being whose
 * network it ran on. Resolving the A record here keeps it on a road that exists. The hostname
 * still travels as the TLS server name, so the certificate matches the address we dialled.
 *
 * `family: 4` would be the obvious fix and does nothing: nodemailer assembles its own connect
 * options and never forwards it.
 */
async function buildTransport(url: URL): Promise<Transporter> {
  const [ipv4] = await resolve4(url.hostname);
  return nodemailer.createTransport({
    host: ipv4,
    servername: url.hostname,
    port: Number(url.port) || 587,
    secure: url.port === "465",
    // Never hand the password to a server that has not put the connection under TLS first.
    requireTLS: true,
    auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) },
    // nodemailer waits two minutes to give up on a connection. A password reset that hangs the
    // browser for two minutes before failing is worse than one that fails in ten seconds.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

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
    if (mailerMode() === "brevo") {
      await sendViaBrevo(mail);
      lastOkAt = new Date().toISOString();
      return true;
    }
    transport ??= await buildTransport(new URL(process.env.SMTP_URL as string));
    await transport.sendMail({
      from: process.env.MAIL_FROM ?? DEFAULT_FROM,
      // A no-reply address that silently swallows replies is worse than no address at all: the
      // one person who writes back to say "the link didn't work" is the one worth hearing from.
      ...(process.env.MAIL_REPLY_TO ? { replyTo: process.env.MAIL_REPLY_TO } : {}),
      ...mail,
    });
    lastOkAt = new Date().toISOString();
    return true;
  } catch (err) {
    // Rebuild next time: the address we pinned may have moved, or the transport may be wedged.
    transport = null;
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
