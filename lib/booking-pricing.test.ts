import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLEANING_V1_MAX_ADDON_COUNT,
  CLEANING_V1_MAX_ROOMS_PER_TYPE,
  CLEANING_V1_PRESETS,
  EMPTY_CLEANING_V1_ADDONS,
  calculateCleaningV1Price,
  cleaningPlan,
  cleaningPriceEuro,
  parseCleaningV1PriceInput,
  roundUpCleaningV1BillableMinutes,
  type CleaningV1AddonCounts,
  type CleaningV1PriceInput,
  type CleaningV1RoomCounts,
} from "@/lib/booking-pricing";

const emptyRooms: CleaningV1RoomCounts = {
  bedroom: 0,
  livingRoom: 0,
  kitchen: 0,
  bathroom: 0,
  separateWc: 0,
  hallway: 0,
  otherRoom: 0,
};

const roomsA: CleaningV1RoomCounts = {
  ...emptyRooms,
  bedroom: 1,
  livingRoom: 1,
  kitchen: 1,
  bathroom: 1,
  hallway: 1,
};

const roomsB: CleaningV1RoomCounts = {
  ...emptyRooms,
  bedroom: 2,
  livingRoom: 1,
  kitchen: 1,
  bathroom: 2,
  hallway: 1,
};

const roomsC: CleaningV1RoomCounts = {
  ...emptyRooms,
  bedroom: 4,
  livingRoom: 1,
  kitchen: 1,
  bathroom: 3,
  hallway: 2,
};

function assertPrice(
  input: CleaningV1PriceInput,
  expectedEuro: number,
): void {
  const result = calculateCleaningV1Price(input);
  assert.ok(!("error" in result), `unexpected error: ${JSON.stringify(result)}`);
  assert.equal(result.adminReviewRequired, false);
  assert.equal(result.customerPriceEuro, expectedEuro);
}

test("calculateCleaningV1Price matches approved A/B/C × Standard/Deep/Post prices", () => {
  const cases = [
    { rooms: roomsA, areaM2: 55, cleaningType: "standard" as const, price: 70 },
    { rooms: roomsA, areaM2: 55, cleaningType: "deep" as const, price: 100 },
    {
      rooms: roomsA,
      areaM2: 55,
      cleaningType: "post_renovation" as const,
      price: 130,
    },
    { rooms: roomsB, areaM2: 100, cleaningType: "standard" as const, price: 100 },
    { rooms: roomsB, areaM2: 100, cleaningType: "deep" as const, price: 150 },
    {
      rooms: roomsB,
      areaM2: 100,
      cleaningType: "post_renovation" as const,
      price: 190,
    },
    { rooms: roomsC, areaM2: 170, cleaningType: "standard" as const, price: 150 },
    { rooms: roomsC, areaM2: 170, cleaningType: "deep" as const, price: 230 },
    {
      rooms: roomsC,
      areaM2: 170,
      cleaningType: "post_renovation" as const,
      price: 300,
    },
  ];

  for (const row of cases) {
    assertPrice(
      {
        rooms: row.rooms,
        areaM2: row.areaM2,
        cleaningType: row.cleaningType,
      },
      row.price,
    );
  }
});

test("calculateCleaningV1Price area boundaries 80/81 and 120/121", () => {
  const at80 = calculateCleaningV1Price({
    rooms: roomsA,
    areaM2: 80,
    cleaningType: "standard",
  });
  const at81 = calculateCleaningV1Price({
    rooms: roomsA,
    areaM2: 81,
    cleaningType: "standard",
  });
  assert.ok(!("error" in at80) && !("error" in at81));
  assert.equal(at80.areaAdjustmentMinutes, 0);
  assert.equal(at81.areaAdjustmentMinutes, 0.6);
  assert.equal(at80.customerPriceEuro, 70);
  assert.equal(at81.customerPriceEuro, 70);
  assert.equal(at80.billablePersonMinutes, at81.billablePersonMinutes);

  const at120 = calculateCleaningV1Price({
    rooms: roomsA,
    areaM2: 120,
    cleaningType: "standard",
  });
  const at121 = calculateCleaningV1Price({
    rooms: roomsA,
    areaM2: 121,
    cleaningType: "standard",
  });
  assert.ok(!("error" in at120) && !("error" in at121));
  assert.equal(at120.areaAdjustmentMinutes, 24);
  // 41 * 0.6 is not exactly 24.6 in IEEE-754; assert proximity + shared billable outcome.
  assert.ok(Math.abs(at121.areaAdjustmentMinutes - 24.6) < 1e-9);
  assert.equal(at120.customerPriceEuro, 80);
  assert.equal(at121.customerPriceEuro, 80);
  assert.equal(at120.billablePersonMinutes, at121.billablePersonMinutes);
});

