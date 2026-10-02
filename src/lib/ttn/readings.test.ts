import { describe, it, expect } from "vitest";
import { readingsFromUplink, type MappedChannel } from "./readings";

const ac1: MappedChannel = { channel: 1, unitId: "ac", unitType: "ac" };
const freezer1: MappedChannel = { channel: 1, unitId: "wif", unitType: "walk_in_freezer" };
const cooler2: MappedChannel = { channel: 2, unitId: "wic", unitType: "walk_in_cooler" };

describe("what an uplink means for the units on the sensor", () => {
  it("LHT65N on an AC: the room is the unit, the probe is the duct", () => {
    const r = readingsFromUplink({ channels: [{ channel: 1, tempF: 55 }], ambientTempF: 72 }, [ac1]);
    expect(r.readings).toEqual([{ unitId: "ac", channel: 1, tempF: 72, probeTempF: 55 }]);
  });

  it("LHT65N on an AC with no probe plugged in still records the room — San Bernardino's four", () => {
    const r = readingsFromUplink({ channels: [], ambientTempF: 74.1 }, [ac1]);
    expect(r.readings).toEqual([{ unitId: "ac", channel: 1, tempF: 74.1, probeTempF: null }]);
    expect(r.noRoomTemp).toEqual([]);
  });

  it("LTC2 on an AC: the wired probe is the room, the other probe is the duct", () => {
    const r = readingsFromUplink(
      { channels: [{ channel: 1, tempF: 50 }, { channel: 2, tempF: 61 }] },
      [{ channel: 2, unitId: "ac", unitType: "ac" }],
    );
    expect(r.readings).toEqual([{ unitId: "ac", channel: 2, tempF: 61, probeTempF: 50 }]);
    expect(r.unmapped).toEqual([1]);
  });

  it("LTC2 on an AC whose wired probe is unplugged: nothing to judge by, say so", () => {
    const r = readingsFromUplink({ channels: [{ channel: 1, tempF: 50 }] }, [{ channel: 2, unitId: "ac", unitType: "ac" }]);
    expect(r.readings).toEqual([]);
    expect(r.noRoomTemp).toEqual([2]);
  });

  it("LTC2 with a freezer on one probe and a cooler on the other — San Bernardino's walk-ins", () => {
    const r = readingsFromUplink({ channels: [{ channel: 1, tempF: 4 }, { channel: 2, tempF: 33.1 }] }, [freezer1, cooler2]);
    expect(r.readings).toEqual([
      { unitId: "wif", channel: 1, tempF: 4, probeTempF: null },
      { unitId: "wic", channel: 2, tempF: 33.1, probeTempF: null },
    ]);
  });

  it("cold storage with an unplugged probe yields no reading, not a wrong one", () => {
    const r = readingsFromUplink({ channels: [], ambientTempF: 70 }, [freezer1]);
    expect(r.readings).toEqual([]);
  });

  it("a reporting probe nobody wired is reported as unmapped", () => {
    const r = readingsFromUplink({ channels: [{ channel: 1, tempF: 10 }, { channel: 2, tempF: 11 }] }, [freezer1]);
    expect(r.unmapped).toEqual([2]);
  });
});
