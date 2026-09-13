import { NextRequest } from "next/server";
import { resetPasswordSchema } from "@/lib/auth/validation";
import { resetPassword } from "@/lib/auth/service";
import { parseBody, json, limited, clientIp } from "@/lib/auth/http";
import { LIMITS } from "@/lib/auth/rate-limit";

export const dynamic = "force-dynamic";

/** POST /api/auth/reset-password {token, password} */
export async function POST(req: NextRequest) {
  const blocked = limited(req, "reset", LIMITS.reset.limit, LIMITS.reset.windowMs);
  if (blocked) return blocked;

  const parsed = await parseBody(req, resetPasswordSchema);
  if (!parsed.ok) return parsed.response;

  const result = await resetPassword(parsed.data.token, parsed.data.password, {
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
  });
  if (!result.ok) return json({ error: result.code, message: result.message }, result.status);
  return json({ status: "password_updated", message: "Password updated. You are signed in." });
}
