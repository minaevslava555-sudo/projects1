import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function jwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const data = JSON.parse(json) as { role?: string };
    return typeof data.role === "string" ? data.role : null;
  } catch {
    return null;
  }
}

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

/** Проверка, что service key реально service_role (без вывода секрета). */
export function assertSupabaseServiceKey() {
  const env = supabaseEnv();
  if (!env) {
    throw new Error(
      "Supabase не настроен: задайте NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY на сервере",
    );
  }

  try {
    const host = new URL(env.url).host;
    if (!host.endsWith(".supabase.co")) {
      throw new Error("Некорректный NEXT_PUBLIC_SUPABASE_URL");
    }
  } catch {
    throw new Error("Некорректный NEXT_PUBLIC_SUPABASE_URL");
  }

  const role = jwtRole(env.serviceKey);
  if (role && role !== "service_role") {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY должен быть ключом service_role. Обновите переменную на Vercel",
    );
  }
  if (!env.serviceKey.includes(".") || env.serviceKey.length < 80) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY выглядит повреждённым. Обновите переменную на Vercel",
    );
  }

  return env;
}

let cached: SupabaseClient | null = null;

/** Серверный клиент с service_role. Не импортировать в клиентские компоненты. */
export function getSupabaseServer(): SupabaseClient {
  const env = assertSupabaseServiceKey();
  if (!cached) {
    cached = createClient(env.url.replace(/\/$/, ""), env.serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return cached;
}
