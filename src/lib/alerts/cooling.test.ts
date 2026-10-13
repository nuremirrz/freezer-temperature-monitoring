import { describe, it, expect } from "vitest";
import {
  COOLING_DROP_F,
  NOT_COOLING_SUSTAINED_MIN,
  evaluateCooling,
  isWithinWorkingHours,
  notCoolingRun,
  substatusOf,
  type CoolingContext,
  type CoolingReading,
} from "./cooling";

const LA = "America/Los_Angeles";
/** A kitchen: judged once the room is at or above 80 °F. */
const KITCHEN: CoolingContext = { loadAboveF: 80, timeZone: LA };
/** A dining room, after Sanjar raised it from 75 on 14 Oct 2026. */
const DINING: CoolingContext = { loadAboveF: 77, timeZone: LA };

/** An instant from a wall-clock time in the restaurant's own zone. */
const at = (local: string) => Date.parse(`2026-10-14T${local}:00-07:00`);

/** A run of readings every `everyMin` minutes, ending at `endLocal`, oldest first. */
function series(
  endLocal: string,
  count: number,
  everyMin: number,
  r: Omit<CoolingReading, "measuredAt">,
): CoolingReading[] {
  const end = at(endLocal);
  return Array.from({ length: count }, (_, i) => ({
    ...r,
    measuredAt: end - (count - 1 - i) * everyMin * 60_000,
  }));
}

describe("working hours", () => {
  it("is closed from midnight until half past seven, local", () => {
    expect(isWithinWorkingHours(at("00:00"), LA)).toBe(false);
    expect(isWithinWorkingHours(at("03:00"), LA)).toBe(false);
    expect(isWithinWorkingHours(at("07:29"), LA)).toBe(false);
  });

  it("opens at 07:30 and stays open to the end of the day", () => {
    expect(isWithinWorkingHours(at("07:30"), LA)).toBe(true);
    expect(isWithinWorkingHours(at("14:00"), LA)).toBe(true);
    expect(isWithinWorkingHours(at("23:59"), LA)).toBe(true);
  });

  it("reads the restaurant's clock, not the server's", () => {
    // 09:00 UTC is 02:00 in Los Angeles — closed — and 04:00 in New York, also closed;
    // 13:00 UTC is 06:00 in LA (closed) but 09:00 in New York (open).
    const thirteenUtc = Date.parse("2026-10-14T13:00:00Z");
    expect(isWithinWorkingHours(thirteenUtc, LA)).toBe(false);
    expect(isWithinWorkingHours(thirteenUtc, "America/New_York")).toBe(true);
  });

  it("follows the zone across the end of daylight saving", () => {
    // On 1 Nov 2026 Los Angeles falls back; 14:30 UTC is 07:30 PDT the day before and
    // 06:30 PST after, so the same UTC time changes side.
    expect(isWithinWorkingHours(Date.parse("2026-10-31T14:30:00Z"), LA)).toBe(true);
    expect(isWithinWorkingHours(Date.parse("2026-11-01T14:30:00Z"), LA)).toBe(false);
  });
});

