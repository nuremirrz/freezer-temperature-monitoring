import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token. Only the sha256 hash is stored; the raw value goes into the e-mail link. */
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
