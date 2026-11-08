import { InlineKeyboard, type Context } from "grammy";
import { listActiveServices, type ServiceItem } from "../lib/agent-store/services";
import { getBotUiState, saveBotUiState } from "../lib/bot-ui-store";

export type MenuView = "home" | "service" | "ask";

function homeKeyboard(services: ServiceItem[]) {
  const keyboard = new InlineKeyboard();
  for (const service of services) {
    keyboard.text(service.title, `m:svc:${service.slug}`).row();
  }
  keyboard.text("Спросить консультанта", "m:ask").row();
  keyboard.text("Сбросить диалог", "m:reset");
  return keyboard;
}

function serviceKeyboard(slug: string) {
  return new InlineKeyboard()
    .text("Спросить по этой услуге", `m:ask:${slug}`)
    .row()
    .text("« Назад", "m:home");
}

function askKeyboard(slug?: string) {
  const keyboard = new InlineKeyboard();
  if (slug) {
    keyboard.text("« К услуге", `m:svc:${slug}`).row();
  }
  keyboard.text("« В меню", "m:home");
  return keyboard;
}

export async function buildHomeMenu() {
  const services = await listActiveServices();
  const lines = [
    "Добро пожаловать.",
    "Выберите услугу — сообщение меню обновится. Ответы консультанта появляются ниже и удаляются при следующем выборе в меню.",
    "",
    "Услуги:",
    ...services.map((service) => `• ${service.title} — ${service.priceNote}`),
  ];
  return {
    text: lines.join("\n"),
    keyboard: homeKeyboard(services),
  };
}

export async function buildServiceMenu(slug: string) {
  const services = await listActiveServices();
  const service = services.find((item) => item.slug === slug);
  if (!service) return buildHomeMenu();
  const text = [
    service.title,
    "",
    service.description,
    "",
    `Цена: ${service.priceNote}`,
  ].join("\n");
  return {
    text,
    keyboard: serviceKeyboard(service.slug),
  };
}

export async function buildAskMenu(slug?: string) {
  const services = await listActiveServices();
  const service = slug ? services.find((item) => item.slug === slug) : null;
  const text = service
    ? `Напишите вопрос по услуге «${service.title}».\nОтвет появится ниже меню и будет удалён при следующем клике по меню.`
    : "Напишите вопрос консультанту.\nОтвет появится ниже меню и будет удалён при следующем клике по меню.";
  return {
    text,
    keyboard: askKeyboard(service?.slug),
  };
}

export async function clearEphemeralMessages(
  api: Context["api"],
  chatId: number,
): Promise<void> {
  const state = await getBotUiState(chatId);
  if (!state.ephemeralIds.length) return;

  await Promise.all(
    state.ephemeralIds.map(async (messageId) => {
      try {
        await api.deleteMessage(chatId, messageId);
      } catch {
        // сообщение уже удалено или слишком старое
      }
    }),
  );

  await saveBotUiState(chatId, { ...state, ephemeralIds: [] });
}

export async function trackEphemeralMessages(
  chatId: number,
  messageIds: number[],
): Promise<void> {
  if (!messageIds.length) return;
  const state = await getBotUiState(chatId);
  const ephemeralIds = [...state.ephemeralIds, ...messageIds].slice(-30);
  await saveBotUiState(chatId, { ...state, ephemeralIds });
}

export async function renderMenu(
  api: Context["api"],
  chatId: number,
  text: string,
  keyboard: InlineKeyboard,
): Promise<number> {
  const state = await getBotUiState(chatId);

  if (state.menuMessageId) {
    try {
      await api.editMessageText(chatId, state.menuMessageId, text, {
        reply_markup: keyboard,
      });
      return state.menuMessageId;
    } catch (error) {
      const description =
        error && typeof error === "object" && "description" in error
          ? String((error as { description?: string }).description ?? "")
          : "";
      // Telegram: "message is not modified" — считаем успехом
      if (description.includes("message is not modified")) {
        return state.menuMessageId;
      }
    }
  }

  const sent = await api.sendMessage(chatId, text, { reply_markup: keyboard });
  await saveBotUiState(chatId, {
    menuMessageId: sent.message_id,
    ephemeralIds: state.ephemeralIds,
  });
  return sent.message_id;
}

export async function showHomeMenu(api: Context["api"], chatId: number) {
  await clearEphemeralMessages(api, chatId);
  const menu = await buildHomeMenu();
  await renderMenu(api, chatId, menu.text, menu.keyboard);
}

export async function showServiceMenu(api: Context["api"], chatId: number, slug: string) {
  await clearEphemeralMessages(api, chatId);
  const menu = await buildServiceMenu(slug);
  await renderMenu(api, chatId, menu.text, menu.keyboard);
}

export async function showAskMenu(api: Context["api"], chatId: number, slug?: string) {
  await clearEphemeralMessages(api, chatId);
  const menu = await buildAskMenu(slug);
  await renderMenu(api, chatId, menu.text, menu.keyboard);
}
