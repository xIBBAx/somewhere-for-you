import * as THREE from "three"

/**
 * High-fidelity procedural textures for realistic tree bark and foliage cards.
 * Generated via HTML5 Canvas with proper SRGBColorSpace, 4x anisotropy, and mipmapping.
 */

const textureCache = new Map<string, THREE.CanvasTexture>()

const getOrCreateCanvasTexture = (
  key: string,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  width = 512,
  height = 512,
  wrap: THREE.Wrapping = THREE.RepeatWrapping,
): THREE.CanvasTexture => {
  const hit = textureCache.get(key)
  if (hit) return hit

  if (typeof document === "undefined") {
    const tex = new THREE.CanvasTexture({} as HTMLCanvasElement)
    tex.colorSpace = THREE.SRGBColorSpace
    textureCache.set(key, tex)
    return tex
  }

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (ctx) draw(ctx, width, height)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = wrap
  tex.wrapT = wrap
  tex.anisotropy = 8
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  textureCache.set(key, tex)
  return tex
}

/**
 * Procedural rough oak / deciduous bark:
 * Deep vertical furrows, rugged ridges, subtle fibrous moss-green tonal shifts,
 * and high-frequency wood grain micro-texture.
 */
export const deciduousBarkTexture = (): THREE.CanvasTexture =>
  getOrCreateCanvasTexture("bark:deciduous:diffuse", (ctx, w, h) => {
    // Base rich warm earthy wood
    ctx.fillStyle = "#544032"
    ctx.fillRect(0, 0, w, h)

    // Vertical furrows and ridges
    for (let x = 0; x < w; x += 3) {
      const furrow = Math.sin(x * 0.08) * 0.4 + Math.sin(x * 0.22) * 0.3 + (Math.random() - 0.5) * 0.3
      const tone = furrow > 0.15 ? "#745b48" : furrow > -0.1 ? "#5e4838" : "#3d2b20"
      ctx.fillStyle = tone
      ctx.globalAlpha = 0.55 + Math.random() * 0.35
      ctx.fillRect(x, 0, 3 + Math.random() * 2, h)
    }

    // Organic longitudinal bark cracks
    ctx.strokeStyle = "#251912"
    ctx.lineWidth = 1.8
    ctx.globalAlpha = 0.65
    for (let i = 0; i < 48; i++) {
      let cx = Math.random() * w
      ctx.beginPath()
      ctx.moveTo(cx, 0)
      for (let y = 0; y < h; y += 16) {
        cx += (Math.random() - 0.5) * 4
        ctx.lineTo(cx, y)
      }
      ctx.stroke()
    }

    // Subtle moss & lichen undertones at bark base/crevices
    ctx.fillStyle = "#4a5e38"
    ctx.globalAlpha = 0.22
    for (let i = 0; i < 35; i++) {
      const rx = Math.random() * w
      const ry = Math.random() * h
      ctx.beginPath()
      ctx.ellipse(rx, ry, 8 + Math.random() * 12, 20 + Math.random() * 35, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalAlpha = 1.0
  })

/**
 * Japanese Flowering Gulmohar (Prunus serrulata) Bark:
 * Smooth, lustrous reddish-brown / copper mahogany base with distinctive horizontal lenticels
 * (corky tan horizontal breathing pores and banded striations) as documented by Kew & Morton Arboretum.
 */
export const gulmoharBarkTexture = (): THREE.CanvasTexture =>
  getOrCreateCanvasTexture("bark:gulmohar:diffuse", (ctx, w, h) => {
    // Rich polished copper mahogany with subtle tonal depth
    const grad = ctx.createLinearGradient(0, 0, w, 0)
    grad.addColorStop(0, "#5a3123")
    grad.addColorStop(0.3, "#703e2e")
    grad.addColorStop(0.7, "#7a4433")
    grad.addColorStop(1, "#522a1d")
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)

    // Fine organic horizontal bark grain and satin striations
    for (let y = 0; y < h; y += 2) {
      const tone = Math.random() > 0.5 ? "#864735" : "#442116"
      ctx.fillStyle = tone
      ctx.globalAlpha = 0.25 + Math.random() * 0.2
      ctx.fillRect(0, y, w, 1 + Math.random() * 1.5)
    }

    // Delicate natural horizontal lenticels (characteristic Prunus serrulata breathing marks)
    for (let i = 0; i < 160; i++) {
      const lx = Math.random() * w
      const ly = Math.random() * h
      const lWidth = 8 + Math.random() * 24
      const lHeight = 1.0 + Math.random() * 1.4

      // Lenticel shadow slit
      ctx.fillStyle = "#2d140c"
      ctx.globalAlpha = 0.45
      ctx.fillRect(lx, ly, lWidth, lHeight)

      // Lenticel corky center
      ctx.fillStyle = "#9c6b54"
      ctx.globalAlpha = 0.5
      ctx.fillRect(lx + 1, ly - 0.3, lWidth - 2, lHeight * 0.85)

      // Delicate subtle upper highlight
      ctx.fillStyle = "#b8896e"
      ctx.globalAlpha = 0.35
      ctx.fillRect(lx + 2, ly - 0.7, lWidth - 4, 0.6)
    }

    // Occasional subtle horizontal bark ring striations
    ctx.strokeStyle = "#38190f"
    ctx.lineWidth = 1.0
    ctx.globalAlpha = 0.3
    for (let i = 0; i < 18; i++) {
      const ry = Math.random() * h
      ctx.beginPath()
      ctx.moveTo(0, ry)
      ctx.lineTo(w, ry + (Math.random() - 0.5) * 4)
      ctx.stroke()
    }

    ctx.globalAlpha = 1.0
  })

/**
 * Translucent deciduous leaf cluster card:
 * Organic scalloped leaflets with central midrib veins and soft feathering.
 * Clean alpha with no harsh rectangle borders.
 */
export const deciduousLeafCardTexture = (): THREE.CanvasTexture =>
  getOrCreateCanvasTexture("leaf:deciduous:cluster", (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)

    // Delicate woody twig connecting the leaflets
    ctx.strokeStyle = "#5a4332"
    ctx.lineWidth = 3.5
    ctx.beginPath()
    ctx.moveTo(w * 0.5, h * 0.95)
    ctx.quadraticCurveTo(w * 0.48, h * 0.6, w * 0.5, h * 0.2)
    ctx.stroke()

    // 14 overlapping organic leaflets forming a lush, multi-layered branch tip cluster
    const leaflets = [
      { x: w * 0.5, y: h * 0.22, rot: 0, s: 0.85 },
      { x: w * 0.34, y: h * 0.35, rot: -0.45, s: 0.8 },
      { x: w * 0.66, y: h * 0.35, rot: 0.45, s: 0.8 },
      { x: w * 0.24, y: h * 0.52, rot: -0.85, s: 0.75 },
      { x: w * 0.76, y: h * 0.52, rot: 0.85, s: 0.75 },
      { x: w * 0.3, y: h * 0.68, rot: -0.5, s: 0.72 },
      { x: w * 0.7, y: h * 0.68, rot: 0.5, s: 0.72 },
      { x: w * 0.5, y: h * 0.82, rot: 0.1, s: 0.78 },
      // Inner mantle filling
      { x: w * 0.5, y: h * 0.44, rot: 0.15, s: 0.88 },
      { x: w * 0.42, y: h * 0.58, rot: -0.25, s: 0.78 },
      { x: w * 0.58, y: h * 0.58, rot: 0.25, s: 0.78 },
      { x: w * 0.38, y: h * 0.25, rot: -0.3, s: 0.65 },
      { x: w * 0.62, y: h * 0.25, rot: 0.3, s: 0.65 },
      { x: w * 0.5, y: h * 0.64, rot: 0, s: 0.82 },
    ]

    leaflets.forEach(({ x, y, rot, s }) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(rot)
      ctx.scale(s, s)

      // Leaf body path with curved scalloped edges
      ctx.beginPath()
      ctx.moveTo(0, -60)
      ctx.bezierCurveTo(42, -38, 48, 25, 0, 60)
      ctx.bezierCurveTo(-48, 25, -42, -38, 0, -60)
      ctx.closePath()

      // Neutral surface variation lets the instance palette control leaf color
      // without multiplying two saturated green albedos together.
      const leafGrad = ctx.createRadialGradient(0, -10, 6, 0, 0, 58)
      leafGrad.addColorStop(0, "#f4f1da")
      leafGrad.addColorStop(0.55, "#d4d5bf")
      leafGrad.addColorStop(1, "#9fa78c")
      ctx.fillStyle = leafGrad
      ctx.fill()

      // Leaf midrib vein
      ctx.strokeStyle = "#ecebd3"
      ctx.lineWidth = 2.0
      ctx.globalAlpha = 0.6
      ctx.beginPath()
      ctx.moveTo(0, -56)
      ctx.lineTo(0, 56)
      ctx.stroke()

      // Lateral secondary veins
      ctx.lineWidth = 1.2
      ctx.globalAlpha = 0.45
      for (let v = -36; v <= 36; v += 12) {
        ctx.beginPath()
        ctx.moveTo(0, v)
        ctx.quadraticCurveTo(14, v - 6, 24, v - 12)
        ctx.moveTo(0, v)
        ctx.quadraticCurveTo(-14, v - 6, -24, v - 12)
        ctx.stroke()
      }

      ctx.restore()
    })
  })

