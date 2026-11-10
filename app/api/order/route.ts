import { saveOrderToSupabase } from "@/lib/orders";
import { notifyAdminAboutOrder } from "@/lib/telegram-notify";

export const runtime = "nodejs";

const SERVICES = new Set(["cleaning", "repair", "massage"]);

const SERVICE_TITLES: Record<string, string> = {
  cleaning: "Cleaning / Уборка",
  repair: "Home Repairs / Ремонт",
  massage: "Massage / Массаж",
};

function asTrimmedString(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max) return null;
  return text;
}

function asPositiveInt(value: unknown, max: number) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1 || num > max) return null;
  return num;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
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
    const service = asTrimmedString(raw.service, 40);
    const date = asTrimmedString(raw.date, 40);
    const details = asTrimmedString(raw.details, 200);
    const priceEuro = typeof raw.priceEuro === "number" ? raw.priceEuro : Number(raw.priceEuro);
    const rooms = asPositiveInt(raw.rooms, 6);
    const hours = asPositiveInt(raw.hours, 24);
    const workers = asPositiveInt(raw.workers, 12);
    const massageMinutes = asPositiveInt(raw.massageMinutes, 240);

    if (!name || !phone || !service || !SERVICES.has(service)) {
      return jsonError("Заполните имя, телефон и услугу", 400);
    }
    if (!Number.isFinite(priceEuro) || priceEuro <= 0 || priceEuro > 100_000) {
      return jsonError("Некорректная сумма", 400);
    }

    if (service === "cleaning") {
      if (!rooms || !hours || !workers) {
        return jsonError("Укажите комнаты, часы и число клинеров", 400);
      }
    }
    if (service === "repair") {
      if (!hours || !workers) {
        return jsonError("Укажите часы и число специалистов", 400);
      }
    }
    if (service === "massage" && !massageMinutes) {
      return jsonError("Укажите длительность сеанса", 400);
    }

    const orderService = service as "cleaning" | "repair" | "massage";

    const { id } = await saveOrderToSupabase({
      name,
      phone,
      service: orderService,
      priceEuro,
      date: date ?? undefined,
      details: details ?? undefined,
      rooms: rooms ?? undefined,
      hours: hours ?? undefined,
      workers: workers ?? undefined,
      massageMinutes: massageMinutes ?? undefined,
    });

    try {
      await notifyAdminAboutOrder({
        name,
        phone,
        service: SERVICE_TITLES[service] ?? service,
        priceEuro,
        date: date ?? undefined,
        details: details ?? undefined,
        rooms: rooms ?? undefined,
        hours: hours ?? undefined,
        workers: workers ?? undefined,
        massageMinutes: massageMinutes ?? undefined,
      });
    } catch (notifyError) {
      // Заказ уже в БД — не откатываем из‑за Telegram.
      console.error("[order] telegram notify failed", notifyError);
    }

    return Response.json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отправить заказ";
    return jsonError(message, 502);
  }
}
