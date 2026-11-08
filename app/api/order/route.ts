import { notifyAdminAboutOrder } from "@/lib/telegram-notify";

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

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const name = asTrimmedString(raw.name, 120);
  const phone = asTrimmedString(raw.phone, 40);
  const service = asTrimmedString(raw.service, 40);
  const date = asTrimmedString(raw.date, 40);
  const details = asTrimmedString(raw.details, 200);
  const priceEuro = typeof raw.priceEuro === "number" ? raw.priceEuro : Number(raw.priceEuro);
  const hours = asPositiveInt(raw.hours, 24);
  const workers = asPositiveInt(raw.workers, 12);
  const massageMinutes = asPositiveInt(raw.massageMinutes, 240);

  if (!name || !phone || !service || !SERVICES.has(service)) {
    return Response.json({ error: "Заполните имя, телефон и услугу" }, { status: 400 });
  }
  if (!Number.isFinite(priceEuro) || priceEuro <= 0 || priceEuro > 100_000) {
    return Response.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  if (service === "cleaning" || service === "repair") {
    if (!hours || !workers) {
      return Response.json({ error: "Укажите часы и число специалистов" }, { status: 400 });
    }
  }
  if (service === "massage" && !massageMinutes) {
    return Response.json({ error: "Укажите длительность сеанса" }, { status: 400 });
  }

  try {
    await notifyAdminAboutOrder({
      name,
      phone,
      service: SERVICE_TITLES[service] ?? service,
      priceEuro,
      date: date ?? undefined,
      details: details ?? undefined,
      hours: hours ?? undefined,
      workers: workers ?? undefined,
      massageMinutes: massageMinutes ?? undefined,
    });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отправить заказ";
    return Response.json({ error: message }, { status: 502 });
  }
}