describe("substatus of one reading", () => {
  it("does not judge a closed restaurant, however bad the numbers", () => {
    expect(substatusOf({ tempF: 95, probeTempF: 94, measuredAt: at("03:00") }, KITCHEN)).toBe("closed");
  });

  it("gives no verdict on an AC with no duct probe", () => {
    expect(substatusOf({ tempF: 95, probeTempF: null, measuredAt: at("14:00") }, KITCHEN)).toBe("no-duct");
  });

  it("calls a cool room no load, with nothing to cool", () => {
    expect(substatusOf({ tempF: 74, probeTempF: 73, measuredAt: at("14:00") }, KITCHEN)).toBe("no-load");
  });

  it("holds a dining room to its own lower threshold", () => {
    const reading = { tempF: 78, probeTempF: 77, measuredAt: at("14:00") };
    expect(substatusOf(reading, KITCHEN)).toBe("no-load");
    expect(substatusOf(reading, DINING)).toBe("not-cooling");
  });

  it("calls a unit cooling when the duct is twelve degrees below the room", () => {
    expect(substatusOf({ tempF: 82, probeTempF: 70, measuredAt: at("14:00") }, KITCHEN)).toBe("cooling");
    // A hot afternoon with a healthy unit: the room is well over its band and nothing is wrong
    expect(substatusOf({ tempF: 90, probeTempF: 68, measuredAt: at("14:00") }, KITCHEN)).toBe("cooling");
  });

  it("puts the boundary at exactly twelve degrees", () => {
    const room = 82;
    expect(substatusOf({ tempF: room, probeTempF: room - COOLING_DROP_F, measuredAt: at("14:00") }, KITCHEN)).toBe(
      "cooling",
    );
    expect(substatusOf({ tempF: room, probeTempF: room - COOLING_DROP_F + 0.1, measuredAt: at("14:00") }, KITCHEN)).toBe(
      "not-cooling",
    );
  });

  it("recognises a unit running on heat", () => {
    expect(substatusOf({ tempF: 81, probeTempF: 102, measuredAt: at("14:00") }, KITCHEN)).toBe("heating");
  });

  it("calls a warm room with a warm duct not cooling", () => {
    expect(substatusOf({ tempF: 84, probeTempF: 82, measuredAt: at("14:00") }, KITCHEN)).toBe("not-cooling");
  });
});

const BROKEN = { tempF: 84, probeTempF: 82 };
const WORKING = { tempF: 84, probeTempF: 68 };

describe("the run of not-cooling readings", () => {
  it("is nothing when the newest reading is fine", () => {
    expect(notCoolingRun(series("14:00", 10, 5, WORKING), KITCHEN)).toBeNull();
  });

  it("counts from the first bad reading of the run", () => {
    const run = notCoolingRun(series("14:00", 10, 5, BROKEN), KITCHEN);
    expect(run?.minutes).toBe(45);
    expect(run?.startedAt).toBe(at("13:15"));
  });

  it("is zero minutes on the first bad reading, so one spike can never open anything", () => {
    const readings = [...series("13:55", 6, 5, WORKING), { ...BROKEN, measuredAt: at("14:00") }];
    expect(notCoolingRun(readings, KITCHEN)?.minutes).toBe(0);
  });

  it("starts over after a single working reading", () => {
    // Bad for an hour, one good reading, then bad again for ten minutes
    const readings = [
      ...series("13:00", 12, 5, BROKEN),
      { ...WORKING, measuredAt: at("13:05") },
      ...series("13:15", 3, 5, BROKEN),
    ];
    const run = notCoolingRun(readings, KITCHEN);
    expect(run?.startedAt).toBe(at("13:05"));
    expect(run?.minutes).toBe(10);
  });

  it("is not reset by a hole in the data", () => {
    // Three packets lost in the middle — fifteen minutes of silence, the ordinary case here
    const readings = [
      ...series("13:15", 4, 5, BROKEN),
      ...series("14:00", 6, 5, BROKEN).filter((r) => r.measuredAt > at("13:30")),
    ];
    const run = notCoolingRun(readings, KITCHEN);
    expect(run?.startedAt).toBe(at("13:00"));
    expect(run?.minutes).toBe(60);
  });

  it("steps over a reading that carries no duct temperature", () => {
    const readings = [
      ...series("13:20", 2, 5, BROKEN),
      { tempF: 84, probeTempF: null, measuredAt: at("13:25") },
      ...series("14:00", 7, 5, BROKEN),
    ];
    expect(notCoolingRun(readings, KITCHEN)?.startedAt).toBe(at("13:15"));
  });

  it("is broken by the restaurant closing, because a closed-hours reading is a normal one", () => {
    // Bad before midnight, bad again after opening: two runs, not one
    const readings = [
      { ...BROKEN, measuredAt: Date.parse("2026-10-13T23:50:00-07:00") },
      { ...BROKEN, measuredAt: Date.parse("2026-10-14T03:00:00-07:00") },
      ...series("08:00", 4, 5, BROKEN),
    ];
    const run = notCoolingRun(readings, KITCHEN);
    expect(run?.startedAt).toBe(at("07:45"));
    expect(run?.minutes).toBe(15);
  });
});

