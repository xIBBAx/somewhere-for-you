import * as THREE from "three"

/**
 * Detailed low-poly songbird (sparrow / robin family) built as ONE geometry so
 * the streamed flock keeps a single InstancedMesh and a single shader.
 *
 * Local space: +Z forward (beak), +Y up, +X right wing. The silhouette is a
 * swept body (tail base → breast → neck → rounded head), a two-part bill, two
 * bead eyes, a notched tail fan and two articulated wings whose inner panel
 * (humerus) and separated primary feathers carry the flap attributes.
 *
 * Attributes consumed by `createBirdMaterial`:
 *  - `aWingFactor`  0 on body/tail, ramps 0 → 0.5 across the inner wing panel
 *                   and is 1 on the outer primaries (the elbow fold boundary)
 *  - `aWingSpan`    distance from the shoulder pivot (metres)
 *  - `aWingElbow`   distance from the elbow pivot; 0 on the inner panel
 *  - `aBirdPart`    0 body/wings/tail, 1 breast & belly, 2 bill and eyes.
 *                   Home birds tint these three regions from uniforms without
 *                   rebuilding the geometry.
 */
export type BirdGeometryOptions = {
  /** Ground birds stand: add two legs with spread toes that contact the terrain. */
  feet?: boolean
}

const PART_BODY = 0
const PART_BREAST = 1
const PART_DARK = 2

/** Pivot the wing folds about, in the mirrored +X half-space. */
const SHOULDER_XY = { x: 0.055, y: 0.045 }
const ELBOW_XY = { x: 0.3, y: 0.055 }

type Vertex = {
  x: number
  y: number
  z: number
  r: number
  g: number
  b: number
  part: number
  /** 0 body · 0..0.5 inner wing panel · 1 outer primaries */
  wf: number
  /** distance from the shoulder pivot */
  ws: number
  /** distance from the elbow pivot */
  we: number
}

type Station = { z: number; cy: number; rx: number; ry: number }

class BirdMesh {
  private verts: Vertex[] = []
  private indices: number[] = []

