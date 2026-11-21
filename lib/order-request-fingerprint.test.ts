import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOrderRequestFingerprint } from "./order-request-fingerprint";

const baseBooking = {
  name: "Test User",
  phone: "+351900000000",
  service: "cleaning",
  date: "2026-12-01",
  preferredTime: "10:00",
  streetAddress: "Rua Test 1",
  city: "Lisboa",
  apartmentFloor: "2",
  accessInstructions: "Gate code 1",
  details: "Please dust shelves",
  problemDescription: null as string | null,
  massageCategory: null as string | null,
  rooms: 2 as number | null,
  massageMinutes: null as number | null,
  repairPhotoPaths: null as string[] | null,
};

test("identical normalized booking data yields identical fingerprint", () => {
  const a = buildOrderRequestFingerprint({ ...baseBooking });
  const b = buildOrderRequestFingerprint({ ...baseBooking });
  assert.equal(a, b);
});

test("different address, date, time, service, rooms, massageMinutes or details change fingerprint", () => {
  const base = buildOrderRequestFingerprint({ ...baseBooking });
  assert.notEqual(
    base,
    buildOrderRequestFingerprint({ ...baseBooking, streetAddress: "Rua Other 9" }),
  );
  assert.notEqual(
    base,
    buildOrderRequestFingerprint({ ...baseBooking, date: "2026-12-02" }),
  );
  assert.notEqual(
    base,
    buildOrderRequestFingerprint({ ...baseBooking, preferredTime: "11:00" }),
  );
  assert.notEqual(
    base,
    buildOrderRequestFingerprint({ ...baseBooking, service: "massage", rooms: null, massageMinutes: 60 }),
  );
  assert.notEqual(
    base,
    buildOrderRequestFingerprint({ ...baseBooking, rooms: 3 }),
  );
  assert.notEqual(
    base,
    buildOrderRequestFingerprint({
      ...baseBooking,
      service: "massage",
      rooms: null,
      massageMinutes: 90,
      details: null,
    }),
  );
  assert.notEqual(
    base,
    buildOrderRequestFingerprint({ ...baseBooking, details: "Different note" }),
  );
});

test("reordered repairPhotoPaths yields identical fingerprint", () => {
  const pathsA = [
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/11111111-2222-4333-8444-555555555555.jpg",
    "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff/66666666-7777-4888-8999-aaaaaaaaaaaa.png",
  ];
  const pathsB = [pathsA[1]!, pathsA[0]!];
  const a = buildOrderRequestFingerprint({
    ...baseBooking,
    service: "repair",
    rooms: null,
    problemDescription: "Leak under sink",
    repairPhotoPaths: pathsA,
  });
  const b = buildOrderRequestFingerprint({
    ...baseBooking,
    service: "repair",
    rooms: null,
    problemDescription: "Leak under sink",
    repairPhotoPaths: pathsB,
  });
  assert.equal(a, b);
});

test("changed repairPhotoPaths yields different fingerprint", () => {
  const a = buildOrderRequestFingerprint({
    ...baseBooking,
    service: "repair",
    rooms: null,
    problemDescription: "Leak under sink",
    repairPhotoPaths: [
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/11111111-2222-4333-8444-555555555555.jpg",
    ],
  });
  const b = buildOrderRequestFingerprint({
    ...baseBooking,
    service: "repair",
    rooms: null,
    problemDescription: "Leak under sink",
    repairPhotoPaths: [
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/99999999-2222-4333-8444-555555555555.jpg",
    ],
  });
  assert.notEqual(a, b);
});

test("omitted optional field vs explicit null yields identical fingerprint", () => {
  const withOmitted = buildOrderRequestFingerprint({
    name: baseBooking.name,
    phone: baseBooking.phone,
    service: baseBooking.service,
    date: baseBooking.date,
    preferredTime: baseBooking.preferredTime,
    streetAddress: baseBooking.streetAddress,
    city: baseBooking.city,
    rooms: 2,
  });
  const withNulls = buildOrderRequestFingerprint({
    name: baseBooking.name,
    phone: baseBooking.phone,
    service: baseBooking.service,
    date: baseBooking.date,
    preferredTime: baseBooking.preferredTime,
    streetAddress: baseBooking.streetAddress,
    city: baseBooking.city,
    apartmentFloor: null,
    accessInstructions: null,
    details: null,
    problemDescription: null,
    massageCategory: null,
    rooms: 2,
    massageMinutes: null,
    repairPhotoPaths: null,
  });
  assert.equal(withOmitted, withNulls);
});

