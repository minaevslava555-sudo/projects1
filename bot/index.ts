import { config as loadEnv } from "dotenv";
import { Bot } from "grammy";
import {
  clearChatHistory,
  getAgentConfig,
  getChatHistory,
  saveChatHistory,
} from "../lib/agent-store";
import { askAgent } from "../lib/openai-agent";

loadEnv({ path: ".env.local" });

const token = process.env.TOKEN_TELEGRAM;
if (!token) {
  throw new Error("Не задан TOKEN_TELEGRAM в .env.local");
}

const bot = new Bot(token);
const TELEGRAM_LIMIT = 4000;

async function sendLongMessage(chatId: number, text: string) {
  for (let i = 0; i < text.length; i += TELEGRAM_LIMIT) {
    await bot.api.sendMessage(chatId, text.slice(i, i + TELEGRAM_LIMIT));
  }
}

bot.command("start", async (ctx) => {
  const config = await getAgentConfig();
  await ctx.reply(
    `Привет. Я локальный ИИ-агент.\nМодель: ${config.model}\n\nНапиши сообщение — отвечу. /reset сбрасывает историю диалога.`,
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
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    await ctx.reply(`Не удалось ответить: ${message}`);
  }
});

async function main() {
  await bot.api.deleteWebhook({ drop_pending_updates: false });
  console.log("Telegram bot: long polling");
  await bot.start({
    onStart: (info) => {
      console.log(`Bot @${info.username} is running`);
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
