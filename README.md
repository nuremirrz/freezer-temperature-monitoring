# Qimby — Freezer Temperature Monitor

Cold-storage and HVAC temperature monitoring for Burger King restaurants in northern New Jersey. Sensor data arrives from The Things Network, is stored in PostgreSQL and evaluated for alerts; the UI reads it live over SSE.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000 — you will be redirected to `/login`. Create an account (the confirmation link is printed to the server console when no SMTP is configured, and shown on the page in development) or seed a verified admin with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` — see **Accounts & sign-in** below.

New here? [GUIDE.md](GUIDE.md) walks through every screen and includes a two-minute demo script (in Russian).

## What's inside

| Screen | Route | Notes |
| --- | --- | --- |
| Sign in / Create account | `/login`, `/register` | Real accounts: e-mail confirmation, password reset, account deletion (see below). Google/SSO are demo stubs |
| Locations | `/locations` | 25 locations (3 alert / 2 offline / 20 normal), summary cards, Alerts-first & Name sorting, Leaflet map with status markers + legend |
| Location units | `/locations/[id]` | Overall status card, live outdoor weather (Open-Meteo), equipment tabs, units table with live temperatures & alert durations |
| Unit detail | `/locations/[id]/units/[unitId]` | Overview card (model / serial / year / image), Current State tiles, 24H / 7D / 30D chart with threshold line, Service History (PM visits, repairs, installation) |
| Maintenance Compliance | `/maintenance` | 3 preventive-maintenance visits per year per location: summary cards, search, status filter, year picker; progress / last & next PM / status per location |

## Live data in the UI

The screens read the API, not fixtures:

- `src/lib/api.ts` types every endpoint; `src/store/useLiveStore.ts` loads the list and the open location, subscribes to `/api/stream` and falls back to polling every 60 s when SSE cannot connect (a dot next to "Locations" shows which mode is active).
- A `reading` event patches the open location in place, so a temperature moves the moment an uplink lands. An `alert` event refetches, because statuses and counts are derived server-side.
- Durations and "x min ago" re-render on a local one-minute tick, no round-trip.
- A reading outside the unit's range is red immediately; the **Alert** status still needs two consecutive bad readings, so a single spike shows red without raising an alert.
- Normal ranges: AC 55–58 °F, everything else −10…+10 °F, stored per unit.
- Outdoor weather per city comes from Open-Meteo (no API key, cached ~12 min).

**Still demo content, labelled as such in the UI:** Service History on the unit screen and the Maintenance Compliance page. Both carry a "Demo data" badge — there is no service-log or preventive-maintenance table in the backend yet.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · zustand · recharts · react-leaflet (Esri Light Gray Canvas basemap, key-less) · lucide-react · Inter via `next/font`.

## Notes

- `src/data/` now only holds the weather helper, the seeded PRNG and the leftover demo generators used by the two screens still marked "Demo data".
- Route protection: `src/proxy.ts` (Next 16 proxy) redirects visitors without a session cookie; the `(app)` layout and every read API validate the session against the database.
- Unit images are placeholder SVGs in `public/units/` — swap for real photos any time.

---

## Pilot backend — TTN ingest, PostgreSQL, alerts

The demo UI above runs on mock data. The **pilot backend** in this same repo is real: it accepts Dragino LTC2 uplinks from The Things Network, stores them in PostgreSQL, evaluates alerts, and exposes a JSON + SSE API for the frontend. No simulated data anywhere in the backend.

### Setup

```bash
cp .env.example .env            # DATABASE_URL, TTN_WEBHOOK_SECRET, optional Telegram
npx prisma dev -n qimby -d      # local Postgres without Docker; paste the TCP url into .env
                                # (also set SHADOW_DATABASE_URL to its shadow server — see .env.example — for `migrate dev`)
npm run db:migrate              # apply migrations (creates the database)
npm run db:seed                 # 5 locations, 5 gateways, 25 sensors, 40 units
npm run dev
```

`npm test` runs the vitest suites (TTN parser, alert rules). `npm run build` type-checks the whole thing.

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run fixture` | POST `fixtures/ttn-uplink.json` (a real `draginotst2` capture) to the local ingest endpoint. Re-running is a duplicate → `readings: 0` |
| `npm run fixture -- --at now --temp1 15.2 --temp2 61` | Fresh timestamp + custom °F per channel (channel 1 = Teaneck **Freezer - Back**, channel 2 = **Freezer - Front**) |
| `npm run fixture -- --temp2 disconnected` | Simulate an unplugged probe (Dragino sentinel 327.67 °C → channel skipped) |
| `npm run fixture -- --dev-eui FILL_ME_9` | Uplink from another / unknown device |
| `npm run fixture:lht65n` | LHT65N fixture (`draginotst` → Teaneck **Reach-in Freezer**); `-- --at now --temp1 12 --ambient 71 --hum 55` to drive it |
| `npm run fixture:lht65n -- --node-type LSN50v2` | Unknown decoder → lands in `UnknownUplink` with a reason |
| `npm run offline-check` | One pass of the offline check (for cron; see below) |
| `npm run telegram -- --token <t>` | Find the alert group's chat id and send a test message |
| `npm run sensors:import -- --dry-run` | Validate `data/sensors.csv` and preview the probe-to-equipment map |
| `npm run db:studio` | Browse the database |

