import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { json, unauthorized, limited, parseBody, baseUrl } from "@/lib/auth/http";
import { LIMITS } from "@/lib/auth/rate-limit";
import { inviteSchema } from "@/lib/auth/validation";
import { inviteUser, listTeam } from "@/lib/auth/team";

export const dynamic = "force-dynamic";

/** GET /api/team — everyone the signed-in account is responsible for. */
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  const r = await listTeam(session);
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  return json({ members: r.data });
}

/** POST /api/team — invite someone. They get a link; nothing works until they set a password. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  const blocked = limited(req, "invite", LIMITS.invite.limit, LIMITS.invite.windowMs);
  if (blocked) return blocked;

  const parsed = await parseBody(req, inviteSchema);
  if (!parsed.ok) return parsed.response;

  const r = await inviteUser(session, parsed.data, baseUrl(req));
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  return json(r.data, 201);
}
