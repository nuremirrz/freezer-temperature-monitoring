# Qimby — Freezer Temperature Monitor

Cold-storage and HVAC temperature monitoring for Burger King restaurants. Dragino LoRaWAN probes
report through The Things Network; the app stores every reading in PostgreSQL, raises alerts when
equipment stays out of range or goes quiet, notifies a Telegram group, and shows it all live to
the people who are allowed to see it.

Two restaurants are live today, BK #6816 (Norco) and BK #6399 (Whittier), eleven sensors between
them. The app runs on Render with a Supabase Postgres behind it.

## Quick start

```bash
npm install
cp .env.example .env            # DATABASE_URL points at a local Postgres
npx prisma dev -n qimby -d      # local Postgres without Docker; paste the TCP url into .env
npm run db:migrate              # apply migrations
npm run db:seed                 # 5 placeholder locations with units and sensors
npm run test:accounts           # one account of every role, local only (password is in the script)
npm run dev -- -p 3100          # 3000 belongs to another project on this machine
```

Open http://localhost:3100 and sign in as `owner@qimby.test`. There is no public sign-up:
accounts are handed out by invitation, and `test:accounts` refuses to run against anything that
is not localhost.

**Every push is checked before it can reach production.** `.github/workflows/ci.yml` runs the
types, the lint, the unit tests, the migrations on an empty Postgres, the database scenarios and
the production build; Render deploys `main` only after all of it passes (`autoDeployTrigger:
checksPass`). A red check means the site keeps running the previous commit.

`npm test` runs the unit suites (141 tests: TTN parser, alert rules, permission matrix,
visibility, mailer). `npm run test:integration` runs the team and district services end to end
against a throwaway database (the script says how to start one). `npm run build` type-checks
everything.

## What is inside

