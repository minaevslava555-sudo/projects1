/**
 * Server-only active pricing book loader.
 * Do not import from client components — uses getSupabaseServer (service role).
 */

import "server-only";

import { getSupabaseServer } from "@/lib/supabase/server";
import {
  assertActivePricingConfig,
  assertCleaningRoomPlans,
  assertMassagePrices,
  type ActivePricingBook,
  type PricingMassagePrice,
  type PricingRoomPlan,
} from "@/lib/pricing-book-validation";

export type { ActivePricingBook, PricingMassagePrice, PricingRoomPlan };

/** Loads the single active pricing config plus its cleaning plans and massage prices. */
export async function getActivePricingBook(): Promise<ActivePricingBook> {
  const supabase = getSupabaseServer();

  const { data: configs, error: configError } = await supabase
    .from("projects1_pricing_config")
    .select("id, version, status, cleaning_hourly_rate_euro")
    .eq("status", "active");

  const config = assertActivePricingConfig(configs, configError);

  const { data: planRows, error: plansError } = await supabase
    .from("projects1_cleaning_room_plans")
    .select("rooms, hours, workers, pricing_config_id")
    .eq("pricing_config_id", config.id)
    .order("rooms", { ascending: true });

  const roomPlans = assertCleaningRoomPlans(planRows, plansError);

  const { data: massageRows, error: massageError } = await supabase
    .from("projects1_massage_prices")
    .select("minutes, price_euro, is_active, pricing_config_id")
    .eq("pricing_config_id", config.id)
    .order("minutes", { ascending: true });

  const massagePrices = assertMassagePrices(massageRows, massageError);

  return {
    id: config.id,
    version: config.version,
    cleaningHourlyRateEuro: config.cleaningHourlyRateEuro,
    roomPlans,
    massagePrices,
  };
}
