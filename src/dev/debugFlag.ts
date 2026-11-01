/**
 * Whether the QA tools are on: only in a development build (npm run dev) or a
 * build made with VITE_DEV_TOOLS=1, and only with ?debug in the address. A
 * normal production build ignores ?debug entirely, so the deployed game never
 * exposes cheats, runtime internals or render capture.
 */
export const debugAllowed = import.meta.env.DEV || import.meta.env.VITE_DEV_TOOLS === "1"

export const debugEnabled = (): boolean =>
  debugAllowed && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug")
