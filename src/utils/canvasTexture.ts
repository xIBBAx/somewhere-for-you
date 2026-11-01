import * as THREE from "three"

const cache = new Map<string, THREE.CanvasTexture>()

/** Render text (or a tiny decorative layout) into a canvas texture, cached. */
export const textTexture = (
  key: string,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  width = 256,
  height = 128,
): THREE.CanvasTexture => {
  const hit = cache.get(key)
  if (hit) return hit
  if (typeof document === "undefined") {
    const tex = new THREE.CanvasTexture({} as HTMLCanvasElement)
    tex.colorSpace = THREE.SRGBColorSpace
    cache.set(key, tex)
    return tex
  }
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (ctx) draw(ctx, width, height)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  cache.set(key, tex)
  return tex
}

export const signTexture = (text: string, bg = "#f7ead6", fg = "#6b4a36"): THREE.CanvasTexture =>
  textTexture(`sign:${text}:${bg}`, (ctx, w, h) => {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = fg
    ctx.font = "600 34px 'Nunito Sans', sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(text, w / 2, h / 2, w * 0.9)
  })

/** A feathered four-point star for PointsMaterial (avoids the default square particles). */
export const softStarTexture = (): THREE.CanvasTexture =>
  textTexture(
    "soft-four-point-star",
    (ctx, w, h) => {
      const cx = w / 2
      const cy = h / 2
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.48)
      glow.addColorStop(0, "rgba(255,255,255,1)")
      glow.addColorStop(0.15, "rgba(255,248,220,.98)")
      glow.addColorStop(0.48, "rgba(255,223,167,.32)")
      glow.addColorStop(1, "rgba(255,220,160,0)")
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, w, h)

      ctx.save()
      ctx.translate(cx, cy)
      ctx.fillStyle = "rgba(255,255,255,.92)"
      ctx.beginPath()
      ctx.moveTo(0, -h * 0.46)
      ctx.quadraticCurveTo(w * 0.045, -h * 0.05, w * 0.46, 0)
      ctx.quadraticCurveTo(w * 0.045, h * 0.05, 0, h * 0.46)
      ctx.quadraticCurveTo(-w * 0.045, h * 0.05, -w * 0.46, 0)
      ctx.quadraticCurveTo(-w * 0.045, -h * 0.05, 0, -h * 0.46)
      ctx.fill()
      ctx.restore()
    },
    96,
    96,
  )

/**
 * Procedural realistic 3D lunar surface texture with major lunar maria,
 * highland craters, and subtle ray systems.
 */