  push(
    x: number,
    y: number,
    z: number,
    color: THREE.Color,
    part: number,
    wf = 0,
  ): number {
    const i = this.verts.length
    this.verts.push({
      x,
      y,
      z,
      r: color.r,
      g: color.g,
      b: color.b,
      part,
      wf,
      ws: Math.hypot(Math.abs(x) - SHOULDER_XY.x, y - SHOULDER_XY.y),
      we: Math.hypot(Math.abs(x) - ELBOW_XY.x, y - ELBOW_XY.y),
    })
    return i
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c)
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d)
  }

  /**
   * Sweeps a ring of `segments` points along the given stations. `shade` picks
   * the vertex colour per (station, angle) so the pale breast and the darker
   * mantle are baked into the same surface.
   */
  sweep(stations: Station[], segments: number, shade: (station: number, angle: number) => { color: THREE.Color; part: number }): void {
    const rings: number[][] = []
    for (let s = 0; s < stations.length; s++) {
      const st = stations[s]
      const ring: number[] = []
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2
        const { color, part } = shade(s, angle)
        ring.push(
          this.push(st.rx * Math.sin(angle), st.cy + st.ry * Math.cos(angle), st.z, color, part),
        )
      }
      rings.push(ring)
    }
    for (let s = 0; s < rings.length - 1; s++) {
      const a = rings[s]
      const b = rings[s + 1]
      for (let i = 0; i < segments; i++) {
        const j = (i + 1) % segments
        this.quad(a[i], b[i], b[j], a[j])
      }
    }
    // Caps close the silhouette at both ends so no interior is ever visible.
    const first = stations[0]
    const last = stations[stations.length - 1]
    const capFirst = this.push(0, first.cy, first.z, shade(0, 0).color, PART_BODY)
    for (let i = 0; i < segments; i++) this.tri(capFirst, rings[0][(i + 1) % segments], rings[0][i])
    const capLast = this.push(0, last.cy, last.z, shade(stations.length - 1, 0).color, PART_BODY)
    const top = rings[rings.length - 1]
    for (let i = 0; i < segments; i++) this.tri(capLast, top[i], top[(i + 1) % segments])
  }

  /** Low-poly bead used for the eyes: a smooth, faceted sphere. */
  bead(center: THREE.Vector3, radius: number, segments: number, bands: number, color: THREE.Color, part: number): void {
    const rings: number[][] = []
    for (let b = 0; b <= bands; b++) {
      const phi = (b / bands) * Math.PI
      const y = Math.cos(phi) * radius
      const r = Math.sin(phi) * radius
      const ring: number[] = []
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2
        ring.push(this.push(center.x + Math.cos(a) * r, center.y + y, center.z + Math.sin(a) * r, color, part))
      }
      rings.push(ring)
    }
    for (let b = 0; b < bands; b++) {
      for (let i = 0; i < segments; i++) {
        const j = (i + 1) % segments
        this.quad(rings[b][i], rings[b + 1][i], rings[b + 1][j], rings[b][j])
      }
    }
  }

  /** Tapered flat feather from `root` to `tip` with a rounded width profile. */
  feather(
    root: THREE.Vector3,
    tip: THREE.Vector3,
    rootWidth: number,
    tipWidth: number,
    color: THREE.Color,
    part: number,
    wf: number,
    belly: number,
  ): void {
    const axis = new THREE.Vector3().subVectors(tip, root)
    const len = axis.length()
    if (len < 1e-6) return
    axis.divideScalar(len)
    // side = axis × up, flattened so the feather is a thin airfoil
    const side = new THREE.Vector3(axis.z, 0, -axis.x)
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0)
    side.normalize().multiplyScalar(1)
    const up = new THREE.Vector3().crossVectors(side, axis).normalize()
    const half = (width: number) => width * 0.5
    // leading edge, mid (cambered), trailing edge per side
    const rows = [0, len * 0.45, len]
    const widths = [rootWidth, (rootWidth + tipWidth) * 0.6, tipWidth]
    const lRows: number[] = []
    const rRows: number[] = []
    for (let i = 0; i < rows.length; i++) {
      const centre = new THREE.Vector3().copy(root).addScaledVector(axis, rows[i])
      const camber = i === 1 ? belly * half(widths[i]) : 0
      centre.addScaledVector(up, camber)
      const l = new THREE.Vector3().copy(centre).addScaledVector(side, half(widths[i]))
      const r = new THREE.Vector3().copy(centre).addScaledVector(side, -half(widths[i]))
      lRows.push(this.push(l.x, l.y, l.z, color, part, wf))
      rRows.push(this.push(r.x, r.y, r.z, color, part, wf))
    }
    for (let i = 0; i < rows.length - 1; i++) this.quad(lRows[i], lRows[i + 1], rRows[i + 1], rRows[i])
  }

  /** Tapered bill: `root` at the face, `tip` forward, with a visible gape line. */
  bill(root: THREE.Vector3, tip: THREE.Vector3, rootWidth: number, thickness: number, upper: boolean): void {
    const segments = 6
    const ring: number[] = []
    const tipRing: number[] = []
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2
      const drop = upper ? 0 : thickness * 0.5
      const p = new THREE.Vector3(
        root.x + Math.cos(a) * rootWidth * 0.5,
        root.y + Math.sin(a) * (upper ? thickness * 0.5 : thickness * 0.32) - drop,
        root.z,
      )
      ring.push(this.push(p.x, p.y, p.z, BILL, PART_DARK))
      const t = new THREE.Vector3(root.x, root.y + (upper ? thickness * 0.1 : -thickness * 0.06), tip.z)
      tipRing.push(this.push(t.x, t.y, t.z, BILL, PART_DARK))
    }
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments
      this.quad(ring[i], ring[j], tipRing[j], tipRing[i])
    }
  }

  /** One leg with three forward-splayed toes, contacting y = 0. */
  foot(hip: THREE.Vector3, side: number, drop: number, color: THREE.Color): void {
    const ankle = new THREE.Vector3(hip.x, hip.y - drop * 0.55, hip.z + 0.004)
    const ground = new THREE.Vector3(hip.x + side * 0.004, hip.y - drop, hip.z + 0.012)
    this.limb(hip, ankle, 0.008, 0.006, color)
    this.limb(ankle, ground, 0.006, 0.005, color)
    for (const [tx, tz] of [
      [0.0, 0.03],
      [-0.012, 0.014],
      [0.012, 0.014],
    ] as const) {
      this.limb(
        ankle,
        new THREE.Vector3(ankle.x + tx, ankle.y - drop * 0.45, ankle.z + tz),
        0.005,
        0.003,
        color,
      )
    }
  }

  /** Square-section tapered strut (a leg or toe drawn as a thin box). */
  limb(from: THREE.Vector3, to: THREE.Vector3, fromWidth: number, toWidth: number, color: THREE.Color): void {
    const axis = new THREE.Vector3().subVectors(to, from)
    const len = axis.length()
    if (len < 1e-6) return
    axis.divideScalar(len)
    const side = new THREE.Vector3(axis.z, 0, -axis.x)
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0)
    side.normalize()
    const up = new THREE.Vector3().crossVectors(side, axis).normalize()
    const ringAt = (base: THREE.Vector3, width: number): number[] => {
      const out: number[] = []
      const corners = [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
      ]
      for (const [sx, sy] of corners) {
        const p = new THREE.Vector3()
          .copy(base)
          .addScaledVector(side, sx * width * 0.5)
          .addScaledVector(up, sy * width * 0.5)
        out.push(this.push(p.x, p.y, p.z, color, PART_DARK))
      }
      return out
    }
    const a = ringAt(from, fromWidth)
    const b = ringAt(to, toWidth)
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      this.quad(a[i], a[j], b[j], b[i])
    }
  }

  toGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    const count = this.verts.length
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const parts = new Float32Array(count)
    const wingFactors = new Float32Array(count)
    const wingSpans = new Float32Array(count)
    const wingElbows = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const v = this.verts[i]
      positions[i * 3] = v.x
      positions[i * 3 + 1] = v.y
      positions[i * 3 + 2] = v.z
      colors[i * 3] = v.r
      colors[i * 3 + 1] = v.g
      colors[i * 3 + 2] = v.b
      parts[i] = v.part
      wingFactors[i] = v.wf
      wingSpans[i] = v.ws
      wingElbows[i] = v.we
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute("aBirdPart", new THREE.BufferAttribute(parts, 1))
    geometry.setAttribute("aWingFactor", new THREE.BufferAttribute(wingFactors, 1))
    geometry.setAttribute("aWingSpan", new THREE.BufferAttribute(wingSpans, 1))
    geometry.setAttribute("aWingElbow", new THREE.BufferAttribute(wingElbows, 1))
    geometry.setIndex(this.indices)
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    return geometry
  }
}

