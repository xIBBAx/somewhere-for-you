import { useFrame, useThree } from "@react-three/fiber"
import { Bloom, EffectComposer, N8AO } from "@react-three/postprocessing"
import { BlendFunction, Effect, type EffectComposer as ComposerImpl } from "postprocessing"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { useQuality } from "../../state/qualityStore"
import { CUSTOM_TONE_MAPPING } from "./colorGrade"
import { characterRT, worldRT } from "../runtime"
import { nightBlend } from "../environment/celestialLighting"
import { ensureLens, lensRT } from "./LensRain"
import { lightBlendScene } from "./lightBlending"
import { overdriveRT } from "../pegasus/overdrive"

/**
 * Filmic finishing for the High preset: ground-contact ambient occlusion,
 * a soft highlight bloom for the sun, lanterns and fireflies, and 4× MSAA
 * so fine grass blades and foliage edges stay stable.
 *
 * Inside the composer the scene renders to a linear half-float target, where
 * three.js skips per-material tone mapping, so the shared grade
 * (colorGrade.ts) runs once here instead and the image matches the Balanced
 * and Light presets, which still tone map inside every material.
 */
class GradeEffect extends Effect {
  constructor() {
    super("GradeEffect", /* glsl */ `
      uniform float toneMappingExposure;
      uniform float uNight;
      uniform float uSwitch;
      ${CUSTOM_TONE_MAPPING}
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = max(inputColor.rgb, 0.0);
        // Switching between the two characters, as the GTA V switch does it:
        // the picture rushes toward its middle and drains to a cold blue-grey,
        // then the colour floods back on the one now being played
        if (uSwitch > 0.002) {
          vec2 d = uv - 0.5;
          // a smooth radial rush: jittered taps toward the middle, no visible steps
          float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          vec3 rush = vec3(0.0);
          for (int i = 0; i < 10; i++) rush += max(texture2D(inputBuffer, 0.5 + d * (1.0 - (float(i) + jit) * 0.0062 * uSwitch)).rgb, 0.0);
          c = mix(c, rush / 10.0, smoothstep(0.0, 0.45, uSwitch));
          float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(c, vec3(g) * vec3(0.78, 0.9, 1.14), uSwitch * 0.88);
          c *= 1.0 + uSwitch * 0.18 - dot(d, d) * uSwitch * 0.9;
        }
        // Moonlight is seen with rods: the dim parts of a night frame lose
        // chroma and drift blue (Purkinje shift), while lanterns, fireflies
        // and windows stay warm because they are bright enough for cones.
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float rod = uNight * (1.0 - smoothstep(0.015, 0.3, l * toneMappingExposure));
        c = mix(c, vec3(l) * vec3(0.82, 0.94, 1.18), rod * 0.42);
        outputColor = vec4(CustomToneMapping(c), inputColor.a);
      }`, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map([["toneMappingExposure", new THREE.Uniform(0.92)], ["uNight", new THREE.Uniform(0)], ["uSwitch", new THREE.Uniform(0)]]),
    })
  }
}

/**
 * Starborn's overdrive on the screen (pegasus/overdrive.ts): the world pours
 * out from the point she is flying at. The middle of the view, where she and
 * the way ahead are, stays sharp at every speed (a player must always see
 * where she is going); only the outer frame is drawn out, and lightly. The
 * light shifts with the speed instead of greying: a little cooler and
 * brighter ahead, warmer toward the edges, the air's hint of the starbow
 * she sees in space.
 */