export const lunarSurfaceTexture = (): THREE.CanvasTexture =>
  textTexture(
    "lunar-surface-texture-v2",
    (ctx, w, h) => {
      // 1. Base lunar highland tone: warm silvery-white with subtle variation
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h)
      bgGrad.addColorStop(0, "#e8ecf4")
      bgGrad.addColorStop(0.5, "#dce2ee")
      bgGrad.addColorStop(1, "#cfd6e4")
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, w, h)

      // 2. Highland noise & mineral speckling
      ctx.fillStyle = "rgba(180, 190, 205, 0.25)"
      for (let i = 0; i < 600; i++) {
        const nx = ((i * 137.5) % w + Math.sin(i * 3.7) * 8 + w) % w
        const ny = ((i * 89.3) % h + Math.cos(i * 2.3) * 6 + h) % h
        const nr = 1 + (i % 4) * 0.8
        ctx.beginPath()
        ctx.arc(nx, ny, nr, 0, Math.PI * 2)
        ctx.fill()
      }

      // 3. Authentic Lunar Maria (Dark volcanic basalt plains)
      const maria = [
        // Oceanus Procellarum (Ocean of Storms - broad western expanse)
        { x: w * 0.28, y: h * 0.44, rx: w * 0.16, ry: h * 0.28, rot: 0.2, dark: 0.42 },
        // Mare Imbrium (Sea of Rains - large circular northwest mare)
        { x: w * 0.35, y: h * 0.30, rx: w * 0.11, ry: h * 0.16, rot: -0.1, dark: 0.48 },
        // Mare Serenitatis (Sea of Serenity - north-central)
        { x: w * 0.54, y: h * 0.32, rx: w * 0.08, ry: h * 0.13, rot: 0.15, dark: 0.46 },
        // Mare Tranquillitatis (Sea of Tranquility - central east)
        { x: w * 0.62, y: h * 0.46, rx: w * 0.10, ry: h * 0.15, rot: -0.2, dark: 0.52 },
        // Mare Fecunditatis (Sea of Fertility - southeast)
        { x: w * 0.68, y: h * 0.60, rx: w * 0.09, ry: h * 0.13, rot: 0.3, dark: 0.44 },
        // Mare Nectaris (Sea of Nectar - south-central east)
        { x: w * 0.58, y: h * 0.66, rx: w * 0.06, ry: h * 0.09, rot: 0.1, dark: 0.40 },
        // Mare Crisium (Sea of Crises - isolated eastern oval)
        { x: w * 0.78, y: h * 0.36, rx: w * 0.055, ry: h * 0.08, rot: 0.05, dark: 0.55 },
        // Mare Nubium (Sea of Clouds - south-central west)
        { x: w * 0.36, y: h * 0.66, rx: w * 0.09, ry: h * 0.12, rot: -0.15, dark: 0.38 },
        // Mare Humorum (Sea of Moisture - southwest)
        { x: w * 0.24, y: h * 0.68, rx: w * 0.05, ry: h * 0.07, rot: 0.25, dark: 0.45 },
      ]

      maria.forEach((m) => {
        ctx.save()
        ctx.translate(m.x, m.y)
        ctx.rotate(m.rot)
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(m.rx, m.ry))
        g.addColorStop(0, `rgba(52, 60, 78, ${m.dark})`)
        g.addColorStop(0.65, `rgba(70, 80, 102, ${m.dark * 0.75})`)
        g.addColorStop(1, "rgba(110, 122, 145, 0)")
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.ellipse(0, 0, m.rx, m.ry, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      })

      // 4. Prominent Impact Craters with Bright Ejecta Rays (Tycho, Copernicus, Kepler)
      const craters = [
        // Tycho (southern highlands with prominent ray system)
        { x: w * 0.42, y: h * 0.82, r: 5.5, rays: 14, rayLen: w * 0.28 },
        // Copernicus (bright rays in Oceanus Procellarum)
        { x: w * 0.32, y: h * 0.46, r: 4.5, rays: 10, rayLen: w * 0.16 },
        // Kepler (western bright spot)
        { x: w * 0.22, y: h * 0.44, r: 3.2, rays: 8, rayLen: w * 0.09 },
        // Aristarchus (brightest feature on the moon)
        { x: w * 0.20, y: h * 0.32, r: 3.0, rays: 6, rayLen: w * 0.08 },
        // Plato (dark-floored northern circular crater)
        { x: w * 0.38, y: h * 0.18, r: 3.8, rays: 0, rayLen: 0 },
      ]

      // Draw bright ejecta rays
      craters.forEach((c) => {
        if (c.rays > 0) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.28)"
          for (let ray = 0; ray < c.rays; ray++) {
            const angle = (ray / c.rays) * Math.PI * 2 + (ray % 2) * 0.15
            const len = c.rayLen * (0.65 + (ray % 3) * 0.35)
            ctx.lineWidth = 1.0 + (ray % 2) * 0.8
            ctx.beginPath()
            ctx.moveTo(c.x, c.y)
            ctx.lineTo(c.x + Math.cos(angle) * len, c.y + Math.sin(angle) * len)
            ctx.stroke()
          }
        }

        // Crater rim and dark shadow / bright wall
        const rg = ctx.createRadialGradient(c.x - 1, c.y - 1, 0, c.x, c.y, c.r)
        rg.addColorStop(0, "rgba(40, 48, 64, 0.65)")
        rg.addColorStop(0.7, "rgba(75, 85, 105, 0.4)")
        rg.addColorStop(0.9, "rgba(255, 255, 255, 0.85)")
        rg.addColorStop(1, "rgba(200, 210, 230, 0)")
        ctx.fillStyle = rg
        ctx.beginPath()
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2)
        ctx.fill()
      })
    },
    512,
    256,
  )