describe("the decision", () => {
  const openAt = (readings: CoolingReading[], ctx = KITCHEN) =>
    evaluateCooling({ readings, ctx, openAlert: null });

  it("stays quiet while the run is shorter than forty-five minutes", () => {
    const readings = series("14:00", 9, 5, BROKEN); // 40 minutes
    expect(openAt(readings)).toEqual({ action: "none", substatus: "not-cooling" });
  });

  it("opens once the run reaches forty-five minutes, dated from its start", () => {
    const readings = series("14:00", 10, 5, BROKEN);
    expect(openAt(readings)).toEqual({
      action: "open",
      openedAt: at("13:15"),
      substatus: "not-cooling",
    });
  });

  it("waits a full hour on a twenty-minute sensor, because forty minutes is not forty-five", () => {
    // Measuring in minutes means the device's own pace decides when the threshold is crossed:
    // a twenty-minute sensor has no reading at the 45-minute mark, so the alert waits for 60.
    expect(openAt(series("14:00", 2, 20, BROKEN)).action).toBe("none"); // 13:40 → 14:00, 20 min
    expect(openAt(series("14:00", 3, 20, BROKEN)).action).toBe("none"); // 13:20 → 14:00, 40 min
    expect(openAt(series("14:00", 4, 20, BROKEN)).action).toBe("open"); // 13:00 → 14:00, 60 min
  });

  it("never opens for an AC without a duct probe", () => {
    const readings = series("14:00", 20, 5, { tempF: 95, probeTempF: null });
    expect(openAt(readings)).toEqual({ action: "none", substatus: "no-duct" });
  });

  it("never opens outside working hours", () => {
    const readings = series("03:00", 20, 5, BROKEN);
    expect(openAt(readings)).toEqual({ action: "none", substatus: "closed" });
  });

  it("holds an open alert open while the unit is still not cooling", () => {
    const readings = series("15:00", 4, 5, BROKEN);
    expect(evaluateCooling({ readings, ctx: KITCHEN, openAlert: { openedAt: at("13:15") } })).toEqual({
      action: "none",
      substatus: "not-cooling",
    });
  });

  it("closes an open alert on the first working reading, with no margin", () => {
    const readings = [{ tempF: 84, probeTempF: 84 - COOLING_DROP_F, measuredAt: at("15:00") }];
    expect(evaluateCooling({ readings, ctx: KITCHEN, openAlert: { openedAt: at("13:15") } })).toEqual({
      action: "close",
      substatus: "cooling",
    });
  });

  it("closes an open alert once the room cools below its threshold", () => {
    const readings = [{ tempF: 74, probeTempF: 73, measuredAt: at("20:00") }];
    expect(evaluateCooling({ readings, ctx: KITCHEN, openAlert: { openedAt: at("13:15") } })).toEqual({
      action: "close",
      substatus: "no-load",
    });
  });

  it("cannot reopen immediately after closing — the next run has to run its course", () => {
    // One working reading at 15:00 closed the alert; ten minutes of failure is not enough
    const readings = [{ ...WORKING, measuredAt: at("15:00") }, ...series("15:10", 3, 5, BROKEN)];
    expect(openAt(readings)).toEqual({ action: "none", substatus: "not-cooling" });
  });

  it("gives no verdict at all on an empty series", () => {
    expect(openAt([])).toEqual({ action: "none", substatus: "no-duct" });
  });

  it("agrees with the constant it is built on", () => {
    expect(NOT_COOLING_SUSTAINED_MIN).toBe(45);
  });
});
