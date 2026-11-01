import * as THREE from "three"

/**
 * Life-size models of the hardware at the lunar sites (lunarSites.ts),
 * built from measured dimensions:
 *
 *   Apollo LM descent stage  octagonal body 4.22 m across, 3.23 m tall to the
 *                            deck, landing gear 9.4 m across the diagonal,
 *                            amber Kapton and black foil over aluminium
 *   flag assembly            nylon 0.91 × 1.52 m on a gold-anodised pole with
 *                            a crossbar along the top hem (no air to hold a
 *                            flag out), about 2.1 m tall
 *   LRRR                     a panel of 100 fused-silica corner cubes aimed at Earth
 *   PSEP / ALSEP             the seismometer and the experiment stations
 *   LRV                      the Lunar Roving Vehicle, 3.1 m long, wire-mesh wheels
 *   Vikram                   about 2 × 2 m and 1.17 m tall on four legs
 *   Pragyan                  0.92 × 0.75 m, six wheels, a solar panel and two cameras
 *
 * Sources: NASA (Apollo LM and LRV fact sheets, Platoff's flag history via
 * the Apollo Lunar Surface Journal), ISRO (Chandrayaan-3), eoPortal.
 * Each builder returns a group standing on y = 0 with +z north, +x east.
 */

// ---- textures -----------------------------------------------------------------

const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  return [c, c.getContext("2d")!]
}

const texture = (c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture => {
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** Mix a colour toward white: the flags' nylon has had half a century of unfiltered sunlight. */
const bleach = (hex: string, k: number): string => {
  const c = new THREE.Color(hex)
  c.lerp(new THREE.Color("#f2efe6"), k)
  return `#${c.getHexString()}`
}

/** The United States flag of 1969–72 (50 stars), faded by `fade` 0…1. */
const usFlagTexture = (fade: number): THREE.CanvasTexture => {
  const [c, g] = canvas(760, 400)
  const red = bleach("#b22234", fade), white = bleach("#ffffff", 0), blue = bleach("#3c3b6e", fade * 0.8)
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? white : red
    g.fillRect(0, (i * 400) / 13, 760, 400 / 13 + 1)
  }
  const cw = 760 * 0.4, ch = (400 * 7) / 13
  g.fillStyle = blue
  g.fillRect(0, 0, cw, ch)
  g.fillStyle = white
  for (let r = 0; r < 9; r++) {
    const n = r % 2 ? 5 : 6
    for (let k = 0; k < n; k++) {
      const x = (cw / 12) * (r % 2 ? 2 + k * 2 : 1 + k * 2)
      const y = (ch / 10) * (r + 1)
      star(g, x, y, 9.5)
    }
  }
  return texture(c)
}

const star = (g: CanvasRenderingContext2D, x: number, y: number, r: number): void => {
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.38 : r
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
  }
  g.closePath()
  g.fill()
}


/** Crinkled multilayer foil: a bump map of soft, irregular creases. */
let foilBump: THREE.CanvasTexture | null = null
const foilTexture = (): THREE.CanvasTexture => {
  if (foilBump) return foilBump
  const [c, g] = canvas(256, 256)
  g.fillStyle = "#808080"
  g.fillRect(0, 0, 256, 256)
  let seed = 7
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 420; i++) {
    const x = rnd() * 256, y = rnd() * 256, a = rnd() * Math.PI, l = 8 + rnd() * 40
    const v = Math.floor(90 + rnd() * 90)
    g.strokeStyle = `rgba(${v},${v},${v},0.55)`
    g.lineWidth = 0.6 + rnd() * 2.2
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l)
    g.stroke()
  }
  foilBump = texture(c, false)
  foilBump.wrapS = foilBump.wrapT = THREE.RepeatWrapping
  foilBump.repeat.set(2, 2)
  return foilBump
}

