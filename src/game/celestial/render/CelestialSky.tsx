import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { worldRT } from "../../runtime"
import { originRT } from "../../../world/origin"
import { GAME_TO_ECEF, equatorialToGame, universe, updateUniverse, type BodyState } from "../universe"
import { spaceRT, updateSpaceView } from "../spaceState"
import { AU, KM, PC } from "../scale"
import { BODY_FRAGMENT, BODY_VERTEX } from "./bodyShader"
import { DOT_VERTEX, MILKY_WAY_FRAGMENT, MILKY_WAY_VERTEX, CATALOGUE_STAR_FRAGMENT, RING_FRAGMENT, RING_VERTEX, STAR_FRAGMENT, STAR_VERTEX } from "./skyShaders"
import { celestialDrawRT } from "./drawState"
import { homeSky } from "../homeSky"
import { lightingRT } from "../../environment/Lighting"
import { earthCloudShift, earthTexture } from "./earthMaps"
import { solarExposure, solarTime } from "./solarSurface"
import { qualityRT } from "../../../state/qualityStore"
import { aberrate, aberrationUniform, syncAberrationUniform } from "./aberration"
import { ringRT } from "../rings/ringPhysics"

/**
 * Everything beyond the air, drawn behind the world: the Milky Way and the
 * real stars at infinity, then every body of the solar system as an exact,
 * ray-traced ball (bodyShader.ts) placed through the float64 view of
 * spaceState.ts.
 *
 * Distances: a body is drawn in its true direction at a distance squeezed to
 * fit inside the camera's range, and shrunk by the same factor, so its
 * apparent size and shape are exact while the GPU only sees small numbers.
 * The Sun writes its true ray-hit depth for nearby encounter occlusion; other
 * bodies are painted far to near, and the world
 * (ground, trees, the riders) is drawn over all of it.
 *
 * Everything here sits in the opaque queue (three.js draws that queue
 * before any transparent object, whatever the renderOrder) with explicit
 * blending, so it is all painted before the world.
 *
 * Order: deep sky (-14) → bodies far to near (-13.x) → home's sky dome (-10),
 * which fades as the air thins (Lighting.tsx) → Earth itself (-9), which is
 * below the horizon and must cover the dome once you are high enough to see it.
 */

const ASSET = (p: string): string => `/assets/${p}`

const loader = new THREE.TextureLoader()
const textureCache = new Map<string, THREE.Texture>()
const loadTexture = (url: string, srgbAsData = true): THREE.Texture => {
  let t = textureCache.get(url)
  if (!t) {
    t = loader.load(url)
    t.anisotropy = 8
    t.wrapS = THREE.RepeatWrapping
    // decoded by hand in the shaders (pow 2.2)
    if (!srgbAsData) t.colorSpace = THREE.SRGBColorSpace
    textureCache.set(url, t)
  }
  return t
}

const BLANK = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)
BLANK.needsUpdate = true

/** Atmosphere constants per body, in units of its radius. */
const airOf = (b: BodyState): { betaR: THREE.Vector3; hr: number; betaM: number; hm: number } | null => {
  const a = b.def.atmosphere
  if (!a) return null
  if (b.def.id === "earth") {
    // Earth's sea-level Rayleigh optical depth (0.046, 0.108, 0.265 at 680/550/440 nm)
    // over the game's 210 m scale height; Mie haze over ~40 m
    const hr = 210 / b.radius
    return { betaR: new THREE.Vector3(0.046, 0.108, 0.265).divideScalar(hr), hr, betaM: 0.025 / (40 / b.radius), hm: 40 / b.radius }
  }
  const hr = a.thickness / 9
  const tau = 0.06 + a.haze * 0.5
  return { betaR: new THREE.Vector3(...a.rayleigh).multiplyScalar(tau / hr), hr, betaM: (0.02 + a.haze * 0.3) / (hr * 0.4), hm: hr * 0.4 }
}

