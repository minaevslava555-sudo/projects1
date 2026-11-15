import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivePricingBook } from "@/lib/pricing-book-validation";
import { resolveBookingPricingFromBook } from "@/lib/booking-pricing-from-book";

test("resolveBookingPricingFromBook calculates cleaning prices for rooms 1–6", () => {
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

  const expected = [
    { rooms: 1, priceEuro: 40, hours: 2, workers: 1 },
    { rooms: 2, priceEuro: 60, hours: 3, workers: 1 },
    { rooms: 3, priceEuro: 160, hours: 4, workers: 2 },
    { rooms: 4, priceEuro: 200, hours: 5, workers: 2 },
    { rooms: 5, priceEuro: 360, hours: 6, workers: 3 },
    { rooms: 6, priceEuro: 360, hours: 6, workers: 3 },
  ] as const;

  for (const row of expected) {
    const priced = resolveBookingPricingFromBook(book, {
      service: "cleaning",
      rooms: row.rooms,
    });

    assert.ok(!("error" in priced));
    assert.equal(priced.mode, "fixed");
    assert.equal(priced.priceEuro, row.priceEuro);
    assert.equal(priced.hours, row.hours);
    assert.equal(priced.workers, row.workers);
  }
});

test("resolveBookingPricingFromBook calculates massage prices", () => {
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

  const expected = [
    { massageMinutes: 60, priceEuro: 45 },
    { massageMinutes: 90, priceEuro: 67.5 },
    { massageMinutes: 120, priceEuro: 90 },
  ] as const;

  for (const row of expected) {
    const priced = resolveBookingPricingFromBook(book, {
      service: "massage",
      massageMinutes: row.massageMinutes,
    });

    assert.ok(!("error" in priced));
    assert.equal(priced.mode, "fixed");
    assert.equal(priced.priceEuro, row.priceEuro);
    assert.equal(priced.massageMinutes, row.massageMinutes);
  }
});

test("resolveBookingPricingFromBook uses updated prices from the book", () => {
  const book: ActivePricingBook = {
    id: "11111111-1111-4111-8111-111111111111",
    version: 1,
    cleaningHourlyRateEuro: 25,
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

  const cleaning = resolveBookingPricingFromBook(book, {
    service: "cleaning",
    rooms: 2,
  });
  assert.ok(!("error" in cleaning));
  assert.equal(cleaning.mode, "fixed");
  assert.equal(cleaning.priceEuro, 75);
  assert.equal(cleaning.hours, 3);
  assert.equal(cleaning.workers, 1);

  const massage = resolveBookingPricingFromBook(book, {
    service: "massage",
    massageMinutes: 60,
  });
  assert.ok(!("error" in massage));
  assert.equal(massage.mode, "fixed");
  assert.equal(massage.priceEuro, 55);
  assert.equal(massage.massageMinutes, 60);
});
