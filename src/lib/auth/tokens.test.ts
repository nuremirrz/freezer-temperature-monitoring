import { describe, it, expect } from "vitest";
import { generateToken, hashToken } from "./tokens";

describe("auth tokens", () => {
  it("generates unique url-safe tokens whose stored form is the sha256", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toBe(hashToken(a.raw));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toBe(b.hash);
  });
});
