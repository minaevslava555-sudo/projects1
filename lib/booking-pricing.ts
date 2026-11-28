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

/**
 * Cleaning v1.0 — person-minute quote math (not wall-clock × cleaners).
 * See docs/CLEANING_V1_PRICING.md. Independent of legacy cleaningPlan().
 */
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

/** Extra paid tasks — person-minutes from shared catalog; client never sends euro. */
export type CleaningV1AddonId =
  | "oven"
  | "fridge"
  | "windows"
  | "balcony"
  | "ironing";

export type CleaningV1AddonCounts = Record<CleaningV1AddonId, number>;

export type CleaningV1PriceInput = {
  rooms: CleaningV1RoomCounts;
  cleaningType: CleaningV1Type;
  /** Optional; omitted or all-zero is equivalent. */
  addons?: CleaningV1AddonCounts;
};

export type CleaningV1CrewRecommendation = {
  recommendedCleaners: number;
  /** Visit wall-clock minutes; display-only (ceil to 15). Does not affect price. */
  estimatedVisitMinutes: number;
};

export type CleaningV1PriceResult = {
  roomMinutes: number;
  addonMinutes: number;
  /** Person-minutes after room×type + addons (before billable rounding). */
  totalPersonMinutes: number;
  billablePersonMinutes: number;
  billableHours: number;
  /** VAT-inclusive customer price; null when admin review is required. */
  customerPriceEuro: number | null;
  adminReviewRequired: boolean;
  /** True when the €40 floor raised the customer price. */
  minimumPriceApplied: boolean;
  recommendedCleaners: number;
  estimatedVisitMinutes: number;
};

export type CleaningV1PresetId = "t1" | "t2" | "t3";

/** UI + parser cap per room type. */
export const CLEANING_V1_MAX_ROOMS_PER_TYPE = 8;

/** Default UI + parser cap per add-on id (except windows). */
export const CLEANING_V1_MAX_ADDON_COUNT = 3;

/** Windows are counted per standard window (both sashes); higher cap. */
export const CLEANING_V1_MAX_WINDOWS_ADDON_COUNT = 30;

const CLEANING_V1_ROOM_MINUTES = {
  bedroom: 40,
  livingRoom: 40,
  kitchen: 60,
  bathroom: 45,
  separateWc: 25,
  hallway: 20,
  otherRoom: 30,
} as const satisfies Record<keyof CleaningV1RoomCounts, number>;

/** Shared add-on catalog (person-minutes each). Not scaled by cleaning type. */
export const CLEANING_V1_ADDON_MINUTES = {
  oven: 30,
  fridge: 30,
  windows: 20,
  balcony: 20,
  ironing: 60,
} as const satisfies Record<CleaningV1AddonId, number>;

export const CLEANING_V1_MAX_ADDON_COUNTS = {
  oven: CLEANING_V1_MAX_ADDON_COUNT,
  fridge: CLEANING_V1_MAX_ADDON_COUNT,
  windows: CLEANING_V1_MAX_WINDOWS_ADDON_COUNT,
  balcony: CLEANING_V1_MAX_ADDON_COUNT,
  ironing: CLEANING_V1_MAX_ADDON_COUNT,
} as const satisfies Record<CleaningV1AddonId, number>;

export function cleaningV1MaxAddonCount(id: CleaningV1AddonId): number {
  return CLEANING_V1_MAX_ADDON_COUNTS[id];
}

const CLEANING_V1_MULTIPLIER: Record<CleaningV1Type, number> = {
  standard: 1,
  deep: 1.5,
  post_renovation: 2,
};

/** Catalog person-minutes for one room of this type (before cleaning-type multiplier). */
export function cleaningV1RoomUnitMinutes(
  key: keyof CleaningV1RoomCounts,
): number {
  return CLEANING_V1_ROOM_MINUTES[key];
}

export function cleaningV1CleaningTypeMultiplier(type: CleaningV1Type): number {
  return CLEANING_V1_MULTIPLIER[type];
}

/**
 * Customer-price delta when switching from `from` to `to` (same type/addons shape).
 * Accounts for billable 30-minute rounding and the €40 floor.
 */
