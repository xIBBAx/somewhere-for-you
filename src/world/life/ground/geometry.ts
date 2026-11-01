import * as THREE from "three"

/**
 * Original procedural low-poly anatomy for the ground creatures.
 *
 * Every creature is modelled at "one model unit = its body length" with +z
 * forward, +y up and the belly on y = 0; the instance scale turns that into
 * display metres. Kinds that share a draw call are combined into one indexed
 * geometry whose `aKind` attribute names the owning sub-kind (−1 = shared);
 * the vertex shader collapses foreign parts to a point.
 *
 * Vertex attributes:
 *  - color  vertex colour (linear)
 *  - aKind  owning sub-kind, −1 for shared parts
 *  - aRig   (part, a, b, c) animation rig, see PART below
 *  - aTint  0…1 how far the per-instance tint replaces the vertex colour
 */

export const PART = {
  body: 0,
  /** a: gait phase offset, b: weight hip→foot, c: side */
  leg: 1,
  /** a: phase offset, b: weight base→tip, c: side */
  antenna: 2,
  /** wing case; c: side */
  elytron: 3,
  /** membranous wing / cricket forewing; b: weight from hinge, c: side */
  wing: 4,
  /** b: weight, c: side */
  mandible: 5,
  /** grasshopper/cricket hind leg; a: segment (0 femur, 1 tibia, 2 tarsus), c: side */
  jumpLeg: 6,
  /** snail shell; a: tube angle φ/π, b: position along the spiral 0 apex…1 lip */
  shell: 7,
  /** snail foot/body */
  foot: 8,
  /** snail tentacle; b: weight base→tip, c: side */
  tentacle: 9,
  /** segmented body ring; a: 0 tail…1 head */
  segment: 10,
  /** food carried by an ant */
  load: 11,
} as const

type V3 = readonly [number, number, number]
type Rig = readonly [number, number, number, number]
type ColorFn = string | ((x: number, y: number, z: number) => string)

const BODY: Rig = [PART.body, 0, 0, 0]

class Builder {
  readonly pos: number[] = []
  readonly col: number[] = []
  readonly kind: number[] = []
  readonly rig: number[] = []
  readonly tint: number[] = []
  readonly idx: number[] = []
  sub = -1
  private readonly color = new THREE.Color()
  private readonly cache = new Map<string, THREE.Color>()

  private rgb(hex: string): THREE.Color {
    let c = this.cache.get(hex)
    if (!c) {
      c = new THREE.Color(hex)
      this.cache.set(hex, c)
    }
    return c
  }

