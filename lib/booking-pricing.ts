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