class SpeedEffect extends Effect {
  constructor() {
    super("SpeedEffect", /* glsl */ `
      uniform float uAmount;
      uniform vec2 uCentre;
      uniform vec2 uSubject;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        if (uAmount < 0.002) { outputColor = inputColor; return; }
        vec2 d = uv - uCentre;
        float r = length(d * vec2(aspect, 1.0));
        // a wide clear middle; the smear only past it, and short
        float k = uAmount * smoothstep(0.32, 1.05, r) * 0.03;
        // and wherever she is on the screen (a launch puts her low in the frame), she stays sharp
        k *= smoothstep(0.16, 0.38, length((uv - uSubject) * vec2(aspect, 1.0)));
        vec3 sum = inputColor.rgb;
        if (k > 0.0005) {
          for (int i = 1; i < 8; i++) {
            float t = float(i) / 7.0;
            sum += texture2D(inputBuffer, uv - d * k * t).rgb;
          }
          sum /= 8.0;
        }
        vec3 c = sum;
        float edge = smoothstep(0.45, 1.1, r);
        c *= 1.0 - edge * uAmount * 0.12;
        c *= mix(vec3(1.0), vec3(1.05, 0.98, 1.03), edge * uAmount * 0.5);
        c *= mix(vec3(1.0), vec3(0.97, 1.01, 1.06), (1.0 - smoothstep(0.0, 0.35, r)) * uAmount * 0.5);
        outputColor = vec4(c, inputColor.a);
      }`, {
      uniforms: new Map<string, THREE.Uniform>([["uAmount", new THREE.Uniform(0)], ["uCentre", new THREE.Uniform(new THREE.Vector2(0.5, 0.5))], ["uSubject", new THREE.Uniform(new THREE.Vector2(0.5, 0.4))]]),
    })
  }
}

export const postFxEnabled = (level: string): boolean => level === "high"

/** The live composer (High only), so photo capture renders the graded image. */
export const postRT = { composer: null as ComposerImpl | null }

export const PostFX = (): React.ReactElement | null => {
  const level = useQuality((s) => s.level)
  const gl = useThree((s) => s.gl)
  const grade = useMemo(() => new GradeEffect(), [])
  const speed = useMemo(() => new SpeedEffect(), [])
  const enabled = postFxEnabled(level)
  const lens = useMemo(() => ensureLens(), [])
  // the lens drops exist only while this chain draws them
  useEffect(() => {
    lensRT.active = enabled
    return () => { lensRT.active = false }
  }, [enabled])
  useEffect(() => () => { grade.dispose(); speed.dispose() }, [grade, speed])
  const scene = useThree((s) => s.scene)
  const sweep = useRef(0)
  const switching = useRef({ active: characterRT.active as string, t: 9 })
  useFrame((_, dt) => {
    // the switch pulse: drain on the change of character, colour back over ~0.7 s
    const sw = switching.current
    if (characterRT.active !== sw.active) { sw.active = characterRT.active; sw.t = 0 }
    sw.t += Math.min(dt, 0.05)
    const pulse = Math.min(1, sw.t / 0.08) * (1 - THREE.MathUtils.smoothstep(sw.t, 0.22, 0.75))
    grade.uniforms.get("uSwitch")!.value = sw.t < 0.75 ? pulse : 0
    // keep the exposure shared with the in-material path (Lighting eases it with the hour)
    grade.uniforms.get("toneMappingExposure")!.value = gl.toneMappingExposure
    speed.uniforms.get("uAmount")!.value = overdriveRT.blur
    ;(speed.uniforms.get("uCentre")!.value as THREE.Vector2).copy(overdriveRT.centre)
    ;(speed.uniforms.get("uSubject")!.value as THREE.Vector2).copy(overdriveRT.subject)
    const night = grade.uniforms.get("uNight")
    if (night) night.value = nightBlend(worldRT.timeOfDay)
    // Additive light must not count as cover in N8AO's transparency pass, or
    // every glow paints a hazy disc on the ground behind it. Effects mount
    // and stream in over time, so new materials are picked up every 2 s.
    if (enabled && (sweep.current -= dt) <= 0) {
      sweep.current = 2
      lightBlendScene(scene)
    }
  })
  if (!enabled) return null
  return (
    <EffectComposer ref={(c: ComposerImpl | null) => { postRT.composer = c }} multisampling={4} frameBufferType={THREE.HalfFloatType} enableNormalPass={false}>
      <N8AO halfRes aoRadius={1.6} distanceFalloff={1.2} intensity={2.2} quality="medium" color="#14100c" />
      <Bloom mipmapBlur intensity={0.32} luminanceThreshold={1.05} luminanceSmoothing={0.25} radius={0.72} />
      <primitive object={lens} />
      <primitive object={speed} />
      <primitive object={grade} />
    </EffectComposer>
  )
}
