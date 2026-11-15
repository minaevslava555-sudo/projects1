/**
 * Order pricing orchestration: load active book (injectable) + resolve + snapshots.
 * Default loader is lazy-imported so node:test can import this module without server-only.
 */

import { isMassageMinutes } from "@/lib/booking-pricing";
import {
  resolveBookingPricingFromBook,
  type ResolvedPricingFromBook,
} from "@/lib/booking-pricing-from-book";
import type { ActivePricingBook } from "@/lib/pricing-book-validation";

export type ResolveOrderPricingInput = {
  service: "cleaning" | "massage" | "repair";
  rooms?: number;
  massageMinutes?: number;
};

export type ResolveOrderPricingSuccess = {
  ok: true;
  priced: ResolvedPricingFromBook;
  pricingConfigId?: string;
  pricingVersion?: number;
  hourlyRateSnapshot?: number;
  pricingSnapshot?: Record<string, unknown> | null;
};

export type ResolveOrderPricingFailure = {
  ok: false;
  status: 400 | 502;
  message: string;
};

export type LoadActivePricingBook = () => Promise<ActivePricingBook>;

const BOOK_UNAVAILABLE = "Не удалось получить актуальные тарифы";

async function defaultLoadBook(): Promise<ActivePricingBook> {
  const { getActivePricingBook } = await import("@/lib/pricing-book");
  return getActivePricingBook();
}

export async function resolveOrderPricing(
  input: ResolveOrderPricingInput,
  loadBook: LoadActivePricingBook = defaultLoadBook,
): Promise<ResolveOrderPricingSuccess | ResolveOrderPricingFailure> {
  if (input.service === "repair") {
    return {
      ok: true,
      priced: { mode: "quote", priceEuro: null },
    };
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
      return { ok: false, status: 400, message: "Укажите число комнат (1–6)" };
    }

    let book: ActivePricingBook;
    try {
      book = await loadBook();
    } catch {
      return { ok: false, status: 502, message: BOOK_UNAVAILABLE };
    }

    const resolved = resolveBookingPricingFromBook(book, {
      service: "cleaning",
      rooms,
    });
    if ("error" in resolved || resolved.mode !== "fixed") {
      return { ok: false, status: 502, message: BOOK_UNAVAILABLE };
    }

    return {
      ok: true,
      priced: resolved,
      pricingConfigId: book.id,
      pricingVersion: book.version,
      hourlyRateSnapshot: book.cleaningHourlyRateEuro,
      pricingSnapshot: {
        service: "cleaning",
        pricingConfigId: book.id,
        pricingVersion: book.version,
        rooms,
        hours: resolved.hours,
        workers: resolved.workers,
        cleaningHourlyRateEuro: book.cleaningHourlyRateEuro,
        priceEuro: resolved.priceEuro,
      },
    };
  }

  const massageMinutes = input.massageMinutes;
  if (massageMinutes == null || !isMassageMinutes(massageMinutes)) {
    return { ok: false, status: 400, message: "Укажите длительность сеанса" };
  }

  let book: ActivePricingBook;
  try {
    book = await loadBook();
  } catch {
    return { ok: false, status: 502, message: BOOK_UNAVAILABLE };
  }

  const resolved = resolveBookingPricingFromBook(book, {
    service: "massage",
    massageMinutes,
  });
  if ("error" in resolved || resolved.mode !== "fixed") {
    return { ok: false, status: 502, message: BOOK_UNAVAILABLE };
  }

  return {
    ok: true,
    priced: resolved,
    pricingConfigId: book.id,
    pricingVersion: book.version,
    pricingSnapshot: {
      service: "massage",
      pricingConfigId: book.id,
      pricingVersion: book.version,
      massageMinutes: resolved.massageMinutes,
      priceEuro: resolved.priceEuro,
    },
  };
}
