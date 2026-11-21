/** Shared HAVENLY booking prices — used by UI and server. */

export type BookingService = "cleaning" | "repair" | "massage";
export type PricingMode = "fixed" | "quote";
export type MassageMinutes = 60 | 90 | 120;

export const HOURLY_RATE_EURO = 20;

export const MASSAGE_OPTIONS: Array<{
  minutes: MassageMinutes;
  price: number;
  label: string;
}> = [
  { minutes: 60, price: 45, label: "60 min — 45€" },
  { minutes: 90, price: 67.5, label: "90 min — 67.50€" },
  { minutes: 120, price: 90, label: "120 min — 90€" },
];

const MASSAGE_MINUTES = new Set<number>([60, 90, 120]);

/** Rooms 1–6 → planned hours and cleaners (existing landing rules). */
export function cleaningPlan(rooms: number): { hours: number; workers: number } {
  switch (Math.min(6, Math.max(1, rooms))) {
    case 1:
      return { hours: 2, workers: 1 };
    case 2:
      return { hours: 3, workers: 1 };
    case 3:
      return { hours: 4, workers: 2 };
    case 4:
      return { hours: 5, workers: 2 };
    case 5:
    case 6:
    default:
      return { hours: 6, workers: 3 };
  }
}

export function cleaningPriceEuro(rooms: number): number {
  const plan = cleaningPlan(rooms);
  return plan.hours * plan.workers * HOURLY_RATE_EURO;
}

/** Cleaning v1.0 room composition — independent of legacy room-count tiers. */
export type CleaningV1RoomCounts = {
  bedroom: number;
  livingRoom: number;
  kitchen: number;
  bathroom: number;
  separateWc: number;
  hallway: number;
  otherRoom: number;
};

export type CleaningV1Type = "standard" | "deep" | "post_renovation";

export type CleaningV1PriceInput = {
  rooms: CleaningV1RoomCounts;
  areaM2: number;
  cleaningType: CleaningV1Type;
};

export type CleaningV1PriceResult = {
  roomMinutes: number;
  areaAdjustmentMinutes: number;
  /** Person-minutes after area adjustment and cleaning-type multiplier (before rounding). */
  totalPersonMinutes: number;
  billablePersonMinutes: number;
  billableHours: number;
  /** VAT-inclusive customer price; null when admin review is required. */
  customerPriceEuro: number | null;
  adminReviewRequired: boolean;
};

const CLEANING_V1_ROOM_MINUTES = {
  bedroom: 30,
  livingRoom: 40,
  kitchen: 60,
  bathroom: 45,
  separateWc: 25,
  hallway: 20,
  otherRoom: 30,
} as const satisfies Record<keyof CleaningV1RoomCounts, number>;

const CLEANING_V1_MULTIPLIER: Record<CleaningV1Type, number> = {
  standard: 1,
  deep: 1.5,
  post_renovation: 2,
};

const CLEANING_V1_MIN_PRICE_EURO = 40;
const CLEANING_V1_HOURLY_RATE_EURO = 20;
const CLEANING_V1_AREA_FREE_M2 = 80;
const CLEANING_V1_AREA_MINUTES_PER_M2 = 0.6;
const CLEANING_V1_BILLABLE_STEP_MINUTES = 30;
const CLEANING_V1_ADMIN_REVIEW_AREA_M2 = 180;
/**
 * Subtract before ceil so IEEE-754 noise slightly above an exact 30-minute
 * multiple does not bump into the next step (+€10). Keep tiny vs real work
 * (e.g. +0.01 min still rounds up).
 */
const CLEANING_V1_BILLABLE_ROUND_EPS = 1e-9;

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isCleaningV1Type(value: unknown): value is CleaningV1Type {
  return value === "standard" || value === "deep" || value === "post_renovation";
}

/** Round person-minutes up to the next 30-minute billable step (float-safe). */
export function roundUpCleaningV1BillableMinutes(
  totalPersonMinutes: number,
): number {
  if (totalPersonMinutes <= 0) return 0;
  return (
    Math.ceil(
      (totalPersonMinutes - CLEANING_V1_BILLABLE_ROUND_EPS) /
        CLEANING_V1_BILLABLE_STEP_MINUTES,
    ) * CLEANING_V1_BILLABLE_STEP_MINUTES
  );
}

/**
 * Isolated Cleaning v1.0 quote math. Does not affect cleaningPlan() / booking flow.
 * Customer price is independent of assigned cleaner count.
 */
