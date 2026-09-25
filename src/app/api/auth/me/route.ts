import { getSession } from "@/lib/auth/session";
import { json, unauthorized } from "@/lib/auth/http";

export const dynamic = "force-dynamic";

/** GET /api/auth/me — the signed-in user. */
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  const { id, email, name, role, organizationId, status, emailVerifiedAt, createdAt } = session.user;
  return json({
    user: {
      id,
      email,
      name,
      role,
      organizationId,
      status,
      emailVerifiedAt: emailVerifiedAt?.toISOString() ?? null,
      createdAt: createdAt.toISOString(),
    },
    session: { expiresAt: session.expiresAt.toISOString() },
  });
}
