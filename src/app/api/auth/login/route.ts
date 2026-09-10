import { NextRequest } from "next/server";
import { loginSchema } from "@/lib/auth/validation";
import { loginUser } from "@/lib/auth/service";
import { parseBody, json, limited, clientIp } from "@/lib/auth/http";
import { LIMITS } from "@/lib/auth/rate-limit";

export const dynamic = "force-dynamic";

/** POST /api/auth/login {email, password, rememberMe?} → sets the session cookie. */
export async function POST(req: NextRequest) {
  const blocked = limited(req, "login", LIMITS.login.limit, LIMITS.login.windowMs);
  if (blocked) return blocked;

  const parsed = await parseBody(req, loginSchema);
  if (!parsed.ok) return parsed.response;

  const result = await loginUser(parsed.data, {
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
  });
  if (!result.ok) return json({ error: result.code, message: result.message }, result.status);
  return json({ status: "ok", user: result.data });
}