/**
 * Japanese Gulmohar Blossom (Gulmohar) Spray Cluster Texture:
 * Delicate botanical umbel spray of fine-grained 5-petal florets, buds, and fine twigs.
 * Florets are appropriately scaled to give the impression of hundreds of delicate flowers.
 */
export const gulmoharBlossomClusterTexture = (): THREE.CanvasTexture =>
  getOrCreateCanvasTexture("leaf:gulmohar:cluster", (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)

    // Delicate organic pedicel twigs supporting the blossom spray tucked behind florets
    ctx.strokeStyle = "#7c5a4a"
    ctx.lineWidth = 1.8
    ctx.lineCap = "round"
    ctx.globalAlpha = 0.55
    ctx.beginPath()
    ctx.moveTo(w * 0.5, h * 0.86)
    ctx.quadraticCurveTo(w * 0.49, h * 0.65, w * 0.5, h * 0.42)
    // Lateral pedicel forks
    ctx.moveTo(w * 0.49, h * 0.64)
    ctx.quadraticCurveTo(w * 0.38, h * 0.54, w * 0.32, h * 0.44)
    ctx.moveTo(w * 0.51, h * 0.60)
    ctx.quadraticCurveTo(w * 0.62, h * 0.52, w * 0.68, h * 0.42)
    ctx.stroke()
    ctx.globalAlpha = 1.0

    // Function to draw an individual 5-petal gulmohar floret with heart notches
    const drawGulmoharFlower = (cx: number, cy: number, radius: number, rot: number, open: number) => {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(rot)

      const petalCount = 5
      for (let p = 0; p < petalCount; p++) {
        const angle = (p / petalCount) * Math.PI * 2
        ctx.save()
        ctx.rotate(angle)

        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.bezierCurveTo(radius * 0.45 * open, -radius * 0.32, radius * 0.52, -radius * 0.85, radius * 0.16, -radius)
        ctx.lineTo(0, -radius * 0.88) // apical heart notch
        ctx.lineTo(-radius * 0.16, -radius)
        ctx.bezierCurveTo(-radius * 0.52, -radius * 0.85, -radius * 0.45 * open, -radius * 0.32, 0, 0)
        ctx.closePath()

        // Soft botanical petal gradient: white outer tip, delicate blush pink heart
        const pGrad = ctx.createRadialGradient(0, 0, radius * 0.08, 0, -radius * 0.55, radius * 0.95)
        pGrad.addColorStop(0, "#c92a12")
        pGrad.addColorStop(0.28, "#ff5a2a")
        pGrad.addColorStop(0.68, "#ff8a3d")
        pGrad.addColorStop(1, "#ffb066")
        ctx.fillStyle = pGrad
        ctx.globalAlpha = 0.94
        ctx.fill()

        ctx.restore()
      }

      // Small delicate rose pistil eye (subtle, not giant)
      ctx.fillStyle = "#7a1408"
      ctx.globalAlpha = 0.75
      ctx.beginPath()
      ctx.arc(0, 0, radius * 0.12, 0, Math.PI * 2)
      ctx.fill()

      // Fine golden stamen dots
      ctx.fillStyle = "#fef08a"
      ctx.globalAlpha = 0.85
      for (let s = 0; s < 6; s++) {
        const sa = (s / 6) * Math.PI * 2
        const sx = Math.cos(sa) * radius * 0.22
        const sy = Math.sin(sa) * radius * 0.22
        ctx.beginPath()
        ctx.arc(sx, sy, 1.2, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.restore()
    }

    // Function to draw unopened flower buds
    const drawBud = (cx: number, cy: number, r: number, rot: number) => {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(rot)
      ctx.fillStyle = "#d9361a"
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.ellipse(0, 0, r * 0.6, r, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "#4a7c36" // green calyx base
      ctx.beginPath()
      ctx.arc(0, r * 0.6, r * 0.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // 22 delicately proportioned florets arranged along branch spray
    const flowers = [
      // Central cluster
      { x: w * 0.5, y: h * 0.42, r: w * 0.12, rot: 0.2, open: 1.0 },
      { x: w * 0.44, y: h * 0.50, r: w * 0.11, rot: -0.5, open: 0.95 },
      { x: w * 0.56, y: h * 0.50, r: w * 0.11, rot: 0.6, open: 0.95 },
      { x: w * 0.5, y: h * 0.32, r: w * 0.11, rot: 1.1, open: 0.92 },
      { x: w * 0.5, y: h * 0.58, r: w * 0.10, rot: -0.8, open: 0.9 },

      // Left branchlet
      { x: w * 0.32, y: h * 0.40, r: w * 0.11, rot: -0.3, open: 0.95 },
      { x: w * 0.22, y: h * 0.44, r: w * 0.10, rot: 0.8, open: 0.9 },
      { x: w * 0.28, y: h * 0.30, r: w * 0.10, rot: -0.9, open: 0.92 },
      { x: w * 0.38, y: h * 0.32, r: w * 0.09, rot: 0.4, open: 0.88 },
      { x: w * 0.20, y: h * 0.36, r: w * 0.08, rot: 1.3, open: 0.85 },

      // Right branchlet
      { x: w * 0.68, y: h * 0.40, r: w * 0.11, rot: 0.4, open: 0.95 },
      { x: w * 0.78, y: h * 0.44, r: w * 0.10, rot: -0.7, open: 0.9 },
      { x: w * 0.72, y: h * 0.30, r: w * 0.10, rot: 0.8, open: 0.92 },
      { x: w * 0.62, y: h * 0.32, r: w * 0.09, rot: -0.5, open: 0.88 },
      { x: w * 0.80, y: h * 0.36, r: w * 0.08, rot: -1.2, open: 0.85 },

      // Top apical bough
      { x: w * 0.5, y: h * 0.22, r: w * 0.10, rot: 0.1, open: 0.9 },
      { x: w * 0.42, y: h * 0.18, r: w * 0.09, rot: -0.4, open: 0.88 },
      { x: w * 0.58, y: h * 0.18, r: w * 0.09, rot: 0.5, open: 0.88 },
      { x: w * 0.5, y: h * 0.12, r: w * 0.08, rot: 0.7, open: 0.82 },

      // Lower mantle
      { x: w * 0.38, y: h * 0.62, r: w * 0.09, rot: 0.3, open: 0.85 },
      { x: w * 0.62, y: h * 0.62, r: w * 0.09, rot: -0.4, open: 0.85 },
      { x: w * 0.5, y: h * 0.70, r: w * 0.08, rot: 1.0, open: 0.8 },
    ]

    flowers.forEach((f) => drawGulmoharFlower(f.x, f.y, f.r, f.rot, f.open))

    // Delicate buds on branch tips
    drawBud(w * 0.14, h * 0.46, 12, -0.6)
    drawBud(w * 0.86, h * 0.46, 12, 0.6)
    drawBud(w * 0.5, h * 0.06, 11, 0)
    drawBud(w * 0.32, h * 0.20, 10, -0.4)
    drawBud(w * 0.68, h * 0.20, 10, 0.4)
  })

/**
 * Individual Gulmohar Petal Texture for ground carpet and windborne falling petals:
 * A delicate single petal with notched apex, subtle concave curl, and translucent blush gradient.
 */
export const gulmoharPetalTexture = (): THREE.CanvasTexture =>
  getOrCreateCanvasTexture("leaf:gulmohar:single_petal", (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)

    const cx = w * 0.5
    const cy = h * 0.5
    const r = w * 0.42

    ctx.save()
    ctx.translate(cx, cy)

    // Heart-notched single petal contour
    ctx.beginPath()
    ctx.moveTo(0, r * 0.85) // Petal base / stalk attachment
    ctx.bezierCurveTo(r * 0.6, r * 0.55, r * 0.78, -r * 0.45, r * 0.26, -r * 0.85)
    ctx.lineTo(0, -r * 0.7) // Central notched cleft
    ctx.lineTo(-r * 0.26, -r * 0.85)
    ctx.bezierCurveTo(-r * 0.78, -r * 0.45, -r * 0.6, r * 0.55, 0, r * 0.85)
    ctx.closePath()

    // Delicate translucent gradient: deep rose base to pure ivory-pink tip
    const grad = ctx.createRadialGradient(0, r * 0.5, r * 0.1, 0, 0, r * 0.95)
    grad.addColorStop(0, "#c92a12")
    grad.addColorStop(0.35, "#ff5a2a")
    grad.addColorStop(0.75, "#ff8a3d")
    grad.addColorStop(1, "#ffc48a")

    ctx.fillStyle = grad
    ctx.globalAlpha = 0.95
    ctx.fill()

    // Fine delicate translucent petal venation
    ctx.strokeStyle = "#c92a12"
    ctx.lineWidth = 1.2
    ctx.globalAlpha = 0.35
    ctx.beginPath()
    ctx.moveTo(0, r * 0.8)
    ctx.lineTo(0, -r * 0.65)
    ctx.moveTo(0, r * 0.4)
    ctx.quadraticCurveTo(r * 0.25, r * 0.1, r * 0.38, -r * 0.2)
    ctx.moveTo(0, r * 0.4)
    ctx.quadraticCurveTo(-r * 0.25, r * 0.1, -r * 0.38, -r * 0.2)
    ctx.stroke()

    ctx.restore()
  }, 256, 256, THREE.ClampToEdgeWrapping)

/**
 * Palm frond leaf texture for coconut palms:
 * Rich, solid segmented pinnate leaflets radiating from an arching central rachis
 * to create authentic, lush tropical coconut palm crowns.
 */
export const palmFrondTexture = (): THREE.CanvasTexture =>
  getOrCreateCanvasTexture(
    "leaf:palm:frond",
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h)

      const cx = w * 0.5

      // 1. Pinnate Leaflets: pairs of tapered lancet blades radiating outward
      // Step closely (5px) so leaflets overlap to create a dense, luxurious frond blade
      for (let y = h * 0.96; y > h * 0.04; y -= 5.5) {
        const progress = 1 - y / h // 0 at base, 1 at tip
        // Natural tapered silhouette: narrow at base, broadest at mid-frond, tapering to apex
        const span = Math.pow(Math.sin(progress * Math.PI), 0.75) * w * 0.44 + 8
        const droop = Math.pow(progress, 1.2) * 16 + 6
        const leafletWidth = 4.8 + Math.sin(progress * Math.PI) * 2.5

        // Left leaflet
        ctx.beginPath()
        ctx.moveTo(cx - 2, y)
        ctx.quadraticCurveTo(cx - span * 0.45, y - 6, cx - span, y + droop) // top arched edge
        ctx.quadraticCurveTo(cx - span * 0.55, y + droop * 0.5 + leafletWidth, cx - 2, y + leafletWidth) // bottom edge
        ctx.closePath()

        const leftGrad = ctx.createLinearGradient(cx, y, cx - span, y + droop)
        leftGrad.addColorStop(0, "#15803d")
        leftGrad.addColorStop(0.35, "#16a34a")
        leftGrad.addColorStop(0.85, "#22c55e")
        leftGrad.addColorStop(1, "#4ade80")
        ctx.fillStyle = leftGrad
        ctx.fill()

        // Left leaflet central crease highlight
        ctx.strokeStyle = "#86efac"
        ctx.lineWidth = 1.0
        ctx.beginPath()
        ctx.moveTo(cx - 2, y + leafletWidth * 0.5)
        ctx.quadraticCurveTo(cx - span * 0.5, y + droop * 0.3, cx - span * 0.9, y + droop * 0.9)
        ctx.stroke()

        // Right leaflet (subtle organic asymmetry in angle and droop)
        ctx.beginPath()
        ctx.moveTo(cx + 2, y)
        ctx.quadraticCurveTo(cx + span * 0.45, y - 5, cx + span * 0.98, y + droop + 1)
        ctx.quadraticCurveTo(cx + span * 0.55, y + droop * 0.5 + leafletWidth, cx + 2, y + leafletWidth)
        ctx.closePath()

        const rightGrad = ctx.createLinearGradient(cx, y, cx + span, y + droop)
        rightGrad.addColorStop(0, "#166534")
        rightGrad.addColorStop(0.35, "#15803d")
        rightGrad.addColorStop(0.85, "#16a34a")
        rightGrad.addColorStop(1, "#34d399")
        ctx.fillStyle = rightGrad
        ctx.fill()

        // Right leaflet highlight
        ctx.strokeStyle = "#6ee7b7"
        ctx.lineWidth = 1.0
        ctx.beginPath()
        ctx.moveTo(cx + 2, y + leafletWidth * 0.5)
        ctx.quadraticCurveTo(cx + span * 0.5, y + droop * 0.3, cx + span * 0.9, y + droop * 0.9)
        ctx.stroke()
      }

      // 2. Central Arching Rachis (sturdy tapered fibrous stem)
      ctx.beginPath()
      ctx.moveTo(cx - 3.5, h * 0.98)
      ctx.lineTo(cx - 1.0, h * 0.03)
      ctx.lineTo(cx + 1.0, h * 0.03)
      ctx.lineTo(cx + 3.5, h * 0.98)
      ctx.closePath()

      const rachisGrad = ctx.createLinearGradient(cx, h, cx, 0)
      rachisGrad.addColorStop(0, "#ca8a04") // warm fibrous petiole base
      rachisGrad.addColorStop(0.2, "#84cc16") // fresh lime-green midrib
      rachisGrad.addColorStop(0.7, "#a3e635")
      rachisGrad.addColorStop(1.0, "#bbf7d0") // pale green apex
      ctx.fillStyle = rachisGrad
      ctx.fill()
    },
    512,
    512,
  )

/**
 * Silver Birch (Betula pendula) Bark:
 * Luminous chalk-white / pale silver paper bark with dark horizontal breathing lenticels
 * and rugged charcoal fissures near the base as documented by NC State & Kew.
 */
export const birchBarkTexture = (): THREE.CanvasTexture =>
  getOrCreateCanvasTexture("bark:birch:diffuse", (ctx, w, h) => {
    // Pale creamy chalk-white base with soft vertical gradation
    ctx.fillStyle = "#e5ebf0"
    ctx.fillRect(0, 0, w, h)

    // Subtle silvery paper layers
    for (let y = 0; y < h; y += 3) {
      const tone = Math.random() > 0.6 ? "#d0d8df" : Math.random() > 0.3 ? "#f0f4f7" : "#dde3e8"
      ctx.fillStyle = tone
      ctx.globalAlpha = 0.45
      ctx.fillRect(0, y, w, 2)
    }

    // Prominent horizontal dark lenticels (Betula pendula character)
    for (let i = 0; i < 180; i++) {
      const lx = Math.random() * w
      const ly = Math.random() * h
      const lWidth = 10 + Math.random() * 32
      const lHeight = 1.2 + Math.random() * 2.2

      ctx.fillStyle = "#22272e"
      ctx.globalAlpha = 0.75
      ctx.fillRect(lx, ly, lWidth, lHeight)

      ctx.fillStyle = "#636e7b"
      ctx.globalAlpha = 0.45
      ctx.fillRect(lx - 2, ly - 0.5, lWidth + 4, 0.8)
    }

    // Rough dark fissures near base of trunk (y > h * 0.68)
    for (let i = 0; i < 40; i++) {
      const fx = Math.random() * w
      const fy = h * 0.68 + Math.random() * (h * 0.32)
      ctx.fillStyle = "#181b20"
      ctx.globalAlpha = 0.85
      ctx.fillRect(fx, fy, 4 + Math.random() * 8, 12 + Math.random() * 24)
    }

    ctx.globalAlpha = 1.0
  })


