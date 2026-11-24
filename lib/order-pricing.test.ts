import assert from "node:assert/strict";
import { test } from "node:test";
import type { CleaningV1RoomCounts } from "@/lib/booking-pricing";
import type { ActivePricingBook } from "@/lib/pricing-book-validation";
import { resolveOrderPricing } from "@/lib/order-pricing";

const emptyV1Rooms: CleaningV1RoomCounts = {
  bedroom: 0,
  livingRoom: 0,
  kitchen: 0,
  bathroom: 0,
  separateWc: 0,
  hallway: 0,
  otherRoom: 0,
};

const roomsA: CleaningV1RoomCounts = {
  ...emptyV1Rooms,
  bedroom: 1,
  livingRoom: 1,
  kitchen: 1,
  bathroom: 1,
  hallway: 1,
};

const roomsB: CleaningV1RoomCounts = {
  ...emptyV1Rooms,
  bedroom: 2,
  livingRoom: 1,
  kitchen: 1,
  bathroom: 2,
  hallway: 1,
};

const roomsC: CleaningV1RoomCounts = {
  ...emptyV1Rooms,
  bedroom: 4,
  livingRoom: 1,
  kitchen: 1,
  bathroom: 3,
  hallway: 2,
};

async function assertBookNotLoaded(
  run: (loadBook: () => Promise<ActivePricingBook>) => Promise<unknown>,
) {
  let loadCount = 0;
  await run(async () => {
    loadCount += 1;
    throw new Error("Pricing book must not load for Cleaning v1");
  });
  assert.equal(loadCount, 0);
}

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

test("resolveOrderPricing Cleaning v1 matches all 9 approved prices without loading book", async () => {
  const cases = [
    { rooms: roomsA, cleaningType: "standard" as const, price: 70 },
    { rooms: roomsA, cleaningType: "deep" as const, price: 100 },
    {
      rooms: roomsA,
      cleaningType: "post_renovation" as const,
      price: 130,
    },
    { rooms: roomsB, cleaningType: "standard" as const, price: 90 },
    { rooms: roomsB, cleaningType: "deep" as const, price: 140 },
    {
      rooms: roomsB,
      cleaningType: "post_renovation" as const,
      price: 180,
    },
    { rooms: roomsC, cleaningType: "standard" as const, price: 140 },
    { rooms: roomsC, cleaningType: "deep" as const, price: 200 },
    {
      rooms: roomsC,
      cleaningType: "post_renovation" as const,
      price: 270,
    },
  ];

  for (const row of cases) {
    let loadCount = 0;
    const result = await resolveOrderPricing(
      {
        service: "cleaning",
        cleaningPricingVersion: "v1",
        cleaningV1: {
          roomCounts: row.rooms,
          cleaningType: row.cleaningType,
        },
      },
      async () => {
        loadCount += 1;
        throw new Error("Pricing book must not load for Cleaning v1");
      },
    );

    assert.equal(loadCount, 0);
    assert.equal(result.ok, true);
    if (!result.ok) {
      assert.fail("expected v1 success");
    }
    assert.equal(result.priced.mode, "fixed");
    if (result.priced.mode !== "fixed") {
      return;
    }
    assert.equal(result.priced.priceEuro, row.price);
    assert.equal(result.priced.hours, undefined);
    assert.equal(result.priced.workers, undefined);
    assert.equal(result.pricingConfigId, undefined);
    assert.equal(result.pricingSnapshot?.cleaningPricingVersion, "v1");
    assert.equal(result.pricingSnapshot?.customerPriceEuro, row.price);
    assert.equal(result.pricingSnapshot?.adminReviewRequired, false);
    assert.deepEqual(result.pricingSnapshot?.roomCounts, row.rooms);
    assert.equal("areaM2" in (result.pricingSnapshot ?? {}), false);
    assert.equal(
      "areaAdjustmentMinutes" in (result.pricingSnapshot ?? {}),
      false,
    );
    assert.equal(result.pricingSnapshot?.cleaningType, row.cleaningType);
    assert.equal(typeof result.pricingSnapshot?.roomMinutes, "number");
    assert.equal(typeof result.pricingSnapshot?.addonMinutes, "number");
    assert.equal(result.pricingSnapshot?.addonMinutes, 0);
    assert.equal(typeof result.pricingSnapshot?.totalPersonMinutes, "number");
    assert.equal(typeof result.pricingSnapshot?.billablePersonMinutes, "number");
    assert.equal(typeof result.pricingSnapshot?.billableHours, "number");
    assert.equal("addons" in (result.pricingSnapshot ?? {}), false);
  }
});

