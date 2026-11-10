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

function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

/**
 * Локальная проверка формата серверного ключа (без вывода секрета).
 * Поддерживает legacy JWT service_role и новый sb_secret_...
 * Подлинность ключа подтверждает только ответ Supabase при запросе.
 */
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

  const key = env.serviceKey;

  if (key.startsWith("sb_publishable_")) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY не должен быть publishable-ключом. Используйте sb_secret_... или legacy service_role",
    );
  }

  if (key.startsWith("sb_secret_")) {
    // Только формат. Подлинность проверяет Supabase при запросе.
    if (key.length < 20 || /\s/.test(key)) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY (sb_secret) имеет неверный формат. Обновите переменную на Vercel",
      );
    }
    return env;
  }

  if (!looksLikeJwt(key)) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY должен быть sb_secret_... или legacy JWT service_role. Обновите переменную на Vercel",
    );
  }

  const role = jwtRole(key);
  if (role === "anon") {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY содержит anon-ключ. Нужен service_role или sb_secret_...",
    );
  }
  if (role !== "service_role") {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY должен быть JWT с role=service_role или ключом sb_secret_...",
    );
  }

  return env;
}

let cached: SupabaseClient | null = null;

/** Серверный клиент с service_role / sb_secret. Не импортировать в клиентские компоненты. */
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
