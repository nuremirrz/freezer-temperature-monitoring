import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where unit photos are kept. Two backends behind one small interface:
 *
 *   supabase — Supabase Storage, a private bucket in the same project as the database. Used
 *              wherever SUPABASE_URL and SUPABASE_SERVICE_KEY are set, which in practice means
 *              production. Photos are never public: the browser gets a signed link that lives
 *              for a few minutes, and only after our own access check.
 *   local    — a folder on disk (.data/photos), for development and CI. Never in production:
 *              Render's disk is wiped on every deploy, so a photo saved there would vanish.
 *   off      — production without the keys. Uploading is refused with a clear message rather
 *              than written somewhere it will not survive.
 */

export type StorageMode = "supabase" | "local" | "off";

export interface ObjectStorage {
  mode: StorageMode;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** A URL the browser may fetch the object from for a short while; null when it is served by us. */
  signedUrl(key: string, expiresInSec: number): Promise<string | null>;
  /** The bytes, for the local backend, which has no URL of its own. */
  read(key: string): Promise<Uint8Array>;
}

export const PHOTO_BUCKET = process.env.PHOTO_BUCKET || "unit-photos";

/* ------------------------------------------------------------------ */
/* Supabase Storage                                                    */
/* ------------------------------------------------------------------ */

function supabaseStorage(baseUrl: string, key: string, bucket: string): ObjectStorage {
  const root = `${baseUrl.replace(/\/+$/, "")}/storage/v1`;
  // The new secret keys (sb_secret_…) are not JWTs and go on `apikey` only; a legacy
  // service_role JWT is also accepted as a bearer token. Sending a non-JWT as Bearer is
  // rejected as "Invalid JWT", so it is added only for the old kind.
  const headers: Record<string, string> = { apikey: key };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;

  let bucketReady: Promise<void> | null = null;
  const ensureBucket = () =>
    (bucketReady ??= (async () => {
      const res = await fetch(`${root}/bucket/${bucket}`, { headers });
      if (res.ok) return;
      const created = await fetch(`${root}/bucket`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          id: bucket,
          name: bucket,
          public: false,
          file_size_limit: 5 * 1024 * 1024,
          allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
        }),
      });
      // Two processes may race to create it; "already exists" is success
      if (!created.ok && created.status !== 409) {
        bucketReady = null;
        throw new Error(`storage: could not create bucket ${bucket}: HTTP ${created.status} ${(await created.text()).slice(0, 200)}`);
      }
    })());

  return {
    mode: "supabase",
    async put(objectKey, bytes, contentType) {
      await ensureBucket();
      const res = await fetch(`${root}/object/${bucket}/${objectKey}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": contentType, "x-upsert": "false" },
        body: Buffer.from(bytes),
      });
      if (!res.ok) throw new Error(`storage: upload failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    async remove(objectKey) {
      const res = await fetch(`${root}/object/${bucket}`, {
        method: "DELETE",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [objectKey] }),
      });
      if (!res.ok) throw new Error(`storage: delete failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    async signedUrl(objectKey, expiresInSec) {
      const res = await fetch(`${root}/object/sign/${bucket}/${objectKey}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: expiresInSec }),
      });
      if (!res.ok) throw new Error(`storage: sign failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { signedURL?: string; signedUrl?: string };
      const signed = body.signedURL ?? body.signedUrl;
      if (!signed) throw new Error("storage: sign answered without a URL");
      // The API answers with a path relative to /storage/v1
      return signed.startsWith("http") ? signed : `${root}${signed.startsWith("/") ? "" : "/"}${signed}`;
    },
    async read() {
      throw new Error("storage: read() is for the local backend; Supabase objects are served by signed URL");
    },
  };
}

/* ------------------------------------------------------------------ */
/* Local folder                                                        */
/* ------------------------------------------------------------------ */

export function localStorage(dir: string): ObjectStorage {
  const resolve = (key: string) => {
    const full = path.resolve(dir, key);
    // Keys are generated by us, but a path that climbs out of the folder is refused regardless
    if (!full.startsWith(path.resolve(dir) + path.sep)) throw new Error("storage: key escapes the storage folder");
    return full;
  };
  return {
    mode: "local",
    async put(key, bytes) {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
    },
    async remove(key) {
      await rm(resolve(key), { force: true });
    },
    async signedUrl() {
      return null;
    },
    async read(key) {
      return new Uint8Array(await readFile(resolve(key)));
    },
  };
}

const offStorage: ObjectStorage = {
  mode: "off",
  async put() {
    throw new Error("Photo storage is not configured on this server");
  },
  async remove() {},
  async signedUrl() {
    return null;
  },
  async read() {
    throw new Error("Photo storage is not configured on this server");
  },
};

let cached: ObjectStorage | null = null;

export function getStorage(): ObjectStorage {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (url && key) cached = supabaseStorage(url, key, PHOTO_BUCKET);
  else if (process.env.NODE_ENV !== "production") cached = localStorage(process.env.PHOTO_DIR || path.join(process.cwd(), ".data", "photos"));
  else cached = offStorage;
  return cached;
}
