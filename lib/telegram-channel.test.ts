import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  registerTelegramWebhook,
  sendTelegramMessage,
  setTelegramFetchForTests,
  startTelegramChannel,
  startTelegramPolling,
} from "@/bot/telegram";
import { GET, POST } from "@/app/api/telegram/route";

const ENV_KEYS = [
  "TOKEN_TELEGRAM",
  "TELEGRAM_NOTIFY_DISABLED",
  "TELEGRAM_WEBHOOK_URL",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

function snapshotEnv(): Record<EnvKey, string | undefined> {
  const out = {} as Record<EnvKey, string | undefined>;
  for (const key of ENV_KEYS) {
    out[key] = process.env[key];
  }
  return out;
}

function restoreEnv(snapshot: Record<EnvKey, string | undefined>) {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

function installTelegramFetchProbe() {
  const calls: string[] = [];
  setTelegramFetchForTests(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("setWebhook") || url.includes("deleteWebhook")) {
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("sendMessage")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 1,
            chat: { id: 1, type: "private" },
            date: 0,
            text: "x",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ ok: true, result: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return {
    calls,
    restore() {
      setTelegramFetchForTests(undefined);
    },
  };
}

function clearPollingState() {
  const state = globalThis as typeof globalThis & {
    __telegramPolling?: Promise<void>;
  };
  delete state.__telegramPolling;
}

afterEach(() => {
  clearPollingState();
  setTelegramFetchForTests(undefined);
});

test("registerTelegramWebhook: Preview never calls Telegram API", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-preview";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    process.env.TELEGRAM_WEBHOOK_URL = "https://prod.example";

    const url = await registerTelegramWebhook();
    assert.equal(url, null);
    assert.equal(probe.calls.length, 0);
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("registerTelegramWebhook: missing VERCEL_ENV on Vercel never calls Telegram API", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-unknown";
    process.env.VERCEL = "1";
    process.env.TELEGRAM_WEBHOOK_URL = "https://prod.example";

    const url = await registerTelegramWebhook();
    assert.equal(url, null);
    assert.equal(probe.calls.length, 0);
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("registerTelegramWebhook: Production calls setWebhook via stubbed fetch", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-prod";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.TELEGRAM_WEBHOOK_URL = "https://havenly.example";

    const url = await registerTelegramWebhook();
    assert.equal(url, "https://havenly.example/api/telegram");
    assert.ok(probe.calls.some((u) => u.includes("/setWebhook")));
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("registerTelegramWebhook: TELEGRAM_NOTIFY_DISABLED=1 skips setWebhook", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-prod";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.TELEGRAM_WEBHOOK_URL = "https://havenly.example";
    process.env.TELEGRAM_NOTIFY_DISABLED = "1";

    const url = await registerTelegramWebhook();
    assert.equal(url, null);
    assert.equal(probe.calls.length, 0);
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("startTelegramPolling: Vercel Preview never calls deleteWebhook", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-preview";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";

    let runBotCalls = 0;
    await startTelegramPolling({
      runBot: async () => {
        runBotCalls += 1;
      },
    });
    assert.equal(runBotCalls, 0);
    assert.equal(probe.calls.length, 0);
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("startTelegramPolling: local with stub runBot reaches Bot after gate", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-local";

    let runBotCalls = 0;
    await startTelegramPolling({
      runBot: async (bot) => {
        runBotCalls += 1;
        await bot.api.deleteWebhook({ drop_pending_updates: false });
      },
    });
    assert.equal(runBotCalls, 1);
    assert.ok(probe.calls.some((u) => u.includes("/deleteWebhook")));
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("startTelegramPolling: TELEGRAM_NOTIFY_DISABLED=1 skips polling", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-local";
    process.env.TELEGRAM_NOTIFY_DISABLED = "1";

    let runBotCalls = 0;
    await startTelegramPolling({
      runBot: async () => {
        runBotCalls += 1;
      },
    });
    assert.equal(runBotCalls, 0);
    assert.equal(probe.calls.length, 0);
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("startTelegramChannel: Preview does not register or poll", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-preview";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    process.env.TELEGRAM_WEBHOOK_URL = "https://prod.example";

    await startTelegramChannel({
      runBot: async () => {
        throw new Error("polling must not start on Preview");
      },
    });
    assert.equal(probe.calls.length, 0);
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("startTelegramChannel: Production registers webhook via stub", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-prod";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.TELEGRAM_WEBHOOK_URL = "https://havenly.example";

    await startTelegramChannel({
      runBot: async () => {
        throw new Error("polling must not start on Production Vercel");
      },
    });
    assert.ok(probe.calls.some((u) => u.includes("/setWebhook")));
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("startTelegramChannel: local uses polling seam without hanging", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-local";

    let runBotCalls = 0;
    await startTelegramChannel({
      runBot: async () => {
        runBotCalls += 1;
      },
    });
    const state = globalThis as typeof globalThis & {
      __telegramPolling?: Promise<void>;
    };
    assert.ok(state.__telegramPolling);
    await state.__telegramPolling;
    assert.equal(runBotCalls, 1);
    assert.equal(probe.calls.length, 0);
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("GET /api/telegram: Preview returns 500 without Telegram API", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-preview";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    process.env.TELEGRAM_WEBHOOK_URL = "https://prod.example";

    const res = await GET();
    assert.equal(res.status, 500);
    assert.equal(probe.calls.length, 0);
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("GET /api/telegram: Production registers via stubbed setWebhook", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-prod";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.TELEGRAM_WEBHOOK_URL = "https://havenly.example";

    const res = await GET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok?: boolean; url?: string };
    assert.equal(body.ok, true);
    assert.equal(body.url, "https://havenly.example/api/telegram");
    assert.ok(probe.calls.some((u) => u.includes("/setWebhook")));
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("POST /api/telegram: Preview returns 503 before Bot/handler", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-preview";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";

    const res = await POST(new Request("http://localhost/api/telegram", { method: "POST", body: "{}" }));
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? "", /отключён/);
    assert.equal(probe.calls.length, 0);
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("POST /api/telegram: unknown VERCEL_ENV on Vercel returns 503", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-unknown";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "staging";

    const res = await POST(new Request("http://localhost/api/telegram", { method: "POST", body: "{}" }));
    assert.equal(res.status, 503);
    assert.equal(probe.calls.length, 0);
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("POST /api/telegram: TELEGRAM_NOTIFY_DISABLED=1 returns 503 on Production", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-prod";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.TELEGRAM_NOTIFY_DISABLED = "1";

    const res = await POST(new Request("http://localhost/api/telegram", { method: "POST", body: "{}" }));
    assert.equal(res.status, 503);
    assert.equal(probe.calls.length, 0);
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("POST /api/telegram: Production passes gate (not 503 isolation response)", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-prod-post";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";

    const res = await POST(
      new Request("http://localhost/api/telegram", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
    );
    // Gate opened: may be auth/validation failure from grammy, but not our 503.
    assert.notEqual(res.status, 503);
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("sendTelegramMessage: Preview and disabled skip Telegram HTTP", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-preview";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    await sendTelegramMessage(1, "hello");
    assert.equal(probe.calls.length, 0);

    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-prod";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.TELEGRAM_NOTIFY_DISABLED = "1";
    await sendTelegramMessage(1, "hello");
    assert.equal(probe.calls.length, 0);
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("sendTelegramMessage: Production sends via stubbed fetch", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-prod";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";

    await sendTelegramMessage(42, "hello");
    assert.ok(probe.calls.some((u) => u.includes("/sendMessage")));
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});

test("sendTelegramMessage: local non-Vercel sends via stubbed fetch", async () => {
  const snap = snapshotEnv();
  const probe = installTelegramFetchProbe();
  try {
    clearEnv();
    process.env.TOKEN_TELEGRAM = "tok-local";

    await sendTelegramMessage(42, "hello");
    assert.ok(probe.calls.some((u) => u.includes("/sendMessage")));
  } finally {
    probe.restore();
    restoreEnv(snap);
  }
});
