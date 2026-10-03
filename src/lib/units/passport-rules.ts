/**
 * The passport's pure half: which fields there are and what a patch changes. No database, so
 * the log's contents can be tested on their own.
 */

export const PASSPORT_FIELDS = ["model", "serial", "year", "refrigerant", "belts", "capacitor", "filter"] as const;
export type PassportField = (typeof PASSPORT_FIELDS)[number];

export interface Passport {
  model: string | null;
  serial: string | null;
  year: number | null;
  refrigerant: string | null;
  belts: string | null;
  capacitor: string | null;
  filter: string | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string | null; email: string } | null;
}

export type PassportPatch = Partial<Record<PassportField, string | number | null>>;

export interface PassportChange {
  field: PassportField;
  oldValue: string | null;
  newValue: string | null;
}

/** Pure: which fields a patch would actually change, as the log would record them. */
export function passportDiff(current: Record<PassportField, string | number | null>, patch: PassportPatch): PassportChange[] {
  const asText = (v: string | number | null | undefined) => (v === null || v === undefined ? null : String(v));
  const out: PassportChange[] = [];
  for (const field of PASSPORT_FIELDS) {
    if (!(field in patch) || patch[field] === undefined) continue;
    const before = asText(current[field]);
    const after = asText(patch[field]);
    if (before !== after) out.push({ field, oldValue: before, newValue: after });
  }
  return out;
}
