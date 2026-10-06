# Wiring up a new restaurant

The order matters, and every step has a check. Skipping the checks is how San Bernardino got
a day without duct readings, an hour invisible to its owner, and six offline alerts for
nothing — all on 2 Oct 2026, all avoidable.

Every command below runs from this repository against production. Paste the production URL
into the terminal once (`read -rs SUPABASE_URL && export SUPABASE_URL`) and prefix each command
with `DATABASE_URL="$SUPABASE_URL"`. The URL is never written to a file.

## 0. Before touching anything: what is the hardware saying?

The installers register the devices in TTN under our application, so their packets start
arriving before we have done anything. They land in `UnknownUplink`; nothing is lost.

```bash
npm run sensors:unknown
```

For every unmapped device this prints the type (`LTC2` or `LHT65N`), the per-channel
temperatures of its last packet and the air temperature where there is one. Read it against
what the installer said:

- **LTC2 with two probes used** (San Bernardino's walk-ins): which channel is the freezer is
  the one reading colder. Write that down; it goes into the CSV.
- **LTC2 on an AC**: one channel is the room, the other the duct. Over a couple of hours the
  duct swings with the compressor and the room barely moves — the room is the one to wire.
- **LHT65N**: the air sensor is the room. The probe, if any, is the duct.
- **"каналы пусты" on an LHT65N that has a probe**: the parser does not read that probe's
  field. Look at the raw packet in the TTN console; if there is a `Temp…` field we never
  heard of, the parser needs teaching before anything else — see `src/lib/ttn/parse.ts`,
  the `TempF_DS` case. `/api/health` also lists such fields under `unreadFields`, and the
  group hears about the first one.

If a device is missing here, it is not sending, or it is in a different TTN application.

## 1. The restaurant and its equipment

Add the restaurant to `scripts/setup-locations.mts`: name, street address (the Census
geocoder gives the coordinates — `src/lib/geocode.ts` has the call), timezone, gateway if the
inventory sheet names one, and the units with the standard bands. Then:

```bash
npm run locations:setup
```

Idempotent: existing restaurants are left alone, their ranges untouched. The script ends by
listing any restaurant that belongs to no organization. **That is the next step, not a
warning to skip.**

## 2. Put it in the owner's organization

```bash
npm run org:setup -- --name "Main org" --attach "Burger King #4808"
```

Without this the owner cannot see the restaurant; only Qimby's team and anyone granted it
directly can. There is no error anywhere — the restaurant is simply absent from the owner's
screens.

## 3. Map the probes

Add one row per probe to `data/sensors.csv` — the file documents its own columns. For a probe
that must stay unwired (as Whittier's AC2 and AC3 were until their second probes arrived) leave
the unit column **empty**; that is what keeps a later import from re-wiring it.

```bash
npm run sensors:import -- --dry-run
npm run sensors:import -- --location "Burger King #4808" --prod
```

`--location` validates the whole file but writes only that restaurant's sensors, so a new
site cannot touch an old one. `--prod` asks for the production URL and reads it without echo;
without it the script talks to the local database. A full `sensors:import` with no `--location` rewrites every
mapping in the file; use it only when that is what you mean.

## 4. Bring the morning in

```bash
npm run backfill:unknown -- --yes
```

Turns the stored raw packets into readings, through the same rule as the live path, and
marks each sensor as heard so the offline check does not open alerts for devices that were
talking all along. Readings raised this way open no alerts.

## 5. People

Technicians and managers are placed on the restaurant from the owner's table
(**Restaurants & people**) or, for someone who predates it:

```bash
npm run access:grant -- --email tech@example.com --location "Burger King #4808"
```

## 6. Prove it

```bash
npm run chart:check
```

One line per unit: readings in the last day and week, the latest value, and for an AC the
duct beside the room. For the new restaurant every unit should show a reading a few minutes
old, and every AC with a duct probe should show a duct temperature — **"дакт —" on an AC that
has a probe means step 0 was skipped.** Then open the restaurant in the app as the owner:
every unit present, status not Offline, chart filling.

## When something is wrong afterwards

| Symptom | Where to look |
| --- | --- |
| `/api/health` says `reason: write_errors` | an insert failed for a reason other than a duplicate; the message is in `writeErrors.lastError` and the Render log. A counter behind its rows: `npm run db:sequences -- --fix` |
| Sensors "seen" minutes ago, readings hours old | `npm run db:sequences` — a restore left the id counter behind; `--fix` |
| A unit Offline right after wiring | its first live packet resolves it within one interval; if not, the dev_eui in the CSV is wrong |
| Owner cannot see the restaurant | step 2 |
| Duct line missing on an AC with a probe | `unreadFields` in `/api/health`; teach the parser |
| A unit shows numbers from the wrong place | `npm run unit:detach -- --location … --unit … --purge --yes`, then fix the CSV |
| "Say which organization" as admin | pick one in the switcher at the top of Team / Restaurants |

`/api/health` answers two questions, not one: are sensors heard (`lastUplinkAt`) and is what
they say written (`lastReadingAt`, `readings: ok|stalled`). The minute loop posts to the group
the moment the second goes bad.
