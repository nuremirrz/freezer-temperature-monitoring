import { describe, it, expect } from "vitest";
import { fitWithin, isHeic, looksLikeHeif } from "./photos-client";

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

describe("recognising HEIC by its bytes, whatever the name and type say", () => {
  const head = (brand: string) => new Uint8Array([0, 0, 0, 24, ...[..."ftyp"].map((c) => c.charCodeAt(0)), ...[...brand].map((c) => c.charCodeAt(0))]);
  it("sees an iPhone photo named image.jpg for what it is", () => {
    expect(looksLikeHeif(head("heic"))).toBe(true);
    expect(looksLikeHeif(head("mif1"))).toBe(true);
  });
  it("does not mistake a JPEG or an MP4 for one", () => {
    expect(looksLikeHeif(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
    expect(looksLikeHeif(head("isom"))).toBe(false);
    expect(looksLikeHeif(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
