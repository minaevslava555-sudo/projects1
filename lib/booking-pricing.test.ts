import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLEANING_V1_MAX_ADDON_COUNT,
  CLEANING_V1_MAX_WINDOWS_ADDON_COUNT,
  CLEANING_V1_MAX_ROOMS_PER_TYPE,
  CLEANING_V1_PRESETS,
  EMPTY_CLEANING_V1_ADDONS,
  EMPTY_CLEANING_V1_ROOMS,
  calculateCleaningV1Price,
  cleaningPlan,
  cleaningPriceEuro,
  cleaningV1CleaningTypeMultiplier,
  cleaningV1CustomerPriceDeltaEuro,
  clampCleaningV1ExtraRoomsForPreset,
  cleaningV1MaxAddonCount,
  cleaningV1RoomUnitMinutes,
  parseCleaningV1PriceInput,
  recommendCleaningV1Crew,
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
    { rooms: roomsA, cleaningType: "standard" as const, price: 70 },
    { rooms: roomsA, cleaningType: "deep" as const, price: 110 },
    {
      rooms: roomsA,
      cleaningType: "post_renovation" as const,
      price: 140,
    },
    { rooms: roomsB, cleaningType: "standard" as const, price: 100 },
    { rooms: roomsB, cleaningType: "deep" as const, price: 150 },
    {
      rooms: roomsB,
      cleaningType: "post_renovation" as const,
      price: 200,
    },
    { rooms: roomsC, cleaningType: "standard" as const, price: 150 },
    { rooms: roomsC, cleaningType: "deep" as const, price: 220 },
    {
      rooms: roomsC,
      cleaningType: "post_renovation" as const,
      price: 290,
    },
  ];

  for (const row of cases) {
    assertPrice(
      {
        rooms: row.rooms,
        cleaningType: row.cleaningType,
      },
      row.price,
    );
  }
});

test("calculateCleaningV1Price presets T1/T2/T3 standard prices", () => {
  assertPrice(
    { rooms: CLEANING_V1_PRESETS.t1, cleaningType: "standard" },
    70,
  );
  assertPrice(
    { rooms: CLEANING_V1_PRESETS.t2, cleaningType: "standard" },
    90,
  );
  assertPrice(
    { rooms: CLEANING_V1_PRESETS.t3, cleaningType: "standard" },
    110,
  );
});

test("calculateCleaningV1Price ignores area — field is rejected by parser", () => {
  const withArea = parseCleaningV1PriceInput({
    rooms: roomsA,
    cleaningType: "standard",
    areaM2: 181,
  });
  assert.equal(withArea.ok, false);
  if (!withArea.ok) {
    assert.match(withArea.error, /areaM2|Unexpected field/);
  }
});

test("calculateCleaningV1Price enforces minimum customer price of €40", () => {
  const result = calculateCleaningV1Price({
    rooms: { ...emptyRooms, hallway: 1 },
    cleaningType: "standard",
  });
  assert.ok(!("error" in result));
  assert.equal(result.roomMinutes, 20);
  assert.equal(result.billablePersonMinutes, 30);
  assert.equal(result.billableHours, 0.5);
  assert.equal(result.customerPriceEuro, 40);
  assert.equal(result.minimumPriceApplied, true);
  assert.equal(result.adminReviewRequired, false);
  assert.equal(result.recommendedCleaners, 1);
  assert.equal(result.estimatedVisitMinutes, 30);
});

test("recommendCleaningV1Crew boundaries at 4 / 8 / 12 person-hours", () => {
  assert.deepEqual(recommendCleaningV1Crew(240), {
    recommendedCleaners: 1,
    estimatedVisitMinutes: 240,
  });
  assert.deepEqual(recommendCleaningV1Crew(241), {
    recommendedCleaners: 2,
    estimatedVisitMinutes: 135,
  });
  assert.deepEqual(recommendCleaningV1Crew(480), {
    recommendedCleaners: 2,
    estimatedVisitMinutes: 240,
  });
  assert.deepEqual(recommendCleaningV1Crew(481), {
    recommendedCleaners: 3,
    estimatedVisitMinutes: 165,
  });
  assert.deepEqual(recommendCleaningV1Crew(720), {
    recommendedCleaners: 3,
    estimatedVisitMinutes: 240,
  });
  assert.deepEqual(recommendCleaningV1Crew(721), {
    recommendedCleaners: 4,
    estimatedVisitMinutes: 195,
  });
  assert.deepEqual(recommendCleaningV1Crew(0), {
    recommendedCleaners: 1,
    estimatedVisitMinutes: 0,
  });
});

