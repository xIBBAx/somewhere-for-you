import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { avatarRT } from "../../game/runtime"
import { FAR_HALF, FAR_HOLE, FAR_SPACING, FAR_TREE_START, FAR_TREE_STRIDE, FAR_VERTS, farCentre, type FarTerrainData } from "../farTerrain"
import type { FarRequest } from "../farTerrain.worker"
import { WORLD_NOISE_GLSL, originUniforms } from "../origin"
import { AERIAL_LOOK_GLSL } from "./aerialLook"
import { landsRT } from "./HorizonLands"
import { spaceRT } from "../../game/celestial/spaceState"
import { vegetationUniforms } from "./vegetationMaterials"

/**
 * The horizon: distant hills, forests and lakes beyond the streamed chunks.
 *
 * One mesh of ~3k quads (a single draw call) built off the main thread from
 * the same deterministic terrain and biome functions as the chunks. It is cut
 * away around the player, where the detailed chunks always exist, and sits
 * a little below them wherever both overlap, so the detailed world always
 * wins. Forested ground is mottled into crown clumps in the shader; at the
 * distances where it shows, through the haze, that reads as woodland.
 */

/** Shared by the material and the per-build depth texture. */
const farUniforms = {
  uFarDepth: { value: null as THREE.DataTexture | null },
  /** 0..1 while the horizon lands are drawn beyond: the far terrain then ends
   * on a circle round the player and takes the lands' look toward it */
  uFarEdge: { value: 0 },
}
/** Where, from the player, the far terrain hands over to the horizon lands
 * (inside the far grid's guaranteed reach of FAR_HALF − FAR_SNAP/√2). */
export const FAR_EDGE_FROM = 480
export const FAR_EDGE_TO = 700

const farMaterial = (): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 })
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uOriginWrap: originUniforms.uOriginWrap, uPlayerRender: vegetationUniforms.uPlayerRender, uFarHole: { value: FAR_HOLE }, ...farUniforms })
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aKind;\nvarying vec2 vKind;\nvarying vec3 vFarWorld;\nvarying vec2 vFarLocal;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvKind = aKind;\nvFarWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvFarLocal = transformed.xz;")
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
${WORLD_NOISE_GLSL}
${AERIAL_LOOK_GLSL}
uniform vec3 uPlayerRender;
uniform float uFarHole;
uniform float uFarEdge;
uniform sampler2D uFarDepth;
varying vec2 vKind;
varying vec3 vFarWorld;
varying vec2 vFarLocal;
// Water depth from the grid as a smooth cubic B-spline (four bilinear taps,
// GPU Gems 2 ch. 20): a pond a few vertices wide gets a rounded shore that
// follows the land, where straight interpolation drew a small polygon.
float farDepth(vec2 local) {
  const float N = ${FAR_VERTS.toFixed(1)};
  vec2 st = (local + ${FAR_HALF.toFixed(1)}) / ${FAR_SPACING.toFixed(1)};
  vec2 i = floor(st), f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 t0 = (i - 1.0 + w1 / g0 + 0.5) / N, t1 = (i + 1.0 + w3 / g1 + 0.5) / N;
  return g0.y * (g0.x * texture2D(uFarDepth, t0).r + g1.x * texture2D(uFarDepth, vec2(t1.x, t0.y)).r)
       + g1.y * (g0.x * texture2D(uFarDepth, vec2(t0.x, t1.y)).r + g1.x * texture2D(uFarDepth, t1).r);
}`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
  // the streamed chunks own everything near the player
  float farR = length(vFarWorld.xz - uPlayerRender.xz);
  if (farR < uFarHole) discard;
  // and the horizon lands everything beyond the circle, not a square's edge
  if (farR > ${FAR_EDGE_TO.toFixed(1)} + (1.0 - uFarEdge) * 2000.0) discard;
  float farEdgeW = uFarEdge * smoothstep(${FAR_EDGE_FROM.toFixed(1)}, ${FAR_EDGE_TO.toFixed(1)}, farR);`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  // crowns seen from afar: clumps of light tops and dark gaps between them,
  // eased toward the horizon lands' gentler woods where they take over
  float crowns = wNoise(vFarWorld.xz, 72.0) * 0.6 + wNoise(vFarWorld.xz, 190.0) * 0.4;
  float landsCrowns = wNoise(vFarWorld.xz, 140.0) * 0.6 + wNoise(vFarWorld.xz, 520.0) * 0.4;
  diffuseColor.rgb *= mix(1.0, mix(0.62 + crowns * 0.7, 0.78 + landsCrowns * 0.4, farEdgeW), vKind.x);
  // lakes with clean, irregular shores (vertex colours are the land's own)
  float farPond = aerialShore(0.5 + farDepth(vFarLocal) * 0.5, vFarWorld.xz, 24.0);
  // open ground drifts like the meadows near home
  diffuseColor.rgb *= mix(meadowHue(vFarWorld.xz), vec3(1.0), max(max(vKind.x, farPond), farEdgeW));
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.106, 0.276, 0.389), vec3(0.045, 0.1, 0.14), farEdgeW), farPond);`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, mix(0.12, 0.1, farEdgeW), farPond);")
  }
  m.customProgramCacheKey = () => "far-terrain-v4"
  return m
}

/** The grid's water depths (kinds.y) as a half-float texture for farDepth(). */
const buildDepthTexture = (data: FarTerrainData): THREE.DataTexture => {
  const n = FAR_VERTS
  const half = new Uint16Array(n * n)
  for (let k = 0; k < n * n; k++) half[k] = THREE.DataUtils.toHalfFloat(Math.max(-60, Math.min(60, data.kinds[k * 2 + 1])))
  const t = new THREE.DataTexture(half, n, n, THREE.RedFormat, THREE.HalfFloatType)
  t.magFilter = t.minFilter = THREE.LinearFilter
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

/**
 * Distant crowns: a rounded mass for broadleaves and a narrow cone for
 * conifers, each a few dozen triangles. Only drawn beyond the streamed trees.
 */
const FAR_TREE_END = 640
const crownMaterial = (): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 })
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uPlayerRender: vegetationUniforms.uPlayerRender, uTreeStart: { value: FAR_TREE_START }, uTreeEnd: { value: FAR_TREE_END } })
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCrownWorld;\nvarying float vCrownUp;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvCrownWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\nvCrownUp = position.y;")
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uPlayerRender;\nuniform float uTreeStart;\nuniform float uTreeEnd;\nvarying vec3 vCrownWorld;\nvarying float vCrownUp;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
  float crownD = length(vCrownWorld.xz - uPlayerRender.xz);
  if (crownD < uTreeStart) discard;
  // thin out before the haze greys single crowns into blobs on the skyline
  float crownKeep = 1.0 - smoothstep(uTreeEnd - 160.0, uTreeEnd, crownD);
  if (crownKeep < fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))))) discard;`)
      // the shaded underside of a crown, and its sunlit top
      .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb *= 0.62 + 0.5 * smoothstep(-0.5, 0.5, vCrownUp);")
  }
  m.customProgramCacheKey = () => "far-crowns-v2"
  return m
}

