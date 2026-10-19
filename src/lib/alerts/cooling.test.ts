import { describe, it, expect } from "vitest";
import {
  COOLING_DROP_F,
  NOT_COOLING_SUSTAINED_MIN,
  RECOVERY_SUSTAINED_MIN,
  alertCounter,
  evaluateCooling,
  isWithinWorkingHours,
  recoveryCounter,
  substatusOf,
  workDayStart,
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
/** The same, the evening before. */
const yesterday = (local: string) => Date.parse(`2026-10-13T${local}:00-07:00`);

const BROKEN = { tempF: 84, probeTempF: 82 };
const WORKING = { tempF: 84, probeTempF: 68 };
const COOL_ROOM = { tempF: 74, probeTempF: 73 };

/** Readings every `everyMin` minutes, ending at `endLocal`, oldest first. */
function series(endLocal: string, count: number, everyMin: number, r: Omit<CoolingReading, "measuredAt">): CoolingReading[] {
  const end = at(endLocal);
  return Array.from({ length: count }, (_, i) => ({ ...r, measuredAt: end - (count - 1 - i) * everyMin * 60_000 }));
}

describe("working hours", () => {
  it("is closed from midnight until half past seven, local", () => {
    expect(isWithinWorkingHours(at("00:00"), LA)).toBe(false);
    expect(isWithinWorkingHours(at("07:29"), LA)).toBe(false);
    expect(isWithinWorkingHours(at("07:30"), LA)).toBe(true);
    expect(isWithinWorkingHours(at("23:59"), LA)).toBe(true);
  });

  it("reads the restaurant's clock, not the server's", () => {
    const thirteenUtc = Date.parse("2026-10-14T13:00:00Z");
    expect(isWithinWorkingHours(thirteenUtc, LA)).toBe(false);
    expect(isWithinWorkingHours(thirteenUtc, "America/New_York")).toBe(true);
  });

  it("follows the zone across the end of daylight saving", () => {
    expect(isWithinWorkingHours(Date.parse("2026-10-31T14:30:00Z"), LA)).toBe(true);
    expect(isWithinWorkingHours(Date.parse("2026-11-01T14:30:00Z"), LA)).toBe(false);
  });
});

describe("the morning the counter starts from", () => {
  it("is today's 07:30 once the restaurant has opened", () => {
    expect(workDayStart(at("14:00"), LA)).toBe(at("07:30"));
    expect(workDayStart(at("07:30"), LA)).toBe(at("07:30"));
    expect(workDayStart(at("23:59"), LA)).toBe(at("07:30"));
  });

  it("is yesterday's while the restaurant is still shut", () => {
    expect(workDayStart(at("03:00"), LA)).toBe(yesterday("07:30"));
    expect(workDayStart(at("07:29"), LA)).toBe(yesterday("07:30"));
  });

  it("lands on 07:30 either side of a daylight-saving change, not 06:30", () => {
    // Los Angeles falls back on 1 Nov 2026; counting back 24 hours would miss by an hour
    const sunday = Date.parse("2026-11-01T20:00:00Z"); // midday local, after the change
    const start = workDayStart(sunday, LA);
    const p = new Intl.DateTimeFormat("en-US", { timeZone: LA, hour: "2-digit", minute: "2-digit", hour12: false }).format(start);
    expect(p).toBe("07:30");
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
    expect(substatusOf({ ...COOL_ROOM, measuredAt: at("14:00") }, KITCHEN)).toBe("no-load");
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
    expect(substatusOf({ tempF: room, probeTempF: room - COOLING_DROP_F, measuredAt: at("14:00") }, KITCHEN)).toBe("cooling");
    expect(substatusOf({ tempF: room, probeTempF: room - COOLING_DROP_F + 0.1, measuredAt: at("14:00") }, KITCHEN)).toBe("not-cooling");
  });

  it("recognises a unit running on heat", () => {
    expect(substatusOf({ tempF: 81, probeTempF: 102, measuredAt: at("14:00") }, KITCHEN)).toBe("heating");
  });
});

describe("the alert counter", () => {
  const count = (readings: CoolingReading[], ctx = KITCHEN) => alertCounter(readings, ctx).minutes;

  it("stays at zero while the unit is cooling", () => {
    expect(count(series("14:00", 10, 5, WORKING))).toBe(0);
  });

  it("counts the minutes between failing readings", () => {
    const c = alertCounter(series("14:00", 10, 5, BROKEN), KITCHEN);
    expect(c.minutes).toBe(45);
    expect(c.startedAt).toBe(at("13:15"));
  });

  it("is zero on a single failing reading, so one spike can never open anything", () => {
    expect(count([...series("13:55", 6, 5, WORKING), { ...BROKEN, measuredAt: at("14:00") }])).toBe(0);
  });

  it("is wiped by one reading that shows the unit cooling", () => {
    const readings = [...series("13:00", 12, 5, BROKEN), { ...WORKING, measuredAt: at("13:05") }, ...series("13:15", 3, 5, BROKEN)];
    const c = alertCounter(readings, KITCHEN);
    expect(c.minutes).toBe(10);
    expect(c.startedAt).toBe(at("13:05"));
  });

  /**
   * The behaviour this file exists for. The spec says the counter freezes — neither grows nor
   * resets — while the restaurant is shut or the room is under its threshold. An earlier build
   * reset it instead, which quietly forgave forty minutes of failure every time a kitchen
   * dipped under 80 °F for one reading.
   */
  it("is frozen by a cool room, not wiped by it", () => {
    const readings = [
      ...series("13:40", 9, 5, BROKEN), // 13:00 → 13:40, forty minutes
      { ...COOL_ROOM, measuredAt: at("13:45") }, // one reading under the threshold
      ...series("14:00", 3, 5, BROKEN), // 13:50, 13:55, 14:00
    ];
    const c = alertCounter(readings, KITCHEN);
    // 40 kept, the reading that resumes the count adds nothing, then two gaps of five
    expect(c.minutes).toBe(50);
    expect(c.startedAt).toBe(at("13:00"));
  });

  it("does not count the time it was frozen for", () => {
    // Four hours of a cool room between two failing readings must not arrive as four hours
    const readings = [
      ...series("13:40", 9, 5, BROKEN),
      ...series("17:40", 48, 5, COOL_ROOM),
      { ...BROKEN, measuredAt: at("17:45") },
      { ...BROKEN, measuredAt: at("17:50") },
    ];
    expect(count(readings)).toBe(45);
  });

  it("is frozen by closed hours, by heat and by a reading with no duct", () => {
    const frozen = (r: Omit<CoolingReading, "measuredAt">, atLocal: string) =>
      count([...series("13:40", 9, 5, BROKEN), { ...r, measuredAt: at(atLocal) }, { ...BROKEN, measuredAt: at("17:50") }, { ...BROKEN, measuredAt: at("17:55") }]);
    expect(frozen({ tempF: 81, probeTempF: 102 }, "13:45")).toBe(45); // heating
    expect(frozen({ tempF: 84, probeTempF: null }, "13:45")).toBe(45); // no duct
  });

  it("counts a hole in the data as failure, because silence is not improvement", () => {
    // Three packets lost in the middle — fifteen minutes, the ordinary case on this network
    const readings = [...series("13:10", 3, 5, BROKEN), ...series("14:00", 4, 5, BROKEN)];
    const c = alertCounter(readings, KITCHEN);
    expect(c.minutes).toBe(60);
    expect(c.startedAt).toBe(at("13:00"));
  });

  it("starts over every morning at 07:30", () => {
    const readings = [
      { ...BROKEN, measuredAt: yesterday("22:00") },
      { ...BROKEN, measuredAt: yesterday("23:00") },
      { ...BROKEN, measuredAt: at("07:35") },
      { ...BROKEN, measuredAt: at("07:40") },
    ];
    const c = alertCounter(readings, KITCHEN);
    expect(c.minutes).toBe(5);
    expect(c.startedAt).toBe(at("07:35"));
  });
});

describe("the recovery counter", () => {
  it("counts an unbroken stretch of cooling", () => {
    expect(recoveryCounter(series("15:00", 13, 5, WORKING))).toBe(60);
  });

  it("is wiped by one reading that is not cooling", () => {
    const readings = [...series("14:50", 11, 5, WORKING), { ...BROKEN, measuredAt: at("14:55") }, { ...WORKING, measuredAt: at("15:00") }];
    expect(recoveryCounter(readings)).toBe(0);
  });

  it("counts at any hour and at any room temperature", () => {
    // Three in the morning, restaurant shut, room cold — a unit making cold air is working
    const night = Array.from({ length: 13 }, (_, i) => ({ tempF: 70, probeTempF: 55, measuredAt: at("02:00") + i * 5 * 60_000 }));
    expect(recoveryCounter(night)).toBe(60);
  });

  it("is frozen, not wiped, by a reading with no duct temperature", () => {
    const readings = [
      ...series("14:30", 7, 5, WORKING),
      { tempF: 84, probeTempF: null, measuredAt: at("14:35") },
      ...series("15:00", 5, 5, WORKING),
    ];
    expect(recoveryCounter(readings)).toBe(50);
  });
});

describe("the decision", () => {
  const fresh = (readings: CoolingReading[], ctx = KITCHEN) => evaluateCooling({ readings, ctx, openAlert: null });
  const held = (readings: CoolingReading[], ctx = KITCHEN) =>
    evaluateCooling({ readings, ctx, openAlert: { openedAt: at("13:00") } });

  it("stays quiet while the count is short of forty-five minutes", () => {
    expect(fresh(series("14:00", 9, 5, BROKEN))).toEqual({ action: "none", substatus: "not-cooling" });
  });

  it("opens once the count reaches forty-five minutes, dated from its start", () => {
    expect(fresh(series("14:00", 10, 5, BROKEN))).toEqual({ action: "open", openedAt: at("13:15"), substatus: "not-cooling" });
  });

  it("never opens for an AC without a duct probe", () => {
    expect(fresh(series("14:00", 20, 5, { tempF: 95, probeTempF: null }))).toEqual({ action: "none", substatus: "no-duct" });
  });

  it("never opens outside working hours", () => {
    expect(fresh(series("03:00", 20, 5, BROKEN))).toEqual({ action: "none", substatus: "closed" });
  });

  /**
   * The other half of what this file exists for. An earlier build closed an alert on the first
   * reading that was not a failure — including a room that had merely cooled down by itself.
   * The spec asks for an hour of real cooling: a compressor that stutters once has not recovered.
   */
  it("does not close an alert on one good reading", () => {
    expect(held([...series("14:55", 3, 5, BROKEN), { ...WORKING, measuredAt: at("15:00") }])).toEqual({
      action: "none",
      substatus: "cooling",
    });
  });

  it("does not close an alert because the room cooled down by itself", () => {
    expect(held(series("20:00", 24, 5, COOL_ROOM))).toEqual({ action: "none", substatus: "no-load" });
  });

  it("does not close an alert when the restaurant shuts for the night", () => {
    expect(held([{ ...BROKEN, measuredAt: Date.parse("2026-10-15T01:00:00-07:00") }])).toEqual({
      action: "none",
      substatus: "closed",
    });
  });

  it("closes only after a full hour of cooling", () => {
    expect(held(series("15:00", 12, 5, WORKING)).action).toBe("none"); // 55 minutes
    expect(held(series("15:00", 13, 5, WORKING)).action).toBe("close"); // 60
  });

  it("closes at night too, when the unit really is making cold air", () => {
    const night = Array.from({ length: 13 }, (_, i) => ({ tempF: 70, probeTempF: 55, measuredAt: at("02:00") + i * 5 * 60_000 }));
    expect(held(night).action).toBe("close");
  });

  it("gives no verdict at all on an empty series", () => {
    expect(fresh([])).toEqual({ action: "none", substatus: "no-duct" });
  });

  it("agrees with the constants it is built on", () => {
    expect([NOT_COOLING_SUSTAINED_MIN, RECOVERY_SUSTAINED_MIN]).toEqual([45, 60]);
  });
});
