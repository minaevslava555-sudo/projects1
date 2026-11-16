import {
  assertPhotosBelongToDraft,
  isDraftConsumed,
  markDraftConsumed,
  verifyDraftToken,
} from "@/lib/booking-draft";
import {
  claimIdempotencyKeyWithToken,
  getIdempotentOrder,
  normalizeIdempotencyKey,
  releasePendingIdempotencyKey,
  storeIdempotentOrder,
  type IdempotentOrderResult,
} from "@/lib/booking-idempotency";
import {
  type BookingService,
  isValidPreferredTime,
} from "@/lib/booking-pricing";
import { resolveOrderPricing } from "@/lib/order-pricing";
import { generateOrderRef } from "@/lib/order-ref";
import { saveOrderToSupabase } from "@/lib/orders";
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
  storeIdempotentOrder: typeof storeIdempotentOrder;
  verifyDraftToken: typeof verifyDraftToken;
  isDraftConsumed: typeof isDraftConsumed;
  assertPhotosBelongToDraft: typeof assertPhotosBelongToDraft;
  markDraftConsumed: typeof markDraftConsumed;
  resolveOrderPricing: typeof resolveOrderPricing;
  generateOrderRef: typeof generateOrderRef;
  saveOrderToSupabase: typeof saveOrderToSupabase;
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
  storeIdempotentOrder,
  verifyDraftToken,
  isDraftConsumed,
  assertPhotosBelongToDraft,
  markDraftConsumed,
  resolveOrderPricing,
  generateOrderRef,
  saveOrderToSupabase,
  notifyAdminAboutOrder,
};

const SERVICES = new Set<BookingService>(["cleaning", "repair", "massage"]);

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

    const existing = await deps.getIdempotentOrder(idempotencyKey);
    if (existing && existing.id !== "__pending__") {
      return Response.json({ ok: true, ...existing });
    }
    if (existing?.id === "__pending__") {
      return jsonError("Заказ уже обрабатывается", 409);
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
        return Response.json({ ok: true, ...again });
      }
      return jsonError("Заказ уже обрабатывается", 409);
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
      return failBeforeSave(photos.error, 400);
    }
    const repairPhotoPaths = photos.paths;
    if (serviceRaw === "repair") {
      console.info("[order] repair_photo_count", repairPhotoPaths.length);
    }

    if (!name || !phone || !serviceRaw || !SERVICES.has(serviceRaw as BookingService)) {
      return failBeforeSave("Заполните имя, телефон и услугу", 400);
    }

    const service = serviceRaw as BookingService;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return failBeforeSave("Укажите дату", 400);
    }
    if (!preferredTime || !isValidPreferredTime(preferredTime)) {
      return failBeforeSave("Укажите время в слотах 09:00–19:00", 400);
    }
    if (!streetAddress || !city) {
      return failBeforeSave("Укажите адрес и город", 400);
    }
    if (
      apartmentFloor === "invalid" ||
      accessInstructions === "invalid" ||
      details === "invalid" ||
      problemDescription === "invalid" ||
      massageCategory === "invalid"
    ) {
      return failBeforeSave("Проверьте дополнительные поля", 400);
    }

    if (service === "repair") {
      if (!problemDescription) {
        return failBeforeSave("Опишите проблему", 400);
      }
    }

    const draftToken =
      asTrimmedString(raw.draftToken, 1024) ||
      request.headers.get("x-booking-draft-token");
    const draft = deps.verifyDraftToken(draftToken);
    if (!draft.ok) {
      return failBeforeSave(draft.error, 400);
    }
    const draftId = draft.draftId;
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
    const { id, orderRef: savedRef } = await deps.saveOrderToSupabase({
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
      pricingConfigId,
      pricingVersion,
      hourlyRateSnapshot,
      pricingSnapshot,
    });

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
    await deps.storeIdempotentOrder(idempotencyKey, result);

    return Response.json({
      ok: true,
      ...result,
    });
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