const CREST = new THREE.Color("#5a4a3c")
const CROWN = new THREE.Color("#6b5747")
const MANTLE = new THREE.Color("#8a6a4d")
const MANTLE_DARK = new THREE.Color("#6f533b")
const BREAST = new THREE.Color("#e8dcc6")
const BELLY = new THREE.Color("#f2ead9")
const BILL = new THREE.Color("#3b3229")
const EYE = new THREE.Color("#14100c")
const WING = new THREE.Color("#7c5f45")
const PRIMARY = new THREE.Color("#4e3c2c")
const SECONDARY = new THREE.Color("#6d5238")
const TAIL = new THREE.Color("#5c4733")
const TAIL_EDGE = new THREE.Color("#8f7458")
const LEG = new THREE.Color("#c08a4e")

/**
 * Body → breast → neck → rounded head as one continuous surface. The pale
 * breast/belly band comes from the shading function, not from extra geometry.
 */
const BODY_STATIONS: Station[] = [
  { z: -0.3, cy: 0.004, rx: 0.028, ry: 0.026 },
  { z: -0.22, cy: 0.006, rx: 0.052, ry: 0.05 },
  { z: -0.12, cy: 0.006, rx: 0.068, ry: 0.066 },
  { z: -0.02, cy: 0.007, rx: 0.072, ry: 0.073 },
  { z: 0.07, cy: 0.012, rx: 0.07, ry: 0.075 },
  { z: 0.15, cy: 0.024, rx: 0.061, ry: 0.07 },
  { z: 0.215, cy: 0.045, rx: 0.05, ry: 0.056 },
  { z: 0.265, cy: 0.072, rx: 0.041, ry: 0.045 },
  { z: 0.31, cy: 0.083, rx: 0.033, ry: 0.036 },
  { z: 0.345, cy: 0.085, rx: 0.019, ry: 0.023 },
  { z: 0.362, cy: 0.084, rx: 0.007, ry: 0.01 },
]

