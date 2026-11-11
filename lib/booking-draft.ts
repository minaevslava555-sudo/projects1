import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { bookingMemory } from "@/lib/booking-memory";
import { redisCommand, redisCreds, redisRequired } from "@/lib/redis-rest";

const DRAFT_TTL_SEC = 60 * 60 * 6; // 6 hours for active booking
export const PHOTO_ORPHAN_MAX_AGE_SEC = 60 * 60 * 24; // 24 hours

function draftSecret(): string {
  const secret = process.env.BOOKING_DRAFT_SECRET?.trim();
  if (secret && secret.length >= 16) return secret;
  if (process.env.VERCEL === "1") {
    throw new Error("BOOKING_DRAFT_SECRET не задан");
  }
  // Local-only fallback so draft flow works without extra .env setup
  return "local-dev-booking-draft-secret";
}

function b64url(input: Buffer | string) {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

export type DraftPayload = {
  draftId: string;
  exp: number;
};

export function createDraft(): { draftId: string; draftToken: string; expiresAt: number } {
  const draftId = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + DRAFT_TTL_SEC;
  const payload: DraftPayload = { draftId, exp: expiresAt };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(
    createHmac("sha256", draftSecret()).update(body).digest(),
  );
  return { draftId, draftToken: `${body}.${sig}`, expiresAt };
}

export function verifyDraftToken(
  token: string | null | undefined,
): { ok: true; draftId: string; exp: number } | { ok: false; error: string } {
  if (!token || typeof token !== "string" || token.length > 1024) {
    return { ok: false, error: "Некорректный draft token" };
  }
  const [body, sig] = token.split(".");
  if (!body || !sig) return { ok: false, error: "Некорректный draft token" };

  const expected = b64url(
    createHmac("sha256", draftSecret()).update(body).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: "Некорректный draft token" };
  }

  try {
    const json = JSON.parse(fromB64url(body).toString("utf8")) as DraftPayload;
    if (!json.draftId || !/^[0-9a-f-]{36}$/i.test(json.draftId)) {
      return { ok: false, error: "Некорректный draft token" };
    }
    if (!json.exp || json.exp * 1000 < Date.now()) {
      return { ok: false, error: "Срок действия черновика истёк" };
    }
    return { ok: true, draftId: json.draftId.toLowerCase(), exp: json.exp };
  } catch {
    return { ok: false, error: "Некорректный draft token" };
  }
}

function photosKey(draftId: string) {
  return `booking:draft:${draftId}:photos`;
}
function usedKey(draftId: string) {
  return `booking:draft:${draftId}:used`;
}
function createdKey(draftId: string) {
  return `booking:draft:${draftId}:created_at`;
}
function pendingKey(draftId: string) {
  return `booking:draft:${draftId}:pending`;
}

export async function registerDraft(draftId: string) {
  if (!redisCreds()) {
    if (redisRequired()) throw new Error("Redis недоступен");
    bookingMemory.registerDraft(draftId);
    return;
  }
  const now = String(Date.now());
  await redisCommand(["SET", createdKey(draftId), now, "EX", PHOTO_ORPHAN_MAX_AGE_SEC * 2]);
  await redisCommand(["SET", pendingKey(draftId), "1", "EX", PHOTO_ORPHAN_MAX_AGE_SEC * 2]);
}

export async function isDraftConsumed(draftId: string): Promise<boolean> {
  if (!redisCreds()) return bookingMemory.isUsed(draftId);
  const used = await redisCommand(["GET", usedKey(draftId)]);
  return typeof used === "string" && used.length > 0;
}

export async function markDraftConsumed(draftId: string) {
  if (!redisCreds()) {
    if (redisRequired()) throw new Error("Redis недоступен");
    bookingMemory.markUsed(draftId);
    return;
  }
  await redisCommand(["SET", usedKey(draftId), "1", "EX", 86400]);
  await redisCommand(["DEL", pendingKey(draftId)]);
}

export async function addDraftPhoto(
  draftId: string,
  path: string,
  maxPhotos = 5,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (!redisCreds()) {
    if (redisRequired()) return { ok: false, error: "Redis недоступен" };
    return bookingMemory.addPhoto(draftId, path, maxPhotos);
  }
  const key = photosKey(draftId);
  const countBefore = Number((await redisCommand(["SCARD", key])) ?? 0);
  if (countBefore >= maxPhotos) {
    return { ok: false, error: "Не более 5 фото" };
  }
  await redisCommand(["SADD", key, path]);
  await redisCommand(["EXPIRE", key, PHOTO_ORPHAN_MAX_AGE_SEC * 2]);
  const count = Number((await redisCommand(["SCARD", key])) ?? 0);
  if (count > maxPhotos) {
    await redisCommand(["SREM", key, path]);
    return { ok: false, error: "Не более 5 фото" };
  }
  return { ok: true, count };
}

export async function listDraftPhotos(draftId: string): Promise<string[]> {
  if (!redisCreds()) return bookingMemory.listPhotos(draftId);
  const raw = await redisCommand(["SMEMBERS", photosKey(draftId)]);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

export async function assertPhotosBelongToDraft(
  draftId: string,
  paths: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (paths.length === 0) return { ok: true };
  for (const path of paths) {
    if (!path.startsWith(`${draftId}/`)) {
      return { ok: false, error: "Фото не относится к этому заказу" };
    }
  }
  const known = new Set(await listDraftPhotos(draftId));
  for (const path of paths) {
    if (!known.has(path)) {
      return { ok: false, error: "Фото не найдено в черновике" };
    }
  }
  return { ok: true };
}

/** Returns pending draft ids older than maxAgeSec (best-effort via created_at keys). */
export async function listStalePendingDraftIds(
  maxAgeSec = PHOTO_ORPHAN_MAX_AGE_SEC,
): Promise<Array<{ draftId: string; createdAt: number; photos: string[] }>> {
  if (!redisCreds()) return bookingMemory.listStale(maxAgeSec);
  // Upstash supports SCAN
  const stale: Array<{ draftId: string; createdAt: number; photos: string[] }> = [];
  let cursor = "0";
  const cutoff = Date.now() - maxAgeSec * 1000;
  for (let i = 0; i < 20; i += 1) {
    const scanned = (await redisCommand([
      "SCAN",
      cursor,
      "MATCH",
      "booking:draft:*:pending",
      "COUNT",
      100,
    ])) as [string, string[]] | null;
    if (!scanned || !Array.isArray(scanned)) break;
    cursor = String(scanned[0] ?? "0");
    const keys = scanned[1] ?? [];
    for (const key of keys) {
      const draftId = key.replace(/^booking:draft:/, "").replace(/:pending$/, "");
      if (!draftId) continue;
      if (await isDraftConsumed(draftId)) continue;
      const createdRaw = await redisCommand(["GET", createdKey(draftId)]);
      const createdAt = Number(createdRaw ?? 0);
      if (!createdAt || createdAt > cutoff) continue;
      const photos = await listDraftPhotos(draftId);
      stale.push({ draftId, createdAt, photos });
    }
    if (cursor === "0") break;
  }
  return stale;
}

export async function clearDraftKeys(draftId: string) {
  if (!redisCreds()) {
    bookingMemory.clearDraft(draftId);
    return;
  }
  await redisCommand([
    "DEL",
    photosKey(draftId),
    createdKey(draftId),
    pendingKey(draftId),
  ]);
}
