import { NextRequest } from "next/server";
import { emailOnlySchema } from "@/lib/auth/validation";
import { resendVerification } from "@/lib/auth/service";
import { parseBody, json, limited, baseUrl } from "@/lib/auth/http";
import { LIMITS } from "@/lib/auth/rate-limit";

export const dynamic = "force-dynamic";

/** POST /api/auth/resend-verification {email} → always 200. */
export async function POST(req: NextRequest) {
  const blocked = limited(req, "resend", LIMITS.resend.limit, LIMITS.resend.windowMs);
  if (blocked) return blocked;

  const parsed = await parseBody(req, emailOnlySchema);
  if (!parsed.ok) return parsed.response;

  const { devVerifyUrl } = await resendVerification(parsed.data.email, baseUrl(req));
  return json({
    status: "verification_sent",
    message: "If that address needs confirmation, we sent a new link.",
    ...(devVerifyUrl ? { devVerifyUrl } : {}),
  });
}