type Drawn = {
  state: BodyState
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  ring: THREE.Mesh | null
  ringMaterial: THREE.ShaderMaterial | null
  shell: number
  /** last on-screen radius in pixels */
  px: number
  dot: number
}

const _rel = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _sun = new THREE.Vector3()
const _m4 = new THREE.Matrix4()
const _m3 = new THREE.Matrix3()
const _rotM = new THREE.Matrix3()
const _xb = new THREE.Vector3(), _yb = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _local = new THREE.Vector3()

const gameToEcef = GAME_TO_ECEF

/** game → body-fixed rotation of a body (rows: its x, y and pole axes). */
const bodyBasis = (b: BodyState, out: THREE.Matrix3): THREE.Matrix3 => {
  if (b.def.id === "earth") return out.copy(gameToEcef)
  const z = b.pole
  if (b.def.id === "moon") {
    // tidally locked: longitude 0 faces Earth
    _xb.copy(universe.byId.get("earth")!.pos).sub(b.pos)
    _xb.addScaledVector(z, -_xb.dot(z)).normalize()
  } else {
    _xb.set(1, 0, 0)
    if (Math.abs(z.x) > 0.9) _xb.set(0, 1, 0)
    _xb.addScaledVector(z, -_xb.dot(z)).normalize()
    _q.setFromAxisAngle(z, b.spin)
    _xb.applyQuaternion(_q)
  }
  _yb.crossVectors(z, _xb)
  return out.set(_xb.x, _xb.y, _xb.z, _yb.x, _yb.y, _yb.z, z.x, z.y, z.z)
}

const makeRingProfile = (): THREE.Texture => loadTexture(ASSET("celestial/saturn_ring.png"))

