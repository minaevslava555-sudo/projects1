import {
  type BookingService,
  isValidPreferredTime,
  resolveBookingPricing,
} from "@/lib/booking-pricing";
import { generateOrderRef } from "@/lib/order-ref";
import { saveOrderToSupabase } from "@/lib/orders";
import { notifyAdminAboutOrder } from "@/lib/telegram-notify";

export const runtime = "nodejs";

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

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Некорректный запрос", 400);
    }

    const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
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
      return jsonError(photos.error, 400);
    }
    const repairPhotoPaths = photos.paths;

    if (!name || !phone || !serviceRaw || !SERVICES.has(serviceRaw as BookingService)) {
      return jsonError("Заполните имя, телефон и услугу", 400);
    }

    const service = serviceRaw as BookingService;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return jsonError("Укажите дату", 400);
    }
    if (!preferredTime || !isValidPreferredTime(preferredTime)) {
      return jsonError("Укажите время в слотах 09:00–19:00", 400);
    }
    if (!streetAddress || !city) {
      return jsonError("Укажите адрес и город", 400);
    }
    if (
      apartmentFloor === "invalid" ||
      accessInstructions === "invalid" ||
      details === "invalid" ||
      problemDescription === "invalid" ||
      massageCategory === "invalid"
    ) {
      return jsonError("Проверьте дополнительные поля", 400);
    }

    if (service === "repair") {
      if (!problemDescription) {
        return jsonError("Опишите проблему", 400);
      }
    }

    const priced = resolveBookingPricing({
      service,
      rooms: rooms ?? undefined,
      massageMinutes: massageMinutes ?? undefined,
    });
    if ("error" in priced) {
      return jsonError(priced.error, 400);
    }

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

    const orderRef = generateOrderRef();

    const { id, orderRef: savedRef } = await saveOrderToSupabase({
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
    });

    let telegramOk = true;
    try {
      await notifyAdminAboutOrder({
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
      });
    } catch (notifyError) {
      telegramOk = false;
      console.error("[order] telegram notify failed", notifyError);
    }

    return Response.json({
      ok: true,
      id,
      orderRef: savedRef,
      pricingMode: priced.mode,
      priceEuro: priced.priceEuro,
      telegramOk,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отправить заказ";
    return jsonError(message, 502);
  }
}
