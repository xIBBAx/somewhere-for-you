import * as THREE from "three"

/** All meshes are original procedural geometry. Fish point along local +z;
 * the tail lies at -z, allowing one traveling wave to bend body and fins. */
class Builder {
  positions: number[] = []
  colors: number[] = []
  parts: number[] = []
  motion: number[] = []
  color = new THREE.Color()
  triangle(a: number[], b: number[], c: number[], color: string, part = 0, motion = 0): void {
    this.color.set(color)
    for (const p of [a, b, c]) { this.positions.push(...p); this.colors.push(this.color.r, this.color.g, this.color.b); this.parts.push(part); this.motion.push(motion) }
  }
  ellipsoid(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, part = 0, motion = 0): void {
    const p = (j: number, i: number): number[] => {
      const theta = j / 6 * Math.PI, phi = i / 10 * Math.PI * 2
      return [x + Math.sin(theta) * Math.cos(phi) * sx, y + Math.cos(theta) * sy, z + Math.sin(theta) * Math.sin(phi) * sz]
    }
    for (let j = 0; j < 6; j++) for (let i = 0; i < 10; i++) {
      this.triangle(p(j, i), p(j + 1, i), p(j, i + 1), color, part, motion)
      this.triangle(p(j, i + 1), p(j + 1, i), p(j + 1, i + 1), color, part, motion)
    }
  }
  rod(a: number[], b: number[], width: number, color: string, part: number): void {
    const v = [width, width * 0.4, 0]
    const plus = (p: number[]): number[] => [p[0] + v[0], p[1] + v[1], p[2]]
    const minus = (p: number[]): number[] => [p[0] - v[0], p[1] - v[1], p[2]]
    this.triangle(plus(a), minus(a), plus(b), color, part)
    this.triangle(plus(b), minus(a), minus(b), color, part)
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3))
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3))
    g.setAttribute("part", new THREE.Float32BufferAttribute(this.parts, 1))
    g.setAttribute("motion", new THREE.Float32BufferAttribute(this.motion, 1))
    g.computeVertexNormals(); g.computeBoundingSphere()
    return g
  }
}

const PALETTES = [
  ["#516d70", "#bfced0", "#e5e4d2", "#819ba0"],
  ["#866334", "#e9ad4a", "#f5d991", "#ca843b"],
  ["#3e5149", "#849a86", "#c8ceaa", "#5c6d55"],
  ["#506a62", "#9db3a4", "#dbdccc", "#6d8c7b"],
]

export const makeFishGeometry = (species: number): THREE.BufferGeometry => {
  const b = new Builder(), palette = PALETTES[species]
  const zs = [-0.49, -0.35, -0.15, 0.08, 0.27, 0.42, 0.49]
  const widths = [0.025, 0.045, 0.09, 0.115, 0.085, 0.05, 0.013]
  const height = species === 1 ? 1.4 : species === 2 ? 0.85 : 1
  const point = (j: number, i: number): number[] => {
    const angle = i / 10 * Math.PI * 2, w = widths[j]
    return [Math.sin(angle) * w, Math.cos(angle) * w * height, zs[j]]
  }
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < 10; i++) {
    const tone = Math.cos((i + 0.5) / 10 * Math.PI * 2)
    const color = tone > 0.4 ? palette[0] : tone < -0.4 ? palette[2] : palette[1]
    b.triangle(point(j, i), point(j + 1, i), point(j, i + 1), color)
    b.triangle(point(j, i + 1), point(j + 1, i), point(j + 1, i + 1), color)
  }
  for (let i = 0; i < 10; i++) {
    b.triangle([0, 0, 0.5], point(6, i), point(6, i + 1), palette[1])
    b.triangle([0, 0, -0.51], point(0, i + 1), point(0, i), palette[0])
  }
  // Vertical, forked caudal fin (not horizontal dolphin flukes).
  b.triangle([0, 0.027, -0.45], [0, 0.23, -0.68], [0, 0.035, -0.61], palette[3])
  b.triangle([0, -0.027, -0.45], [0, -0.035, -0.61], [0, -0.23, -0.68], palette[3])
  b.triangle([0, 0.03, -0.45], [0, 0.035, -0.61], [0, -0.035, -0.61], palette[3])
  b.triangle([0, 0.03, -0.45], [0, -0.035, -0.61], [0, -0.03, -0.45], palette[3])
  b.triangle([0, 0.09 * height, -0.23], [0, 0.23 * height / 1.4, -0.1], [0, 0.1 * height, 0.16], palette[0])
  for (const side of [-1, 1]) {
    b.triangle([side * 0.08, -0.025, 0.2], [side * 0.22, -0.09, 0.0], [side * 0.075, -0.075, -0.02], palette[3])
    b.triangle([side * 0.065, -0.06, -0.13], [side * 0.13, -0.1, -0.3], [side * 0.02, -0.065, -0.32], palette[3])
    b.ellipsoid(side * 0.06, 0.033, 0.36, 0.013, 0.013, 0.013, "#171e19")
  }
  return b.build()
}