test("resolveOrderPricing Cleaning v1 snapshots non-zero addons", async () => {
  const result = await resolveOrderPricing(
    {
      service: "cleaning",
      cleaningPricingVersion: "v1",
      cleaningV1: {
        roomCounts: roomsA,
        cleaningType: "standard",
        addons: {
          oven: 1,
          fridge: 0,
          windows: 0,
          balcony: 0,
          ironing: 0,
        },
      },
    },
    async () => {
      throw new Error("Pricing book must not load for Cleaning v1");
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.priced.mode, "fixed");
  if (result.priced.mode !== "fixed") return;
  assert.equal(result.priced.priceEuro, 80);
  assert.equal(result.pricingSnapshot?.addonMinutes, 30);
  assert.deepEqual(result.pricingSnapshot?.addons, {
    oven: 1,
    fridge: 0,
    windows: 0,
    balcony: 0,
    ironing: 0,
  });
});

test("resolveOrderPricing Cleaning v1 rejects legacy areaM2 field", async () => {
  let loadCount = 0;
  const result = await resolveOrderPricing(
    {
      service: "cleaning",
      cleaningPricingVersion: "v1",
      cleaningV1: {
        roomCounts: roomsA,
        cleaningType: "standard",
        ...({ areaM2: 181 } as object),
      } as {
        roomCounts: CleaningV1RoomCounts;
        cleaningType: "standard";
      },
    },
    async () => {
      loadCount += 1;
      throw new Error("Pricing book must not load for Cleaning v1");
    },
  );

  assert.equal(loadCount, 0);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.status, 400);
  assert.match(result.message, /areaM2|Unexpected field/);
});

test("resolveOrderPricing Cleaning v1 rejects invalid or missing payload without legacy fallback", async () => {
  const cases = [
    {
      service: "cleaning" as const,
      cleaningPricingVersion: "v1" as const,
    },
    {
      service: "cleaning" as const,
      cleaningPricingVersion: "v1" as const,
      cleaningV1: {
        roomCounts: { bedroom: 1 } as CleaningV1RoomCounts,
        cleaningType: "standard" as const,
      },
    },
    {
      service: "cleaning" as const,
      cleaningPricingVersion: "v1" as const,
      cleaningV1: {
        roomCounts: roomsA,
        cleaningType: "express" as "standard",
      },
    },
  ];

  for (const input of cases) {
    let loadCount = 0;
    const result = await resolveOrderPricing(input, async () => {
      loadCount += 1;
      throw new Error("Pricing book must not load for Cleaning v1");
    });

    assert.equal(result.ok, false);
    if (result.ok) {
      assert.fail("expected v1 validation failure");
    }
    assert.equal(result.status, 400);
    assert.equal(loadCount, 0);
    assert.equal("priced" in result, false);
  }
});

test("resolveOrderPricing Cleaning v1 rejects mixed legacy rooms", async () => {
  let loadCount = 0;
  const result = await resolveOrderPricing(
    {
      service: "cleaning",
      rooms: 2,
      cleaningPricingVersion: "v1",
      cleaningV1: {
        roomCounts: roomsA,
        cleaningType: "standard",
      },
    },
    async () => {
      loadCount += 1;
      throw new Error("Pricing book must not load for Cleaning v1");
    },
  );

  assert.equal(loadCount, 0);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.status, 400);
  assert.match(result.message, /rooms/);
  assert.equal("priced" in result, false);
});

test("resolveOrderPricing Cleaning v1 does not fall back to legacy rooms pricing", async () => {
  await assertBookNotLoaded(async (loadBook) => {
    const result = await resolveOrderPricing(
      {
        service: "cleaning",
        cleaningPricingVersion: "v1",
        // Valid legacy rooms alone would price at €60 — must not be used.
        rooms: 2,
        cleaningV1: {
          roomCounts: roomsA,
          cleaningType: "standard",
          ...({ areaM2: "bad" } as object),
        } as {
          roomCounts: CleaningV1RoomCounts;
          cleaningType: "standard";
        },
      },
      loadBook,
    );
    assert.equal(result.ok, false);
    if (result.ok) {
      assert.fail("must not succeed via legacy fallback");
    }
    assert.equal(result.status, 400);
  });
});