test("calculateCleaningV1Price area 180 auto-prices; 181 requires admin review", () => {
  const at180 = calculateCleaningV1Price({
    rooms: roomsA,
    areaM2: 180,
    cleaningType: "standard",
  });
  const at181 = calculateCleaningV1Price({
    rooms: roomsA,
    areaM2: 181,
    cleaningType: "standard",
  });
  assert.ok(!("error" in at180) && !("error" in at181));
  assert.equal(at180.adminReviewRequired, false);
  assert.equal(at180.customerPriceEuro, 90);
  assert.equal(at181.adminReviewRequired, true);
  assert.equal(at181.customerPriceEuro, null);
});

test("calculateCleaningV1Price enforces minimum customer price of €40", () => {
  const result = calculateCleaningV1Price({
    rooms: { ...emptyRooms, hallway: 1 },
    areaM2: 40,
    cleaningType: "standard",
  });
  assert.ok(!("error" in result));
  assert.equal(result.roomMinutes, 20);
  assert.equal(result.billablePersonMinutes, 30);
  assert.equal(result.billableHours, 0.5);
  assert.equal(result.customerPriceEuro, 40);
});

test("calculateCleaningV1Price rounds person-minutes up to 30-minute steps", () => {
  const rounded = calculateCleaningV1Price({
    rooms: roomsA,
    areaM2: 55,
    cleaningType: "standard",
  });
  assert.ok(!("error" in rounded));
  assert.equal(rounded.totalPersonMinutes, 195);
  assert.equal(rounded.billablePersonMinutes, 210);

  const exactMultiple = calculateCleaningV1Price({
    rooms: roomsA,
    areaM2: 55,
    cleaningType: "post_renovation",
  });
  assert.ok(!("error" in exactMultiple));
  assert.equal(exactMultiple.totalPersonMinutes, 390);
  assert.equal(exactMultiple.billablePersonMinutes, 390);

  const deepFractional = calculateCleaningV1Price({
    rooms: roomsA,
    areaM2: 55,
    cleaningType: "deep",
  });
  assert.ok(!("error" in deepFractional));
  assert.equal(deepFractional.totalPersonMinutes, 292.5);
  assert.equal(deepFractional.billablePersonMinutes, 300);
});

test("roundUpCleaningV1BillableMinutes tolerates IEEE noise above exact multiples", () => {
  assert.equal(roundUpCleaningV1BillableMinutes(0), 0);
  assert.equal(roundUpCleaningV1BillableMinutes(30), 30);
  assert.equal(roundUpCleaningV1BillableMinutes(210), 210);
  assert.equal(roundUpCleaningV1BillableMinutes(300), 300);
  assert.equal(roundUpCleaningV1BillableMinutes(390), 390);

  // Noise just above a multiple must not add a step (+€10).
  assert.equal(roundUpCleaningV1BillableMinutes(300 + 1e-12), 300);
  assert.equal(roundUpCleaningV1BillableMinutes(210 + Number.EPSILON), 210);
  assert.equal(roundUpCleaningV1BillableMinutes(30 + 1e-10), 30);

  // Genuine values below / above a multiple.
  assert.equal(roundUpCleaningV1BillableMinutes(29.9), 30);
  assert.equal(roundUpCleaningV1BillableMinutes(30.01), 60);
  assert.equal(roundUpCleaningV1BillableMinutes(209.9), 210);
  assert.equal(roundUpCleaningV1BillableMinutes(210.01), 240);
  assert.equal(roundUpCleaningV1BillableMinutes(292.5), 300);
  assert.equal(roundUpCleaningV1BillableMinutes(300.01), 330);
});

