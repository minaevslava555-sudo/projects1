/**
 * Pure Massage & Wellness v1 quote math. No network / env / feature flags here —
 * callers gate availability (equipment / Premium) before or via options.
 */

import {
  MASSAGE_V1_CATALOG_VERSION,
  MASSAGE_V1_QUOTE_REVISION,
  MASSAGE_V1_TARIFFS,
  WELLNESS_EQUIPMENT,
  centsToEuro,
  isMassageV1TariffId,
  isWellnessEquipmentId,
  sortWellnessEquipmentIds,
  type MassageV1TariffId,
  type WellnessEquipmentId,
} from "@/lib/massage-wellness-catalog";

export type MassageV1PriceInput = {
  tariffId: MassageV1TariffId;
  /** Selected paid add-ons; rejected for Premium when non-empty. */
  wellnessEquipmentIds?: readonly WellnessEquipmentId[];
};

export type MassageV1EquipmentLine = {
  id: WellnessEquipmentId;
  priceCents: number;
  extraBookingMin: number;
  included: boolean;
};

export type MassageV1PriceResult = {
  tariffId: MassageV1TariffId;
  catalogVersion: typeof MASSAGE_V1_CATALOG_VERSION;
  quoteRevision: string;
  baseDurationMin: number;
  basePriceCents: number;
  equipment: MassageV1EquipmentLine[];
  includedEquipment: WellnessEquipmentId[];
  totalSessionMinutes: number;
  priceCents: number;
  priceEuro: number;
};

export type MassageV1PriceOptions = {
  /** When false, non-empty paid equipment selection is rejected. Default true for pure math tests. */
  equipmentBookable?: boolean;
  /** When false, premium-wellness-120 is rejected. Default true for pure math tests. */
  premiumWellnessBookable?: boolean;
};

export type ParseMassageV1PriceInputResult =
  | { ok: true; value: MassageV1PriceInput }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strict parser: tariffId required; wellnessEquipmentIds optional array of known ids,
 * no duplicates. Unexpected keys rejected.
 */
export function parseMassageV1PriceInput(
  input: unknown,
): ParseMassageV1PriceInputResult {
  if (!isPlainObject(input)) {
    return { ok: false, error: "Invalid massage v1 pricing input" };
  }

  for (const key of Object.keys(input)) {
    if (key !== "tariffId" && key !== "wellnessEquipmentIds") {
      return { ok: false, error: `Unexpected field: ${key}` };
    }
  }

  if (!Object.prototype.hasOwnProperty.call(input, "tariffId")) {
    return { ok: false, error: "Invalid massage tariff" };
  }
  if (!isMassageV1TariffId(input.tariffId)) {
    return { ok: false, error: "Invalid massage tariff" };
  }

  let wellnessEquipmentIds: WellnessEquipmentId[] | undefined;
  if (Object.prototype.hasOwnProperty.call(input, "wellnessEquipmentIds")) {
    const raw = input.wellnessEquipmentIds;
    if (!Array.isArray(raw)) {
      return { ok: false, error: "Invalid wellness equipment" };
    }
    const seen = new Set<string>();
    const ids: WellnessEquipmentId[] = [];
    for (const item of raw) {
      if (!isWellnessEquipmentId(item)) {
        return { ok: false, error: "Unknown wellness equipment" };
      }
      if (seen.has(item)) {
        return { ok: false, error: "Duplicate wellness equipment" };
      }
      seen.add(item);
      ids.push(item);
    }
    wellnessEquipmentIds = sortWellnessEquipmentIds(ids);
  }

  return {
    ok: true,
    value: {
      tariffId: input.tariffId,
      ...(wellnessEquipmentIds != null && wellnessEquipmentIds.length > 0
        ? { wellnessEquipmentIds }
        : {}),
    },
  };
}

/**
 * Commercial quote for Massage v1. Does not encode medical protocols.
 */
