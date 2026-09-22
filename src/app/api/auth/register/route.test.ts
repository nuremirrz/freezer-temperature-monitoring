import { describe, it, expect } from "vitest";
import { POST } from "./route";

/**
 * Registration is closed, and this is here so that reopening it has to be a decision rather
 * than an accident. The endpoint once created accounts with the `admin` role — on a public
 * form, that handed anyone who filled it in every restaurant and the right to change any
 * unit's settings.
 */
describe("POST /api/auth/register", () => {
  it("refuses, and says why", async () => {
    const res = POST();

    expect(res.status).toBe(403);
    const body = (await res.json()) as { status: string; message: string };
    expect(body.status).toBe("registration_closed");
    expect(body.message).toMatch(/invitation/i);
  });

  it("creates nothing", () => {
    // The handler takes no request and touches no database: there is no path from here to a
    // new row, whatever is posted.
    expect(POST.length).toBe(0);
  });
});