test("calculateCleaningV1Price crew matches recommendCleaningV1Crew", () => {
  const result = calculateCleaningV1Price({
    rooms: roomsC,
    cleaningType: "post_renovation",
  });
  assert.ok(!("error" in result));
  const crew = recommendCleaningV1Crew(result.billablePersonMinutes);
  assert.equal(result.recommendedCleaners, crew.recommendedCleaners);
  assert.equal(result.estimatedVisitMinutes, crew.estimatedVisitMinutes);
  assert.equal(result.minimumPriceApplied, false);
  // Price independent of crew: same € for any recommendedCleaners.
  assert.equal(result.customerPriceEuro, 290);
});

test("calculateCleaningV1Price rounds person-minutes up to 30-minute steps", () => {
  const rounded = calculateCleaningV1Price({
    rooms: roomsA,
    cleaningType: "standard",
  });
  assert.ok(!("error" in rounded));
  assert.equal(rounded.roomMinutes, 205);
  assert.equal(rounded.totalPersonMinutes, 205);
  assert.equal(rounded.billablePersonMinutes, 210);

  const exactMultiple = calculateCleaningV1Price({
    rooms: roomsA,
    cleaningType: "post_renovation",
  });
  assert.ok(!("error" in exactMultiple));
  assert.equal(exactMultiple.totalPersonMinutes, 410);
  assert.equal(exactMultiple.billablePersonMinutes, 420);

  const deepFractional = calculateCleaningV1Price({
    rooms: roomsA,
    cleaningType: "deep",
  });
  assert.ok(!("error" in deepFractional));
  assert.equal(deepFractional.totalPersonMinutes, 307.5);
  assert.equal(deepFractional.billablePersonMinutes, 330);
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

test("calculateCleaningV1Price rejects invalid room inputs", () => {
  const base = {
    rooms: roomsA,
    cleaningType: "standard" as const,
  };

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
    cleaningType: "standard",
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.deepEqual(valid.value.rooms, roomsA);
    assert.equal(valid.value.cleaningType, "standard");
    assert.equal(
      Object.prototype.hasOwnProperty.call(valid.value, "areaM2"),
      false,
    );
  }

  assert.equal(parseCleaningV1PriceInput(null).ok, false);
  assert.equal(parseCleaningV1PriceInput([]).ok, false);
  assert.equal(parseCleaningV1PriceInput("x").ok, false);

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: roomsA,
      cleaningType: "standard",
      cleaners: 2,
    }).ok,
    false,
  );

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: roomsA,
      cleaningType: "standard",
      areaM2: 55,
    }).ok,
    false,
  );

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: { ...roomsA, bedroom: "1" },
      cleaningType: "standard",
    }).ok,
    false,
  );

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: { ...roomsA, balcony: 1 },
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
      cleaningType: "standard",
    }).ok,
    false,
  );

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: { ...roomsA, bedroom: 1.5 },
      cleaningType: "standard",
    }).ok,
    false,
  );

  assert.equal(
    parseCleaningV1PriceInput({
      rooms: roomsA,
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
      cleaningType: "standard",
    }).ok,
    true,
  );
  assert.equal(
    parseCleaningV1PriceInput({
      rooms: { ...roomsA, bedroom: CLEANING_V1_MAX_ROOMS_PER_TYPE + 1 },
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
      cleaningType: "standard",
      addons: validAddons,
    }).ok,
    true,
  );
  assert.equal(
    parseCleaningV1PriceInput({
      rooms: roomsA,
      cleaningType: "standard",
      addons: { ...validAddons, oven: CLEANING_V1_MAX_ADDON_COUNT + 1 },
    }).ok,
    false,
  );

  assert.equal(cleaningV1MaxAddonCount("windows"), CLEANING_V1_MAX_WINDOWS_ADDON_COUNT);
  assert.equal(
    parseCleaningV1PriceInput({
      rooms: roomsA,
      cleaningType: "standard",
      addons: {
        ...EMPTY_CLEANING_V1_ADDONS,
        windows: CLEANING_V1_MAX_WINDOWS_ADDON_COUNT,
      },
    }).ok,
    true,
  );
  assert.equal(
    parseCleaningV1PriceInput({
      rooms: roomsA,
      cleaningType: "standard",
      addons: {
        ...EMPTY_CLEANING_V1_ADDONS,
        windows: CLEANING_V1_MAX_WINDOWS_ADDON_COUNT + 1,
      },
    }).ok,
    false,
  );
});

