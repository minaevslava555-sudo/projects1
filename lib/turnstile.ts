/**
 * Cloudflare Turnstile server verification.
 * Local/dev without secret: uses Cloudflare always-pass test secret.
 * On Vercel: TURNSTILE_SECRET_KEY is required.
 */

const TEST_SECRET = "1x0000000000000000000000000000000AA";

function turnstileSecret(): string | null {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (secret) return secret;
  if (process.env.VERCEL === "1") return null;
  return TEST_SECRET;
}

export function turnstileSiteKey(): string | null {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  if (key) return key;
  if (process.env.VERCEL === "1") return null;
  // Cloudflare always-pass test site key for local UI
  return "1x00000000000000000000AA";
}

export async function verifyTurnstileToken(
  token: string | null | undefined,
  ip?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const secret = turnstileSecret();
  if (!secret) {
    return { ok: false, error: "Turnstile не настроен на сервере" };
  }
  if (!token || typeof token !== "string" || token.length < 10 || token.length > 4096) {
    return { ok: false, error: "Подтвердите, что вы не робот" };
  }

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (ip && ip !== "unknown") body.set("remoteip", ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    return { ok: false, error: "Не удалось проверить Turnstile" };
  }

  const data = (await response.json()) as { success?: boolean };
  if (!data.success) {
    return { ok: false, error: "Проверка Turnstile не пройдена" };
  }
  return { ok: true };
}
