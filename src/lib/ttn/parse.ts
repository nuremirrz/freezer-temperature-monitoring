import { z } from "zod";

/**
 * Tolerant parser for The Things Network uplink webhooks (Dragino LTC2 payload).
 *
 * Only `end_device_ids.dev_eui` is required. Everything else is optional so a
 * missing rssi / battery / channel never prevents a temperature from being stored.
 * The body may be the raw TTN webhook or wrapped in `{ data: ... }`.
 */

export type Channel = 1 | 2;

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
  /** Channels with a real temperature (unconnected probes are excluded) */
  channels: ParsedChannel[];
  /** Channels that reported a "probe not connected" placeholder */
  skippedChannels: Channel[];
  batteryV?: number;
  batteryPct?: number;
  /** Strongest gateway that heard the uplink */
  gateway?: ParsedGateway;
}

export type ParseResult =
  | { ok: true; uplink: ParsedUplink }
  | { ok: false; error: string };

const num = z.number().finite().optional();

const decodedPayloadSchema = z.looseObject({
  BatV: num,
  Node_type: z.string().optional(),
  TempF_Channel1: num,
  TempF_Channel2: num,
  Temp_Channel1: num,
  Temp_Channel2: num,
});

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
  return eui.replace(/[^0-9a-zA-Z_]/g, "").toUpperCase();
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

  const channels: ParsedChannel[] = [];
  const skippedChannels: Channel[] = [];

  for (const channel of [1, 2] as const) {
    const tempC = payload?.[`Temp_Channel${channel}`];
    const tempF = payload?.[`TempF_Channel${channel}`];
    if (tempC === undefined && tempF === undefined) continue; // channel not reported
    if (isProbeDisconnected(tempC, tempF)) {
      skippedChannels.push(channel);
      continue;
    }
    channels.push({ channel, tempF: tempF ?? cToF(tempC as number) });
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
      channels,
      skippedChannels,
      batteryV: payload?.BatV,
      batteryPct: batteryPctRaw === undefined ? undefined : Math.round(batteryPctRaw),
      gateway: pickBestGateway(msg?.rx_metadata),
    },
  };
}