/** A small atlas in one geometry. Part ids select frog/skater/dragonfly in
 * the vertex shader, so they share one instanced draw, including their eyes. */
export const makeSurfaceGeometry = (): THREE.BufferGeometry => {
  const b = new Builder()
  b.ellipsoid(0, 0.035, -0.015, 0.095, 0.055, 0.125, "#67794b")
  b.ellipsoid(0, 0.052, 0.095, 0.085, 0.047, 0.07, "#829657")
  b.ellipsoid(0, 0.012, 0.108, 0.055, 0.022, 0.033, "#c8c78a", 0, 2)
  for (const s of [-1, 1]) {
    b.ellipsoid(s * 0.064, 0.085, 0.115, 0.017, 0.017, 0.019, "#b5a85d")
    b.ellipsoid(s * 0.066, 0.087, 0.131, 0.01, 0.006, 0.007, "#172b1a")
    b.ellipsoid(s * 0.105, 0.015, -0.063, 0.06, 0.035, 0.065, "#697846", 0, 3)
    b.ellipsoid(s * 0.125, -0.005, -0.006, 0.025, 0.016, 0.07, "#819155", 0, 3)
    b.rod([s * 0.06, 0.02, 0.075], [s * 0.095, -0.02, 0.15], 0.009, "#73834c", 0)
    for (let toe = 0; toe < 3; toe++) b.rod([s * 0.095, -0.02, 0.15], [s * (0.08 + toe * 0.018), -0.025, 0.18], 0.003, "#7d8c51", 0)
  }
  b.ellipsoid(0, 0.035, 0, 0.018, 0.018, 0.058, "#4b4734", 1)
  for (const s of [-1, 1]) for (let leg = 0; leg < 3; leg++) {
    const z = (leg - 1) * 0.045
    b.rod([s * 0.012, 0.026, z], [s * 0.1, 0.045, z * 1.9], 0.003, "#494735", 1)
    b.rod([s * 0.1, 0.045, z * 1.9], [s * 0.175, 0.001, z * 2.6], 0.0025, "#343d2c", 1)
  }
  b.ellipsoid(0, 0, -0.025, 0.014, 0.014, 0.11, "#4d9e9a", 2)
  b.ellipsoid(0, 0, 0.075, 0.023, 0.019, 0.028, "#567d6a", 2)
  for (const s of [-1, 1]) {
    b.ellipsoid(s * 0.017, 0.009, 0.092, 0.012, 0.013, 0.013, "#49766a", 2)
    for (const z of [0.015, 0.05]) {
      b.triangle([s * 0.01, 0, z], [s * 0.16, 0.005, z - 0.027], [s * 0.185, 0.008, z + 0.018], "#b9c9bd", 2, 1)
      b.triangle([s * 0.01, 0, z], [s * 0.185, 0.008, z + 0.018], [s * 0.055, 0.003, z + 0.025], "#a4b9ad", 2, 1)
    }
  }
  return b.build()
}

