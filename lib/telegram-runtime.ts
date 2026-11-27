/**
 * Telegram channel / notify gating — pure env decisions (no Bot API calls).
 *
 * Preview must never call setWebhook/deleteWebhook automatically: a Preview
 * cold-start with TOKEN_TELEGRAM would otherwise steal or rewrite the bot
 * webhook even when TELEGRAM_WEBHOOK_URL points at Production.
 *
 * Inbound webhook POST and outbound Bot sends are also denied on Preview /
 * unknown Vercel env / TELEGRAM_NOTIFY_DISABLED so a shared Production token
 * cannot drive chat history or replies from a Preview deployment.
 */

export type TelegramRuntimeEnv = {
  TOKEN_TELEGRAM?: string;
  TELEGRAM_NOTIFY_DISABLED?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
};

function readEnv(env?: TelegramRuntimeEnv): TelegramRuntimeEnv {
  // process.env is NodeJS.ProcessEnv (string index signature) — not assignable
  // to a closed optional-key object under strict excess checks.
  return env ?? (process.env as TelegramRuntimeEnv);
}

export function isTelegramNotifyDisabled(env?: TelegramRuntimeEnv): boolean {
  return readEnv(env).TELEGRAM_NOTIFY_DISABLED === "1";
}

/** On Vercel, only the Production deployment is trusted for Bot API side effects. */
function isTrustedVercelProduction(env: TelegramRuntimeEnv): boolean {
  return Boolean(env.VERCEL) && env.VERCEL_ENV === "production";
}

/**
 * True only when this process may call Telegram setWebhook.
 * Preview / unknown VERCEL_ENV are always denied — TELEGRAM_WEBHOOK_URL is not
 * a safety gate.
 */
export function shouldRegisterTelegramWebhook(env?: TelegramRuntimeEnv): boolean {
  const e = readEnv(env);
  if (isTelegramNotifyDisabled(e)) return false;
  if (!e.TOKEN_TELEGRAM?.trim()) return false;
  if (e.VERCEL) {
    return isTrustedVercelProduction(e);
  }
  return false;
}

/**
 * True when local long-polling may start (deleteWebhook + bot.start).
 * Disabled when notify is off — polling also mutates webhook state.
 */
export function shouldStartTelegramPolling(env?: TelegramRuntimeEnv): boolean {
  const e = readEnv(env);
  if (isTelegramNotifyDisabled(e)) return false;
  if (!e.TOKEN_TELEGRAM?.trim()) return false;
  if (e.VERCEL) return false;
  return true;
}

/**
 * True when this process may handle inbound Telegram webhook updates (POST)
 * or send Bot API messages (menus, replies, sendTelegramMessage).
 * Production Vercel and local (non-Vercel) are allowed; Preview / missing /
 * unknown VERCEL_ENV on Vercel are denied.
 */
export function shouldHandleTelegramUpdates(env?: TelegramRuntimeEnv): boolean {
  const e = readEnv(env);
  if (isTelegramNotifyDisabled(e)) return false;
  if (!e.TOKEN_TELEGRAM?.trim()) return false;
  if (e.VERCEL) {
    return isTrustedVercelProduction(e);
  }
  return true;
}