export function cleaningV1CustomerPriceDeltaEuro(
  from: CleaningV1PriceInput,
  to: CleaningV1PriceInput,
): number | null {
  const a = calculateCleaningV1Price(from);
  const b = calculateCleaningV1Price(to);
  if ("error" in a || "error" in b) return null;
  if (a.customerPriceEuro == null || b.customerPriceEuro == null) return null;
  return b.customerPriceEuro - a.customerPriceEuro;
}

/**
 * Keep extra-room counts when switching typical-home presets, clamped so
 * base + extra never exceeds CLEANING_V1_MAX_ROOMS_PER_TYPE per key.
 */
export function clampCleaningV1ExtraRoomsForPreset(
  preset: CleaningV1RoomCounts,
  extras: CleaningV1RoomCounts,
): {
  extras: CleaningV1RoomCounts;
  totals: CleaningV1RoomCounts;
  reducedKeys: Array<keyof CleaningV1RoomCounts>;
} {
  const nextExtras = { ...EMPTY_CLEANING_V1_ROOMS };
  const totals = { ...EMPTY_CLEANING_V1_ROOMS };
  const reducedKeys: Array<keyof CleaningV1RoomCounts> = [];
  for (const key of CLEANING_V1_ROOM_KEYS) {
    const maxExtra = Math.max(
      0,
      CLEANING_V1_MAX_ROOMS_PER_TYPE - preset[key],
    );
    const requested = extras[key];
    const clamped = Math.min(Math.max(0, requested), maxExtra);
    nextExtras[key] = clamped;
    totals[key] = Math.min(
      CLEANING_V1_MAX_ROOMS_PER_TYPE,
      preset[key] + clamped,
    );
    if (clamped < requested) {
      reducedKeys.push(key);
    }
  }
  return { extras: nextExtras, totals, reducedKeys };
}

export const CLEANING_V1_MIN_PRICE_EURO = 40;
/** Same €20/person-hour rate used for customer pricing (independent of crew size). */
export const CLEANING_V1_HOURLY_RATE_EURO = 20;
/**
 * Client-only quote-engine revision for unresolved booking attempts.
 * Bump when v1 norms/formula change so the customer re-confirms the new estimate
 * without altering server order fingerprints or idempotency keys.
 */
export const CLEANING_V1_QUOTE_REVISION = "2026-11-24-norms-crew";
/** Billable person-minute rounding step used by Cleaning v1 price math. */
export const CLEANING_V1_BILLABLE_STEP_MINUTES = 30;
const CLEANING_V1_VISIT_STEP_MINUTES = 15;
/**
 * Subtract before ceil so IEEE-754 noise slightly above an exact 30-minute
 * multiple does not bump into the next step (+€10). Keep tiny vs real work
 * (e.g. +0.01 min still rounds up).
 */
const CLEANING_V1_BILLABLE_ROUND_EPS = 1e-9;

export const CLEANING_V1_ROOM_KEYS = Object.keys(
  CLEANING_V1_ROOM_MINUTES,
) as Array<keyof CleaningV1RoomCounts>;

/** Primary wizard steppers; the rest sit under “more rooms”. */
export const CLEANING_V1_PRIMARY_ROOM_KEYS: Array<keyof CleaningV1RoomCounts> = [
  "bedroom",
  "bathroom",
  "kitchen",
];

export const CLEANING_V1_ADVANCED_ROOM_KEYS: Array<keyof CleaningV1RoomCounts> = [
  "livingRoom",
  "separateWc",
  "hallway",
  "otherRoom",
];

export const CLEANING_V1_ADDON_KEYS = Object.keys(
  CLEANING_V1_ADDON_MINUTES,
) as CleaningV1AddonId[];

const CLEANING_V1_ROOM_KEY_SET = new Set<string>(CLEANING_V1_ROOM_KEYS);
const CLEANING_V1_ADDON_KEY_SET = new Set<string>(CLEANING_V1_ADDON_KEYS);

const CLEANING_V1_PRICE_INPUT_KEYS = new Set([
  "rooms",
  "cleaningType",
  "addons",
]);

export const EMPTY_CLEANING_V1_ROOMS: CleaningV1RoomCounts = {
  bedroom: 0,
  livingRoom: 0,
  kitchen: 0,
  bathroom: 0,
  separateWc: 0,
  hallway: 0,
  otherRoom: 0,
};

export const EMPTY_CLEANING_V1_ADDONS: CleaningV1AddonCounts = {
  oven: 0,
  fridge: 0,
  windows: 0,
  balcony: 0,
  ironing: 0,
};

