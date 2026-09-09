import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * POST the TTN fixture to the local ingest endpoint — manual testing without TTN.
 *
 *   npm run fixture                         # exact fixture (re-running is a duplicate → readings: 0)
 *   npm run fixture -- --at now             # fresh timestamp → new readings
 *   npm run fixture -- --at now --temp1 15.2 --temp2 61   # drive an alert (channel 1 is Freezer - Back)
 *   npm run fixture -- --minutes-ago 5 --temp1 12.4       # backdate a reading
 *   npm run fixture -- --dev-eui FILL_ME_9               # unknown/other device
 *   npm run fixture -- --temp2 disconnected              # simulate an unplugged probe on channel 2
 *
 * Options: --url, --secret, --file, --at <ISO|now>, --minutes-ago <n>, --temp1, --temp2, --dev-eui, --gateway
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const url = arg("url") ?? process.env.INGEST_URL ?? "http://localhost:3000/api/ingest/ttn";
const secret = arg("secret") ?? process.env.TTN_WEBHOOK_SECRET;
if (!secret) {
  console.error("TTN_WEBHOOK_SECRET is not set (put it in .env or pass --secret)");
  process.exit(1);
}

const file = arg("file") ?? resolve(process.cwd(), "fixtures/ttn-uplink.json");
const body = JSON.parse(readFileSync(file, "utf8"));
const msg = body.data.uplink_message;

// Timestamp
const at = arg("at");
const minutesAgo = arg("minutes-ago");
if (minutesAgo) msg.received_at = new Date(Date.now() - Number(minutesAgo) * 60_000).toISOString();
else if (at === "now") msg.received_at = new Date().toISOString();
else if (at) msg.received_at = new Date(at).toISOString();

// Temperatures (°F); "disconnected" writes Dragino's sentinel so the channel is skipped
for (const ch of [1, 2] as const) {
  const v = arg(`temp${ch}`);
  if (v === undefined) continue;
  if (v === "disconnected") {
    msg.decoded_payload[`Temp_Channel${ch}`] = 327.67;
    msg.decoded_payload[`TempF_Channel${ch}`] = 621.81;
  } else {
    const f = Number(v);
    msg.decoded_payload[`TempF_Channel${ch}`] = f;
    msg.decoded_payload[`Temp_Channel${ch}`] = Math.round(((f - 32) * 5) / 9 * 100) / 100;
  }
}

const devEui = arg("dev-eui");
if (devEui) body.data.end_device_ids.dev_eui = devEui;
const gateway = arg("gateway");
if (gateway) msg.rx_metadata[0].gateway_ids.gateway_id = gateway;

console.log(`POST ${url}`);
console.log(`  dev_eui=${body.data.end_device_ids.dev_eui}  received_at=${msg.received_at}`);
console.log(`  TempF ch1=${msg.decoded_payload.TempF_Channel1}  ch2=${msg.decoded_payload.TempF_Channel2}`);

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log(`→ ${res.status} ${text}`);
process.exit(res.ok ? 0 : 1);
