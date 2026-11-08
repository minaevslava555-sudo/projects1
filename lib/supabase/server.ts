import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

let cached: SupabaseClient | null = null;

/** Серверный клиент с service_role. Не импортировать в клиентские компоненты. */
export function getSupabaseServer(): SupabaseClient {
  const env = supabaseEnv();
  if (!env) {
    throw new Error("Supabase не настроен");
  }
  if (!cached) {
    cached = createClient(env.url, env.serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return cached;
}
