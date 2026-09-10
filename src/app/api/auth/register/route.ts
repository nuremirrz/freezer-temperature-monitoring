import { NextRequest } from "next/server";
import { registerSchema } from "@/lib/auth/validation";
import { registerUser } from "@/lib/auth/service";
import { parseBody, json, limited, baseUrl } from "@/lib/auth/http";
import { LIMITS } from "@/lib/auth/rate-limit";

export const dynamic = "force-dynamic";

/** POST /api/auth/register {name?, email, password} → always 200 "check your inbox" (no enumeration). */
export async function POST(req: NextRequest) {
  const blocked = limited(req, "register", LIMITS.register.limit, LIMITS.register.windowMs);
  if (blocked) return blocked;

  const parsed = await parseBody(req, registerSchema);
  if (!parsed.ok) return parsed.response;

  const { devVerifyUrl } = await registerUser(parsed.data, baseUrl(req));
  return json({
    status: "verification_sent",
    message: "Check your inbox — we sent a confirmation link.",
    ...(devVerifyUrl ? { devVerifyUrl } : {}),
  });
}