const makeCrowns = (geometry: THREE.BufferGeometry, name: string): THREE.InstancedMesh => {
  const mesh = new THREE.InstancedMesh(geometry, crownMaterial(), 9000)
  mesh.name = name
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(9000 * 3), 3)
  return mesh
}

const crownMatrix = new THREE.Matrix4()
const crownPos = new THREE.Vector3()
const crownScale = new THREE.Vector3()
const crownQ = new THREE.Quaternion()
const crownColor = new THREE.Color()
const fillCrowns = (data: FarTerrainData, broad: THREE.InstancedMesh, conifer: THREE.InstancedMesh): void => {
  let nb = 0, nc = 0
  for (let t = 0; t < data.treeCount; t++) {
    const o = t * FAR_TREE_STRIDE
    const r = data.trees[o + 3], h = data.trees[o + 4]
    const isConifer = data.trees[o + 5] > 0.5
    // crowns are unit shapes centred at the origin (y −0.5 … 0.5)
    // from afar a tree is one mass down to the ground: a gap under the crown
    // read as a floating balloon
    if (isConifer) { crownPos.set(data.trees[o], data.trees[o + 1] + h * 0.5, data.trees[o + 2]); crownScale.set(r, h, r) }
    else { crownPos.set(data.trees[o], data.trees[o + 1] + h * 0.42, data.trees[o + 2]); crownScale.set(r * 1.15, h * 0.84, r * 1.15) }
    // turned by where it stands, not its index in this grid, so a crown keeps
    // its turn when the grid re-centres
    const wx = Math.round((data.cx + data.trees[o]) * 4), wz = Math.round((data.cz + data.trees[o + 2]) * 4)
    crownQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ((Math.imul(wx, 73856093) ^ Math.imul(wz, 19349663)) >>> 0) / 4294967296 * 6.283)
    crownMatrix.compose(crownPos, crownQ, crownScale)
    crownColor.setRGB(data.trees[o + 6], data.trees[o + 7], data.trees[o + 8])
    const mesh = isConifer ? conifer : broad
    const i = isConifer ? nc++ : nb++
    mesh.setMatrixAt(i, crownMatrix)
    mesh.setColorAt(i, crownColor)
  }
  for (const [mesh, n] of [[broad, nb], [conifer, nc]] as const) {
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.position.set(data.cx, 0, data.cz)
    mesh.updateMatrix()
    mesh.visible = n > 0
  }
}