/** Soft radial corona glow for realistic atmospheric solar presence. */
export const solarCoronaTexture = (): THREE.CanvasTexture =>
  textTexture(
    "solar-corona-texture-v2",
    (ctx, w, h) => {
      const cx = w / 2
      const cy = h / 2
      const maxR = w / 2
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR)
      grad.addColorStop(0, "rgba(255, 255, 255, 1.0)")
      grad.addColorStop(0.12, "rgba(255, 246, 218, 0.95)")
      grad.addColorStop(0.28, "rgba(255, 224, 158, 0.65)")
      grad.addColorStop(0.52, "rgba(255, 192, 112, 0.28)")
      grad.addColorStop(0.80, "rgba(255, 160, 80, 0.08)")
      grad.addColorStop(1.0, "rgba(255, 140, 60, 0)")
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)

      // Delicate subtle coronal streamers
      ctx.strokeStyle = "rgba(255, 240, 200, 0.14)"
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * Math.PI * 2
        const len = maxR * (0.65 + (i % 3) * 0.15)
        ctx.lineWidth = 1.5 + (i % 2)
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len)
        ctx.stroke()
      }
    },
    256,
    256,
  )

/** Optical flare and anamorphic atmospheric diffraction streak for the sun. */
export const solarFlareTexture = (): THREE.CanvasTexture =>
  textTexture(
    "solar-flare-anamorphic-v2",
    (ctx, w, h) => {
      const cx = w / 2
      const cy = h / 2
      // Anamorphic horizontal glare streak
      const hGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.48)
      hGrad.addColorStop(0, "rgba(255, 255, 255, 0.95)")
      hGrad.addColorStop(0.18, "rgba(255, 235, 180, 0.6)")
      hGrad.addColorStop(0.45, "rgba(255, 200, 140, 0.18)")
      hGrad.addColorStop(1, "rgba(255, 180, 120, 0)")
      ctx.fillStyle = hGrad

      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(1.0, 0.16)
      ctx.beginPath()
      ctx.arc(0, 0, w * 0.48, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // Subtle diagonal diffraction spike
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(Math.PI / 4)
      ctx.scale(0.8, 0.08)
      ctx.beginPath()
      ctx.arc(0, 0, w * 0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    },
    256,
    256,
  )

/** Soft feathered vapor texture for contrails and high-altitude vapor trails. */
export const contrailVaporTexture = (): THREE.CanvasTexture =>
  textTexture(
    "contrail-vapor-texture-v2",
    (ctx, w, h) => {
      const cx = w / 2
      const cy = h / 2
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.46)
      grad.addColorStop(0, "rgba(255, 255, 255, 0.98)")
      grad.addColorStop(0.22, "rgba(248, 252, 255, 0.82)")
      grad.addColorStop(0.55, "rgba(235, 245, 255, 0.38)")
      grad.addColorStop(0.82, "rgba(220, 238, 255, 0.12)")
      grad.addColorStop(1.0, "rgba(210, 230, 255, 0)")
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
    },
    128,
    128,
  )

/**
 * 2x2 multi-scale cumulus puff atlas texture for authentic fair-weather clouds.
 * Quadrant 0 (0, 0): Cauliflower crown dome (dense rounded top billows with organic nodules)
 * Quadrant 1 (1, 0): Asymmetric flank turret (diagonal billowing mass with internal density relief)
 * Quadrant 2 (0, 1): Flat-bottom base shelf (dew-point condensation baseline with soft feathered underside)
 * Quadrant 3 (1, 1): Airy vapor wisp (perimeter erosion and delicate filamentary feathering)
 */
