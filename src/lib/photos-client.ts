"use client";

/**
 * A nameplate photo from a phone on a rooftop to the server: checked, decoded (HEIC included),
 * shrunk to something that uploads over a weak connection, and sent with retries.
 *
 * Everything heavy happens here, in the browser. The server receives a JPEG of a few hundred
 * kilobytes and only has to store it.
 */

/** What the phone may hand us. A 12-megapixel HEIC is 2–4 MB, a JPEG twice that. */
export const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;
/** Long side after shrinking: plenty to read a serial number, small enough for 4G on a roof. */
export const MAX_SIDE_PX = 1600;
const JPEG_QUALITY = 0.82;

export class PhotoError extends Error {}

/** Pure: the size a photo is drawn at so its long side is at most `max`, never enlarged. */
export function fitWithin(width: number, height: number, max = MAX_SIDE_PX): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Pure: whether a file is HEIC/HEIF by type or, since browsers often leave the type empty, by name. */
export function isHeic(file: { type: string; name: string }): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

async function decode(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (file.size > MAX_ORIGINAL_BYTES) throw new PhotoError("The photo is over 10 MB");
  if (!file.type.startsWith("image/") && !isHeic(file)) throw new PhotoError("That is not a photo");

  let bitmap: ImageBitmap;
  try {
    // Safari decodes HEIC itself, and iOS usually converts it to JPEG on the way in anyway
    bitmap = await decode(file);
  } catch {
    if (!isHeic(file)) throw new PhotoError("This photo could not be read");
    // Chrome and Firefox cannot; the converter is loaded only for them, only when needed
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: JPEG_QUALITY });
    bitmap = await decode(Array.isArray(converted) ? converted[0] : converted);
  }

  const size = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoError("This browser cannot resize photos");
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new PhotoError("This photo could not be compressed");
  return { blob, ...size };
}

export interface UploadedPhoto {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  createdBy: string | null;
}

/** Waits between attempts: a dropped connection on a roof usually comes back within a minute. */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

/**
 * Sends the photo, retrying network failures and server hiccups. A refusal that will not
 * change on its own — too many photos, no permission — stops at once with the server's reason.
 */
export async function uploadPhoto(
  unitId: string,
  photo: PreparedPhoto,
  onRetry?: (attempt: number, waitMs: number) => void,
): Promise<UploadedPhoto> {
  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.append("file", photo.blob, "nameplate.jpg");
    form.append("width", String(photo.width));
    form.append("height", String(photo.height));
    let res: Response | null = null;
    try {
      res = await fetch(`/api/units/${unitId}/photos`, { method: "POST", body: form, credentials: "same-origin" });
    } catch {
      res = null; // offline, or the connection dropped mid-upload
    }
    if (res?.ok) return (await res.json()) as UploadedPhoto;
    if (res && res.status < 500) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new PhotoError(body.message ?? "The photo was refused");
    }
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait === undefined) throw new PhotoError("Could not upload — check the connection and try again");
    onRetry?.(attempt + 1, wait);
    await new Promise((r) => setTimeout(r, wait));
  }
}
