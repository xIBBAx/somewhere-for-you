import { resolveModelUrl, resolveMusic, gift } from "../personalization"

/**
 * Central manifest for the assets the story and characters use. (World
 * systems such as horses, deer and the sky keep their own paths next to their
 * loaders.)
 */
// Vite expands this to file names at build time without importing audio data.
// Optional files that are absent must not produce network errors on static hosts.
const includedAudio = new Set(Object.keys(import.meta.glob("/public/assets/audio/*.mp3")))
const optionalAudio = (file: string): string | undefined =>
  includedAudio.has(`/public/assets/audio/${file}`) ? `/assets/audio/${file}` : undefined

/** Built-in character appearances (asset-pipeline/characters/profiles/*.json). */
export const CHARACTER_PRESETS: Record<string, { label: string; url: string }> = {
  explorer: { label: "Explorer — braid, teal dungarees", url: "/assets/characters/explorer.glb" },
  companion: { label: "Companion — ochre shirt, short hair", url: "/assets/characters/companion.glb" },
}

/** The model a character role uses: a custom one if it is available, else its preset. */
export const characterModelUrl = (role: "explorer" | "companion"): { url: string; custom: boolean } => {
  const choice = gift().characters[role]
  const custom = resolveModelUrl(choice.model)
  if (custom) return { url: custom, custom: true }
  return { url: (CHARACTER_PRESETS[choice.preset] ?? CHARACTER_PRESETS[role]).url, custom: false }
}

export const assets = {
  environment: {
    cornerCafe: "/assets/environment/corner-cafe.glb",
    littleStudio: "/assets/environment/little-studio.glb",
  },
  // Audio is music only: no effects, no ambience (see docs/ARCHITECTURE.md).
  audio: {
    /** "First Snow" by Holizna, CC0 (ASSET_LICENSES.md), unless the gift chooses another track or silence */
    get ambient(): { src: string; format?: string } | undefined {
      return resolveMusic(optionalAudio("first-snow.mp3"))
    },
    memoryChime: undefined as string | undefined,
    bell: undefined as string | undefined,
  },
}
