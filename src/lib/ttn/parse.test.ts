import { describe, it, expect } from "vitest";
import { parseTtnUplink, isProbeDisconnected, cToF } from "./parse";
import fixture from "../../../fixtures/ttn-uplink.json";

function ok(body: unknown, now?: Date) {
  const r = parseTtnUplink(body, now);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.uplink;
}

describe("parseTtnUplink", () => {
  it("parses the real Dragino LTC2 fixture", () => {
    const u = ok(fixture);
    expect(u.devEui).toBe("A84041784362379C");
    expect(u.deviceId).toBe("draginotst2");
    expect(u.applicationId).toBe("draginolvl-test");
    expect(u.fCnt).toBe(5082);
    expect(u.receivedAt.toISOString()).toBe("2026-09-09T03:24:15.863Z");
    expect(u.receivedAtFallback).toBe(false);
    expect(u.channels).toEqual([
      { channel: 1, tempF: 76.05 },
      { channel: 2, tempF: 61.29 },
    ]);
    expect(u.skippedChannels).toEqual([]);
    expect(u.batteryV).toBe(3.65);
    expect(u.batteryPct).toBe(100);
    expect(u.gateway).toEqual({
      gatewayId: "lps8n-teaneck",
      eui: "A84041FFFF29BA77",
      rssi: -34,
      snr: 9.8,
    });
  });

  it("accepts the body without the { data } wrapper", () => {
    const u = ok((fixture as { data: unknown }).data);
    expect(u.devEui).toBe("A84041784362379C");
    expect(u.channels).toHaveLength(2);
  });

  it("skips a channel whose probe is not connected (327.67 °C)", () => {
    const body = structuredClone(fixture);
    body.data.uplink_message.decoded_payload.Temp_Channel2 = 327.67;
    body.data.uplink_message.decoded_payload.TempF_Channel2 = cToF(327.67);
    const u = ok(body);
    expect(u.channels).toEqual([{ channel: 1, tempF: 76.05 }]);
    expect(u.skippedChannels).toEqual([2]);
  });

  it("skips the -0.01 °C placeholder too", () => {
    const body = structuredClone(fixture);
    body.data.uplink_message.decoded_payload.Temp_Channel1 = -0.01;
    body.data.uplink_message.decoded_payload.TempF_Channel1 = 31.98;
    const u = ok(body);
    expect(u.channels.map((c) => c.channel)).toEqual([2]);
    expect(u.skippedChannels).toEqual([1]);
  });

  it("does not treat a real near-freezing reading as a placeholder when °C says otherwise", () => {
    const body = structuredClone(fixture);
    body.data.uplink_message.decoded_payload.Temp_Channel1 = -0.02;
    body.data.uplink_message.decoded_payload.TempF_Channel1 = 31.96;
    const u = ok(body);
    expect(u.channels[0]).toEqual({ channel: 1, tempF: 31.96 });
  });

  it("tolerates missing rssi, battery and gateway metadata", () => {
    const body = {
      end_device_ids: { dev_eui: "a84041784362379c" },
      uplink_message: {
        decoded_payload: { TempF_Channel1: 12.5 },
        received_at: "2026-09-09T03:24:15Z",
      },
    };
    const u = ok(body);
    expect(u.devEui).toBe("A84041784362379C"); // normalized to uppercase
    expect(u.channels).toEqual([{ channel: 1, tempF: 12.5 }]);
    expect(u.batteryV).toBeUndefined();
    expect(u.batteryPct).toBeUndefined();
    expect(u.gateway).toBeUndefined();
  });

  it("converts Celsius when only Temp_ChannelN is present", () => {
    const body = {
      end_device_ids: { dev_eui: "A84041784362379C" },
      uplink_message: { decoded_payload: { Temp_Channel1: -12.2 }, received_at: "2026-09-09T03:24:15Z" },
    };
    const u = ok(body);
    expect(u.channels[0].tempF).toBeCloseTo(10.04, 2);
  });

  it("falls back to now when received_at is missing or invalid", () => {
    const now = new Date("2026-09-09T10:00:00Z");
    const u = ok(
      {
        end_device_ids: { dev_eui: "A84041784362379C" },
        uplink_message: { decoded_payload: { TempF_Channel1: 1 }, received_at: "not-a-date" },
      },
      now,
    );
    expect(u.receivedAt).toEqual(now);
    expect(u.receivedAtFallback).toBe(true);
  });

  it("handles a payload without decoded temperatures (no channels, still ok)", () => {
    const u = ok({ end_device_ids: { dev_eui: "A84041784362379C" }, uplink_message: {} });
    expect(u.channels).toEqual([]);
    expect(u.skippedChannels).toEqual([]);
  });

  it("picks the strongest gateway when several heard the uplink", () => {
    const body = structuredClone(fixture);
    body.data.uplink_message.rx_metadata.push({
      gateway_ids: { gateway_id: "lps8n-hackensack", eui: "A84041FFFF000001" },
      rssi: -20,
      snr: 11,
    });
    expect(ok(body).gateway?.gatewayId).toBe("lps8n-hackensack");
  });

  it("rejects a body without dev_eui", () => {
    const r = parseTtnUplink({ uplink_message: { decoded_payload: { TempF_Channel1: 1 } } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/dev_eui|end_device_ids/);
  });

  it("rejects non-object bodies", () => {
    expect(parseTtnUplink("nope").ok).toBe(false);
    expect(parseTtnUplink(null).ok).toBe(false);
  });
});

describe("isProbeDisconnected", () => {
  it("detects both Dragino sentinels", () => {
    expect(isProbeDisconnected(327.67, undefined)).toBe(true);
    expect(isProbeDisconnected(-0.01, undefined)).toBe(true);
    expect(isProbeDisconnected(undefined, cToF(327.67))).toBe(true);
  });
  it("passes ordinary temperatures", () => {
    expect(isProbeDisconnected(-18.3, undefined)).toBe(false);
    expect(isProbeDisconnected(undefined, 15.2)).toBe(false);
  });
  it("treats a channel with no values as disconnected", () => {
    expect(isProbeDisconnected(undefined, undefined)).toBe(true);
  });
});
