import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOOKING_ATTEMPT_STORAGE_KEY,
  buildBookingAttemptFingerprint,
  clearBookingAttempt,
  isBookingAttemptQuoteStale,
  readBookingAttempt,
  writeBookingAttempt,
} from "./booking-attempt";
import { CLEANING_V1_QUOTE_REVISION } from "./booking-pricing";
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
  assert.equal(JSON.parse(raw as string).quoteRevision, undefined);
  assert.deepEqual(readBookingAttempt(), {
    idempotencyKey: "idem-test-key-01",
    fingerprint: "a".repeat(64),
    service: "cleaning",
  });
});

test("quoteRevision round-trips and stale detection keeps key semantics", () => {
  installMemorySessionStorage();
  writeBookingAttempt({
    idempotencyKey: "idem-quote-rev",
    fingerprint: "c".repeat(64),
    service: "cleaning",
    quoteRevision: "old-revision",
  });
  const read = readBookingAttempt();
  assert.ok(read);
  assert.equal(read.quoteRevision, "old-revision");
  assert.equal(
    isBookingAttemptQuoteStale(read, CLEANING_V1_QUOTE_REVISION),
    true,
  );
  assert.equal(
    isBookingAttemptQuoteStale(
      { ...read, quoteRevision: CLEANING_V1_QUOTE_REVISION },
      CLEANING_V1_QUOTE_REVISION,
    ),
    false,
  );
  // Legacy attempts without quoteRevision are stale vs current engine.
  assert.equal(
    isBookingAttemptQuoteStale(
      {
        idempotencyKey: "idem-legacy",
        fingerprint: "d".repeat(64),
        service: "cleaning",
      },
      CLEANING_V1_QUOTE_REVISION,
    ),
    true,
  );
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

const v1Sample = {
  ...sampleInput,
  rooms: null as number | null,
  cleaningPricingVersion: "v1" as const,
  roomCounts: {
    bedroom: 1,
    livingRoom: 1,
    kitchen: 1,
    bathroom: 1,
    separateWc: 0,
    hallway: 1,
    otherRoom: 0,
  },
  cleaningType: "standard",
};

test("client/server fingerprint parity for legacy and cleaning v1", async () => {
  const legacyClient = await buildBookingAttemptFingerprint(sampleInput);
  const legacyServer = buildOrderRequestFingerprint(sampleInput);
  assert.equal(legacyClient, legacyServer);

  const legacyExplicit = await buildBookingAttemptFingerprint({
    ...sampleInput,
    cleaningPricingVersion: "legacy",
  });
  assert.equal(legacyExplicit, legacyServer);

  const v1Client = await buildBookingAttemptFingerprint(v1Sample);
  const v1Server = buildOrderRequestFingerprint(v1Sample);
  assert.equal(v1Client, v1Server);
  assert.notEqual(v1Client, legacyClient);

  const v1WithAddons = {
    ...v1Sample,
    addons: {
      oven: 1,
      fridge: 0,
      windows: 0,
      balcony: 0,
      ironing: 0,
    },
  };
  const addonsClient = await buildBookingAttemptFingerprint(v1WithAddons);
  const addonsServer = buildOrderRequestFingerprint(v1WithAddons);
  assert.equal(addonsClient, addonsServer);
  assert.notEqual(addonsClient, v1Client);
});

test("client/server fingerprint parity for massage v1", async () => {
  const massageV1 = {
    ...sampleInput,
    service: "massage",
    rooms: null as number | null,
    massageMinutes: null as number | null,
    massageCategory: null as string | null,
    massageVersion: "v1" as const,
    massageTariffId: "relaxing-60",
    wellnessEquipmentIds: ["eye-system", "foot-system"],
  };
  const client = await buildBookingAttemptFingerprint(massageV1);
  const server = buildOrderRequestFingerprint(massageV1);
  assert.equal(client, server);
});
