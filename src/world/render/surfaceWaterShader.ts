import { SHELTER_VOLUMES } from "../../game/environment/water/waterSim"

/** Ground and rainfall share roof footprints; sheltered soil does not pool. */
export const surfaceWaterShader = /* glsl */`
uniform float gSurfaceWater;
uniform float gRain;
uniform float gTime;
uniform vec3 gSkyColor;
float rainExposure(vec3 p) {
  float exposed = 1.0;
  ${SHELTER_VOLUMES.map(s => `exposed *= mix(1.0, smoothstep(${(s.radius - 0.12).toFixed(3)}, ${(s.radius + 0.12).toFixed(3)}, length(p.xz - vec2(${s.x.toFixed(3)}, ${s.z.toFixed(3)}))), 1.0 - step(${s.roofY.toFixed(3)}, p.y));`).join("\n  ")}
  return exposed;
}
float puddleRipple(vec2 p) {
  vec2 cell = floor(p * 2.2), f = fract(p * 2.2);
  float seed = gHash(cell);
  float age = fract(gTime * 1.35 + seed);
  vec2 center = 0.3 + vec2(gHash(cell + 8.1), gHash(cell + 17.3)) * 0.4;
  float radius = length(f - center);
  float ring = (radius - age * 0.65) * 30.0;
  // Each impact expands then fades before repeating; the edge envelope prevents
  // a tiled seam, and distant subpixel rings are filtered away.
  float edge = smoothstep(0.0, 0.12, min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y)));
  float aa = 1.0 - smoothstep(0.25, 1.0, length(fwidth(p * 2.2)));
  return sin(ring) * exp(-abs(ring) * 0.5) * sin(age * 3.14159) * edge * aa * gRain * 0.0018;
}
`
