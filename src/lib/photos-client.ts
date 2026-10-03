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

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/**
 * Pure: whether the first bytes are an HEIF container. Name and type lie — an iPhone photo can
 * arrive as "image.jpg" with an empty type — the bytes do not: "ftyp" at offset 4, then a brand.
 */
export function looksLikeHeif(head: Uint8Array): boolean {
  if (head.length < 12) return false;
  const ascii = (a: number, b: number) => String.fromCharCode(...head.slice(a, b));
  return ascii(4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(8, 12).toLowerCase());
}

type Drawable = { source: CanvasImageSource; width: number; height: number; done: () => void };

/**
 * Turns a file into something a canvas can draw, trying the ways browsers differ on, in order:
 *   1. createImageBitmap honouring the photo's rotation — modern Chrome and Firefox;
 *   2. createImageBitmap without options — Safari rejects the option it does not know;
 *   3. an <img> element — the oldest path and the one every browser has; it applies the
 *      photo's rotation by itself.
 */
async function decode(file: Blob): Promise<Drawable> {
  try {
    const b = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: b, width: b.width, height: b.height, done: () => b.close() };
  } catch {
    // fall through
  }
  try {
    const b = await createImageBitmap(file);
    return { source: b, width: b.width, height: b.height, done: () => b.close() };
  } catch {
    // fall through
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    if (!img.naturalWidth) throw new Error("empty image");
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (file.size > MAX_ORIGINAL_BYTES) throw new PhotoError("The photo is over 10 MB");
  // A type that says "not an image" is believed; an empty one is not judged here — iOS and
  // some file pickers leave it blank, and the decoder below finds out what the bytes are.
  if (file.type && !file.type.startsWith("image/") && !isHeic(file)) throw new PhotoError("That is not a photo");

  let image: Drawable;
  try {
    // Safari decodes HEIC itself, and iOS usually converts it to JPEG on the way in anyway
    image = await decode(file);
  } catch (first) {
    const heif = isHeic(file) || looksLikeHeif(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
    if (!heif) {
      console.warn("[photos] could not decode", { name: file.name, type: file.type, size: file.size }, first);
      throw new PhotoError(`This photo could not be read (${file.type || "unknown type"}) — try a JPEG or PNG`);
    }
    // Chrome and Firefox cannot read HEIC; the converter is loaded only for them, only when needed
    try {
      const { default: heic2any } = await import("heic2any");
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: JPEG_QUALITY });
      image = await decode(Array.isArray(converted) ? converted[0] : converted);
    } catch (second) {
      console.warn("[photos] HEIC conversion failed", { name: file.name, type: file.type, size: file.size }, second);
      throw new PhotoError("This HEIC photo could not be converted — try exporting it as JPEG");
    }
  }

  const size = fitWithin(image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoError("This browser cannot resize photos");
  ctx.drawImage(image.source, 0, 0, size.width, size.height);
  image.done();
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
