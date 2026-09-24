import { prisma } from "@/lib/db";
import type { CurrentSession } from "./session";
import { scopeOf, type VisibleLocations } from "./visibility";

export { canSee, locationWhere, scopeOf, type VisibleLocations, type Scope } from "./visibility";

/**
 * The locations this session may see, resolved with one query or none.
 *
 * Read from the database on every request rather than remembered in the session. The moment an
 * owner moves a location to another district, or takes a technician off one, the very next
 * request has to answer differently — a right that lives on until a token expires is the thing
 * the spec warns against.
 */
export async function visibleLocationIds(session: CurrentSession): Promise<VisibleLocations> {
  const { id: userId } = session.user;
  const scope = scopeOf(session.user);

  switch (scope.kind) {
    case "everything":
      return "all";

    case "nothing":
      return [];

    case "organization": {
      const rows = await prisma.location.findMany({
        where: { organizationId: scope.organizationId },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }

    case "districts": {
      // Through the district, so that moving a location between districts moves it out of
      // one manager's sight and into another's with no row to update on either.
      const rows = await prisma.location.findMany({
        where: { district: { managers: { some: { userId } } } },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }

    case "locations": {
      const rows = await prisma.locationAccess.findMany({
        where: { userId },
        select: { locationId: true },
      });
      return rows.map((r) => r.locationId);
    }
  }
}
