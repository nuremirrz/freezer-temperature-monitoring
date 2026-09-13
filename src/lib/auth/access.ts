import { prisma } from "@/lib/db";
import type { CurrentSession } from "./session";
import type { VisibleLocations } from "./visibility";

export { canSee, locationWhere, type VisibleLocations } from "./visibility";

/** The locations this session may see: everything for staff, the granted set for a client. */
export async function visibleLocationIds(session: CurrentSession): Promise<VisibleLocations> {
  if (session.user.role === "admin") return "all";
  const rows = await prisma.locationAccess.findMany({
    where: { userId: session.user.id },
    select: { locationId: true },
  });
  return rows.map((r) => r.locationId);
}
