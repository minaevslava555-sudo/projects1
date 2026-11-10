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
    subtitle: "Tap the pulsing markers to see what we clean in each room.",
    scenes: [
      {
        id: "kitchen",
        label: "Kitchen",
        image: "/tmp-imgs/clean2.jpg",
        spots: [
          {
            id: "hob",
            x: 62,
            y: 48,
            title: "Hob & stove",
            text: "We degrease the hob, burners and nearby splash zones.",
          },
          {
            id: "counters",
            x: 38,
            y: 58,
            title: "Counters",
            text: "Worktops are wiped down and crumbs removed from every surface.",
          },
          {
            id: "fronts",
            x: 28,
            y: 36,
            title: "Cabinet fronts",
            text: "Kitchen fronts and handles are cleaned of fingerprints and grease.",
          },
          {
            id: "dishes",
            x: 78,
            y: 62,
            title: "Dishes & sink",
            text: "We wash available dishes and leave the sink fresh and clear.",
          },
        ],
      },
      {
        id: "bathroom",
        label: "Bathroom",
        image: "/tmp-imgs/clean3.jpg",
        spots: [
          {
            id: "toilet",
            x: 72,
            y: 55,
            title: "Toilet",
            text: "Toilet bowl and seat are disinfected thoroughly.",
          },
          {
            id: "taps",
            x: 35,
            y: 42,
            title: "Taps & mixers",
            text: "Mixers are washed and polished until they shine.",
          },
          {
            id: "limescale",
            x: 48,
            y: 58,
            title: "Limescale",
            text: "We remove water marks and light limescale from wet zones.",
          },
          {
            id: "floor",
            x: 55,
            y: 82,
            title: "Floor",
            text: "Bathroom floor is vacuumed and mopped carefully.",
          },
        ],
      },
      {
        id: "bedroom",
        label: "Bedroom",
        image: "/tmp-imgs/clean1.jpg",
        spots: [
          {
            id: "under-bed",
            x: 50,
            y: 72,
            title: "Under the bed",
            text: "We vacuum and mop accessible areas under the bed.",
          },
          {
            id: "bedding",
            x: 52,
            y: 45,
            title: "Bedding",
            text: "Bed linen is straightened or remade on request.",
          },
          {
            id: "dusting",
            x: 22,
            y: 40,
            title: "Dusting",
            text: "Light items are lifted so we can dust shelves and surfaces underneath.",
          },
          {
            id: "mirrors",
            x: 80,
            y: 30,
            title: "Mirrors & glass",
            text: "Mirrors and glass surfaces are cleaned streak-free.",
          },
        ],
      },
      {
        id: "hallway",
        label: "Hallway",
        image: "/tmp-imgs/clean4.jpg",
        spots: [
          {
            id: "doors",
            x: 40,
            y: 35,
            title: "Doors & frames",
            text: "Entrance doors and frames are wiped clean.",
          },
          {
            id: "shoes",
            x: 30,
            y: 70,
            title: "Shoe area",
            text: "Shoes are arranged neatly and the rack is dusted.",
          },
          {
            id: "floor-hall",
            x: 60,
            y: 80,
            title: "Floor",
            text: "Hallway floor is vacuumed and washed.",
          },
        ],
      },
    ],
  },
  repair: {
    service: "repair",
    title: "Home Repairs",
    subtitle: "Explore the markers to see the everyday fixes we handle.",
    scenes: [
      {
        id: "furniture",
        label: "Furniture",
        image: "/tmp-imgs/repair2.jpg",
        spots: [
          {
            id: "assemble",
            x: 45,
            y: 50,
            title: "Furniture assembly",
            text: "Flat-pack assembly for shelves, desks, wardrobes and more.",
          },
          {
            id: "shelves",
            x: 70,
            y: 32,
            title: "Shelves & mounting",
            text: "We mount shelves securely and level them on the wall.",
          },
        ],
      },
      {
        id: "plumbing",
        label: "Plumbing",
        image: "/tmp-imgs/repair4.jpg",
        spots: [
          {
            id: "taps",
            x: 55,
            y: 40,
            title: "Taps & mixers",
            text: "Replacement or adjustment of taps and mixers for everyday use.",
          },
          {
            id: "minor-leak",
            x: 40,
            y: 65,
            title: "Minor plumbing",
            text: "Simple fixes like seals, connections and basic leak checks.",
          },
        ],
      },
      {
        id: "electrics",
        label: "Electrics",
        image: "/tmp-imgs/r7.jpg",
        spots: [
          {
            id: "sockets",
            x: 58,
            y: 48,
            title: "Sockets & switches",
            text: "Replacement of sockets and switches for safer daily use.",
          },
          {
            id: "fixtures",
            x: 35,
            y: 28,
            title: "Light fixtures",
            text: "We hang and connect standard light fixtures.",
          },
        ],
      },
      {
        id: "doors",
        label: "Doors",
        image: "/tmp-imgs/repair5.jpg",
        spots: [
          {
            id: "hinges",
            x: 42,
            y: 45,
            title: "Hinges & alignment",
            text: "Door hinges adjusted so doors close smoothly again.",
          },
          {
            id: "handles",
            x: 60,
            y: 50,
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
    subtitle: "Tap body zones to see which massage areas we focus on.",
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
            text: "Gentle facial massage to release tension and improve circulation.",
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
            text: "Foot massage to finish the session and restore comfort.",
          },
        ],
      },
    ],
  },
};
