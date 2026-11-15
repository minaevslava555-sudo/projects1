import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivePricingBook } from "@/lib/pricing-book-validation";
import { resolveOrderPricing } from "@/lib/order-pricing";

test("resolveOrderPricing prepares cleaning price and snapshots", async () => {
  const book: ActivePricingBook = {
    id: "11111111-1111-4111-8111-111111111111",
    version: 1,
    cleaningHourlyRateEuro: 20,
    roomPlans: [
      { rooms: 1, hours: 2, workers: 1 },
      { rooms: 2, hours: 3, workers: 1 },
      { rooms: 3, hours: 4, workers: 2 },
      { rooms: 4, hours: 5, workers: 2 },
      { rooms: 5, hours: 6, workers: 3 },
      { rooms: 6, hours: 6, workers: 3 },
    ],
    massagePrices: [
      { minutes: 60, priceEuro: 45, isActive: true },
      { minutes: 90, priceEuro: 67.5, isActive: true },
      { minutes: 120, priceEuro: 90, isActive: true },
    ],
  };

  let loadCount = 0;
  const result = await resolveOrderPricing({ service: "cleaning", rooms: 2 }, async () => {
    loadCount += 1;
    return book;
  });

  assert.equal(loadCount, 1);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.priced.mode, "fixed");
  if (result.priced.mode !== "fixed") {
    return;
  }

  assert.equal(result.priced.priceEuro, 60);
  assert.equal(result.priced.hours, 3);
  assert.equal(result.priced.workers, 1);
  assert.equal(result.pricingConfigId, book.id);
  assert.equal(result.pricingVersion, 1);
  assert.equal(result.hourlyRateSnapshot, 20);
  assert.deepEqual(result.pricingSnapshot, {
    service: "cleaning",
    pricingConfigId: book.id,
    pricingVersion: 1,
    rooms: 2,
    hours: 3,
    workers: 1,
    cleaningHourlyRateEuro: 20,
    priceEuro: 60,
  });
});

test("resolveOrderPricing prepares massage price and snapshots", async () => {
  const book: ActivePricingBook = {
    id: "11111111-1111-4111-8111-111111111111",
    version: 2,
    cleaningHourlyRateEuro: 20,
    roomPlans: [
      { rooms: 1, hours: 2, workers: 1 },
      { rooms: 2, hours: 3, workers: 1 },
      { rooms: 3, hours: 4, workers: 2 },
      { rooms: 4, hours: 5, workers: 2 },
      { rooms: 5, hours: 6, workers: 3 },
      { rooms: 6, hours: 6, workers: 3 },
    ],
    massagePrices: [
      { minutes: 60, priceEuro: 55, isActive: true },
      { minutes: 90, priceEuro: 67.5, isActive: true },
      { minutes: 120, priceEuro: 90, isActive: true },
    ],
  };

  let loadCount = 0;
  const result = await resolveOrderPricing(
    { service: "massage", massageMinutes: 60 },
    async () => {
      loadCount += 1;
      return book;
    },
  );

  assert.equal(loadCount, 1);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.priced.mode, "fixed");
  if (result.priced.mode !== "fixed") {
    return;
  }

  assert.equal(result.priced.priceEuro, 55);
  assert.equal(result.pricingConfigId, book.id);
  assert.equal(result.pricingVersion, 2);
  assert.equal(result.hourlyRateSnapshot, undefined);
  assert.deepEqual(result.pricingSnapshot, {
    service: "massage",
    pricingConfigId: book.id,
    pricingVersion: 2,
    massageMinutes: 60,
    priceEuro: 55,
  });
});

test("resolveOrderPricing keeps repair as quote without loading book", async () => {
  let loadCount = 0;
  const result = await resolveOrderPricing({ service: "repair" }, async () => {
    loadCount += 1;
    throw new Error("Loader must not be called for repair");
  });

  assert.equal(result.ok, true);
  assert.equal(loadCount, 0);
  if (!result.ok) {
    return;
  }

  assert.equal(result.priced.mode, "quote");
  if (result.priced.mode !== "quote") {
    return;
  }

  assert.equal(result.priced.priceEuro, null);
  assert.equal(result.pricingConfigId, undefined);
  assert.equal(result.pricingVersion, undefined);
  assert.equal(result.hourlyRateSnapshot, undefined);
  assert.equal(result.pricingSnapshot, undefined);
});

test("resolveOrderPricing fails closed when pricing book is unavailable", async () => {
  const cases = [
    { service: "cleaning" as const, rooms: 2 },
    { service: "massage" as const, massageMinutes: 60 },
  ];

  for (const input of cases) {
    let loadCount = 0;
    const result = await resolveOrderPricing(input, async () => {
      loadCount += 1;
      throw new Error("Simulated pricing book failure");
    });

    assert.equal(loadCount, 1);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }

    assert.equal(result.status, 502);
    assert.equal(result.message, "Не удалось получить актуальные тарифы");
    assert.equal("priced" in result, false);
    assert.equal("pricingConfigId" in result, false);
    assert.equal("pricingVersion" in result, false);
    assert.equal("hourlyRateSnapshot" in result, false);
    assert.equal("pricingSnapshot" in result, false);
  }
});

test("resolveOrderPricing rejects invalid inputs before loading book", async () => {
  const cases = [
    {
      input: { service: "cleaning" as const, rooms: 0 },
      message: "Укажите число комнат (1–6)",
    },
    {
      input: { service: "cleaning" as const, rooms: 7 },
      message: "Укажите число комнат (1–6)",
    },
    {
      input: { service: "cleaning" as const, rooms: 2.5 },
      message: "Укажите число комнат (1–6)",
    },
    {
      input: { service: "cleaning" as const, rooms: undefined },
      message: "Укажите число комнат (1–6)",
    },
    {
      input: { service: "massage" as const, massageMinutes: 75 },
      message: "Укажите длительность сеанса",
    },
    {
      input: { service: "massage" as const, massageMinutes: undefined },
      message: "Укажите длительность сеанса",
    },
  ];

  for (const { input, message } of cases) {
    let loadCount = 0;
    const result = await resolveOrderPricing(input, async () => {
      loadCount += 1;
      throw new Error("Loader must not be called for invalid inputs");
    });

    assert.equal(result.ok, false);
    if (result.ok) {
      assert.fail("expected validation failure");
    }

    assert.equal(result.status, 400);
    assert.equal(result.message, message);
    assert.equal(loadCount, 0);
    assert.equal("priced" in result, false);
  }
});