test("calculateCleaningV1Price adds add-on minutes after room type multiplier", () => {
  const base = calculateCleaningV1Price({
    rooms: roomsA,
    cleaningType: "standard",
  });
  assert.ok(!("error" in base));
  assert.equal(base.addonMinutes, 0);
  assert.equal(base.roomMinutes, 205);
  assert.equal(base.customerPriceEuro, 70);

  const withOven = calculateCleaningV1Price({
    rooms: roomsA,
    cleaningType: "standard",
    addons: { ...EMPTY_CLEANING_V1_ADDONS, oven: 1 },
  });
  assert.ok(!("error" in withOven));
  assert.equal(withOven.addonMinutes, 30);
  assert.equal(withOven.roomMinutes, base.roomMinutes);
  // 205 × 1 + 30 = 235 → billable 240 → 4h × €20 = €80
  assert.equal(withOven.totalPersonMinutes, 235);
  assert.equal(withOven.billablePersonMinutes, 240);
  assert.equal(withOven.customerPriceEuro, 80);

  const deepOven = calculateCleaningV1Price({
    rooms: roomsA,
    cleaningType: "deep",
    addons: { ...EMPTY_CLEANING_V1_ADDONS, oven: 1 },
  });
  assert.ok(!("error" in deepOven));
  // 205 × 1.5 + 30 = 337.5 → 360 → €120 (addons not multiplied)
  assert.equal(deepOven.totalPersonMinutes, 337.5);
  assert.equal(deepOven.customerPriceEuro, 120);

  const deepWindows = calculateCleaningV1Price({
    rooms: roomsA,
    cleaningType: "deep",
    addons: { ...EMPTY_CLEANING_V1_ADDONS, windows: 2 },
  });
  assert.ok(!("error" in deepWindows));
  assert.equal(deepWindows.addonMinutes, 40);
  // 205 × 1.5 + 40 = 347.5 → 360 → €120
  assert.equal(deepWindows.totalPersonMinutes, 347.5);
  assert.equal(deepWindows.customerPriceEuro, 120);
});

test("cleaningV1CustomerPriceDeltaEuro reflects billable rounding for +1 room", () => {
  assert.equal(cleaningV1RoomUnitMinutes("bedroom"), 40);
  assert.equal(cleaningV1CleaningTypeMultiplier("deep"), 1.5);
  const base = {
    rooms: CLEANING_V1_PRESETS.t1,
    cleaningType: "standard" as const,
  };
  const withExtraBedroom = {
    rooms: {
      ...CLEANING_V1_PRESETS.t1,
      bedroom: CLEANING_V1_PRESETS.t1.bedroom + 1,
    },
    cleaningType: "standard" as const,
  };
  const delta = cleaningV1CustomerPriceDeltaEuro(base, withExtraBedroom);
  const a = calculateCleaningV1Price(base);
  const b = calculateCleaningV1Price(withExtraBedroom);
  assert.ok(!("error" in a) && !("error" in b));
  assert.equal(
    delta,
    (b.customerPriceEuro as number) - (a.customerPriceEuro as number),
  );
});