const BODY_SEGMENTS = 14

const shadeBody = (station: number, angle: number): { color: THREE.Color; part: number } => {
  // angle 0 is the spine, PI the belly line
  const fromSpine = Math.abs(angle)
  const underside = THREE.MathUtils.smoothstep(fromSpine, 1.05, 1.85)
  const front = station >= 7
  if (front) {
    // crown and nape: warm brown, slightly darker at the very top
    const top = 1 - THREE.MathUtils.smoothstep(fromSpine, 0.0, 1.25)
    return { color: CREST.clone().lerp(CROWN, top), part: PART_BODY }
  }
  if (underside > 0.02) {
    // pale breast forward of the legs, warmer belly behind it
    const chest = THREE.MathUtils.smoothstep(station, 2.5, 5.2)
    return { color: BELLY.clone().lerp(BREAST, chest), part: PART_BREAST }
  }
  const shade = 1 - THREE.MathUtils.smoothstep(fromSpine, 0.4, 1.1)
  return { color: MANTLE.clone().lerp(MANTLE_DARK, shade * 0.7), part: PART_BODY }
}

const buildTail = (mesh: BirdMesh): void => {
  // A notched fan of seven rectrices: the notch is what makes a sparrow tail.
  const feathers: Array<[number, number, number, THREE.Color]> = [
    [-0.1, -0.455, 0.02, TAIL_EDGE],
    [-0.072, -0.442, 0.024, TAIL],
    [-0.042, -0.43, 0.022, TAIL],
    [0, -0.418, 0.02, TAIL],
    [0.042, -0.43, 0.022, TAIL],
    [0.072, -0.442, 0.024, TAIL],
    [0.1, -0.455, 0.02, TAIL_EDGE],
  ]
  for (const [x, z, width, color] of feathers) {
    const side = Math.sign(x) || 1
    mesh.feather(
      new THREE.Vector3(x * 0.28, 0.028 + Math.abs(x) * 0.04, -0.285),
      new THREE.Vector3(x, 0.03 + Math.abs(x) * 0.05, z),
      width,
      width * 0.62,
      color,
      PART_BODY,
      0,
      0.004 * side,
    )
  }
}

