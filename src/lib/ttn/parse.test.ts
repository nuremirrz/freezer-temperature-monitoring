import { describe, it, expect } from "vitest";
import { parseTtnUplink, isProbeDisconnected, cToF, detectNodeType } from "./parse";
import ltc2Fixture from "../../../fixtures/ttn-uplink.json";
import lhtFixture from "../../../fixtures/ttn-uplink-lht65n.json";

function ok(body: unknown, now?: Date) {
  const r = parseTtnUplink(body, now);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.uplink;
}

describe("parseTtnUplink — LTC2", () => {
  it("parses the real Dragino LTC2 fixture", () => {
    const u = ok(ltc2Fixture);
    expect(u.devEui).toBe("A84041784362379C");
    expect(u.deviceId).toBe("draginotst2");
    expect(u.applicationId).toBe("draginolvl-test");
    expect(u.nodeType).toBe("LTC2");
    expect(u.unsupportedNodeType).toBe(false);
    expect(u.applicationId).toBe("draginolvl-test");
    expect(u.receivedAt.toISOString()).toBe("2026-09-10T08:44:17.887Z");
    expect(u.receivedAtFallback).toBe(false);
    expect(u.channels).toEqual([
      { channel: 1, tempF: 74.97 },
      { channel: 2, tempF: 61.16 },
    ]);
    expect(u.skippedChannels).toEqual([]);
    expect(u.batteryV).toBe(3.654);
    expect(u.batteryPct).toBe(100);
    expect(u.batStatus).toBeUndefined();
    expect(u.ambientTempF).toBeUndefined();
    expect(u.ambientHum).toBeUndefined();
    expect(u.gateway).toEqual({
      gatewayId: "lps8n-teaneck",
      eui: "A84041FFFF29BA77",
      rssi: -33,
      snr: 8.8,
    });
  });

  it("accepts the body wrapped in { data }, as some relays send it", () => {
    const u = ok({ data: ltc2Fixture });
    expect(u.devEui).toBe("A84041784362379C");
    expect(u.channels).toHaveLength(2);
  });

  it("skips a channel whose probe is not connected (327.67 °C)", () => {
    const body = structuredClone(ltc2Fixture);
    body.uplink_message.decoded_payload.Temp_Channel2 = 327.67;
    body.uplink_message.decoded_payload.TempF_Channel2 = cToF(327.67);
    const u = ok(body);
    expect(u.channels).toEqual([{ channel: 1, tempF: 74.97 }]);
    expect(u.skippedChannels).toEqual([2]);
  });

  it("skips the -0.01 °C placeholder too", () => {
    const body = structuredClone(ltc2Fixture);
    body.uplink_message.decoded_payload.Temp_Channel1 = -0.01;
    body.uplink_message.decoded_payload.TempF_Channel1 = 31.98;
    const u = ok(body);
    expect(u.channels.map((c) => c.channel)).toEqual([2]);
    expect(u.skippedChannels).toEqual([1]);
  });

  it("does not treat a real near-freezing reading as a placeholder when °C says otherwise", () => {
    const body = structuredClone(ltc2Fixture);
    body.uplink_message.decoded_payload.Temp_Channel1 = -0.02;
    body.uplink_message.decoded_payload.TempF_Channel1 = 31.96;
    const u = ok(body);
    expect(u.channels[0]).toEqual({ channel: 1, tempF: 31.96 });
  });

  it("tolerates missing rssi, battery and gateway metadata", () => {
    const body = {
      end_device_ids: { dev_eui: "a84041784362379c" },
      uplink_message: {
        decoded_payload: { Node_type: "LTC2", TempF_Channel1: 12.5 },
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
    expect(u.nodeType).toBe("LTC2"); // inferred from the field names
    expect(u.channels[0].tempF).toBeCloseTo(10.04, 2);
  });

  it("falls back to now when received_at is missing or invalid", () => {
    const now = new Date("2026-09-09T10:00:00Z");
    const u = ok(
      {
        end_device_ids: { dev_eui: "A84041784362379C" },
        uplink_message: { decoded_payload: { Node_type: "LTC2", TempF_Channel1: 1 }, received_at: "not-a-date" },
      },
      now,
    );
    expect(u.receivedAt).toEqual(now);
    expect(u.receivedAtFallback).toBe(true);
  });

  it("a known Node_type without temperatures is a heartbeat: no channels, still supported", () => {
    const u = ok({
      end_device_ids: { dev_eui: "A84041784362379C" },
      uplink_message: { decoded_payload: { Node_type: "LTC2", BatV: 3.6 } },
    });
    expect(u.unsupportedNodeType).toBe(false);
    expect(u.channels).toEqual([]);
    expect(u.batteryV).toBe(3.6);
  });

  it("picks the strongest gateway when several heard the uplink", () => {
    const body = structuredClone(ltc2Fixture);
    // The real capture types rx_metadata narrowly; a second gateway only needs these fields
    (body.uplink_message.rx_metadata as unknown as Record<string, unknown>[]).push({
      gateway_ids: { gateway_id: "lps8n-hackensack", eui: "A84041FFFF000001" },
      rssi: -20,
      snr: 11,
    });
    expect(ok(body).gateway?.gatewayId).toBe("lps8n-hackensack");
  });
});

describe("parseTtnUplink — LHT65N", () => {
  it("parses the LHT65N fixture: one probe channel plus ambient values", () => {
    const u = ok(lhtFixture);
    expect(u.devEui).toBe("A84041B54D625182");
    expect(u.deviceId).toBe("draginotst");
    expect(u.nodeType).toBe("LHT65N");
    expect(u.unsupportedNodeType).toBe(false);
    expect(u.receivedAt.toISOString()).toBe("2026-09-10T08:45:13.976Z"); // uplink_message.received_at wins
    expect(u.channels).toEqual([{ channel: 1, tempF: 75.76 }]);
    expect(u.skippedChannels).toEqual([]);
    expect(u.ambientTempF).toBe(75.81);
    expect(u.ambientHum).toBe(70.1);
    expect(u.batStatus).toBe("Good");
    expect(u.batteryV).toBe(3.067);
    expect(u.batteryPct).toBe(100);
    expect(u.gateway?.gatewayId).toBe("lps8n-teaneck");
  });

  it("never produces a channel 2 for LHT65N", () => {
    const body = structuredClone(lhtFixture);
    // even if a stray LTC2-style field appears, the LHT65N branch ignores it
    (body.uplink_message.decoded_payload as Record<string, unknown>).TempF_Channel2 = 40;
    const u = ok(body);
    expect(u.channels.map((c) => c.channel)).toEqual([1]);
  });

  it("skips a disconnected external probe but still reports ambient values", () => {
    const body = structuredClone(lhtFixture);
    body.uplink_message.decoded_payload.TempC_TMP117 = 327.67;
    body.uplink_message.decoded_payload.TempF_TMP117 = cToF(327.67);
    const u = ok(body);
    expect(u.channels).toEqual([]);
    expect(u.skippedChannels).toEqual([1]);
    expect(u.ambientTempF).toBe(75.81);
    expect(u.ambientHum).toBe(70.1);
  });

  it("treats the -0.01 °C sentinel on TMP117 as disconnected", () => {
    const body = structuredClone(lhtFixture);
    body.uplink_message.decoded_payload.TempC_TMP117 = -0.01;
    body.uplink_message.decoded_payload.TempF_TMP117 = 31.98;
    expect(ok(body).skippedChannels).toEqual([1]);
  });

  it("converts Celsius when only TempC_TMP117 / TempC_SHT are present", () => {
    const u = ok({
      end_device_ids: { dev_eui: "A84041B54D625182" },
      uplink_message: {
        decoded_payload: { Node_type: "LHT65N", TempC_TMP117: -20, TempC_SHT: 21, Hum_SHT: 50 },
        received_at: "2026-09-09T03:26:02Z",
      },
    });
    expect(u.channels[0].tempF).toBeCloseTo(-4, 5);
    expect(u.ambientTempF).toBeCloseTo(69.8, 5);
    expect(u.ambientHum).toBe(50);
  });

  it("infers LHT65N when Node_type is missing but TMP117/SHT fields are present", () => {
    const u = ok({
      end_device_ids: { dev_eui: "A84041B54D625182" },
      uplink_message: { decoded_payload: { TempF_TMP117: 3.2, Hum_SHT: 40 } },
    });
    expect(u.nodeType).toBe("LHT65N");
    expect(u.channels).toEqual([{ channel: 1, tempF: 3.2 }]);
  });

  it("works without the ambient sensor fields", () => {
    const u = ok({
      end_device_ids: { dev_eui: "A84041B54D625182" },
      uplink_message: { decoded_payload: { Node_type: "LHT65N", TempF_TMP117: 5 } },
    });
    expect(u.channels).toEqual([{ channel: 1, tempF: 5 }]);
    expect(u.ambientTempF).toBeUndefined();
    expect(u.ambientHum).toBeUndefined();
  });

  it("normalizes Node_type case and whitespace", () => {
    const u = ok({
      end_device_ids: { dev_eui: "A84041B54D625182" },
      uplink_message: { decoded_payload: { Node_type: " lht65n ", TempF_TMP117: 5 } },
    });
    expect(u.nodeType).toBe("LHT65N");
    expect(u.unsupportedNodeType).toBe(false);
  });
});

describe("parseTtnUplink — unknown Node_type", () => {
  it("parses but marks the uplink unsupported and yields no channels", () => {
    const u = ok({
      end_device_ids: { dev_eui: "A8404113CA625184" },
      uplink_message: {
        decoded_payload: { Node_type: "LSN50v2", Temp1: 12.3, BatV: 3.4 },
        received_at: "2026-09-09T03:30:00Z",
      },
    });
    expect(u.nodeType).toBe("LSN50V2");
    expect(u.unsupportedNodeType).toBe(true);
    expect(u.channels).toEqual([]);
    expect(u.batteryV).toBe(3.4); // heartbeat data is still usable
  });

  it("is unsupported when there is no Node_type and nothing to infer from", () => {
    const u = ok({ end_device_ids: { dev_eui: "A84041784362379C" }, uplink_message: {} });
    expect(u.nodeType).toBeUndefined();
    expect(u.unsupportedNodeType).toBe(true);
    expect(u.channels).toEqual([]);
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

describe("real captures from The Things Stack", () => {
  it("LTC2: ignores Ext and Systimestamp, prefers uplink_message.received_at over the top-level one", () => {
    const u = ok(ltc2Fixture);
    const payload = ltc2Fixture.uplink_message.decoded_payload as Record<string, unknown>;
    expect(payload.Ext).toBe(1); // present in the capture, deliberately unused
    expect(payload.Systimestamp).toBeDefined(); // device clock, not trusted
    // top-level received_at is 08:44:18.098, the message one is 08:44:17.887
    expect(u.receivedAt.toISOString()).toBe("2026-09-10T08:44:17.887Z");
  });

  it("LHT65N: carries Ext_sensor without tripping the parser", () => {
    const payload = lhtFixture.uplink_message.decoded_payload as Record<string, unknown>;
    expect(payload.Ext_sensor).toBe("Temperature Sensor");
    const u = ok(lhtFixture);
    expect(u.nodeType).toBe("LHT65N");
    expect(u.channels).toEqual([{ channel: 1, tempF: 75.76 }]);
  });

  it("both captures keep the probe reading separate from the device's own air sensor", () => {
    const lht = ok(lhtFixture);
    expect(lht.channels[0].tempF).toBe(75.76); // TMP117, the external probe
    expect(lht.ambientTempF).toBe(75.81); // SHT, the built-in sensor
    expect(ok(ltc2Fixture).ambientTempF).toBeUndefined(); // LTC2 has no air sensor
  });
});

describe("detectNodeType", () => {
  it("prefers the declared Node_type", () => {
    expect(detectNodeType({ Node_type: "LTC2", TempF_TMP117: 1 })).toBe("LTC2");
  });
  it("infers from field names", () => {
    expect(detectNodeType({ TempF_Channel2: 1 })).toBe("LTC2");
    expect(detectNodeType({ Hum_SHT: 40 })).toBe("LHT65N");
    expect(detectNodeType({ BatV: 3 })).toBeUndefined();
    expect(detectNodeType(undefined)).toBeUndefined();
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
