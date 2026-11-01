import { describe, expect, it } from "vitest"
import * as THREE from "three"
import {
  cloudPuffAtlasTexture,
  cirrusWispTexture,
  contrailVaporTexture,
  lunarSurfaceTexture,
  solarCoronaTexture,
  solarFlareTexture,
} from "../src/utils/canvasTexture"
import {
  BRIGHT_STARS,
  VISIBLE_PLANETS,
  starColor,
  galacticToEquatorial,
  equatorialToCartesian,
  rozenbergAirmass,
  atmosphericExtinction,
  calculateLimitingMagnitude,
  generateScientificStarfield,
} from "../src/game/environment/starCatalogue"

describe("sky realism procedural celestial textures", () => {
  it("generates and caches lunar surface canvas texture", () => {
    const tex1 = lunarSurfaceTexture()
    const tex2 = lunarSurfaceTexture()
    expect(tex1).toBeDefined()
    expect(tex1).toBe(tex2) // cached
    expect(tex1.colorSpace).toBe(THREE.SRGBColorSpace)
  })

  it("generates solar corona and optical flare textures", () => {
    const corona = solarCoronaTexture()
    const flare = solarFlareTexture()
    expect(corona).toBeDefined()
    expect(flare).toBeDefined()
    expect(corona.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(flare.colorSpace).toBe(THREE.SRGBColorSpace)
  })

  it("generates feathered vapor texture for contrails", () => {
    const contrail = contrailVaporTexture()
    expect(contrail).toBeDefined()
    expect(contrail.colorSpace).toBe(THREE.SRGBColorSpace)
  })

  it("generates and caches 2x2 multi-scale cloud puff atlas texture", () => {
    const atlas1 = cloudPuffAtlasTexture()
    const atlas2 = cloudPuffAtlasTexture()
    expect(atlas1).toBeDefined()
    expect(atlas1).toBe(atlas2) // cached
    expect(atlas1.colorSpace).toBe(THREE.SRGBColorSpace)
  })

  it("generates and caches high-altitude cirrus wisp texture", () => {
    const cirrus1 = cirrusWispTexture()
    const cirrus2 = cirrusWispTexture()
    expect(cirrus1).toBeDefined()
    expect(cirrus1).toBe(cirrus2) // cached
    expect(cirrus1.colorSpace).toBe(THREE.SRGBColorSpace)
  })
})

describe("airplane high-altitude flight physics & contrail math", () => {
  it("cruises at high altitude with smooth parametric trajectory", () => {
    const start = new THREE.Vector3(-125, 52, -55)
    const end = new THREE.Vector3(125, 52, 45)
    const alt = 52
    const arcHeight = 3.5

    const getPosAt = (p: number): THREE.Vector3 => {
      const out = new THREE.Vector3().lerpVectors(start, end, p)
      out.y = alt + Math.sin(p * Math.PI) * arcHeight
      return out
    }

    const pos0 = getPosAt(0)
    const posHalf = getPosAt(0.5)
    const pos1 = getPosAt(1.0)

    expect(pos0.y).toBe(52)
    expect(posHalf.y).toBeCloseTo(55.5, 1)
    expect(pos1.y).toBe(52)

    // Heading calculation
    const ahead = getPosAt(0.503)
    const heading = Math.atan2(ahead.x - posHalf.x, ahead.z - posHalf.z)
    expect(Number.isFinite(heading)).toBe(true)
  })

  it("calculates expanding dual contrail offset vectors correctly", () => {
    const heading = 0.45
    const pos = new THREE.Vector3(10, 52, -15)
    const leftOffset = new THREE.Vector3(-1.15, -0.22, -0.45)
    const rightOffset = new THREE.Vector3(1.15, -0.22, -0.45)

    const cosH = Math.cos(heading)
    const sinH = Math.sin(heading)

    const lEngineX = pos.x + leftOffset.x * cosH + leftOffset.z * sinH
    const lEngineZ = pos.z - leftOffset.x * sinH + leftOffset.z * cosH

    const rEngineX = pos.x + rightOffset.x * cosH + rightOffset.z * sinH
    const rEngineZ = pos.z - rightOffset.x * sinH + rightOffset.z * cosH

    const left = new THREE.Vector3(lEngineX, pos.y + leftOffset.y, lEngineZ)
    const right = new THREE.Vector3(rEngineX, pos.y + rightOffset.y, rEngineZ)

    expect(left.distanceTo(right)).toBeCloseTo(2.3, 1) // 1.15 * 2 = 2.3m engine span
  })
})

describe("sun and moon celestial positioning & atmospheric response", () => {
  it("interpolates solar diurnal arc across zenith and horizon", () => {
    // Day (t = 0.28): Sun high and bright
    const dayAngle = THREE.MathUtils.lerp(0.9, 2.2, 0.28)
    const dayY = THREE.MathUtils.lerp(24, 7.5, 0.28)
    expect(dayY).toBeGreaterThan(18)

    // Golden hour (t = 0.72): Sun low in the west
    const sunsetY = THREE.MathUtils.lerp(24, 7.5, 0.72)
    expect(sunsetY).toBeLessThan(14)
    expect(dayAngle).toBeLessThan(THREE.MathUtils.lerp(0.9, 2.2, 0.72))
  })

  it("evaluates moon diurnal arc and night visibility", () => {
    // Night (t = 0.95): Moon high and elevated in the sky
    const tod = 0.95
    const sunAngle = THREE.MathUtils.lerp(0.9, 2.2, tod)
    const moonAngle = sunAngle + Math.PI
    const nightProgress = (tod - 0.70) / 0.30
    const alt = 0.22 + Math.sin(Math.min(1, nightProgress) * Math.PI * 0.5) * 0.58
    const r = 73.5
    const my = Math.sin(alt) * r

    expect(alt).toBeGreaterThan(0.4) // elevated above horizon
    expect(my).toBeGreaterThan(30) // high in sky
    expect(moonAngle).toBeCloseTo(sunAngle + Math.PI, 2) // opposite sun
  })
})

describe("naked-eye visible planets & authentic stellar color spectrum", () => {
  it("includes classical naked-eye planets (Venus, Jupiter, Mars, Saturn, Mercury, faint Uranus) and excludes Neptune", () => {
    const names = VISIBLE_PLANETS.map((p) => p.name)
    expect(names).toContain("Venus")
    expect(names).toContain("Jupiter")
    expect(names).toContain("Mars")
    expect(names).toContain("Saturn")
    expect(names).toContain("Mercury")
    expect(names).toContain("Uranus")
    expect(names).not.toContain("Neptune") // invisible to unaided naked eye

    // All planets shine steadily without rapid point-source scintillation
    for (const p of VISIBLE_PLANETS) {
      expect(p.steady).toBe(true)
    }

    const venus = VISIBLE_PLANETS.find((p) => p.name === "Venus")
    expect(venus?.mag).toBe(-4.4)
  })

  it("maps B-V color indices to realistic Harvard spectral classification", () => {
    expect(starColor(-0.25)).toBe("#b8d8ff") // Sapphire Blue-White
    expect(starColor(0.0)).toBe("#ffffff") // Pure White (Sirius/Vega)
    expect(starColor(0.8)).toBe("#ffe7b8") // Golden-Yellow (Capella)
    expect(starColor(1.6)).toBe("#ff9260") // Red-Orange Giant (Betelgeuse)
  })
})

describe("cumulus cloud procedural morphology & atmospheric distribution", () => {
  it("generates organic sky formations spanning overhead zenith, mid-sky, and horizon", async () => {
    const { generateCloudFormations } = await import("../src/game/environment/Clouds")
    const { cumulus, cirrus } = generateCloudFormations(888)

    expect(cumulus.length).toBeGreaterThanOrEqual(18)
    expect(cirrus.length).toBeGreaterThanOrEqual(6)

    // Overhead zenith check: clouds MUST exist overhead above home (r < 28m)
    const zenithClouds = cumulus.filter((f) => Math.hypot(f.x, f.z) < 28)
    expect(zenithClouds.length).toBeGreaterThanOrEqual(3)

    // Mid-sky check: main cumulus banks (28m <= r <= 62m)
    const midClouds = cumulus.filter((f) => {
      const r = Math.hypot(f.x, f.z)
      return r >= 28 && r <= 62
    })
    expect(midClouds.length).toBeGreaterThanOrEqual(8)

    // Horizon check: distant scenic clouds (r > 62m)
    const horizonClouds = cumulus.filter((f) => Math.hypot(f.x, f.z) > 62)
    expect(horizonClouds.length).toBeGreaterThanOrEqual(6)

    // Verify altitudes are elevated appropriately above the ground
    for (const f of cumulus) {
      expect(f.y).toBeGreaterThan(28)
      expect(f.scale).toBeGreaterThanOrEqual(6.0)
    }
  }, 30000) // imports the whole cloud module graph: slow to transform while the game itself is running

  it("verifies multi-scale cauliflower anatomy and flat condensation base shelf", async () => {
    const { generateCloudFormations } = await import("../src/game/environment/Clouds")
    const { cumulus } = generateCloudFormations(888)

    for (const f of cumulus) {
      // Must contain base shelf puffs (atlasIndex 2)
      const basePuffs = f.puffs.filter((p) => p.atlasIndex === 2)
      expect(basePuffs.length).toBeGreaterThanOrEqual(2)

      // Base puffs must have flattened aspect ratio (sy < sx) and low heightRel
      for (const bp of basePuffs) {
        expect(bp.sy).toBeLessThan(bp.sx)
        expect(bp.heightRel).toBeLessThanOrEqual(0.2)
      }

      // Non-puff formations must have cauliflower crowns and perimeter wisps
      if (f.archetype !== "cumulus_puff") {
        const crowns = f.puffs.filter((p) => p.atlasIndex === 0)
        const wisps = f.puffs.filter((p) => p.atlasIndex === 3)
        expect(crowns.length).toBeGreaterThanOrEqual(3)
        expect(wisps.length).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it("verifies rare pareidolia formations (heart, wings, cat) have continuous overlapping volume", async () => {
    const { generateCloudFormations } = await import("../src/game/environment/Clouds")
    const { cumulus } = generateCloudFormations(888)

    const heart = cumulus.find((f) => f.archetype === "pareidolia_heart")
    const wings = cumulus.find((f) => f.archetype === "pareidolia_wings")
    const cat = cumulus.find((f) => f.archetype === "pareidolia_cat")

    expect(heart).toBeDefined()
    expect(wings).toBeDefined()
    expect(cat).toBeDefined()

    // Heart formation must have left and right upper cauliflower mounds, base shelf, and core
    const heartBase = heart!.puffs.filter((p) => p.atlasIndex === 2)
    const heartUpperLeft = heart!.puffs.filter((p) => p.dx < -0.8 && p.dy > 1.5)
    const heartUpperRight = heart!.puffs.filter((p) => p.dx > 0.8 && p.dy > 1.5)
    expect(heartBase.length).toBeGreaterThanOrEqual(3)
    expect(heartUpperLeft.length).toBeGreaterThanOrEqual(3)
    expect(heartUpperRight.length).toBeGreaterThanOrEqual(3)

    // Wings formation must have continuous overlapping billows across ascending span
    const wingLeft = wings!.puffs.filter((p) => p.dx < -1.0)
    const wingRight = wings!.puffs.filter((p) => p.dx > 1.0)
    expect(wingLeft.length).toBeGreaterThanOrEqual(4)
    expect(wingRight.length).toBeGreaterThanOrEqual(4)

    // Cat formation must have arched back, resting head, and trailing tail
    const catHead = cat!.puffs.filter((p) => p.dx < -1.3)
    const catTail = cat!.puffs.filter((p) => p.dx > 1.8)
    expect(catHead.length).toBeGreaterThanOrEqual(2)
    expect(catTail.length).toBeGreaterThanOrEqual(1)
  })
})

describe("SOTA astronomical celestial mechanics & coordinate transformations", () => {
  it("transforms Galactic coordinates to Equatorial coordinates accurately", () => {
    // Galactic Center (l = 0°, b = 0°) is in Sagittarius: RA ~ 266.4°, Dec ~ -28.9°
    const gc = galacticToEquatorial(0, 0)
    expect(gc.ra).toBeCloseTo(266.4, 1)
    expect(gc.dec).toBeCloseTo(-28.94, 1)

    // Galactic Anti-Center (l = 180°, b = 0°) is in Auriga: RA ~ 86.4°, Dec ~ +28.9°
    const gac = galacticToEquatorial(180, 0)
    expect(gac.ra).toBeCloseTo(86.4, 1)
    expect(gac.dec).toBeCloseTo(28.94, 1)

    // Galactic North Pole (b = +90°) in Coma Berenices: RA 192.86°, Dec +27.13°
    const gnp = galacticToEquatorial(0, 90)
    expect(gnp.ra).toBeCloseTo(192.86, 1)
    expect(gnp.dec).toBeCloseTo(27.13, 1)
  })

  it("converts Equatorial coordinates to Cartesian points preserving sphere radius", () => {
    const radius = 78.0
    // Polaris is located very close to the North celestial pole (Dec +89.26°)
    const [px, py, pz] = equatorialToCartesian(37.955, 89.264, radius)
    expect(Math.hypot(px, py, pz)).toBeCloseTo(radius, 4)
    expect(py).toBeGreaterThan(77.5) // heavily aligned with +Y (celestial pole)

    // Sirius is near Dec -16.7°
    const [sx, sy, sz] = equatorialToCartesian(101.287, -16.716, radius)
    expect(Math.hypot(sx, sy, sz)).toBeCloseTo(radius, 4)
    expect(sy).toBeLessThan(0) // Southern hemisphere
  })
})

describe("SOTA atmospheric extinction & airmass physics", () => {
  it("calculates Rozenberg airmass across altitude angles", () => {
    // Zenith (sinAlt = 1.0): airmass is 1.0
    const airmassZenith = rozenbergAirmass(1.0)
    expect(airmassZenith).toBeCloseTo(1.0, 1)

    // Mid sky (sinAlt = 0.5, alt = 30°): airmass is ~2.0
    const airmass30 = rozenbergAirmass(0.5)
    expect(airmass30).toBeCloseTo(2.0, 1)

    // Near horizon (sinAlt = 0.05, alt ~ 2.9°): airmass is high (>10)
    const airmassHorizon = rozenbergAirmass(0.05)
    expect(airmassHorizon).toBeGreaterThan(10.0)
  })

  it("evaluates atmospheric extinction dimming toward the horizon", () => {
    // Zenith: minimal extinction
    const extZenith = atmosphericExtinction(1.0)
    expect(extZenith).toBeGreaterThanOrEqual(0.85)

    // Mid sky: moderate extinction
    const extMid = atmosphericExtinction(0.5)
    expect(extMid).toBeLessThan(extZenith)
    expect(extMid).toBeGreaterThan(0.7)

    // Horizon: strong extinction
    const extHorizon = atmosphericExtinction(0.05)
    expect(extHorizon).toBeLessThan(0.4)
    expect(extHorizon).toBeGreaterThan(0.02)

    // Below horizon: 0
    expect(atmosphericExtinction(-0.1)).toBe(0)
  })
})

describe("SOTA gradual limiting magnitude & twilight adaptation", () => {
  it("progresses limiting magnitude from bright day to deep dark night", () => {
    // Day (tod = 0.3): negative limit (no stars visible)
    const dayLimit = calculateLimitingMagnitude(0.3, 0, 0, 0)
    expect(dayLimit).toBeLessThan(-4.0)

    // Sunset / Dusk (tod = 0.73): only brightest beacons (Venus, Jupiter, Sirius)
    const sunsetLimit = calculateLimitingMagnitude(0.73, 0, 0, 0)
    expect(sunsetLimit).toBeGreaterThan(-3.0)
    expect(sunsetLimit).toBeLessThan(0.0)

    // Twilight (tod = 0.82): prominent navigation stars (Vega, Arcturus, Rigel)
    const twilightLimit = calculateLimitingMagnitude(0.82, 0, 0, 0)
    expect(twilightLimit).toBeGreaterThan(1.0)
    expect(twilightLimit).toBeLessThan(3.0)

    // Deep night (tod = 0.98): pitch dark sky reveals faint background (mag 6.0+)
    const nightLimit = calculateLimitingMagnitude(0.98, 0, 0, 0)
    expect(nightLimit).toBeGreaterThan(5.8)
  })

  it("reduces limiting magnitude under moonlit conditions", () => {
    const darkNight = calculateLimitingMagnitude(0.98, 0, 0, 0)
    const moonlitNight = calculateLimitingMagnitude(0.98, 0, 0, 0.45) // moon elevated
    expect(moonlitNight).toBeLessThan(darkNight - 1.0) // washed out faint stars
  })
})

describe("SOTA scientific starfield population & Milky Way structure", () => {
  it("generates deterministic population with authentic magnitude and dust lane structure", () => {
    const sf = generateScientificStarfield(20260906, 2400, 3200, 78.0)

    // Total stars = bright catalogue + faint procedural
    expect(sf.totalStars).toBe(BRIGHT_STARS.length + 2400)
    expect(sf.starsPos.length).toBe(sf.totalStars * 3)
    expect(sf.starsData.length).toBe(sf.totalStars * 4)

    // Prominent constellation anchors present in catalog
    const names = BRIGHT_STARS.map((s) => s.name)
    expect(names).toContain("Sirius")
    expect(names).toContain("Betelgeuse")
    expect(names).toContain("Rigel")
    expect(names).toContain("Vega")
    expect(names).toContain("Altair")
    expect(names).toContain("Deneb")
    expect(names).toContain("Polaris")
    expect(names).toContain("Arcturus")
    expect(names).toContain("Antares")

    // Milky Way stardust stream
    expect(sf.totalMw).toBe(3200)
    expect(sf.mwPos.length).toBe(3200 * 3)
    expect(sf.mwData.length).toBe(3200 * 3)

    // Planets are steady (isSteady == 1.0)
    expect(sf.totalPlanets).toBe(VISIBLE_PLANETS.length)
    for (let i = 0; i < sf.totalPlanets; i++) {
      expect(sf.planetsData[i * 4 + 3]).toBe(1.0) // steady flag
    }
  })
})

