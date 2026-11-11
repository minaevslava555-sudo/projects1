import { bookingMemory } from "@/lib/booking-memory";
import { redisCommand, redisCreds, redisRequired } from "@/lib/redis-rest";

export type IdempotentOrderResult = {
  id: string;
  orderRef: string;
  pricingMode: "fixed" | "quote";
  priceEuro: number | null;
  telegramOk: boolean;
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
