import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { json, unauthorized, parseBody } from "@/lib/auth/http";
import { districtCreateSchema } from "@/lib/auth/validation";
import { listDistricts, createDistrict } from "@/lib/auth/districts";

export const dynamic = "force-dynamic";

/** GET /api/districts[?organizationId=] — the organization's districts and its unplaced locations. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  const organizationId = req.nextUrl.searchParams.get("organizationId") ?? undefined;
  const r = await listDistricts(session, organizationId);
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  return json(r.data);
}

/** POST /api/districts — a new, empty district. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  const parsed = await parseBody(req, districtCreateSchema);
  if (!parsed.ok) return parsed.response;
  const r = await createDistrict(session, parsed.data);
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  return json(r.data, 201);
}
