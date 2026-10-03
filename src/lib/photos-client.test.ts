import { describe, it, expect } from "vitest";
import { fitWithin, isHeic } from "./photos-client";

describe("shrinking a photo before upload", () => {
  it("brings a 12-megapixel phone photo down to 1600 on the long side, keeping its shape", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });

  it("never enlarges a small photo", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("recognising HEIC", () => {
  it("by type, or by name when the browser leaves the type empty", () => {
    expect(isHeic({ type: "image/heic", name: "x" })).toBe(true);
    expect(isHeic({ type: "image/heif", name: "x" })).toBe(true);
    expect(isHeic({ type: "", name: "IMG_1149.HEIC" })).toBe(true);
    expect(isHeic({ type: "image/jpeg", name: "IMG_1149.jpg" })).toBe(false);
  });
});
