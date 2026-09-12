/**
 * Last outcome of an outgoing notification, so a dead alert channel is visible in
 * /api/health instead of only in the server log.
 *
 * This matters more than it looks: on 11–13 Sep every alert failed with "group chat was
 * upgraded to a supergroup chat" and nobody noticed for two days, because the database
 * recorded the alerts as notified either way. For a product whose whole job is to raise
 * alarms, a silent alarm channel is worse than a missed reading.
 *
 * Process-local on purpose — a restart clears it. `channel` still tells the truth after a
 * restart, and that alone catches a missing token or chat id.
 */

export interface NotifyStatus {
  /** Where notifications are going: "telegram" when configured, "console" otherwise. */
  channel: "telegram" | "console";
  lastOkAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  /** Failures since this process started. */
  failures: number;
}

let lastOkAt: string | null = null;
let lastFailedAt: string | null = null;
let lastError: string | null = null;
let failures = 0;

export function recordNotifyOk(): void {
  lastOkAt = new Date().toISOString();
}

export function recordNotifyFailure(err: unknown): void {
  lastFailedAt = new Date().toISOString();
  lastError = (err instanceof Error ? err.message : String(err)).slice(0, 300);
  failures++;
}

export function notifyStatus(channel: "telegram" | "console"): NotifyStatus {
  return { channel, lastOkAt, lastFailedAt, lastError, failures };
}
