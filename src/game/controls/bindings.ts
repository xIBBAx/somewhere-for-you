import type { GameAction } from "../runtime"
import { names } from "../../personalization"

/**
 * Every control the player can use, in one place. The controls guide, the
 * contextual legend, the Explore menu and tests/bindings.test.ts all read from
 * here, so a key shown on screen is a key that works.
 *
 * `keys` are KeyboardEvent.code names (see game/input.ts). A tap pattern repeats
 * the key ("KeyA KeyA" is a double tap) and a chord joins with "+" ("ShiftLeft+KeyC").
 * `action` is the name input.ts maps the key to (ACTION_KEYS); the test checks it.
 * `pending` marks a control whose consumer is not in the game yet: it is kept here
 * for the record but hidden from the guide and legend until flipped.
 */

/** Where a key means this thing. Two bindings clash only when they share a key and a context. */
export type Context = "foot" | "horse" | "flight" | "sail" | "journey" | "pegasusGround" | "landing" | "landingRun" | "dragon"
/** Sections of the controls guide, in the order they are shown. */
export type Group = "foot" | "horse" | "flight" | "dragon" | "sail" | "journey" | "together" | "photo" | "map" | "camera" | "help"
/** What the contextual legend is showing. */
export type LegendContext = "footHorse" | "horse" | "flight" | "sail" | "journey" | "pegasusGround" | "landing" | "landingRun"

export type Binding = {
  id: string
  group: Group
  contexts: Context[]
  /** row title in the guide */
  name: string
  /** one plain sentence for the guide */
  desc: string
  /** short wording for the legend chip */
  short?: string
  /** keyboard signatures; alternatives are separate entries */
  keys: string[]
  /** shown in place of the derived key label, e.g. "W A S D" */
  label?: string
  /** input.ts action this key pushes (ACTION_KEYS), when there is one */
  action?: GameAction
  /** legend rank per context (lower is shown first); absent = not in that legend */
  legend?: Partial<Record<LegendContext, number>>
  /** the consumer is not in the game yet: hidden from the guide and legend */
  pending?: boolean
}

export const GROUPS: { id: Group; title: string }[] = [
  { id: "foot", title: "On foot" },
  { id: "horse", title: "Riding a horse" },
  { id: "flight", title: "Pegasus flight & tricks" },
  { id: "dragon", title: `Riding ${names.dragon}, the golden dragon` },
  { id: "sail", title: `${names.starborn} in space` },
  { id: "journey", title: "Journeys between worlds" },
  { id: "together", title: "Together" },
  { id: "photo", title: "Photo mode" },
  { id: "map", title: "World map" },
  { id: "camera", title: "Camera" },
  { id: "help", title: "Help & recovery" },
]

const ALL: Context[] = ["foot", "horse", "flight", "sail", "journey", "pegasusGround", "landing", "landingRun"]

