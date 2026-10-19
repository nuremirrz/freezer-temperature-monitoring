/**
 * Why a unit's readings could not be trusted, as a number on the alert row.
 *
 * The client's AC spec names four causes and gives each a code to store, so that a year of
 * alert history can be counted by cause without anyone parsing a sentence: how often a probe
 * falls out of its socket, how often the radio goes quiet, how often a device freezes. The
 * numbers are the client's own (21, 31, 41, 51) and are stored rather than derived, because
 * what mattered was what we believed at the time.
 *
 * Only offline alerts carry one. A unit that is not cooling is understood perfectly well —
 * its room and duct temperatures are on the same row and say the whole story.
 */
export const ALERT_ERROR = {
  /** A probe reading its disconnected sentinel: two readings at or above 150 °F. */
  probeDisconnected: 21,
  /** Nothing heard from the device for longer than its silence threshold. */
  noData: 31,
  /** A number no room or duct could hold, twice in a row. */
  impossibleReading: 41,
  /** Alive, reporting, and saying the same thing for eighteen hours. */
  sensorStuck: 51,
} as const;

export type AlertErrorCode = (typeof ALERT_ERROR)[keyof typeof ALERT_ERROR];

/** What to put in front of a person, when the time comes to show these. */
export const ALERT_ERROR_TEXT: Record<AlertErrorCode, string> = {
  21: "Щуп отключён",
  31: "Датчик не передаёт данные",
  41: "Некорректные показания датчика",
  51: "Показания не меняются",
};
