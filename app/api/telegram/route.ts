import { createTelegramBot, registerTelegramWebhook, telegramWebhookSecret } from "@/bot/telegram";
import { shouldHandleTelegramUpdates } from "@/lib/telegram-runtime";
import { webhookCallback } from "grammy";

export const runtime = "nodejs";
export const maxDuration = 60;

let handlePost: ((request: Request) => Promise<Response>) | undefined;

function telegramHandler() {
  const token = process.env.TOKEN_TELEGRAM;
  if (!token) return null;
  if (!handlePost) {
    handlePost = webhookCallback(createTelegramBot(token), "std/http", {
      secretToken: telegramWebhookSecret(token),
      timeoutMilliseconds: 55_000,
    });
  }
  return handlePost;
}

export async function GET() {
  try {
    const url = await registerTelegramWebhook();
    if (!url) {
      return Response.json({ error: "Не задан TOKEN_TELEGRAM или публичный URL" }, { status: 500 });
    }
    return Response.json({ ok: true, url });
  } catch {
    return Response.json({ error: "Не удалось включить Telegram-бот" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  // Refuse before createTelegramBot / webhookCallback — no commands, history, or Bot API.
  if (!shouldHandleTelegramUpdates()) {
    return Response.json({ error: "Telegram webhook отключён" }, { status: 503 });
  }

  const handler = telegramHandler();
  if (!handler) {
    return Response.json({ error: "Не задан TOKEN_TELEGRAM" }, { status: 500 });
  }
  try {
    return await handler(request);
  } catch {
    return Response.json({ error: "Не удалось обработать сообщение" }, { status: 500 });
  }
}
