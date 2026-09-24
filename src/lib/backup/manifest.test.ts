import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BACKUP_MODELS,
  BACKED_UP_MODELS,
  assertModelsCoverSchema,
  schemaModels,
} from "./manifest";

let dir: string;
const schemaWith = async (models: string[]): Promise<string> => {
  const file = path.join(dir, "schema.prisma");
  await writeFile(file, models.map((m) => `model ${m} {\n  id String @id\n}\n`).join("\n"));
  return file;
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qimby-manifest-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("schemaModels", () => {
  it("reads the model names out of a schema", async () => {
    const file = await schemaWith(["User", "Reading"]);
    expect(await schemaModels(file)).toEqual(["User", "Reading"]);
  });

  it("ignores enums and comments that mention models", async () => {
    const file = path.join(dir, "schema.prisma");
    await writeFile(
      file,
      `enum UnitType {\n  ac\n}\n\n/// a model Location lives here\nmodel Unit {\n  id String @id\n}\n`,
    );
    expect(await schemaModels(file)).toEqual(["Unit"]);
  });
});

describe("assertModelsCoverSchema", () => {
  /**
   * The guard that matters. Adding a table and forgetting this list would produce backups that
   * are quietly missing it — and nobody finds out until a restore, which is the worst possible
   * moment to learn that a backup is incomplete.
   */
  it("refuses a schema with a table the backup would skip", async () => {
    const file = await schemaWith([...BACKUP_MODELS.map((m) => m.name), "Invoice"]);
    await expect(assertModelsCoverSchema(file)).rejects.toThrow(/Invoice/);
  });

  it("refuses a list naming a table the schema dropped", async () => {
    const file = await schemaWith(BACKUP_MODELS.filter((m) => m.name !== "Alert").map((m) => m.name));
    await expect(assertModelsCoverSchema(file)).rejects.toThrow(/Alert/);
  });

  it("passes on the real schema", async () => {
    await expect(assertModelsCoverSchema()).resolves.toBeUndefined();
  });
});

describe("what a backup carries", () => {
  it("leaves out live sign-in keys", () => {
    const written = BACKED_UP_MODELS.map((m) => m.name);
    expect(written).not.toContain("Session");
    expect(written).not.toContain("AuthToken");
  });

  it("still keeps the readings and the equipment they belong to", () => {
    const written = BACKED_UP_MODELS.map((m) => m.name);
    for (const table of ["Reading", "Alert", "Unit", "Sensor", "Location", "Organization", "District", "UserDistrict"]) {
      expect(written).toContain(table);
    }
  });

  /** Restore writes in list order, so a child must never come before what it points at. */
  it("orders tables so foreign keys resolve", () => {
    const at = (name: string) => BACKUP_MODELS.findIndex((m) => m.name === name);
    expect(at("Location")).toBeLessThan(at("Unit"));
    expect(at("Location")).toBeLessThan(at("Sensor"));
    expect(at("Unit")).toBeLessThan(at("Reading"));
    expect(at("Sensor")).toBeLessThan(at("Reading"));
    expect(at("Sensor")).toBeLessThan(at("SensorChannel"));
    expect(at("Unit")).toBeLessThan(at("Alert"));
    expect(at("User")).toBeLessThan(at("LocationAccess"));
    expect(at("Organization")).toBeLessThan(at("District"));
    expect(at("Organization")).toBeLessThan(at("User"));
    expect(at("District")).toBeLessThan(at("Location"));
    expect(at("User")).toBeLessThan(at("UserDistrict"));
    expect(at("District")).toBeLessThan(at("UserDistrict"));
  });
});
