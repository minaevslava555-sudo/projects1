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

export class OrderIdempotencyConflictError extends Error {
  readonly name = "OrderIdempotencyConflictError";

  constructor(message = "Order idempotency key already exists") {
    super(message);
  }
}

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
      pricing_config_id: order.pricingConfigId ?? null,
      pricing_version: order.pricingVersion ?? null,
      hourly_rate_snapshot: order.hourlyRateSnapshot ?? null,
      pricing_snapshot: order.pricingSnapshot ?? null,
      idempotency_key: order.idempotencyKey ?? null,
      request_fingerprint: order.requestFingerprint ?? null,
    });

    if (!error) {
      return { id, orderRef };
    }

    lastError = error.message;
    // Retry only genuine order_ref unique conflicts (23505 + named index).
    // Idempotency_key unique: typed conflict (no retry / no new order_ref).
    const conflictText = [error.message, error.details, error.hint]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join("\n");
    if (
      error.code === "23505" &&
      conflictText.includes("projects1_orders_idempotency_key_uidx")
    ) {
      throw new OrderIdempotencyConflictError();
    }
    const isOrderRefUniqueConflict =
      error.code === "23505" &&
      conflictText.includes("projects1_orders_order_ref_uidx");
    if (!isOrderRefUniqueConflict) {
      throw mapSaveError(error.message);
    }
  }

  throw mapSaveError(lastError || "unique constraint");
}

export type OrderByIdempotencyKey = {
  id: string;
  orderRef: string;
  pricingMode: "fixed" | "quote";
  priceEuro: number | null;
  requestFingerprint: string | null;
};

/** Loads an order previously saved under the given idempotency key, or null if none. */
export async function findOrderByIdempotencyKey(
  key: string,
): Promise<OrderByIdempotencyKey | null> {
  assertSupabaseServiceKey();

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("projects1_orders")
    .select("id, order_ref, pricing_mode, price_euro, request_fingerprint")
    .eq("idempotency_key", key)
    .maybeSingle();

  if (error) {
    throw mapSaveError(error.message);
  }
  if (!data) {
    return null;
  }

  const pricingMode = data.pricing_mode;
  if (pricingMode !== "fixed" && pricingMode !== "quote") {
    throw mapSaveError("Некорректный pricing_mode заказа");
  }

  const requestFingerprintRaw = data.request_fingerprint;
  if (
    requestFingerprintRaw != null &&
    typeof requestFingerprintRaw !== "string"
  ) {
    throw mapSaveError("Некорректный request_fingerprint заказа");
  }

  return {
    id: data.id,
    orderRef: data.order_ref,
    pricingMode,
    priceEuro:
      data.price_euro == null
        ? null
        : typeof data.price_euro === "number"
          ? data.price_euro
          : Number(data.price_euro),
    requestFingerprint: requestFingerprintRaw ?? null,
  };
}
