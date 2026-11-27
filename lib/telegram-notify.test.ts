import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOrderMessage, type OrderNotification } from "./telegram-notify";

const baseOrder: OrderNotification = {
  name: "Test User",
  phone: "+351900000000",
  service: "Massage / Массаж",
  pricingMode: "fixed",
  priceEuro: 90,
  orderRef: "HV-MW01",
  date: "2026-12-01",
  preferredTime: "10:00",
  streetAddress: "Rua Test 1",
  city: "Lisboa",
};

test("legacy massage telegram keeps minutes/category/details format", () => {
  const text = buildOrderMessage({
    ...baseOrder,
    priceEuro: 45,
    massageMinutes: 60,
    massageCategory: "Relaxing Massage",
    details: "Relaxing Massage · 60 min session",
  });

  assert.match(text, /💶 Итого:/);
  assert.match(text, /🧘 Длительность: 60 мин/);
  assert.match(text, /🧴 Тип массажа: Relaxing Massage/);
  assert.match(text, /📋 Расчёт: Relaxing Massage · 60 min session/);
  assert.doesNotMatch(text, /Общая длительность визита/);
  assert.doesNotMatch(text, /Базовая длительность/);
});

test("Massage v1 telegram uses pricing snapshot for tariff, durations, equipment and total", () => {
  const text = buildOrderMessage({
    ...baseOrder,
    // Column semantics unchanged: base minutes may still be passed.
    massageMinutes: 60,
    massageCategory: "relaxing-60",
    details: "should not appear for v1",
    pricingSnapshot: {
      service: "massage",
      massageVersion: "v1",
      catalogVersion: "v1",
      quoteRevision: "2026-11-25-mw-v1",
      tariffId: "relaxing-60",
      baseDurationMin: 60,
      basePriceCents: 7000,
      equipment: [
        {
          id: "foot-system",
          priceCents: 2000,
          extraBookingMin: 30,
          included: false,
        },
      ],
      includedEquipment: [],
      totalSessionMinutes: 90,
      priceCents: 9000,
      priceEuro: 90,
    },
  });

  assert.match(text, /🧴 Тариф: relaxing-60/);
  assert.match(text, /🧘 Базовая длительность: 60 мин/);
  assert.match(text, /🧴 Доп\. оборудование: foot-system/);
  assert.match(text, /⏱ Общая длительность визита: 90 мин/);
  assert.match(text, /💶 Итого:/);
  assert.match(text, /90/);
  assert.doesNotMatch(text, /Тип массажа/);
  assert.doesNotMatch(text, /Длительность: 60 мин/);
  assert.doesNotMatch(text, /should not appear for v1/);
  assert.doesNotMatch(text, /Включено \(Premium Wellness\)/);
});

test("Massage v1 Premium telegram lists included equipment without extras", () => {
  const text = buildOrderMessage({
    ...baseOrder,
    priceEuro: 120,
    massageMinutes: 120,
    massageCategory: "premium-wellness-120",
    pricingSnapshot: {
      service: "massage",
      massageVersion: "v1",
      tariffId: "premium-wellness-120",
      baseDurationMin: 120,
      basePriceCents: 12000,
      equipment: [],
      includedEquipment: [
        "foot-system",
        "eye-system",
        "moxi",
        "top-relax",
      ],
      totalSessionMinutes: 120,
      priceCents: 12000,
      priceEuro: 120,
    },
  });

  assert.match(text, /🧴 Тариф: premium-wellness-120/);
  assert.match(text, /🧘 Базовая длительность: 120 мин/);
  assert.match(
    text,
    /✨ Включено \(Premium Wellness\): foot-system, eye-system, moxi, top-relax/,
  );
  assert.match(text, /⏱ Общая длительность визита: 120 мин/);
  assert.doesNotMatch(text, /Доп\. оборудование/);
});

test("Massage v1 total prefers snapshot priceEuro over order.priceEuro", () => {
  const text = buildOrderMessage({
    ...baseOrder,
    priceEuro: 1,
    pricingSnapshot: {
      massageVersion: "v1",
      tariffId: "sports-60",
      baseDurationMin: 60,
      totalSessionMinutes: 60,
      priceEuro: 80,
      equipment: [],
      includedEquipment: [],
    },
  });

  assert.match(text, /🧴 Тариф: sports-60/);
  assert.match(text, /80/);
  assert.doesNotMatch(text, /Итого:.*1[,.]00/);
});

test("cleaning telegram format unchanged", () => {
  const text = buildOrderMessage({
    name: "Test User",
    phone: "+351900000000",
    service: "Cleaning / Уборка",
    pricingMode: "fixed",
    priceEuro: 60,
    orderRef: "HV-CL01",
    rooms: 2,
    hours: 3,
    workers: 1,
    details: "2 room(s) require ~3 hours and 1 cleaner(s)",
    date: "2026-12-01",
    preferredTime: "10:00",
    streetAddress: "Rua Test 1",
    city: "Lisboa",
  });

  assert.match(text, /🏠 Комнаты: 2/);
  assert.match(text, /⏱ Часы: 3/);
  assert.match(text, /👥 Специалисты: 1/);
  assert.match(text, /📋 Расчёт:/);
  assert.doesNotMatch(text, /Тариф:/);
  assert.doesNotMatch(text, /Общая длительность визита/);
});

test("repair quote telegram format unchanged", () => {
  const text = buildOrderMessage({
    name: "Test User",
    phone: "+351900000000",
    service: "Home Repairs / Ремонт",
    pricingMode: "quote",
    priceEuro: null,
    orderRef: "HV-RP01",
    problemDescription: "Leak under sink",
    repairPhotoCount: 2,
    details: "Home repair quote request",
  });

  assert.match(text, /quote \(цена после осмотра\)/);
  assert.match(text, /🛠 Проблема: Leak under sink/);
  assert.match(text, /📷 Фото ремонта: 2/);
  assert.doesNotMatch(text, /Тариф:/);
});

test("TELEGRAM_NOTIFY_DISABLED=1 skips notifyAdminAboutOrder without Telegram HTTP", async () => {
  const { notifyAdminAboutOrder } = await import("./telegram-notify");
  const previous = process.env.TELEGRAM_NOTIFY_DISABLED;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Telegram API must not be called when notify is disabled");
  }) as typeof fetch;

  process.env.TELEGRAM_NOTIFY_DISABLED = "1";
  try {
    await notifyAdminAboutOrder({
      ...baseOrder,
      service: "Cleaning / Уборка",
      pricingMode: "fixed",
      priceEuro: 40,
      orderRef: "HV-CL-DRY",
    });
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) {
      delete process.env.TELEGRAM_NOTIFY_DISABLED;
    } else {
      process.env.TELEGRAM_NOTIFY_DISABLED = previous;
    }
  }
});