test("calculateCleaningV1Price rejects invalid area and room inputs", () => {
  const base = {
    rooms: roomsA,
    areaM2: 55,
    cleaningType: "standard" as const,
  };

  for (const areaM2 of [
    -1,
    0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    const result = calculateCleaningV1Price({ ...base, areaM2 });
    assert.ok("error" in result);
  }

  const negativeRooms = calculateCleaningV1Price({
    ...base,
    rooms: { ...roomsA, bedroom: -1 },
  });
  assert.ok("error" in negativeRooms);

  const fractionalRooms = calculateCleaningV1Price({
    ...base,
    rooms: { ...roomsA, kitchen: 1.5 },
  });
  assert.ok("error" in fractionalRooms);

  const badType = calculateCleaningV1Price({
    ...base,
    cleaningType: "express" as CleaningV1PriceInput["cleaningType"],
  });
  assert.ok("error" in badType);

  const nullRooms = calculateCleaningV1Price({
    ...base,
    rooms: null as unknown as CleaningV1RoomCounts,
  });
  assert.ok("error" in nullRooms);

  const undefinedRooms = calculateCleaningV1Price({
    ...base,
    rooms: undefined as unknown as CleaningV1RoomCounts,
  });
  assert.ok("error" in undefinedRooms);

  const missingKey = calculateCleaningV1Price({
    ...base,
    rooms: {
      bedroom: 1,
      livingRoom: 1,
      kitchen: 1,
      bathroom: 1,
      separateWc: 0,
      hallway: 1,
      // otherRoom omitted
    } as CleaningV1RoomCounts,
  });
  assert.ok("error" in missingKey);
});

test("calculateCleaningV1Price is independent of assigned cleaner count", () => {
  const input: CleaningV1PriceInput = {
    rooms: roomsB,
    areaM2: 100,
    cleaningType: "standard",
  };
  const priced = calculateCleaningV1Price(input);
  assert.ok(!("error" in priced));
  assert.equal(priced.customerPriceEuro, 100);
  assert.equal(
    Object.prototype.hasOwnProperty.call(input, "cleaners"),
    false,
  );
  // Staffing is not part of the contract; unexpected keys are rejected.
  const withCleaners = calculateCleaningV1Price({
    ...input,
    ...({ cleaners: 3 } as object),
  } as CleaningV1PriceInput);
  assert.ok("error" in withCleaners);
});

test("parseCleaningV1PriceInput accepts valid shapes and rejects invalid ones", () => {
  const valid = parseCleaningV1PriceInput({
    rooms: roomsA,
    areaM2: 55,
    cleaningType: "standard",
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.deepEqual(valid.value.rooms, roomsA);
    assert.equal(valid.value.areaM2, 55);
    assert.equal(valid.value.cleaningType, "standard");
  }

  assert.equal(parseCleaningV1PriceInput(null).ok, false);
  assert.equal(parseCleaningV1PriceInput([]).ok, false);
  assert.equal(parseCleaningV1PriceInput("x").ok, false);

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: roomsA,
      areaM2: 55,
      cleaningType: "standard",
      cleaners: 2,
    }).ok,
    false,
  );

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: roomsA,
      areaM2: "55",
      cleaningType: "standard",
    }).ok,
    false,
  );

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: { ...roomsA, bedroom: "1" },
      areaM2: 55,
      cleaningType: "standard",
    }).ok,
    false,
  );

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: { ...roomsA, balcony: 1 },
      areaM2: 55,
      cleaningType: "standard",
    }).ok,
    false,
  );

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: {
        bedroom: 1,
        livingRoom: 1,
        kitchen: 1,
        bathroom: 1,
        separateWc: 0,
        hallway: 1,
      },
      areaM2: 55,
      cleaningType: "standard",
    }).ok,
    false,
  );

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: roomsA,
      areaM2: 0,
      cleaningType: "standard",
    }).ok,
    false,
  );

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: roomsA,
      areaM2: Number.NaN,
      cleaningType: "standard",
    }).ok,
    false,
  );

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: roomsA,
      areaM2: Number.POSITIVE_INFINITY,
      cleaningType: "standard",
    }).ok,
    false,
  );

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: { ...roomsA, bedroom: 1.5 },
      areaM2: 55,
      cleaningType: "standard",
    }).ok,
    false,
  );

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: roomsA,
      areaM2: 55,
      cleaningType: "express",
    }).ok,
    false,
  );
});

