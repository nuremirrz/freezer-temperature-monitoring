import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const sendMailMock = vi.fn();
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));

import { sendMail, mailStatus, mailerMode, resetMailerForTests, type Mail } from "./mailer";

const MAIL: Mail = { to: "owner@example.com", subject: "Reset your password — Qimby", text: "link" };

describe("sendMail", () => {
  const env = { ...process.env };

  beforeEach(() => {
    sendMailMock.mockReset().mockResolvedValue({ accepted: [MAIL.to] });
    resetMailerForTests();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
    delete process.env.MAIL_REPLY_TO;
  });

  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("prints instead of sending when no server is configured", async () => {
    expect(mailerMode()).toBe("console");
    await expect(sendMail(MAIL)).resolves.toBe(true);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sends through the configured server and records the success", async () => {
    process.env.SMTP_URL = "smtp://user:pass@smtp.example.com:587";
    process.env.MAIL_FROM = "Qimby <no-reply@example.com>";

    await expect(sendMail(MAIL)).resolves.toBe(true);

    const sent = sendMailMock.mock.calls[0][0];
    expect(sent.from).toBe("Qimby <no-reply@example.com>");
    expect(sent.to).toBe(MAIL.to);
    expect(sent).not.toHaveProperty("replyTo");
    expect(mailStatus()).toMatchObject({ channel: "smtp", failures: 0, lastError: null });
    expect(mailStatus().lastOkAt).not.toBeNull();
  });

  it("sets a reply address only when one is configured", async () => {
    process.env.SMTP_URL = "smtp://user:pass@smtp.example.com:587";
    process.env.MAIL_REPLY_TO = "support@example.com";

    await sendMail(MAIL);

    expect(sendMailMock.mock.calls[0][0].replyTo).toBe("support@example.com");
  });

  /**
   * The point of the whole module. Registration creates the account and *then* sends the
   * confirmation, so a throw here used to 500 the request with the row already written — and
   * every retry hit the same failing send. A rejected password must not cost an account.
   */
  it("does not throw when the server rejects us, and says so in the status", async () => {
    process.env.SMTP_URL = "smtp://user:wrong@smtp.example.com:587";
    sendMailMock.mockRejectedValue(
      Object.assign(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"), { code: "EAUTH" }),
    );

    await expect(sendMail(MAIL)).resolves.toBe(false);

    const status = mailStatus();
    expect(status.failures).toBe(1);
    expect(status.lastError).toContain("Username and Password not accepted");
    expect(status.lastFailedAt).not.toBeNull();
    expect(status.lastOkAt).toBeNull();
  });

  it("keeps counting failures rather than giving up silently", async () => {
    process.env.SMTP_URL = "smtp://user:wrong@smtp.example.com:587";
    sendMailMock.mockRejectedValue(new Error("connect ETIMEDOUT"));

    await sendMail(MAIL);
    await sendMail(MAIL);

    expect(mailStatus().failures).toBe(2);
  });
});
