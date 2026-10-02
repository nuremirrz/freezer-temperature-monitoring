import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { json, unauthorized } from "@/lib/auth/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/organizations — what the signed-in account may pick from. Qimby's team stands
 * outside every organization and sees them all; everyone else is inside exactly one and gets
 * only that, so the same screen can offer a switch to one and not to the other.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  const { role, organizationId } = session.user;
  const organizations = await prisma.organization.findMany({
    where: role === "admin" ? {} : { id: organizationId ?? "" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return json({ organizations });
}
