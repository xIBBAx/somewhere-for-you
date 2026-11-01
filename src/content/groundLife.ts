/**
 * Ground life of the world: the small creatures that live on the
 * floor of its meadows and woods. This is a hand-picked, habitat-appropriate
 * roster of familiar temperate species, not a catalogue of everything that
 * crawls. Each entry is classified accurately (an earthworm is an annelid,
 * a snail a mollusc, a woodlouse a crustacean …) and carries a short,
 * research-based natural-history note written for a curious, cosy reader.
 *
 * Sources: species accounts on Wikipedia (Pseudochorthippus parallelus,
 * Gryllus campestris, Carabus violaceus, Lucanus cervus, Opiliones,
 * Armadillidium vulgare, Tachypodoiulus niger, Cepaea nemoralis, Lumbricus
 * terrestris) plus standard field-guide knowledge.
 *
 * The array ORDER is load-bearing: the renderer and simulation index kinds
 * by position (see src/world/life/ground/roster.ts).
 */

export type GroundClass = "insect" | "arachnid" | "crustacean" | "myriapod" | "mollusc" | "annelid"

export const GROUND_CLASSES: Record<GroundClass, { label: string; phylum: string; blurb: string }> = {
  insect: { label: "Insect", phylum: "Arthropoda", blurb: "six legs and three body parts" },
  arachnid: { label: "Arachnid", phylum: "Arthropoda", blurb: "eight legs" },
  crustacean: { label: "Crustacean", phylum: "Arthropoda", blurb: "a land-living cousin of crabs and shrimps" },
  myriapod: { label: "Myriapod", phylum: "Arthropoda", blurb: "many legs on many body rings" },
  mollusc: { label: "Mollusc", phylum: "Mollusca", blurb: "a soft body, often with a shell" },
  annelid: { label: "Annelid", phylum: "Annelida", blurb: "a segmented worm" },
}

export const GROUND_KINDS = [
  "gardenAnt",
  "woodAnt",
  "ladybird",
  "groundBeetle",
  "stagBeetle",
  "grasshopper",
  "fieldCricket",
  "harvestman",
  "woodlouse",
  "millipede",
  "snail",
  "earthworm",
] as const
export type GroundKindId = (typeof GROUND_KINDS)[number]

export type GroundKindInfo = {
  id: GroundKindId
  name: string
  scientific: string
  cls: GroundClass
  /** plain-words group with order/family */
  group: string
  legs: string
  realSize: string
  /** real length (mm) represented by one model unit of the procedural mesh */
  modelMm: number
  /**
   * Readability enlargement over real size. Ground creatures are rendered
   * 1.5–2.5× life size so they read from the third-person camera; this is a
   * deliberate, documented exaggeration.
   */
  displayScale: number
  where: string
  when: string
  /** one-line natural history shown once the kind has been met */
  note: string
  /** soft hint shown while the kind is still unmet */
  hint: string
  /** line for the first-meeting toast */
  toast: string
}

