import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// vi.mock is hoisted above the file's own declarations, so the mocks have to be created in a
// hoisted block too — otherwise the factory runs before the consts exist.
const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn();
  return { sendMailMock, createTransportMock: vi.fn(() => ({ sendMail: sendMailMock })) };
});
vi.mock("nodemailer", () => ({ default: { createTransport: createTransportMock } }));
vi.mock("node:dns/promises", () => ({ resolve4: async () => ["142.251.127.108"] }));

import { sendMail, mailStatus, mailerMode, resetMailerForTests, type Mail } from "./mailer";

const MAIL: Mail = { to: "owner@example.com", subject: "Reset your password — Qimby", text: "link" };

describe("sendMail", () => {
  const env = { ...process.env };

  beforeEach(() => {
    sendMailMock.mockReset().mockResolvedValue({ accepted: [MAIL.to] });
    createTransportMock.mockClear();
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
  /**
   * The bug this guards. Render's containers have no IPv6 route, smtp.gmail.com publishes an
   * AAAA record, and nodemailer reached for it — ENETUNREACH on production while the identical
   * URL worked from a laptop. Dialling the A record directly is what fixed it; the hostname has
   * to survive as the TLS server name or the certificate stops matching.
   */
  it("dials an IPv4 address while keeping the hostname for TLS", async () => {
    process.env.SMTP_URL = "smtp://qimby.app@gmail.com:abcdefghijklmnop@smtp.gmail.com:587";

    await sendMail(MAIL);

    const opts = createTransportMock.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(opts.host).toBe("142.251.127.108");
    expect(opts.servername).toBe("smtp.gmail.com");
    expect(opts.port).toBe(587);
    expect(opts.secure).toBe(false);
    expect(opts.requireTLS).toBe(true);
  });

  it("reads the login out of a URL that carries an @ in the username", async () => {
    process.env.SMTP_URL = "smtp://qimby.app@gmail.com:abcdefghijklmnop@smtp.gmail.com:587";

    await sendMail(MAIL);

    const opts = createTransportMock.mock.calls[0][0] as unknown as { auth: { user: string; pass: string } };
    expect(opts.auth.user).toBe("qimby.app@gmail.com");
    expect(opts.auth.pass).toBe("abcdefghijklmnop");
  });

  it("gives up on a dead server in seconds, not in nodemailer's two minutes", async () => {
    process.env.SMTP_URL = "smtp://u:p@smtp.example.com:587";

    await sendMail(MAIL);

    const opts = createTransportMock.mock.calls[0][0] as unknown as Record<string, number>;
    expect(opts.connectionTimeout).toBeLessThanOrEqual(15_000);
    expect(opts.greetingTimeout).toBeLessThanOrEqual(15_000);
  });

  it("builds a fresh transport after a failure, so a moved address is picked up", async () => {
    process.env.SMTP_URL = "smtp://u:p@smtp.example.com:587";
    sendMailMock.mockRejectedValueOnce(new Error("connect ENETUNREACH"));

    await sendMail(MAIL);
    sendMailMock.mockResolvedValue({});
    await sendMail(MAIL);

    expect(createTransportMock).toHaveBeenCalledTimes(2);
  });
});
