# Freezer Temperature Monitor

Front-end demo prototype: freezer / cold-storage / HVAC temperature monitoring for Burger King restaurants in northern New Jersey. **No backend** — all data is static/mocked and "real-time" behaviour is simulated on the client.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000 — you will be redirected to `/login`. Enter any valid-looking email and any password (auth is mocked with a cookie flag).

## What's inside

| Screen | Route | Notes |
| --- | --- | --- |
| Sign in / Create account | `/login`, `/register` | Mock auth, client-side validation, Google/SSO are demo stubs |
| Locations | `/locations` | 25 locations (3 alert / 2 offline / 20 normal), summary cards, Alerts-first & Name sorting, Leaflet map with status markers + legend |
| Location units | `/locations/[id]` | Overall status card, live outdoor weather (Open-Meteo), equipment tabs, units table with live temperatures & alert durations |
| Unit detail | `/locations/[id]/units/[unitId]` | Overview card (model / serial / year / image), Current State tiles, 24H / 7D / 30D chart with threshold line, recommendations for alert units |

## Real-time simulation

- A single global tick (zustand store): every **5 s** each online unit's temperature drifts ±1–2 °F. Normal units are clamped inside their range, alert units stay **outside** (they never recover on their own).
- Every **minute** alert durations grow.
- Chart series are generated once per unit (seeded PRNG, stable between reloads); alert units' 24H curve rises through the threshold.
- Normal ranges: AC 55–58 °F, everything else −10…+10 °F.
- The only external request is current weather per city (Open-Meteo, no API key, cached ~12 min).

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · zustand · recharts · react-leaflet (Stadia "Alidade Smooth" light basemap, key-less on localhost) · lucide-react · Inter via `next/font`.

## Notes

- Mock data lives in `src/data/` (locations, units, history generator, weather helper).
- Route protection is handled by `src/proxy.ts` (Next 16 middleware): no auth cookie → redirect to `/login`.
- Unit images are placeholder SVGs in `public/units/` — swap for real photos any time.
