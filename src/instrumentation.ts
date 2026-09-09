/**
 * Next.js instrumentation hook — runs once when the server boots.
 * Starts the minute-based offline check inside the Node.js runtime.
 * Set OFFLINE_CHECK_DISABLED=1 to run scripts/offline-check.ts from cron instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.OFFLINE_CHECK_DISABLED === "1") return;
  const { startOfflineCheckLoop } = await import("./lib/alerts/offline-loop");
  startOfflineCheckLoop();
}
