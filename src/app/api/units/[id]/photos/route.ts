import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { json, unauthorized, sameOrigin } from "@/lib/auth/http";
import { listPhotos, addPhoto, MAX_UPLOAD_BYTES } from "@/lib/units/photos";

export const dynamic = "force-dynamic";

/** GET /api/units/[id]/photos — the unit's nameplate photos, for anyone who sees the unit. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  const r = await listPhotos(session, id);
  if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
  return json(r.data);
}

/**
 * POST /api/units/[id]/photos — multipart: `file` (already compressed by the browser),
 * optional `width` and `height`. Any role that may edit the passport.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site request rejected" }, 403);
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) return json({ error: "too_large", message: "The photo is too large" }, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "bad_request", message: "Expected a multipart form" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "bad_request", message: "No file in the form" }, 400);
  const num = (k: string) => {
    const v = Number(form.get(k));
    return Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
  };

  const { id } = await ctx.params;
  try {
    const r = await addPhoto(session, id, {
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type,
      width: num("width"),
      height: num("height"),
    });
    if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
    return json(r.data, 201);
  } catch (err) {
    console.error("[photos] upload failed:", err instanceof Error ? err.message : err);
    return json({ error: "storage_error", message: "Could not store the photo — try again" }, 502);
  }
}
