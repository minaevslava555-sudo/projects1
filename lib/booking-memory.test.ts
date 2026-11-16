import assert from "node:assert/strict";
import { test } from "node:test";
import { bookingMemory } from "./booking-memory";

test("compareAndDeleteIdem deletes matching value and returns true", () => {
  const key = `idem-match-${Date.now()}-${Math.random()}`;
  const value = JSON.stringify({ id: "__pending__", claimToken: "token-a" });

  assert.equal(bookingMemory.claimIdem(key, value), true);
  assert.equal(bookingMemory.compareAndDeleteIdem(key, value), true);
  assert.equal(bookingMemory.getIdem(key), null);
});

test("compareAndDeleteIdem rejects mismatch and preserves the key", () => {
  const key = `idem-mismatch-${Date.now()}-${Math.random()}`;
  const value = JSON.stringify({ id: "__pending__", claimToken: "token-b" });

  assert.equal(bookingMemory.claimIdem(key, value), true);
  assert.equal(
    bookingMemory.compareAndDeleteIdem(
      key,
      JSON.stringify({ id: "__pending__", claimToken: "other" }),
    ),
    false,
  );
  assert.equal(bookingMemory.getIdem(key), value);
});

test("compareAndDeleteIdem returns false for missing key", () => {
  const key = `idem-missing-${Date.now()}-${Math.random()}`;
  assert.equal(
    bookingMemory.compareAndDeleteIdem(key, JSON.stringify({ id: "__pending__" })),
    false,
  );
  assert.equal(bookingMemory.getIdem(key), null);
});

test("compareAndDeleteIdem cannot delete a replaced claim with the old value", () => {
  const key = `idem-replaced-${Date.now()}-${Math.random()}`;
  const oldValue = JSON.stringify({ id: "__pending__", claimToken: "old-token" });
  const newValue = JSON.stringify({
    id: "order-1",
    orderRef: "REF1",
    pricingMode: "fixed",
    priceEuro: 60,
    telegramOk: true,
  });

  assert.equal(bookingMemory.claimIdem(key, oldValue), true);
  bookingMemory.setIdem(key, newValue);
  assert.equal(bookingMemory.compareAndDeleteIdem(key, oldValue), false);
  assert.equal(bookingMemory.getIdem(key), newValue);
});

test("compareAndDeleteIdem leaves other keys untouched", () => {
  const keyA = `idem-other-a-${Date.now()}-${Math.random()}`;
  const keyB = `idem-other-b-${Date.now()}-${Math.random()}`;
  const valueA = JSON.stringify({ id: "__pending__", claimToken: "a" });
  const valueB = JSON.stringify({ id: "__pending__", claimToken: "b" });

  assert.equal(bookingMemory.claimIdem(keyA, valueA), true);
  assert.equal(bookingMemory.claimIdem(keyB, valueB), true);
  assert.equal(bookingMemory.compareAndDeleteIdem(keyA, valueA), true);
  assert.equal(bookingMemory.getIdem(keyA), null);
  assert.equal(bookingMemory.getIdem(keyB), valueB);
});