  v(x: number, y: number, z: number, color: string, rig: Rig, tint: number): number {
    this.pos.push(x, y, z)
    this.color.copy(this.rgb(color))
    this.col.push(this.color.r, this.color.g, this.color.b)
    this.kind.push(this.sub)
    this.rig.push(rig[0], rig[1], rig[2], rig[3])
    this.tint.push(tint)
    return this.pos.length / 3 - 1
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c)
  }

  /**
   * Ellipsoid (or part of one). θ runs from the top pole (0) down; φ around
   * the y axis starting at +x toward +z. `yMin` flattens anything below it.
   */
  ellipsoid(
    c: V3, r: V3, lat: number, lon: number, color: ColorFn, rig: Rig | ((x: number, y: number, z: number) => Rig), tint: number,
    opts: { thetaMax?: number; phiStart?: number; phiLen?: number; yMin?: number; cap?: string } = {},
  ): void {
    const thetaMax = opts.thetaMax ?? Math.PI
    const phiStart = opts.phiStart ?? 0
    const phiLen = opts.phiLen ?? Math.PI * 2
    const closed = phiLen >= Math.PI * 2 - 1e-6
    const cols = closed ? lon : lon + 1
    const base = this.pos.length / 3
    for (let i = 0; i <= lat; i++) {
      const th = (i / lat) * thetaMax
      for (let j = 0; j < cols; j++) {
        const ph = phiStart + (j / lon) * phiLen
        const nx = Math.sin(th) * Math.cos(ph)
        const ny = Math.cos(th)
        const nz = Math.sin(th) * Math.sin(ph)
        const x = c[0] + nx * r[0]
        const y = Math.max(opts.yMin ?? -Infinity, c[1] + ny * r[1])
        const z = c[2] + nz * r[2]
        const hex = typeof color === "string" ? color : color(nx, ny, nz)
        this.v(x, y, z, hex, typeof rig === "function" ? rig(nx, ny, nz) : rig, tint)
      }
    }
    for (let i = 0; i < lat; i++) {
      for (let j = 0; j < lon; j++) {
        const j1 = closed ? (j + 1) % lon : j + 1
        const a = base + i * cols + j
        const b = base + i * cols + j1
        const d = base + (i + 1) * cols + j
        const e = base + (i + 1) * cols + j1
        this.tri(a, d, b)
        this.tri(b, d, e)
      }
    }
    if (opts.cap && thetaMax < Math.PI - 1e-6) {
      // close the open rim with a fan (belly plate under a dome)
      const rim = base + lat * cols
      const cy = c[1] + Math.cos(thetaMax) * r[1]
      const centre = this.v(c[0], Math.max(opts.yMin ?? -Infinity, cy), c[2], opts.cap, typeof rig === "function" ? rig(0, -1, 0) : rig, tint)
      for (let j = 0; j < lon; j++) {
        const j1 = closed ? (j + 1) % lon : j + 1
        if (!closed && j1 > lon) continue
        this.tri(centre, rim + j1, rim + j)
      }
    }
  }

  /** Tapered three-sided prism from a to b (legs, antennae, mandibles). */
  limb(a: V3, b: V3, wa: number, wb: number, color: string, rigA: Rig, rigB: Rig, tint = 0, colorB?: string): void {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const dz = b[2] - a[2]
    const len = Math.hypot(dx, dy, dz) || 1
    const fx = dx / len
    const fy = dy / len
    const fz = dz / len
    // side = f × up (fallback to x when nearly vertical)
    let sx = fy * 0 - fz * 1
    let sy = fz * 0 - fx * 0
    let sz = fx * 1 - fy * 0
    let sl = Math.hypot(sx, sy, sz)
    if (sl < 1e-3) {
      sx = 0
      sy = fz
      sz = -fy
      sl = Math.hypot(sx, sy, sz) || 1
    }
    sx /= sl
    sy /= sl
    sz /= sl
    const ux = sy * fz - sz * fy
    const uy = sz * fx - sx * fz
    const uz = sx * fy - sy * fx
    const ring = (p: V3, w: number, rig: Rig, hex: string): number => {
      const first = this.pos.length / 3
      for (let k = 0; k < 3; k++) {
        const ang = Math.PI / 2 + (k * Math.PI * 2) / 3
        const cx = Math.cos(ang) * w
        const cy = Math.sin(ang) * w
        this.v(p[0] + sx * cx + ux * cy, p[1] + sy * cx + uy * cy, p[2] + sz * cx + uz * cy, hex, rig, tint)
      }
      return first
    }
    const ra = ring(a, wa, rigA, color)
    const rb = ring(b, wb, rigB, colorB ?? color)
    for (let k = 0; k < 3; k++) {
      const k1 = (k + 1) % 3
      this.tri(ra + k, rb + k, rb + k1)
      this.tri(ra + k, rb + k1, ra + k1)
    }
    this.tri(rb, rb + 2, rb + 1)
    this.tri(ra, ra + 1, ra + 2)
  }

  /** Chain of limbs through a polyline with per-point widths and rigs. */
  chain(points: V3[], widths: number[], color: string, rigs: Rig[], tint = 0): void {
    for (let i = 0; i < points.length - 1; i++) this.limb(points[i], points[i + 1], widths[i], widths[i + 1], color, rigs[i], rigs[i + 1], tint)
  }

  /**
   * Swept tube along +z with elliptical cross-sections: rings[i] gives
   * z, centre y, half-width, half-height. `fn` colours/rigs each vertex.
   */
  tube(rings: { z: number; y: number; w: number; h: number; x?: number }[], sides: number, fn: (ring: number, side: number, angle: number) => { color: string; rig: Rig; tint: number }, caps = true): void {
    const base = this.pos.length / 3
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i]
      for (let j = 0; j < sides; j++) {
        const ang = (j / sides) * Math.PI * 2
        const p = fn(i, j, ang)
        this.v((r.x ?? 0) + Math.cos(ang) * r.w, r.y + Math.sin(ang) * r.h, r.z, p.color, p.rig, p.tint)
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides
        const a = base + i * sides + j
        const b = base + i * sides + j1
        const c = base + (i + 1) * sides + j
        const d = base + (i + 1) * sides + j1
        this.tri(a, b, c)
        this.tri(b, d, c)
      }
    }
    if (caps) {
      const first = rings[0]
      const last = rings[rings.length - 1]
      const p0 = fn(0, 0, 0)
      const p1 = fn(rings.length - 1, 0, 0)
      const c0 = this.v(first.x ?? 0, first.y, first.z - first.w * 0.4, p0.color, p0.rig, p0.tint)
      const c1 = this.v(last.x ?? 0, last.y, last.z + last.w * 0.4, p1.color, p1.rig, p1.tint)
      const lastBase = base + (rings.length - 1) * sides
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides
        this.tri(c0, base + j1, base + j)
        this.tri(c1, lastBase + j, lastBase + j1)
      }
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, colors: [string, string, string, string], rigs: [Rig, Rig, Rig, Rig], tint = 0): void {
    const ia = this.v(a[0], a[1], a[2], colors[0], rigs[0], tint)
    const ib = this.v(b[0], b[1], b[2], colors[1], rigs[1], tint)
    const ic = this.v(c[0], c[1], c[2], colors[2], rigs[2], tint)
    const id = this.v(d[0], d[1], d[2], colors[3], rigs[3], tint)
    this.tri(ia, ib, ic)
    this.tri(ia, ic, id)
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3))
    g.setAttribute("aKind", new THREE.Float32BufferAttribute(this.kind, 1))
    g.setAttribute("aRig", new THREE.Float32BufferAttribute(this.rig, 4))
    g.setAttribute("aTint", new THREE.Float32BufferAttribute(this.tint, 1))
    g.setIndex(this.idx)
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }
}

const leg = (phase: number, w: number, side: number): Rig => [PART.leg, phase, w, side]
const ant = (phase: number, w: number, side: number): Rig => [PART.antenna, phase, w, side]

