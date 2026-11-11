import type { PricingMode } from "@/lib/booking-pricing";

export type OrderNotification = {
  name: string;
  phone: string;
  service: string;
  pricingMode: PricingMode;
  priceEuro: number | null;
  orderRef: string;
  date?: string;
  preferredTime?: string;
  streetAddress?: string;
  city?: string;
  apartmentFloor?: string;
  accessInstructions?: string;
  rooms?: number;
  hours?: number;
  workers?: number;
  massageMinutes?: number;
  massageCategory?: string;
  problemDescription?: string;
  repairPhotoCount?: number;
  details?: string;
};

function adminChatIdsFromEnv() {
  const raw = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() ?? "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

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
    `🔖 Номер: ${order.orderRef}`,
    `🛎 Услуга: ${order.service}`,
  ];

  if (order.pricingMode === "quote" || order.priceEuro == null) {
    lines.push("💶 Оценка: quote (цена после осмотра)");
  } else {
    lines.push(`💶 Итого: ${formatPrice(order.priceEuro)}`);
  }

  if (typeof order.rooms === "number") {
    lines.push(`🏠 Комнаты: ${order.rooms}`);
  }
  if (typeof order.hours === "number") {
    lines.push(`⏱ Часы: ${order.hours}`);
  }
  if (typeof order.workers === "number") {
    lines.push(`👥 Специалисты: ${order.workers}`);
  }
  if (typeof order.massageMinutes === "number") {
    lines.push(`🧘 Длительность: ${order.massageMinutes} мин`);
  }
  if (order.massageCategory) {
    lines.push(`🧴 Тип массажа: ${order.massageCategory}`);
  }
  if (order.problemDescription) {
    lines.push(`🛠 Проблема: ${order.problemDescription}`);
  }
  if (typeof order.repairPhotoCount === "number" && order.repairPhotoCount > 0) {
    lines.push(`📷 Фото ремонта: ${order.repairPhotoCount}`);
  }
  if (order.details) {
    lines.push(`📋 Расчёт: ${order.details}`);
  }

  lines.push("────────────────", `👤 Имя: ${order.name}`, `📞 Телефон: ${order.phone}`);
  if (order.date) {
    lines.push(`📅 Дата: ${order.date}`);
  }
  if (order.preferredTime) {
    lines.push(`🕒 Время: ${order.preferredTime}`);
  }
  if (order.streetAddress || order.city) {
    const address = [order.streetAddress, order.apartmentFloor, order.city]
      .filter(Boolean)
      .join(", ");
    lines.push(`📍 Адрес: ${address}`);
  }
  if (order.accessInstructions) {
    lines.push(`🔑 Доступ: ${order.accessInstructions}`);
  }

  return lines.join("\n");
}

/** Лёгкая отправка без импорта bot/ — безопаснее для Vercel serverless. */
export async function notifyAdminAboutOrder(order: OrderNotification) {
  const token = process.env.TOKEN_TELEGRAM?.trim();
  const chatIds = adminChatIdsFromEnv();

  if (!token) {
    throw new Error("Не задан TOKEN_TELEGRAM");
  }
  if (!chatIds.length) {
    throw new Error("Не задан TELEGRAM_ADMIN_CHAT_ID");
  }

  const text = buildOrderMessage(order);
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  for (const chatId of chatIds) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      let detail = "";
      try {
        const payload = (await response.json()) as { description?: string };
        detail = payload.description ? `: ${payload.description}` : "";
      } catch {
        // ignore non-JSON telegram errors
      }
      throw new Error(`Не удалось отправить уведомление${detail}`);
    }
  }
}
