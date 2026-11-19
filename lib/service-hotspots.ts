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
          /* Pulled in from top edge so halo stays inside the stage. */
          { id: "fronts", x: 28, y: 26 },
          { id: "sink", x: 70, y: 44 },
        ],
      },
      {
        id: "bathroom",
        image: "/tmp-imgs/c7.jpg",
        spots: [
          { id: "toilet", x: 42, y: 56 },
          { id: "taps", x: 74, y: 48 },
          { id: "glass", x: 22, y: 42 },
          /* Floor kept low but clear of bottom pulse clipping. */
          { id: "floor", x: 55, y: 78 },
        ],
      },
      {
        id: "bedroom",
        image:
          "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=1600&q=80",
        spots: [
          { id: "under-bed", x: 50, y: 72 },
          { id: "bedding", x: 52, y: 46 },
          { id: "dusting", x: 24, y: 38 },
          { id: "mirrors", x: 76, y: 30 },
        ],
      },
      {
        id: "living",
        image: "/images/service-cleaning.jpg",
        spots: [
          { id: "surfaces", x: 42, y: 58 },
          { id: "floors", x: 58, y: 76 },
          { id: "glass", x: 74, y: 32 },
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
          { id: "shelves", x: 70, y: 34 },
        ],
      },
      {
        id: "bathroom-fix",
        image: "/tmp-imgs/c10.jpg",
        spots: [
          { id: "taps", x: 28, y: 58 },
          { id: "minor-leak", x: 70, y: 52 },
        ],
      },
      {
        id: "living-fix",
        image:
          "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1600&q=80",
        spots: [
          { id: "sockets", x: 62, y: 48 },
          { id: "fixtures", x: 36, y: 28 },
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
