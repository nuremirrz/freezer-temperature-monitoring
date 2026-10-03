import { describe, it, expect } from "vitest";
import { passportDiff } from "./passport-rules";

const current = { model: "TRANE 4TTR3036", serial: "14124JK3F", year: 2014, refrigerant: "R-410A", belts: null, capacitor: null, filter: null };

describe("what a passport patch actually changes", () => {
  it("records only the fields whose value moved", () => {
    expect(passportDiff(current, { model: "TRANE 4TTR3036", capacitor: "45/5 µF, 370V" })).toEqual([
      { field: "capacitor", oldValue: null, newValue: "45/5 µF, 370V" },
    ]);
  });

  it("keeps the old serial when a unit is replaced whole — that is the point of the log", () => {
    expect(passportDiff(current, { model: "Carrier 48TC", serial: "NEW-001" })).toEqual([
      { field: "model", oldValue: "TRANE 4TTR3036", newValue: "Carrier 48TC" },
      { field: "serial", oldValue: "14124JK3F", newValue: "NEW-001" },
    ]);
  });

  it("treats a cleared field as a change to nothing, and an omitted one as untouched", () => {
    expect(passportDiff(current, { year: null })).toEqual([{ field: "year", oldValue: "2014", newValue: null }]);
    expect(passportDiff(current, {})).toEqual([]);
    expect(passportDiff(current, { year: undefined })).toEqual([]);
  });

  it("compares the year as a number written as text, so 2014 equals 2014", () => {
    expect(passportDiff(current, { year: 2014 })).toEqual([]);
  });
});
