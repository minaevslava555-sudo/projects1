import {
  assertPhotosBelongToDraft,
  isDraftConsumed,
  markDraftConsumed,
  verifyDraftToken,
} from "@/lib/booking-draft";
import {
  claimIdempotencyKeyWithToken,
  finalizePendingIdempotencyKey,
  getIdempotentOrder,
  normalizeIdempotencyKey,
  releasePendingIdempotencyKey,
  storeIdempotentOrder,
  type IdempotentOrderResult,
} from "@/lib/booking-idempotency";
import {
  type BookingService,
  type CleaningV1RoomCounts,
  type CleaningV1Type,
  isValidPreferredTime,
  parseCleaningV1PriceInput,
} from "@/lib/booking-pricing";
import { buildOrderRequestFingerprint } from "@/lib/order-request-fingerprint";
import { resolveOrderPricing } from "@/lib/order-pricing";
import { generateOrderRef } from "@/lib/order-ref";
import {
  findOrderByIdempotencyKey,
  OrderIdempotencyConflictError,
  saveOrderToSupabase,
} from "@/lib/orders";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";
import { cleanupOrphanRepairPhotos } from "@/lib/repair-photos-cleanup";
import { notifyAdminAboutOrder } from "@/lib/telegram-notify";
import { verifyTurnstileToken } from "@/lib/turnstile";

export type OrderRouteDeps = {
  cleanupOrphanRepairPhotos: typeof cleanupOrphanRepairPhotos;
  clientIpFromHeaders: typeof clientIpFromHeaders;
  consumeRateLimit: typeof consumeRateLimit;
  verifyTurnstileToken: typeof verifyTurnstileToken;
  normalizeIdempotencyKey: typeof normalizeIdempotencyKey;
  getIdempotentOrder: typeof getIdempotentOrder;
  claimIdempotencyKeyWithToken: typeof claimIdempotencyKeyWithToken;
  releasePendingIdempotencyKey: typeof releasePendingIdempotencyKey;
  finalizePendingIdempotencyKey: typeof finalizePendingIdempotencyKey;
  storeIdempotentOrder: typeof storeIdempotentOrder;
  verifyDraftToken: typeof verifyDraftToken;
  isDraftConsumed: typeof isDraftConsumed;
  assertPhotosBelongToDraft: typeof assertPhotosBelongToDraft;
  markDraftConsumed: typeof markDraftConsumed;
  resolveOrderPricing: typeof resolveOrderPricing;
  generateOrderRef: typeof generateOrderRef;
  saveOrderToSupabase: typeof saveOrderToSupabase;
  findOrderByIdempotencyKey: typeof findOrderByIdempotencyKey;
  notifyAdminAboutOrder: typeof notifyAdminAboutOrder;
};

export const defaultOrderRouteDeps: OrderRouteDeps = {
  cleanupOrphanRepairPhotos,
  clientIpFromHeaders,
  consumeRateLimit,
  verifyTurnstileToken,
  normalizeIdempotencyKey,
  getIdempotentOrder,
  claimIdempotencyKeyWithToken,
  releasePendingIdempotencyKey,
  finalizePendingIdempotencyKey,
  storeIdempotentOrder,
  verifyDraftToken,
  isDraftConsumed,
  assertPhotosBelongToDraft,
  markDraftConsumed,
  resolveOrderPricing,
  generateOrderRef,
  saveOrderToSupabase,
  findOrderByIdempotencyKey,
  notifyAdminAboutOrder,
};

const SERVICES = new Set<BookingService>(["cleaning", "repair", "massage"]);

/** Replay a DB row when fingerprint matches; telegramOk only from a completed Redis cache hit. */
function replayFromPersistedOrder(
  existingByKey: {
    id: string;
    orderRef: string;
    pricingMode: "fixed" | "quote";
    priceEuro: number | null;
  },
  cached: IdempotentOrderResult | null,
): IdempotentOrderResult {
  const telegramOk =
    cached != null &&
    cached.id === existingByKey.id &&
    cached.orderRef === existingByKey.orderRef &&
    cached.id !== "__pending__" &&
    typeof cached.telegramOk === "boolean"
      ? cached.telegramOk
      : false;
  return {
    id: existingByKey.id,
    orderRef: existingByKey.orderRef,
    pricingMode: existingByKey.pricingMode,
    priceEuro: existingByKey.priceEuro,
    telegramOk,
  };
}

