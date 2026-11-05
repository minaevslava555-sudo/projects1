import { createHash } from "crypto";
import { Bot } from "grammy";
import {
  clearChatHistory,
  getAgentConfig,
  getChatHistory,
  saveChatHistory,
} from "../lib/agent-store";
import { askAgent } from "../lib/openai-agent";

const TELEGRAM_LIMIT = 4000;

type GlobalPoll = typeof globalThis & {
  __telegramPolling?: Promise<void>;
};

export function telegramWebhookSecret(token = process.env.TOKEN_TELEGRAM ?? "") {
  return createHash("sha256").update(`telegram-webhook:${token}`).digest("hex").slice(0, 32);
}

export function publicAppUrl() {
  const explicit = process.env.TELEGRAM_WEBHOOK_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (!host) return null;
  return `https://${host.replace(/^https?:\/\//, "")}`;
}

export function createTelegramBot(token = process.env.TOKEN_TELEGRAM) {
  if (!token) throw new Error("Не задан TOKEN_TELEGRAM");

  const bot = new Bot(token);

  async function sendLongMessage(chatId: number, text: string) {
    for (let i = 0; i < text.length; i += TELEGRAM_LIMIT) {
      await bot.api.sendMessage(chatId, text.slice(i, i + TELEGRAM_LIMIT));
    }
  }

  bot.command("start", async (ctx) => {
    const config = await getAgentConfig();
    await ctx.reply(
      `Привет. Я ИИ-агент.\nМодель: ${config.model}\n\nНапиши сообщение — отвечу. /reset сбрасывает историю диалога.`,
    );
  });

  bot.command("reset", async (ctx) => {
    if (!ctx.chat) return;
    await clearChatHistory(ctx.chat.id);
    await ctx.reply("История диалога очищена.");
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) return;

    await ctx.replyWithChatAction("typing");

    try {
      const [config, history] = await Promise.all([
        getAgentConfig(),
        getChatHistory(ctx.chat.id),
      ]);
      const answer = await askAgent(config, history, text);
      const nextHistory = [
        ...history,
        { role: "user" as const, content: text },
        { role: "assistant" as const, content: answer },
      ];
      await saveChatHistory(ctx.chat.id, nextHistory);
      await sendLongMessage(ctx.chat.id, answer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось ответить";
      await ctx.reply(`Не удалось ответить: ${message}`);
    }
  });

  return bot;
}

export async function registerTelegramWebhook() {
  const token = process.env.TOKEN_TELEGRAM;
  const origin = publicAppUrl();
  if (!token || !origin) return null;

  const bot = new Bot(token);
  const url = `${origin}/api/telegram`;
  await bot.api.setWebhook(url, {
    secret_token: telegramWebhookSecret(token),
    drop_pending_updates: false,
  });
  return url;
}

export async function startTelegramPolling() {
  const bot = createTelegramBot();
  await bot.api.deleteWebhook({ drop_pending_updates: false });
  console.log("Telegram bot: long polling");
  await bot.start({
    onStart: (info) => {
      console.log(`Bot @${info.username} is running`);
    },
  });
}

export async function startTelegramChannel() {
  if (!process.env.TOKEN_TELEGRAM) return;

  if (process.env.VERCEL) {
    await registerTelegramWebhook();
    return;
  }

  const state = globalThis as GlobalPoll;
  if (!state.__telegramPolling) {
    state.__telegramPolling = startTelegramPolling().catch((error: unknown) => {
      console.error(error);
    });
  }
}