export const BINDINGS: Binding[] = [
  // ---- on foot
  { id: "walk", group: "foot", contexts: ["foot"], name: "Walk or swim", desc: "Walk or swim with W A S D or the arrow keys.", short: "walk", keys: ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"], label: "W A S D / ↑ ↓ ← →" },
  { id: "run", group: "foot", contexts: ["foot"], name: "Run or swim faster", desc: "Hold Shift to run or swim faster.", keys: ["ShiftLeft", "ShiftRight"], label: "Shift" },
  { id: "jump", group: "foot", contexts: ["foot", "horse"], name: "Jump", desc: "Jump. On an ordinary horse, jump the fence. Pegasus takeoff is listed below.", short: "jump", keys: ["Space", "KeyJ"], label: "Space / J" },
  { id: "interact", group: "foot", contexts: ["foot"], name: "Interact", desc: "Look closer at a memory, pet a cat, pick things up, throw a stone. Near a mount, E gets you on. Mounted, E gets you off; in the air it lands and dismounts; in space it descends.", short: "ride or pick up", keys: ["KeyE", "Enter"], label: "E / Enter", legend: { footHorse: 1 } },
  { id: "pat", group: "foot", contexts: ["foot", "horse"], name: "Pat", desc: "Pat a horse, or your companion, to make friends.", short: "pat", keys: ["KeyB"], label: "B", action: "pat", legend: { footHorse: 2, horse: 5 } },
  { id: "whistle", group: "foot", contexts: ["foot"], name: "Whistle for your Pegasus", desc: "Whistle, and your Pegasus comes to you, from wherever she is.", short: "whistle", keys: ["KeyY"], label: "Y", action: "callPegasus" },
  { id: "callHorse", group: "foot", contexts: ["foot"], name: "Call your horse", desc: "Call your horse when it is out of reach.", short: "call horse", keys: ["KeyU"], label: "U", action: "callHorse" },
  { id: "callCat", group: "foot", contexts: ["foot"], name: `Call ${names.cat}`, desc: `Call ${names.cat}, your cat, to come to you.`, keys: ["KeyC"], label: "C" },
  { id: "photo", group: "foot", contexts: ["foot"], name: "Make a photograph", desc: "Open photo mode. Space or Enter takes the picture; drag to pose the view.", short: "photo", keys: ["KeyP"], label: "P", action: "photo" },
  { id: "journal", group: "foot", contexts: ALL, name: "The journal", desc: "Open the journal of what you have seen and done.", short: "book", keys: ["KeyL"], label: "L", action: "journal" },
  { id: "race", group: "foot", contexts: ["foot"], name: "Race to a light", desc: `Race ${names.cat} to a light on the ground. Esc leaves the race.`, keys: ["KeyR"], label: "R", action: "race" },
  { id: "stars", group: "foot", contexts: ["foot"], name: "Read the constellations", desc: "At night on dry land, read the constellations.", keys: ["KeyX"], label: "X", action: "stars" },
  { id: "putDown", group: "foot", contexts: ["foot"], name: "Put down", desc: "Put down whatever you are carrying (a flower, a stone).", keys: ["KeyZ"], label: "Z", action: "putDown" },
  { id: "switch", group: "foot", contexts: ["foot", "horse"], name: "Switch character", desc: `Explore as ${names.companion}, once they are with you.`, short: "switch", keys: ["KeyQ"], label: "Q" },
  { id: "together", group: "together", contexts: ["foot"], name: "Hold hands", desc: `Hold hands with ${names.companion} when they are beside you.`, keys: ["KeyH"], label: "H", action: "hold" },
  { id: "hug", group: "together", contexts: ["foot"], name: "Hug", desc: `Hug ${names.companion}.`, keys: ["KeyG"], label: "G", action: "hug" },
  { id: "highFive", group: "together", contexts: ["foot"], name: "High five", desc: `Give ${names.companion} a high five.`, keys: ["KeyF"], label: "F", action: "five" },
  { id: "dance", group: "together", contexts: ["foot"], name: "Dance", desc: "Dance together.", keys: ["KeyV"], label: "V", action: "dance" },
  { id: "follow", group: "together", contexts: ["foot"], name: "Follow", desc: `Ask ${names.companion} to follow you, or stop following.`, keys: ["KeyT"], label: "T", action: "follow" },

  // ---- photo mode (P): its own keys while it is open
  { id: "photoShoot", group: "photo", contexts: ["foot"], name: "Take the picture", desc: "Space or Enter takes the photograph.", keys: [], label: "Space / Enter" },
  { id: "photoFrame", group: "photo", contexts: ["foot"], name: "Frame it", desc: "Drag to turn the view; the wheel moves the camera closer or further. Pose and Film choose the look.", keys: [], label: "Mouse · Wheel" },
  { id: "photoLeave", group: "photo", contexts: ["foot"], name: "Put the camera down", desc: "Esc or P leaves photo mode.", keys: [], label: "Esc / P" },

  // ---- the World map (M): its own keys while it is open
  { id: "mapPan", group: "map", contexts: ["foot"], name: "Move the map", desc: "W A S D or the arrow keys move the map; dragging does too.", keys: [], label: "W A S D / ↑ ↓ ← →" },
  { id: "mapZoom", group: "map", contexts: ["foot"], name: "Zoom the map", desc: "+ and − zoom in and out, as the wheel does.", keys: [], label: "+ / −" },
  { id: "mapHome", group: "map", contexts: ["foot"], name: "Back to you", desc: "C brings the map back to where you are.", keys: [], label: "C" },
  { id: "mapMark", group: "map", contexts: ["foot"], name: "Leave a mark", desc: "X leaves a rose cross at the cursor (or the middle of the map) and heads for it; clicking open ground does the same.", keys: [], label: "X" },
  { id: "mapForget", group: "map", contexts: ["foot"], name: "Remove a mark", desc: "Choose a mark, then Delete or Backspace removes it.", keys: [], label: "Delete / Backspace" },
  { id: "mapClose", group: "map", contexts: ["foot"], name: "Close the map", desc: "M again, or Esc.", keys: [], label: "M / Esc" },

  // ---- riding a horse on the ground
  { id: "steer", group: "horse", contexts: ["horse", "pegasusGround", "landingRun"], name: "Steer", desc: "Turn left or right.", short: "steer", keys: ["KeyA", "KeyD"], label: "A D", legend: { horse: 2, pegasusGround: 2, landingRun: 2 } },
  { id: "gait", group: "horse", contexts: ["horse", "pegasusGround"], name: "Speed", desc: "W walks on at the gait you have. A tap of S eases down a gait; holding S reins back.", short: "speed", keys: ["KeyW", "KeyS"], label: "W S", legend: { horse: 1 } },
  { id: "spur", group: "horse", contexts: ["horse"], name: "Spur on", desc: "Tap Shift to spur up a gait. Hold Shift to gallop.", short: "gallop", keys: ["ShiftLeft", "ShiftRight"], label: "Shift", legend: { horse: 3 } },
  { id: "dismount", group: "horse", contexts: ["horse", "pegasusGround", "landingRun"], name: "Dismount", desc: "Get off your horse (slows to a halt first).", short: "get off", keys: ["KeyE"], label: "E", legend: { horse: 4, pegasusGround: 3, landingRun: 3 } },

  // ---- Pegasus flight and tricks
  { id: "takeoff", group: "flight", contexts: ["pegasusGround", "landingRun"], name: "Take Off", desc: "On a grounded Pegasus, spread the wings and take off. Hold to keep climbing.", short: "take off", keys: ["Space", "KeyJ"], label: "Space / J", legend: { pegasusGround: 1, landingRun: 4 } },
  { id: "landGallop", group: "flight", contexts: ["flight"], name: "Land & Gallop", desc: "Land your Pegasus and keep galloping with both riders aboard. Steer through the approach; R again, Space or Esc keeps you flying. After touchdown, S or R slows to a stop.", short: "land & gallop", keys: ["KeyR"], label: "R", action: "landGallop", legend: { flight: 0 } },
  { id: "keepFlying", group: "flight", contexts: ["landing"], name: "Keep Flying", desc: "Cancel a Land & Gallop approach and keep flying, without dismounting.", short: "keep flying", keys: ["KeyR"], label: "R", action: "landGallop", legend: { landing: 0 } },
  { id: "cancelLanding", group: "flight", contexts: ["landing"], name: "Climb out of the approach", desc: "Space or J climbs out of Land & Gallop; Esc also cancels the approach.", keys: ["Space", "KeyJ", "Escape"], label: "Space / J / Esc" },
  { id: "slowLandingRun", group: "flight", contexts: ["landingRun"], name: "Slow to stop", desc: "After Land & Gallop, S or R ends the continuing gallop and slows to a halt. You stay mounted.", short: "slow to stop", keys: ["KeyR", "KeyS"], label: "R / S", action: "landGallop", legend: { landingRun: 0 } },
  { id: "flySpeed", group: "flight", contexts: ["flight"], name: "Faster or slower", desc: "W goes faster, S slows down.", short: "speed", keys: ["KeyW", "KeyS"], label: "W S", legend: { flight: 1 } },
  { id: "bank", group: "flight", contexts: ["flight", "landing"], name: "Bank and turn", desc: "Bank left or right to turn.", short: "bank", keys: ["KeyA", "KeyD"], label: "A D", legend: { flight: 2, landing: 2 } },
  { id: "climb", group: "flight", contexts: ["flight"], name: "Climb", desc: "Hold Space (or J) to climb.", short: "climb", keys: ["Space", "KeyJ"], label: "Space / J", legend: { flight: 3 } },
  { id: "land", group: "flight", contexts: ["flight", "landing"], name: "Land & Dismount", desc: "Land, slow to a halt and get off your Pegasus. Use Land & Gallop to stay mounted and keep moving.", short: "land & dismount", keys: ["KeyE"], label: "E", legend: { flight: 4, landing: 3 } },
  { id: "descend", group: "flight", contexts: ["flight"], name: "Descend", desc: "Hold C to go down.", short: "down", keys: ["KeyC"], label: "C", legend: { flight: 5 } },
  { id: "dash", group: "flight", contexts: ["flight"], name: "Dash", desc: `Hold Shift for a burst of speed. Riding ${names.starborn}, keep holding it: she opens into her overdrive, faster than any wing. Let go to coast.`, short: "dash", keys: ["ShiftLeft", "ShiftRight"], label: "Shift" },
  { id: "launch", group: "flight", contexts: ["flight"], name: "Launch", desc: "Hold Shift and Space together to throw the dash's speed straight up into an almost vertical climb. S stands it up further; A and D still steer.", short: "launch", keys: ["ShiftLeft+Space"], label: "Shift+Space", legend: { flight: 5.5 } },
  { id: "stoop", group: "flight", contexts: ["flight"], name: "Stoop", desc: "Shift and C together dive steeply.", keys: ["ShiftLeft+KeyC"], label: "Shift+C" },
  { id: "tricksTip", group: "flight", contexts: ["flight"], name: "Tricks", desc: "Release between taps; tap twice quickly for a trick: A A barrel roll, D D barrel roll, S S loop, C C dive flip, Space Space corkscrew climb, W W pirouette.", short: "A A roll · S S loop", keys: [], label: "A A", legend: { flight: 6 } },
  { id: "barrelRoll", group: "flight", contexts: ["flight"], name: "Barrel roll", desc: "Tap A twice, or D twice, to roll.", keys: ["KeyA KeyA", "KeyD KeyD"], label: "A A · D D" },
  { id: "loop", group: "flight", contexts: ["flight"], name: "Loop", desc: "Tap S twice to loop the loop.", keys: ["KeyS KeyS"], label: "S S" },
  { id: "diveFlip", group: "flight", contexts: ["flight"], name: "Dive flip", desc: "Tap C twice to flip over in a dive.", keys: ["KeyC KeyC"], label: "C C" },
  { id: "corkscrew", group: "flight", contexts: ["flight"], name: "Corkscrew climb", desc: "Tap Space twice to corkscrew upward.", keys: ["Space Space"], label: "Space Space" },
  { id: "pirouette", group: "flight", contexts: ["flight"], name: "Pirouette", desc: "Tap W twice to spin in place.", keys: ["KeyW KeyW"], label: "W W" },

  // ---- Starborn in space
  { id: "sail", group: "sail", contexts: ["sail"], name: "Sail on or slow", desc: "W explores gently near a world, S slows. Shift or Dash opens full speed to leave the encounter.", short: "sail", keys: ["KeyW", "KeyS"], label: "W S", legend: { sail: 1 } },
  { id: "sailTurn", group: "sail", contexts: ["sail"], name: "Turn", desc: "Steer left or right.", keys: ["KeyA", "KeyD"], label: "A D" },
  { id: "sailClimb", group: "sail", contexts: ["sail"], name: "Climb", desc: "Hold Space to climb toward the stars.", keys: ["Space"], label: "Space" },
  { id: "sailDive", group: "sail", contexts: ["sail"], name: "Dive", desc: "Hold C to dive.", keys: ["KeyC"], label: "C" },
  { id: "surge", group: "sail", contexts: ["sail"], name: "Surge", desc: `Hold Shift for a surge of speed. ${names.starborn}'s overdrive crowds the stars ahead of you into a starbow.`, keys: ["ShiftLeft", "ShiftRight"], label: "Shift" },
  { id: "starChart", group: "sail", contexts: ["sail"], name: "Star chart", desc: "Open the star chart to choose where to go.", short: "star chart", keys: ["KeyM"], label: "M", action: "starChart", legend: { sail: 6 } },
  { id: "worldMap", group: "help", contexts: ["foot", "horse", "flight"], name: "World map", desc: "M opens the World map: drag to look around, wheel or pinch to zoom, C comes back to you, a marker shows where it is and lets you travel there. M again or Esc closes it.", keys: ["KeyM"], label: "M" },
  { id: "travel", group: "sail", contexts: ["sail"], name: "Set sail for your course", desc: "Sail for the world you chose. With no course yet, N opens Direct to the planets.", short: "travel", keys: ["KeyN"], label: "N", action: "travel", legend: { sail: 2 } },
  { id: "homeward", group: "sail", contexts: ["sail"], name: "Homeward", desc: `Out in space, the journey back to Earth (as Return to Earth). On Earth, ${names.starborn} sails you home.`, short: "home", keys: ["KeyK"], label: "K", action: "homeward", legend: { sail: 3 } },
  { id: "sailLand", group: "sail", contexts: ["sail"], name: "Descend or land", desc: "Press E to come down, on the Moon or beside home.", short: "land", keys: ["KeyE"], label: "E", legend: { sail: 4 } },
  { id: "spaceCats", group: "sail", contexts: ["sail"], name: "Bring the space cats", desc: "When you are beside the space cats, press O to bring them along.", keys: ["KeyO"], label: "O", action: "gather" },
  { id: "starPirouette", group: "sail", contexts: ["sail"], name: "Star pirouette", desc: `Tap W twice: ${names.starborn} turns once, slowly, about the length of her body, and comes back to her course.`, keys: ["KeyW KeyW"], label: "W W" },

  // ---- journeys between worlds
  { id: "planets", group: "sail", contexts: ["foot", "horse", "flight", "sail"], name: "Direct to the planets", desc: `Choose a world from Explore. ${names.starborn} can begin from the ground or the air; N opens the picker when there is no course yet.`, keys: [], action: "planets" },
  { id: "returnEarth", group: "journey", contexts: ["journey"], name: "Return to Earth", desc: "A journey all the way home, with the sky and the Earth coming up.", keys: [], action: "returnEarth" },
  { id: "quickReturn", group: "journey", contexts: ["journey"], name: "Home now", desc: "Straight home, without the long journey.", keys: [], action: "quickReturn" },
  { id: "arrive", group: "journey", contexts: ["journey"], name: "Arrive now", desc: "Arrive at the world now, instead of waiting for the journey.", short: "arrive now", keys: ["KeyE"], label: "E", legend: { journey: 1 } },
  { id: "stopHere", group: "journey", contexts: ["journey"], name: "Take the reins", desc: `Leave the journey here and take control. In Earth's air, ${names.starborn} returns to her wings.`, short: "take the reins", keys: ["Escape"], label: "Esc", legend: { journey: 2 } },
  { id: "lean", group: "journey", contexts: ["journey"], name: "Lean", desc: "Lean left or right as you travel.", short: "lean", keys: ["KeyA", "KeyD"], label: "A D", legend: { journey: 3 } },

  // ---- camera
  { id: "lookMouse", group: "camera", contexts: ALL, name: "Look around", desc: "Drag the world to look around. A click without dragging captures the mouse for free look; Esc lets go. Drag also works in the introduction and photo mode.", keys: [], label: "Mouse" },
  { id: "zoom", group: "camera", contexts: ALL, name: "Zoom", desc: "Scroll to move the camera closer or further.", keys: [], label: "Wheel" },
  { id: "view", group: "camera", contexts: ALL, name: "Camera view", desc: "Cycle Far, Medium and Close. Shift Tab goes the other way.", keys: ["Tab", "ShiftLeft+Tab"], label: "Tab / Shift+Tab" },

  // ---- help and recovery
  { id: "guide", group: "help", contexts: ALL, name: "Controls guide", desc: "Open this guide any time.", keys: ["Slash"], label: "/", action: "controlsGuide" },
  { id: "esc", group: "help", contexts: ["foot", "horse", "flight", "sail"], name: "Stop, leave or close", desc: "Stops an activity, leaves a race, puts a stone down, closes a card, lets go of the mouse.", short: "stop", keys: ["Escape"], label: "Esc" },
  { id: "hud", group: "help", contexts: ALL, name: "Hide the extras", desc: "F2 tucks away optional controls while keeping the minimap. Reveal opens your tools again.", keys: ["F2"], label: "F2" },
  { id: "explore", group: "help", contexts: ALL, name: "Explore menu", desc: "Tools, settings, the atlas and shortcuts, all in one place.", keys: [], label: "Explore" },
  { id: "callStarborn", group: "help", contexts: ["foot", "horse", "flight"], name: `Call ${names.starborn}`, desc: `${names.starborn}, the star-born, comes to you wherever she is.`, keys: ["KeyI"], label: "I", action: "callStarborn" },
  // ---- the dragon
  { id: "dragonSpeed", group: "dragon", contexts: ["dragon"], name: "Faster or slower", desc: "W swims faster through the air, S slows her to a drift.", keys: ["KeyW", "KeyS"], label: "W S" },
  { id: "dragonTurn", group: "dragon", contexts: ["dragon"], name: "Turn", desc: "A and D carve her round; her whole body follows the curve.", keys: ["KeyA", "KeyD"], label: "A D" },
  { id: "dragonClimb", group: "dragon", contexts: ["dragon"], name: "Climb or dive", desc: "Hold Space to climb and C to dive. She never touches the ground or the trees.", keys: ["Space", "KeyC"], label: "Space / C" },
  { id: "dragonRush", group: "dragon", contexts: ["dragon"], name: "The golden rush", desc: "Hold Shift: she streams forward with her crest alight and the air tearing off her fins.", keys: ["ShiftLeft", "ShiftRight"], label: "Shift" },
  { id: "dragonBreath", group: "dragon", contexts: ["dragon"], name: "Breathe light", desc: "F: a breath of gold and white light reaches out ahead of her.", keys: ["KeyF"], label: "F", action: "five" },
  { id: "dragonDown", group: "dragon", contexts: ["dragon"], name: "Step down", desc: "E: she finds land ahead, settles low and lets you down on a ribbon of light, then flies off until you call her again.", keys: ["KeyE"], label: "E" },
  { id: "callDragon", group: "help", contexts: ["foot", "horse"], name: `Call ${names.dragon}`, desc: `${names.dragon}, the golden dragon, flies down out of the sky and circles you; face her and press E to climb onto her neck.`, keys: ["Digit1"], label: "1", action: "callDragon" },
  { id: "recover", group: "help", contexts: ["foot", "horse", "flight", "sail"], name: "Take me somewhere safe", action: "recover", desc: "If you are stuck, this brings you back to somewhere safe.", keys: [] },
  { id: "sky", group: "help", contexts: ALL, name: "Change the weather", desc: "2 turns the sky to the next weather: your real sky, sunny, showers, rain, storm, mist or snow.", keys: ["Digit2"], label: "2" },
  { id: "refresh", group: "help", contexts: ALL, name: "Refresh the universe", desc: "If anything lags or someone is caught in a pose: the world folds into the stars and rebuilds, and you come back where you stood with every star and keepsake kept.", keys: ["F5"], label: "F5" },
]

/** Bindings the game really answers to (not pending). */
export const liveBindings = (): Binding[] => BINDINGS.filter(b => !b.pending)

/** Whether a binding is live, by id (the menu uses this to hide pending controls). */
export const isLive = (id: string): boolean => BINDINGS.some(b => b.id === id && !b.pending)

const TOKEN_LABEL: Record<string, string> = {
  ShiftLeft: "Shift", ShiftRight: "Shift", Space: "Space", Enter: "Enter", Escape: "Esc", Slash: "/", Tab: "Tab", F2: "F2", F5: "F5",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
}
/** "KeyA" -> "A", "ShiftLeft" -> "Shift", "Escape" -> "Esc". */
export const keyLabel = (token: string): string => TOKEN_LABEL[token] ?? token.replace(/^Key/, "")
/** "ShiftLeft+KeyC" -> "Shift+C", "KeyA KeyA" -> "A A". */
export const signatureLabel = (sig: string): string =>
  sig.split(" ").map(part => part.split("+").map(keyLabel).join("+")).join(" ")

/** What a row shows as its key: the explicit label, or the first signature. */
export const bindingLabel = (b: Binding): string => b.label ?? (b.keys[0] ? signatureLabel(b.keys[0]) : "")

/** Every KeyboardEvent.code a binding touches (for the input.ts check). */
export const codesOf = (b: Binding): string[] => b.keys.flatMap(sig => sig.split(/[ +]/))

const LEGEND_LIMIT = 4
/**
 * The few things worth showing in a legend context, most useful first. An item
 * the player has used `FADE_AFTER` times is dropped.
 */
export const FADE_AFTER = 4
export const legendItems = (ctx: LegendContext, used: Record<string, number>): Binding[] => {
  return BINDINGS
    .filter(b => !b.pending && b.legend?.[ctx] !== undefined)
    .filter(b => (used[b.id] ?? 0) < FADE_AFTER)
    .sort((a, b) => (a.legend![ctx] ?? 0) - (b.legend![ctx] ?? 0))
    .slice(0, LEGEND_LIMIT)
}
