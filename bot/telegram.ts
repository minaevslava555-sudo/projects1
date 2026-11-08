import { createHash } from "crypto";
import { Bot } from "grammy";
import {
  clearChatHistory,
  getAgentConfig,
  getChatHistory,
  saveChatHistory,
} from "../lib/agent-store";
import { askAgent } from "../lib/openai-agent";
import {
  clearEphemeralMessages,
  showAskMenu,
  showHomeMenu,
  showServiceMenu,
  trackEphemeralMessages,
} from "./menu";

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

export function adminChatIdsFromEnv() {
  const raw = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() ?? "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/** Отправка текста через того же бота (TOKEN_TELEGRAM → bot.api.sendMessage). */
export async function sendTelegramMessage(chatId: number | string, text: string) {
  const token = process.env.TOKEN_TELEGRAM?.trim();
  if (!token) throw new Error("Не задан TOKEN_TELEGRAM");
  const bot = new Bot(token);
  await bot.api.sendMessage(chatId, text, {
    link_preview_options: { is_disabled: true },
  });
}

export function createTelegramBot(token = process.env.TOKEN_TELEGRAM) {
  if (!token) throw new Error("Не задан TOKEN_TELEGRAM");

  const bot = new Bot(token);

  async function sendEphemeral(chatId: number, text: string) {
    const ids: number[] = [];
    for (let i = 0; i < text.length; i += TELEGRAM_LIMIT) {
      const sent = await bot.api.sendMessage(chatId, text.slice(i, i + TELEGRAM_LIMIT));
      ids.push(sent.message_id);
    }
    await trackEphemeralMessages(chatId, ids);
  }

  bot.command("start", async (ctx) => {
    if (!ctx.chat) return;
    await showHomeMenu(bot.api, ctx.chat.id);
  });

  bot.command("myid", async (ctx) => {
    if (!ctx.chat) return;
    await ctx.reply(
      `Ваш chat id: ${ctx.chat.id}\nДобавьте его в TELEGRAM_ADMIN_CHAT_ID для уведомлений о заказах.`,
    );
  });

  bot.command("reset", async (ctx) => {
    if (!ctx.chat) return;
    await clearChatHistory(ctx.chat.id);
    await clearEphemeralMessages(bot.api, ctx.chat.id);
    await showHomeMenu(bot.api, ctx.chat.id);
  });

  bot.on("callback_query:data", async (ctx) => {
    const chatId = ctx.chat?.id;
    const data = ctx.callbackQuery.data;
    if (!chatId || !data) {
      await ctx.answerCallbackQuery();
      return;
    }

    try {
      if (data === "m:home") {
        await showHomeMenu(bot.api, chatId);
        await ctx.answerCallbackQuery();
        return;
      }

      if (data === "m:reset") {
        await clearChatHistory(chatId);
        await showHomeMenu(bot.api, chatId);
        await ctx.answerCallbackQuery({ text: "Диалог сброшен" });
        return;
      }

      if (data === "m:ask") {
        await showAskMenu(bot.api, chatId);
        await ctx.answerCallbackQuery();
        return;
      }

      if (data.startsWith("m:ask:")) {
        const slug = data.slice("m:ask:".length);
        await showAskMenu(bot.api, chatId, slug);
        await ctx.answerCallbackQuery();
        return;
      }

      if (data.startsWith("m:svc:")) {
        const slug = data.slice("m:svc:".length);
        await showServiceMenu(bot.api, chatId, slug);
        await ctx.answerCallbackQuery();
        return;
      }

      await ctx.answerCallbackQuery({ text: "Неизвестный пункт" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ошибка меню";
      await ctx.answerCallbackQuery({ text: message.slice(0, 180) });
    }
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
      await clearEphemeralMessages(bot.api, ctx.chat.id);
      await sendEphemeral(ctx.chat.id, answer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось ответить";
      await clearEphemeralMessages(bot.api, ctx.chat.id);
      await sendEphemeral(ctx.chat.id, `Не удалось ответить: ${message}`);
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
