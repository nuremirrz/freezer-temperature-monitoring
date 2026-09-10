/**
 * Tiny in-memory sliding-window limiter for the auth endpoints.
 * Single-process by design (pilot); swap for Redis if the app is ever scaled out.
 */
const hits = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): boolean {
  const from = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > from);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) {
    // crude GC so a scan can't grow the map without bound
    for (const [k, v] of hits) if (!v.some((t) => t > from)) hits.delete(k);
  }
  return true;
}

export const LIMITS = {
  login: { limit: 10, windowMs: 60_000 },
  register: { limit: 5, windowMs: 10 * 60_000 },
  forgot: { limit: 5, windowMs: 10 * 60_000 },
  resend: { limit: 3, windowMs: 10 * 60_000 },
  reset: { limit: 10, windowMs: 10 * 60_000 },
} as const;
