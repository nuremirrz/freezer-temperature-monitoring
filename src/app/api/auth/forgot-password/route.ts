import { NextRequest } from "next/server";
import { emailOnlySchema } from "@/lib/auth/validation";
import { requestPasswordReset } from "@/lib/auth/service";
import { parseBody, json, limited, baseUrl } from "@/lib/auth/http";
import { LIMITS } from "@/lib/auth/rate-limit";

export const dynamic = "force-dynamic";

/** POST /api/auth/forgot-password {email} → always 200 (no enumeration). */
export async function POST(req: NextRequest) {
  const blocked = limited(req, "forgot", LIMITS.forgot.limit, LIMITS.forgot.windowMs);
  if (blocked) return blocked;

  const parsed = await parseBody(req, emailOnlySchema);
  if (!parsed.ok) return parsed.response;

  const { devResetUrl } = await requestPasswordReset(parsed.data.email, baseUrl(req));
  return json({
    status: "reset_sent",
    message: "If an account exists for that e-mail, we sent a reset link.",
    ...(devResetUrl ? { devResetUrl } : {}),
  });
}