export function calculateMassageV1Price(
  input: MassageV1PriceInput | unknown,
  options: MassageV1PriceOptions = {},
): MassageV1PriceResult | { error: string } {
  const parsed = parseMassageV1PriceInput(input);
  if (!parsed.ok) {
    return { error: parsed.error };
  }

  const equipmentBookable = options.equipmentBookable !== false;
  const premiumWellnessBookable = options.premiumWellnessBookable !== false;

  const tariff = MASSAGE_V1_TARIFFS[parsed.value.tariffId];
  if (!tariff.available) {
    return { error: "Massage tariff unavailable" };
  }

  if (
    tariff.id === "premium-wellness-120" &&
    !premiumWellnessBookable
  ) {
    return { error: "Premium Wellness пока недоступна" };
  }

  const selected = parsed.value.wellnessEquipmentIds ?? [];
  const includedSet = new Set(tariff.includedEquipment);
  const isPremium = tariff.id === "premium-wellness-120";

  if (isPremium) {
    if (selected.length > 0) {
      return {
        error: "Premium Wellness already includes wellness equipment",
      };
    }

    const includedEquipment = sortWellnessEquipmentIds([
      ...tariff.includedEquipment,
    ]);

    return {
      tariffId: tariff.id,
      catalogVersion: MASSAGE_V1_CATALOG_VERSION,
      quoteRevision: MASSAGE_V1_QUOTE_REVISION,
      baseDurationMin: tariff.durationMin,
      basePriceCents: tariff.priceCents,
      equipment: [],
      includedEquipment,
      totalSessionMinutes: tariff.durationMin,
      priceCents: tariff.priceCents,
      priceEuro: centsToEuro(tariff.priceCents),
    };
  }

  if (selected.length > 0 && !equipmentBookable) {
    return { error: "Wellness equipment пока недоступно" };
  }

  const equipment: MassageV1EquipmentLine[] = [];
  let extraMin = 0;
  let extraCents = 0;

  for (const id of selected) {
    if (includedSet.has(id)) {
      return {
        error: "Premium Wellness already includes wellness equipment",
      };
    }
    const row = WELLNESS_EQUIPMENT[id];
    if (!row.available) {
      return { error: "Wellness equipment unavailable" };
    }
    equipment.push({
      id,
      priceCents: row.priceCents,
      extraBookingMin: row.extraBookingMin,
      included: false,
    });
    extraMin += row.extraBookingMin;
    extraCents += row.priceCents;
  }

  const priceCents = tariff.priceCents + extraCents;

  return {
    tariffId: tariff.id,
    catalogVersion: MASSAGE_V1_CATALOG_VERSION,
    quoteRevision: MASSAGE_V1_QUOTE_REVISION,
    baseDurationMin: tariff.durationMin,
    basePriceCents: tariff.priceCents,
    equipment,
    includedEquipment: [],
    totalSessionMinutes: tariff.durationMin + extraMin,
    priceCents,
    priceEuro: centsToEuro(priceCents),
  };
}

/** Build JSONB pricing_snapshot for projects1_orders. */
export function buildMassageV1PricingSnapshot(
  result: MassageV1PriceResult,
): Record<string, unknown> {
  return {
    service: "massage",
    massageVersion: "v1",
    catalogVersion: result.catalogVersion,
    quoteRevision: result.quoteRevision,
    tariffId: result.tariffId,
    baseDurationMin: result.baseDurationMin,
    basePriceCents: result.basePriceCents,
    equipment: result.equipment.map((line) => ({
      id: line.id,
      priceCents: line.priceCents,
      extraBookingMin: line.extraBookingMin,
      included: line.included,
    })),
    includedEquipment: [...result.includedEquipment],
    totalSessionMinutes: result.totalSessionMinutes,
    priceCents: result.priceCents,
    priceEuro: result.priceEuro,
  };
}

/** English order details line for Telegram / admin (not localized ids). */
export function formatMassageV1OrderDetails(
  result: MassageV1PriceResult,
): string {
  const parts = [
    `Massage v1 · ${result.tariffId}`,
    `Base: ${result.baseDurationMin} min`,
  ];
  if (result.equipment.length > 0) {
    const extras = result.equipment
      .map((line) => `${line.id} (+${line.extraBookingMin} min)`)
      .join(", ");
    parts.push(`Extras: ${extras}`);
  }
  if (result.includedEquipment.length > 0) {
    parts.push(`Included: ${result.includedEquipment.join(", ")}`);
  }
  parts.push(`Visit: ${result.totalSessionMinutes} min`);
  parts.push(`Total: €${result.priceEuro}`);
  return parts.join(" · ");
}
