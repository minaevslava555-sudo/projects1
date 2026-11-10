export type ServiceValue = "cleaning" | "repair" | "massage";

export type HotspotSpot = {
  id: string;
  x: number;
  y: number;
  title: string;
  text: string;
};

export type HotspotScene = {
  id: string;
  label: string;
  image?: string;
  kind?: "image" | "svg-body";
  spots: HotspotSpot[];
};

export type ServiceHotspotPack = {
  service: ServiceValue;
  title: string;
  subtitle: string;
  scenes: HotspotScene[];
};

export const SERVICE_HOTSPOTS: Record<ServiceValue, ServiceHotspotPack> = {
  cleaning: {
    service: "cleaning",
    title: "Cleaning",
    subtitle: "Explore each room — tap a marker to see exactly what we clean.",
    scenes: [
      {
        id: "kitchen",
        label: "Kitchen",
        image: "/tmp-imgs/clean4.jpg",
        spots: [
          {
            id: "hob",
            x: 48,
            y: 58,
            title: "Hob & stove",
            text: "We degrease the hob, burners and nearby splash zones until they look brand new.",
          },
          {
            id: "counters",
            x: 52,
            y: 42,
            title: "Worktops",
            text: "Counters are wiped, crumbs removed, and every surface left fresh and clear.",
          },
          {
            id: "fronts",
            x: 28,
            y: 22,
            title: "Cabinet fronts",
            text: "Fronts and handles are cleaned of fingerprints, marks and light grease.",
          },
          {
            id: "sink",
            x: 72,
            y: 44,
            title: "Sink & faucet",
            text: "The sink and faucet are cleaned and polished, with available dishes washed and left tidy.",
          },
        ],
      },
      {
        id: "bathroom",
        label: "Bathroom",
        image: "/tmp-imgs/c7.jpg",
        spots: [
          {
            id: "toilet",
            x: 42,
            y: 56,
            title: "Toilet",
            text: "The bowl and seat are disinfected carefully for a hygienic finish.",
          },
          {
            id: "taps",
            x: 78,
            y: 48,
            title: "Taps & chrome",
            text: "Mixers and chrome details are washed and polished to a soft shine.",
          },
          {
            id: "glass",
            x: 18,
            y: 42,
            title: "Shower glass",
            text: "Glass panels are cleaned streak-free so the shower feels bright again.",
          },
          {
            id: "floor",
            x: 55,
            y: 86,
            title: "Floor",
            text: "The bathroom floor is vacuumed and mopped with care.",
          },
        ],
      },
      {
        id: "bedroom",
        label: "Bedroom",
        image:
          "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=1600&q=80",
        spots: [
          {
            id: "under-bed",
            x: 50,
            y: 74,
            title: "Under the bed",
            text: "Accessible areas under the bed are vacuumed and left dust-free.",
          },
          {
            id: "bedding",
            x: 52,
            y: 46,
            title: "Bedding",
            text: "Bed linen is straightened or remade so the room feels calm and finished.",
          },
          {
            id: "dusting",
            x: 20,
            y: 38,
            title: "Dusting",
            text: "Light objects are lifted so shelves and surfaces are dusted properly.",
          },
          {
            id: "mirrors",
            x: 82,
            y: 28,
            title: "Mirrors & glass",
            text: "Mirrors and glass are cleaned streak-free for a bright look.",
          },
        ],
      },
      {
        id: "living",
        label: "Living room",
        image: "/images/service-cleaning.jpg",
        spots: [
          {
            id: "surfaces",
            x: 42,
            y: 58,
            title: "Surfaces",
            text: "Tables, shelves and décor surfaces are dusted and wiped gently.",
          },
          {
            id: "floors",
            x: 58,
            y: 84,
            title: "Floors",
            text: "Floors are vacuumed and washed, including easy-to-reach corners.",
          },
          {
            id: "glass",
            x: 78,
            y: 32,
            title: "Glass & frames",
            text: "Glass details and frames are cleaned for a clear, polished finish.",
          },
        ],
      },
    ],
  },
  repair: {
    service: "repair",
    title: "Home Repairs",
    subtitle: "Tap the markers to see the careful, everyday fixes we handle at home.",
    scenes: [
      {
        id: "furniture",
        label: "Furniture",
        image:
          "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1600&q=80",
        spots: [
          {
            id: "assemble",
            x: 48,
            y: 52,
            title: "Furniture assembly",
            text: "Neat flat-pack assembly for shelves, desks and wardrobes.",
          },
          {
            id: "shelves",
            x: 72,
            y: 34,
            title: "Shelves & mounting",
            text: "Shelves are mounted level and secured cleanly on the wall.",
          },
        ],
      },
      {
        id: "bathroom-fix",
        label: "Bathroom",
        image: "/tmp-imgs/c10.jpg",
        spots: [
          {
            id: "taps",
            x: 28,
            y: 58,
            title: "Taps & mixers",
            text: "We replace or adjust taps and mixers for smooth everyday use.",
          },
          {
            id: "minor-leak",
            x: 72,
            y: 52,
            title: "Minor plumbing",
            text: "Seals, connections and simple leak checks — tidy and careful.",
          },
        ],
      },
      {
        id: "living-fix",
        label: "Living space",
        image:
          "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1600&q=80",
        spots: [
          {
            id: "sockets",
            x: 62,
            y: 48,
            title: "Sockets & switches",
            text: "Sockets and switches replaced for safer, cleaner daily use.",
          },
          {
            id: "fixtures",
            x: 36,
            y: 26,
            title: "Light fixtures",
            text: "Standard light fixtures hung and connected neatly.",
          },
        ],
      },
      {
        id: "hallway",
        label: "Doors",
        image:
          "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=80",
        spots: [
          {
            id: "hinges",
            x: 44,
            y: 46,
            title: "Hinges & alignment",
            text: "Doors are adjusted so they close smoothly and quietly again.",
          },
          {
            id: "handles",
            x: 58,
            y: 52,
            title: "Handles & locks",
            text: "Handle and lock fixes for everyday doors around the home.",
          },
        ],
      },
    ],
  },
  massage: {
    service: "massage",
    title: "Massage",
    subtitle: "Tap a body zone to see where we focus during your session.",
    scenes: [
      {
        id: "body",
        label: "Body map",
        kind: "svg-body",
        spots: [
          {
            id: "face",
            x: 50,
            y: 10,
            title: "Face",
            text: "Gentle facial massage to release tension and refresh circulation.",
          },
          {
            id: "shoulders",
            x: 50,
            y: 24,
            title: "Shoulders & neck",
            text: "Focused work on neck and shoulders after long desk days.",
          },
          {
            id: "back",
            x: 50,
            y: 42,
            title: "Back",
            text: "Full-back massage for posture relief and deep relaxation.",
          },
          {
            id: "legs",
            x: 50,
            y: 68,
            title: "Legs",
            text: "Leg massage to ease tightness after sport or long walks.",
          },
          {
            id: "feet",
            x: 50,
            y: 90,
            title: "Feet",
            text: "A calming foot massage to finish the session with comfort.",
          },
        ],
      },
    ],
  },
};