test("cleaningV1CustomerPriceDeltaEuro is 0 when added time fits the current price", () => {
  // 1 bedroom is under the €40 floor; +1 other room stays under the floor.
  const base = {
    rooms: { ...EMPTY_CLEANING_V1_ROOMS, bedroom: 1 },
    cleaningType: "standard" as const,
    addons: EMPTY_CLEANING_V1_ADDONS,
  };
  const withOtherRoom = {
    ...base,
    rooms: { ...base.rooms, otherRoom: 1 },
  };
  const a = calculateCleaningV1Price(base);
  const b = calculateCleaningV1Price(withOtherRoom);
  assert.ok(!("error" in a) && !("error" in b));
  assert.equal(a.minimumPriceApplied, true);
  assert.equal(b.minimumPriceApplied, true);
  assert.equal(a.customerPriceEuro, b.customerPriceEuro);
  assert.equal(cleaningV1CustomerPriceDeltaEuro(base, withOtherRoom), 0);
});

test("CLEANING_V1_PRESETS stay within room caps and match known shapes", () => {
  for (const preset of Object.values(CLEANING_V1_PRESETS)) {
    for (const count of Object.values(preset)) {
      assert.ok(count >= 0 && count <= CLEANING_V1_MAX_ROOMS_PER_TYPE);
    }
    const parsed = parseCleaningV1PriceInput({
      rooms: preset,
      cleaningType: "standard",
    });
    assert.equal(parsed.ok, true);
  }
  assert.equal(CLEANING_V1_PRESETS.t1.bedroom, 1);
  assert.equal(CLEANING_V1_PRESETS.t2.bedroom, 2);
  assert.equal(CLEANING_V1_PRESETS.t3.bedroom, 3);
});

test("clampCleaningV1ExtraRoomsForPreset keeps extras within caps", () => {
  const extras = {
    ...EMPTY_CLEANING_V1_ROOMS,
    bedroom: 2,
    bathroom: 1,
  };
  const kept = clampCleaningV1ExtraRoomsForPreset(
    CLEANING_V1_PRESETS.t1,
    extras,
  );
  assert.deepEqual(kept.extras, extras);
  assert.equal(
    kept.totals.bedroom,
    CLEANING_V1_PRESETS.t1.bedroom + extras.bedroom,
  );
  assert.deepEqual(kept.reducedKeys, []);

  const nearCapExtras = {
    ...EMPTY_CLEANING_V1_ROOMS,
    bedroom: CLEANING_V1_MAX_ROOMS_PER_TYPE,
  };
  const capped = clampCleaningV1ExtraRoomsForPreset(
    CLEANING_V1_PRESETS.t3,
    nearCapExtras,
  );
  const maxBedroomExtra =
    CLEANING_V1_MAX_ROOMS_PER_TYPE - CLEANING_V1_PRESETS.t3.bedroom;
  assert.equal(capped.extras.bedroom, maxBedroomExtra);
  assert.equal(capped.totals.bedroom, CLEANING_V1_MAX_ROOMS_PER_TYPE);
  assert.deepEqual(capped.reducedKeys, ["bedroom"]);
});

test("clampCleaningV1ExtraRoomsForPreset preserves extras when switching T1→T2", () => {
  const extras = {
    ...EMPTY_CLEANING_V1_ROOMS,
    bedroom: 1,
    otherRoom: 2,
  };
  const fromT1 = clampCleaningV1ExtraRoomsForPreset(
    CLEANING_V1_PRESETS.t1,
    extras,
  );
  const toT2 = clampCleaningV1ExtraRoomsForPreset(
    CLEANING_V1_PRESETS.t2,
    fromT1.extras,
  );
  assert.equal(toT2.extras.bedroom, 1);
  assert.equal(toT2.extras.otherRoom, 2);
  assert.deepEqual(toT2.reducedKeys, []);
  assert.equal(
    toT2.totals.bedroom,
    CLEANING_V1_PRESETS.t2.bedroom + 1,
  );
});
