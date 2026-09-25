import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword, DUMMY_HASH } from "./password";
import { generateToken, hashToken } from "./tokens";
import { sendMail, mailerMode } from "./mailer";
import { verifyEmailMail, resetPasswordMail } from "./emails";
import { createSession, destroyAllSessions, type SessionMeta } from "./session";

/**
 * Account workflows. Route handlers stay thin; everything that touches users lives here.
 *
 * Privacy notes (per the task): passwords are hashed with scrypt before they reach the database,
 * never logged; every new account gets role `admin` until roles are split; sensor data is
 * unrelated to users, so deleting an account leaves readings, alerts and sensors intact.
 */

const VERIFY_TTL_MS = 24 * 60 * 60_000;
const RESET_TTL_MS = 60 * 60_000;

export type AuthFailure = { ok: false; code: string; message: string; status: number };
export type AuthOk<T = undefined> = { ok: true; data: T };
export type AuthResult<T = undefined> = AuthOk<T> | AuthFailure;

export const fail = (code: string, message: string, status: number): AuthFailure => ({ ok: false, code, message, status });

/** In development without SMTP the link is returned to the caller so the flow can be completed locally. */
function devLink(link: string): string | undefined {
  return mailerMode() === "console" && process.env.NODE_ENV !== "production" ? link : undefined;
}

async function issueToken(userId: string, type: "email_verify" | "password_reset", ttlMs: number) {
  // A fresh token supersedes any unused one of the same kind
  await prisma.authToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: new Date() },
  });
  const { raw, hash } = generateToken();
  await prisma.authToken.create({
    data: { id: hash, userId, type, expiresAt: new Date(Date.now() + ttlMs) },
  });
  return raw;
}

async function sendVerification(user: { id: string; email: string }, base: string): Promise<string> {
  const raw = await issueToken(user.id, "email_verify", VERIFY_TTL_MS);
  const link = `${base}/api/auth/verify?token=${raw}`;
  await sendMail(verifyEmailMail(user.email, link));
  return link;
}

export interface RegisterInput {
  name?: string;
  email: string;
  password: string;
}

/**
 * Creates an unverified account and e-mails a confirmation link.
 * The response is the same whether or not the e-mail was already taken (no account enumeration):
 * an existing unverified account just gets the confirmation e-mail again.
 */
export async function registerUser(input: RegisterInput, base: string): Promise<{ devVerifyUrl?: string }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });

  if (existing) {
    if (existing.emailVerifiedAt) return {}; // silently ignore — the owner can use "forgot password"
    const link = await sendVerification(existing, base); // never overwrite the stored password here
    return { devVerifyUrl: devLink(link) };
  }

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name?.trim() || null,
      passwordHash: await hashPassword(input.password),
      // No role here on purpose: the schema's default is the one with no visibility. Handing
      // out `admin` was what made an open sign-up form a way into every restaurant.
    },
  });
  const link = await sendVerification(user, base);
  return { devVerifyUrl: devLink(link) };
}

export async function resendVerification(email: string, base: string): Promise<{ devVerifyUrl?: string }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.emailVerifiedAt) return {};
  const link = await sendVerification(user, base);
  return { devVerifyUrl: devLink(link) };
}

export async function verifyEmailToken(raw: string): Promise<AuthResult<{ userId: string }>> {
  const token = await prisma.authToken.findUnique({ where: { id: hashToken(raw) } });
  if (!token || token.type !== "email_verify" || token.usedAt || token.expiresAt.getTime() <= Date.now()) {
    return fail("invalid_token", "This confirmation link is invalid or has expired", 400);
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.authToken.update({ where: { id: token.id }, data: { usedAt: now } }),
    prisma.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: now } }),
  ]);
  return { ok: true, data: { userId: token.userId } };
}

export interface LoginInput {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export async function loginUser(
  input: LoginInput,
  meta: SessionMeta,
): Promise<AuthResult<{ id: string; email: string; name: string | null; role: string }>> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Always run the hash so an unknown e-mail takes as long as a wrong password
  const valid = await verifyPassword(input.password, user?.passwordHash ?? (await DUMMY_HASH));
  if (!user || !valid) return fail("invalid_credentials", "Invalid e-mail or password", 401);
  if (!user.emailVerifiedAt) {
    return fail("email_not_verified", "Confirm your e-mail address before signing in", 403);
  }
  // Checked after the password, so a deactivated account costs the same time as a live one and
  // the answer is only given to someone who already knew the password.
  if (user.status === "deactivated") {
    return fail("account_deactivated", "This account has been deactivated. Ask the owner of your organization.", 403);
  }
  if (user.status !== "active") {
    return fail("account_not_active", "Finish setting up your account from the invitation link first", 403);
  }
  await createSession(user.id, { ...meta, rememberMe: input.rememberMe });
  return { ok: true, data: { id: user.id, email: user.email, name: user.name, role: user.role } };
}

export async function requestPasswordReset(email: string, base: string): Promise<{ devResetUrl?: string }> {
  const user = await prisma.user.findUnique({ where: { email } });
  // A deactivated account gets the same silence as an unknown address. Setting a new password
  // is what turns an invitation into an active account, so a reset link in the wrong hands
  // would be a way back in.
  if (!user || user.status === "deactivated") return {};
  const raw = await issueToken(user.id, "password_reset", RESET_TTL_MS);
  const link = `${base}/reset-password?token=${raw}`;
  await sendMail(resetPasswordMail(user.email, link));
  return { devResetUrl: devLink(link) };
}

/**
 * Sets a new password and signs the owner in right here.
 *
 * Following a reset link already proves control of the account, so asking for the e-mail and
 * the password that was just chosen adds nothing. It also makes an invite work for someone
 * who was only handed the link: they never have to be told which address the account is under.
 * Every other session still dies — if the reset was prompted by a leak, the intruder's tab
 * must not survive it.
 */
export async function resetPassword(raw: string, password: string, meta: SessionMeta = {}): Promise<AuthResult> {
  const token = await prisma.authToken.findUnique({
    where: { id: hashToken(raw) },
    include: { user: { select: { status: true } } },
  });
  if (!token || token.type !== "password_reset" || token.usedAt || token.expiresAt.getTime() <= Date.now()) {
    return fail("invalid_token", "This reset link is invalid or has expired", 400);
  }
  // A link issued before the account was deactivated is still a valid link. It must not be a
  // way back in — and it gets the same answer as an expired one, so the link itself does not
  // announce what happened to the account.
  if (token.user.status === "deactivated") {
    return fail("invalid_token", "This reset link is invalid or has expired", 400);
  }
  const now = new Date();
  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.authToken.update({ where: { id: token.id }, data: { usedAt: now } }),
    prisma.user.update({
      where: { id: token.userId },
      // Choosing a password is the step that turns an invitation into an account. For a reset
      // it is already active and this changes nothing.
      data: { passwordHash, emailVerifiedAt: { set: now }, status: "active" },
    }),
    prisma.session.deleteMany({ where: { userId: token.userId } }),
  ]);
  // After the transaction, so the sweep above cannot take this one with it
  await createSession(token.userId, meta);
  return { ok: true, data: undefined };
}

/** Deletes the account (sessions and tokens cascade). Sensor data is untouched — it isn't tied to users. */
export async function deleteAccount(userId: string, password: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return fail("not_found", "Account not found", 404);
  if (!(await verifyPassword(password, user.passwordHash))) {
    return fail("invalid_credentials", "Password is incorrect", 403);
  }
  await destroyAllSessions(userId);
  await prisma.user.delete({ where: { id: userId } });
  return { ok: true, data: undefined };
}
