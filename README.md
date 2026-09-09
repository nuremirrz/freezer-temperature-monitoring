# Freezer Temperature Monitor

Front-end demo prototype: freezer / cold-storage / HVAC temperature monitoring for Burger King restaurants in northern New Jersey. **No backend** — all data is static/mocked and "real-time" behaviour is simulated on the client.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000 — you will be redirected to `/login`. Enter any valid-looking email and any password (auth is mocked with a cookie flag).

New here? [GUIDE.md](GUIDE.md) walks through every screen and includes a two-minute demo script (in Russian).

## What's inside

| Screen | Route | Notes |
| --- | --- | --- |
| Sign in / Create account | `/login`, `/register` | Mock auth, client-side validation, Google/SSO are demo stubs |
| Locations | `/locations` | 25 locations (3 alert / 2 offline / 20 normal), summary cards, Alerts-first & Name sorting, Leaflet map with status markers + legend |
| Location units | `/locations/[id]` | Overall status card, live outdoor weather (Open-Meteo), equipment tabs, units table with live temperatures & alert durations |
| Unit detail | `/locations/[id]/units/[unitId]` | Overview card (model / serial / year / image), Current State tiles, 24H / 7D / 30D chart with threshold line, Service History (PM visits, repairs, installation) |
| Maintenance Compliance | `/maintenance` | 3 preventive-maintenance visits per year per location: summary cards, search, status filter, year picker; progress / last & next PM / status per location |

## Real-time simulation

- A single global tick (zustand store): every **5 s** each online unit's temperature drifts ±1–2 °F. Normal units are clamped inside their range, alert units stay **outside** (they never recover on their own).
- Every **minute** alert durations grow.
- Chart series are generated once per unit (seeded PRNG, stable between reloads); alert units' 24H curve rises through the threshold.
- Normal ranges: AC 55–58 °F, everything else −10…+10 °F.
- The only external request is current weather per city (Open-Meteo, no API key, cached ~12 min).

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · zustand · recharts · react-leaflet (Esri Light Gray Canvas basemap, key-less) · lucide-react · Inter via `next/font`.

## Notes

- Mock data lives in `src/data/` (locations, units, history generator, weather helper).
- Route protection is handled by `src/proxy.ts` (Next 16 middleware): no auth cookie → redirect to `/login`.
- Unit images are placeholder SVGs in `public/units/` — swap for real photos any time.

---

## Pilot backend — TTN ingest, PostgreSQL, alerts

The demo UI above runs on mock data. The **pilot backend** in this same repo is real: it accepts Dragino LTC2 uplinks from The Things Network, stores them in PostgreSQL, evaluates alerts, and exposes a JSON + SSE API for the frontend. No simulated data anywhere in the backend.

### Setup

```bash
cp .env.example .env            # DATABASE_URL, TTN_WEBHOOK_SECRET, optional Telegram
npx prisma dev -n qimby -d      # local Postgres without Docker; paste the TCP url into .env
npm run db:migrate              # apply migrations (creates the database)
npm run db:seed                 # 5 locations, 5 gateways, 25 sensors, 40 units
npm run dev
```

