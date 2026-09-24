import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { generateToken, hashToken } from "./tokens";
import type { UserRole } from "@/generated/prisma/client";

export const SESSION_COOKIE = "qimby_session";
const DAY_MS = 24 * 60 * 60_000;
/** "Remember me" sessions */
export const SESSION_TTL_LONG_MS = 30 * DAY_MS;
/** Default sessions (also a browser-session cookie) */
export const SESSION_TTL_SHORT_MS = 1 * DAY_MS;

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  /// Taken from the schema rather than written out here, so adding a role cannot leave this
  /// behind still believing there are two of them.
  role: UserRole;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface CurrentSession {
  sessionId: string;
  user: SessionUser;
  expiresAt: Date;
}

export interface SessionMeta {
  rememberMe?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

/** Creates a DB session and sets the cookie. Only usable where cookies can be written (route handlers). */
export async function createSession(userId: string, meta: SessionMeta = {}): Promise<void> {
  const { raw, hash } = generateToken();
  const ttl = meta.rememberMe ? SESSION_TTL_LONG_MS : SESSION_TTL_SHORT_MS;
  const expiresAt = new Date(Date.now() + ttl);

  await prisma.session.create({
    data: {
      id: hash,
      userId,
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
    },
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(meta.rememberMe ? { expires: expiresAt } : {}), // otherwise a browser-session cookie
  });
}

/** Resolves the current request's session, or null. Safe in server components (read-only). */
export async function getSession(): Promise<CurrentSession | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const session = await prisma.session.findUnique({
    where: { id: hashToken(raw) },
    include: {
      user: { select: { id: true, email: true, name: true, role: true, emailVerifiedAt: true, createdAt: true } },
    },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return { sessionId: session.id, user: session.user, expiresAt: session.expiresAt };
}

/** Deletes the current session (and optionally every session of that user) and clears the cookie. */
export async function destroySession(opts: { everywhere?: boolean } = {}): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (raw) {
    const id = hashToken(raw);
    if (opts.everywhere) {
      const s = await prisma.session.findUnique({ where: { id }, select: { userId: true } });
      if (s) await prisma.session.deleteMany({ where: { userId: s.userId } });
    } else {
      await prisma.session.deleteMany({ where: { id } });
    }
  }
  jar.delete(SESSION_COOKIE);
}

export async function destroyAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
