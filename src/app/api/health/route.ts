import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notificationHealth } from "@/lib/notify";
import { mailStatus } from "@/lib/auth/mailer";

export const dynamic = "force-dynamic";

/** No uplink from any sensor for this long means our chain (TTN → webhook → us) is broken, not a restaurant. */
const DEGRADED_AFTER_MIN = 20;

/** GET /api/health — 200 always; `status` is "ok" or "degraded". */
export async function GET() {
  const now = new Date();
  try {
    const agg = await prisma.sensor.aggregate({ _max: { lastSeenAt: true }, _count: { _all: true } });
    const lastUplinkAt = agg._max.lastSeenAt;
    const minutesSince = lastUplinkAt ? Math.round((now.getTime() - lastUplinkAt.getTime()) / 60_000) : null;
    const degraded = agg._count._all > 0 && (minutesSince === null || minutesSince > DEGRADED_AFTER_MIN);

    return NextResponse.json({
      status: degraded ? "degraded" : "ok",
      db: "ok",
      sensors: agg._count._all,
      lastUplinkAt: lastUplinkAt?.toISOString() ?? null,
      minutesSinceLastUplink: minutesSince,
      degradedAfterMinutes: DEGRADED_AFTER_MIN,
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
        db: "error",
        error: err instanceof Error ? err.message : String(err),
        time: now.toISOString(),
      },
      { status: 200 },
    );
  }
}