const buildWing = (mesh: BirdMesh, side: number): void => {
  const s = side
  // Inner panel (humerus): root chord → elbow chord, swept back and slightly
  // raised so the folded wing still reads as volume rather than a flat plate.
  const span = [
    { x: 0.05, front: 0.115, rear: -0.055, y: 0.042 },
    { x: 0.13, front: 0.105, rear: -0.075, y: 0.05 },
    { x: 0.215, front: 0.062, rear: -0.108, y: 0.056 },
    { x: 0.295, front: 0.012, rear: -0.135, y: 0.058 },
  ]
  const rows: number[][] = []
  for (let i = 0; i < span.length; i++) {
    const st = span[i]
    // Ramp 0.12 at the shoulder → 0.5 at the elbow. The root must NOT be 0:
    // a 0 vertex is excluded from the shader's flap branch, which would weld
    // the wing root to the body while the rest of the wing swings.
    const wf = 0.12 + (i / (span.length - 1)) * 0.38
    rows.push([
      mesh.push(s * st.x, st.y + 0.012, st.front, WING, PART_BODY, wf),
      mesh.push(s * st.x, st.y, st.rear, SECONDARY, PART_BODY, wf),
    ])
  }
  for (let i = 0; i < span.length - 1; i++) {
    mesh.quad(rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1])
  }
  // Shoulder covert: a rounded cap so the wing root is not a hard seam. It must
  // carry the same shoulder weight as the root row or it tears away from the
  // body when the wing flaps.
  mesh.quad(rows[0][0], rows[0][1], mesh.push(s * 0.052, 0.03, 0.03, WING, PART_BODY, 0.12), mesh.push(s * 0.052, 0.062, 0.075, WING, PART_BODY, 0.12))
  mesh.quad(rows[0][0], mesh.push(s * 0.052, 0.062, 0.075, WING, PART_BODY, 0.12), mesh.push(s * 0.052, 0.03, 0.03, WING, PART_BODY, 0.12), rows[0][1])

  // Secondaries along the inner trailing edge (shoulder fold only): these stay
  // on the inner panel, so their weight runs from the root to just short of the
  // elbow hinge.
  for (let i = 0; i < 4; i++) {
    const t = i / 3
    const rootX = 0.14 + t * 0.13
    mesh.feather(
      new THREE.Vector3(s * rootX, 0.05 - t * 0.002, -0.055 - t * 0.02),
      new THREE.Vector3(s * (rootX + 0.055), 0.052, -0.115 - t * 0.028),
      0.03,
      0.016,
      SECONDARY,
      PART_BODY,
      0.14 + t * 0.26,
      0.003,
    )
  }
  // Five primaries: separated tips with their own length and sweep, which is
  // what reads as "feathers" instead of a single triangle.
  const primaries: Array<[number, number, number, number]> = [
    [0.53, -0.045, 0.036, 0.0],
    [0.585, -0.075, 0.033, 0.002],
    [0.615, -0.108, 0.03, 0.004],
    [0.6, -0.142, 0.027, 0.006],
    [0.555, -0.168, 0.024, 0.008],
  ]
  for (let i = 0; i < primaries.length; i++) {
    const [tipX, tipZ, width, lift] = primaries[i]
    mesh.feather(
      new THREE.Vector3(s * (0.285 + i * 0.008), 0.058 + lift * 0.4, -0.03 - i * 0.026),
      new THREE.Vector3(s * tipX, 0.056 + lift, tipZ),
      width,
      width * 0.42,
      i % 2 === 0 ? PRIMARY : WING,
      PART_BODY,
      1,
      0.005 * (i + 1),
    )
  }
  // Alula thumb at the wrist.
  mesh.feather(
    new THREE.Vector3(s * 0.29, 0.062, -0.02),
    new THREE.Vector3(s * 0.235, 0.07, -0.115),
    0.022,
    0.012,
    PRIMARY,
    PART_BODY,
    0.5,
    0.004,
  )
}

const buildHead = (mesh: BirdMesh): void => {
  // Two-part bill: the mandibles part slightly so the beak is not a spike.
  const base = new THREE.Vector3(0, 0.082, 0.352)
  mesh.bill(new THREE.Vector3(0, 0.086, 0.344), new THREE.Vector3(0, 0.079, 0.418), 0.026, 0.02, true)
  mesh.bill(new THREE.Vector3(0, 0.076, 0.344), new THREE.Vector3(0, 0.073, 0.404), 0.023, 0.012, false)
  void base
  // Eyes sit proud of the head sphere so they always catch the light.
  for (const side of [-1, 1]) {
    mesh.bead(new THREE.Vector3(side * 0.026, 0.096, 0.298), 0.0135, 6, 3, EYE, PART_DARK)
  }
}

export const createBirdGeometry = (options: BirdGeometryOptions = {}): THREE.BufferGeometry => {
  const mesh = new BirdMesh()
  mesh.sweep(BODY_STATIONS, BODY_SEGMENTS, shadeBody)
  buildHead(mesh)
  buildTail(mesh)
  buildWing(mesh, -1)
  buildWing(mesh, 1)
  if (options.feet) {
    for (const side of [-1, 1]) mesh.foot(new THREE.Vector3(side * 0.038, -0.05, 0.01), side, 0.05, LEG)
  }
  return mesh.toGeometry()
}

/**
 * Splits the bird into body / inner-wing / outer-wing pieces so a CPU-driven
 * bird can pivot real shoulder and elbow groups.
 *
 * The streamed flock never calls this: it keeps ONE geometry and deforms it in
 * the shader. The bounded home birds use the pieces so their wings articulate
 * on the CPU with the same two-hinge ramp the shader applies.
 *
 * The shoulder piece is expressed relative to the shoulder pivot and the outer
 * piece relative to the elbow, so each can be attached directly to its group.
 */
