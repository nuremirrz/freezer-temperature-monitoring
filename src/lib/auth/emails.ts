import type { Mail } from "./mailer";

const APP_NAME = "Qimby — Freezer Temperature Monitor";

function layout(title: string, body: string, cta: { href: string; label: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#101828">
  <div style="max-width:520px;margin:32px auto;background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:32px">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#98a2b3;margin-bottom:12px">${APP_NAME}</div>
    <h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
    <p style="font-size:15px;line-height:1.6;color:#344054;margin:0 0 20px">${body}</p>
    <a href="${cta.href}" style="display:inline-block;background:#0e1b33;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${cta.label}</a>
    <p style="font-size:12px;color:#98a2b3;margin:24px 0 0;word-break:break-all">If the button doesn't work, open this link:<br>${cta.href}</p>
  </div></body></html>`;
}

export function verifyEmailMail(to: string, link: string): Mail {
  return {
    to,
    subject: "Confirm your e-mail — Qimby",
    text: `Confirm your e-mail address to finish creating your Qimby account:\n\n${link}\n\nThe link is valid for 24 hours. If you didn't create an account, ignore this message.`,
    html: layout(
      "Confirm your e-mail",
      "One more step to finish creating your account. The link is valid for 24 hours. If you didn't create an account, you can ignore this message.",
      { href: link, label: "Confirm e-mail" },
    ),
  };
}

export function resetPasswordMail(to: string, link: string): Mail {
  return {
    to,
    subject: "Reset your password — Qimby",
    text: `Someone asked to reset the password for your Qimby account. Set a new one here:\n\n${link}\n\nThe link is valid for 1 hour. If it wasn't you, ignore this message — your password stays the same.`,
    html: layout(
      "Reset your password",
      "Someone asked to reset the password for your account. The link is valid for 1 hour. If it wasn't you, ignore this message — your password stays the same.",
      { href: link, label: "Set a new password" },
    ),
  };
}
