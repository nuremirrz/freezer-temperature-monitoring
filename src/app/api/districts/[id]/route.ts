import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { json, unauthorized, parseBody, sameOrigin } from "@/lib/auth/http";
import { districtPatchSchema } from "@/lib/auth/validation";
import { updateDistrict, deleteDistrict } from "@/lib/auth/districts";

export const dynamic = "force-dynamic";

/** PATCH /api/districts/[id] — rename, or set the full list of locations that belong here. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const parsed = await parseBody(req, districtPatchSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = await ctx.params;
  const r = await updateDistrict(session, id, parsed.data);
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  return json(r.data);
}

/** DELETE /api/districts/[id] — its locations are left with no district; its managers lose it. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!sameOrigin(req)) return NextResponse.json({ message: "Bad origin" }, { status: 403 });
  const { id } = await ctx.params;
  const r = await deleteDistrict(session, id);
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  return json(r.data);
}