/** Six jointed legs: hips, knee lift and foot reach per pair, tripod gait. */
const sixLegs = (
  b: Builder, hipZ: readonly number[], hipX: number, hipY: number, kneeX: number, kneeY: number, footX: number, reach: readonly number[],
  width: number, color: string, tint = 0,
): void => {
  for (let p = 0; p < 3; p++) {
    for (const s of [-1, 1]) {
      // tripod: front-left, middle-right and hind-left step together
      const phase = (p % 2 === 0) === s < 0 ? 0 : Math.PI
      const hip: V3 = [s * hipX, hipY, hipZ[p]]
      const knee: V3 = [s * kneeX, kneeY, hipZ[p] + reach[p] * 0.45]
      const foot: V3 = [s * footX, 0, hipZ[p] + reach[p]]
      b.limb(hip, knee, width, width * 0.8, color, leg(phase, 0, s), leg(phase, 0.5, s), tint)
      b.limb(knee, foot, width * 0.8, width * 0.55, color, leg(phase, 0.5, s), leg(phase, 1, s), tint)
    }
  }
}

// --- ants -------------------------------------------------------------------

/** Ant: head, elbowed antennae, mesosoma, the petiole "waist" node and gaster. */
export const createAntGeometry = (): THREE.BufferGeometry => {
  const b = new Builder()
  const dark = "#211714"
  const gaster = "#120d0c"
  b.ellipsoid([0, 0.09, -0.27], [0.105, 0.09, 0.17], 4, 7, gaster, BODY, 0)
  b.ellipsoid([0, 0.09, -0.06], [0.03, 0.055, 0.03], 3, 5, dark, BODY, 1)
  b.ellipsoid([0, 0.09, 0.1], [0.055, 0.06, 0.12], 4, 6, dark, BODY, 1)
  b.ellipsoid([0, 0.09, 0.32], [0.082, 0.07, 0.092], 4, 6, dark, BODY, 1)
  for (const s of [-1, 1]) {
    b.limb([s * 0.035, 0.065, 0.39], [s * 0.012, 0.06, 0.47], 0.016, 0.009, dark, [PART.mandible, 0, 0, s], [PART.mandible, 0, 1, s], 1)
    // geniculate (elbowed) antenna: long scape, then the funiculus
    const ph = s > 0 ? 0 : 1.7
    b.limb([s * 0.03, 0.13, 0.37], [s * 0.075, 0.19, 0.44], 0.013, 0.011, dark, ant(ph, 0.1, s), ant(ph, 0.45, s), 0.6)
    b.limb([s * 0.075, 0.19, 0.44], [s * 0.14, 0.13, 0.6], 0.011, 0.009, dark, ant(ph, 0.45, s), ant(ph, 1, s), 0.6)
  }
  sixLegs(b, [0.16, 0.1, 0.04], 0.04, 0.07, 0.16, 0.15, 0.28, [0.2, 0, -0.24], 0.018, dark, 0.35)
  b.ellipsoid([0, 0.065, 0.53], [0.05, 0.042, 0.055], 3, 5, "#e2d3a4", [PART.load, 0, 0, 0], 0)
  return b.build()
}

// --- beetles ----------------------------------------------------------------

