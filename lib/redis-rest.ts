/** Shared Upstash Redis REST client for booking security helpers. */

export function redisCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url?.trim() || !token?.trim()) return null;
  return { url: url.replace(/\/$/, ""), token: token.trim() };
}

export function redisRequired(): boolean {
  return process.env.VERCEL === "1";
}

export async function redisCommand(command: (string | number)[]): Promise<unknown> {
  const redis = redisCreds();
  if (!redis) return null;

  const response = await fetch(redis.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redis.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Redis request failed");
  }
  const payload = (await response.json()) as { result?: unknown; error?: string };
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload.result ?? null;
}

export async function redisPipeline(
  commands: (string | number)[][],
): Promise<unknown[] | null> {
  const redis = redisCreds();
  if (!redis) return null;

  const response = await fetch(`${redis.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redis.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Redis pipeline failed");
  }
  const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  return payload.map((item) => {
    if (item.error) throw new Error(item.error);
    return item.result ?? null;
  });
}
