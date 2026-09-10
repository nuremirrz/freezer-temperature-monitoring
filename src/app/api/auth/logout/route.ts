import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";
import { json, sameOrigin } from "@/lib/auth/http";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout[?all=1] — ends this session (or every session of the user). */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site request rejected" }, 403);
  await destroySession({ everywhere: req.nextUrl.searchParams.get("all") === "1" });
  return json({ status: "signed_out" });
}

/**
 * GET /api/auth/logout?next=/login — clears a stale cookie and redirects.
 * Used by the app layout when the cookie exists but the session behind it is gone.
 */
export async function GET(req: NextRequest) {
  await destroySession();
  const next = req.nextUrl.searchParams.get("next");
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/login";
  return NextResponse.redirect(new URL(target, req.url));
}
