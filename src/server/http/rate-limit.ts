import { AppError } from "@/server/errors";

/**
 * Fixed-window-with-sliding-log rate limiter, kept in process memory.
 *
 * Trade-off: correct for a single server instance; with several instances
 * each enforces its own budget. A multi-instance deployment should back this
 * interface with Redis or Postgres. The interface stays the same.
 */
export interface RateLimitRule {
  name: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  chat: { name: "chat", limit: 20, windowMs: 60_000 },
  upload: { name: "upload", limit: 30, windowMs: 60_000 },
  analysis: { name: "analysis", limit: 5, windowMs: 10 * 60_000 },
  mutation: { name: "mutation", limit: 60, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;

const buckets = new Map<string, number[]>();
let lastSweep = Date.now();

export function checkRateLimit(rule: RateLimitRule, subject: string, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
  const key = `${rule.name}:${subject}`;
  const windowStart = now - rule.windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= rule.limit) {
    buckets.set(key, hits);
    return { allowed: false, retryAfterMs: hits[0] + rule.windowMs - now };
  }
  hits.push(now);
  buckets.set(key, hits);

  // Periodically drop idle keys so memory stays bounded.
  if (now - lastSweep > 5 * 60_000) {
    lastSweep = now;
    for (const [k, v] of buckets) if (v.every((t) => t <= now - 60 * 60_000)) buckets.delete(k);
  }
  return { allowed: true, retryAfterMs: 0 };
}

export function enforceRateLimit(rule: RateLimitRule, subject: string): void {
  const { allowed, retryAfterMs } = checkRateLimit(rule, subject);
  if (!allowed) {
    throw new AppError("RATE_LIMITED", `Too many requests. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`, {
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    });
  }
}

export function resetRateLimits(): void {
  buckets.clear();
}