export function calculateCleaningV1Price(
  input: CleaningV1PriceInput,
): CleaningV1PriceResult | { error: string } {
  if (!input || typeof input !== "object") {
    return { error: "Invalid cleaning v1 pricing input" };
  }
  if (!isCleaningV1Type(input.cleaningType)) {
    return { error: "Invalid cleaning type" };
  }
  if (
    typeof input.areaM2 !== "number" ||
    !Number.isFinite(input.areaM2) ||
    input.areaM2 <= 0
  ) {
    return { error: "Invalid area (m²)" };
  }

  const rooms = input.rooms;
  if (!rooms || typeof rooms !== "object") {
    return { error: "Invalid room counts" };
  }
  for (const key of Object.keys(CLEANING_V1_ROOM_MINUTES) as Array<
    keyof CleaningV1RoomCounts
  >) {
    if (!isNonNegativeInt(rooms[key])) {
      return { error: `Invalid room count: ${key}` };
    }
  }

  let roomMinutes = 0;
  for (const key of Object.keys(CLEANING_V1_ROOM_MINUTES) as Array<
    keyof CleaningV1RoomCounts
  >) {
    roomMinutes += rooms[key] * CLEANING_V1_ROOM_MINUTES[key];
  }

  const areaAdjustmentMinutes =
    Math.max(0, input.areaM2 - CLEANING_V1_AREA_FREE_M2) *
    CLEANING_V1_AREA_MINUTES_PER_M2;
  const totalPersonMinutes =
    (roomMinutes + areaAdjustmentMinutes) *
    CLEANING_V1_MULTIPLIER[input.cleaningType];
  const billablePersonMinutes =
    roundUpCleaningV1BillableMinutes(totalPersonMinutes);
  const billableHours = billablePersonMinutes / 60;
  const adminReviewRequired = input.areaM2 > CLEANING_V1_ADMIN_REVIEW_AREA_M2;
  const computedPriceEuro = Math.max(
    CLEANING_V1_MIN_PRICE_EURO,
    billableHours * CLEANING_V1_HOURLY_RATE_EURO,
  );

  return {
    roomMinutes,
    areaAdjustmentMinutes,
    totalPersonMinutes,
    billablePersonMinutes,
    billableHours,
    customerPriceEuro: adminReviewRequired ? null : computedPriceEuro,
    adminReviewRequired,
  };
}

export function isMassageMinutes(value: number): value is MassageMinutes {
  return MASSAGE_MINUTES.has(value);
}

export function massagePriceEuro(minutes: number): number | null {
  if (!isMassageMinutes(minutes)) return null;
  return MASSAGE_OPTIONS.find((option) => option.minutes === minutes)?.price ?? null;
}

/** Preferred start slots 09:00–19:00 inclusive, every 30 minutes. */
export function buildTimeSlots(): string[] {
  const slots: string[] = [];
  for (let minutes = 9 * 60; minutes <= 19 * 60; minutes += 30) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return slots;
}

const TIME_SLOT_SET = new Set(buildTimeSlots());

export function isValidPreferredTime(value: string): boolean {
  return TIME_SLOT_SET.has(value);
}

export type ResolvedPricing =
  | {
      mode: "fixed";
      priceEuro: number;
      hours?: number;
      workers?: number;
      massageMinutes?: MassageMinutes;
    }
  | {
      mode: "quote";
      priceEuro: null;
    };

export function resolveBookingPricing(input: {
  service: BookingService;
  rooms?: number;
  massageMinutes?: number;
}): ResolvedPricing | { error: string } {
  if (input.service === "repair") {
    return { mode: "quote", priceEuro: null };
  }

  if (input.service === "cleaning") {
    const rooms = input.rooms;
    if (!rooms || rooms < 1 || rooms > 6) {
      return { error: "Укажите число комнат (1–6)" };
    }
    const plan = cleaningPlan(rooms);
    return {
      mode: "fixed",
      priceEuro: plan.hours * plan.workers * HOURLY_RATE_EURO,
      hours: plan.hours,
      workers: plan.workers,
    };
  }

  const minutes = input.massageMinutes;
  if (minutes == null || !isMassageMinutes(minutes)) {
    return { error: "Укажите длительность сеанса" };
  }
  const price = massagePriceEuro(minutes);
  if (price == null) {
    return { error: "Укажите длительность сеанса" };
  }
  return { mode: "fixed", priceEuro: price, massageMinutes: minutes };
}

export function formatEuro(value: number) {
  return new Intl.NumberFormat("en-EU", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}
