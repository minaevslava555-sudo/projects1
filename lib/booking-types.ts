import type { BookingService, MassageMinutes, PricingMode } from "@/lib/booking-pricing";

export type OrderRecord = {
  name: string;
  phone: string;
  service: BookingService;
  pricingMode: PricingMode;
  /** Required for fixed; null for quote repairs. */
  priceEuro: number | null;
  date: string;
  preferredTime: string;
  streetAddress: string;
  city: string;
  apartmentFloor?: string;
  accessInstructions?: string;
  details?: string;
  rooms?: number;
  hours?: number;
  workers?: number;
  massageMinutes?: MassageMinutes;
  massageCategory?: string;
  problemDescription?: string;
  repairPhotoPaths?: string[];
  orderRef: string;
};