/**
 * When Redis is still pending, allow fingerprint-gated DB replay after draft auth.
 * Does not claim, finalize, insert, or notify.
 */
async function respondForPendingClaim(
  deps: OrderRouteDeps,
  request: Request,
  raw: Record<string, unknown>,
  idempotencyKey: string,
  requestFingerprint: string,
): Promise<Response> {
  const draftToken =
    asTrimmedString(raw.draftToken, 1024) ||
    request.headers.get("x-booking-draft-token");
  const draft = deps.verifyDraftToken(draftToken);
  if (!draft.ok) {
    return jsonError(draft.error, 400);
  }

  const existingByKey = await deps.findOrderByIdempotencyKey(idempotencyKey);
  if (
    existingByKey &&
    existingByKey.requestFingerprint != null &&
    existingByKey.requestFingerprint === requestFingerprint
  ) {
    const cached = await deps.getIdempotentOrder(idempotencyKey);
    return Response.json({
      ok: true,
      ...replayFromPersistedOrder(existingByKey, cached),
    });
  }

  return jsonError("Заказ уже обрабатывается", 409);
}

/** Publish completed idempotency result; never blind-store on Redis error or ownership mismatch. */
async function respondAfterFinalize(
  deps: OrderRouteDeps,
  idempotencyKey: string,
  claimPayload: string,
  result: IdempotentOrderResult,
  requestFingerprint: string,
): Promise<Response> {
  const finalized = await deps.finalizePendingIdempotencyKey(
    idempotencyKey,
    claimPayload,
    result,
  );
  if (finalized === "finalized") {
    return Response.json({ ok: true, ...result });
  }
  if (finalized === "missing") {
    // Pending expired — safe to publish completed result for retries.
    await deps.storeIdempotentOrder(idempotencyKey, result);
    return Response.json({ ok: true, ...result });
  }
  if (finalized === "error") {
    // Redis state unknown — do not overwrite; client may retry.
    return jsonError("Сервис временно недоступен", 503);
  }
  // mismatch: 200 only when DB confirms this result for the authorized fingerprint.
  try {
    const row = await deps.findOrderByIdempotencyKey(idempotencyKey);
    if (
      row &&
      row.requestFingerprint != null &&
      row.requestFingerprint === requestFingerprint &&
      row.id === result.id &&
      row.orderRef === result.orderRef
    ) {
      return Response.json({ ok: true, ...result });
    }
  } catch {
    // Lookup failure — treat as unverified.
  }
  return jsonError("Сервис временно недоступен", 503);
}
const SERVICE_TITLES: Record<BookingService, string> = {
  cleaning: "Cleaning / Уборка",
  repair: "Home Repairs / Ремонт",
  massage: "Massage / Массаж",
};

const PHOTO_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$/i;

function asTrimmedString(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max) return null;
  return text;
}

function asOptionalTrimmed(value: unknown, max: number): string | undefined | "invalid" {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") return "invalid";
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > max) return "invalid";
  return text;
}

function asPositiveInt(value: unknown, max: number) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1 || num > max) return null;
  return num;
}

