/**
 * Pure booking price resolution from an ActivePricingBook (no network / env / hardcodes).
 */

import type { ActivePricingBook } from "@/lib/pricing-book-validation";

export type BookingServiceFromBook = "cleaning" | "repair" | "massage";
export type MassageMinutesFromBook = 60 | 90 | 120;

export type ResolvedPricingFromBook =
  | {
      mode: "fixed";
      priceEuro: number;
      hours?: number;
      workers?: number;
      massageMinutes?: MassageMinutesFromBook;
    }
  | {
      mode: "quote";
      priceEuro: null;
    };

function isMassageMinutes(value: number): value is MassageMinutesFromBook {
  return value === 60 || value === 90 || value === 120;
}

export function resolveBookingPricingFromBook(
  book: ActivePricingBook,
  input: {
    service: BookingServiceFromBook;
    rooms?: number;
    massageMinutes?: number;
  },
): ResolvedPricingFromBook | { error: string } {
  if (input.service === "repair") {
    return { mode: "quote", priceEuro: null };
  }

  if (input.service === "cleaning") {
    const rooms = input.rooms;
    if (
      rooms == null ||
      typeof rooms !== "number" ||
      !Number.isInteger(rooms) ||
      rooms < 1 ||
      rooms > 6
    ) {
      return { error: "Укажите число комнат (1–6)" };
    }

    const plan = book.roomPlans.find((row) => row.rooms === rooms);
    if (!plan) {
      return { error: "Укажите число комнат (1–6)" };
    }

    return {
      mode: "fixed",
      priceEuro: plan.hours * plan.workers * book.cleaningHourlyRateEuro,
      hours: plan.hours,
      workers: plan.workers,
    };
  }

  const minutes = input.massageMinutes;
  if (minutes == null || typeof minutes !== "number" || !isMassageMinutes(minutes)) {
    return { error: "Укажите длительность сеанса" };
  }

  const priceRow = book.massagePrices.find(
    (row) => row.minutes === minutes && row.isActive,
  );
  if (!priceRow) {
    return { error: "Укажите длительность сеанса" };
  }

  return {
    mode: "fixed",
    priceEuro: priceRow.priceEuro,
    massageMinutes: minutes,
  };
}
