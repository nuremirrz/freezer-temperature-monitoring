import type { ParsedUplink } from "./parse";

/**
 * From one uplink to the readings it means for the units wired to that sensor. The one place
 * for the rule, used by the live ingest, the backfill of unknown devices and the replay from
 * TTN storage alike — three copies of it had already drifted once.
 *
 * An AC is judged by the room, not by the supply duct ("АС с дактов нерелевантное
 * измерение"). Where the room reading comes from depends on the hardware:
 *
 *   LHT65N/S — a built-in air sensor reports the room; the external probe, if one is plugged
 *              in, is the duct. San Bernardino's four ACs have no probe at all, and that is
 *              fine: the room is what counts, the duct line on the chart simply stays empty.
 *   LTC2     — no built-in sensor, two external probes. The probe wired to the unit is the
 *              room; the other probe is the duct.
 *
 * Cold storage is the probe itself. A probe that reports nothing (unplugged, or the Dragino
 * "not connected" sentinel) yields no reading rather than a wrong one.
 */

export interface MappedChannel {
  channel: number;
  unitId: string;
  unitType: "freezer" | "walk_in_freezer" | "walk_in_cooler" | "ac";
}

export interface UnitReading {
  unitId: string;
  channel: number;
  /** What the unit is judged by: the probe for cold storage, the room for an AC. */
  tempF: number;
  /** The duct, for an AC; null for cold storage or when no duct probe reported. */
  probeTempF: number | null;
}

export interface UplinkReadings {
  readings: UnitReading[];
  /** Reporting channels no unit is wired to. */
  unmapped: number[];
  /** AC channels wired to a unit whose uplink carried neither a room nor a probe temperature. */
  noRoomTemp: number[];
}

export function readingsFromUplink(
  u: Pick<ParsedUplink, "channels" | "ambientTempF">,
  mappings: MappedChannel[],
): UplinkReadings {
  const reported = new Map<number, number>(u.channels.map((c) => [c.channel, c.tempF]));
  const hasBuiltInAir = u.ambientTempF !== undefined;
  const readings: UnitReading[] = [];
  const noRoomTemp: number[] = [];

  for (const m of mappings) {
    const probe = reported.get(m.channel);
    if (m.unitType !== "ac") {
      if (probe !== undefined) readings.push({ unitId: m.unitId, channel: m.channel, tempF: probe, probeTempF: null });
      continue;
    }
    if (hasBuiltInAir) {
      readings.push({ unitId: m.unitId, channel: m.channel, tempF: u.ambientTempF!, probeTempF: probe ?? null });
      continue;
    }
    if (probe === undefined) {
      noRoomTemp.push(m.channel);
      continue;
    }
    const other = u.channels.find((c) => c.channel !== m.channel)?.tempF ?? null;
    readings.push({ unitId: m.unitId, channel: m.channel, tempF: probe, probeTempF: other });
  }

  const mapped = new Set<number>(mappings.map((m) => m.channel));
  const unmapped = u.channels.map((c) => c.channel as number).filter((ch) => !mapped.has(ch));
  return { readings, unmapped, noRoomTemp };
}
