import {
  MASSAGE_V1_TARIFFS,
  type MassageV1TariffId,
  type WellnessEquipmentId,
} from "@/lib/massage-wellness-catalog";

export function isPremiumWellnessTariff(
  tariffId: MassageV1TariffId | null | undefined,
): boolean {
  return tariffId === "premium-wellness-120";
}

/**
 * Display names for included Premium kit — order comes from the tariff catalog,
 * not a hard-coded UI list.
 */
export function formatIncludedEquipmentItems(
  includedEquipment: readonly WellnessEquipmentId[],
  nameOf: (id: WellnessEquipmentId) => string,
): string {
  return includedEquipment.map((id) => nameOf(id)).join(", ");
}

export function premiumCatalogIncludedEquipment(): readonly WellnessEquipmentId[] {
  return MASSAGE_V1_TARIFFS["premium-wellness-120"].includedEquipment;
}