test("fingerprint is exactly 64 lowercase hexadecimal characters", () => {
  const digest = buildOrderRequestFingerprint({ ...baseBooking });
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest.length, 64);
  assert.equal(digest, digest.toLowerCase());
});

test("different object property insertion order yields identical fingerprint", () => {
  const a = buildOrderRequestFingerprint({
    name: "Test User",
    phone: "+351900000000",
    service: "cleaning",
    date: "2026-12-01",
    preferredTime: "10:00",
    streetAddress: "Rua Test 1",
    city: "Lisboa",
    rooms: 2,
    details: "Note",
  });
  const b = buildOrderRequestFingerprint({
    details: "Note",
    rooms: 2,
    city: "Lisboa",
    streetAddress: "Rua Test 1",
    preferredTime: "10:00",
    date: "2026-12-01",
    service: "cleaning",
    phone: "+351900000000",
    name: "Test User",
  });
  assert.equal(a, b);
});

/** Pre-extension digest for baseBooking — must stay byte-identical for Redis/DB replay. */
const LEGACY_GOLDEN_FINGERPRINT =
  "93a241f72de638f9f1bc1414f5eed576262be4fe78dc4a721df0a3e0ba8d63e2";

const v1RoomCountsA = {
  bedroom: 1,
  livingRoom: 1,
  kitchen: 1,
  bathroom: 1,
  separateWc: 0,
  hallway: 1,
  otherRoom: 0,
};

const v1RoomCountsB = {
  ...v1RoomCountsA,
  bedroom: 2,
};

test("legacy golden fingerprint is unchanged", () => {
  assert.equal(
    buildOrderRequestFingerprint({ ...baseBooking }),
    LEGACY_GOLDEN_FINGERPRINT,
  );
});

test("explicit cleaningPricingVersion legacy matches golden fingerprint", () => {
  assert.equal(
    buildOrderRequestFingerprint({
      ...baseBooking,
      cleaningPricingVersion: "legacy",
      roomCounts: v1RoomCountsA,
      areaM2: 90,
      cleaningType: "deep",
    }),
    LEGACY_GOLDEN_FINGERPRINT,
  );
});

test("cleaning v1 fingerprints differ by roomCounts, areaM2 and cleaningType", () => {
  const baseV1 = {
    ...baseBooking,
    rooms: null as number | null,
    cleaningPricingVersion: "v1" as const,
    roomCounts: v1RoomCountsA,
    areaM2: 80,
    cleaningType: "standard",
  };
  const baseFp = buildOrderRequestFingerprint(baseV1);
  assert.notEqual(baseFp, LEGACY_GOLDEN_FINGERPRINT);
  assert.notEqual(
    baseFp,
    buildOrderRequestFingerprint({ ...baseV1, roomCounts: v1RoomCountsB }),
  );
  assert.notEqual(
    baseFp,
    buildOrderRequestFingerprint({ ...baseV1, areaM2: 120 }),
  );
  assert.notEqual(
    baseFp,
    buildOrderRequestFingerprint({ ...baseV1, cleaningType: "deep" }),
  );
});

test("equivalent roomCounts key order yields identical v1 fingerprint", () => {
  const a = buildOrderRequestFingerprint({
    ...baseBooking,
    rooms: null,
    cleaningPricingVersion: "v1",
    areaM2: 80,
    cleaningType: "standard",
    roomCounts: {
      bedroom: 1,
      livingRoom: 1,
      kitchen: 1,
      bathroom: 1,
      separateWc: 0,
      hallway: 1,
      otherRoom: 0,
    },
  });
  const b = buildOrderRequestFingerprint({
    ...baseBooking,
    rooms: null,
    cleaningPricingVersion: "v1",
    areaM2: 80,
    cleaningType: "standard",
    roomCounts: {
      otherRoom: 0,
      hallway: 1,
      separateWc: 0,
      bathroom: 1,
      kitchen: 1,
      livingRoom: 1,
      bedroom: 1,
    },
  });
  assert.equal(a, b);
});

test("areaM2 80 and 80.0 produce identical v1 fingerprints", () => {
  const a = buildOrderRequestFingerprint({
    ...baseBooking,
    rooms: null,
    cleaningPricingVersion: "v1",
    roomCounts: v1RoomCountsA,
    areaM2: 80,
    cleaningType: "standard",
  });
  const b = buildOrderRequestFingerprint({
    ...baseBooking,
    rooms: null,
    cleaningPricingVersion: "v1",
    roomCounts: v1RoomCountsA,
    areaM2: 80.0,
    cleaningType: "standard",
  });
  assert.equal(a, b);
});