export const makeFishMaterial = (): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.12, side: THREE.DoubleSide,
    transparent: true, depthWrite: false, emissive: "#cedbd0", emissiveIntensity: 0.025 })
  // The lake shader's opacity describes bed depth, not the fish's shallow
  // water column. Draw the fish after that surface using its own Beer-Lambert
  // attenuation and Fresnel transmission. Opaque terrain still occludes it.
  // Single-sided pass rendering keeps even translucent fins to one draw.
  material.forceSinglePass = true
  const water = new THREE.Color("#215d61")
  material.userData.water = water
  material.onBeforeCompile = shader => {
    shader.uniforms.uAquaticWater = { value: water }
    shader.vertexShader = `attribute vec4 aSwim; varying float vAquaticDepth; varying float vAquaticCos;\n${shader.vertexShader}`
    shader.fragmentShader = `uniform vec3 uAquaticWater; varying float vAquaticDepth; varying float vAquaticCos;\n${shader.fragmentShader}`
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", /* glsl */ `
      vec3 transformed = vec3(position);
      float tail = clamp((0.42 - position.z) / 1.1, 0.0, 1.0);
      transformed.x += sin(position.z * 8.0 + aSwim.x) * tail * tail * aSwim.y;
      // the head recoils a little against each stroke of the tail
      transformed.x -= sin(aSwim.x + 1.9) * aSwim.y * 0.16 * (1.0 - tail);
      transformed.y += sin(position.z * 7.0 + aSwim.x + 1.4) * tail * aSwim.y * 0.1;
      // turning, the whole body curves round the inside of the turn
      float aqBend = position.z - 0.05;
      transformed.x += aSwim.w * aqBend * aqBend;
      vAquaticDepth = aSwim.z;
      vec4 aqWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
      vAquaticCos = abs(normalize(cameraPosition - aqWorld.xyz).y);
    `)
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", /* glsl */ `
      #include <color_fragment>
      float absorption = exp(-max(0.0, vAquaticDepth) * 1.55);
      float fresnel = 0.02 + 0.98 * pow(1.0 - clamp(vAquaticCos, 0.0, 1.0), 5.0);
      float submerged = smoothstep(0.015, 0.065, vAquaticDepth);
      diffuseColor.rgb = mix(diffuseColor.rgb, uAquaticWater, (1.0 - absorption) * submerged * 0.45);
      diffuseColor.a *= mix(1.0, absorption * (1.0 - fresnel) * 0.72, submerged);
    `)
    shader.vertexShader = shader.vertexShader.replace("#include <beginnormal_vertex>", /* glsl */ `
      vec3 objectNormal = vec3(normal);
      float ntail = clamp((0.42 - position.z) / 1.1, 0.0, 1.0);
      float slope = aSwim.y * (8.0 * cos(position.z * 8.0 + aSwim.x) * ntail * ntail - 1.82 * sin(position.z * 8.0 + aSwim.x) * ntail)
        + 2.0 * aSwim.w * (position.z - 0.05);
      objectNormal.z -= objectNormal.x * slope;
      #ifdef USE_TANGENT
        vec3 objectTangent = vec3(tangent.xyz);
      #endif
    `)
  }
  material.customProgramCacheKey = () => "aquatic-spine-column-v3"
  return material
}

export const makeSurfaceMaterial = (): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: { value: 0 }, uNight: { value: 0 } },
  vertexShader: /* glsl */ `
    #include <common>
    #include <fog_pars_vertex>
    attribute vec3 color; attribute float part; attribute float motion; attribute vec4 aLife;
    uniform float uTime; varying vec3 vColor; varying float vVisible; varying float vLight;
    void main() {
      vColor = color; vVisible = abs(part - aLife.x) < 0.1 ? 1.0 : 0.0;
      vec3 n = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
      vLight = 0.46 + max(0.0, dot(n, normalize(vec3(0.3, 0.85, 0.25)))) * 0.65;
      vec3 p = position;
      if (motion == 1.0) p.y += sin(uTime * 82.0 + aLife.y) * abs(p.x) * 0.45;
      if (motion == 2.0) p *= 1.0 + aLife.z * (0.12 + sin(uTime * 24.0) * 0.08);
      if (motion == 3.0) p.z -= aLife.w * 0.065;
      if (vVisible < 0.5) p = vec3(0.0);
      vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */ `
    #include <common>
    #include <fog_pars_fragment>
    uniform float uNight; varying vec3 vColor; varying float vVisible; varying float vLight;
    void main() {
      if (vVisible < 0.5) discard;
      gl_FragColor = vec4(vColor * vLight * (0.92 - uNight * 0.66), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
  side: THREE.DoubleSide, fog: true,
})

export const makeRippleGeometry = (): THREE.BufferGeometry => {
  const b = new Builder()
  b.triangle([-1, 0, -1], [-1, 0, 1], [1, 0, -1], "#ffffff")
  b.triangle([1, 0, -1], [-1, 0, 1], [1, 0, 1], "#ffffff")
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 0.4, x = Math.sin(angle) * 0.07, z = Math.cos(angle) * 0.07
    b.triangle([x - 0.008, 0, z], [x + 0.008, 0, z], [x, 0.022, z], "#ffffff", i + 1)
  }
  return b.build()
}

export const makeRippleMaterial = (): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uNight: { value: 0 } },
  vertexShader: /* glsl */ `
    #include <common>
    #include <fog_pars_vertex>
    attribute float part; attribute vec3 aRipple;
    varying vec2 vUv; varying vec3 vRipple; varying float vPart;
    void main() {
      vUv = position.xz; vRipple = aRipple; vPart = part;
      vec3 p = position;
      if (part > 0.5) {
        float age = min(aRipple.x * 4.0, 1.0);
        p.xz *= 1.0 + age * 2.0;
        p.y += sin(age * 3.14159) * 0.17;
        if (aRipple.z < 0.5 || age >= 1.0) p = vec3(0.0);
      }
      vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */ `
    #include <common>
    #include <fog_pars_fragment>
    uniform float uNight; varying vec2 vUv; varying vec3 vRipple; varying float vPart;
    void main() {
      float age = vRipple.x, radius = 0.08 + age * 0.77;
      float distance = length(vUv), width = max(fwidth(distance) * 1.2, 0.008);
      float ring = 1.0 - smoothstep(width, width * 2.0, abs(distance - radius));
      ring += (1.0 - smoothstep(width, width * 2.0, abs(distance - radius * 0.7))) * 0.4;
      float alpha = ring * (1.0 - age) * 0.32 * vRipple.y;
      if (vPart > 0.5) alpha = vRipple.z * (1.0 - min(age * 4.0, 1.0)) * 0.7;
      if (alpha < 0.005) discard;
      gl_FragColor = vec4(vec3(0.48, 0.7, 0.66) * (1.0 - uNight * 0.65), alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
})
