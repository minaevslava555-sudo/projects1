import { redisCommand, redisCreds, redisPipeline, redisRequired } from "@/lib/redis-rest";

export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);
  return "unknown";
}

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; remaining: number; retryAfterSec: number };

/**
 * Sliding fixed window via INCR + EXPIRE.
 * Production without Redis fails closed; local without Redis fails open.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  if (!redisCreds()) {
    if (redisRequired()) {
      return { ok: false, remaining: 0, retryAfterSec: windowSec };
    }
    console.warn("[rate-limit] Redis unavailable — allowing request in local/dev");
    return { ok: true, remaining: limit };
  }

  const fullKey = `rl:${key}`;
  const counted = await redisPipeline([
    ["INCR", fullKey],
    ["EXPIRE", fullKey, windowSec],
  ]);
  const count = Number(counted?.[0] ?? 0);
  if (!Number.isFinite(count) || count <= 0) {
    return { ok: false, remaining: 0, retryAfterSec: windowSec };
  }
  if (count === 1) {
    await redisCommand(["EXPIRE", fullKey, windowSec]);
  }
  if (count > limit) {
    const ttl = Number((await redisCommand(["TTL", fullKey])) ?? windowSec);
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: ttl > 0 ? ttl : windowSec,
    };
  }
  return { ok: true, remaining: Math.max(0, limit - count) };
}
