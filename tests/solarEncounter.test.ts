import { describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import { buildSolarFilaments, createSolarFilament, sampleSolarStrand, SOLAR_INDICES_PER_STRAND, SOLAR_STRANDS } from "../src/game/celestial/wonders/solarFilaments"
import { createCloseEncounters } from "../src/game/celestial/wonders/closeEncounters"
import { makeSite, sitePoint, wonderFor } from "../src/game/celestial/wonders/wonderWorlds"

describe("SDO-inspired solar field echoes", () => {
  it("builds deterministic unequal open strands, not repeated circular hoops", () => {
    const a = buildSolarFilaments(0), b = buildSolarFilaments(0), c = buildSolarFilaments(2)
    expect(a.getAttribute("position").array).toEqual(b.getAttribute("position").array)
    expect(a.getAttribute("position").array).not.toEqual(c.getAttribute("position").array)
    for (const attribute of Object.values(a.attributes)) expect([...attribute.array].every(Number.isFinite)).toBe(true)
    expect(a.index!.count).toBe(SOLAR_STRANDS * SOLAR_INDICES_PER_STRAND)
    expect(new Set(a.getAttribute("aBody").array)).toEqual(new Set([0, 1]))
    const offsets = a.getAttribute("aOffset"), bodies = a.getAttribute("aBody")
    let sheetWidth = 0, threadWidth = 0
    for (let i = 0; i < offsets.count; i++) {
      const width = Math.hypot(offsets.getX(i), offsets.getY(i), offsets.getZ(i))
      if (bodies.getX(i) > 0.5) sheetWidth = Math.max(sheetWidth, width)
      else threadWidth = Math.max(threadWidth, width)
    }
    expect(sheetWidth).toBeGreaterThan(threadWidth * 2)
    expect(a.boundingSphere!.radius).toBeLessThan(110)
    const start = new THREE.Vector3(), end = new THREE.Vector3()
    for (let i = 0; i < SOLAR_STRANDS; i++) {
      sampleSolarStrand(0, i, 0, start)
      sampleSolarStrand(0, i, 1, end)
      expect(start.distanceTo(end)).toBeGreaterThan(30)
    }
    a.dispose(); b.dispose(); c.dispose()
  })
  it("uses bounded quality ranges, calm shader response and depth-tested unfogged materials", () => {
    const field = createSolarFilament(1)
    const core = field.root.getObjectByName("plasma-threads") as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
    const halo = field.root.getObjectByName("plasma-thread-haze") as THREE.Mesh
    field.update(20, 0.7, true, "low")
    expect(core.geometry.drawRange.count).toBe(12 * SOLAR_INDICES_PER_STRAND)
    expect(halo.visible).toBe(false)
    expect(core.material.uniforms.uCalm.value).toBe(1)
    expect(core.material.uniforms.uWake.value).toBe(0.7)
    expect(core.material.depthTest).toBe(true)
    expect(core.material.blending).toBe(THREE.AdditiveBlending)
    expect(core.material.fog).toBe(false)
    field.update(21, 0, false, "high")
    expect(core.geometry.drawRange.count).toBe(SOLAR_STRANDS * SOLAR_INDICES_PER_STRAND)
    expect(halo.visible).toBe(true)
    const dispose = vi.fn()
    core.geometry.addEventListener("dispose", dispose)
    field.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
  it("keeps swept musical passes reachable at safe approach, and reuses meshes on revisit", () => {
    const touch = vi.fn(), field = createCloseEncounters(touch)
    const at = new THREE.Vector3(3e10, 1e8, -2e10)
    const radius = 1e6
    const site = makeSite(wonderFor("sun")!, {
      pos: at.clone().add(new THREE.Vector3(0, 0, -3.5 * radius)), radius,
      pole: new THREE.Vector3(0, 1, 0), def: { name: "Sun", kind: "star" },
    }, at, () => false)
    field.bind(site)
    const centre = sitePoint(site, -150, 0, 260, new THREE.Vector3())
    const mount = centre.clone().addScaledVector(site.fwd, 200)
    const prev = centre.clone().addScaledVector(site.fwd, -200)
    expect(centre.distanceTo(site.body.pos)).toBeGreaterThan(radius * 3.49)
    const tick = { dt: 0.05, time: 0, calm: true, halfH: 360, mount, prev, speed: 8000 }
    field.update(tick)
    expect(touch).toHaveBeenCalledExactlyOnceWith("sun", 0)
    tick.time = 0.1; field.update(tick)
    expect(touch).toHaveBeenCalledOnce()
    const old = field.root.getObjectByName("solar-field-echo-0")
    field.bind(null); tick.time = 8; field.update(tick)
    expect(touch).toHaveBeenCalledOnce()
    field.bind(site); field.update(tick)
    expect(field.root.getObjectByName("solar-field-echo-0")).toBe(old)
    expect(touch).toHaveBeenCalledTimes(2)
    field.dispose()
  })
})