/** The LRRR's face: ten rows of ten corner-cube cups. */
const retroTexture = (): THREE.CanvasTexture => {
  const [c, g] = canvas(256, 256)
  g.fillStyle = "#b9b4a6"
  g.fillRect(0, 0, 256, 256)
  for (let r = 0; r < 10; r++) for (let k = 0; k < 10; k++) {
    const x = 14 + k * 25.3, y = 14 + r * 25.3
    const grad = g.createRadialGradient(x - 3, y - 3, 1, x, y, 11)
    grad.addColorStop(0, "#d8e6f2")
    grad.addColorStop(0.5, "#23303f")
    grad.addColorStop(1, "#0a0d12")
    g.fillStyle = grad
    g.beginPath()
    g.arc(x, y, 10.5, 0, Math.PI * 2)
    g.fill()
  }
  return texture(c)
}

/** Solar cells: dark blue squares in a silver grid. */
const solarTexture = (cols = 12, rows = 8): THREE.CanvasTexture => {
  const [c, g] = canvas(256, 192)
  g.fillStyle = "#c8ccd2"
  g.fillRect(0, 0, 256, 192)
  const w = 256 / cols, h = 192 / rows
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    g.fillStyle = (r + k) % 3 ? "#1c2a4a" : "#1a2644"
    g.fillRect(k * w + 1.2, r * h + 1.2, w - 2.4, h - 2.4)
  }
  return texture(c)
}

/** The plaque on Eagle's ladder strut. */
const plaqueTexture = (): THREE.CanvasTexture => {
  const [c, g] = canvas(512, 420)
  g.fillStyle = "#cfcfca"
  g.fillRect(0, 0, 512, 420)
  g.strokeStyle = "#555"
  g.lineWidth = 4
  g.strokeRect(6, 6, 500, 408)
  g.fillStyle = "#2a2a2a"
  g.textAlign = "center"
  // the two hemispheres of Earth
  for (const x of [176, 336]) {
    g.beginPath()
    g.arc(x, 100, 62, 0, Math.PI * 2)
    g.lineWidth = 3
    g.stroke()
  }
  g.font = "600 21px Georgia, serif"
  g.fillText("HERE MEN FROM THE PLANET EARTH", 256, 212)
  g.fillText("FIRST SET FOOT UPON THE MOON", 256, 240)
  g.fillText("JULY 1969, A.D.", 256, 268)
  g.fillText("WE CAME IN PEACE FOR ALL MANKIND", 256, 300)
  g.font = "italic 15px Georgia, serif"
  g.fillText("Neil A. Armstrong · Michael Collins · Edwin E. Aldrin, Jr.", 256, 350)
  g.fillText("Richard Nixon, President, United States of America", 256, 378)
  return texture(c)
}

// ---- materials --------------------------------------------------------------------

const mats = {
  kapton: (): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color: "#c79a3c", metalness: 0.85, roughness: 0.32, bumpMap: foilTexture(), bumpScale: 1.4 }),
  blackFoil: (): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color: "#1b1a18", metalness: 0.6, roughness: 0.45, bumpMap: foilTexture(), bumpScale: 1 }),
  silverFoil: (): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color: "#b8b6b0", metalness: 0.9, roughness: 0.3, bumpMap: foilTexture(), bumpScale: 1.2 }),
  aluminium: (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: "#a9a8a2", metalness: 0.8, roughness: 0.42 }),
  goldPole: (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: "#c9a85a", metalness: 0.9, roughness: 0.35 }),
  grey: (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: "#6d6b66", metalness: 0.2, roughness: 0.7 }),
  white: (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: "#d9d7d0", metalness: 0.1, roughness: 0.6 }),
  dark: (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: "#1d1d1f", metalness: 0.3, roughness: 0.55 }),
}

const shadowed = <T extends THREE.Object3D>(o: T): T => {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true
      c.receiveShadow = true
    }
  })
  return o
}

const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
  mesh.position.set(x, y, z)
  return mesh
}