/** Typical PT apartment shapes — fill roomCounts; client may edit after. */
export const CLEANING_V1_PRESETS: Record<
  CleaningV1PresetId,
  CleaningV1RoomCounts
> = {
  t1: {
    ...EMPTY_CLEANING_V1_ROOMS,
    bedroom: 1,
    livingRoom: 1,
    kitchen: 1,
    bathroom: 1,
    hallway: 1,
  },
  t2: {
    ...EMPTY_CLEANING_V1_ROOMS,
    bedroom: 2,
    livingRoom: 1,
    kitchen: 1,
    bathroom: 1,
    hallway: 1,
  },
  t3: {
    ...EMPTY_CLEANING_V1_ROOMS,
    bedroom: 3,
    livingRoom: 1,
    kitchen: 1,
    bathroom: 2,
    hallway: 1,
  },
};

export function cleaningV1AddonsHaveWork(addons: CleaningV1AddonCounts): boolean {
  return CLEANING_V1_ADDON_KEYS.some((key) => addons[key] > 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function isCleaningV1Type(value: unknown): value is CleaningV1Type {
  return value === "standard" || value === "deep" || value === "post_renovation";
}

function parseCleaningV1AddonCounts(
  raw: unknown,
): { ok: true; value: CleaningV1AddonCounts } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "Invalid add-on counts" };
  }
  const keys = Object.keys(raw);
  if (keys.length !== CLEANING_V1_ADDON_KEYS.length) {
    return { ok: false, error: "Invalid add-on counts" };
  }
  for (const key of keys) {
    if (!CLEANING_V1_ADDON_KEY_SET.has(key)) {
      return { ok: false, error: `Unexpected add-on key: ${key}` };
    }
  }
  const addons = {} as CleaningV1AddonCounts;
  for (const key of CLEANING_V1_ADDON_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      return { ok: false, error: `Invalid add-on count: ${key}` };
    }
    const count = raw[key];
    if (
      !isNonNegativeInt(count) ||
      count > CLEANING_V1_MAX_ADDON_COUNTS[key as CleaningV1AddonId]
    ) {
      return { ok: false, error: `Invalid add-on count: ${key}` };
    }
    addons[key] = count;
  }
  return { ok: true, value: addons };
}

export type ParseCleaningV1PriceInputResult =
  | { ok: true; value: CleaningV1PriceInput }
  | { ok: false; error: string };

/**
 * Strict Cleaning v1 pricing input parser. No string/number coercion.
 * Unexpected top-level, room, or add-on keys are rejected.
 * `addons` is optional; when present every catalog key must be set.
 */
export function parseCleaningV1PriceInput(
  input: unknown,
): ParseCleaningV1PriceInputResult {
  if (!isPlainObject(input)) {
    return { ok: false, error: "Invalid cleaning v1 pricing input" };
  }

  for (const key of Object.keys(input)) {
    if (!CLEANING_V1_PRICE_INPUT_KEYS.has(key)) {
      return { ok: false, error: `Unexpected field: ${key}` };
    }
  }

  if (!Object.prototype.hasOwnProperty.call(input, "cleaningType")) {
    return { ok: false, error: "Invalid cleaning type" };
  }
  if (!isCleaningV1Type(input.cleaningType)) {
    return { ok: false, error: "Invalid cleaning type" };
  }

  if (!Object.prototype.hasOwnProperty.call(input, "rooms")) {
    return { ok: false, error: "Invalid room counts" };
  }
  const roomsRaw = input.rooms;
  if (!isPlainObject(roomsRaw)) {
    return { ok: false, error: "Invalid room counts" };
  }

  const roomKeys = Object.keys(roomsRaw);
  if (roomKeys.length !== CLEANING_V1_ROOM_KEYS.length) {
    return { ok: false, error: "Invalid room counts" };
  }
  for (const key of roomKeys) {
    if (!CLEANING_V1_ROOM_KEY_SET.has(key)) {
      return { ok: false, error: `Unexpected room key: ${key}` };
    }
  }

  const rooms = {} as CleaningV1RoomCounts;
  for (const key of CLEANING_V1_ROOM_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(roomsRaw, key)) {
      return { ok: false, error: `Invalid room count: ${key}` };
    }
    const count = roomsRaw[key];
    if (
      !isNonNegativeInt(count) ||
      count > CLEANING_V1_MAX_ROOMS_PER_TYPE
    ) {
      return { ok: false, error: `Invalid room count: ${key}` };
    }
    rooms[key] = count;
  }

  let addons: CleaningV1AddonCounts = { ...EMPTY_CLEANING_V1_ADDONS };
  if (Object.prototype.hasOwnProperty.call(input, "addons")) {
    const parsedAddons = parseCleaningV1AddonCounts(input.addons);
    if (!parsedAddons.ok) {
      return { ok: false, error: parsedAddons.error };
    }
    addons = parsedAddons.value;
  }

  return {
    ok: true,
    value: {
      rooms,
      cleaningType: input.cleaningType,
      addons,
    },
  };
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
 * Recommend crew from billable person-hours. Visit duration is display-only
 * (person-minutes / cleaners, ceil to 15). Does not affect customer price.
 */
