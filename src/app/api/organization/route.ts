import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { json, unauthorized } from "@/lib/auth/http";
import { listOrganization } from "@/lib/auth/locations";

export const dynamic = "force-dynamic";

/**
 * GET /api/organization[?organizationId=] — the owner's table: every restaurant of the
 * organization, closed ones included, with who is assigned to each, and the people available
 * to assign. Only an admin needs to say which organization.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  const organizationId = req.nextUrl.searchParams.get("organizationId") ?? undefined;
  const r = await listOrganization(session, organizationId);
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  return json(r.data);
}