test("cleaningPlan legacy room tiers remain unchanged", () => {
  const expected = [
    { rooms: 1, hours: 2, workers: 1, priceEuro: 40 },
    { rooms: 2, hours: 3, workers: 1, priceEuro: 60 },
    { rooms: 3, hours: 4, workers: 2, priceEuro: 160 },
    { rooms: 4, hours: 5, workers: 2, priceEuro: 200 },
    { rooms: 5, hours: 6, workers: 3, priceEuro: 360 },
    { rooms: 6, hours: 6, workers: 3, priceEuro: 360 },
  ] as const;

  for (const row of expected) {
    const plan = cleaningPlan(row.rooms);
    assert.deepEqual(plan, { hours: row.hours, workers: row.workers });
    assert.equal(cleaningPriceEuro(row.rooms), row.priceEuro);
  }
});

test("parseCleaningV1PriceInput enforces room and add-on caps", () => {
  assert.equal(
    parseCleaningV1PriceInput({
      rooms: { ...roomsA, bedroom: CLEANING_V1_MAX_ROOMS_PER_TYPE },
      areaM2: 55,
      cleaningType: "standard",
    }).ok,
    true,
  );
  assert.equal(
    parseCleaningV1PriceInput({
      rooms: { ...roomsA, bedroom: CLEANING_V1_MAX_ROOMS_PER_TYPE + 1 },
      areaM2: 55,
      cleaningType: "standard",
    }).ok,
    false,
  );

  const validAddons: CleaningV1AddonCounts = {
    ...EMPTY_CLEANING_V1_ADDONS,
    oven: CLEANING_V1_MAX_ADDON_COUNT,
  };
  assert.equal(
    parseCleaningV1PriceInput({
      rooms: roomsA,
      areaM2: 55,
      cleaningType: "standard",
      addons: validAddons,
    }).ok,
    true,
  );
  assert.equal(
    parseCleaningV1PriceInput({
      rooms: roomsA,
      areaM2: 55,
      cleaningType: "standard",
      addons: { ...validAddons, oven: CLEANING_V1_MAX_ADDON_COUNT + 1 },
    }).ok,
    false,
  );
});

test("calculateCleaningV1Price adds catalog add-on person-minutes before type multiplier", () => {
  const base = calculateCleaningV1Price({
    rooms: roomsA,
    areaM2: 55,
    cleaningType: "standard",
  });
  assert.ok(!("error" in base));
  assert.equal(base.addonMinutes, 0);
  assert.equal(base.customerPriceEuro, 70);

  const withOven = calculateCleaningV1Price({
    rooms: roomsA,
    areaM2: 55,
    cleaningType: "standard",
    addons: { ...EMPTY_CLEANING_V1_ADDONS, oven: 1 },
  });
  assert.ok(!("error" in withOven));
  assert.equal(withOven.addonMinutes, 30);
  assert.equal(withOven.roomMinutes, base.roomMinutes);
  // 195 + 30 = 225 → billable 240 → 4h × €20 = €80
  assert.equal(withOven.totalPersonMinutes, 225);
  assert.equal(withOven.billablePersonMinutes, 240);
  assert.equal(withOven.customerPriceEuro, 80);

  const deepOven = calculateCleaningV1Price({
    rooms: roomsA,
    areaM2: 55,
    cleaningType: "deep",
    addons: { ...EMPTY_CLEANING_V1_ADDONS, oven: 1 },
  });
  assert.ok(!("error" in deepOven));
  // (195 + 30) × 1.5 = 337.5 → 360 → €120
  assert.equal(deepOven.totalPersonMinutes, 337.5);
  assert.equal(deepOven.customerPriceEuro, 120);
});

test("CLEANING_V1_PRESETS stay within room caps and match known shapes", () => {
  for (const preset of Object.values(CLEANING_V1_PRESETS)) {
    for (const count of Object.values(preset)) {
      assert.ok(count >= 0 && count <= CLEANING_V1_MAX_ROOMS_PER_TYPE);
    }
    const parsed = parseCleaningV1PriceInput({
      rooms: preset,
      areaM2: 70,
      cleaningType: "standard",
    });
    assert.equal(parsed.ok, true);
  }
  assert.equal(CLEANING_V1_PRESETS.t1.bedroom, 1);
  assert.equal(CLEANING_V1_PRESETS.t2.bedroom, 2);
  assert.equal(CLEANING_V1_PRESETS.t3.bedroom, 3);
});
