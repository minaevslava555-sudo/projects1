export type ServiceValue = "cleaning" | "repair" | "massage";

/** Structural hotspot only — copy lives in messages/*.json under ServiceDetail. */
export type HotspotSpot = {
  id: string;
  x: number;
  y: number;
};

export type HotspotScene = {
  id: string;
  image: string;
  spots: HotspotSpot[];
};

export type HotspotService = Exclude<ServiceValue, "massage">;

export type ServiceHotspotPack = {
  service: HotspotService;
  scenes: HotspotScene[];
};

/** Hotspot room tours — Cleaning & Home Repairs only. Massage uses the catalog UI. */
export const SERVICE_HOTSPOTS: Record<HotspotService, ServiceHotspotPack> = {
  cleaning: {
    service: "cleaning",
    scenes: [
      {
        id: "kitchen",
        image: "/tmp-imgs/clean4.jpg",
        spots: [
          { id: "hob", x: 48, y: 58 },
          { id: "counters", x: 52, y: 42 },
          { id: "fronts", x: 28, y: 22 },
          { id: "sink", x: 72, y: 44 },
        ],
      },
      {
        id: "bathroom",
        image: "/tmp-imgs/c7.jpg",
        spots: [
          { id: "toilet", x: 42, y: 56 },
          { id: "taps", x: 78, y: 48 },
          { id: "glass", x: 18, y: 42 },
          { id: "floor", x: 55, y: 86 },
        ],
      },
      {
        id: "bedroom",
        image:
          "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=1600&q=80",
        spots: [
          { id: "under-bed", x: 50, y: 74 },
          { id: "bedding", x: 52, y: 46 },
          { id: "dusting", x: 20, y: 38 },
          { id: "mirrors", x: 82, y: 28 },
        ],
      },
      {
        id: "living",
        image: "/images/service-cleaning.jpg",
        spots: [
          { id: "surfaces", x: 42, y: 58 },
          { id: "floors", x: 58, y: 84 },
          { id: "glass", x: 78, y: 32 },
        ],
      },
    ],
  },
  repair: {
    service: "repair",
    scenes: [
      {
        id: "furniture",
        image:
          "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1600&q=80",
        spots: [
          { id: "assemble", x: 48, y: 52 },
          { id: "shelves", x: 72, y: 34 },
        ],
      },
      {
        id: "bathroom-fix",
        image: "/tmp-imgs/c10.jpg",
        spots: [
          { id: "taps", x: 28, y: 58 },
          { id: "minor-leak", x: 72, y: 52 },
        ],
      },
      {
        id: "living-fix",
        image:
          "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1600&q=80",
        spots: [
          { id: "sockets", x: 62, y: 48 },
          { id: "fixtures", x: 36, y: 26 },
        ],
      },
      {
        id: "hallway",
        image:
          "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=80",
        spots: [
          { id: "hinges", x: 44, y: 46 },
          { id: "handles", x: 58, y: 52 },
        ],
      },
    ],
  },
};