/** Reject Cleaning v1 / mixed payloads until v1 order processing is enabled. */
function rejectUnsupportedCleaningPricingVersion(
  raw: Record<string, unknown>,
): { ok: false; message: string; status: number } | null {
  const versionRaw = raw.cleaningPricingVersion;
  if (versionRaw != null && versionRaw !== "") {
    if (typeof versionRaw !== "string") {
      return {
        ok: false,
        message: "Неизвестная версия заказа уборки",
        status: 400,
      };
    }
    const version = versionRaw.trim();
    if (version === "v1") {
      return {
        ok: false,
        message: "Cleaning v1 пока недоступна",
        status: 400,
      };
    }
    if (version !== "" && version !== "legacy") {
      return {
        ok: false,
        message: "Неизвестная версия заказа уборки",
        status: 400,
      };
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(raw, "roomCounts") ||
    Object.prototype.hasOwnProperty.call(raw, "areaM2") ||
    Object.prototype.hasOwnProperty.call(raw, "cleaningType")
  ) {
    return {
      ok: false,
      message: "Уберите поля Cleaning v1 из запроса",
      status: 400,
    };
  }

  return null;
}

export type CleaningV1OrderFields = {
  cleaningPricingVersion: "v1";
  roomCounts: CleaningV1RoomCounts;
  areaM2: number;
  cleaningType: CleaningV1Type;
};

export type ParseCleaningV1OrderFieldsResult =
  | { ok: true; value: CleaningV1OrderFields }
  | { ok: false; error: string };

/**
 * Isolated Cleaning v1 order-field parser. Not wired into handleOrderPost yet;
 * live path still rejects v1 via rejectUnsupportedCleaningPricingVersion.
 */
export function parseCleaningV1OrderFields(
  raw: unknown,
): ParseCleaningV1OrderFieldsResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Некорректные поля Cleaning v1" };
  }
  const record = raw as Record<string, unknown>;

  if (!Object.prototype.hasOwnProperty.call(record, "cleaningPricingVersion")) {
    return { ok: false, error: "Укажите версию заказа уборки" };
  }
  if (record.cleaningPricingVersion !== "v1") {
    return { ok: false, error: "Неизвестная версия заказа уборки" };
  }

  if (
    Object.prototype.hasOwnProperty.call(record, "rooms") &&
    record.rooms != null
  ) {
    return {
      ok: false,
      error: "Уберите устаревшее поле rooms из запроса Cleaning v1",
    };
  }

  const priced = parseCleaningV1PriceInput({
    rooms: record.roomCounts,
    areaM2: record.areaM2,
    cleaningType: record.cleaningType,
  });
  if (!priced.ok) {
    return { ok: false, error: priced.error };
  }

  return {
    ok: true,
    value: {
      cleaningPricingVersion: "v1",
      roomCounts: priced.value.rooms,
      areaM2: priced.value.areaM2,
      cleaningType: priced.value.cleaningType,
    },
  };
}

function jsonError(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

function parsePhotoPaths(value: unknown): { ok: true; paths: string[] } | { ok: false; error: string } {
  if (value == null) return { ok: true, paths: [] };
  if (!Array.isArray(value)) return { ok: false, error: "Некорректный список фото" };
  if (value.length > 5) return { ok: false, error: "Не более 5 фото" };
  const paths: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !PHOTO_PATH_RE.test(item)) {
      return { ok: false, error: "Некорректный путь к фото" };
    }
    paths.push(item);
  }
  return { ok: true, paths };
}

function pendingPlaceholder(): IdempotentOrderResult {
  return {
    id: "__pending__",
    orderRef: "",
    pricingMode: "fixed",
    priceEuro: null,
    telegramOk: false,
  };
}

type ValidatedBookingFields = {
  name: string;
  phone: string;
  service: BookingService;
  date: string;
  preferredTime: string;
  streetAddress: string;
  city: string;
  apartmentFloor: string | undefined;
  accessInstructions: string | undefined;
  details: string | undefined;
  problemDescription: string | undefined;
  massageCategory: string | undefined;
  rooms: number | null;
  massageMinutes: number | null;
  repairPhotoPaths: string[];
};

