import type { GiftConfig, MemoryText, PhotoRef } from "./types"

/**
 * The demo world: fictional people, placeholder artwork and words that
 * describe the world itself rather than inventing anyone's shared history.
 * Its names, words and festivals come from Indian traditions; home on the
 * globe is the centre of India.
 * Every field can be replaced in customize/gift.json or in the in-game
 * Personalize screen (docs/CUSTOMIZATION.md).
 */

const art = (name: string, alt: string): PhotoRef => ({ src: `placeholder:${name}`, alt })

const memory = (title: string, subtitle: string, text: string, place: string, photo: PhotoRef): MemoryText =>
  ({ title, subtitle, text, more: "", place, date: "", photos: [photo] })

export const DEFAULT_GIFT: GiftConfig = {
  version: 1,
  recipient: { name: "Meera" },
  creator: { name: "Kabir" },
  relationship: { kind: "friend", label: "" },
  occasion: { kind: "celebration", month: 0, day: 0 },
  letter: {
    heading: "Namaste",
    greeting: "Meera,",
    paragraphs: [
      "This is a world you can walk around in. I put it together piece by piece, and there's more of it than you'll see today.",
      "There are gulmohar trees and lakes, peacocks in the grass, diyas along the path at dusk, horses you can ride, and a winged one who can take you past the clouds if you call.",
      "Nine stars are hidden near home. Find them in any order, or ignore them and go exploring first.",
    ],
    signoff: "— Kabir",
    enter: "Chalo, enter the world",
  },
  title: { heading: "", subtitle: "" },
  memories: [
    memory("Shubh Aarambh", "a good beginning", "A rangoli at the threshold and a path into the gulmohar trees. Nine stars are hidden around home, and this is the first of them.", "The start of the path", art("meadow", "The home meadow on a bright day, flame trees and a chai stall beyond")),
    memory("Chai on the Verandah", "the kettle is still warm", "Somebody left the chairs out and the chai warm. Sit down for a minute. The stars can wait.", "", art("lake", "A still lake with water lilies and reeds")),
    memory("The Long Way Round", "follow it and see", "There is a quicker way back, but it isn't as pretty. Take this one, and stop whenever you feel like it.", "", art("path", "A path between lamp posts toward the chai stall, early evening")),
    memory("The Little Studio", "a lamp left burning", "Block prints pinned up to dry and a lamp left burning. Someone is halfway through making something here.", "The little studio", art("studio", "A small open studio under a flame tree")),
    memory("Billi Bagh", "the cat garden", "This garden belongs to the billis. Knock before you come in, then wait to see if anyone cares.", "The cat garden", art("garden", "A fenced cat garden with a little cat house")),
    memory("The Akhara", "again, and again", "A worn post in a patch of trodden earth. In an akhara nobody keeps score. You just come back tomorrow.", "The akhara", art("horses", "Horses grazing in an open meadow")),
    memory("The Chai Tapri", "opening soon", "The lights are on and the stools are out, but the shutter hasn't gone up yet. Try again tomorrow.", "The end of the street", art("cafe", "A small chai stall with a striped awning, closed for now")),
    memory("Pehli Baarish", "the first rain of the monsoon", "The first rain of the monsoon and the smell of wet earth. There's a dry spot under the umbrella if you want to watch.", "", art("rain", "Rain over the meadow paths")),
    memory("Aage Ka Raasta", "the path ahead", "The lamps stop here, but the path doesn't. It goes on farther than this world can show.", "Somewhere ahead", art("night", "Home at night: a rangoli ringed with lit diyas, a peacock nearby and the chai stall beyond")),
  ],
  secrets: [
    { title: "What the Billi Found", text: "Chikoo has been guarding this spot for a while and looks very pleased about it.", photo: art("whales", "Sky whales swimming over a gulmohar forest") },
    { title: "The Back of the Almirah", text: "An extra picture nobody framed. It gets to live here instead.", photo: art("lakeside", "Home at dusk with diyas lit along the path") },
  ],
  ending: {
    heading: "",
    lines: [
      "That's all nine.",
      "The world doesn't end here. Keep wandering, and come back whenever you like.",
    ],
    closing: "Phir milenge.",
    photos: [art("pegasus", "A winged horse and rider over a gulmohar forest with sky whales alongside")],
    fireworksLine: "",
  },
  characters: {
    explorer: { name: "", preset: "explorer", model: "" },
    companion: { name: "", preset: "companion", model: "", follows: true, chatter: "sometimes" },
  },
  creatures: {
    starborn: "Ashwini",
    explorerPegasus: "Chandni",
    companionPegasus: "Megh",
    dragon: "Swarna",
    cat: "Chikoo",
    spaceCats: ["Surya", "Chanda", "Mangal", "Badal", "Jyoti"],
  },
  places: { cafeSign: "CHAI", studioLine: "", cafeLine: "", valleyName: "Devdar Valley", benchName: "The valley bench" },
  chatter: {
    explorer: [
      "Dekho, those clouds!",
      "Chalo, slowpoke!",
      "Five more minutes under this tree?",
      "Next star, then chai.",
      "Hug? (G)",
      "High five! (F)",
    ],
    companion: [
      "Chalo, the lake?",
      "First one to that gulmohar wins!",
      "Baarish is coming, I can smell it.",
      "Chai first, then stars?",
      "Hand? (H)",
      "Dance? (V)",
    ],
  },
  theme: { accent: "#f2c46d" },
  music: { src: "default", title: "First Snow", credit: "Holizna (CC0)" },
  world: {
    home: { label: "", latitude: 21.15, longitude: 79.09 },
    liveWeather: false,
  },
}

/** The nine memory places (ids are fixed: the world's set pieces sit there). */
export const MEMORY_SLOT_IDS = [
  "first-steps", "cafe-table", "long-way", "little-studio", "cat-garden",
  "training-corner", "corner-cafe", "rain-spot", "path-ahead",
] as const

/** Built-in placeholder artwork (public/assets/placeholders/<name>.jpg). */
export const PLACEHOLDERS = ["meadow", "lake", "path", "studio", "garden", "horses", "cafe", "rain", "night", "whales", "lakeside", "pegasus"] as const
