import { randomUUID } from "crypto";
import { assertSupabaseServiceKey, getSupabaseServer } from "@/lib/supabase/server";

export type OrderRecord = {
  name: string;
  phone: string;
  service: "cleaning" | "repair" | "massage";
  priceEuro: number;
  date?: string;
  details?: string;
  rooms?: number;
  hours?: number;
  workers?: number;
  massageMinutes?: number;
};

function parseServiceDate(value?: string): string | null {
  if (!value) return null;
  // input type="date" → YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function mapSaveError(message: string): Error {
  const lower = message.toLowerCase();
  if (lower.includes("invalid api key") || lower.includes("jwt")) {
    return new Error(
      "Ошибка ключа Supabase на сервере. Проверьте SUPABASE_SERVICE_ROLE_KEY в настройках Vercel",
    );
  }
  if (lower.includes("could not find the table") || lower.includes("pgrst205")) {
    return new Error("Таблица projects1_orders не найдена в Supabase");
  }
  return new Error(`Не удалось сохранить заказ: ${message}`);
}

/** Сохраняет заказ в projects1_orders. Требует NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. */
export async function saveOrderToSupabase(order: OrderRecord): Promise<{ id: string }> {
  assertSupabaseServiceKey();

  const id = randomUUID();
  const supabase = getSupabaseServer();
  const { error } = await supabase.from("projects1_orders").insert({
    id,
    name: order.name,
    phone: order.phone,
    service: order.service,
    price_euro: order.priceEuro,
    service_date: parseServiceDate(order.date),
    details: order.details ?? null,
    rooms: order.rooms ?? null,
    hours: order.hours ?? null,
    workers: order.workers ?? null,
    massage_minutes: order.massageMinutes ?? null,
    status: "new",
  });

  if (error) {
    throw mapSaveError(error.message);
  }

  return { id };
}
