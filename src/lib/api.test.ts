import { describe, it, expect } from "vitest";
import { tempLevel, formatTemp } from "./api";

/**
 * The rule these pin down is that the colour must never argue with the number beside it.
 * 67.6 °F is displayed as "68" and a 68–80 range contains 68, so it has to read as normal —
 * that mismatch is what the client reported.
 */

const AC = { rangeMinF: 68, rangeMaxF: 80, alertMinF: 40, alertMaxF: 80 };
const FREEZER = { rangeMinF: 0, rangeMaxF: 10, alertMinF: -40, alertMaxF: 20 };

describe("tempLevel", () => {
  it("judges the number the viewer actually sees", () => {
    expect(formatTemp(67.6)).toBe("68°F");
    expect(tempLevel(67.6, AC)).toBe("normal");
    expect(formatTemp(10.4)).toBe("10°F");
    expect(tempLevel(10.4, FREEZER)).toBe("normal");
  });

  it("is inclusive at the edges of the normal band", () => {
    expect(tempLevel(68, AC)).toBe("normal");
    expect(tempLevel(80, AC)).toBe("normal");
    expect(tempLevel(0, FREEZER)).toBe("normal");
    expect(tempLevel(10, FREEZER)).toBe("normal");
  });

  it("warns between the normal band and the alarm threshold", () => {
    expect(tempLevel(15, FREEZER)).toBe("watch");
    expect(tempLevel(20, FREEZER)).toBe("watch");
    expect(tempLevel(67, AC)).toBe("watch");
  });

  it("goes red only past the alarm threshold", () => {
    expect(tempLevel(21, FREEZER)).toBe("bad");
    expect(tempLevel(38, FREEZER)).toBe("bad");
    expect(tempLevel(81, AC)).toBe("bad");
  });

  it("falls back to the normal band when no alarm threshold is set", () => {
    const plain = { rangeMinF: 32, rangeMaxF: 40 };
    expect(tempLevel(35, plain)).toBe("normal");
    expect(tempLevel(45, plain)).toBe("bad");
  });
});