function parseValidatedBookingFields(
  raw: Record<string, unknown>,
):
  | { ok: true; fields: ValidatedBookingFields }
  | { ok: false; message: string; status: number } {
  const name = asTrimmedString(raw.name, 120);
  const phone = asTrimmedString(raw.phone, 40);
  const serviceRaw = asTrimmedString(raw.service, 40);
  const date = asTrimmedString(raw.date, 40);
  const preferredTime = asTrimmedString(raw.preferredTime, 5);
  const streetAddress = asTrimmedString(raw.streetAddress, 200);
  const city = asTrimmedString(raw.city, 100);
  const apartmentFloor = asOptionalTrimmed(raw.apartmentFloor, 80);
  const accessInstructions = asOptionalTrimmed(raw.accessInstructions, 500);
  const details = asOptionalTrimmed(raw.details, 200);
  const problemDescription = asOptionalTrimmed(raw.problemDescription, 2000);
  const massageCategory = asOptionalTrimmed(raw.massageCategory, 120);
  const rooms = asPositiveInt(raw.rooms, 6);
  const massageMinutes = asPositiveInt(raw.massageMinutes, 240);
  const photos = parsePhotoPaths(raw.repairPhotoPaths);
  if (!photos.ok) {
    return { ok: false, message: photos.error, status: 400 };
  }
  const repairPhotoPaths = photos.paths;
  if (serviceRaw === "repair") {
    console.info("[order] repair_photo_count", repairPhotoPaths.length);
  }

  if (!name || !phone || !serviceRaw || !SERVICES.has(serviceRaw as BookingService)) {
    return { ok: false, message: "Заполните имя, телефон и услугу", status: 400 };
  }

  const service = serviceRaw as BookingService;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: "Укажите дату", status: 400 };
  }
  if (!preferredTime || !isValidPreferredTime(preferredTime)) {
    return { ok: false, message: "Укажите время в слотах 09:00–19:00", status: 400 };
  }
  if (!streetAddress || !city) {
    return { ok: false, message: "Укажите адрес и город", status: 400 };
  }
  if (
    apartmentFloor === "invalid" ||
    accessInstructions === "invalid" ||
    details === "invalid" ||
    problemDescription === "invalid" ||
    massageCategory === "invalid"
  ) {
    return { ok: false, message: "Проверьте дополнительные поля", status: 400 };
  }

  if (service === "repair") {
    if (!problemDescription) {
      return { ok: false, message: "Опишите проблему", status: 400 };
    }
  }

  if (service === "cleaning") {
    const cleaningVersionError = rejectUnsupportedCleaningPricingVersion(raw);
    if (cleaningVersionError) return cleaningVersionError;
  }

  return {
    ok: true,
    fields: {
      name,
      phone,
      service,
      date,
      preferredTime,
      streetAddress,
      city,
      apartmentFloor: apartmentFloor === "invalid" ? undefined : apartmentFloor,
      accessInstructions:
        accessInstructions === "invalid" ? undefined : accessInstructions,
      details: details === "invalid" ? undefined : details,
      problemDescription:
        problemDescription === "invalid" ? undefined : problemDescription,
      massageCategory: massageCategory === "invalid" ? undefined : massageCategory,
      rooms,
      massageMinutes,
      repairPhotoPaths,
    },
  };
}