const makeIndex = (): THREE.BufferAttribute => {
  const n = FAR_VERTS
  const index = new Uint32Array((n - 1) * (n - 1) * 6)
  let o = 0
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1
    index[o++] = a; index[o++] = c; index[o++] = b
    index[o++] = b; index[o++] = c; index[o++] = d
  }
  return new THREE.BufferAttribute(index, 1)
}

const buildGeometry = (data: FarTerrainData, index: THREE.BufferAttribute): THREE.BufferGeometry => {
  const n = FAR_VERTS
  const pos = new Float32Array(n * n * 3)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i
    pos[k * 3] = -FAR_HALF + i * FAR_SPACING
    pos[k * 3 + 1] = data.heights[k]
    pos[k * 3 + 2] = -FAR_HALF + j * FAR_SPACING
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  g.setAttribute("color", new THREE.BufferAttribute(data.colors, 3))
  g.setAttribute("aKind", new THREE.BufferAttribute(data.kinds, 2))
  g.setIndex(index)
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

export const farTerrainRT = { cx: Number.NaN, cz: Number.NaN, builds: 0, lastMs: 0, crowns: 0 }

export const FarTerrain = (): React.ReactElement => {
  const sys = useMemo(() => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), farMaterial())
    mesh.name = "far-terrain"
    mesh.visible = false
    mesh.matrixAutoUpdate = false
    mesh.receiveShadow = false
    mesh.castShadow = false
    // drawn before the near world so it never wins a depth tie
    mesh.renderOrder = -1
    const group = new THREE.Group()
    group.name = "far-landscape"
    const broad = makeCrowns(new THREE.IcosahedronGeometry(0.5, 1), "far-crowns-broadleaf")
    const conifer = makeCrowns(new THREE.ConeGeometry(0.5, 1, 7, 1), "far-crowns-conifer")
    group.add(mesh, broad, conifer)
    return { group, mesh, broad, conifer, index: makeIndex(), worker: null as Worker | null, pending: 0, sent: 0, nextId: 1, cx: Number.NaN, cz: Number.NaN }
  }, [])

  useEffect(() => {
    const worker = new Worker(new URL("../farTerrain.worker.ts", import.meta.url), { type: "module" })
    sys.worker = worker
    worker.onmessage = (event: MessageEvent<{ id: number; data?: FarTerrainData; error?: string }>) => {
      const { id, data, error } = event.data
      if (id !== sys.pending) return
      sys.pending = 0
      if (!data) { console.warn("[world] far terrain failed", error); return }
      const old = sys.mesh.geometry
      sys.mesh.geometry = buildGeometry(data, sys.index)
      old.dispose()
      farUniforms.uFarDepth.value?.dispose()
      farUniforms.uFarDepth.value = buildDepthTexture(data)
      sys.mesh.position.set(data.cx, 0, data.cz)
      sys.mesh.updateMatrix()
      sys.mesh.visible = true
      fillCrowns(data, sys.broad, sys.conifer)
      farTerrainRT.crowns = data.treeCount
      sys.cx = data.cx; sys.cz = data.cz
      farTerrainRT.cx = data.cx; farTerrainRT.cz = data.cz
      farTerrainRT.builds++
      farTerrainRT.lastMs = performance.now() - sys.sent
    }
    return () => {
      worker.terminate()
      sys.worker = null
      farUniforms.uFarDepth.value?.dispose()
      farUniforms.uFarDepth.value = null
      for (const m of [sys.mesh, sys.broad, sys.conifer]) {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
    }
  }, [sys])

  useFrame(() => {
    farUniforms.uFarEdge.value = landsRT.visible ? THREE.MathUtils.smoothstep(spaceRT.skyAltitude, 70, 110) : 0
    if (!sys.worker || sys.pending) return
    const body = avatarRT()
    const cx = farCentre(body.pos.x), cz = farCentre(body.pos.z)
    if (cx === sys.cx && cz === sys.cz) return
    const request: FarRequest = { id: sys.nextId++, cx, cz }
    sys.pending = request.id
    sys.sent = performance.now()
    sys.worker.postMessage(request)
  })

  return <primitive object={sys.group} />
}
