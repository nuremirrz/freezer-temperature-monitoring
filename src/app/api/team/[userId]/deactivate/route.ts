import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { json, unauthorized, sameOrigin } from "@/lib/auth/http";
import { deactivateMember } from "@/lib/auth/team";

export const dynamic = "force-dynamic";

/** POST /api/team/[userId]/deactivate — end their sessions; keep their name on what they wrote. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!sameOrigin(req)) return NextResponse.json({ message: "Bad origin" }, { status: 403 });

  const { userId } = await ctx.params;
  const r = await deactivateMember(session, userId);
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  return json(r.data);
}
