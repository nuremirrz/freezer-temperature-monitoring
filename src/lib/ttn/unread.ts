import { getNotifier } from "@/lib/notify";

/**
 * Measurement fields devices send that the parser does not read, remembered per process and
 * announced once.
 *
 * A new probe or a new decoder shows up as a field the parser has never heard of, and the
 * parser's instinct is to ignore what it does not know. That is the right instinct for the
 * reading — a guess would be worse — and the wrong one for the people: in San Bernardino the
 * DS18B20's TempF_DS went unread for a day because nothing said so. Now the first packet
 * carrying such a field posts to the group, every later one only counts, and /api/health
 * lists what is being thrown away.
 */

export interface UnreadField {
  devEui: string;
  deviceId: string | null;
  field: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

const g = globalThis as unknown as { __qimbyUnreadFields?: Map<string, UnreadField> };
const seen = (g.__qimbyUnreadFields ??= new Map());

export async function noteUnreadFields(devEui: string, deviceId: string | undefined, fields: string[], now: Date = new Date()): Promise<void> {
  const fresh: string[] = [];
  for (const field of fields) {
    const key = `${devEui}:${field}`;
    const row = seen.get(key);
    if (row) {
      row.count++;
      row.lastSeenAt = now.toISOString();
    } else {
      seen.set(key, { devEui, deviceId: deviceId ?? null, field, count: 1, firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString() });
      fresh.push(field);
    }
  }
  if (!fresh.length) return;
  const who = deviceId ?? devEui;
  const text = `🟡 Qimby: датчик ${who} шлёт ${fresh.length === 1 ? "поле" : "поля"} ${fresh.join(", ")}, которые мы не читаем. Похоже на новый щуп или декодер — данные пока выбрасываются, нужна правка разбора пакета.`;
  try {
    await getNotifier().send(text);
  } catch (err) {
    console.error("[unread-fields] notify failed:", err instanceof Error ? err.message : err);
    console.log(`[unread-fields] (unsent) ${text}`);
  }
}

/** For /api/health: what is being thrown away, most recent first. */
export function unreadFieldsSeen(): UnreadField[] {
  return [...seen.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/** Tests only. */
export function forgetUnreadFields(): void {
  seen.clear();
}
