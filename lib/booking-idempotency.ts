import { randomUUID } from "crypto";
import { bookingMemory } from "@/lib/booking-memory";
import { redisCommand, redisCreds, redisRequired } from "@/lib/redis-rest";

export type IdempotentOrderResult = {
  id: string;
  orderRef: string;
  pricingMode: "fixed" | "quote";
  priceEuro: number | null;
  telegramOk: boolean;
};

export type RedisDeps = {
  redisCreds: typeof redisCreds;
  redisRequired: typeof redisRequired;
  redisCommand: typeof redisCommand;
};

const defaultRedisDeps: RedisDeps = {
  redisCreds,
  redisRequired,
  redisCommand,
};

const IDEM_TTL_SEC = 86400;

function idemKey(key: string) {
  return `booking:idem:${key}`;
}

export function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) return null;
  return key;
}

export async function getIdempotentOrder(
  key: string,
): Promise<IdempotentOrderResult | null> {
  if (!redisCreds()) {
    if (redisRequired()) return null;
    const raw = bookingMemory.getIdem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as IdempotentOrderResult;
    } catch {
      return null;
    }
  }
  const raw = await redisCommand(["GET", idemKey(key)]);
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as IdempotentOrderResult;
  } catch {
    return null;
  }
}

/** Returns true if this is the first claim for the key. */
export async function claimIdempotencyKey(
  key: string,
  placeholder: IdempotentOrderResult,
): Promise<"claimed" | "exists" | "unavailable"> {
  if (!redisCreds()) {
    if (redisRequired()) return "unavailable";
    const ok = bookingMemory.claimIdem(key, JSON.stringify(placeholder));
    return ok ? "claimed" : "exists";
  }
  const result = await redisCommand([
    "SET",
    idemKey(key),
    JSON.stringify(placeholder),
    "EX",
    IDEM_TTL_SEC,
    "NX",
  ]);
  if (result === "OK" || result === true) return "claimed";
  return "exists";
}

/** Claims with a unique claimToken; returns the exact stored pending payload when claimed. */
export async function claimIdempotencyKeyWithToken(
  key: string,
  placeholder: IdempotentOrderResult,
  deps: RedisDeps = defaultRedisDeps,
): Promise<
  | { status: "claimed"; claimPayload: string }
  | { status: "exists" }
  | { status: "unavailable" }
> {
  if (placeholder.id !== "__pending__") {
    return { status: "unavailable" };
  }

  const claimToken = randomUUID();
  const claimPayload = JSON.stringify({ ...placeholder, claimToken });

  if (!deps.redisCreds()) {
    if (deps.redisRequired()) return { status: "unavailable" };
    const ok = bookingMemory.claimIdem(key, claimPayload);
    return ok ? { status: "claimed", claimPayload } : { status: "exists" };
  }

  const result = await deps.redisCommand([
    "SET",
    idemKey(key),
    claimPayload,
    "EX",
    IDEM_TTL_SEC,
    "NX",
  ]);
  if (result === "OK" || result === true) {
    return { status: "claimed", claimPayload };
  }
  return { status: "exists" };
}

export async function storeIdempotentOrder(key: string, value: IdempotentOrderResult) {
  if (!redisCreds()) {
    if (redisRequired()) throw new Error("Redis недоступен");
    bookingMemory.setIdem(key, JSON.stringify(value));
    return;
  }
  await redisCommand([
    "SET",
    idemKey(key),
    JSON.stringify(value),
    "EX",
    IDEM_TTL_SEC,
  ]);
}

const RELEASE_PENDING_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

function isReleasablePendingPayload(claimPayload: string): boolean {
  try {
    const parsed = JSON.parse(claimPayload) as {
      id?: unknown;
      claimToken?: unknown;
    };
    return (
      parsed.id === "__pending__" &&
      typeof parsed.claimToken === "string" &&
      parsed.claimToken.length > 0
    );
  } catch {
    return false;
  }
}

/** Atomically deletes a pending claim only if the stored value exactly matches claimPayload. */
export async function releasePendingIdempotencyKey(
  key: string,
  claimPayload: string,
  deps: RedisDeps = defaultRedisDeps,
): Promise<boolean> {
  if (!isReleasablePendingPayload(claimPayload)) {
    return false;
  }

  if (!deps.redisCreds()) {
    if (deps.redisRequired()) return false;
    return bookingMemory.compareAndDeleteIdem(key, claimPayload);
  }

  try {
    const result = await deps.redisCommand([
      "EVAL",
      RELEASE_PENDING_LUA,
      1,
      idemKey(key),
      claimPayload,
    ]);
    return result === 1 || result === true;
  } catch {
    return false;
  }
}
