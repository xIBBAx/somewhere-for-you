import { BlendFunction, Effect, EffectAttribute } from "postprocessing"
import * as THREE from "three"

/**
 * Rain on the lens, as real drops on glass look: each drop is a tiny lens
 * that gathers the view from a wide angle and turns it over, so a drop shows
 * a small, blurred, upside-down picture of the scene behind it, with a dark
 * rim where light is bent away and a pin of reflected sky. Nothing is
 * painted on: the effect refracts the rendered frame itself.
 *
 * The drops live on a small canvas as a map of their surface: the slope of
 * the water (red, green) and its depth (blue), alpha for where water is. The
 * simulation (RainLens.tsx) beads, grows, merges and slides them; this pass
 * reads the map and bends the frame through it. High quality only (it needs
 * the post-processing chain); elsewhere there is simply no water on the lens.
 */

const FRAG = /* glsl */ `
uniform sampler2D uDrops;
uniform float uStrength;
uniform float uAspect;

vec3 tap(vec2 p) { return texture2D(inputBuffer, clamp(p, vec2(0.001), vec2(0.999))).rgb; }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec4 d = texture2D(uDrops, uv);
  float cover = d.a * uStrength;
  if (cover < 0.004) { outputColor = inputColor; return; }
  vec2 n = d.rg * 2.0 - 1.0;
  float depth = d.b;
  // refraction: the view through a drop comes from far across the frame, and
  // inverted (the top of a drop looks down, its left edge looks right)
  vec2 off = n * vec2(1.0 / uAspect, 1.0) * (0.07 + 0.05 * depth);
  vec2 ruv = uv - off;
  // a drop sits far closer than the focus: what it shows is soft
  float b = 0.0025 + (1.0 - depth) * 0.004;
  vec3 col = tap(ruv) * 0.36 + (tap(ruv + vec2(b, 0.0)) + tap(ruv - vec2(b, 0.0)) + tap(ruv + vec2(0.0, b)) + tap(ruv - vec2(0.0, b))) * 0.16;
  // light bent out of the eye at the steep edge: a dark rim, a little
  // brightening where the round middle gathers it
  float slope = length(n);
  col *= mix(1.06, 0.55, smoothstep(0.55, 0.98, slope));
  // a pin of the bright sky reflected off the top of the bead
  vec3 nn = normalize(vec3(n, max(depth, 0.08)));
  float spec = pow(max(dot(nn, normalize(vec3(-0.35, 0.55, 0.76))), 0.0), 60.0);
  col += vec3(0.9, 0.95, 1.0) * spec * 0.55 * smoothstep(0.1, 0.4, depth);
  outputColor = vec4(mix(inputColor.rgb, col, cover), inputColor.a);
}
`

export class LensRainEffect extends Effect {
  constructor(drops: THREE.Texture) {
    super("LensRainEffect", FRAG, {
      blendFunction: BlendFunction.SET,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ["uDrops", new THREE.Uniform(drops)],
        ["uStrength", new THREE.Uniform(0)],
        ["uAspect", new THREE.Uniform(16 / 9)],
      ]),
    })
  }
}

/** The drop map's resolution along the frame's height (its width follows the aspect). */
export const LENS_H = 240

/** Shared between the post chain (PostFX) and the simulation (RainLens). */
export const lensRT = {
  /** true while the post chain that draws the drops is mounted */
  active: false,
  canvas: null as HTMLCanvasElement | null,
  texture: null as THREE.CanvasTexture | null,
  effect: null as LensRainEffect | null,
}

/** One stamp of a drop's surface (64×64): slope in red and green, depth in blue, coverage in alpha. */
export const makeDropStamp = (): HTMLCanvasElement => {
  const S = 64
  const c = document.createElement("canvas")
  c.width = c.height = S
  const g = c.getContext("2d")!
  const img = g.createImageData(S, S)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = ((x + 0.5) / S) * 2 - 1
    const py = ((y + 0.5) / S) * 2 - 1
    const r = Math.hypot(px, py)
    const o = (y * S + x) * 4
    if (r >= 1) { img.data[o + 3] = 0; continue }
    // a bead on glass is a flattened cap, steepest at its edge
    const h = Math.sqrt(1 - r * r)
    img.data[o] = Math.round((px * 0.5 + 0.5) * 255)
    // the canvas runs downward, the frame's uv upward
    img.data[o + 1] = Math.round((-py * 0.5 + 0.5) * 255)
    img.data[o + 2] = Math.round(h * 255)
    img.data[o + 3] = Math.round(Math.min(1, (1 - r) / 0.12) * 255)
  }
  g.putImageData(img, 0, 0)
  return c
}

export const ensureLens = (): LensRainEffect => {
  if (lensRT.effect) return lensRT.effect
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(LENS_H * 16 / 9)
  canvas.height = LENS_H
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.NoColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  lensRT.canvas = canvas
  lensRT.texture = texture
  lensRT.effect = new LensRainEffect(texture)
  return lensRT.effect
}
