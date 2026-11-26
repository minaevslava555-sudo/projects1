/**
 * Massage & Wellness v1 — code-first shared catalog (client + server).
 * Prices in integer cents. Legacy MASSAGE_OPTIONS / pricing book stay separate.
 */

export const MASSAGE_V1_CATALOG_VERSION = "v1" as const;
export const MASSAGE_V1_QUOTE_REVISION = "2026-11-25-mw-v1";

export type MassageV1TariffId =
  | "relaxing-60"
  | "sports-60"
  | "targeted-30"
  | "targeted-60"
  | "premium-wellness-120";

export type WellnessEquipmentId =
  | "foot-system"
  | "eye-system"
  | "moxi"
  | "top-relax";

export type MassageV1Tariff = {
  id: MassageV1TariffId;
  /** i18n key under MassageWellness.tariffs.<id> */
  titleKey: string;
  durationMin: number;
  priceCents: number;
  includedEquipment: readonly WellnessEquipmentId[];
  available: boolean;
  /** Local presentation image for landing cards. */
  image: string;
};

export type WellnessEquipment = {
  id: WellnessEquipmentId;
  titleKey: string;
  descriptionKey: string;
  procedureMin: number;
  extraBookingMin: number;
  priceCents: number;
  /** Catalog-level availability; booking still gated by feature flags. */
  available: boolean;
  /** Primary lifestyle / in-use photo for cards and modal hero. */
  image: string;
  /** Studio device photo for booking thumbs and modal detail. */
  deviceImage: string;
};

export const MASSAGE_V1_TARIFF_IDS: readonly MassageV1TariffId[] = [
  "relaxing-60",
  "sports-60",
  "targeted-30",
  "targeted-60",
  "premium-wellness-120",
] as const;

export const WELLNESS_EQUIPMENT_IDS: readonly WellnessEquipmentId[] = [
  "foot-system",
  "eye-system",
  "moxi",
  "top-relax",
] as const;

const TARIFF_SET = new Set<string>(MASSAGE_V1_TARIFF_IDS);
const EQUIPMENT_SET = new Set<string>(WELLNESS_EQUIPMENT_IDS);

export const MASSAGE_V1_TARIFFS: Record<MassageV1TariffId, MassageV1Tariff> = {
  "relaxing-60": {
    id: "relaxing-60",
    titleKey: "relaxing-60",
    durationMin: 60,
    priceCents: 7000,
    includedEquipment: [],
    available: true,
    image: "/images/massage-relaxing.jpg",
  },
  "sports-60": {
    id: "sports-60",
    titleKey: "sports-60",
    durationMin: 60,
    priceCents: 8000,
    includedEquipment: [],
    available: true,
    image: "/images/massage-back.jpg",
  },
  "targeted-30": {
    id: "targeted-30",
    titleKey: "targeted-30",
    durationMin: 30,
    priceCents: 5500,
    includedEquipment: [],
    available: true,
    image: "/images/massage-legs.jpg",
  },
  "targeted-60": {
    id: "targeted-60",
    titleKey: "targeted-60",
    durationMin: 60,
    priceCents: 8500,
    includedEquipment: [],
    available: true,
    image: "/images/massage-legs.jpg",
  },
  "premium-wellness-120": {
    id: "premium-wellness-120",
    titleKey: "premium-wellness-120",
    durationMin: 120,
    priceCents: 12000,
    includedEquipment: ["foot-system", "eye-system", "moxi", "top-relax"],
    available: true,
    image: "/images/service-massage.jpg",
  },
};

export const WELLNESS_EQUIPMENT: Record<
  WellnessEquipmentId,
  WellnessEquipment
> = {
  "foot-system": {
    id: "foot-system",
    titleKey: "foot-system",
    descriptionKey: "foot-system",
    procedureMin: 30,
    extraBookingMin: 30,
    priceCents: 2000,
    available: true,
    image: "/images/wellness/foot-system.webp",
    deviceImage: "/images/wellness/foot-system-device.webp",
  },
  "eye-system": {
    id: "eye-system",
    titleKey: "eye-system",
    descriptionKey: "eye-system",
    procedureMin: 25,
    extraBookingMin: 25,
    priceCents: 1500,
    available: true,
    image: "/images/wellness/eye-system.webp",
    deviceImage: "/images/wellness/eye-system-device.webp",
  },
  moxi: {
    id: "moxi",
    titleKey: "moxi",
    descriptionKey: "moxi",
    procedureMin: 10,
    extraBookingMin: 0,
    priceCents: 1000,
    available: true,
    image: "/images/wellness/moxi.webp",
    deviceImage: "/images/wellness/moxi-device.webp",
  },
  "top-relax": {
    id: "top-relax",
    titleKey: "top-relax",
    descriptionKey: "top-relax",
    procedureMin: 10,
    extraBookingMin: 0,
    priceCents: 1000,
    available: true,
    image: "/images/wellness/top-relax.webp",
    deviceImage: "/images/wellness/top-relax-device.webp",
  },
};

export function isMassageV1TariffId(value: unknown): value is MassageV1TariffId {
  return typeof value === "string" && TARIFF_SET.has(value);
}

export function isWellnessEquipmentId(
  value: unknown,
): value is WellnessEquipmentId {
  return typeof value === "string" && EQUIPMENT_SET.has(value);
}

export function getMassageV1Tariff(
  id: MassageV1TariffId,
): MassageV1Tariff {
  return MASSAGE_V1_TARIFFS[id];
}

export function getWellnessEquipment(
  id: WellnessEquipmentId,
): WellnessEquipment {
  return WELLNESS_EQUIPMENT[id];
}

/** Sort equipment ids in catalog order for fingerprint / display stability. */
export function sortWellnessEquipmentIds(
  ids: readonly WellnessEquipmentId[],
): WellnessEquipmentId[] {
  const order = new Map(
    WELLNESS_EQUIPMENT_IDS.map((id, index) => [id, index]),
  );
  return [...ids].sort(
    (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
  );
}

export function centsToEuro(cents: number): number {
  return cents / 100;
}