/** A strut (cylinder) from a to b. */
const strut = (a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material): THREE.Mesh => {
  const d = b.clone().sub(a)
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), m)
  mesh.position.copy(a).addScaledVector(d, 0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
  return mesh
}

// ---- Apollo ---------------------------------------------------------------------------

/**
 * The Lunar Module's descent stage, left behind as the launch pad for the
 * ascent stage. `ladderBearing` turns the forward (+x, ladder) leg.
 */
export const buildDescentStage = (plaque: boolean): THREE.Group => {
  const g = new THREE.Group()
  g.name = "lm-descent-stage"
  const kapton = mats.kapton(), black = mats.blackFoil(), silver = mats.silverFoil(), alu = mats.aluminium()
  // octagonal body: 4.22 m across the flats, from 1.3 m to 2.95 m above the dust
  const across = 4.22, r = across / 2 / Math.cos(Math.PI / 8)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.65, 8, 1), kapton)
  body.rotation.y = Math.PI / 8
  body.position.y = 2.125
  g.add(body)
  // the deck: black and silver where the ascent stage sat, scorched by its engine
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 0.98, 0.08, 8, 1), black)
  deck.rotation.y = Math.PI / 8
  deck.position.y = 2.99
  g.add(deck)
  // quadrant boxes in silver foil (the MESA and the storage bays)
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4
    const b = box(1.05, 1.2, 0.08, i === 0 ? silver : black, Math.cos(a) * across * 0.47, 2.1, Math.sin(a) * across * 0.47)
    b.rotation.y = -a + Math.PI / 2
    g.add(b)
  }
  // the descent engine's bell under the body
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.78, 0.95, 20, 1, true), new THREE.MeshStandardMaterial({ color: "#2d2a26", metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide }))
  bell.position.y = 0.95
  g.add(bell)
  // four legs on the diagonals of a 9.4 m span, each with a dish footpad
  const span = 9.4 / 2
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    const side = new THREE.Vector3(-dir.z, 0, dir.x)
    const pad = dir.clone().multiplyScalar(span).setY(0.12)
    const top = dir.clone().multiplyScalar(across * 0.5).setY(2.75)
    g.add(strut(top, pad.clone().setY(0.35), 0.075, kapton))
    // the two secondary struts back to the bottom of the body
    for (const s of [-1, 1]) {
      const root = dir.clone().multiplyScalar(across * 0.42).addScaledVector(side, s * 0.95).setY(1.35)
      g.add(strut(root, dir.clone().multiplyScalar(span * 0.72).setY(0.72), 0.045, alu))
    }
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.36, 0.2, 18), alu)
    foot.position.copy(pad)
    g.add(foot)
    // the surface-sensing probe, bent back under the pad (not on the ladder leg)
    if (i !== 0) {
      const p = strut(pad.clone().setY(0.06), pad.clone().addScaledVector(dir, -0.9).setY(0.03), 0.012, alu)
      g.add(p)
    }
  }
  // the ladder on the forward (+x) leg, and the plaque on its strut
  const legTop = new THREE.Vector3(across * 0.5, 2.75, 0), legFoot = new THREE.Vector3(span, 0.35, 0)
  for (let k = 0; k < 9; k++) {
    const t = 0.12 + k * 0.095
    const p = legTop.clone().lerp(legFoot, t)
    g.add(box(0.06, 0.03, 0.62, alu, p.x + 0.06, p.y, 0))
  }
  for (const s of [-1, 1]) g.add(strut(legTop.clone().setZ(s * 0.31).setX(legTop.x + 0.06), legFoot.clone().setZ(s * 0.31).setX(legFoot.x + 0.06).setY(1.1), 0.02, alu))
  // the porch at the top of the ladder
  g.add(box(0.85, 0.05, 0.9, alu, across * 0.55, 2.98, 0))
  if (plaque) {
    const p = legTop.clone().lerp(legFoot, 0.3)
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.19), new THREE.MeshStandardMaterial({ map: plaqueTexture(), metalness: 0.6, roughness: 0.4 }))
    plate.position.set(p.x + 0.13, p.y - 0.25, 0)
    plate.rotation.y = Math.PI / 2
    plate.rotation.z = Math.atan2(legFoot.y - legTop.y, legFoot.x - legTop.x) + Math.PI / 2
    g.add(plate)
  }
  return shadowed(g)
}

