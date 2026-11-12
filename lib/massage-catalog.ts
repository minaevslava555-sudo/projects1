/**
 * Premium in-home massage menu for the landing UI.
 * Category id/title is stored in projects1_orders.massage_category.
 * Customer-facing copy lives in messages/*.json (MassageCatalog).
 * Prices/durations live in lib/booking-pricing.ts (MASSAGE_OPTIONS).
 */
export type MassageCategoryId =
  | "relaxing"
  | "back-neck"
  | "face-head"
  | "legs-feet";

export type MassageCategory = {
  id: MassageCategoryId;
  /** Canonical English title for orders / Telegram — do not localize this field. */
  title: string;
  image: string;
};

export const MASSAGE_CATEGORIES: MassageCategory[] = [
  {
    id: "relaxing",
    title: "Relaxing Massage",
    image: "/images/massage-relaxing.jpg",
  },
  {
    id: "back-neck",
    title: "Back & Neck Massage",
    image: "/images/massage-back.jpg",
  },
  {
    id: "face-head",
    title: "Face & Head Massage",
    image: "/images/massage-face.jpg",
  },
  {
    id: "legs-feet",
    title: "Legs & Feet Massage",
    image: "/images/massage-legs.jpg",
  },
];

export function getMassageCategory(id: MassageCategoryId): MassageCategory {
  const found = MASSAGE_CATEGORIES.find((item) => item.id === id);
  if (!found) return MASSAGE_CATEGORIES[0];
  return found;
}
