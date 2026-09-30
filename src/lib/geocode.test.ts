import { describe, it, expect } from "vitest";
import { censusPoint, cityPoint, defaultTimezone, US_TIMEZONES } from "./geocode";

describe("reading the geocoders' answers", () => {
  it("takes the first Census match as the address itself", () => {
    const body = { result: { addressMatches: [{ coordinates: { x: -117.8, y: 33.9 } }] } };
    expect(censusPoint(body)).toEqual({ lat: 33.9, lng: -117.8, precision: "address" });
  });

  it("answers null when Census matched nothing", () => {
    expect(censusPoint({ result: { addressMatches: [] } })).toBeNull();
    expect(censusPoint({})).toBeNull();
    expect(censusPoint({ result: { addressMatches: [{ coordinates: { x: NaN, y: 1 } }] } })).toBeNull();
  });

  it("takes a place search as the centre of the city", () => {
    expect(cityPoint({ results: [{ latitude: 40.9, longitude: -74.1 }] })).toEqual({ lat: 40.9, lng: -74.1, precision: "city" });
    expect(cityPoint({ results: [] })).toBeNull();
  });
});

describe("default timezone by state", () => {
  it("puts the two live restaurants on the Pacific coast", () => {
    expect(defaultTimezone("CA")).toBe("America/Los_Angeles");
    expect(defaultTimezone("ca")).toBe("America/Los_Angeles");
  });

  it("falls back to the East coast for anything it does not know", () => {
    expect(defaultTimezone("PR")).toBe("America/New_York");
    expect(defaultTimezone("")).toBe("America/New_York");
  });

  it("only ever answers with a zone the form offers", () => {
    for (const st of ["NJ", "TX", "AZ", "HI", "AK", "CO"]) {
      expect(US_TIMEZONES).toContain(defaultTimezone(st));
    }
  });
});
