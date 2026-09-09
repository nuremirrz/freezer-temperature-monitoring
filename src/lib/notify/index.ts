import { sendTelegram, telegramConfigured } from "./telegram";

export type NotificationKind = "opened" | "resolved";

export interface TempAlertNotification {
  kind: NotificationKind;
  alertType: "temp_out_of_range";
  locationName: string;
  unitName: string;
  tempF: number;
  rangeMinF: number;
  rangeMaxF: number;
  durationMin: number;
}

export interface OfflineNotification {
  kind: NotificationKind;
  alertType: "offline";
  locationName: string;
  /** Units affected by this sensor (1–2). Empty when the whole location is down. */
  unitNames: string[];
  /** All sensors at the location are silent → gateway / internet problem */
  locationWide: boolean;
  silentMin: number;
}

export type AlertNotification = TempAlertNotification | OfflineNotification;

export interface Notifier {
  send(text: string): Promise<void>;
}

const consoleNotifier: Notifier = {
  async send(text) {
    console.log(`[notify] ${text}`);
  },
};

const telegramNotifier: Notifier = {
  async send(text) {
    await sendTelegram(text);
  },
};

export function getNotifier(): Notifier {
  return telegramConfigured() ? telegramNotifier : consoleNotifier;
}

const fmtTemp = (t: number) => `${Number.isInteger(t) ? t : t.toFixed(1)}°F`;
const fmtRange = (min: number, max: number) =>
  `${min < 0 ? "−" + Math.abs(min) : min}…${max}°F`;
const shortLocation = (name: string) => name.replace(/^Burger King\s*/i, "BK ");

export function formatDuration(min: number): string {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function formatAlertMessage(n: AlertNotification): string {
  const loc = shortLocation(n.locationName);

  if (n.alertType === "temp_out_of_range") {
    const range = fmtRange(n.rangeMinF, n.rangeMaxF);
    if (n.kind === "opened") {
      return `🔴 ${loc} · ${n.unitName}: ${fmtTemp(n.tempF)} (норма ${range}), ${formatDuration(n.durationMin)}`;
    }
    return `🟢 ${loc} · ${n.unitName}: снова в норме, ${fmtTemp(n.tempF)} (норма ${range}). Длилось ${formatDuration(n.durationMin)}`;
  }

  if (n.locationWide) {
    return n.kind === "opened"
      ? `⚫ ${loc}: все датчики молчат ${formatDuration(n.silentMin)} — похоже на проблему шлюза или интернета в ресторане`
      : `🟢 ${loc}: связь с рестораном восстановлена`;
  }
  const units = n.unitNames.join(", ");
  return n.kind === "opened"
    ? `⚫ ${loc} · ${units}: датчик не выходит на связь ${formatDuration(n.silentMin)}`
    : `🟢 ${loc} · ${units}: датчик снова на связи`;
}

/** Sends a notification; never throws — a broken Telegram must not break ingest. */
export async function notify(n: AlertNotification): Promise<void> {
  const text = formatAlertMessage(n);
  try {
    await getNotifier().send(text);
  } catch (err) {
    console.error("[notify] failed:", err instanceof Error ? err.message : err);
    console.log(`[notify] (unsent) ${text}`);
  }
}