/**
 * The Lunar Flag Assembly: the nylon flag hung from a crossbar so it shows
 * without wind, its stripes probably bleached by decades of unfiltered
 * sunlight (an informed guess: nobody has seen them up close since). A
 * fallen flag lies on the dust where the ascent engine's blast threw it.
 */
export const buildFlag = (standing: boolean, lean = 0, big = false): THREE.Group => {
  const g = new THREE.Group()
  g.name = standing ? "flag" : "flag-fallen"
  const pole = mats.goldPole()
  const h = 2.1, w = big ? 1.82 : 1.52, fh = big ? 1.1 : 0.91
  const inner = new THREE.Group()
  inner.add(strut(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, h, 0), 0.0127, pole))
  inner.add(strut(new THREE.Vector3(0, h - 0.02, 0), new THREE.Vector3(w, h - 0.02, 0), 0.008, pole))
  // the cloth: the hem rides the crossbar; the rest hangs in the creases it was packed in
  const geo = new THREE.PlaneGeometry(w, fh, 24, 12)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i)
    const fromTop = (fh / 2 - y) / fh
    pos.setZ(i, Math.sin((x / w) * Math.PI * 3.3) * 0.045 * (0.3 + fromTop) + Math.sin(x * 9.1 + y * 3) * 0.008)
  }
  geo.computeVertexNormals()
  const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: usFlagTexture(0.55), roughness: 0.85, side: THREE.DoubleSide }))
  cloth.position.set(w / 2, h - 0.02 - fh / 2, 0)
  inner.add(cloth)
  if (standing) {
    inner.rotation.z = lean
    g.add(inner)
  } else {
    // knocked flat: lying along the dust, the cloth folded under the crossbar
    inner.rotation.z = -Math.PI / 2 + 0.06
    inner.position.y = 0.05
    g.add(inner)
  }
  return shadowed(g)
}

/** The Laser Ranging Retro-Reflector: 100 corner cubes on a tilted panel, aimed at Earth. */
export const buildRetroreflector = (): THREE.Group => {
  const g = new THREE.Group()
  g.name = "lrrr"
  const alu = mats.aluminium()
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.46), [alu, alu, new THREE.MeshStandardMaterial({ map: retroTexture(), metalness: 0.5, roughness: 0.2 }), alu, alu, alu])
  panel.position.y = 0.38
  panel.rotation.x = -0.35
  g.add(panel)
  for (const [x, z] of [[-0.18, -0.15], [0.18, -0.15], [0, 0.2]]) g.add(strut(new THREE.Vector3(x, 0, z), new THREE.Vector3(x * 0.6, 0.36, z * 0.6), 0.012, alu))
  return shadowed(g)
}

/** The Passive Seismic Experiment of Apollo 11: a drum between two gold solar wings. */
export const buildSeismometer = (): THREE.Group => {
  const g = new THREE.Group()
  g.name = "psep"
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.45, 12), mats.silverFoil())
  drum.position.y = 0.32
  g.add(drum)
  const solar = new THREE.MeshStandardMaterial({ map: solarTexture(8, 6), metalness: 0.4, roughness: 0.35 })
  for (const s of [-1, 1]) {
    const wing = box(0.65, 0.02, 0.55, solar, s * 0.62, 0.48, 0)
    wing.rotation.z = s * 0.08
    g.add(wing)
  }
  g.add(box(0.12, 0.2, 0.12, mats.white(), 0, 0.64, 0))
  return shadowed(g)
}