| Screen | Route | Who |
| --- | --- | --- |
| Sign in, forgot / reset password | `/login`, `/forgot-password`, `/reset-password` | everyone |
| Locations | `/locations` | status per restaurant, Alerts / Offline / Normal counts, map; filtered to what the account may see |
| Location | `/locations/[id]` | units table with live temperature, status, normal range and alert duration; outdoor weather |
| Unit | `/locations/[id]/units/[unitId]` | current state, editable normal range, a chart for the last 12 h / day / week / month or any period up to a year (a calendar in the restaurant's own time; the address carries the choice), the unit passport with an edit popup |
| Team | `/team` | owner and district managers: invite, change role and scope, deactivate, resend or revoke invitations |
| Restaurants & people | `/organization` | owner: one row per restaurant with its manager and technicians; add, rename, re-address, close and reopen restaurants |

Live updates arrive over Server-Sent Events (`/api/stream`); the store falls back to polling
every 60 s when the stream cannot connect. A reading patches the open location in place, an
alert refetches, because statuses are derived server-side.

## Roles and visibility

Four roles, one per account, checked on the server in every request (`src/lib/auth`):

| Role | Sees | May |
| --- | --- | --- |
| `owner` | the whole organization | everything below, plus manage districts and invite anyone, another owner included |
| `district_manager` | the restaurants assigned to them | edit ranges and nameplates there, invite technicians there |
| `technician` | the locations assigned to them | edit nameplates; reads ranges, never sets them |
| `admin` | everything, outside any organization | Qimby's own team; not shown in a customer's Team list |

The permission matrix is one file, [src/lib/auth/permissions.ts](src/lib/auth/permissions.ts),
with a test per row. Reach is a separate question, answered by `visibleLocationIds` in
`visibility.ts`; lists and counters are filtered at the query. A location outside someone's reach
answers **404**, not 403, so nothing can be enumerated. Accounts are never deleted, only
deactivated: sessions are revoked and the name stays on everything the person wrote.

Invitations are single-use links valid for 72 hours; the invitee sets their own password and
that counts as e-mail confirmation. There must always be at least one active owner.

**Onboarding a customer**, as agreed on 30 Sep 2026: Qimby creates the organization and invites
the first owner; the owner invites their people on the Team page and, on the Restaurants page,
adds the restaurants and places a manager and technicians on each. Managers and technicians are
both assigned restaurant by restaurant. Equipment and sensors are Qimby's, entered at
installation. A restaurant is never deleted, only **closed**: it leaves every list, map and
counter and raises no alerts, its readings keep being stored, and the owner reopens it from the
same table. A new restaurant is placed on the map from its street address (US Census geocoder,
with the city centre from Open-Meteo as the fallback).

Setting a customer up from scratch:

```bash
npm run org:setup -- --name "Burger King — Steven" --owner steven@example.com
# creates an empty organization and e-mails the owner a 72-hour link; --attach "Burger King #6816"
# hands over a restaurant that already exists; --resend sends the invitation again
```

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS · zustand · recharts ·
react-leaflet · lucide-react · Prisma 7 with `@prisma/adapter-pg` · vitest.

---

## Backend

### Data model (Prisma)

`Organization` → `District` → `Location` → `Gateway`, `Unit`, `Sensor` → `SensorChannel`
(channel 1 | 2 → unit) → `Reading`; `Alert` per unit; `UnitChange`, one row per passport field
that changed hands (old value, new value, who, when); `User` with `UserDistrict` (managers) and
`LocationAccess` (technicians); `Session`, `AuthToken`; `UnknownUplink` for anything from a
device we do not know. All timestamps are `timestamptz` in UTC; each location carries its
`timezone` for display.

A unit has three bands, all editable per unit:

- **Normal range** (`rangeMinF`/`rangeMaxF`): what the table shows and the chart paints green.
- **Alert band** (`alertMinF`/`alertMaxF`, optional): where an alert is judged. A walk-in freezer
  is normal to 10 °F and alarming from 20 °F, and spends much of its day in between. Unset, the
  normal range does both jobs.
- **Duct band** (`probeMinF`/`probeMaxF`, AC only): the supply-air probe's own normal band,
  drawn on the chart but never deciding the unit's status.

**An AC is judged by the room, not the duct.** Where the device has a built-in air sensor
(LHT65N) that is the unit's temperature and the probe is the duct; where it has not (LTC2), the
mapped probe is the room and the other channel is the duct. Both numbers are kept on every
reading, so an AC chart has two lines.

### Ingest — `POST /api/ingest/ttn`

1. `X-Webhook-Secret` must equal `TTN_WEBHOOK_SECRET`, otherwise **401**.
2. The body is parsed tolerantly (`src/lib/ttn/parse.ts`, zod): only `dev_eui` is required, and
   a missing battery or rssi never blocks a temperature. Time comes from
   `uplink_message.received_at`. The decoder branch follows `decoded_payload.Node_type`:
   **LTC2** (two probes) or **LHT65N** (one probe plus the built-in air sensor). Dragino's
   "probe not connected" sentinels are skipped.
3. Unknown `dev_eui` or unknown `Node_type` land in `UnknownUplink` with a reason, **200**.
   Nothing is dropped silently.
4. One `Reading` per unit wired to the sensor, written by `insertReadings`
   (`src/lib/readings/write.ts`): a true duplicate — same sensor, channel and instant — is
   skipped, which is what makes replays safe; **any other conflict is an error**, logged and
   counted in `/api/health` as `writeErrors`. A blanket "skip duplicates" once hid two days of
   lost readings behind a healthy-looking site. Sensor battery, rssi, `lastSeenAt` and the
   gateway's `lastSeenAt` are updated.
5. Alerts are evaluated after the writes; notifications are fire-and-forget.

TTN does not retry a failed delivery. When our side is down, the TTN Storage integration keeps
the uplinks for a while, and `npm run recover:ttn` pulls them back (below).

### Alert rules (`src/lib/alerts/rules.ts`, pure and tested)

- **Temp out of range** opens after the reading has stayed outside the alert band for
  **60 minutes** (`SUSTAINED_OUT_OF_RANGE_MIN`, the client's "минимум час") and tracks
  `peakTempF`. It closes with a **2 °F hysteresis** on the violated side.
- **Offline**: a sensor silent for more than **3 × `expectedIntervalSec` + 60 s** (16 min for a
  5-minute device) gets an offline alert per mapped unit. When every sensor at a location is
  silent, one location-wide notification goes out instead of many, because that is the gateway
  or the restaurant's internet, not a probe. The alert resolves as soon as the sensor reports.
- Unit status is derived, never stored: open temp alert → `alert`; open offline alert or no
  reading ever → `offline`; else `normal`. Location status is the worst of its units.

The offline check runs every minute inside the Next.js process (`src/instrumentation.ts`).
For a multi-instance deploy set `OFFLINE_CHECK_DISABLED=1` and run `npm run offline-check` from
cron. Keep production at one replica: the SSE bus and this loop are in-process.

### Notifications

`notify()` in `src/lib/notify` sends to **Telegram** (`TELEGRAM_BOT_TOKEN`); without a token
messages go to the console. **Each organization may have its own chat**
(`npm run org:setup -- --name "…" --telegram <chat id>`, which posts a test message there
first): its restaurants' alerts go to that chat and nowhere else. An organization without one
uses the default group, `TELEGRAM_CHAT_ID`, which also receives Qimby's own system messages —
the write watchdog and unread payload fields — that no customer should see. Sent on open and on close, at most
once per alert per 30 minutes. With `APP_URL` set each message links to the location screen.
`npm run telegram -- --token <t>` finds the group's chat id and sends a test message.

### Nameplate photos

Up to five per unit. The browser does the heavy work (`src/lib/photos-client.ts`): it refuses
anything over 10 MB, decodes HEIC (natively in Safari, with `heic2any` loaded on demand
elsewhere), shrinks the photo to 1600 px on the long side and uploads a JPEG of a few hundred
kilobytes, retrying a dropped connection for about a minute. The passport fields save on their
own, so a photo on a weak signal never holds them up.

The server (`src/lib/units/photos.ts`) checks reach and role like the passport, then stores the
bytes through `src/lib/storage`: **Supabase Storage** in production — a private bucket, created
on the first upload, with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (a secret key, `sb_secret_…`,
sent on the `apikey` header) — and a local folder, `.data/photos`, in development and CI. A
production server without the keys refuses uploads (`photoStorage: "off"` in `/api/health`)
rather than writing to Render's disk, which every deploy wipes. The browser fetches a photo from
our own route, which checks access and then redirects to a signed link that expires in ten
minutes. The nightly backup covers the photo rows, not the files.

### E-mail

Invitations and password resets go out through **Brevo's HTTPS API** (`BREVO_API_KEY`,
`MAIL_FROM`, optional `MAIL_REPLY_TO`). Render blocks outbound SMTP, so `SMTP_URL` is only useful
from a laptop, which is what `npm run mail:test` uses. With neither configured, links are
printed to the server log and, in development, shown on the page. Brevo keys expire after 90
days without a send.

### API

| Endpoint | Returns |
| --- | --- |
| `GET /api/locations` | visible locations with derived `status`, per-status unit counts and a `summary` |
| `GET /api/locations/[id]` | location, gateways, units with `lastReading`, `status`, `activeAlert`, sensor battery and rssi |
| `GET /api/units/[id]/readings?range=12h\|1d\|1w\|1m` or `?from=<ISO>&to=<ISO>` | chart series; up to two days raw, longer windows averaged in SQL into buckets cut on the restaurant's clock (`src/lib/readings/window.ts`); a year at most |
| `POST /api/locations`, `PATCH /api/locations/[id]` | add a restaurant; rename, re-address, close or reopen it, set its manager and technicians |
| `GET /api/organization` | the owner's table: every restaurant, closed ones included, with who is on it |
| `PATCH /api/units/[id]` | normal, alert and duct bands; owners and managers |
| `GET/POST /api/units/[id]/photos`, `GET/DELETE …/photos/[photoId]` | nameplate photos, at most five per unit: list, upload (already compressed by the browser), fetch through an access check, remove |
| `PATCH /api/units/[id]/passport` | the nameplate and the parts: model, serial, year, refrigerant, belts, capacitor, filter; every role, the technician first of all; each change leaves a `UnitChange` row |
| `GET /api/stream` | SSE: `reading` and `alert` events plus heartbeat |
| `GET/POST /api/team`, `/api/team/[userId]`, `…/invite`, `…/deactivate` | team management |
| `GET/POST /api/districts`, `/api/districts/[id]` | districts |
| `POST /api/auth/login`, `logout`, `forgot-password`, `reset-password`, `GET /api/auth/me` | accounts; there is no sign-up — every account comes from an invitation |
| `GET /api/health` | public: `ok` or `degraded` with a `reason`; last uplink and last written reading; process memory; measurement fields the parser does not read; notification and mail channel state |

Every read API requires a session (`401` otherwise) and filters by the account's reach.
Passwords are stored as scrypt hashes only; the session cookie holds a random token whose
sha256 is the row id (`httpOnly`, `SameSite=Lax`, `Secure` in production). Auth endpoints are
rate-limited per IP and reject cross-site origins.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run sensors:import -- --dry-run` | validate `data/sensors.csv`, the probe-to-equipment map, and preview; without the flag, apply it; `--location "…"` writes one restaurant's sensors only |
| `npm run sensors:unknown` | devices talking to us without a mapping: type, last temperatures per channel |
| `npm run chart:check` | per unit: readings in the last day and week, the latest value, the duct beside the room for an AC |
| `npm run db:sequences [-- --fix]` | the id counters against the rows they number; a restore leaves them behind |
| `npm run db:usage` | database size against Supabase's 500 MB, biggest tables, growth per day |
| `npm run unit:detach -- --location "…" --unit "…" [--purge] --yes` | take a unit's probes off and, with --purge, forget what they wrote |
| `npm run access:grant -- --email … --role … [--location …] [--invite]` | create or update an account, grant locations, print an invitation link |
| `npm run org:setup -- --name "…" --owner … [--attach "…"]` | create a customer's empty organization, invite its first owner by e-mail, attach named restaurants |
| `npm run test:accounts` | one account per role plus a second organization, local databases only |
| `npm run db:backup` / `npm run db:restore -- --from <dir> --to <url> --yes` | copy every table to gzipped NDJSON and write it back; see [docs/backups.md](docs/backups.md) |
| `npm run recover:ttn` / `-- --load <file> --yes` | pull uplinks TTN still holds after an outage, save them to disk, then replay them; idempotent, raises no alerts |
| `npm run fixture`, `npm run fixture:lht65n` | post a real captured uplink to a local ingest endpoint; flags set time and temperatures |
| `npm run offline-check` | one pass of the offline check, for cron |
| `npm run mail:test -- --to …` | send one real e-mail and report what the server said |
| `npm run db:studio` | browse the database |

**Wiring up a new restaurant** is a six-step procedure with a check at every step:
[docs/onboarding.md](docs/onboarding.md). Every script prints the database host it resolved to on its first line
(`db → localhost…` or `⚠ REMOTE db → …`). Read it before letting a write run: `.env.local` is
loaded before `.env`, and a real environment variable beats both, which is how a script is
pointed at production on purpose:

```bash
DATABASE_URL="postgresql://…" npm run access:grant -- --email …
```

The production URL is not kept on disk on any laptop.

---

## Production

One always-on Node process on **Render** (`render.yaml`: `npm ci && npm run build`, then
`prisma migrate deploy && next start`, health check on `/api/health`, deploy on every push to
`main`) with a **Supabase** Postgres, free plan, East US (Ohio), connected through the session
pooler on port 5432. The Data API is off; only Prisma talks to the database.

Environment variables live in the Render dashboard, never in git: `DATABASE_URL`,
`TTN_WEBHOOK_SECRET`, `APP_URL`, `BREVO_API_KEY`, `MAIL_FROM`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`.

**TTN webhook.** Applications → the app → Integrations → Webhooks → Custom: JSON, base URL is
the Render origin, header `X-Webhook-Secret`, event type *Uplink message* only, path
`/api/ingest/ttn`. Enable the **Storage** integration as well: it is what makes an outage
recoverable.

**Backups.** A GitHub Actions workflow takes a copy every night, encrypts it with `age` to a
public key, proves it restores, and keeps the artifact 90 days. The private key lives with
Emirlan and never near CI. [docs/backups.md](docs/backups.md) has the whole procedure. A second
workflow pings `/api/health` every few minutes as a safety net against Render's free-tier sleep,
though the sensor traffic keeps the service awake by itself.

**Why not a free database that meters compute.** Eleven sensors reporting every few minutes
never let a database sleep. On 26 Sep 2026 that burned through Neon's free monthly compute
quota in sixteen days and took the database down for a day; every reading was recovered from the
nightly backup and TTN's storage, and the app moved to Supabase, whose free plan meters size, not
hours. Supabase caps the database at 500 MB; the whole history so far is a few megabytes.

## Where things stand

Of the client's feature list, **Roles** and the **unit passport** are complete, nameplate photos
included. Not yet built: technician work reports, digests to the owner, an
alert-history screen (the data is there), work history, the preventive-maintenance schedule and
the weekly report. Whittier AC2 and AC3 are deliberately unmapped until their second probes
arrive (`npm run sensors:import` brings them back). The alert threshold is one hour for every
unit type, where the written spec says two for cold storage and five for AC; the hour came from
the client's later message and is the safer choice for food.
