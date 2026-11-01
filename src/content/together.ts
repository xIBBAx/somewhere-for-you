import { gift, names } from "../personalization"

/**
 * Little things the two characters say to each other. The idle lines come
 * from the personalization (`chatter`); the reactions below are neutral, so
 * they suit friends, family and partners alike. One is picked at random.
 */
type Lines = { explorer: readonly string[]; companion: readonly string[] }

export const TOGETHER_LINES = {
  get idle(): Lines {
    return gift().chatter
  },
  night: {
    companion: [
      "The stars came out.",
      "Want to release a lantern?",
      "It's so quiet tonight.",
      "Fireflies! Let's catch some.",
    ],
    explorer: [
      "Make a wish with me?",
      "The moon is so bright tonight.",
      "Stay close, okay?",
      "Fireflies!",
    ],
  } satisfies Lines,
  follow: {
    companion: ["Right behind you.", "Coming!", "Lead the way."],
    explorer: ["Coming!", "Wait for me!", "Okay, let's go!"],
  } satisfies Lines,
  get wait(): Lines {
    return {
      companion: ["I'll wait right here.", "Take your time, I'm not going anywhere.", "I'll keep this spot warm."],
      explorer: [`I'll wait here with ${names.cat}.`, "Don't be long!", "Okay, I'll stay here."],
    }
  },
  regroup: {
    companion: ["Found you!", "There you are.", "You walk fast!"],
    explorer: ["Found you!", "Hey, wait for me!", "There you are!"],
  } satisfies Lines,
  hug: {
    companion: ["Come here.", "Best part of the day.", "Glad you're here."],
    explorer: ["Hug!", "Come here, you.", "Don't let go yet."],
  } satisfies Lines,
  dance: {
    companion: ["May I have this dance?", "Don't step on my feet.", "One more song."],
    explorer: ["Dance with me!", "I'm leading this time.", "Slow one, okay?"],
  } satisfies Lines,
}
