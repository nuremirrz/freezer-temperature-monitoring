import { z } from "zod";

/**
 * Tolerant parser for The Things Network uplink webhooks from a mixed Dragino fleet.
 *
 *  - LTC2   — two external probes: TempF_Channel1 / TempF_Channel2 → channels 1 and 2
 *  - LHT65N — one external probe (TempF_TMP117 → channel 1) plus a built-in air sensor
 *             (TempF_SHT / Hum_SHT → ambient values on the Sensor, never a Reading)
 *
 * The branch is chosen by `decoded_payload.Node_type`; when it is missing we infer it
 * from the fields present. An unknown Node_type parses fine but yields no channels and
 * `unsupportedNodeType: true`, so ingest can file it under UnknownUplink instead of failing.
 *
 * Only `end_device_ids.dev_eui` is required. Everything else is optional so a missing
 * rssi / battery / channel never prevents a temperature from being stored.
 * The body may be the raw TTN webhook or wrapped in `{ data: ... }`.
 */

export type Channel = 1 | 2;
export type NodeType = "LTC2" | "LHT65N";
export const SUPPORTED_NODE_TYPES: readonly NodeType[] = ["LTC2", "LHT65N"];

export interface ParsedChannel {
  channel: Channel;
  tempF: number;
}

export interface ParsedGateway {
  gatewayId?: string;
  eui?: string;
  rssi?: number;
  snr?: number;
}

export interface ParsedUplink {
  devEui: string; // normalized to uppercase hex
  deviceId?: string;
  applicationId?: string;
  fCnt?: number;
  receivedAt: Date;
  /** true when received_at was missing/invalid and we fell back to "now" */
  receivedAtFallback: boolean;
  /** Node_type as reported by the decoder, or inferred from the payload fields */
  nodeType?: string;
  /** true when Node_type is not one we know how to read — no channels are produced */
  unsupportedNodeType: boolean;
  /** Channels with a real temperature (unconnected probes are excluded) */
  channels: ParsedChannel[];
  /** Channels that reported a "probe not connected" placeholder */
  skippedChannels: Channel[];
  batteryV?: number;
  batteryPct?: number;
  /** Dragino Bat_status, e.g. "Good" (LHT65N) */
  batStatus?: string;
  /** LHT65N built-in air sensor */
  ambientTempF?: number;
  ambientHum?: number;
  /** Strongest gateway that heard the uplink */
  gateway?: ParsedGateway;
}

export type ParseResult =
  | { ok: true; uplink: ParsedUplink }
  | { ok: false; error: string };

const num = z.number().finite().optional();

const decodedPayloadSchema = z.looseObject({
  Node_type: z.string().optional(),
  BatV: num,
  Bat_status: z.string().optional(),
  // LTC2
  TempF_Channel1: num,
  TempF_Channel2: num,
  Temp_Channel1: num,
  Temp_Channel2: num,
  // LHT65N
  TempF_TMP117: num,
  TempC_TMP117: num,
  TempF_SHT: num,
  TempC_SHT: num,
  Hum_SHT: num,
});
type DecodedPayload = z.infer<typeof decodedPayloadSchema>;

const rxMetadataSchema = z.looseObject({
  gateway_ids: z
    .looseObject({
      gateway_id: z.string().optional(),
      eui: z.string().optional(),
    })
    .optional(),
  rssi: num,
  snr: num,
});

const uplinkSchema = z.looseObject({
  end_device_ids: z.looseObject({
    device_id: z.string().optional(),
    dev_eui: z.string().min(1),
    application_ids: z.looseObject({ application_id: z.string().optional() }).optional(),
  }),
  received_at: z.string().optional(),
  uplink_message: z
    .looseObject({
      f_cnt: z.number().int().optional(),
      decoded_payload: decodedPayloadSchema.optional(),
      rx_metadata: z.array(rxMetadataSchema).optional(),
      received_at: z.string().optional(),
      last_battery_percentage: z.looseObject({ value: num }).optional(),
    })
    .optional(),
});

/** Dragino reports these when a probe is not connected. */
const PLACEHOLDER_C = [327.67, -0.01];
const PLACEHOLDER_F = PLACEHOLDER_C.map(cToF); // 621.806, 31.982

export function cToF(c: number): number {
  return c * (9 / 5) + 32;
}

const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

/**
 * A probe reads as "disconnected" when its Celsius value is one of Dragino's
 * sentinel values. When only °F is present we check the converted sentinels.
 */
export function isProbeDisconnected(tempC: number | undefined, tempF: number | undefined): boolean {
  if (tempC !== undefined) return PLACEHOLDER_C.some((p) => near(tempC, p, 0.005));
  if (tempF !== undefined) return PLACEHOLDER_F.some((p) => near(tempF, p, 0.01));
  return true; // nothing reported at all
}

