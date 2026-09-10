import { describe, it, expect } from "vitest";
import { rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  it("allows up to the limit inside the window, then blocks, then recovers", () => {
    const key = `t:${Math.random()}`;
    const t0 = 1_000_000;
    expect(rateLimit(key, 3, 60_000, t0)).toBe(true);
    expect(rateLimit(key, 3, 60_000, t0 + 1)).toBe(true);
    expect(rateLimit(key, 3, 60_000, t0 + 2)).toBe(true);
    expect(rateLimit(key, 3, 60_000, t0 + 3)).toBe(false);
    expect(rateLimit(key, 3, 60_000, t0 + 60_001)).toBe(true); // window slid past the first hits
  });

  it("keys are independent", () => {
    const a = `a:${Math.random()}`;
    const b = `b:${Math.random()}`;
    expect(rateLimit(a, 1, 60_000, 0)).toBe(true);
    expect(rateLimit(a, 1, 60_000, 1)).toBe(false);
    expect(rateLimit(b, 1, 60_000, 1)).toBe(true);
  });
});