/** Seven-spot ladybird (0), violet ground beetle (1), stag beetle (2). */
export const createBeetleGeometry = (): THREE.BufferGeometry => {
  const b = new Builder()
  const black = "#0d0b0b"

  // 0: ladybird — domed, almost round; spots are painted in the shader
  b.sub = 0
  for (const s of [-1, 1]) {
    b.ellipsoid([0, 0.07, -0.1], [0.42, 0.36, 0.38], 5, 6, "#c8231a", [PART.elytron, 0, 0, s], 1,
      { thetaMax: Math.PI / 2, phiStart: s > 0 ? -Math.PI / 2 : Math.PI / 2, phiLen: Math.PI })
  }
  b.ellipsoid([0, 0.07, -0.1], [0.4, 0.04, 0.36], 1, 10, black, BODY, 0, { thetaMax: Math.PI / 2, cap: black })
  // pronotum: black with the white "cheek" patches at its front corners
  b.ellipsoid([0, 0.07, 0.29], [0.27, 0.19, 0.13], 3, 10, (x, _y, z) => (Math.abs(x) > 0.55 && z > -0.1 ? "#efe9dc" : black), BODY, 0, { thetaMax: Math.PI / 2, cap: black })
  b.ellipsoid([0, 0.07, 0.41], [0.14, 0.09, 0.07], 3, 6, black, BODY, 0)
  for (const s of [-1, 1]) {
    b.limb([s * 0.06, 0.1, 0.45], [s * 0.12, 0.13, 0.52], 0.014, 0.022, black, ant(s, 0.2, s), ant(s, 1, s))
    // hind wings, modelled unfolded; the shader folds them away under the case
    b.quad([s * 0.04, 0.33, 0.08], [s * 0.9, 0.36, -0.12], [s * 0.72, 0.34, -0.5], [s * 0.05, 0.32, -0.16],
      ["#3d332c", "#4a3f37", "#4a3f37", "#3d332c"], [[PART.wing, 0, 0, s], [PART.wing, 0, 1, s], [PART.wing, 0, 1, s], [PART.wing, 0, 0.1, s]])
  }
  sixLegs(b, [0.22, 0.06, -0.1], 0.12, 0.06, 0.3, 0.08, 0.42, [0.12, 0, -0.14], 0.03, black)

  // 1: violet ground beetle — long oval, black with violet margins
  b.sub = 1
  const violet = "#4b2a7a"
  const rim = (limit: number) => (x: number) => (Math.abs(x) > limit ? violet : "#121016")
  b.ellipsoid([0, 0.075, -0.14], [0.17, 0.11, 0.31], 4, 10, rim(0.82), BODY, 0, { thetaMax: Math.PI * 0.62, cap: "#121016" })
  b.ellipsoid([0, 0.08, 0.17], [0.12, 0.065, 0.09], 3, 8, rim(0.7), BODY, 0, { thetaMax: Math.PI * 0.6, cap: "#121016" })
  b.ellipsoid([0, 0.07, 0.3], [0.075, 0.055, 0.08], 3, 6, "#121016", BODY, 0)
  for (const s of [-1, 1]) {
    b.limb([s * 0.03, 0.06, 0.36], [s * 0.008, 0.055, 0.43], 0.018, 0.008, "#121016", [PART.mandible, 0, 0, s], [PART.mandible, 0, 1, s])
    b.chain([[s * 0.05, 0.09, 0.36], [s * 0.15, 0.13, 0.49], [s * 0.24, 0.1, 0.66]], [0.012, 0.01, 0.008], "#16131a", [ant(s * 2, 0.1, s), ant(s * 2, 0.5, s), ant(s * 2, 1, s)])
  }
  sixLegs(b, [0.2, 0.1, 0], 0.05, 0.05, 0.2, 0.13, 0.34, [0.22, -0.02, -0.3], 0.024, "#141117")

  // 2: stag beetle — chestnut wing cases, black fore-body, antler mandibles
  b.sub = 2
  for (const s of [-1, 1]) {
    b.ellipsoid([0, 0.08, -0.17], [0.17, 0.1, 0.27], 4, 5, "#5e2a16", [PART.elytron, 0, 0, s], 1,
      { thetaMax: Math.PI * 0.55, phiStart: s > 0 ? -Math.PI / 2 : Math.PI / 2, phiLen: Math.PI })
    b.quad([s * 0.03, 0.17, 0.05], [s * 0.62, 0.2, -0.05], [s * 0.5, 0.18, -0.42], [s * 0.04, 0.17, -0.2],
      ["#3c3026", "#4a3c30", "#4a3c30", "#3c3026"], [[PART.wing, 0, 0, s], [PART.wing, 0, 1, s], [PART.wing, 0, 1, s], [PART.wing, 0, 0.1, s]])
    const mr = (w: number): Rig => [PART.mandible, 0, w, s]
    b.chain([[s * 0.08, 0.075, 0.25], [s * 0.145, 0.09, 0.33], [s * 0.125, 0.1, 0.43], [s * 0.05, 0.105, 0.5]], [0.032, 0.028, 0.022, 0.012], "#6e2a12", [mr(0), mr(0.4), mr(0.75), mr(1)])
    b.limb([s * 0.135, 0.095, 0.38], [s * 0.08, 0.11, 0.395], 0.014, 0.007, "#6e2a12", mr(0.6), mr(0.7))
    b.chain([[s * 0.1, 0.09, 0.24], [s * 0.18, 0.12, 0.26], [s * 0.25, 0.12, 0.33]], [0.01, 0.009, 0.014], black, [ant(s, 0.1, s), ant(s, 0.5, s), ant(s, 1, s)])
  }
  b.ellipsoid([0, 0.08, -0.17], [0.16, 0.035, 0.26], 1, 8, black, BODY, 0, { thetaMax: Math.PI / 2, cap: black })
  b.ellipsoid([0, 0.085, 0.08], [0.16, 0.075, 0.08], 3, 8, "#171211", BODY, 0, { cap: black, thetaMax: Math.PI * 0.6 })
  b.ellipsoid([0, 0.075, 0.2], [0.15, 0.06, 0.07], 3, 7, black, BODY, 0)
  sixLegs(b, [0.12, 0.02, -0.08], 0.07, 0.06, 0.22, 0.12, 0.34, [0.16, -0.02, -0.24], 0.024, black)
  return b.build()
}

// --- walkers (grasshopper, cricket, harvestman) -------------------------------

const jump = (seg: number, w: number, side: number): Rig => [PART.jumpLeg, seg, w, side]

