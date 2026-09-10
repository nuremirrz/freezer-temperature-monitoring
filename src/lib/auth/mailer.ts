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

let transport: Transporter | null = null;

export async function sendMail(mail: Mail): Promise<void> {
  if (mailerMode() === "console") {
    console.log(`[mail] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
    return;
  }
  transport ??= nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({
    from: process.env.MAIL_FROM ?? "Qimby <no-reply@qimby.app>",
    ...mail,
  });
}
