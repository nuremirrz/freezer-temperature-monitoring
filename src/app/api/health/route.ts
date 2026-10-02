import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notificationHealth } from "@/lib/notify";
import { mailStatus } from "@/lib/auth/mailer";
import { currentFreshness, READINGS_STALLED_AFTER_MIN } from "@/lib/alerts/freshness";
import { unreadFieldsSeen } from "@/lib/ttn/unread";

export const dynamic = "force-dynamic";

/** No uplink from any sensor for this long means our chain (TTN → webhook → us) is broken, not a restaurant. */
const DEGRADED_AFTER_MIN = 20;

/**
 * GET /api/health — 200 always; `status` is "ok" or "degraded", and `reason` says why.
 *
 * Two questions, because they have two different answers: are the sensors being heard
 * (`lastUplinkAt`), and is what they say being written (`lastReadingAt`)? For two days in
 * September 2026 the first was yes and the second was no, and this endpoint said "ok".
 */
export async function GET() {
  const now = new Date();
  try {
    const [count, f] = await Promise.all([prisma.sensor.count(), currentFreshness(now)]);
    const noUplink = count > 0 && (f.minutesSinceUplink === null || f.minutesSinceUplink > DEGRADED_AFTER_MIN);
    const reason = f.stalled ? "readings_stalled" : noUplink ? "no_uplink" : null;

    return NextResponse.json({
      status: reason ? "degraded" : "ok",
      reason,
      db: "ok",
      sensors: count,
      lastUplinkAt: f.lastUplinkAt?.toISOString() ?? null,
      minutesSinceLastUplink: f.minutesSinceUplink,
      degradedAfterMinutes: DEGRADED_AFTER_MIN,
      // "stalled": sensors are heard, readings are not written — our side, look at the database
      readings: f.stalled ? "stalled" : "ok",
      lastReadingAt: f.lastReadingAt?.toISOString() ?? null,
      minutesSinceLastReading: f.minutesSinceReading,
      readingsStalledAfterMinutes: READINGS_STALLED_AFTER_MIN,
      // The Render free instance has 512 MB; this is what the Node process holds right now.
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      // Measurement fields some device sends that the parser does not read — a new probe or
      // decoder. Empty is the normal state; anything here is data being thrown away.
      unreadFields: unreadFieldsSeen(),
      notifications: notificationHealth(),
      // "console" means confirmation and reset links are only being printed to this log —
      // nobody can finish signing up or recover a password until a provider is configured.
      // A non-zero `failures` means one is configured and rejecting us.
      mail: mailStatus(),
      time: now.toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "degraded",
        reason: "db_error",
        db: "error",
        error: err instanceof Error ? err.message : String(err),
        time: now.toISOString(),
      },
      { status: 200 },
    );
  }
}