/** Meadow grasshopper (0), field cricket (1), harvestman (2). */
export const createWalkerGeometry = (): THREE.BufferGeometry => {
  const b = new Builder()

  // 0: grasshopper — slim, short antennae, folded "drumstick" hind legs
  b.sub = 0
  const green = "#6f8f3a"
  b.tube(
    [
      { z: -0.5, y: 0.12, w: 0.02, h: 0.02 },
      { z: -0.36, y: 0.12, w: 0.05, h: 0.05 },
      { z: -0.15, y: 0.125, w: 0.062, h: 0.062 },
      { z: 0.08, y: 0.135, w: 0.068, h: 0.07 },
    ],
    6, (_i, _j, a) => ({ color: Math.sin(a) < -0.3 ? "#a2ad62" : green, rig: BODY, tint: Math.sin(a) < -0.3 ? 0.5 : 1 }), true,
  )
  b.ellipsoid([0, 0.15, 0.2], [0.07, 0.075, 0.12], 3, 7, green, BODY, 1)
  b.ellipsoid([0, 0.185, 0.22], [0.075, 0.055, 0.1], 3, 7, "#5a7530", BODY, 0.8, { thetaMax: Math.PI * 0.55 })
  b.ellipsoid([0, 0.17, 0.36], [0.065, 0.085, 0.075], 3, 7, green, BODY, 1)
  for (const s of [-1, 1]) {
    b.ellipsoid([s * 0.052, 0.21, 0.375], [0.028, 0.032, 0.03], 2, 5, "#5a4630", BODY, 0)
    b.limb([s * 0.025, 0.24, 0.41], [s * 0.075, 0.31, 0.6], 0.011, 0.008, "#6b6a3a", ant(s, 0.1, s), ant(s, 1, s))
    b.limb([s * 0.035, 0.2, 0.18], [s * 0.03, 0.17, -0.22], 0.03, 0.022, "#7a7742", [PART.wing, 0, 0, s], [PART.wing, 0, 1, s], 0.5)
    // hind leg: femur, tibia, tarsus
    b.limb([s * 0.055, 0.12, 0.1], [s * 0.1, 0.3, -0.25], 0.045, 0.024, green, jump(0, 0, s), jump(0, 1, s), 1, "#5c6b33")
    b.limb([s * 0.1, 0.3, -0.25], [s * 0.11, 0.04, 0.02], 0.016, 0.012, "#56622f", jump(1, 0, s), jump(1, 1, s), 0.6)
    b.limb([s * 0.11, 0.04, 0.02], [s * 0.115, 0, 0.09], 0.012, 0.008, "#56622f", jump(2, 0, s), jump(2, 1, s), 0.6)
    for (let p = 0; p < 2; p++) {
      const phase = (p === 0) === s < 0 ? 0 : Math.PI
      const hz = p === 0 ? 0.3 : 0.18
      b.limb([s * 0.04, 0.11, hz], [s * 0.1, 0.14, hz + (p === 0 ? 0.07 : 0.01)], 0.016, 0.013, "#5f7a33", leg(phase, 0, s), leg(phase, 0.5, s), 0.7)
      b.limb([s * 0.1, 0.14, hz + (p === 0 ? 0.07 : 0.01)], [s * 0.15, 0, hz + (p === 0 ? 0.12 : -0.01)], 0.013, 0.009, "#5f7a33", leg(phase, 0.5, s), leg(phase, 1, s), 0.7)
    }
  }

  // 1: field cricket — stout and black, big round head, long antennae, cerci
  b.sub = 1
  const black = "#1a1512"
  b.ellipsoid([0, 0.11, -0.12], [0.12, 0.09, 0.3], 4, 8, black, BODY, 1)
  b.ellipsoid([0, 0.14, 0.2], [0.115, 0.085, 0.085], 3, 8, black, BODY, 1)
  b.ellipsoid([0, 0.14, 0.34], [0.11, 0.1, 0.095], 4, 8, "#120e0c", BODY, 0)
  for (const s of [-1, 1]) {
    b.chain([[s * 0.04, 0.19, 0.41], [s * 0.22, 0.24, 0.72], [s * 0.42, 0.15, 1.02]], [0.011, 0.008, 0.006], "#2a2018", [ant(s, 0.1, s), ant(s, 0.5, s), ant(s, 1, s)])
    // forewings: yellow at the base, dark behind — the tegmina he rubs to sing
    b.quad([s * 0.008, 0.205, 0.17], [s * 0.118, 0.19, 0.16], [s * 0.112, 0.16, -0.33], [s * 0.008, 0.18, -0.34],
      ["#c49a36", "#b48a30", "#2a2018", "#2a2018"], [[PART.wing, 0, 0, s], [PART.wing, 0, 0.1, s], [PART.wing, 0, 1, s], [PART.wing, 0, 1, s]])
    b.limb([s * 0.03, 0.1, -0.4], [s * 0.1, 0.12, -0.62], 0.01, 0.005, "#3a2c22", BODY, BODY)
    b.limb([s * 0.06, 0.1, 0.02], [s * 0.14, 0.2, -0.28], 0.06, 0.03, "#2a1a14", jump(0, 0, s), jump(0, 1, s), 0, "#5a2416")
    b.limb([s * 0.14, 0.2, -0.28], [s * 0.15, 0.03, -0.04], 0.018, 0.013, "#2a1f19", jump(1, 0, s), jump(1, 1, s))
    b.limb([s * 0.15, 0.03, -0.04], [s * 0.16, 0, 0.02], 0.012, 0.008, "#2a1f19", jump(2, 0, s), jump(2, 1, s))
    for (let p = 0; p < 2; p++) {
      const phase = (p === 0) === s < 0 ? 0 : Math.PI
      const hz = p === 0 ? 0.25 : 0.12
      b.limb([s * 0.06, 0.1, hz], [s * 0.15, 0.13, hz + (p === 0 ? 0.06 : 0)], 0.022, 0.018, "#231a15", leg(phase, 0, s), leg(phase, 0.5, s))
      b.limb([s * 0.15, 0.13, hz + (p === 0 ? 0.06 : 0)], [s * 0.21, 0, hz + (p === 0 ? 0.12 : -0.03)], 0.018, 0.012, "#231a15", leg(phase, 0.5, s), leg(phase, 1, s))
    }
  }

  // 2: harvestman — one oval body held high on eight very long, kneed legs
  b.sub = 2
  b.ellipsoid([0, 0.55, 0], [0.38, 0.27, 0.5], 4, 8, (x, y) => (y > 0.55 && Math.abs(x) < 0.45 ? "#4a3a2c" : "#8c7a60"), BODY, 0.7)
  b.ellipsoid([0, 0.8, 0.18], [0.07, 0.08, 0.07], 2, 5, "#3a2c22", BODY, 0)
  for (const s of [-1, 1]) {
    b.ellipsoid([s * 0.05, 0.85, 0.21], [0.03, 0.03, 0.03], 2, 4, "#0e0b0a", BODY, 0)
    b.limb([s * 0.07, 0.42, 0.45], [s * 0.1, 0.3, 0.62], 0.05, 0.03, "#6e5e48", BODY, BODY, 0.5)
  }
  const hips = [0.24, 0.08, -0.08, -0.24]
  const feet: [number, number][] = [[2.1, 1.7], [3.1, 0.9], [2.7, -0.9], [2.2, -1.8]]
  for (let p = 0; p < 4; p++) {
    for (const s of [-1, 1]) {
      // alternating tetrapod: L1 R2 L3 R4 together
      const phase = (p % 2 === 0) === s < 0 ? 0 : Math.PI
      const [fx, fz] = feet[p]
      const hip: V3 = [s * 0.3, 0.52, hips[p]]
      const knee: V3 = [s * fx * 0.42, 1.65 + (p === 1 ? 0.2 : 0), hips[p] + fz * 0.38]
      const foot: V3 = [s * fx, 0, fz]
      b.limb(hip, knee, 0.075, 0.06, "#6a5a46", leg(phase, 0, s), leg(phase, 0.4, s))
      b.limb(knee, foot, 0.06, 0.035, "#7a6a54", leg(phase, 0.4, s), leg(phase, 1, s))
    }
  }
  return b.build()
}