### Data model (Prisma)

`Location` → `Gateway`, `Unit` (type + per-unit `rangeMinF/rangeMaxF`), `Sensor` (dev_eui, `nodeType`, battery + `batStatus`, rssi, `expectedIntervalSec`, LHT65N `ambientTempF/ambientHum`, `lastSeenAt`) → `SensorChannel` (channel 1|2 → unit, nullable) → `Reading` (unique on sensor+channel+measuredAt), `Alert` (temp_out_of_range | offline), `UnknownUplink` (payloads from unknown dev_eui or unknown Node_type, with a `reason` — nothing is dropped silently). All timestamps are `timestamptz` in UTC; each location carries its `timezone` (`America/New_York`) for display.

Default ranges by type: freezer / walk-in freezer / walk-in cooler **−10…+10 °F**, AC **55–58 °F**. Stored per unit so they can be overridden.

### Ingest — `POST /api/ingest/ttn`

1. `X-Webhook-Secret` must equal `TTN_WEBHOOK_SECRET` → otherwise **401**.
2. Body is parsed tolerantly (`src/lib/ttn/parse.ts`, zod): only `dev_eui` is required; missing rssi/battery never blocks a temperature. The fixtures in `fixtures/` are **real captures** exported from The Things Stack Live Data, and the parser has been replayed against 39 production uplinks from both device types without a single failure. Time comes from `uplink_message.received_at`. The body may be the raw TTN webhook or wrapped in `{ data }`. The decoder branch is chosen by `decoded_payload.Node_type` (inferred from the field names when missing):
   - **LTC2** — two probes: `TempF_Channel1/2` (falls back to converting `Temp_Channel1/2`) → channels 1 and 2.
   - **LHT65N** — one probe: `TempF_TMP117` → channel 1. The built-in air sensor `TempF_SHT` / `Hum_SHT` is stored on the sensor as `ambientTempF` / `ambientHum`, never as a reading. `Bat_status` → `Sensor.batStatus`.
   - Dragino "probe not connected" sentinels (327.67 / −0.01 °C) are skipped for both types.
3. Unknown `dev_eui` → `UnknownUplink` (reason `unknown_device`), **200**. Known device with an unknown `Node_type` → `UnknownUplink` (reason `unsupported_node_type:<type>`), the sensor heartbeat is still recorded, **200**.
4. One `Reading` per channel wired to a unit (LHT65N sensors only have channel 1); duplicates (same sensor + channel + time) are ignored. Sensor `nodeType`, battery/rssi/snr/ambient/`lastSeenAt` and gateway `lastSeenAt` are updated.
5. Alerts are evaluated after the writes; notifications are fire-and-forget, so the response never waits on Telegram.

### Alert rules (`src/lib/alerts/rules.ts`, pure + tested)

- **Temp out of range** opens after **2 consecutive** out-of-range readings (a single spike is ignored) and tracks `peakTempF`. It closes with a **2 °F hysteresis on the violated side**: a high alert on −10…10 closes at ≤ 8 °F, a low one at ≥ −8 °F. The hysteresis is directional on purpose — a symmetric 2 °F band would be empty for the 3 °F-wide AC range.
- **Offline**: a sensor silent for **more than 3 × `expectedIntervalSec` + 60 s** gets an offline alert per mapped unit (5-minute devices → 16 min, the 2-minute `draginotst` → 7 min; the interval lives on the `Sensor` row). When *every* sensor at a location is silent, one location-wide notification is sent (gateway / internet problem) instead of five. The alert resolves as soon as the sensor reports again.
- Unit status is derived, never stored: open temp alert → `alert`; open offline alert or no reading ever → `offline`; else `normal`. Location status is the worst of its units.

The offline check runs every minute inside the Next.js server (`src/instrumentation.ts`). For a multi-instance deploy set `OFFLINE_CHECK_DISABLED=1` and run `npm run offline-check` from cron instead.

### Notifications

