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

test("compareAndSetIdem replaces matching value and returns true", () => {
  const key = `idem-cas-match-${Date.now()}-${Math.random()}`;
  const expected = JSON.stringify({ id: "__pending__", claimToken: "cas-token" });
  const next = JSON.stringify({
    id: "order-cas-1",
    orderRef: "HV-CAS-1",
    pricingMode: "fixed",
    priceEuro: 80,
    telegramOk: true,
  });

  assert.equal(bookingMemory.claimIdem(key, expected), true);
  assert.equal(bookingMemory.compareAndSetIdem(key, expected, next), true);
  assert.equal(bookingMemory.getIdem(key), next);
  assert.equal(bookingMemory.compareAndDeleteIdem(key, next), true);
});

test("compareAndSetIdem rejects mismatch and preserves original value", () => {
  const key = `idem-cas-mismatch-${Date.now()}-${Math.random()}`;
  const expected = JSON.stringify({ id: "__pending__", claimToken: "cas-keep" });
  const wrong = JSON.stringify({ id: "__pending__", claimToken: "other" });
  const next = JSON.stringify({
    id: "order-cas-2",
    orderRef: "HV-CAS-2",
    pricingMode: "fixed",
    priceEuro: 90,
    telegramOk: false,
  });

  assert.equal(bookingMemory.claimIdem(key, expected), true);
  assert.equal(bookingMemory.compareAndSetIdem(key, wrong, next), false);
  assert.equal(bookingMemory.getIdem(key), expected);
  assert.equal(bookingMemory.compareAndDeleteIdem(key, expected), true);
});

test("compareAndSetIdem returns false for missing key and creates nothing", () => {
  const key = `idem-cas-missing-${Date.now()}-${Math.random()}`;
  const expected = JSON.stringify({ id: "__pending__", claimToken: "missing" });
  const next = JSON.stringify({
    id: "order-cas-3",
    orderRef: "HV-CAS-3",
    pricingMode: "fixed",
    priceEuro: 100,
    telegramOk: true,
  });

  assert.equal(bookingMemory.compareAndSetIdem(key, expected, next), false);
  assert.equal(bookingMemory.getIdem(key), null);
});

test("compareAndSetIdem rejects stale expected after a successful replace", () => {
  const key = `idem-cas-stale-${Date.now()}-${Math.random()}`;
  const expected = JSON.stringify({ id: "__pending__", claimToken: "stale" });
  const next = JSON.stringify({
    id: "order-cas-4",
    orderRef: "HV-CAS-4",
    pricingMode: "fixed",
    priceEuro: 110,
    telegramOk: true,
  });
  const later = JSON.stringify({
    id: "order-cas-4b",
    orderRef: "HV-CAS-4B",
    pricingMode: "fixed",
    priceEuro: 120,
    telegramOk: false,
  });

  assert.equal(bookingMemory.claimIdem(key, expected), true);
  assert.equal(bookingMemory.compareAndSetIdem(key, expected, next), true);
  assert.equal(bookingMemory.compareAndSetIdem(key, expected, later), false);
  assert.equal(bookingMemory.getIdem(key), next);
  assert.equal(bookingMemory.compareAndDeleteIdem(key, next), true);
});
