import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOOKING_ATTEMPT_STORAGE_KEY,
  buildBookingAttemptFingerprint,
  clearBookingAttempt,
  readBookingAttempt,
  writeBookingAttempt,
} from "./booking-attempt";
import { buildOrderRequestFingerprint } from "./order-request-fingerprint";

const sampleInput = {
  name: "Test User",
  phone: "+351900000000",
  service: "cleaning",
  date: "2026-12-01",
  preferredTime: "10:00",
  streetAddress: "Rua Test 1",
  city: "Lisboa",
  apartmentFloor: null as string | null,
  accessInstructions: null as string | null,
  details: null as string | null,
  problemDescription: null as string | null,
  massageCategory: null as string | null,
  rooms: 2 as number | null,
  massageMinutes: null as number | null,
  repairPhotoPaths: [] as string[],
};

function installMemorySessionStorage() {
  const store = new Map<string, string>();
  const memory: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: memory,
  });
  return store;
}

test("buildBookingAttemptFingerprint matches server SHA-256 fingerprint", async () => {
  const client = await buildBookingAttemptFingerprint(sampleInput);
  const server = buildOrderRequestFingerprint(sampleInput);
  assert.equal(client, server);
  assert.match(client, /^[a-f0-9]{64}$/);
});

test("write/read booking attempt round-trips key and fingerprint without extra fields", () => {
  installMemorySessionStorage();
  writeBookingAttempt({
    idempotencyKey: "idem-test-key-01",
    fingerprint: "a".repeat(64),
    service: "cleaning",
  });
  const raw = sessionStorage.getItem(BOOKING_ATTEMPT_STORAGE_KEY);
  assert.ok(raw);
  assert.equal(JSON.parse(raw as string).name, undefined);
  assert.deepEqual(readBookingAttempt(), {
    idempotencyKey: "idem-test-key-01",
    fingerprint: "a".repeat(64),
    service: "cleaning",
  });
});

test("clearBookingAttempt removes persisted attempt", () => {
  installMemorySessionStorage();
  writeBookingAttempt({
    idempotencyKey: "idem-clear",
    fingerprint: "b".repeat(64),
    service: "repair",
  });
  clearBookingAttempt();
  assert.equal(readBookingAttempt(), null);
});

test("readBookingAttempt rejects malformed storage payloads", () => {
  installMemorySessionStorage();
  sessionStorage.setItem(
    BOOKING_ATTEMPT_STORAGE_KEY,
    JSON.stringify({ idempotencyKey: "x", fingerprint: "short", service: "cleaning" }),
  );
  assert.equal(readBookingAttempt(), null);
});

test("fingerprint changes when booking payload changes materially", async () => {
  const base = await buildBookingAttemptFingerprint(sampleInput);
  const changed = await buildBookingAttemptFingerprint({
    ...sampleInput,
    rooms: 3,
  });
  assert.notEqual(base, changed);
});