`notify()` in `src/lib/notify` has one implementation — a **Telegram bot** (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`). Without those variables messages are logged to the console. Sent on open and on close, at most **once per alert per 30 minutes** (`lastNotifiedAt`) — note this also suppresses a "resolved" message when an alert closes within 30 minutes of opening; the server logs it instead. When `APP_URL` is set, each message carries a link straight to the location screen.

Example: `🔴 BK #1025 · Freezer - Back: 15.2°F (норма −10…10°F), 25 мин`

**Setting the bot up.** Create the bot in Telegram with [@BotFather](https://t.me/BotFather) (`/newbot`), make a group for the alerts and add the bot to it. Then let the helper find the chat id:

```bash
npm run telegram -- --token <bot-token>              # lists the chats the bot can see
npm run telegram -- --token <bot-token> --chat <id>  # sends a test message
```

The script only reads from Telegram and prints the two values; put them into the host environment yourself (on Render: the service → **Environment**). Group ids are negative, e.g. `-1001234567890`. Telegram keeps `getUpdates` history for a short while, so write the message in the group shortly before running the command.

### API for the frontend

| Endpoint | Returns |
| --- | --- |
| `GET /api/locations` | All locations with derived `status`, per-status unit counts and an overall `summary` |
| `GET /api/locations/[id]` | Location + gateways + units with `lastReading`, `status`, `activeAlert`, sensor battery/rssi |
| `GET /api/units/[id]/readings?range=24h\|7d\|30d` | Series for the chart; 7d = 30-min averages, 30d = 2-hour averages (aggregated in SQL) |
| `GET /api/stream` | Server-Sent Events: `reading` and `alert` events as they happen (+ heartbeat). Poll `/api/locations` every 60 s as a fallback |
| `GET /api/health` | `status: ok\|degraded` + last accepted uplink. Degraded when no uplink from any sensor for > 20 min — our chain is down, not a restaurant |

The SSE bus is in-process; the pilot runs as a single Node process. Multi-instance would need Redis / `pg NOTIFY`.

### Accounts & sign-in

Real accounts, implemented in `src/lib/auth` and `src/app/api/auth/*` (no third-party auth service):

| Flow | Endpoint | Notes |
| --- | --- | --- |
| Register | `POST /api/auth/register` | Creates an **unverified** account and e-mails a confirmation link (24 h). The response is identical whether or not the e-mail is taken |
| Confirm e-mail | `GET /api/auth/verify?token=…` | Single-use; redirects to `/login?verified=1` |
| Sign in / out | `POST /api/auth/login`, `POST /api/auth/logout[?all=1]` | Unverified accounts get `403 email_not_verified`; "Remember me" = 30-day session, otherwise 1 day |
| Forgot / reset password | `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` | Reset link is valid 1 h and signs the user out everywhere; it also counts as e-mail confirmation |
| Who am I | `GET /api/auth/me` | |
| Delete account | `DELETE /api/auth/account` `{password}` | Removes the login only — readings, alerts, sensors and units are not related to users and stay |

Security notes, matching the task requirements:

- **Passwords are never stored or logged in plaintext.** They are hashed with Node's built-in `scrypt` (`scrypt$N$r$p$salt$hash`, `src/lib/auth/password.ts`). Nobody on the team can read a user's password from the database.
- Sessions live in the `Session` table; the cookie holds a random token whose **sha256** is the row id (`httpOnly`, `SameSite=Lax`, `Secure` in production). Confirmation / reset tokens are stored the same way and are single-use.
- Every new account gets **role `admin`** (`User.role`, enum `UserRole`) — roles will be split later; the column is already there.
- Auth endpoints are rate-limited per IP and reject cross-site `Origin`s. Login timing is the same for unknown e-mails and wrong passwords.
- `/api/locations`, `/api/locations/[id]`, `/api/units/[id]/readings` and `/api/stream` require a session (`401` otherwise). `/api/health` stays public for uptime checks; `/api/ingest/ttn` uses the webhook secret.

**E-mail.** Confirmation and reset messages go out through `SMTP_URL` (`smtp://user:pass@host:587`, `MAIL_FROM`). The SMTP provider is a third-party service that will receive user e-mail addresses — per the task, its choice must be agreed as *sensitive data* before it is configured. Until then the app runs in **console mode**: links are printed to the server log and, in development, returned to the page. `APP_URL` sets the public origin used in links (defaults to the request origin).

**First admin without e-mail.** Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` and run `npm run db:seed` — creates a verified admin (intended for local / demo environments).

### Configuring the TTN webhook

In the TTN console: **Applications → your app → Integrations → Webhooks → + Add webhook → Custom webhook**.

- **Webhook ID**: `qimby`
- **Webhook format**: JSON
- **Base URL**: your public origin, e.g. `https://qimby.example.com`
- **Additional headers**: `X-Webhook-Secret` = the value of `TTN_WEBHOOK_SECRET`
- **Enabled event types**: tick **Uplink message** only, path `/api/ingest/ttn`

TTN does not retry failed deliveries and there is no buffering when a restaurant loses internet — gaps in the data are expected and allowed.

### Deploying to Render + Neon (free tier)

The pilot runs as one always-on Node process with an external Postgres.

**1. Database — [Neon](https://neon.tech).** Sign up (GitHub works, no card), create a project. In **Connection Details** pick **Direct connection**, not the pooled one: `prisma migrate deploy` needs a real session, and PgBouncer in transaction mode breaks it. Copy the string, it looks like `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`.

**2. App — [Render](https://render.com).** New → **Blueprint**, point it at this repository. `render.yaml` describes the service: `npm ci && npm run build`, then `prisma migrate deploy && next start`, health check on `/api/health`.

**3. Environment variables** in the Render dashboard (they are `sync: false` in the blueprint, so they never land in git):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the Neon direct connection string |
| `TTN_WEBHOOK_SECRET` | a long random string, the same one goes into the TTN webhook header |
| `APP_URL` | the Render URL, e.g. `https://qimby.onrender.com` |
| `SMTP_URL`, `MAIL_FROM` | optional, for confirmation and reset e-mails |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | optional, for alert notifications |

Generate the secret with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

**4. Seed once** after the first successful deploy: open **Shell** on the service and run `npm run db:seed`. Add `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` first to get a verified login without configuring SMTP.

**5. Point the TTN webhook** at `https://<your-render-url>` (see below).

Two things to know about the free tiers:

- **Render sleeps a free service after 15 minutes without inbound HTTP**, and waking it takes around a minute. Sensor uplinks every 2–5 minutes keep it awake on their own, but *before* the hardware is wired the service will nap, and the first uplink after a nap can be lost — TTN does not retry. A free uptime pinger (UptimeRobot and friends) hitting `/api/health` every 5 minutes removes the problem entirely.
- **Neon suspends the compute after 5 minutes of inactivity.** Waking takes well under a second, and regular uplinks keep it warm; nothing to do here.

Neither limitation affects data already stored, and both disappear on any paid tier.

### Deploying to Railway (alternative)


1. **New project → Deploy from GitHub repo** (this repository, branch `main`). Nixpacks detects Next.js; `npm run build` runs `prisma generate` via `postinstall`.
2. **+ New → Database → PostgreSQL.** In the app service add the variable `DATABASE_URL = ${{Postgres.DATABASE_URL}}`.
3. Add the rest of the variables: `TTN_WEBHOOK_SECRET` (long random string — the same one goes into the TTN webhook header), `APP_URL` (the Railway domain, e.g. `https://qimby.up.railway.app`), optionally `SMTP_URL`, `MAIL_FROM`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
4. `railway.json` in the repo sets the start command to `prisma migrate deploy && next start` (migrations run on every deploy) and the health check to `/api/health`.
5. First deploy: run the seed once — `railway run npm run db:seed` from a machine with the Railway CLI, or a one-off shell in the dashboard. Add `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` to get a first login without e-mail.
6. Point the TTN webhook **Base URL** at the Railway domain (see above). Watch **Deploy logs** for `POST /api/ingest/ttn 200` and `[offline-check]` lines.

The app runs as a single long-lived Node process, which is what the SSE stream and the in-process offline check expect. Keep it at one replica.

### Testing locally through a tunnel

```bash
npm run dev                                        # http://localhost:3000
cloudflared tunnel --url http://localhost:3000     # or: ngrok http 3000
```

Put the printed `https://…` origin into the TTN webhook Base URL. Uplinks land within a second; watch the dev server log for `POST /api/ingest/ttn 200`, `[notify] …` and `[offline-check] …` lines. `GET /api/health` tells you when the last uplink arrived.

### Wiring real sensors

Two pieces of information are needed per probe, and they come from different places:

- **dev_eui** — printed on the sensor's label, and shown in TTN under **End devices → the device → DevEUI**.
- **which equipment the probe sits in** — this exists nowhere until someone installs it. Whoever mounts the hardware has to write it down.

`data/sensors.csv` is where that goes, one row per probe. Fill it in during installation and apply it:

```bash
npm run sensors:import -- --dry-run   # validate and preview, writes nothing
npm run sensors:import                # apply
```

The importer refuses to write anything unless the whole file is valid: it checks the dev_eui format, that a channel is 1 or 2, that an LHT65N has no channel 2, that rows for one device agree on its location, and that every location and equipment name actually exists in the database. It is idempotent, so a corrected file can be applied again; readings already collected are never touched. `nodeType` is only seeded for a device that has never reported — the first real uplink is the authority.

Anything TTN sends from an EUI we do not know lands in `UnknownUplink` with a reason, so a sensor that starts transmitting before it is mapped is visible rather than lost. The seed's `FILL_ME_*` placeholders stay until every real sensor is in; they legitimately read as "offline" in the meantime.
