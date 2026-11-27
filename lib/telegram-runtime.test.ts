import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTelegramNotifyDisabled,
  shouldHandleTelegramUpdates,
  shouldRegisterTelegramWebhook,
  shouldStartTelegramPolling,
  type TelegramRuntimeEnv,
} from "@/lib/telegram-runtime";

function env(partial: TelegramRuntimeEnv): TelegramRuntimeEnv {
  return partial;
}

test("TELEGRAM_NOTIFY_DISABLED=1 disables notify helper", () => {
  assert.equal(isTelegramNotifyDisabled(env({})), false);
  assert.equal(
    isTelegramNotifyDisabled(env({ TELEGRAM_NOTIFY_DISABLED: "1" })),
    true,
  );
  assert.equal(
    isTelegramNotifyDisabled(env({ TELEGRAM_NOTIFY_DISABLED: "true" })),
    false,
  );
});

test("Preview never registers webhook even with TELEGRAM_WEBHOOK_URL semantics", () => {
  // Callers may set TELEGRAM_WEBHOOK_URL separately; registration gate must
  // still refuse Preview so cold-starts cannot rewrite Production webhook.
  assert.equal(
    shouldRegisterTelegramWebhook(
      env({
        TOKEN_TELEGRAM: "tok",
        VERCEL: "1",
        VERCEL_ENV: "preview",
      }),
    ),
    false,
  );
});

test("Production Vercel registers webhook when notify is enabled", () => {
  assert.equal(
    shouldRegisterTelegramWebhook(
      env({
        TOKEN_TELEGRAM: "tok",
        VERCEL: "1",
        VERCEL_ENV: "production",
      }),
    ),
    true,
  );
});

test("Production registration is blocked when TELEGRAM_NOTIFY_DISABLED=1", () => {
  assert.equal(
    shouldRegisterTelegramWebhook(
      env({
        TOKEN_TELEGRAM: "tok",
        VERCEL: "1",
        VERCEL_ENV: "production",
        TELEGRAM_NOTIFY_DISABLED: "1",
      }),
    ),
    false,
  );
});

test("Local non-Vercel does not register webhook (uses polling instead)", () => {
  assert.equal(
    shouldRegisterTelegramWebhook(
      env({
        TOKEN_TELEGRAM: "tok",
      }),
    ),
    false,
  );
  assert.equal(
    shouldStartTelegramPolling(
      env({
        TOKEN_TELEGRAM: "tok",
      }),
    ),
    true,
  );
});

test("Local polling is skipped when TELEGRAM_NOTIFY_DISABLED=1", () => {
  assert.equal(
    shouldStartTelegramPolling(
      env({
        TOKEN_TELEGRAM: "tok",
        TELEGRAM_NOTIFY_DISABLED: "1",
      }),
    ),
    false,
  );
});

test("Vercel development env does not register webhook", () => {
  assert.equal(
    shouldRegisterTelegramWebhook(
      env({
        TOKEN_TELEGRAM: "tok",
        VERCEL: "1",
        VERCEL_ENV: "development",
      }),
    ),
    false,
  );
});

test("Missing or unknown VERCEL_ENV on Vercel denies registration", () => {
  assert.equal(
    shouldRegisterTelegramWebhook(
      env({
        TOKEN_TELEGRAM: "tok",
        VERCEL: "1",
      }),
    ),
    false,
  );
  assert.equal(
    shouldRegisterTelegramWebhook(
      env({
        TOKEN_TELEGRAM: "tok",
        VERCEL: "1",
        VERCEL_ENV: "staging",
      }),
    ),
    false,
  );
  assert.equal(
    shouldRegisterTelegramWebhook(
      env({
        TOKEN_TELEGRAM: "tok",
        VERCEL: "1",
        VERCEL_ENV: "",
      }),
    ),
    false,
  );
});

test("Missing token blocks registration and polling", () => {
  assert.equal(
    shouldRegisterTelegramWebhook(
      env({ VERCEL: "1", VERCEL_ENV: "production" }),
    ),
    false,
  );
  assert.equal(shouldStartTelegramPolling(env({})), false);
});

test("shouldHandleTelegramUpdates allows Production and local only", () => {
  assert.equal(
    shouldHandleTelegramUpdates(
      env({
        TOKEN_TELEGRAM: "tok",
        VERCEL: "1",
        VERCEL_ENV: "production",
      }),
    ),
    true,
  );
  assert.equal(
    shouldHandleTelegramUpdates(env({ TOKEN_TELEGRAM: "tok" })),
    true,
  );
  assert.equal(
    shouldHandleTelegramUpdates(
      env({
        TOKEN_TELEGRAM: "tok",
        VERCEL: "1",
        VERCEL_ENV: "preview",
      }),
    ),
    false,
  );
  assert.equal(
    shouldHandleTelegramUpdates(
      env({
        TOKEN_TELEGRAM: "tok",
        VERCEL: "1",
      }),
    ),
    false,
  );
  assert.equal(
    shouldHandleTelegramUpdates(
      env({
        TOKEN_TELEGRAM: "tok",
        VERCEL: "1",
        VERCEL_ENV: "staging",
      }),
    ),
    false,
  );
  assert.equal(
    shouldHandleTelegramUpdates(
      env({
        TOKEN_TELEGRAM: "tok",
        VERCEL: "1",
        VERCEL_ENV: "production",
        TELEGRAM_NOTIFY_DISABLED: "1",
      }),
    ),
    false,
  );
});
