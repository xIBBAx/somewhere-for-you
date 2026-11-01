/**
 * Each memory stop has its own energy, read from what the memory is about.
 * The shaders are shared; these numbers are the identities.
 *
 * mote mode: 0 rising helix · 1 vortex ring · 2 rain · 3 darting · 4 stream · 5 steam
 */
export type WispSignature = {
  hot: string
  cool: string
  coreH: number
  /** r0, r1, rise, height */
  m0: [number, number, number, number]
  /** turns, swirl, jitter, cycle (s) */
  m1: [number, number, number, number]
  /** size (m), mode, lean (m), dart rate */
  m2: [number, number, number, number]
  motes: number
  strands: number
  /** p, q, radius, tube */
  f0: [number, number, number, number]
  /** speed, trail, width (m), tilt */
  f1: [number, number, number, number]
  /** yScale, yOffset, flicker */
  f2: [number, number, number, number]
  /** volumetric glow sigma (m) and density */
  glow: [number, number]
}

const base: WispSignature = {
  hot: "#ffe2a8", cool: "#d79a52", coreH: 1.0,
  m0: [0.35, 0.8, 1.6, 0.4], m1: [1.2, 0.25, 0.06, 5.5], m2: [0.035, 0, 0.35, 0.6],
  motes: 160, strands: 4,
  f0: [2, 3, 0.42, 0.16], f1: [0.55, 1.6, 0.012, 0.9], f2: [1, 0, 1, 0],
  glow: [0.22, 0.55],
}

const sig = (o: Partial<WispSignature>): WispSignature => ({ ...base, ...o })

export const WISP_SIGNATURES: Record<string, WispSignature> = {
  // a first breath: pale dawn gold rising in a slow narrowing helix
  "first-steps": sig({
    hot: "#fff1cf", cool: "#e0b46a",
    m0: [0.3, 0.7, 2.0, 0.3], m1: [1.0, 0.18, 0.05, 6.5], motes: 150,
    strands: 3, f0: [2, 3, 0.38, 0.14], f1: [0.42, 1.8, 0.011, 0.6],
  }),
  // the verandah: amber steam curling up, two strands braided around each other
  "cafe-table": sig({
    hot: "#ffd9a6", cool: "#b8743c",
    m0: [0.12, 0.3, 1.5, 0.2], m1: [0.9, 0.35, 0.05, 4.8], m2: [0.032, 5, 0.3, 0.6], motes: 170,
    strands: 2, f0: [1, 4, 0.3, 0.2], f1: [0.6, 2.0, 0.013, 0.25], f2: [1.4, 0.1, 0.8, 0],
  }),
  // no destination: dew-green gold wandering wide and lazy
  "long-way": sig({
    hot: "#f4efd2", cool: "#a8b48a",
    m0: [0.5, 1.15, 0.9, 0.7], m1: [0.6, 0.12, 0.14, 8.0], m2: [0.03, 0, 0.5, 0.6], motes: 150,
    strands: 4, f0: [1, 2, 0.6, 0.24], f1: [0.28, 2.4, 0.01, 1.3], f2: [0.7, 0, 0.6, 0],
  }),
  // where things get made: violet-ink vortex with white-hot sparks
  "little-studio": sig({
    hot: "#f4e8ff", cool: "#7b5bd6",
    m0: [0.45, 0.6, 0, 0.35], m1: [1, 0.55, 0.04, 2.6], m2: [0.028, 1, 0.3, 0.6], motes: 190,
    strands: 5, f0: [3, 5, 0.4, 0.13], f1: [0.85, 1.2, 0.009, 1.1], f2: [1, 0, 1.2, 0], glow: [0.2, 0.5],
  }),
  // the local management team: warm peach motes that rest, then flick
  "cat-garden": sig({
    hot: "#ffe6c4", cool: "#e09a68",
    m0: [0.35, 0.95, 0, 0.7], m1: [1, 0, 0.03, 4.0], m2: [0.034, 3, 0.45, 0.75], motes: 120,
    strands: 3, f0: [2, 5, 0.46, 0.12], f1: [1.1, 0.8, 0.011, 1.4], f2: [1.2, 0, 1.3, 0],
  }),
  // soft heart, strong hands: an ember vortex ring, steady as breathing
  "training-corner": sig({
    hot: "#ffd3a0", cool: "#c2482e", coreH: 1.05,
    m0: [0.55, 0.62, 0, 0.3], m1: [1, 0.3, 0.025, 3.4], m2: [0.033, 1, 0.25, 0.6], motes: 200,
    strands: 6, f0: [1, 6, 0.5, 0.1], f1: [0.7, 1.0, 0.011, 0.35], f2: [1, 0, 0.9, 0], glow: [0.24, 0.6],
  }),
  // the chai stall: rose and lilac climbing quickly, a little shimmer
  "corner-cafe": sig({
    hot: "#ffe3f0", cool: "#c77fb4",
    m0: [0.3, 0.75, 2.4, 0.3], m1: [1.6, 0.3, 0.05, 4.4], motes: 180,
    strands: 4, f0: [2, 5, 0.4, 0.15], f1: [0.65, 1.5, 0.011, 1.0], f2: [1.1, 0.05, 1.4, 0],
  }),
  // one umbrella was enough: silver-blue drops falling under a sheltering dome
  "rain-spot": sig({
    hot: "#eaf4ff", cool: "#6f93c4",
    m0: [0.3, 0.75, 1.8, 0.1], m1: [0.15, 0.05, 0.02, 2.2], m2: [0.026, 2, 0.3, 0.6], motes: 170,
    strands: 3, f0: [1, 2, 0.62, 0.22], f1: [0.3, 2.2, 0.01, 0.3], f2: [0.45, 0.62, 0.7, 0],
  }),
  // past the last lamppost: pale starlight running ahead along the path
  "path-ahead": sig({
    hot: "#f2fbff", cool: "#7fb5d9",
    m0: [0.12, 0.45, 3.2, 0.7], m1: [2, 0.4, 0.04, 3.8], m2: [0.03, 4, 0.3, 0.6], motes: 170,
    strands: 4, f0: [2, 3, 0.36, 0.2], f1: [0.6, 2.0, 0.01, 1.2], f2: [1.6, 0.1, 1, 0],
  }),
}

export const signatureFor = (id: string): WispSignature => WISP_SIGNATURES[id] ?? base
