import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { json, unauthorized, sameOrigin, limited, baseUrl } from "@/lib/auth/http";
import { LIMITS } from "@/lib/auth/rate-limit";
import { resendInvite, revokeInvite } from "@/lib/auth/team";

export const dynamic = "force-dynamic";

/** POST /api/team/[userId]/invite — send a fresh link; the old one stops working. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!sameOrigin(req)) return NextResponse.json({ message: "Bad origin" }, { status: 403 });
  const blocked = limited(req, "invite", LIMITS.invite.limit, LIMITS.invite.windowMs);
  if (blocked) return blocked;

  const { userId } = await ctx.params;
  const r = await resendInvite(session, userId, baseUrl(req));
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  return json(r.data);
}

/** DELETE /api/team/[userId]/invite — withdraw an invitation nobody has used. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!sameOrigin(req)) return NextResponse.json({ message: "Bad origin" }, { status: 403 });

  const { userId } = await ctx.params;
  const r = await revokeInvite(session, userId);
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  return json(r.data);
}
