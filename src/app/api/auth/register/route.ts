import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/register → 403. Accounts are handed out, not taken.
 *
 * This endpoint used to create an account and hand it the `admin` role, which on an open form
 * meant anyone who filled it in could see every restaurant and change any unit's settings. The
 * only thing standing in the way was that confirmation e-mail never arrived, because mail was
 * not configured — and that stopped being true on 22 Sep 2026.
 *
 * It answers rather than 404s so that a probe gets the truth instead of something that looks
 * like a bug, and so the door is visibly locked rather than missing. Owners invite people:
 * `npm run access:grant -- --invite`.
 */
export function POST() {
  return NextResponse.json(
    {
      status: "registration_closed",
      message: "Qimby accounts are created by invitation. Ask the owner of your organization for a link.",
    },
    { status: 403 },
  );
}