export type BirdParts = {
  body: THREE.BufferGeometry
  /** per side: inner panel (humerus), pivot-relative to the shoulder */
  wingInner: THREE.BufferGeometry
  /** per side: primaries, pivot-relative to the elbow */
  wingOuter: THREE.BufferGeometry
}

const sliceByWeight = (source: THREE.BufferGeometry, keep: (wf: number) => boolean, rebase: (x: number, y: number) => [number, number], rightOnly = false): THREE.BufferGeometry => {
  const index = source.getIndex()!
  const positions = source.getAttribute("position")
  const wingFactor = source.getAttribute("aWingFactor")
  const birdPart = source.getAttribute("aBirdPart")
  const color = source.getAttribute("color")

  // remap kept vertices to a dense new index space
  const remap = new Map<number, number>()
  const verts: number[][] = []
  const indices: number[] = []
  for (let t = 0; t < index.count; t += 3) {
    const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
    if (!tri.every((v) => keep(wingFactor.getX(v)))) continue
    if (rightOnly && !tri.every(v => positions.getX(v) > 0)) continue
    for (const v of tri) {
      if (remap.has(v)) continue
      const [px, py] = rebase(positions.getX(v), positions.getY(v))
      remap.set(v, verts.length)
      verts.push([
        px,
        py,
        positions.getZ(v),
        color.getX(v),
        color.getY(v),
        color.getZ(v),
        birdPart.getX(v),
        wingFactor.getX(v),
      ])
    }
    indices.push(remap.get(tri[0])!, remap.get(tri[1])!, remap.get(tri[2])!)
  }

  const geometry = new THREE.BufferGeometry()
  const count = verts.length
  const p = new Float32Array(count * 3)
  const c = new Float32Array(count * 3)
  const parts = new Float32Array(count)
  const wf = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    p[i * 3] = verts[i][0]
    p[i * 3 + 1] = verts[i][1]
    p[i * 3 + 2] = verts[i][2]
    c[i * 3] = verts[i][3]
    c[i * 3 + 1] = verts[i][4]
    c[i * 3 + 2] = verts[i][5]
    parts[i] = verts[i][6]
    wf[i] = verts[i][7]
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(p, 3))
  geometry.setAttribute("color", new THREE.BufferAttribute(c, 3))
  geometry.setAttribute("aBirdPart", new THREE.BufferAttribute(parts, 1))
  geometry.setAttribute("aWingFactor", new THREE.BufferAttribute(wf, 1))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/** Shoulder/elbow pivots, matching the ones the shader rotates about. */
export const BIRD_SHOULDER = { x: 0.055, y: 0.045 }
export const BIRD_ELBOW = { x: 0.3, y: 0.055 }

const identity = (x: number, y: number): [number, number] => [x, y]

const rebaseShoulder = (x: number, y: number): [number, number] => [
  x - Math.sign(x) * BIRD_SHOULDER.x,
  y - BIRD_SHOULDER.y,
]

const rebaseElbow = (x: number, y: number): [number, number] => [
  x - Math.sign(x) * BIRD_ELBOW.x,
  y - BIRD_ELBOW.y,
]

export const createBirdParts = (options: BirdGeometryOptions = {}): BirdParts => {
  const whole = createBirdGeometry(options)
  // The inner panel keeps everything from the shoulder up to the hinge, the
  // outer piece takes the primaries past it; a triangle is assigned whole, so
  // the two pieces meet exactly at the hinge and never split a face.
  const inner = sliceByWeight(whole, (wf) => wf > 0 && wf <= 0.5, rebaseShoulder, true)
  const outer = sliceByWeight(whole, (wf) => wf > 0.5, rebaseElbow, true)
  const body = sliceByWeight(whole, (wf) => wf === 0, identity)
  whole.dispose()
  return { body, wingInner: inner, wingOuter: outer }
}

/** Region tints applied to `aBirdPart` by the home (non-instanced) material. */
export const BIRD_PART_BODY = PART_BODY
export const BIRD_PART_BREAST = PART_BREAST
export const BIRD_PART_DARK = PART_DARK