export function recommendCleaningV1Crew(
  billablePersonMinutes: number,
): CleaningV1CrewRecommendation {
  if (
    typeof billablePersonMinutes !== "number" ||
    !Number.isFinite(billablePersonMinutes) ||
    billablePersonMinutes <= 0
  ) {
    return { recommendedCleaners: 1, estimatedVisitMinutes: 0 };
  }

  const billableHours = billablePersonMinutes / 60;
  let recommendedCleaners: number;
  if (billableHours <= 4) {
    recommendedCleaners = 1;
  } else if (billableHours <= 8) {
    recommendedCleaners = 2;
  } else if (billableHours <= 12) {
    recommendedCleaners = 3;
  } else {
    recommendedCleaners = 4;
  }

  const rawVisitMinutes = billablePersonMinutes / recommendedCleaners;
  const estimatedVisitMinutes =
    Math.ceil(
      (rawVisitMinutes - CLEANING_V1_BILLABLE_ROUND_EPS) /
        CLEANING_V1_VISIT_STEP_MINUTES,
    ) * CLEANING_V1_VISIT_STEP_MINUTES;

  return { recommendedCleaners, estimatedVisitMinutes };
}

/**
 * Isolated Cleaning v1.0 quote math. Does not affect cleaningPlan() / booking flow.
 * Customer price is independent of assigned cleaner count (person-hours, not crew size).
 */
export function calculateCleaningV1Price(
  input: CleaningV1PriceInput,
): CleaningV1PriceResult | { error: string } {
  const parsed = parseCleaningV1PriceInput(input);
  if (!parsed.ok) {
    return { error: parsed.error };
  }

  const { rooms, cleaningType, addons } = parsed.value;
  const addonCounts = addons ?? EMPTY_CLEANING_V1_ADDONS;

  let roomMinutes = 0;
  for (const key of CLEANING_V1_ROOM_KEYS) {
    roomMinutes += rooms[key] * CLEANING_V1_ROOM_MINUTES[key];
  }

  let addonMinutes = 0;
  for (const key of CLEANING_V1_ADDON_KEYS) {
    addonMinutes += addonCounts[key] * CLEANING_V1_ADDON_MINUTES[key];
  }

  // Type multiplier applies to rooms only; add-ons stay at catalog person-minutes.
  const totalPersonMinutes =
    roomMinutes * CLEANING_V1_MULTIPLIER[cleaningType] + addonMinutes;
  const billablePersonMinutes =
    roundUpCleaningV1BillableMinutes(totalPersonMinutes);
  const billableHours = billablePersonMinutes / 60;
  const rawPriceEuro = billableHours * CLEANING_V1_HOURLY_RATE_EURO;
  const minimumPriceApplied = rawPriceEuro < CLEANING_V1_MIN_PRICE_EURO;
  const computedPriceEuro = Math.max(
    CLEANING_V1_MIN_PRICE_EURO,
    rawPriceEuro,
  );
  const crew = recommendCleaningV1Crew(billablePersonMinutes);

  return {
    roomMinutes,
    addonMinutes,
    totalPersonMinutes,
    billablePersonMinutes,
    billableHours,
    customerPriceEuro: computedPriceEuro,
    adminReviewRequired: false,
    minimumPriceApplied,
    recommendedCleaners: crew.recommendedCleaners,
    estimatedVisitMinutes: crew.estimatedVisitMinutes,
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
