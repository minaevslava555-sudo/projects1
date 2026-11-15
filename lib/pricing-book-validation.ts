/**
 * Pure active pricing book validation (no Supabase, server-only, env, or network).
 */

export type PricingRoomPlan = {
  rooms: number;
  hours: number;
  workers: number;
};

export type PricingMassagePrice = {
  minutes: number;
  priceEuro: number;
  isActive: boolean;
};

export type ActivePricingBook = {
  id: string;
  version: number;
  cleaningHourlyRateEuro: number;
  roomPlans: PricingRoomPlan[];
  massagePrices: PricingMassagePrice[];
};

export type ActivePricingConfig = {
  id: string;
  version: number;
  cleaningHourlyRateEuro: number;
};

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Parses Supabase monetary fields (number or decimal string) to a positive EUR amount (≤2 dp). */
function parsePositiveEuro(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    const scaled = value * 100;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-8) return null;
    return value;
  }
  if (typeof value === "string") {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }
  return null;
}

function fail(message: string): never {
  throw new Error(message);
}

/** Validates the active pricing_config query result (exactly one well-formed active row). */
export function assertActivePricingConfig(
  configs: unknown,
  configError: unknown,
): ActivePricingConfig {
  if (configError) {
    fail("Не удалось загрузить активный прайс");
  }
  if (!Array.isArray(configs) || configs.length === 0) {
    fail("Активный прайс не найден");
  }
  if (configs.length > 1) {
    fail("Найдено несколько активных прайсов");
  }

  const config = configs[0] as Record<string, unknown> | null | undefined;
  if (!config || typeof config.id !== "string" || !config.id) {
    fail("Некорректный активный прайс");
  }
  if (!isPositiveInt(config.version)) {
    fail("Некорректная версия активного прайса");
  }
  const cleaningHourlyRateEuro = parsePositiveEuro(config.cleaning_hourly_rate_euro);
  if (cleaningHourlyRateEuro == null) {
    fail("Некорректная почасовая ставка активного прайса");
  }

  return {
    id: config.id,
    version: config.version,
    cleaningHourlyRateEuro,
  };
}

/** Validates cleaning_room_plans query rows for an active book. */
export function assertCleaningRoomPlans(
  planRows: unknown,
  plansError: unknown,
): PricingRoomPlan[] {
  if (plansError) {
    fail("Не удалось загрузить планы уборки");
  }
  if (!Array.isArray(planRows) || planRows.length === 0) {
    fail("Планы уборки для активного прайса не найдены");
  }

  const roomPlans: PricingRoomPlan[] = [];
  const seenRooms = new Set<number>();
  for (const raw of planRows) {
    const row = raw as Record<string, unknown>;
    if (
      !isPositiveInt(row.rooms) ||
      row.rooms > 6 ||
      !isPositiveInt(row.hours) ||
      !isPositiveInt(row.workers)
    ) {
      fail("Некорректный план уборки в активном прайсе");
    }
    if (seenRooms.has(row.rooms)) {
      fail("Дублирующиеся планы уборки в активном прайсе");
    }
    seenRooms.add(row.rooms);
    roomPlans.push({
      rooms: row.rooms,
      hours: row.hours,
      workers: row.workers,
    });
  }
  for (let rooms = 1; rooms <= 6; rooms += 1) {
    if (!seenRooms.has(rooms)) {
      fail("В активном прайсе неполный набор планов уборки (комнаты 1–6)");
    }
  }
  return roomPlans;
}

/** Validates massage_prices query rows for an active book. */
export function assertMassagePrices(
  massageRows: unknown,
  massageError: unknown,
): PricingMassagePrice[] {
  if (massageError) {
    fail("Не удалось загрузить цены массажа");
  }
  if (!Array.isArray(massageRows) || massageRows.length === 0) {
    fail("Цены массажа для активного прайса не найдены");
  }

  const massagePrices: PricingMassagePrice[] = [];
  const seenMinutes = new Set<number>();
  for (const raw of massageRows) {
    const row = raw as Record<string, unknown>;
    const priceEuro = parsePositiveEuro(row.price_euro);
    if (!isPositiveInt(row.minutes) || priceEuro == null || typeof row.is_active !== "boolean") {
      fail("Некорректная цена массажа в активном прайсе");
    }
    if (seenMinutes.has(row.minutes)) {
      fail("Дублирующиеся цены массажа в активном прайсе");
    }
    seenMinutes.add(row.minutes);
    massagePrices.push({
      minutes: row.minutes,
      priceEuro,
      isActive: row.is_active,
    });
  }
  for (const minutes of [60, 90, 120] as const) {
    const entry = massagePrices.find((price) => price.minutes === minutes);
    if (!entry) {
      fail("В активном прайсе неполный набор цен массажа (60/90/120)");
    }
    if (!entry.isActive) {
      fail("В активном прайсе есть неактивная цена массажа (нужны 60/90/120)");
    }
  }
  return massagePrices;
}

/**
 * Builds ActivePricingBook from a validated config plus the three query result datasets
 * (config rows already reduced via assertActivePricingConfig; plans/massage as raw query results).
 */
export function buildActivePricingBook(
  config: ActivePricingConfig,
  planRows: unknown,
  plansError: unknown,
  massageRows: unknown,
  massageError: unknown,
): ActivePricingBook {
  const roomPlans = assertCleaningRoomPlans(planRows, plansError);
  const massagePrices = assertMassagePrices(massageRows, massageError);
  return {
    id: config.id,
    version: config.version,
    cleaningHourlyRateEuro: config.cleaningHourlyRateEuro,
    roomPlans,
    massagePrices,
  };
}
