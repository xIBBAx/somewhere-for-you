/**
 * Words for the little surprises scattered across the endless world.
 * The companion: every line here is safe to edit, extend or replace — the world
 * picks one deterministically per place, so a spot always says the same thing.
 */
import type { LandmarkKind } from "../world/landmarks"

export type DiscoveryText = { title: string; verb: string; lines: string[] }

export const LANDMARK_TEXT: Record<LandmarkKind, DiscoveryText> = {
  flowerHeart: {
    title: "A Heart of Flowers",
    verb: "smell the flowers",
    lines: [
      "Someone planted a whole heart of flowers out here. Probably for you.",
      "Bees are very serious about this flower bed. Respectfully, so are we.",
      "Every petal here is pointing your way. Coincidence? No.",
    ],
  },
  picnic: {
    title: "A Little Picnic",
    verb: "sit for a while",
    lines: [
      "A durrie, two cushions and a tiffin box. The universe is very good at picnics today.",
      "The chai is still warm. Nobody knows who left it. Best not to ask the tiffin.",
      "Stay as long as you like. The clouds are in no hurry either.",
    ],
  },
  bench: {
    title: "A Quiet Bench",
    verb: "sit and watch",
    lines: [
      "A good bench for doing absolutely nothing. Highly recommended.",
      "The view from here was saved especially for you.",
      "Wind in the grass, nowhere to be. Perfect.",
    ],
  },
  catNap: {
    title: "The Cat Nap Club",
    verb: "pet the cats",
    lines: [
      "The local cat council is in session. Motion passed: more naps.",
      "Purr levels: dangerously high.",
      "They've decided you're allowed to stay. Big honour.",
    ],
  },
  kiosk: {
    title: "A Chai Tapri",
    verb: "order a cutting chai",
    lines: [
      "Someone keeps this little stand open. Today's special: cutting chai and whatever is in the jar.",
      "One cutting chai, extra adrak, on the house.",
      "The chaiwala is a mystery. The Parle-G is not. It is excellent.",
    ],
  },
  easel: {
    title: "An Open-Air Studio",
    verb: "paint a little",
    lines: [
      "Fresh canvas, good light. Careful hands make small wonders.",
      "A few brushstrokes and the hill has a new painting.",
      "Every artist needs a quiet field. This one is yours.",
    ],
  },
  umbrella: {
    title: "The Rainy-Day Umbrella",
    verb: "stand under it",
    lines: [
      "One umbrella, room for two. The weather can do whatever it wants.",
      "Rain or shine, this spot is cozy.",
      "Listen — the world sounds softer from under here.",
    ],
  },
  trainingPost: {
    title: "A Training Post",
    verb: "throw a few punches",
    lines: [
      "Jab. Cross. The post never stood a chance.",
      "Small package, serious power. The post has filed a complaint.",
      "Strong hands, soft heart. Both on display today.",
    ],
  },
  gulmoharArch: {
    title: "The Gulmohar Gate",
    verb: "walk through the petals",
    lines: [
      "Walking under the arch is supposed to bring a lovely year.",
      "Petals everywhere. You'll be finding them in your pockets for days.",
      "Lanterns on, blossoms falling. Pretty much perfect.",
    ],
  },
  starStones: {
    title: "The Star Stones",
    verb: "touch the stones",
    lines: [
      "Old stones that remember every starry night. Tonight they remember you.",
      "The runes glow when someone kind is near.",
      "Make a wish. The stones are listening.",
    ],
  },
  wishTree: {
    title: "The Mannat Tree",
    verb: "tie a mannat thread",
    lines: [
      "A very old tree tied with threads, one for every wish. Yours is the brightest.",
      "Tie a thread, make a mannat. The tree keeps secrets well.",
      "The fairy lights flicker hello.",
    ],
  },
  balloon: {
    title: "A Hot-Air Balloon",
    verb: "take a ride",
    lines: [
      "Up, up and away — the whole world, from above.",
      "The basket was waiting just for you.",
      "From up here, every path looks like it leads somewhere lovely.",
    ],
  },
}

export type FindKind = "gift" | "cupcake" | "letter"

export const FIND_TEXT: Record<FindKind, DiscoveryText> = {
  gift: {
    title: "A Little Gift",
    verb: "open the gift",
    lines: [
      "Inside: marigold petals, and a reminder that you're wonderful.",
      "It's a box full of tiny sparkles. Very on-theme.",
      "A gift for no reason. The best kind.",
      "Inside is a note that just says: you found it.",
    ],
  },
  cupcake: {
    title: "A Little Mithai",
    verb: "take the mithai",
    lines: [
      "Sweet, sticky and still warm. Calories don't count in this world.",
      "Mithai in the wild! Extremely rare. Extremely delicious.",
      "One candle's worth of wish, saved for later.",
    ],
  },
  letter: {
    title: "A Tiny Letter",
    verb: "read the letter",
    lines: [
      "May this world always have a quiet corner and a small surprise for you.",
      "\"Keep walking — there's always more world ahead.\"",
      "\"Whoever finds this: you're doing great.\"",
      "\"This field was built for wandering. Wander well.\"",
    ],
  },
}