export const GROUND_LIFE: Record<GroundKindId, GroundKindInfo> = {
  gardenAnt: {
    id: "gardenAnt",
    name: "Black garden ant",
    scientific: "Lasius niger",
    cls: "insect",
    group: "Ant (Hymenoptera: Formicidae)",
    legs: "6",
    realSize: "workers 3–5 mm",
    modelMm: 4.5,
    displayScale: 2.5,
    where: "Sunny meadows, lawns and garden edges",
    when: "Warm, dry days",
    note: "Scouts lay a scent trail that their sisters follow there and back — and they gently 'milk' aphids for sweet honeydew.",
    hint: "On a warm, dry day, watch the meadow floor for a busy little line of marchers.",
    toast: "A whole family on the move, following each other's scent trail.",
  },
  woodAnt: {
    id: "woodAnt",
    name: "Red wood ant",
    scientific: "Formica rufa",
    cls: "insect",
    group: "Ant (Hymenoptera: Formicidae)",
    legs: "6",
    realSize: "workers 4.5–9 mm",
    modelMm: 7,
    displayScale: 2.5,
    where: "Pine and leafy woods",
    when: "Sunny days",
    note: "They thatch great domes of pine needles and twigs, and climb the trees to collect honeydew from aphids.",
    hint: "Look for a big dome of pine needles in the woods on a sunny day.",
    toast: "That needle dome is their home — thousands of sisters keep it tidy.",
  },
  ladybird: {
    id: "ladybird",
    name: "Seven-spot ladybird",
    scientific: "Coccinella septempunctata",
    cls: "insect",
    group: "Beetle (Coleoptera: Coccinellidae)",
    legs: "6",
    realSize: "5–8 mm",
    modelMm: 7,
    displayScale: 2.5,
    where: "Grass tips and flowers in sunny meadows",
    when: "Sunny, dry days",
    note: "Its bright red coat warns birds that it tastes bitter, and it can eat dozens of aphids in a day — a gardener's friend.",
    hint: "Peek at the grass tips and flowers on a sunny, dry day.",
    toast: "Seven little spots — three on each wing case and one shared in the middle.",
  },
  groundBeetle: {
    id: "groundBeetle",
    name: "Violet ground beetle",
    scientific: "Carabus violaceus",
    cls: "insect",
    group: "Beetle (Coleoptera: Carabidae)",
    legs: "6",
    realSize: "20–30 mm",
    modelMm: 28,
    displayScale: 2,
    where: "Woodland floors, under logs and leaves",
    when: "Dusk and night",
    note: "A swift night hunter that cannot fly — its wing cases are fused shut — so it runs instead, its edges shimmering violet.",
    hint: "Walk the forest floor at dusk — something glossy hurries between the leaves.",
    toast: "A purple shimmer along its edges — and off it dashes!",
  },
  stagBeetle: {
    id: "stagBeetle",
    name: "Stag beetle",
    scientific: "Lucanus cervus",
    cls: "insect",
    group: "Beetle (Coleoptera: Lucanidae)",
    legs: "6",
    realSize: "males up to 7.5 cm",
    modelMm: 55,
    displayScale: 1.6,
    where: "Old leafy and oak woods",
    when: "Warm evenings",
    note: "A male's 'antlers' are huge jaws for wrestling rivals. Its young spend 3–7 years growing inside rotting wood.",
    hint: "Old leafy woods on a warm evening hide a gentle giant with antlers.",
    toast: "A gentle giant — those antlers are for friendly wrestling matches.",
  },
  grasshopper: {
    id: "grasshopper",
    name: "Meadow grasshopper",
    scientific: "Pseudochorthippus parallelus",
    cls: "insect",
    group: "Grasshopper (Orthoptera: Acrididae)",
    legs: "6",
    realSize: "15–20 mm",
    modelMm: 18,
    displayScale: 2.2,
    where: "Sunny grassy meadows",
    when: "Sunny days",
    note: "It can't fly, so it leaps. It sings by rubbing a hind leg on its wing and hears with ears on its tummy — and its antennae are short, unlike a cricket's.",
    hint: "In a sunny meadow, watch the grass for a sudden little leap.",
    toast: "Boing! Strong back legs carry it many times its own length.",
  },
  fieldCricket: {
    id: "fieldCricket",
    name: "Field cricket",
    scientific: "Gryllus campestris",
    cls: "insect",
    group: "Cricket (Orthoptera: Gryllidae)",
    legs: "6",
    realSize: "17–23 mm",
    modelMm: 22,
    displayScale: 2,
    where: "Short, sunny grass, at the door of its burrow",
    when: "Warm afternoons into the night",
    note: "A male sings at his burrow door by rubbing his wings together, and crickets listen with ears on their front legs.",
    hint: "Follow a warm evening song across short meadow grass to a little burrow.",
    toast: "Shh… it sings with its wings and listens with its legs.",
  },
  harvestman: {
    id: "harvestman",
    name: "Harvestman",
    scientific: "Order Opiliones (e.g. Phalangium opilio)",
    cls: "arachnid",
    group: "Harvestman (Opiliones)",
    legs: "8",
    realSize: "body 3–9 mm, legs far longer",
    modelMm: 6,
    displayScale: 2.5,
    where: "Woodland floors and leafy corners",
    when: "Dusk and night",
    note: "A cousin of spiders that isn't one: a single round body, no silk and no venom. It feels its way with its extra-long second pair of legs.",
    hint: "Look low in the woods after dusk for a tiny body on very long legs.",
    toast: "Not a spider! One round body, eight long legs and not a drop of venom.",
  },
  woodlouse: {
    id: "woodlouse",
    name: "Common pill woodlouse",
    scientific: "Armadillidium vulgare",
    cls: "crustacean",
    group: "Woodlouse (Isopoda)",
    legs: "14",
    realSize: "8–18 mm",
    modelMm: 14,
    displayScale: 2.4,
    where: "Damp leaf litter, logs and stones",
    when: "Night, or after rain",
    note: "A land crustacean, kin to crabs and shrimps. It must stay damp to breathe, rolls into a ball when worried, and turns dead leaves back into soil.",
    hint: "Look under damp forest leaves at night or after rain.",
    toast: "It rolled into a tiny ball! A crab cousin that lives on land.",
  },
  millipede: {
    id: "millipede",
    name: "White-legged snake millipede",
    scientific: "Tachypodoiulus niger",
    cls: "myriapod",
    group: "Millipede (Diplopoda)",
    legs: "about 100 pairs — two pairs on most body rings",
    realSize: "about 2–5 cm",
    modelMm: 40,
    displayScale: 2,
    where: "Leaf litter, moss and bark in the woods",
    when: "Night, and damp weather",
    note: "Glossy black with little white legs rippling in waves. Despite its name it has far fewer than a thousand, and it coils into a spiral when touched.",
    hint: "On the forest floor at night or after rain, look for a glossy, gliding thread.",
    toast: "So many white legs, rippling in waves — then a neat little spiral.",
  },
  snail: {
    id: "snail",
    name: "Brown-lipped snail",
    scientific: "Cepaea nemoralis",
    cls: "mollusc",
    group: "Land snail (Gastropoda)",
    legs: "none — it glides on one muscular foot",
    realSize: "shell 18–25 mm wide",
    modelMm: 35,
    displayScale: 2,
    where: "Grass, hedges, woods and lake shores",
    when: "Evenings, nights and after rain",
    note: "It glides on a ribbon of slime and its eyes sit on the tips of its long tentacles. Shells come yellow, pink or brown, with up to five dark bands.",
    hint: "After rain, or on a dewy evening, look near the grass and the woods.",
    toast: "Eyes on stalks and a spiral house on its back — slow and steady.",
  },
  earthworm: {
    id: "earthworm",
    name: "Common earthworm",
    scientific: "Lumbricus terrestris",
    cls: "annelid",
    group: "Segmented worm (Annelida: Clitellata)",
    legs: "none — tiny bristles help it grip",
    realSize: "11–20 cm",
    modelMm: 150,
    displayScale: 1.5,
    where: "Soft soil under meadows and woods",
    when: "Rainy days and damp nights",
    note: "It breathes through its moist skin and mixes the soil as it tunnels. Charles Darwin loved worms so much he wrote a whole book about them.",
    hint: "During or just after rain, look on soft, wet ground.",
    toast: "Hello, gardener of the soil! It breathes right through its skin.",
  },
}

export const GROUND_LIFE_LIST: GroundKindInfo[] = GROUND_KINDS.map((id) => GROUND_LIFE[id])

export const isGroundKind = (value: unknown): value is GroundKindId =>
  typeof value === "string" && (GROUND_KINDS as readonly string[]).includes(value)
