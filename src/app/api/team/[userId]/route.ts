import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { json, unauthorized, parseBody } from "@/lib/auth/http";
import { memberPatchSchema } from "@/lib/auth/validation";
import { updateMember } from "@/lib/auth/team";

export const dynamic = "force-dynamic";

/** PATCH /api/team/[userId] — change a member's name, role or scope. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const parsed = await parseBody(req, memberPatchSchema);
  if (!parsed.ok) return parsed.response;

  const { userId } = await ctx.params;
  const r = await updateMember(session, userId, parsed.data);
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  return json(r.data);
}