/** An ALSEP central station with its sunshade, and the finned power generator beside it. */
export const buildAlsep = (): THREE.Group => {
  const g = new THREE.Group()
  g.name = "alsep"
  g.add(box(0.7, 0.3, 0.4, mats.white(), 0, 0.2, 0))
  const shade = box(0.75, 0.02, 0.45, mats.silverFoil(), 0, 0.62, 0)
  g.add(shade)
  for (const [x, z] of [[-0.34, -0.2], [0.34, -0.2], [-0.34, 0.2], [0.34, 0.2]]) g.add(strut(new THREE.Vector3(x, 0.35, z), new THREE.Vector3(x, 0.61, z), 0.008, mats.aluminium()))
  // the antenna, a short helix on a mast
  g.add(strut(new THREE.Vector3(0.2, 0.62, 0), new THREE.Vector3(0.2, 1.05, 0), 0.01, mats.aluminium()))
  // the RTG, 3 m off: a dark finned drum
  const rtg = new THREE.Group()
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.46, 16), mats.dark())
  core.position.y = 0.45
  rtg.add(core)
  for (let i = 0; i < 8; i++) {
    const fin = box(0.32, 0.44, 0.012, mats.dark(), 0, 0.45, 0)
    fin.rotation.y = (i * Math.PI) / 8
    rtg.add(fin)
  }
  rtg.add(strut(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.22, 0), 0.04, mats.aluminium()))
  rtg.position.set(3, 0, 0.6)
  g.add(rtg)
  return shadowed(g)
}

/** The Lunar Roving Vehicle, parked: chassis, wire-mesh wheels, two seats, the dish antenna. */
export const buildRover = (): THREE.Group => {
  const g = new THREE.Group()
  g.name = "lrv"
  const alu = mats.aluminium()
  g.add(box(1.14, 0.06, 2.6, alu, 0, 0.55, 0))
  const mesh = new THREE.MeshStandardMaterial({ color: "#8d8a82", metalness: 0.7, roughness: 0.5, wireframe: false })
  for (const [x, z] of [[-0.92, 1.1], [0.92, 1.1], [-0.92, -1.1], [0.92, -1.1]]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.07, 8, 22), mesh)
    wheel.position.set(x, 0.41, z)
    wheel.rotation.y = Math.PI / 2
    g.add(wheel)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 12), alu)
    hub.rotation.z = Math.PI / 2
    hub.position.set(x, 0.41, z)
    g.add(hub)
    // fenders over the wheels
    const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.28, 14, 1, true, 0, Math.PI), new THREE.MeshStandardMaterial({ color: "#7e7a70", roughness: 0.6, side: THREE.DoubleSide }))
    fender.rotation.z = Math.PI / 2
    fender.position.set(x, 0.41, z)
    g.add(fender)
  }
  // two seats of webbing
  for (const x of [-0.32, 0.32]) {
    g.add(box(0.45, 0.05, 0.45, mats.grey(), x, 0.66, 0.15))
    g.add(box(0.45, 0.42, 0.05, mats.grey(), x, 0.88, -0.07))
  }
  // console, and the high-gain dish on its mast
  g.add(box(0.36, 0.3, 0.12, mats.dark(), 0, 0.85, 0.62))
  g.add(strut(new THREE.Vector3(-0.3, 0.6, 1.2), new THREE.Vector3(-0.3, 1.6, 1.2), 0.012, alu))
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 6, 0, Math.PI * 2, 0, 0.55), new THREE.MeshStandardMaterial({ color: "#d4d2c9", metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide }))
  dish.position.set(-0.3, 1.38, 1.2)
  dish.rotation.x = -1.1
  g.add(dish)
  // the TV camera on the front
  g.add(box(0.14, 0.12, 0.3, mats.white(), 0.32, 1.0, 1.25))
  return shadowed(g)
}

// ---- Chandrayaan-3 --------------------------------------------------------------------

