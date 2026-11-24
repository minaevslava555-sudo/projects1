/**
 * Order pricing orchestration: load active book (injectable) + resolve + snapshots.
 * Default loader is lazy-imported so node:test can import this module without server-only.
 */

import {
  calculateCleaningV1Price,
  cleaningV1AddonsHaveWork,
  isMassageMinutes,
  parseCleaningV1PriceInput,
  type CleaningV1AddonCounts,
  type CleaningV1RoomCounts,
  type CleaningV1Type,
} from "@/lib/booking-pricing";
import {
  resolveBookingPricingFromBook,
  type ResolvedPricingFromBook,
} from "@/lib/booking-pricing-from-book";
import type { ActivePricingBook } from "@/lib/pricing-book-validation";

export type ResolveOrderPricingCleaningV1 = {
  roomCounts: CleaningV1RoomCounts;
  cleaningType: CleaningV1Type;
  addons?: CleaningV1AddonCounts;
};

export type ResolveOrderPricingInput = {
  service: "cleaning" | "massage" | "repair";
  rooms?: number;
  massageMinutes?: number;
  /** Cleaning v1 branch — gated by CLEANING_V1_ORDERS_ENABLED in the HTTP handler. */
  cleaningPricingVersion?: "v1";
  cleaningV1?: ResolveOrderPricingCleaningV1;
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

function resolveCleaningV1Pricing(
  input: ResolveOrderPricingInput,
): ResolveOrderPricingSuccess | ResolveOrderPricingFailure {
  if (input.rooms != null) {
    return {
      ok: false,
      status: 400,
      message: "Уберите устаревшее поле rooms из запроса Cleaning v1",
    };
  }

  const cleaningV1 = input.cleaningV1;
  if (cleaningV1 == null || typeof cleaningV1 !== "object") {
    return {
      ok: false,
      status: 400,
      message: "Некорректные поля Cleaning v1",
    };
  }

  const cleaningV1Record = cleaningV1 as Record<string, unknown>;
  for (const forbidden of [
    "areaM2",
    "recommendedCleaners",
    "estimatedVisitMinutes",
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(cleaningV1Record, forbidden)) {
      return {
        ok: false,
        status: 400,
        message: `Unexpected field: ${forbidden}`,
      };
    }
  }

  const parsed = parseCleaningV1PriceInput({
    rooms: cleaningV1.roomCounts,
    cleaningType: cleaningV1.cleaningType,
    ...(cleaningV1.addons != null ? { addons: cleaningV1.addons } : {}),
  });
  if (!parsed.ok) {
    return { ok: false, status: 400, message: parsed.error };
  }

  const calculated = calculateCleaningV1Price(parsed.value);
  if ("error" in calculated) {
    return { ok: false, status: 400, message: calculated.error };
  }

  const {
    roomMinutes,
    addonMinutes,
    totalPersonMinutes,
    billablePersonMinutes,
    billableHours,
    customerPriceEuro,
    adminReviewRequired,
    minimumPriceApplied,
    recommendedCleaners,
    estimatedVisitMinutes,
  } = calculated;

  const addons = parsed.value.addons;
  const pricingSnapshot: Record<string, unknown> = {
    service: "cleaning",
    cleaningPricingVersion: "v1",
    roomCounts: parsed.value.rooms,
    cleaningType: parsed.value.cleaningType,
    roomMinutes,
    addonMinutes,
    totalPersonMinutes,
    billablePersonMinutes,
    billableHours,
    customerPriceEuro,
    adminReviewRequired,
    minimumPriceApplied,
    recommendedCleaners,
    estimatedVisitMinutes,
  };
  if (addons != null && cleaningV1AddonsHaveWork(addons)) {
    pricingSnapshot.addons = addons;
  }

  if (adminReviewRequired) {
    return {
      ok: true,
      priced: { mode: "quote", priceEuro: null },
      pricingSnapshot,
    };
  }

  if (customerPriceEuro == null || typeof customerPriceEuro !== "number") {
    return {
      ok: false,
      status: 400,
      message: "Некорректная цена Cleaning v1",
    };
  }

  return {
    ok: true,
    priced: { mode: "fixed", priceEuro: customerPriceEuro },
    pricingSnapshot,
  };
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
    if (input.cleaningPricingVersion === "v1") {
      return resolveCleaningV1Pricing(input);
    }

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