export const CelestialSky = (): React.ReactElement => {
  const { camera, gl } = useThree()
  const calm = useMemo(() => typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null, [])
  const sys = useMemo(() => {
    updateUniverse(worldRT.timeOfDay, celestialDrawRT.date)
    const group = new THREE.Group()
    group.name = "celestial-sky"
    // ---- Milky Way
    const mwMaterial = new THREE.ShaderMaterial({
      vertexShader: MILKY_WAY_VERTEX, fragmentShader: MILKY_WAY_FRAGMENT,
      uniforms: { uMap: { value: BLANK }, uLocalToEq: { value: new THREE.Matrix3() }, uBright: { value: 1 }, uAberr: aberrationUniform },
      side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
    })
    const milkyWay = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mwMaterial)
    milkyWay.frustumCulled = false
    milkyWay.renderOrder = -14.5
    milkyWay.name = "milky-way"
    // ---- stars (filled once the catalogue arrives)
    const starMaterial = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX, fragmentShader: CATALOGUE_STAR_FRAGMENT,
      uniforms: { uObs: { value: new THREE.Vector3() }, uEqToLocal: { value: new THREE.Matrix3() }, uPx: { value: Math.min(window.devicePixelRatio, 2) }, uBright: { value: 1 }, uMinI: { value: Math.pow(10, -0.4 * 7.5) }, uAberr: aberrationUniform },
      // premultiplied: the shader's light is added as is (ONE, ONE). Unpremultiplied
      // additive blending weighs colour by the alpha it writes, 0 here, which
      // left every catalogue star unseen
      transparent: false, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true, fog: false,
    })
    const stars = new THREE.Points(new THREE.BufferGeometry(), starMaterial)
    stars.frustumCulled = false
    stars.renderOrder = -14.4
    stars.name = "catalogue-stars"
    stars.visible = false
    // ---- bodies
    const proxy = new THREE.SphereGeometry(1, 40, 20)
    const ringTex = makeRingProfile()
    const drawn: Drawn[] = []
    for (const def of [...universe.bodies]) drawn.push(makeBody(def, proxy, ringTex))
    for (const d of drawn) {
      group.add(d.mesh)
      if (d.ring) group.add(d.ring)
    }
    // ---- dots for bodies too small to resolve
    const dotGeo = new THREE.BufferGeometry()
    dotGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(drawn.length * 3), 3))
    dotGeo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(drawn.length * 3), 3))
    dotGeo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(drawn.length), 1))
    const dots = new THREE.Points(dotGeo, new THREE.ShaderMaterial({
      vertexShader: DOT_VERTEX, fragmentShader: STAR_FRAGMENT.replace("vColor * vI * a", "vColor * a").replace("varying float vI;", ""),
      uniforms: { uAberr: aberrationUniform },
      transparent: false, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true, fog: false,
    }))
    dots.frustumCulled = false
    dots.renderOrder = -13.95
    // ---- the Sun's glare
    const glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glareTexture(), color: "#fff3df", transparent: false, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
    glare.renderOrder = -11
    glare.frustumCulled = false
    group.add(milkyWay, stars, dots, glare)
    return { group, milkyWay, mwMaterial, stars, starMaterial, drawn, dots, glare }
  }, [])

  useEffect(() => {
    // the real sky, loaded off the critical path
    sys.mwMaterial.uniforms.uMap.value = loadTexture(ASSET("celestial/milkyway_4k.jpg"))
    let alive = true
    void fetch(ASSET("celestial/stars.bin")).then((r) => r.arrayBuffer()).then((buf) => {
      if (!alive) return
      const f = new Float32Array(buf)
      const n = f.length / 5
      const pos = new Float32Array(n * 3), abs = new Float32Array(n), ci = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        pos[i * 3] = f[i * 5]; pos[i * 3 + 1] = f[i * 5 + 1]; pos[i * 3 + 2] = f[i * 5 + 2]
        abs[i] = f[i * 5 + 3]; ci[i] = f[i * 5 + 4]
      }
      const g = sys.stars.geometry
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
      g.setAttribute("aAbs", new THREE.BufferAttribute(abs, 1))
      g.setAttribute("aCI", new THREE.BufferAttribute(ci, 1))
      sys.stars.visible = true
      celestialDrawRT.stars = n
    }).catch((e) => console.warn("[celestial] star catalogue", e))
    return () => {
      alive = false
      sys.group.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        if (m.material) (m.material as THREE.Material).dispose()
      })
    }
  }, [sys])

  useFrame(() => {
    const persp = camera as THREE.PerspectiveCamera
    const t = spaceRT.frozenTime ?? worldRT.timeOfDay
    updateUniverse(t, celestialDrawRT.date)
    updateSpaceView(camera.position)
    syncAberrationUniform()
    const thin = spaceRT.thin
    const onEarth = spaceRT.realm === "earth"
    homeSky.stars.value = onEarth ? 1 - THREE.MathUtils.smoothstep(thin, 0.55, 0.9) : 0
    homeSky.clouds.value = onEarth ? 1 - THREE.MathUtils.smoothstep(spaceRT.weatherAltitude, 260, 700) : 0
    // ---- deep sky orientation: equatorial → local axes
    _rotM.setFromMatrix4(_m4.makeRotationFromQuaternion(spaceRT.rotInv))
    _m3.multiplyMatrices(_rotM, equatorialToGame)
    sys.starMaterial.uniforms.uEqToLocal.value.copy(_m3)
    sys.mwMaterial.uniforms.uLocalToEq.value.copy(_m3).transpose()
    // the observer among the stars (parsecs, equatorial): the Sun's family is a point at this scale
    const sun = universe.byId.get("sun")!
    _rel.copy(spaceRT.eye).sub(sun.pos)
    _local.copy(_rel).applyMatrix3(_m3.copy(equatorialToGame).transpose()).divideScalar(PC)
    sys.starMaterial.uniforms.uObs.value.copy(_local).add(celestialDrawRT.galactic)
    // stars and the Milky Way are hidden by daylight through the sky dome; in
    // space they are dimmed a little when the sunlit Earth fills the view
    const sky = 0.25 + 0.75 * thin
    // exposure, as a camera sets it for its subject: with the sunlit Earth
    // filling the view the faint stars drop out; look away from it, or be over
    // the night side, and the whole sky comes back
    const earthD = sys.drawn.find((d) => d.state.def.id === "earth")
    let earthFill = earthD && earthD.mesh.visible ? THREE.MathUtils.smoothstep(earthD.px / Math.max(1, gl.domElement.height * 0.5), 0.3, 1.6) : 0
    if (earthFill > 0 && earthD) {
      // only while the Earth is actually in the view: with it behind her (the
      // launch of a journey) the whole sky ahead stays as bright as it is
      _rel.copy(earthD.state.pos).sub(spaceRT.eye)
      const dist = _rel.length()
      _dir.copy(_rel).divideScalar(dist).applyQuaternion(spaceRT.rotInv)
      aberrate(_dir)
      camera.getWorldDirection(_sun)
      const off = Math.acos(THREE.MathUtils.clamp(_dir.dot(_sun), -1, 1)) - Math.asin(Math.min(1, earthD.state.radius / dist))
      const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2) * Math.hypot(1, persp.aspect))
      earthFill *= 1 - THREE.MathUtils.smoothstep(off, half, half + 0.25)
    }
    const glare = onEarth ? earthFill * lightingRT.lit : 0
    // the limiting magnitude falls from ~7.5 (dark, adapted) to ~2 with the
    // sunlit Earth filling the view: then only the brightest few dozen stars,
    // and none of the Milky Way's faint band
    sys.starMaterial.uniforms.uBright.value = (1.3 + 0.9 * thin) * sky * (1 - 0.3 * glare)
    sys.starMaterial.uniforms.uMinI.value = Math.pow(10, -0.4 * (7.5 - 5.5 * glare))
    sys.mwMaterial.uniforms.uBright.value = 0.55 * sky * (1 - 0.85 * glare)
    sys.milkyWay.position.copy(camera.position)
    sys.stars.position.copy(camera.position)
    sys.dots.position.copy(camera.position)

    // ---- bodies
    const far = persp.far
    const r0 = far * 0.12, rmax = far * 0.4
    const pxPerRad = (gl.domElement.height || 720) / (2 * Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2))
    const dotPos = sys.dots.geometry.getAttribute("position") as THREE.BufferAttribute
    const dotCol = sys.dots.geometry.getAttribute("aColor") as THREE.BufferAttribute
    const dotSize = sys.dots.geometry.getAttribute("aSize") as THREE.BufferAttribute
    const order: Array<{ d: Drawn; dist: number }> = []
    for (let i = 0; i < sys.drawn.length; i++) {
      const d = sys.drawn[i]
      const b = d.state
      _rel.copy(b.pos).sub(spaceRT.eye)
      const dist = _rel.length()
      _dir.copy(_rel).divideScalar(dist).applyQuaternion(spaceRT.rotInv)
      // at journey speed each world is seen where aberration puts it, as the stars are
      aberrate(_dir)
      const r = dist < r0 ? dist : r0 + (rmax - r0) * (1 - Math.exp(-(dist - r0) / (rmax - r0)))
      const s = r / dist
      const radius = b.radius * s
      const angular = Math.asin(Math.min(1, b.radius / dist))
      d.px = angular * pxPerRad
      // the render-space centre (the group lives in the world root: logical coordinates)
      d.mesh.position.copy(camera.position).addScaledVector(_dir, r)
      d.mesh.scale.setScalar(radius * d.shell * 1.002)
      const u = d.material.uniforms
      u.uRadius.value = radius
      u.uTrueRadius.value = b.radius
      u.uSolarDetail.value = qualityRT.level === "low" ? 0 : 1
      u.uSolarTime.value = solarTime(performance.now() / 1000, calm?.matches ?? false)
      _sun.copy(sun.pos).sub(b.pos).normalize().applyQuaternion(spaceRT.rotInv)
      if (b.def.id === "sun") _sun.copy(_dir).negate()
      u.uSun.value.copy(_sun)
      bodyBasis(b, _m3)
      u.uToBody.value.multiplyMatrices(_m3, _rotM.setFromMatrix4(_m4.makeRotationFromQuaternion(spaceRT.rot)))
      const sunDist = b.def.id === "sun" ? AU : b.pos.distanceTo(sun.pos)
      // the eye adapts, as a spacecraft camera is exposed for its subject:
      // Neptune gets a thousandth of Earth's sunlight but is not drawn black,
      // only a little dimmer and cooler
      u.uLight.value = b.def.id === "sun" ? solarExposure(d.px) : Math.pow(AU / sunDist, 0.22)
      u.uTime.value = performance.now() / 1000
      // resolved: fade the ball in over the dot as it grows past a pixel or two
      const disc = THREE.MathUtils.smoothstep(d.px, 0.7, 2.2)
      let fade = disc
      if (b.def.id === "earth") {
        // home's own ground and sky own the low air
        fade *= spaceRT.realm === "earth" ? THREE.MathUtils.smoothstep(spaceRT.skyAltitude, 140, 520) : 1
        u.uSkyWeight.value = THREE.MathUtils.smoothstep(thin, 0.55, 0.97)
        u.uCloudShift.value = (performance.now() * 0.0000006) % 1
      }
      u.uFade.value = fade
      d.mesh.visible = fade > 0.003 && d.px > 0.25
      d.mesh.renderOrder = b.def.id === "earth" && spaceRT.realm === "earth" ? -9 : -13.9 + Math.min(0.85, 0.85 * (1 - Math.min(1, Math.log10(1 + dist / KM) / 11)))
      if (d.ring && d.ringMaterial) {
        d.ring.visible = d.mesh.visible
        d.ring.position.copy(d.mesh.position)
        d.ring.scale.setScalar(radius)
        _xb.copy(b.pole).applyQuaternion(spaceRT.rotInv)
        d.ring.quaternion.setFromUnitVectors(_yb.set(0, 0, 1), _xb)
        d.ring.renderOrder = d.mesh.renderOrder + 0.001
        const ru = d.ringMaterial.uniforms
        ru.uPlanet.value.copy(d.mesh.position).sub(_local.set(originRT.x, 0, originRT.z))
        ru.uRadius.value = radius
        ru.uSun.value.copy(_sun)
        ru.uNormal.value.copy(_xb)
        ru.uLight.value = u.uLight.value
        ru.uFade.value = fade
        // the view's place over the ring plane, for the near dissolve into the 3D ice
        if (b.def.id === "saturn" && ringRT.sheet > 0.003) {
          _rel.copy(spaceRT.eye).sub(b.pos).applyQuaternion(spaceRT.rotInv)
          _rel.applyQuaternion(_q.copy(d.ring.quaternion).invert())
          ru.uCamPlane.value.set(_rel.x / b.radius, _rel.y / b.radius)
          // the disc gives way within the true-scale sheet RingField draws round her
          ru.uNear.value = (ringRT.sheetR / b.radius) * ringRT.sheet
        } else ru.uNear.value = 0
      }
      // a point of light for what is too small to see as a disc
      const vis = 1 - disc
      const phase = b.def.id === "sun" ? 1 : 0.5 - 0.5 * _sun.dot(_dir)
      const flux = b.def.id === "sun" ? 50 : b.def.albedo * phase * Math.pow(b.radius / dist, 2) * Math.pow(AU / sunDist, 2) * 1.6e9
      const bright = Math.min(2.2, Math.pow(flux, 0.42) * 0.85) * vis * (b.def.id === "earth" && spaceRT.realm === "earth" && spaceRT.earthAltitude < 2e5 ? 0 : 1)
      dotPos.setXYZ(i, _dir.x, _dir.y, _dir.z)
      dotCol.setXYZ(i, b.def.color[0] * 0.5 + 0.5 * bright, b.def.color[1] * 0.5 + 0.5 * bright, b.def.color[2] * 0.5 + 0.5 * bright)
      if (bright < 0.02) dotCol.setXYZ(i, 0, 0, 0)
      else dotCol.setXYZ(i, (0.55 + b.def.color[0] * 0.45) * bright, (0.55 + b.def.color[1] * 0.45) * bright, (0.55 + b.def.color[2] * 0.45) * bright)
      dotSize.setX(i, (2.2 + Math.min(2.5, bright * 1.5)) * Math.min(window.devicePixelRatio, 2))
      order.push({ d, dist })
      if (b.def.id === "sun") {
        // glare: a soft bloom around the disc, wider in the clear vacuum
        sys.glare.position.copy(d.mesh.position)
        const size = r * Math.tan(THREE.MathUtils.degToRad(5 + 7 * thin))
        sys.glare.scale.set(size, size, 1)
        ;(sys.glare.material as THREE.SpriteMaterial).opacity = 0.55 * thin
        sys.glare.visible = thin > 0.02
      }
    }
    dotPos.needsUpdate = true
    dotCol.needsUpdate = true
    dotSize.needsUpdate = true
    celestialDrawRT.frame++
    celestialDrawRT.visible = order.filter((o) => o.d.mesh.visible).length
  })

  return <primitive object={sys.group} />
}