export const cloudPuffAtlasTexture = (): THREE.CanvasTexture =>
  textTexture(
    "cloud-puff-atlas-v5",
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h)

      // Helper to render an organic elliptical vapor lobe with soft cubic-smooth falloff
      const drawLobe = (
        cx: number,
        cy: number,
        rx: number,
        ry: number,
        alpha = 0.8,
        innerRatio = 0.22,
        rot = 0,
      ) => {
        ctx.save()
        ctx.translate(cx, cy)
        if (rot !== 0) ctx.rotate(rot)
        ctx.scale(1.0, ry / rx)
        const g = ctx.createRadialGradient(0, 0, rx * innerRatio, 0, 0, rx)
        g.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
        g.addColorStop(0.32, `rgba(255, 255, 255, ${alpha * 0.9})`)
        g.addColorStop(0.62, `rgba(255, 255, 255, ${alpha * 0.5})`)
        g.addColorStop(0.85, `rgba(255, 255, 255, ${alpha * 0.16})`)
        g.addColorStop(1.0, "rgba(255, 255, 255, 0)")
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(0, 0, rx, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // ----------------------------------------------------------------------
      // Quadrant 0: Cauliflower Crown Dome (top-left: 0..256, 0..256)
      // Dense central core with overlapping cauliflower apex mounds and micro nodules
      // ----------------------------------------------------------------------
      // Core mass
      drawLobe(128, 142, 88, 78, 0.76, 0.25)
      drawLobe(128, 105, 68, 62, 0.86, 0.32)
      // Flanking secondary mounds
      drawLobe(92, 116, 56, 52, 0.82, 0.28, -0.15)
      drawLobe(164, 112, 58, 54, 0.82, 0.28, 0.15)
      drawLobe(64, 138, 46, 44, 0.72, 0.22, -0.2)
      drawLobe(192, 134, 48, 45, 0.72, 0.22, 0.2)
      // Cauliflower crown nodules (apex domes)
      drawLobe(112, 74, 40, 36, 0.88, 0.35, -0.1)
      drawLobe(148, 72, 42, 38, 0.88, 0.35, 0.1)
      drawLobe(82, 88, 34, 32, 0.78, 0.28, -0.25)
      drawLobe(174, 86, 36, 33, 0.78, 0.28, 0.25)
      drawLobe(130, 56, 28, 26, 0.74, 0.25)
      // Fine micro-billow texture
      drawLobe(100, 60, 22, 20, 0.7, 0.2)
      drawLobe(158, 58, 22, 20, 0.7, 0.2)

      // ----------------------------------------------------------------------
      // Quadrant 1: Asymmetric Flank Turret (top-right: 256..512, 0..256)
      // Diagonal billowing tower with internal crevasse and secondary bulges
      // ----------------------------------------------------------------------
      const Ox1 = 256
      // Main diagonal body
      drawLobe(Ox1 + 118, 146, 84, 76, 0.78, 0.25, 0.18)
      drawLobe(Ox1 + 158, 126, 68, 60, 0.84, 0.3, 0.22)
      drawLobe(Ox1 + 192, 142, 52, 48, 0.74, 0.22, 0.15)
      // Rising turret shoulder
      drawLobe(Ox1 + 96, 108, 62, 56, 0.82, 0.28, -0.12)
      drawLobe(Ox1 + 72, 82, 46, 42, 0.8, 0.3, -0.2)
      drawLobe(Ox1 + 128, 86, 54, 50, 0.86, 0.32, 0.1)
      drawLobe(Ox1 + 156, 96, 44, 40, 0.78, 0.26, 0.2)
      // Breakup nodules
      drawLobe(Ox1 + 52, 126, 38, 36, 0.68, 0.2)
      drawLobe(Ox1 + 210, 160, 32, 30, 0.62, 0.18)
      drawLobe(Ox1 + 104, 62, 30, 26, 0.72, 0.22, -0.15)
      drawLobe(Ox1 + 140, 66, 28, 25, 0.74, 0.22, 0.12)

      // ----------------------------------------------------------------------
      // Quadrant 2: Flat-Bottom Base Shelf (bottom-left: 0..256, 256..512)
      // Authentic condensation level (LCL) horizontal deck with soft organic
      // underside feathering and zero straight razor clipping!
      // ----------------------------------------------------------------------
      const Oy2 = 256
      // Horizontally aligned, flattened base billows along the condensation baseline
      drawLobe(82, Oy2 + 164, 64, 38, 0.86, 0.32)
      drawLobe(128, Oy2 + 168, 72, 42, 0.9, 0.35)
      drawLobe(174, Oy2 + 164, 64, 38, 0.86, 0.32)
      drawLobe(42, Oy2 + 168, 42, 26, 0.72, 0.24)
      drawLobe(214, Oy2 + 168, 42, 26, 0.72, 0.24)
      // Soft gentle vapor feathering along bottom perimeter (natural dew-point boundary)
      drawLobe(65, Oy2 + 180, 36, 18, 0.45, 0.15)
      drawLobe(105, Oy2 + 184, 44, 20, 0.52, 0.18)
      drawLobe(152, Oy2 + 184, 44, 20, 0.52, 0.18)
      drawLobe(190, Oy2 + 180, 36, 18, 0.45, 0.15)
      // Rising billow body above the shelf
      drawLobe(104, Oy2 + 114, 58, 52, 0.82, 0.28)
      drawLobe(154, Oy2 + 110, 62, 54, 0.84, 0.28)
      drawLobe(128, Oy2 + 76, 48, 44, 0.78, 0.25)
      drawLobe(80, Oy2 + 92, 38, 34, 0.72, 0.22)
      drawLobe(176, Oy2 + 88, 40, 36, 0.72, 0.22)

      // ----------------------------------------------------------------------
      // Quadrant 3: Airy Vapor Wisp (bottom-right: 256..512, 256..512)
      // Delicate, multi-layered feathered filaments for silhouette erosion
      // ----------------------------------------------------------------------
      const Ox3 = 256
      const Oy3 = 256
      drawLobe(Ox3 + 128, Oy3 + 128, 82, 70, 0.48, 0.15, 0.1)
      drawLobe(Ox3 + 92, Oy3 + 106, 52, 44, 0.42, 0.15, -0.2)
      drawLobe(Ox3 + 164, Oy3 + 116, 56, 46, 0.45, 0.15, 0.2)
      drawLobe(Ox3 + 122, Oy3 + 82, 48, 40, 0.52, 0.2)
      drawLobe(Ox3 + 152, Oy3 + 164, 44, 36, 0.36, 0.12, 0.15)
      drawLobe(Ox3 + 74, Oy3 + 144, 40, 32, 0.34, 0.12, -0.15)
      drawLobe(Ox3 + 184, Oy3 + 92, 38, 30, 0.32, 0.1, 0.25)
      drawLobe(Ox3 + 108, Oy3 + 174, 36, 28, 0.3, 0.1)
      drawLobe(Ox3 + 140, Oy3 + 58, 30, 22, 0.35, 0.12)
      drawLobe(Ox3 + 68, Oy3 + 118, 28, 22, 0.28, 0.1)
    },
    512,
    512,
  )