/** Vikram: a box of gold foil on four legs, a solar panel on one face, the rover's ramp on another. */
export const buildVikram = (): THREE.Group => {
  const g = new THREE.Group()
  g.name = "vikram"
  const kapton = mats.kapton(), alu = mats.aluminium(), silver = mats.silverFoil()
  // body ~2.0 × 2.0 m footprint over the legs; the box itself a little smaller
  g.add(box(1.6, 0.85, 1.6, kapton, 0, 0.95, 0))
  g.add(box(1.5, 0.05, 1.5, silver, 0, 1.4, 0))
  // the solar panel on the east face
  const solar = new THREE.MeshStandardMaterial({ map: solarTexture(10, 8), metalness: 0.4, roughness: 0.3 })
  const panel = box(0.04, 0.78, 1.3, solar, 0.83, 0.98, 0)
  g.add(panel)
  // four legs to the corners of a 2 m square, with round pads
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const pad = new THREE.Vector3(x * 1.0, 0.06, z * 1.0)
    g.add(strut(new THREE.Vector3(x * 0.72, 0.62, z * 0.72), pad.clone().setY(0.12), 0.05, alu))
    g.add(strut(new THREE.Vector3(x * 0.78, 1.15, z * 0.3), pad.clone().setY(0.12), 0.025, alu))
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.08, 14), alu)
    foot.position.copy(pad)
    g.add(foot)
  }
  // the instruments on top: ChaSTE's probe arm and the antennas
  g.add(strut(new THREE.Vector3(-0.5, 1.42, 0.5), new THREE.Vector3(-0.5, 1.72, 0.5), 0.03, mats.white()))
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.white())
  dome.position.set(0.4, 1.42, -0.4)
  g.add(dome)
  // the ramp down the south face, two panels to the dust
  const ramp = box(0.55, 0.03, 1.55, silver, 0, 0.52, -1.48)
  ramp.rotation.x = -0.58
  g.add(ramp)
  return shadowed(g)
}

/** Pragyan: a six-wheeled box with a tilted solar panel and a mast of two cameras. */
export const buildPragyan = (): THREE.Group => {
  const g = new THREE.Group()
  g.name = "pragyan"
  const alu = mats.aluminium()
  g.add(box(0.62, 0.22, 0.75, mats.kapton(), 0, 0.33, 0))
  const solar = new THREE.MeshStandardMaterial({ map: solarTexture(8, 10), metalness: 0.4, roughness: 0.3 })
  const panel = box(0.7, 0.02, 0.62, solar, 0, 0.6, -0.06)
  panel.rotation.x = 0.55
  g.add(panel)
  for (const z of [-0.28, 0, 0.28]) for (const s of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 14), alu)
    wheel.rotation.z = Math.PI / 2
    wheel.position.set(s * 0.4, 0.1, z)
    g.add(wheel)
  }
  // rocker arms
  for (const s of [-1, 1]) g.add(strut(new THREE.Vector3(s * 0.4, 0.1, -0.28), new THREE.Vector3(s * 0.4, 0.28, 0.1), 0.015, alu))
  g.add(strut(new THREE.Vector3(0, 0.44, 0.3), new THREE.Vector3(0, 0.72, 0.3), 0.015, alu))
  for (const s of [-1, 1]) g.add(box(0.06, 0.05, 0.06, mats.dark(), s * 0.06, 0.74, 0.32))
  return shadowed(g)
}

// ---- the tribute ------------------------------------------------------------------------


/** A few scattered, scorched fragments where a craft struck the ground. */
export const buildDebris = (seed: number): THREE.Group => {
  const g = new THREE.Group()
  g.name = "debris"
  let s = seed
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647)
  const m = [mats.kapton(), mats.dark(), mats.silverFoil()]
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, d = 3 + rnd() * 22
    const piece = box(0.15 + rnd() * 0.5, 0.03 + rnd() * 0.08, 0.1 + rnd() * 0.4, m[i % 3], Math.cos(a) * d, 0.03, Math.sin(a) * d)
    piece.rotation.set(rnd() * 0.4, rnd() * 3, rnd() * 0.4)
    g.add(piece)
  }
  return shadowed(g)
}
