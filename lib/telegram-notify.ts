import { adminChatIdsFromEnv, sendTelegramMessage } from "@/bot/telegram";

export type OrderNotification = {
  name: string;
  phone: string;
  service: string;
  priceEuro: number;
  date?: string;
  hours?: number;
  workers?: number;
  massageMinutes?: number;
  details?: string;
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function buildOrderMessage(order: OrderNotification) {
  const lines = [
    "🆕 Новый заказ с сайта HAVENLY",
    "────────────────",
    `🛎 Услуга: ${order.service}`,
    `💶 Итого: ${formatPrice(order.priceEuro)}`,
  ];

  if (typeof order.hours === "number") {
    lines.push(`⏱ Часы: ${order.hours}`);
  }
  if (typeof order.workers === "number") {
    lines.push(`👥 Специалисты: ${order.workers}`);
  }
  if (typeof order.massageMinutes === "number") {
    lines.push(`🧘 Длительность: ${order.massageMinutes} мин`);
  }
  if (order.details) {
    lines.push(`📋 Расчёт: ${order.details}`);
  }

  lines.push(
    "────────────────",
    `👤 Имя: ${order.name}`,
    `📞 Телефон: ${order.phone}`,
  );
  if (order.date) {
    lines.push(`📅 Дата: ${order.date}`);
  }

  return lines.join("\n");
}

export async function notifyAdminAboutOrder(order: OrderNotification) {
  const chatIds = adminChatIdsFromEnv();
  if (!chatIds.length) {
    throw new Error("Не задан TELEGRAM_ADMIN_CHAT_ID");
  }

  const text = buildOrderMessage(order);
  for (const chatId of chatIds) {
    await sendTelegramMessage(chatId, text);
  }
}
