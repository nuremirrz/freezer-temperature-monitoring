import { describe, it, expect } from "vitest";
import { loginSchema, emailSchema, passwordSchema } from "./validation";

describe("auth validation", () => {
  it("normalizes e-mail (trim + lowercase)", () => {
    expect(emailSchema.parse("  Ops@BurgerKing.com ")).toBe("ops@burgerking.com");
  });
  it("rejects malformed e-mails and short passwords", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("long enough").success).toBe(true);
  });
  it("login accepts rememberMe as optional boolean", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x", rememberMe: "yes" }).success).toBe(false);
  });
});
