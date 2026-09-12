import { sendTelegram, telegramConfigured } from "./telegram";
import { recordNotifyOk, recordNotifyFailure, notifyStatus, type NotifyStatus } from "./status";

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
  /** Deep link to the location screen, when APP_URL is configured */
  url?: string;
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
  /** Deep link to the location screen, when APP_URL is configured */
  url?: string;
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

/** Link to a location screen; undefined until APP_URL is set. */
export function locationUrl(locationId: string): string | undefined {
  const base = process.env.APP_URL?.replace(/\/+$/, "");
  return base ? `${base}/locations/${locationId}` : undefined;
}

export function formatAlertMessage(n: AlertNotification): string {
  const loc = shortLocation(n.locationName);
  const link = n.url ? `\n${n.url}` : "";

  if (n.alertType === "temp_out_of_range") {
    const range = fmtRange(n.rangeMinF, n.rangeMaxF);
    if (n.kind === "opened") {
      return `🔴 ${loc} · ${n.unitName}: ${fmtTemp(n.tempF)} (норма ${range}), ${formatDuration(n.durationMin)}${link}`;
    }
    return `🟢 ${loc} · ${n.unitName}: снова в норме, ${fmtTemp(n.tempF)} (норма ${range}). Длилось ${formatDuration(n.durationMin)}${link}`;
  }

  if (n.locationWide) {
    return n.kind === "opened"
      ? `⚫ ${loc}: все датчики молчат ${formatDuration(n.silentMin)} — похоже на проблему шлюза или интернета в ресторане${link}`
      : `🟢 ${loc}: связь с рестораном восстановлена${link}`;
  }
  const units = n.unitNames.join(", ");
  return n.kind === "opened"
    ? `⚫ ${loc} · ${units}: датчик не выходит на связь ${formatDuration(n.silentMin)}${link}`
    : `🟢 ${loc} · ${units}: датчик снова на связи${link}`;
}

/** Where notifications are going and whether they are landing — surfaced by /api/health. */
export function notificationHealth(): NotifyStatus {
  return notifyStatus(telegramConfigured() ? "telegram" : "console");
}

/**
 * Sends a notification; never throws — a broken Telegram must not break ingest.
 * Returns whether it actually went out, so the caller can decide what to record.
 */
export async function notify(n: AlertNotification): Promise<boolean> {
  const text = formatAlertMessage(n);
  try {
    await getNotifier().send(text);
    recordNotifyOk();
    return true;
  } catch (err) {
    recordNotifyFailure(err);
    console.error("[notify] failed:", err instanceof Error ? err.message : err);
    console.log(`[notify] (unsent) ${text}`);
    return false;
  }
}
