import { config } from "dotenv";

/**
 * Loads the env files the way Next.js does, so a script and the running app always
 * agree on which database they are talking to.
 *
 * Order matters: dotenv never overwrites a key that is already set, so loading
 * `.env.local` first makes it win over `.env` — Next's precedence — while a real
 * environment variable still beats both. That keeps this working:
 *
 *   DATABASE_URL='<production url>' npm run sensors:import
 *
 * Importing plain `dotenv/config` instead reads only `.env`, which on a machine that
 * has a `.env.local` silently points the script at a different database than the app.
 */
config({ path: ".env.local" });
config({ path: ".env" });

/**
 * Say out loud which database this process resolved to.
 *
 * On this project `.env.local` holds the *production* Neon URL while `.env` holds the local
 * one, so "run it locally" and "run it against production" look identical on the command
 * line. Printing the host once per run makes that impossible to miss.
 */
const url = process.env.DATABASE_URL ?? "";
const host = /@([^/?]+)/.exec(url)?.[1] ?? "(no DATABASE_URL)";
const local = /^(localhost|127\.0\.0\.1|\[::1\])/.test(host);
console.log(`${local ? "db" : "\u001b[33m⚠ REMOTE db\u001b[0m"} → ${host}`);