export function normalizeDevEui(eui: string): string {
  return eui.replace(/[^0-9a-zA-Z_-]/g, "").toUpperCase();
}

/**
 * Node_type from the decoder, else inferred from which temperature fields exist.
 * Returns undefined when neither is possible.
 */
export function detectNodeType(payload: DecodedPayload | undefined): string | undefined {
  if (!payload) return undefined;
  if (payload.Node_type?.trim()) return payload.Node_type.trim().toUpperCase();
  const has = (k: keyof DecodedPayload) => payload[k] !== undefined;
  if (has("TempF_Channel1") || has("TempF_Channel2") || has("Temp_Channel1") || has("Temp_Channel2")) return "LTC2";
  if (has("TempF_TMP117") || has("TempC_TMP117") || has("TempF_SHT") || has("TempC_SHT") || has("Hum_SHT")) return "LHT65N";
  return undefined;
}

function pickBestGateway(rx: z.infer<typeof rxMetadataSchema>[] | undefined): ParsedGateway | undefined {
  if (!rx?.length) return undefined;
  const best = [...rx].sort((a, b) => (b.rssi ?? -Infinity) - (a.rssi ?? -Infinity))[0];
  return {
    gatewayId: best.gateway_ids?.gateway_id,
    eui: best.gateway_ids?.eui,
    rssi: best.rssi,
    snr: best.snr,
  };
}

/** °F if present, otherwise converted from °C, otherwise undefined. */
function tempF(f: number | undefined, c: number | undefined): number | undefined {
  if (f !== undefined) return f;
  if (c !== undefined) return cToF(c);
  return undefined;
}

/** Push a probe reading unless it is absent or reads as "not connected". */
function takeProbe(
  channel: Channel,
  tempC: number | undefined,
  tempFv: number | undefined,
  channels: ParsedChannel[],
  skipped: Channel[],
) {
  if (tempC === undefined && tempFv === undefined) return; // channel not reported
  if (isProbeDisconnected(tempC, tempFv)) {
    skipped.push(channel);
    return;
  }
  channels.push({ channel, tempF: tempF(tempFv, tempC) as number });
}

export function parseTtnUplink(body: unknown, now: Date = new Date()): ParseResult {
  // TTN posts the uplink at the top level; some relays wrap it in { data }
  const candidate =
    body && typeof body === "object" && "data" in body && !("end_device_ids" in body)
      ? (body as { data: unknown }).data
      : body;

  const result = uplinkSchema.safeParse(candidate);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      error: `${issue.path.join(".") || "body"}: ${issue.message}`,
    };
  }

  const u = result.data;
  const msg = u.uplink_message;
  const payload = msg?.decoded_payload;

  // Time of the event: uplink_message.received_at (UTC), then top-level, then now
  const rawReceived = msg?.received_at ?? u.received_at;
  const parsedDate = rawReceived ? new Date(rawReceived) : undefined;
  const receivedAtValid = parsedDate !== undefined && !Number.isNaN(parsedDate.getTime());

  const nodeType = detectNodeType(payload);
  const channels: ParsedChannel[] = [];
  const skippedChannels: Channel[] = [];
  let ambientTempF: number | undefined;
  let ambientHum: number | undefined;
  let unsupportedNodeType = false;

  switch (nodeType) {
    case "LTC2":
      takeProbe(1, payload?.Temp_Channel1, payload?.TempF_Channel1, channels, skippedChannels);
      takeProbe(2, payload?.Temp_Channel2, payload?.TempF_Channel2, channels, skippedChannels);
      break;
    case "LHT65N":
      // The external probe is the unit temperature; the built-in SHT sensor describes the air around the device
      takeProbe(1, payload?.TempC_TMP117, payload?.TempF_TMP117, channels, skippedChannels);
      ambientTempF = tempF(payload?.TempF_SHT, payload?.TempC_SHT);
      ambientHum = payload?.Hum_SHT;
      break;
    default:
      unsupportedNodeType = true;
  }

  const batteryPctRaw = msg?.last_battery_percentage?.value;

  return {
    ok: true,
    uplink: {
      devEui: normalizeDevEui(u.end_device_ids.dev_eui),
      deviceId: u.end_device_ids.device_id,
      applicationId: u.end_device_ids.application_ids?.application_id,
      fCnt: msg?.f_cnt,
      receivedAt: receivedAtValid ? parsedDate : now,
      receivedAtFallback: !receivedAtValid,
      nodeType,
      unsupportedNodeType,
      channels,
      skippedChannels,
      batteryV: payload?.BatV,
      batteryPct: batteryPctRaw === undefined ? undefined : Math.round(batteryPctRaw),
      batStatus: payload?.Bat_status?.trim() || undefined,
      ambientTempF,
      ambientHum,
      gateway: pickBestGateway(msg?.rx_metadata),
    },
  };
}
