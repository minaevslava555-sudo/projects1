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
