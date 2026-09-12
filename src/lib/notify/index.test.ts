import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { notify, notificationHealth, formatAlertMessage } from "./index";

/**
 * The contract that matters here is the return value: callers stamp `lastNotifiedAt` from it,
 * and stamping a message that never went out arms the 30-minute cooldown with a notification
 * nobody received — which is exactly how a stale Telegram chat id silenced the alerts for two
 * days and then swallowed the "back to normal" messages behind it.
 */

const OPENED = {
  kind: "opened",
  alertType: "temp_out_of_range",
  locationName: "Burger King #6816",
  unitName: "Walk-in Freezer",
  tempF: 17.7,
  rangeMinF: -30,
  rangeMaxF: 20,
  durationMin: 65,
} as const;

describe("notify", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "-1004480943246";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    vi.restoreAllMocks();
  });

  it("reports success when Telegram accepts the message", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch;
    await expect(notify(OPENED)).resolves.toBe(true);
    expect(notificationHealth().lastOkAt).not.toBeNull();
  });

  it("reports failure when Telegram rejects the message", async () => {
    // The real 400 that went unnoticed: the group had been upgraded to a supergroup.
    const body = JSON.stringify({
      ok: false,
      error_code: 400,
      description: "Bad Request: group chat was upgraded to a supergroup chat",
    });
    globalThis.fetch = vi.fn(async () => new Response(body, { status: 400 })) as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(notify(OPENED)).resolves.toBe(false);

    const health = notificationHealth();
    expect(health.channel).toBe("telegram");
    expect(health.lastError).toContain("supergroup");
    expect(health.failures).toBeGreaterThan(0);
  });

  it("reports failure when the request itself throws", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network unreachable");
    }) as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(notify(OPENED)).resolves.toBe(false);
    expect(notificationHealth().lastError).toContain("network unreachable");
  });

  it("falls back to the console, and counts as delivered, when Telegram is not configured", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(notify(OPENED)).resolves.toBe(true);
    expect(notificationHealth().channel).toBe("console");
  });
});

describe("formatAlertMessage", () => {
  it("names the unit, the reading and the range it left", () => {
    const text = formatAlertMessage(OPENED);
    expect(text).toContain("BK #6816");
    expect(text).toContain("Walk-in Freezer");
    expect(text).toContain("17.7°F");
    expect(text).toContain("1 ч 5 мин");
  });
});