/**
 * High-altitude wind-sheared cirrus brushstroke texture with delicate fibrous filaments.
 */
export const cirrusWispTexture = (): THREE.CanvasTexture =>
  textTexture(
    "cirrus-wisp-texture-v5",
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h)

      const cy = h / 2
      // Main wind-sheared streak with soft gradient
      const mainGrad = ctx.createLinearGradient(0, cy, w, cy)
      mainGrad.addColorStop(0, "rgba(255, 255, 255, 0)")
      mainGrad.addColorStop(0.18, "rgba(255, 255, 255, 0.35)")
      mainGrad.addColorStop(0.48, "rgba(255, 255, 255, 0.68)")
      mainGrad.addColorStop(0.76, "rgba(255, 255, 255, 0.42)")
      mainGrad.addColorStop(0.92, "rgba(255, 255, 255, 0.12)")
      mainGrad.addColorStop(1.0, "rgba(255, 255, 255, 0)")

      ctx.fillStyle = mainGrad
      ctx.beginPath()
      ctx.ellipse(w * 0.48, cy, w * 0.46, h * 0.28, 0, 0, Math.PI * 2)
      ctx.fill()

      // Delicate fibrous filaments along wind shear direction with soft feathered tapering
      for (let i = 0; i < 9; i++) {
        const fy = cy + (i - 4) * (h * 0.08) + Math.sin(i * 1.5) * 4
        const fLen = w * (0.32 + (i % 4) * 0.14)
        const fStart = w * (0.12 + (i % 3) * 0.1)
        const fThick = h * (0.08 + (i % 3) * 0.04)

        const fGrad = ctx.createRadialGradient(
          0,
          0,
          0,
          0,
          0,
          fLen * 0.5,
        )
        const alpha = 0.22 + (i % 3) * 0.1
        fGrad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
        fGrad.addColorStop(0.4, `rgba(255, 255, 255, ${alpha * 0.7})`)
        fGrad.addColorStop(0.8, `rgba(255, 255, 255, ${alpha * 0.2})`)
        fGrad.addColorStop(1.0, "rgba(255, 255, 255, 0)")

        ctx.save()
        ctx.translate(fStart + fLen * 0.5, fy)
        ctx.scale(1.0, fThick / fLen)
        ctx.fillStyle = fGrad
        ctx.beginPath()
        ctx.arc(0, 0, fLen * 0.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // Feathered hooked mares' tail
      const hookGrad = ctx.createRadialGradient(w * 0.84, cy - 14, 0, w * 0.84, cy - 14, w * 0.12)
      hookGrad.addColorStop(0, "rgba(255, 255, 255, 0.32)")
      hookGrad.addColorStop(0.6, "rgba(255, 255, 255, 0.12)")
      hookGrad.addColorStop(1.0, "rgba(255, 255, 255, 0)")
      ctx.save()
      ctx.translate(w * 0.84, cy - 14)
      ctx.scale(1.0, 0.35)
      ctx.fillStyle = hookGrad
      ctx.beginPath()
      ctx.arc(0, 0, w * 0.12, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    },
    512,
    128,
  )