export async function handleOrderPost(
  request: Request,
  deps: OrderRouteDeps,
): Promise<Response> {
  let claimPayload: string | null = null;
  let saveStarted = false;
  let claimedIdempotencyKey: string | null = null;
  try {
    void deps.cleanupOrphanRepairPhotos({ limit: 3 }).catch((error) => {
      console.warn("[order] lazy cleanup skipped", error);
    });

    const ip = deps.clientIpFromHeaders(request.headers);
    const limited = await deps.consumeRateLimit(`order:${ip}`, 10, 600);
    if (!limited.ok) {
      return jsonError("Слишком много запросов. Попробуйте позже", 429);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Некорректный запрос", 400);
    }

    const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    const turnstile = await deps.verifyTurnstileToken(
      asTrimmedString(raw.turnstileToken, 4096) ||
        request.headers.get("x-turnstile-token"),
      ip,
    );
    if (!turnstile.ok) {
      return jsonError(turnstile.error, 403);
    }

    const idempotencyKey =
      deps.normalizeIdempotencyKey(raw.idempotencyKey) ||
      deps.normalizeIdempotencyKey(request.headers.get("idempotency-key"));
    if (!idempotencyKey) {
      return jsonError("Нужен Idempotency-Key", 400);
    }

    const validated = parseValidatedBookingFields(raw);
    if (!validated.ok) {
      return jsonError(validated.message, validated.status);
    }
    const {
      name,
      phone,
      service,
      date,
      preferredTime,
      streetAddress,
      city,
      apartmentFloor,
      accessInstructions,
      details,
      problemDescription,
      massageCategory,
      rooms,
      massageMinutes,
      repairPhotoPaths,
    } = validated.fields;

    const requestFingerprint = buildOrderRequestFingerprint({
      name,
      phone,
      service,
      date,
      preferredTime,
      streetAddress,
      city,
      apartmentFloor: apartmentFloor === "invalid" ? null : apartmentFloor ?? null,
      accessInstructions:
        accessInstructions === "invalid" ? null : accessInstructions ?? null,
      details: details === "invalid" ? null : details ?? null,
      problemDescription:
        problemDescription === "invalid" ? null : problemDescription ?? null,
      massageCategory: massageCategory === "invalid" ? null : massageCategory ?? null,
      rooms,
      massageMinutes,
      repairPhotoPaths,
    });

    const existing = await deps.getIdempotentOrder(idempotencyKey);
    if (existing && existing.id !== "__pending__") {
      const existingByKey = await deps.findOrderByIdempotencyKey(idempotencyKey);
      if (
        existingByKey &&
        existingByKey.requestFingerprint != null &&
        existingByKey.requestFingerprint === requestFingerprint &&
        existing.id === existingByKey.id &&
        existing.orderRef === existingByKey.orderRef
      ) {
        return Response.json({ ok: true, ...existing });
      }
      return jsonError("Ключ идемпотентности уже использован", 409);
    }
    if (existing?.id === "__pending__") {
      return respondForPendingClaim(
        deps,
        request,
        raw,
        idempotencyKey,
        requestFingerprint,
      );
    }

    const claim = await deps.claimIdempotencyKeyWithToken(
      idempotencyKey,
      pendingPlaceholder(),
    );
    if (claim.status === "unavailable") {
      return jsonError("Сервис временно недоступен", 503);
    }
    if (claim.status === "exists") {
      const again = await deps.getIdempotentOrder(idempotencyKey);
      if (again && again.id !== "__pending__") {
        const existingByKey = await deps.findOrderByIdempotencyKey(idempotencyKey);
        if (
          existingByKey &&
          existingByKey.requestFingerprint != null &&
          existingByKey.requestFingerprint === requestFingerprint &&
          again.id === existingByKey.id &&
          again.orderRef === existingByKey.orderRef
        ) {
          return Response.json({ ok: true, ...again });
        }
        return jsonError("Ключ идемпотентности уже использован", 409);
      }
      return respondForPendingClaim(
        deps,
        request,
        raw,
        idempotencyKey,
        requestFingerprint,
      );
    }
    claimPayload = claim.claimPayload;
    claimedIdempotencyKey = idempotencyKey;

    const failBeforeSave = async (message: string, status: number) => {
      try {
        await deps.releasePendingIdempotencyKey(idempotencyKey, claim.claimPayload);
      } catch {
        // Best-effort release; always return the original client error.
      }
      return jsonError(message, status);
    };

    const draftToken =
      asTrimmedString(raw.draftToken, 1024) ||
      request.headers.get("x-booking-draft-token");
    const draft = deps.verifyDraftToken(draftToken);
    if (!draft.ok) {
      return failBeforeSave(draft.error, 400);
    }
    const draftId = draft.draftId;

    // Recover persisted order before consumed-draft rejection (crash / finalize failure).
    const existingByKey = await deps.findOrderByIdempotencyKey(idempotencyKey);
    if (existingByKey) {
      if (
        existingByKey.requestFingerprint != null &&
        existingByKey.requestFingerprint === requestFingerprint
      ) {
        const cached = await deps.getIdempotentOrder(idempotencyKey);
        return respondAfterFinalize(
          deps,
          idempotencyKey,
          claim.claimPayload,
          replayFromPersistedOrder(existingByKey, cached),
          requestFingerprint,
        );
      }
      // Mismatch or legacy null fingerprint: reject without leaking order details.
      return failBeforeSave("Ключ идемпотентности уже использован", 409);
    }

    if (await deps.isDraftConsumed(draftId)) {
      return failBeforeSave("Черновик уже использован", 400);
    }
    const bound = await deps.assertPhotosBelongToDraft(draftId, repairPhotoPaths);
    if (!bound.ok) {
      return failBeforeSave(bound.error, 400);
    }

    const pricingResult = await deps.resolveOrderPricing({
      service,
      rooms: rooms ?? undefined,
      massageMinutes: massageMinutes ?? undefined,
    });
    if (!pricingResult.ok) {
      return failBeforeSave(pricingResult.message, pricingResult.status);
    }
    const {
      priced,
      pricingConfigId,
      pricingVersion,
      hourlyRateSnapshot,
      pricingSnapshot,
    } = pricingResult;

    let orderDetails = details ?? undefined;
    if (service === "cleaning" && priced.mode === "fixed") {
      orderDetails =
        orderDetails ??
        `${rooms} room(s) require ~${priced.hours} hours and ${priced.workers} cleaner(s)`;
    }
    if (service === "massage" && priced.mode === "fixed") {
      const duration = `${priced.massageMinutes} min session`;
      orderDetails = orderDetails
        ? orderDetails
        : massageCategory
          ? `${massageCategory} · ${duration}`
          : duration;
    }
    if (service === "repair") {
      orderDetails = orderDetails ?? "Home repair quote request";
    }

    const orderRef = deps.generateOrderRef();

    saveStarted = true;
    let id: string;
    let savedRef: string;
    try {
      const saved = await deps.saveOrderToSupabase({
        name,
        phone,
        service,
        pricingMode: priced.mode,
        priceEuro: priced.priceEuro,
        date,
        preferredTime,
        streetAddress,
        city,
        apartmentFloor,
        accessInstructions,
        details: orderDetails,
        rooms: service === "cleaning" ? rooms ?? undefined : undefined,
        hours: priced.mode === "fixed" ? priced.hours : undefined,
        workers: priced.mode === "fixed" ? priced.workers : undefined,
        massageMinutes: priced.mode === "fixed" ? priced.massageMinutes : undefined,
        massageCategory: service === "massage" ? massageCategory : undefined,
        problemDescription: service === "repair" ? problemDescription : undefined,
        repairPhotoPaths: service === "repair" ? repairPhotoPaths : undefined,
        orderRef,
        idempotencyKey,
        requestFingerprint,
        pricingConfigId,
        pricingVersion,
        hourlyRateSnapshot,
        pricingSnapshot,
      });
      id = saved.id;
      savedRef = saved.orderRef;
    } catch (saveError) {
      // Isolated save catch: outer catch cannot see requestFingerprint/idempotencyKey.
      if (saveError instanceof OrderIdempotencyConflictError) {
        try {
          const conflictRow = await deps.findOrderByIdempotencyKey(idempotencyKey);
          if (
            conflictRow &&
            conflictRow.requestFingerprint != null &&
            conflictRow.requestFingerprint === requestFingerprint
          ) {
            const cached = await deps.getIdempotentOrder(idempotencyKey);
            return respondAfterFinalize(
              deps,
              idempotencyKey,
              claim.claimPayload,
              replayFromPersistedOrder(conflictRow, cached),
              requestFingerprint,
            );
          }
        } catch {
          try {
            await deps.releasePendingIdempotencyKey(
              idempotencyKey,
              claim.claimPayload,
            );
          } catch {
            // Best-effort release after lookup failure.
          }
          throw saveError;
        }
        try {
          await deps.releasePendingIdempotencyKey(
            idempotencyKey,
            claim.claimPayload,
          );
        } catch {
          // Best-effort release on fingerprint mismatch / missing row.
        }
        return jsonError("Ключ идемпотентности уже использован", 409);
      }
      throw saveError;
    }

    await deps.markDraftConsumed(draftId);

    let telegramOk = true;
    try {
      await deps.notifyAdminAboutOrder({
        name,
        phone,
        service: SERVICE_TITLES[service],
        pricingMode: priced.mode,
        priceEuro: priced.priceEuro,
        orderRef: savedRef,
        date,
        preferredTime,
        streetAddress,
        city,
        apartmentFloor,
        accessInstructions,
        details: orderDetails,
        rooms: service === "cleaning" ? rooms ?? undefined : undefined,
        hours: priced.mode === "fixed" ? priced.hours : undefined,
        workers: priced.mode === "fixed" ? priced.workers : undefined,
        massageMinutes: priced.mode === "fixed" ? priced.massageMinutes : undefined,
        massageCategory: service === "massage" ? massageCategory : undefined,
        problemDescription: service === "repair" ? problemDescription : undefined,
        repairPhotoCount: service === "repair" ? repairPhotoPaths.length : undefined,
        repairPhotoPaths: service === "repair" ? repairPhotoPaths : undefined,
      });
    } catch (notifyError) {
      telegramOk = false;
      console.error("[order] telegram notify failed", notifyError);
    }

    const result: IdempotentOrderResult = {
      id,
      orderRef: savedRef,
      pricingMode: priced.mode,
      priceEuro: priced.priceEuro,
      telegramOk,
    };
    return respondAfterFinalize(
      deps,
      idempotencyKey,
      claim.claimPayload,
      result,
      requestFingerprint,
    );
  } catch (error) {
    if (
      claimPayload !== null &&
      claimedIdempotencyKey !== null &&
      saveStarted === false
    ) {
      try {
        await deps.releasePendingIdempotencyKey(claimedIdempotencyKey, claimPayload);
      } catch {
        // Best-effort release; never mask the original exception.
      }
    }
    const message = error instanceof Error ? error.message : "Не удалось отправить заказ";
    return jsonError(message, 502);
  }
}
