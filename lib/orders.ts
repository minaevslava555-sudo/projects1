import { randomUUID } from "crypto";
import { assertSupabaseServiceKey, getSupabaseServer } from "@/lib/supabase/server";
import type { OrderRecord } from "@/lib/booking-types";
import { generateOrderRef } from "@/lib/order-ref";

function parseServiceDate(value: string): string | null {
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
  if (lower.includes("duplicate") || lower.includes("unique")) {
    return new Error("Не удалось создать номер заказа. Попробуйте ещё раз");
  }
  return new Error(`Не удалось сохранить заказ: ${message}`);
}

export type SavedOrder = { id: string; orderRef: string };

/** Сохраняет заказ в projects1_orders. Требует NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. */
export async function saveOrderToSupabase(order: OrderRecord): Promise<SavedOrder> {
  assertSupabaseServiceKey();

  const serviceDate = parseServiceDate(order.date);
  if (!serviceDate) {
    throw new Error("Некорректная дата");
  }

  const supabase = getSupabaseServer();
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const orderRef = attempt === 0 ? order.orderRef : generateOrderRef();
    const id = randomUUID();

    const { error } = await supabase.from("projects1_orders").insert({
      id,
      name: order.name,
      phone: order.phone,
      service: order.service,
      price_euro: order.priceEuro,
      pricing_mode: order.pricingMode,
      service_date: serviceDate,
      preferred_time: order.preferredTime,
      street_address: order.streetAddress,
      city: order.city,
      apartment_floor: order.apartmentFloor ?? null,
      access_instructions: order.accessInstructions ?? null,
      details: order.details ?? null,
      rooms: order.rooms ?? null,
      hours: order.hours ?? null,
      workers: order.workers ?? null,
      massage_minutes: order.massageMinutes ?? null,
      massage_category: order.massageCategory ?? null,
      problem_description: order.problemDescription ?? null,
      repair_photo_paths: order.repairPhotoPaths?.length
        ? order.repairPhotoPaths
        : null,
      order_ref: orderRef,
      status: "new",
    });

    if (!error) {
      return { id, orderRef };
    }

    lastError = error.message;
    const lower = error.message.toLowerCase();
    if (!lower.includes("duplicate") && !lower.includes("unique")) {
      throw mapSaveError(error.message);
    }
  }

  throw mapSaveError(lastError || "unique constraint");
}
