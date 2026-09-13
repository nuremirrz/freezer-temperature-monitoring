/**
 * Who may see which location — the pure half, with no database behind it, so the rule that
 * separates one client's restaurants from another's can be tested on its own.
 * The lookup that needs the database lives in access.ts.
 */

/**
 * Staff get "all" rather than a list of every id — the estate is meant to grow, and loading
 * it on every request only to not filter by it would be work done for nothing.
 */
export type VisibleLocations = "all" | string[];

export function canSee(visible: VisibleLocations, locationId: string): boolean {
  return visible === "all" || visible.includes(locationId);
}

/**
 * A `where` fragment for queries that filter locations directly.
 * `{ id: { in: [] } }` matches nothing, which is the right answer for an account that has
 * been granted nothing yet — the dangerous mistake here is an empty object, which matches
 * everything.
 */
export function locationWhere(visible: VisibleLocations) {
  return visible === "all" ? {} : { id: { in: visible } };
}
