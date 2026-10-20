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

/**
 * Bellflower's two LSN50-D23 nodes, each using two of its three jacks — the first devices in
 * the fleet where the channel numbers are not simply 1 and 2.
 */
describe("a three-probe node", () => {
  it("gives the walk-in device's two units a probe each, and no duct", () => {
    const out = readingsFromUplink(
      { channels: [{ channel: 1, tempF: 70.7 }, { channel: 2, tempF: 37.58 }, { channel: 3, tempF: 2.66 }] },
      [
        { channel: 2, unitId: "cooler", unitType: "walk_in_cooler" },
        { channel: 3, unitId: "freezer", unitType: "walk_in_freezer" },
      ],
    );
    expect(out.readings).toEqual([
      { unitId: "cooler", channel: 2, tempF: 37.58, probeTempF: null },
      { unitId: "freezer", channel: 3, tempF: 2.66, probeTempF: null },
    ]);
    // The spare jack is wired to nothing and says so rather than going unnoticed
    expect(out.unmapped).toEqual([1]);
  });

  it("reads an AC's room from its own jack and the duct from the other", () => {
    // Channel 1 is a bare socket, dropped by the parser before it reaches here
    const out = readingsFromUplink({ channels: [{ channel: 2, tempF: 58.46 }, { channel: 3, tempF: 43.88 }] }, [
      { channel: 2, unitId: "ac3", unitType: "ac" },
    ]);
    expect(out.readings).toEqual([{ unitId: "ac3", channel: 2, tempF: 58.46, probeTempF: 43.88 }]);
  });
})
