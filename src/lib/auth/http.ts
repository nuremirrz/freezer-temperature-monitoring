import { NextRequest, NextResponse } from "next/server";
import type { ZodType } from "zod";
import { rateLimit } from "./rate-limit";

/** Shared plumbing for the auth route handlers. */

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function unauthorized(message = "Sign in required") {
  return NextResponse.json({ error: "unauthorized", message }, { status: 401 });
}

export function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

/** Public origin for links in e-mails: APP_URL in production, the request origin otherwise. */
export function baseUrl(req: NextRequest): string {
  return (process.env.APP_URL ?? req.nextUrl.origin).replace(/\/+$/, "");
}

/**
 * CSRF guard for state-changing calls: a browser always sends Origin on cross-site requests,
 * so a foreign Origin is rejected. Requests without Origin (curl, server-to-server) pass.
 */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<Parsed<T>> {
  if (!sameOrigin(req)) {
    return { ok: false, response: json({ error: "forbidden", message: "Cross-site request rejected" }, 403) };
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: json({ error: "invalid_json", message: "Body must be JSON" }, 400) };
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      response: json(
        { error: "validation", field: issue.path.join(".") || undefined, message: issue.message },
        400,
      ),
    };
  }
  return { ok: true, data: result.data };
}

export function limited(req: NextRequest, bucket: string, limit: number, windowMs: number): NextResponse | null {
  const key = `${bucket}:${clientIp(req) ?? "unknown"}`;
  if (rateLimit(key, limit, windowMs)) return null;
  return json({ error: "rate_limited", message: "Too many attempts. Try again in a few minutes." }, 429);
}
