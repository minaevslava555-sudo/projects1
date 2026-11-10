import { getSupabaseServer, supabaseEnv } from "@/lib/supabase/server";

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

/** Сохраняет заказ в projects1_orders. Требует NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. */
export async function saveOrderToSupabase(order: OrderRecord): Promise<{ id: string }> {
  if (!supabaseEnv()) {
    throw new Error(
      "Supabase не настроен: задайте NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("projects1_orders")
    .insert({
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
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Не удалось сохранить заказ: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error("Не удалось сохранить заказ");
  }

  return { id: data.id as string };
}
