import "./load-env";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * POST a TTN fixture to the local ingest endpoint — manual testing without TTN.
 *
 *   npm run fixture                              # LTC2 fixture as-is (re-running is a duplicate → readings: 0)
 *   npm run fixture -- --at now                  # fresh timestamp → new readings
 *   npm run fixture -- --at now --temp1 15.2 --temp2 61   # LTC2: °F per channel (ch1 = Freezer - Back, ch2 = Freezer - Front)
 *   npm run fixture -- --temp2 disconnected      # simulate an unplugged probe on channel 2
 *   npm run fixture -- --dev-eui FILL_ME_9       # unknown / other device
 *
 *   npm run fixture:lht65n                       # LHT65N fixture (draginotst → Reach-in Freezer)
 *   npm run fixture:lht65n -- --at now --temp1 12 --ambient 71 --hum 55
 *   npm run fixture:lht65n -- --node-type LSN50v2   # unknown decoder → UnknownUplink
 *
 * Options: --url, --secret, --file, --at <ISO|now>, --minutes-ago <n>,
 *          --temp1 / --temp2 <°F|disconnected>, --ambient <°F>, --hum <%>, --node-type, --dev-eui, --gateway
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
// Fixtures may be the raw TTN webhook or wrapped in { data }
const root = body.data ?? body;
const msg = root.uplink_message;
const payload: Record<string, unknown> = msg.decoded_payload;

const nodeTypeArg = arg("node-type");
if (nodeTypeArg) payload.Node_type = nodeTypeArg;
const nodeType = String(payload.Node_type ?? "").toUpperCase();

// Timestamp
const at = arg("at");
const minutesAgo = arg("minutes-ago");
if (minutesAgo) msg.received_at = new Date(Date.now() - Number(minutesAgo) * 60_000).toISOString();
else if (at === "now") msg.received_at = new Date().toISOString();
else if (at) msg.received_at = new Date(at).toISOString();
if (root.received_at && msg.received_at) root.received_at = msg.received_at;

const fToC = (f: number) => Math.round((((f - 32) * 5) / 9) * 100) / 100;
const SENTINEL_C = 327.67;

/** Set a probe temperature on the given decoder fields ("disconnected" writes Dragino's sentinel). */
function setProbe(fField: string, cField: string, value: string) {
  if (value === "disconnected") {
    payload[cField] = SENTINEL_C;
    payload[fField] = Math.round((SENTINEL_C * 9) / 5 + 32);
  } else {
    const f = Number(value);
    payload[fField] = f;
    payload[cField] = fToC(f);
  }
}

const temp1 = arg("temp1");
const temp2 = arg("temp2");
if (nodeType === "LHT65N") {
  if (temp1 !== undefined) setProbe("TempF_TMP117", "TempC_TMP117", temp1);
  if (temp2 !== undefined) console.warn("LHT65N has a single probe — --temp2 ignored");
  const ambient = arg("ambient");
  if (ambient !== undefined) {
    payload.TempF_SHT = Number(ambient);
    payload.TempC_SHT = fToC(Number(ambient));
  }
  const hum = arg("hum");
  if (hum !== undefined) payload.Hum_SHT = Number(hum);
} else {
  if (temp1 !== undefined) setProbe("TempF_Channel1", "Temp_Channel1", temp1);
  if (temp2 !== undefined) setProbe("TempF_Channel2", "Temp_Channel2", temp2);
}

const devEui = arg("dev-eui");
if (devEui) root.end_device_ids.dev_eui = devEui;
const gateway = arg("gateway");
if (gateway) msg.rx_metadata[0].gateway_ids.gateway_id = gateway;

const temps =
  nodeType === "LHT65N"
    ? `TMP117=${payload.TempF_TMP117}  SHT=${payload.TempF_SHT}°F/${payload.Hum_SHT}%`
    : `ch1=${payload.TempF_Channel1}  ch2=${payload.TempF_Channel2}`;
console.log(`POST ${url}`);
console.log(`  dev_eui=${root.end_device_ids.dev_eui}  Node_type=${payload.Node_type}  received_at=${msg.received_at}`);
console.log(`  ${temps}`);

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log(`→ ${res.status} ${text}`);
process.exit(res.ok ? 0 : 1);
