import assert from "node:assert/strict";
import { test } from "node:test";
import { MASSAGE_V1_QUOTE_REVISION } from "@/lib/massage-wellness-catalog";
import {
  buildMassageV1PricingSnapshot,
  calculateMassageV1Price,
  formatMassageV1OrderDetails,
  parseMassageV1PriceInput,
} from "@/lib/massage-wellness-pricing";

const scenarios = [
  {
    name: "Relaxing",
    input: { tariffId: "relaxing-60" as const },
    totalSessionMinutes: 60,
    priceEuro: 70,
  },
  {
    name: "Sports",
    input: { tariffId: "sports-60" as const },
    totalSessionMinutes: 60,
    priceEuro: 80,
  },
  {
    name: "Targeted 30",
    input: { tariffId: "targeted-30" as const },
    totalSessionMinutes: 30,
    priceEuro: 55,
  },
  {
    name: "Targeted 60",
    input: { tariffId: "targeted-60" as const },
    totalSessionMinutes: 60,
    priceEuro: 85,
  },
  {
    name: "Relaxing + FootSystem",
    input: {
      tariffId: "relaxing-60" as const,
      wellnessEquipmentIds: ["foot-system"],
    },
    totalSessionMinutes: 90,
    priceEuro: 90,
  },
  {
    name: "Relaxing + EyeSystem",
    input: {
      tariffId: "relaxing-60" as const,
      wellnessEquipmentIds: ["eye-system"],
    },
    totalSessionMinutes: 85,
    priceEuro: 85,
  },
  {
    name: "Relaxing + Moxi",
    input: {
      tariffId: "relaxing-60" as const,
      wellnessEquipmentIds: ["moxi"],
    },
    totalSessionMinutes: 60,
    priceEuro: 80,
  },
  {
    name: "Sports + FootSystem + EyeSystem",
    input: {
      tariffId: "sports-60" as const,
      wellnessEquipmentIds: ["foot-system", "eye-system"],
    },
    totalSessionMinutes: 115,
    priceEuro: 115,
  },
  {
    name: "Relaxing + all 4 devices",
    input: {
      tariffId: "relaxing-60" as const,
      wellnessEquipmentIds: [
        "foot-system",
        "eye-system",
        "moxi",
        "top-relax",
      ],
    },
    totalSessionMinutes: 115,
    priceEuro: 125,
  },
  {
    name: "Premium Wellness",
    input: { tariffId: "premium-wellness-120" as const },
    totalSessionMinutes: 120,
    priceEuro: 120,
  },
] as const;

for (const row of scenarios) {
  test(`calculateMassageV1Price: ${row.name}`, () => {
    const result = calculateMassageV1Price(row.input);
    assert.ok(!("error" in result), `error for ${row.name}`);
    if ("error" in result) return;
    assert.equal(result.totalSessionMinutes, row.totalSessionMinutes);
    assert.equal(result.priceEuro, row.priceEuro);
    assert.equal(result.quoteRevision, MASSAGE_V1_QUOTE_REVISION);
  });
}

test("Premium Wellness includes four devices without extra charge", () => {
  const result = calculateMassageV1Price({
    tariffId: "premium-wellness-120",
  });
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.deepEqual(result.includedEquipment, [
    "foot-system",
    "eye-system",
    "moxi",
    "top-relax",
  ]);
  assert.equal(result.equipment.length, 0);
  assert.equal(result.priceCents, 12000);
  assert.equal(result.totalSessionMinutes, 120);
});

test("Premium rejects client-selected equipment (no double charge)", () => {
  const result = calculateMassageV1Price({
    tariffId: "premium-wellness-120",
    wellnessEquipmentIds: ["moxi"],
  });
  assert.ok("error" in result);
});

test("rejects unknown tariff", () => {
  const result = calculateMassageV1Price({ tariffId: "unknown-tariff" });
  assert.ok("error" in result);
});

test("rejects unknown equipment", () => {
  const result = calculateMassageV1Price({
    tariffId: "relaxing-60",
    wellnessEquipmentIds: ["spine-system"],
  });
  assert.ok("error" in result);
});

test("rejects duplicate equipment", () => {
  const result = calculateMassageV1Price({
    tariffId: "relaxing-60",
    wellnessEquipmentIds: ["moxi", "moxi"],
  });
  assert.ok("error" in result);
});

test("equipmentBookable false rejects paid equipment", () => {
  const result = calculateMassageV1Price(
    {
      tariffId: "relaxing-60",
      wellnessEquipmentIds: ["foot-system"],
    },
    { equipmentBookable: false },
  );
  assert.ok("error" in result);
});

test("premiumWellnessBookable false rejects Premium", () => {
  const result = calculateMassageV1Price(
    { tariffId: "premium-wellness-120" },
    { premiumWellnessBookable: false },
  );
  assert.ok("error" in result);
});

test("parseMassageV1PriceInput sorts equipment and omits empty", () => {
  const parsed = parseMassageV1PriceInput({
    tariffId: "relaxing-60",
    wellnessEquipmentIds: ["top-relax", "foot-system"],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.wellnessEquipmentIds, [
    "foot-system",
    "top-relax",
  ]);
});

test("parseMassageV1PriceInput rejects unexpected keys", () => {
  const parsed = parseMassageV1PriceInput({
    tariffId: "relaxing-60",
    priceEuro: 1,
  });
  assert.equal(parsed.ok, false);
});

test("buildMassageV1PricingSnapshot shape", () => {
  const priced = calculateMassageV1Price({
    tariffId: "relaxing-60",
    wellnessEquipmentIds: ["foot-system"],
  });
  assert.ok(!("error" in priced));
  if ("error" in priced) return;
  const snap = buildMassageV1PricingSnapshot(priced);
  assert.equal(snap.service, "massage");
  assert.equal(snap.massageVersion, "v1");
  assert.equal(snap.tariffId, "relaxing-60");
  assert.equal(snap.baseDurationMin, 60);
  assert.equal(snap.totalSessionMinutes, 90);
  assert.equal(snap.priceEuro, 90);
  assert.equal(snap.quoteRevision, MASSAGE_V1_QUOTE_REVISION);
});

test("formatMassageV1OrderDetails includes tariff and visit", () => {
  const priced = calculateMassageV1Price({ tariffId: "sports-60" });
  assert.ok(!("error" in priced));
  if ("error" in priced) return;
  const details = formatMassageV1OrderDetails(priced);
  assert.match(details, /sports-60/);
  assert.match(details, /60 min/);
  assert.match(details, /€80/);
});
