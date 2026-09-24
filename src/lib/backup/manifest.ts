import { readFile } from "node:fs/promises";

/**
 * Which tables a backup contains, and in which order they can be written back.
 *
 * The order is the foreign-key order: a Reading cannot exist before its Unit, a Unit before its
 * Location. Restoring in this sequence means no deferred constraints and no second pass.
 */

export interface BackupModel {
  /** Model name in the schema, and the file name inside a backup */
  name: string;
  /** Property on the Prisma client */
  delegate: string;
  /** A unique, sortable column — paging by it keeps the export flat in memory */
  cursor: string;
  /**
   * Live credentials that a backup must not carry.
   *
   * Sessions and reset links are worth nothing a day later — they expire on their own, and a
   * restore that omits them costs a user one sign-in. Copying them off-site every night, on the
   * other hand, spreads working keys to someone's account across every place a backup lands.
   * The trade is one-sided, so these tables are counted and skipped.
   */
  ephemeral?: true;
}

export const BACKUP_MODELS: BackupModel[] = [
  { name: "Organization", delegate: "organization", cursor: "id" },
  { name: "District", delegate: "district", cursor: "id" },
  { name: "User", delegate: "user", cursor: "id" },
  { name: "Location", delegate: "location", cursor: "id" },
  { name: "LocationAccess", delegate: "locationAccess", cursor: "userId" },
  { name: "UserDistrict", delegate: "userDistrict", cursor: "userId" },
  { name: "Session", delegate: "session", cursor: "id", ephemeral: true },
  { name: "AuthToken", delegate: "authToken", cursor: "id", ephemeral: true },
  { name: "Gateway", delegate: "gateway", cursor: "id" },
  { name: "Unit", delegate: "unit", cursor: "id" },
  { name: "Sensor", delegate: "sensor", cursor: "id" },
  { name: "SensorChannel", delegate: "sensorChannel", cursor: "id" },
  { name: "Reading", delegate: "reading", cursor: "id" },
  { name: "Alert", delegate: "alert", cursor: "id" },
  { name: "UnknownUplink", delegate: "unknownUplink", cursor: "id" },
];

export interface BackupMeta {
  takenAt: string;
  /** Host only. A backup must never carry the credentials it was taken with. */
  sourceHost: string;
  postgres: string;
  /** The schema this data fits — restoring onto an older one would lose columns silently. */
  lastMigration: string | null;
  counts: Record<string, number>;
  /** Tables deliberately left out, and how many rows each had when the copy was taken. */
  skipped: Record<string, number>;
  /**
   * Tables this build knows about that the database did not have.
   *
   * A backup taken just before a migration is taken by code that already knows the tables the
   * migration is about to add — which is exactly when a backup matters most. Recording their
   * absence lets the copy be honest about what it is: a copy of an older database.
   */
  absent?: string[];
}

/** Tables actually written to a backup. */
export const BACKED_UP_MODELS: BackupModel[] = BACKUP_MODELS.filter((m) => !m.ephemeral);

/** Model names declared in the schema file, in declaration order. */
export async function schemaModels(schemaPath = "prisma/schema.prisma"): Promise<string[]> {
  const text = await readFile(schemaPath, "utf8");
  return [...text.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
}

/**
 * Fails loudly when the schema grows a table this list does not know about.
 *
 * Without it, adding a model would quietly produce backups missing that table, and nobody would
 * find out until a restore. A backup that is silently incomplete is worse than none, because it
 * is trusted.
 */
export async function assertModelsCoverSchema(schemaPath = "prisma/schema.prisma"): Promise<void> {
  const declared = await schemaModels(schemaPath);
  const known = new Set(BACKUP_MODELS.map((m) => m.name));
  const missing = declared.filter((m) => !known.has(m));
  const extra = BACKUP_MODELS.map((m) => m.name).filter((m) => !declared.includes(m));

  if (missing.length) {
    throw new Error(
      `Backup would skip ${missing.join(", ")} — add ${missing.length > 1 ? "them" : "it"} to ` +
        `BACKUP_MODELS in src/lib/backup/manifest.ts, after the tables they reference.`,
    );
  }
  if (extra.length) {
    throw new Error(`BACKUP_MODELS lists ${extra.join(", ")}, which the schema no longer has.`);
  }
}
