import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { json, unauthorized, sameOrigin } from "@/lib/auth/http";
import { photoContent, deletePhoto } from "@/lib/units/photos";

export const dynamic = "force-dynamic";

/**
 * GET /api/units/[id]/photos/[photoId] — the photo, after the same access check as the unit.
 * In production a redirect to a signed Supabase link that expires in minutes; locally the bytes.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { id, photoId } = await ctx.params;
  const r = await photoContent(session, id, photoId);
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  if ("redirect" in r.data) {
    const res = NextResponse.redirect(r.data.redirect, 302);
    // The signed link is short-lived; the browser must ask us again rather than reuse it
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
  return new NextResponse(Buffer.from(r.data.bytes), {
    headers: { "Content-Type": r.data.contentType, "Cache-Control": "private, max-age=300" },
  });
}

/** DELETE /api/units/[id]/photos/[photoId] — anyone who may edit the passport. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site request rejected" }, 403);
  const { id, photoId } = await ctx.params;
  const r = await deletePhoto(session, id, photoId);
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  return json(r.data);
}
