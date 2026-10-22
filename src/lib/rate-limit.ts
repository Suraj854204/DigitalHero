/**
 * Small in-memory sliding-window limiter for abuse-prone endpoints (contact form, AI assistant).
 * LIMITATION: state lives in one server instance. On serverless (multiple instances) this is a
 * best-effort speed bump, not a guarantee; use a shared store (e.g. Upstash/Redis) for strict limits.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterMs: number } {
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfterMs: windowMs - (now - hits[0]) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  return { ok: true, retryAfterMs: 0 };
}