// --- crawlers (snail, earthworm, woodlouse, millipede) --------------------------

/** Brown-lipped snail (0), earthworm (1), pill woodlouse (2), snake millipede (3). */
export const createCrawlerGeometry = (): THREE.BufferGeometry => {
  const b = new Builder()

  // 0: snail — a logarithmic helicospiral shell over a gliding foot
  b.sub = 0
  const turns = 3.6
  const theta1 = turns * Math.PI * 2
  const growth = Math.log(2.1) / (Math.PI * 2)
  const R0 = 0.2
  const rings = 44
  const sides = 8
  // coil in a local frame (axis +y, apex up), then orient it from the
  // aperture: the mouth faces forward and a little down, where the body
  // leaves it, with the spire leaning back over the tail.
  const local: THREE.Vector3[] = []
  const tags: [number, number][] = []
  for (let i = 0; i <= rings; i++) {
    const t = i / rings
    const th = theta1 * (0.16 + 0.84 * t)
    const R = R0 * Math.exp(growth * (th - theta1))
    const rho = R * (i === rings ? 0.68 : 0.62)
    const yc = 0.95 * (R0 - R)
    for (let j = 0; j < sides; j++) {
      const phi = -Math.PI + (j / sides) * Math.PI * 2
      const er = R + rho * Math.cos(phi)
      local.push(new THREE.Vector3(Math.cos(th) * er, yc + rho * Math.sin(phi), Math.sin(th) * er))
      tags.push([phi / Math.PI, t])
    }
  }
  const mouth = new THREE.Vector3(Math.cos(theta1) * R0, 0, Math.sin(theta1) * R0)
  const tangent = new THREE.Vector3(growth * Math.cos(theta1) - Math.sin(theta1), -0.95 * growth, growth * Math.sin(theta1) + Math.cos(theta1)).normalize()
  const axis = new THREE.Vector3(0, 1, 0)
  const localSide = new THREE.Vector3().crossVectors(axis, tangent).normalize()
  const localUp = new THREE.Vector3().crossVectors(tangent, localSide)
  const wantForward = new THREE.Vector3(0.15, -0.3, 1).normalize()
  const wantUp = new THREE.Vector3(-0.1, 0.9, -0.45).normalize()
  const wantSide = new THREE.Vector3().crossVectors(wantUp, wantForward).normalize()
  wantUp.crossVectors(wantForward, wantSide)
  const from = new THREE.Matrix4().makeBasis(localSide, localUp, tangent)
  const to = new THREE.Matrix4().makeBasis(wantSide, wantUp, wantForward)
  const orient = to.multiply(from.transpose())
  const bounds = new THREE.Box3()
  for (const p of local) bounds.expandByPoint(p.applyMatrix4(orient))
  mouth.applyMatrix4(orient)
  const shift = new THREE.Vector3(0.01 - (bounds.min.x + bounds.max.x) / 2, 0.03 - bounds.min.y, -0.1 - (bounds.min.z + bounds.max.z) / 2)
  const shellBase = b.pos.length / 3
  for (let i = 0; i < local.length; i++) {
    const p = local[i].add(shift)
    b.v(p.x, p.y, p.z, "#dcc45c", [PART.shell, tags[i][0], tags[i][1], 0], 1)
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides
      const a = shellBase + i * sides + j
      const c = shellBase + i * sides + j1
      const d = shellBase + (i + 1) * sides + j
      const e = shellBase + (i + 1) * sides + j1
      b.tri(a, d, c)
      b.tri(c, d, e)
    }
  }
  // dark mouth inside the aperture
  {
    mouth.add(shift)
    const centre = b.v(mouth.x, mouth.y, mouth.z, "#2a1d14", [PART.shell, 0, 1, 0], 0)
    const last = shellBase + rings * sides
    for (let j = 0; j < sides; j++) b.tri(centre, last + ((j + 1) % sides), last + j)
  }
  // foot/body: flat sole, low back, a neck and a blunt head
  const bodyRings = [
    { z: -0.5, y: 0.012, w: 0.018, h: 0.012 },
    { z: -0.36, y: 0.025, w: 0.055, h: 0.025 },
    { z: -0.12, y: 0.04, w: 0.085, h: 0.04 },
    { z: 0.1, y: 0.045, w: 0.085, h: 0.045 },
    { z: 0.28, y: 0.05, w: 0.07, h: 0.05 },
    { z: 0.42, y: 0.045, w: 0.058, h: 0.045 },
    { z: 0.48, y: 0.03, w: 0.035, h: 0.028 },
  ]
  b.tube(bodyRings.map((r) => ({ ...r, y: Math.max(r.y, r.h) })), 8, (i, _j, a) => ({
    color: Math.sin(a) > 0.5 ? "#5e5040" : Math.sin(a) < -0.6 ? "#a39176" : "#7a6a55",
    rig: [PART.foot, bodyRings[i].z, 0, 0], tint: 0,
  }))
  for (const s of [-1, 1]) {
    b.limb([s * 0.03, 0.08, 0.43], [s * 0.08, 0.26, 0.56], 0.016, 0.01, "#6e5f4c", [PART.tentacle, 0, 0, s], [PART.tentacle, 0, 1, s])
    b.ellipsoid([s * 0.08, 0.265, 0.565], [0.017, 0.017, 0.017], 2, 4, "#14100d", [PART.tentacle, 0, 1, s], 0)
    b.limb([s * 0.025, 0.04, 0.46], [s * 0.05, 0.035, 0.53], 0.012, 0.008, "#6e5f4c", [PART.tentacle, 1, 0, s], [PART.tentacle, 1, 1, s])
  }

  // 1: earthworm — ringed tube, darker head end, paler saddle (clitellum)
  b.sub = 1
  const wormRings: { z: number; y: number; w: number; h: number }[] = []
  const N = 30
  for (let i = 0; i <= N; i++) {
    const s = i / N
    let r = 0.022
    if (s > 0.9) r *= 0.55 + ((1 - s) / 0.1) * 0.45
    if (s < 0.06) r *= 0.6 + (s / 0.06) * 0.4
    if (s > 0.64 && s < 0.74) r *= 1.2
    wormRings.push({ z: -0.5 + s, y: 0.024, w: r * (s < 0.12 ? 1.15 : 1), h: r * (s < 0.12 ? 0.8 : 1) })
  }
  b.tube(wormRings, 6, (i) => {
    const s = i / N
    const saddle = s > 0.64 && s < 0.74
    const color = saddle ? "#c27a66" : s > 0.74 ? (i % 2 ? "#7e3f3c" : "#86453f") : i % 2 ? "#a8706a" : "#9c645f"
    return { color, rig: [PART.segment, s, 0, 0], tint: saddle ? 0 : 0.35 }
  })

  // 2: pill woodlouse — domed oval of overlapping plates, short legs below
  b.sub = 2
  const plates = [0.5, 0.42, 0.33, 0.24, 0.15, 0.06, -0.03, -0.12, -0.21, -0.28, -0.34, -0.4, -0.45, -0.5]
  const halfWidth = (z: number): number => 0.3 * Math.sqrt(Math.max(0.05, 1 - Math.pow(Math.abs(z - 0.02) / 0.52, 2.4)))
  const lice: { z: number; y: number; w: number; h: number; groove: boolean }[] = []
  for (let i = 0; i < plates.length; i++) {
    const z = plates[i]
    const w = halfWidth(z)
    lice.push({ z: z + 0.012, y: 0.02, w, h: w * 0.78, groove: false })
    if (i > 0 && i < plates.length - 1) lice.push({ z: z - 0.01, y: 0.02, w: w * 0.96, h: w * 0.7, groove: true })
  }
  lice.reverse()
  const louseBase = b.pos.length / 3
  const arc = 8
  for (const ring of lice) {
    const s = ring.z + 0.5
    for (let j = 0; j <= arc; j++) {
      const a = (j / arc) * Math.PI
      b.v(Math.cos(a) * ring.w, ring.y + Math.sin(a) * ring.h, ring.z, ring.groove ? "#3c3f43" : j === 0 || j === arc ? "#7b8086" : "#5a5e63",
        [PART.segment, s, 0, 0], ring.groove ? 0.5 : 1)
    }
  }
  for (let i = 0; i < lice.length - 1; i++) {
    for (let j = 0; j < arc; j++) {
      const a = louseBase + i * (arc + 1) + j
      const c = louseBase + (i + 1) * (arc + 1) + j
      b.tri(a, c, a + 1)
      b.tri(a + 1, c, c + 1)
    }
  }
  // belly plate
  for (let i = 0; i < lice.length - 1; i++) {
    const a = louseBase + i * (arc + 1)
    const c = louseBase + (i + 1) * (arc + 1)
    b.tri(a, a + arc, c)
    b.tri(a + arc, c + arc, c)
  }
  for (const s of [-1, 1]) {
    b.chain([[s * 0.07, 0.07, 0.47], [s * 0.15, 0.09, 0.58], [s * 0.21, 0.05, 0.66]], [0.014, 0.012, 0.01], "#4a4d52",
      [ant(s, 0.1, s), ant(s, 0.5, s), ant(s, 1, s)])
    for (let p = 0; p < 7; p++) {
      const z = 0.3 - p * 0.085
      const phase = p * 0.9 + (s > 0 ? Math.PI : 0)
      b.limb([s * 0.17, 0.03, z], [s * 0.29, 0, z + 0.03], 0.016, 0.01, "#6c6a66", [PART.leg, phase, 0, s], [PART.leg, phase, 1, s])
    }
  }

  // 3: snake millipede — glossy black rings, rows of tiny white legs
  b.sub = 3
  const M = 34
  const milli: { z: number; y: number; w: number; h: number }[] = []
  for (let i = 0; i <= M; i++) {
    const s = i / M
    let r = 0.038
    if (s > 0.94) r *= 0.75 + ((1 - s) / 0.06) * 0.25
    if (s < 0.05) r *= 0.35 + (s / 0.05) * 0.65
    milli.push({ z: -0.5 + s, y: 0.045, w: r, h: r })
  }
  b.tube(milli, 6, (i, _j, a) => ({ color: Math.sin(a) > 0.3 ? (i % 2 ? "#1e1a1e" : "#141114") : "#0d0b0d", rig: [PART.segment, i / M, 0, 0], tint: 0.6 }))
  for (let i = 2; i < M - 1; i++) {
    const s = i / M
    for (const side of [-1, 1]) {
      for (let pair = 0; pair < 2; pair++) {
        const z = -0.5 + s + pair * 0.012 - 0.006
        const ia = b.v(side * 0.02, 0.022, z - 0.004, "#e8e2d4", [PART.leg, s, 0, side], 0)
        const ib = b.v(side * 0.02, 0.022, z + 0.004, "#e8e2d4", [PART.leg, s, 0, side], 0)
        const ic = b.v(side * 0.045, 0, z + 0.002, "#f2ede2", [PART.leg, s, 1, side], 0)
        b.tri(ia, ib, ic)
      }
    }
  }
  for (const s of [-1, 1]) {
    b.limb([s * 0.02, 0.06, 0.5], [s * 0.05, 0.075, 0.57], 0.01, 0.008, "#2a2428", [PART.antenna, s, 0.1, s], [PART.antenna, s, 1, s])
  }
  return b.build()
}

