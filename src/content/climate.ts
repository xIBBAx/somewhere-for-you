/** Editable, infrequent reactions to real local conditions. */
export const CLIMATE_LINES = {
  hot: [
    "It's too hot. Where's the AC?",
    "Ice cream. Now.",
    "I'm finding the nearest cool place.",
    "Heat shimmer on the path — summer is showing off.",
  ],
  rain: [
    "The whole world smells of wet earth. Mitti ki khushboo.",
    "Monsoon weather. The cat disagrees.",
    "Puddles are tiny mirrors today.",
  ],
  windy: ["Even the flowers are dancing today.", "Wind is writing letters in the leaves."],
  snow: ["Snow day — the cat is officially confused.", "Every rooftop is powdered sugar."],
  fog: ["The world woke up inside a cloud.", "Fog makes everything feel like a secret."],
  cloudy: ["Soft grey light, perfect for making things.", "Clouds are knitting a blanket overhead."],
  clear: ["Clear sky, clear heart.", "Sun is doing its best little performance today."],
  night: ["The stars kept a little light on.", "Moonlight, quiet, and a very busy cat."],
} as const
