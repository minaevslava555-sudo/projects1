/**
 * Premium in-home massage menu for the landing UI.
 * Category choice is not a dedicated DB column — it is written into order `details`
 * together with duration. Prices/durations stay in MASSAGE_OPTIONS on the page.
 */
export type MassageCategoryId =
  | "relaxing"
  | "back-neck"
  | "face-head"
  | "legs-feet";

export type MassageCategory = {
  id: MassageCategoryId;
  title: string;
  short: string;
  description: string;
  focus: string[];
  image: string;
  imageAlt: string;
};

export const MASSAGE_CATEGORIES: MassageCategory[] = [
  {
    id: "relaxing",
    title: "Relaxing Massage",
    short: "A quiet full-body reset in the comfort of your own villa or apartment.",
    description:
      "A calm, unhurried session delivered where you live — no travel, no waiting room. Soft pacing and a private atmosphere so you can settle into rest at home in the Algarve.",
    focus: [
      "Full-body calm at your place",
      "Soft, unhurried pace",
      "Private home setting",
      "Easy wind-down after the session",
    ],
    image: "/images/massage-relaxing.jpg",
    imageAlt: "In-home relaxing massage in a bright residential interior",
  },
  {
    id: "back-neck",
    title: "Back & Neck Massage",
    short: "Focused back and neck care without leaving your living space.",
    description:
      "Shoulders, neck and back — treated at home after desk work, driving or a long day. You stay in your own space; we bring the session to you.",
    focus: [
      "Neck and shoulder focus",
      "Upper and lower back care",
      "Session in your home",
      "Steady, grounded finish",
    ],
    image: "/images/massage-back.jpg",
    imageAlt: "Back massage prepared in a warm home setting",
  },
  {
    id: "face-head",
    title: "Face & Head Massage",
    short: "Gentle face and scalp work in the quiet of your own rooms.",
    description:
      "Light touch for the face, temples, jaw and scalp — in a familiar, private space. Ideal when you want mental quiet without stepping into a salon.",
    focus: [
      "Temple and jaw ease",
      "Scalp and hairline calm",
      "Soft facial touch",
      "Quiet closing moments",
    ],
    image: "/images/massage-face.jpg",
    imageAlt: "Gentle face and head massage in a home wellness setting",
  },
  {
    id: "legs-feet",
    title: "Legs & Feet Massage",
    short: "Legs and feet cared for at home after walks, travel or a warm day.",
    description:
      "From calves to soles — delivered in your villa or apartment so tired legs can recover where you already are. Steady rhythm, grounded comfort, no clinic feel.",
    focus: [
      "Thigh and calf focus",
      "Ankle and foot care",
      "At-home convenience",
      "Light, settling finish",
    ],
    image: "/images/massage-legs.jpg",
    imageAlt: "Legs and feet massage on a soft towel at home",
  },
];

export function getMassageCategory(id: MassageCategoryId): MassageCategory {
  const found = MASSAGE_CATEGORIES.find((item) => item.id === id);
  if (!found) return MASSAGE_CATEGORIES[0];
  return found;
}