const makeBody = (b: BodyState, proxy: THREE.SphereGeometry, ringTex: THREE.Texture): Drawn => {
  const def = b.def
  const air = airOf(b)
  const shell = def.id === "sun" ? 1.18 : air ? (def.id === "earth" ? 1.022 : 1 + (def.atmosphere?.thickness ?? 0)) : 1
  const kind = def.kind === "star" ? 3 : def.id === "earth" ? 1 : def.id === "venus" || def.id === "titan" ? 4 : def.kind === "gas" || def.kind === "ice" ? 2 : 0
  const isEarth = def.id === "earth"
  const material = new THREE.ShaderMaterial({
    vertexShader: BODY_VERTEX,
    fragmentShader: BODY_FRAGMENT,
    uniforms: {
      uKind: { value: kind }, uRadius: { value: 1 }, uTrueRadius: { value: b.radius }, uSolarTime: { value: 0 }, uSolarDetail: { value: 1 }, uOblate: { value: def.oblate ?? 0 }, uShell: { value: shell },
      uToBody: { value: new THREE.Matrix3() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uLight: { value: 1 },
      uTint: { value: new THREE.Vector3(...def.color) }, uAlbedo: { value: def.albedo },
      uMap: { value: isEarth ? earthTexture("day") : BLANK }, uHasMap: { value: def.map || isEarth ? 1 : 0 },
      uGrey: { value: ["io", "europa", "callisto", "enceladus", "titan"].includes(def.id) ? 1 : 0 },
      uFade: { value: 1 }, uTime: { value: 0 },
      uBetaR: { value: air?.betaR ?? new THREE.Vector3() }, uHR: { value: air?.hr ?? 1 }, uBetaM: { value: air?.betaM ?? 0 }, uHM: { value: air?.hm ?? 1 },
      uHazeColor: { value: new THREE.Vector3(...(def.atmosphere?.hazeColor ?? [1, 1, 1])) }, uHaze: { value: def.atmosphere?.haze ?? 0 },
      uSkyWeight: { value: 1 },
      uNight: { value: isEarth ? earthTexture("night") : BLANK }, uClouds: { value: isEarth ? earthTexture("clouds") : BLANK },
      uNormal: { value: isEarth ? earthTexture("normal") : BLANK }, uWater: { value: isEarth ? earthTexture("water") : BLANK },
      uCloudShift: isEarth ? earthCloudShift : { value: 0 }, uHomeCloud: { value: 0 },
      // Earth's airglow: the 557.7 nm oxygen layer, peak ~95 km, ~9 km thick (radius units)
      uAirglow: { value: isEarth ? new THREE.Vector3(1 + 95 / 6371, 3.8 / 6371, 1) : new THREE.Vector3(0, 1, 0) },
      uRingMap: { value: def.rings?.style === "saturn" ? ringTex : BLANK },
      uRing: { value: def.rings?.style === "saturn" ? new THREE.Vector2(def.rings.inner / def.radius, def.rings.outer / def.radius) : new THREE.Vector2(0, 0) },
    },
    side: THREE.BackSide, transparent: false, depthTest: def.id === "sun", depthFunc: THREE.AlwaysDepth, depthWrite: def.id === "sun", fog: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  })
  const mesh = new THREE.Mesh(proxy, material)
  mesh.name = `body:${def.id}`
  mesh.frustumCulled = false
  mesh.visible = false
  // planet maps arrive when the body is first drawn; until then the ball
  // shows its mean colour (uHasMap 0)
  if (def.map && !isEarth) {
    material.uniforms.uHasMap.value = 0
    let asked = false
    mesh.onBeforeRender = () => {
      if (asked) return
      asked = true
      loader.load(ASSET(def.map!), (t) => {
        t.anisotropy = 8
        t.wrapS = THREE.RepeatWrapping
        material.uniforms.uMap.value = t
        material.uniforms.uHasMap.value = 1
      })
    }
  }
  let ring: THREE.Mesh | null = null
  let ringMaterial: THREE.ShaderMaterial | null = null
  if (def.rings) {
    ringMaterial = new THREE.ShaderMaterial({
      vertexShader: RING_VERTEX, fragmentShader: RING_FRAGMENT,
      uniforms: {
        uRingMap: { value: def.rings.style === "saturn" ? ringTex : BLANK }, uHasMap: { value: def.rings.style === "saturn" ? 1 : 0 },
        uRing: { value: new THREE.Vector2(def.rings.inner / def.radius, def.rings.outer / def.radius) },
        uPlanet: { value: new THREE.Vector3() }, uRadius: { value: 1 }, uOblate: { value: def.oblate ?? 0 },
        uSun: { value: new THREE.Vector3() }, uNormal: { value: new THREE.Vector3() }, uLight: { value: 1 }, uFade: { value: 1 },
        uStyle: { value: def.rings.style === "uranus" ? 1 : def.rings.style === "neptune" ? 2 : def.rings.style === "jupiter" ? 3 : 0 },
        uCamPlane: { value: new THREE.Vector2() },
        uNear: { value: 0 },
      },
      side: THREE.DoubleSide, transparent: false, depthTest: false, depthWrite: false, fog: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    })
    ring = new THREE.Mesh(new THREE.RingGeometry(def.rings.inner / def.radius, def.rings.outer / def.radius, 256, 1), ringMaterial)
    ring.frustumCulled = false
    ring.visible = false
    ring.name = `rings:${def.id}`
  }
  return { state: b, mesh, material, ring, ringMaterial, shell, px: 0, dot: 0 }
}

let glare: THREE.CanvasTexture | null = null
const glareTexture = (): THREE.CanvasTexture => {
  if (glare) return glare
  const c = document.createElement("canvas")
  c.width = c.height = 256
  const ctx = c.getContext("2d")!
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  g.addColorStop(0, "rgba(255,250,240,0.9)")
  g.addColorStop(0.04, "rgba(255,244,225,0.55)")
  g.addColorStop(0.15, "rgba(255,226,190,0.12)")
  g.addColorStop(0.45, "rgba(255,210,170,0.03)")
  g.addColorStop(1, "rgba(255,200,160,0)")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  glare = new THREE.CanvasTexture(c)
  glare.colorSpace = THREE.SRGBColorSpace
  return glare
}
