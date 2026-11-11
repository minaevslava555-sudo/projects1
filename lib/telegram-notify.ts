import type { PricingMode } from "@/lib/booking-pricing";
import { getSupabaseServer } from "@/lib/supabase/server";

const REPAIR_PHOTOS_BUCKET = "repair-order-photos";
const MAX_REPAIR_PHOTOS = 5;

const PHOTO_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$/i;

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
  /** Private storage object paths for this order only (max 5). */
  repairPhotoPaths?: string[];
  details?: string;
};

type DownloadedPhoto = {
  filename: string;
  mime: string;
  bytes: Buffer;
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

function isQuoteOrder(order: OrderNotification) {
  return order.pricingMode === "quote" || order.priceEuro == null;
}

function buildOrderMessage(order: OrderNotification) {
  const lines = [
    "🆕 Новый заказ с сайта HAVENLY",
    "────────────────",
    `🔖 Номер: ${order.orderRef}`,
    `🛎 Услуга: ${order.service}`,
  ];

  if (isQuoteOrder(order)) {
    lines.push("💶 Оценка: quote (цена после осмотра)");
    lines.push("⚠️ Quote required");
  } else {
    lines.push(`💶 Итого: ${formatPrice(order.priceEuro!)}`);
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

function buildPhotoCaption(order: OrderNotification) {
  const problem = (order.problemDescription || "").trim().replace(/\s+/g, " ");
  const lines = [
    `🔖 ${order.orderRef}`,
    "⚠️ Quote required",
  ];
  if (problem) {
    lines.push(`🛠 ${problem}`);
  }
  const text = lines.join("\n");
  // Telegram caption limit
  return text.length > 1024 ? `${text.slice(0, 1021)}...` : text;
}

function sanitizeRepairPhotoPaths(paths: string[] | undefined): string[] {
  if (!paths?.length) return [];
  const out: string[] = [];
  for (const path of paths) {
    if (typeof path !== "string" || !PHOTO_PATH_RE.test(path)) {
      throw new Error("Некорректный путь к фото ремонта");
    }
    out.push(path);
    if (out.length > MAX_REPAIR_PHOTOS) {
      throw new Error("Не более 5 фото");
    }
  }
  return out;
}

function mimeFromPath(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function filenameFromPath(path: string) {
  const base = path.split("/").pop() || "photo.jpg";
  return base.replace(/[^A-Za-z0-9._-]/g, "_");
}

async function downloadRepairPhotos(paths: string[]): Promise<DownloadedPhoto[]> {
  const supabase = getSupabaseServer();
  const photos: DownloadedPhoto[] = [];

  for (const path of paths) {
    const { data, error } = await supabase.storage
      .from(REPAIR_PHOTOS_BUCKET)
      .download(path);
    if (error || !data) {
      console.error("[telegram-notify] storage download failed");
      throw new Error("Не удалось загрузить фото ремонта для Telegram");
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    if (!buffer.length) {
      throw new Error("Пустой файл фото ремонта");
    }
    photos.push({
      filename: filenameFromPath(path),
      mime: mimeFromPath(path),
      bytes: buffer,
    });
  }

  return photos;
}

async function sendMediaGroup(
  token: string,
  chatId: string,
  photos: DownloadedPhoto[],
  caption: string,
) {
  const form = new FormData();
  form.set("chat_id", chatId);

  const media = photos.map((photo, index) => {
    const attachName = `photo${index}`;
    form.append(
      attachName,
      new Blob([new Uint8Array(photo.bytes)], { type: photo.mime }),
      photo.filename,
    );
    return {
      type: "photo" as const,
      media: `attach://${attachName}`,
      ...(index === 0 ? { caption } : {}),
    };
  });
  form.set("media", JSON.stringify(media));

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMediaGroup`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { description?: string };
      detail = payload.description ? `: ${payload.description}` : "";
    } catch {
      // ignore
    }
    throw new Error(`Не удалось отправить фото в Telegram${detail}`);
  }
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
  const messageUrl = `https://api.telegram.org/bot${token}/sendMessage`;

  for (const chatId of chatIds) {
    const response = await fetch(messageUrl, {
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

  const paths = sanitizeRepairPhotoPaths(order.repairPhotoPaths);
  if (paths.length === 0) return;

  const photos = await downloadRepairPhotos(paths);
  const caption = buildPhotoCaption(order);

  for (const chatId of chatIds) {
    await sendMediaGroup(token, chatId, photos, caption);
  }
}
