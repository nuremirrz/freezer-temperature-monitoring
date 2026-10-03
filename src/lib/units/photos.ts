import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import type { CurrentSession } from "@/lib/auth/session";
import { fail, type AuthResult } from "@/lib/auth/service";
import { canEditPassport } from "@/lib/auth/permissions";
import { visibleLocationIds, canSee } from "@/lib/auth/access";
import { getStorage, type ObjectStorage } from "@/lib/storage";

/**
 * Nameplate photos: up to five per unit, seen by whoever sees the unit, added and removed by
 * whoever may edit its passport — every role, the technician first of all.
 *
 * The browser shrinks a photo before it is sent (see photos-client.ts), so what arrives here
 * is a JPEG of a few hundred kilobytes; the limits below are a backstop, not the plan.
 */

export const MAX_PHOTOS_PER_UNIT = 5;
/** After the browser's compression; the original may be up to 10 MB on the phone. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);
const SIGNED_URL_TTL_SEC = 10 * 60;

export interface PhotoView {
  id: string;
  /** Where the browser fetches it: our own route, which checks access and then serves or redirects. */
  url: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  createdBy: string | null;
}

async function reachableUnit(session: CurrentSession, unitId: string) {
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true, locationId: true } });
  const visible = await visibleLocationIds(session);
  if (!unit || !canSee(visible, unit.locationId)) return null;
  return unit;
}

function view(p: { id: string; unitId: string; width: number | null; height: number | null; createdAt: Date; createdBy: { name: string | null; email: string } | null }): PhotoView {
  return {
    id: p.id,
    url: `/api/units/${p.unitId}/photos/${p.id}`,
    width: p.width,
    height: p.height,
    createdAt: p.createdAt.toISOString(),
    createdBy: p.createdBy?.name ?? p.createdBy?.email ?? null,
  };
}

const photoSelect = {
  id: true, unitId: true, width: true, height: true, createdAt: true,
  createdBy: { select: { name: true, email: true } },
} as const;

export async function listPhotos(session: CurrentSession, unitId: string): Promise<AuthResult<{ photos: PhotoView[]; canEdit: boolean; storage: string }>> {
  const unit = await reachableUnit(session, unitId);
  if (!unit) return fail("not_found", "Unit not found", 404);
  const rows = await prisma.unitPhoto.findMany({ where: { unitId }, orderBy: { createdAt: "asc" }, select: photoSelect });
  return { ok: true, data: { photos: rows.map(view), canEdit: canEditPassport(session.user), storage: getStorage().mode } };
}

export interface PhotoUpload {
  bytes: Uint8Array;
  contentType: string;
  width?: number;
  height?: number;
}

export async function addPhoto(
  session: CurrentSession,
  unitId: string,
  upload: PhotoUpload,
  storage: ObjectStorage = getStorage(),
): Promise<AuthResult<PhotoView>> {
  const unit = await reachableUnit(session, unitId);
  if (!unit) return fail("not_found", "Unit not found", 404);
  if (!canEditPassport(session.user)) return fail("forbidden", "You cannot add photos to this unit", 403);
  if (storage.mode === "off") return fail("storage_off", "Photo storage is not set up yet — ask Qimby", 503);
  if (!ACCEPTED.has(upload.contentType)) return fail("bad_type", "Photos must be JPEG, PNG or WebP", 415);
  if (upload.bytes.byteLength === 0) return fail("empty", "The photo is empty", 400);
  if (upload.bytes.byteLength > MAX_UPLOAD_BYTES) return fail("too_large", "The photo is too large even after compression", 413);

  const count = await prisma.unitPhoto.count({ where: { unitId } });
  if (count >= MAX_PHOTOS_PER_UNIT) return fail("too_many", `A unit has at most ${MAX_PHOTOS_PER_UNIT} photos — remove one first`, 409);

  const ext = upload.contentType === "image/png" ? "png" : upload.contentType === "image/webp" ? "webp" : "jpg";
  const path = `units/${unitId}/${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;
  // Bytes first, row second: a row without its file would be a broken image forever, while a
  // file without its row is only space, and the next upload attempt makes a new one.
  await storage.put(path, upload.bytes, upload.contentType);
  const row = await prisma.unitPhoto.create({
    data: {
      unitId,
      path,
      contentType: upload.contentType,
      bytes: upload.bytes.byteLength,
      width: upload.width ?? null,
      height: upload.height ?? null,
      createdById: session.user.id,
    },
    select: photoSelect,
  });
  return { ok: true, data: view(row) };
}

export async function deletePhoto(
  session: CurrentSession,
  unitId: string,
  photoId: string,
  storage: ObjectStorage = getStorage(),
): Promise<AuthResult<{ id: string }>> {
  const unit = await reachableUnit(session, unitId);
  if (!unit) return fail("not_found", "Unit not found", 404);
  if (!canEditPassport(session.user)) return fail("forbidden", "You cannot remove photos from this unit", 403);
  const photo = await prisma.unitPhoto.findFirst({ where: { id: photoId, unitId }, select: { id: true, path: true } });
  if (!photo) return fail("not_found", "Photo not found", 404);
  // Row first: once it is gone nobody can see the photo, and a leftover file is only space.
  await prisma.unitPhoto.delete({ where: { id: photo.id } });
  try {
    await storage.remove(photo.path);
  } catch (err) {
    console.error(`[photos] row deleted, file left behind at ${photo.path}:`, err instanceof Error ? err.message : err);
  }
  return { ok: true, data: { id: photo.id } };
}

/** How the browser gets the bytes: a short-lived signed link, or the bytes themselves locally. */
export async function photoContent(
  session: CurrentSession,
  unitId: string,
  photoId: string,
  storage: ObjectStorage = getStorage(),
): Promise<AuthResult<{ redirect: string } | { bytes: Uint8Array; contentType: string }>> {
  const unit = await reachableUnit(session, unitId);
  if (!unit) return fail("not_found", "Photo not found", 404);
  const photo = await prisma.unitPhoto.findFirst({ where: { id: photoId, unitId }, select: { path: true, contentType: true } });
  if (!photo) return fail("not_found", "Photo not found", 404);
  const signed = await storage.signedUrl(photo.path, SIGNED_URL_TTL_SEC);
  if (signed) return { ok: true, data: { redirect: signed } };
  return { ok: true, data: { bytes: await storage.read(photo.path), contentType: photo.contentType } };
}