`npm test` runs the vitest suites (TTN parser, alert rules). `npm run build` type-checks the whole thing.

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run fixture` | POST `fixtures/ttn-uplink.json` to the local ingest endpoint. Re-running is a duplicate → `readings: 0` |
| `npm run fixture -- --at now --temp1 15.2 --temp2 61` | Fresh timestamp + custom °F per channel (channel 1 = Teaneck **Freezer - Back**, channel 2 = **Freezer - Front**) |
| `npm run fixture -- --temp2 disconnected` | Simulate an unplugged probe (Dragino sentinel 327.67 °C → channel skipped) |
| `npm run fixture -- --dev-eui FILL_ME_9` | Uplink from another / unknown device |
| `npm run offline-check` | One pass of the offline check (for cron; see below) |
| `npm run db:studio` | Browse the database |

### Data model (Prisma)

`Location` → `Gateway`, `Unit` (type + per-unit `rangeMinF/rangeMaxF`), `Sensor` (dev_eui, battery, rssi, `lastSeenAt`) → `SensorChannel` (channel 1|2 → unit, nullable) → `Reading` (unique on sensor+channel+measuredAt), `Alert` (temp_out_of_range | offline), `UnknownUplink` (payloads from unknown dev_eui — nothing is dropped silently). All timestamps are `timestamptz` in UTC; each location carries its `timezone` (`America/New_York`) for display.

Default ranges by type: freezer / walk-in freezer / walk-in cooler **−10…+10 °F**, AC **55–58 °F**. Stored per unit so they can be overridden.

### Ingest — `POST /api/ingest/ttn`

1. `X-Webhook-Secret` must equal `TTN_WEBHOOK_SECRET` → otherwise **401**.
2. Body is parsed tolerantly (`src/lib/ttn/parse.ts`, zod): only `dev_eui` is required; missing rssi/battery never blocks a temperature. Temperature is taken from `TempF_Channel1/2` (falls back to converting `Temp_Channel1/2`), time from `uplink_message.received_at`. Dragino "probe not connected" sentinels (327.67 / −0.01 °C) are skipped. The body may be the raw TTN webhook or wrapped in `{ data }`.
3. Unknown `dev_eui` → row in `UnknownUplink`, **200**.
4. One `Reading` per channel wired to a unit; duplicates (same sensor + channel + time) are ignored. Sensor battery/rssi/snr/`lastSeenAt` and gateway `lastSeenAt` are updated.
5. Alerts are evaluated after the writes; notifications are fire-and-forget, so the response never waits on Telegram.

### Alert rules (`src/lib/alerts/rules.ts`, pure + tested)

- **Temp out of range** opens after **2 consecutive** out-of-range readings (a single spike is ignored) and tracks `peakTempF`. It closes with a **2 °F hysteresis on the violated side**: a high alert on −10…10 closes at ≤ 8 °F, a low one at ≥ −8 °F. The hysteresis is directional on purpose — a symmetric 2 °F band would be empty for the 3 °F-wide AC range.
- **Offline**: a sensor silent for **> 16 min** gets an offline alert per mapped unit. When *every* sensor at a location is silent, one location-wide notification is sent (gateway / internet problem) instead of five. The alert resolves as soon as the sensor reports again.
- Unit status is derived, never stored: open temp alert → `alert`; open offline alert or no reading ever → `offline`; else `normal`. Location status is the worst of its units.

The offline check runs every minute inside the Next.js server (`src/instrumentation.ts`). For a multi-instance deploy set `OFFLINE_CHECK_DISABLED=1` and run `npm run offline-check` from cron instead.

### Notifications

`notify()` in `src/lib/notify` has one implementation — a **Telegram bot** (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`). Without those variables messages are logged to the console. Sent on open and on close, at most **once per alert per 30 minutes** (`lastNotifiedAt`) — note this also suppresses a "resolved" message when an alert closes within 30 minutes of opening; the server logs it instead.

Example: `🔴 BK #1025 · Freezer - Back: 15.2°F (норма −10…10°F), 25 мин`

### API for the frontend

| Endpoint | Returns |
| --- | --- |
| `GET /api/locations` | All locations with derived `status`, per-status unit counts and an overall `summary` |
| `GET /api/locations/[id]` | Location + gateways + units with `lastReading`, `status`, `activeAlert`, sensor battery/rssi |
| `GET /api/units/[id]/readings?range=24h\|7d\|30d` | Series for the chart; 7d = 30-min averages, 30d = 2-hour averages (aggregated in SQL) |
| `GET /api/stream` | Server-Sent Events: `reading` and `alert` events as they happen (+ heartbeat). Poll `/api/locations` every 60 s as a fallback |
| `GET /api/health` | `status: ok\|degraded` + last accepted uplink. Degraded when no uplink from any sensor for > 20 min — our chain is down, not a restaurant |

The SSE bus is in-process; the pilot runs as a single Node process. Multi-instance would need Redis / `pg NOTIFY`.

### Configuring the TTN webhook

In the TTN console: **Applications → your app → Integrations → Webhooks → + Add webhook → Custom webhook**.

- **Webhook ID**: `qimby`
- **Webhook format**: JSON
- **Base URL**: your public origin, e.g. `https://qimby.example.com`
- **Additional headers**: `X-Webhook-Secret` = the value of `TTN_WEBHOOK_SECRET`
- **Enabled event types**: tick **Uplink message** only, path `/api/ingest/ttn`

TTN does not retry failed deliveries and there is no buffering when a restaurant loses internet — gaps in the data are expected and allowed.

### Testing locally through a tunnel

```bash
npm run dev                                        # http://localhost:3000
cloudflared tunnel --url http://localhost:3000     # or: ngrok http 3000
```

Put the printed `https://…` origin into the TTN webhook Base URL. Uplinks land within a second; watch the dev server log for `POST /api/ingest/ttn 200`, `[notify] …` and `[offline-check] …` lines. `GET /api/health` tells you when the last uplink arrived.

### Wiring real sensors

The seed creates sensors with placeholder EUIs `FILL_ME_1 … FILL_ME_25` (Teaneck sensor #1 is the real test device `A84041784362379C` from the fixture). Replace them in `prisma/seed.ts` or directly in the `Sensor` table; until then those sensors are legitimately "offline". Anything TTN sends from an EUI we don't know ends up in `UnknownUplink` — a convenient list of what still needs mapping.