// --- nests ------------------------------------------------------------------

const hashColor = (i: number, palette: string[]): string => {
  const h = Math.abs(Math.sin(i * 127.1 + 31.7) * 43758.5453) % 1
  return palette[Math.floor(h * palette.length)]
}

/** Wood-ant needle mound (0), garden-ant nest crater (1), cricket burrow (2). */
export const createNestGeometry = (): THREE.BufferGeometry => {
  const b = new Builder()
  const disc = (radial: number, sectors: number, profile: (r: number, a: number) => number, color: (r: number, a: number, i: number) => string, cz = 0): void => {
    const base = b.pos.length / 3
    let i = 0
    for (let ri = 0; ri <= radial; ri++) {
      const r = (ri / radial) * 0.5
      for (let s = 0; s < sectors; s++) {
        const a = (s / sectors) * Math.PI * 2
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r + cz
        b.v(x, profile(r, a), z, color(r, a, i++), BODY, 0)
      }
    }
    for (let ri = 0; ri < radial; ri++) {
      for (let s = 0; s < sectors; s++) {
        const s1 = (s + 1) % sectors
        const a = base + ri * sectors + s
        const c = base + ri * sectors + s1
        const d = base + (ri + 1) * sectors + s
        const e = base + (ri + 1) * sectors + s1
        b.tri(a, d, c)
        b.tri(c, d, e)
      }
    }
  }
  // 0: thatched dome of needles and twigs with dark entrances round its flanks
  b.sub = 0
  const needles = ["#8a6a3e", "#6e5232", "#4a3423", "#7a4a2a", "#9a7a4a", "#5a4028"]
  const doors = [0.4, 1.6, 2.7, 3.9, 5.1]
  disc(9, 20, (r, a) => {
    if (r >= 0.499) return -0.04
    const t = 1 - (r / 0.5) * (r / 0.5)
    return 0.42 * Math.pow(t, 0.75) + Math.sin(a * 7 + r * 31) * 0.012
  }, (r, a, i) => {
    for (const d of doors) if (r > 0.3 && r < 0.44 && Math.abs(Math.atan2(Math.sin(a - d), Math.cos(a - d))) < 0.16) return "#1d140d"
    return hashColor(i, needles)
  })
  // 1: crumbly little crater of excavated soil with a dark central hole
  b.sub = 1
  const soil = ["#6b5136", "#4e3a26", "#7d6245", "#5c4630"]
  disc(6, 14, (r) => (r < 0.08 ? -0.03 : r >= 0.499 ? -0.02 : 0.16 * Math.pow(1 - (r / 0.5) * (r / 0.5), 0.75) - (r < 0.14 ? 0.06 : 0)),
    (r, _a, i) => (r < 0.1 ? "#140d08" : hashColor(i + 99, soil)))
  // 2: the field cricket's burrow: a cleared earthen porch round a dark hole
  b.sub = 2
  disc(5, 14, (r) => (r < 0.12 ? -0.06 : r >= 0.499 ? -0.02 : 0.025 * (1 - r / 0.5)), (r, _a, i) => (r < 0.14 ? "#0f0a07" : hashColor(i + 7, ["#7a5f42", "#6a523a", "#806648"])), 0)
  return b.build()
}
