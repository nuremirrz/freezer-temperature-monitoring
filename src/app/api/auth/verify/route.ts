import { NextRequest, NextResponse } from "next/server";
import { verifyEmailToken } from "@/lib/auth/service";

export const dynamic = "force-dynamic";

/** GET /api/auth/verify?token=… — the link from the confirmation e-mail. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const result = token.length >= 16 ? await verifyEmailToken(token) : null;
  const target = result?.ok ? "/login?verified=1" : "/login?verify_error=1";
  return NextResponse.redirect(new URL(target, req.url));
}
