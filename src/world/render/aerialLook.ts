/**
 * Shorelines for the land seen from afar, shared by the far terrain and the
 * horizon lands so their lakes meet without a seam. Their haze and muted
 * colour come from the one aerial perspective every material shares
 * (aerialFog.ts), so the near chunks match them too.
 */

/** Requires WORLD_NOISE_GLSL (origin.ts) before it; `cycles` must be whole. */
export const AERIAL_LOOK_GLSL = /* glsl */ `
// Open water from a vertex grid: 'wet' crosses one half at the shore. The far
// terrain passes its water depth, which interpolates to the real shoreline
// (not the grid's own staircase); the horizon lands pass the share of each
// cell that is water. Noise at and below the grid's scale moves the line, so
// ponds are irregular and edged cleanly instead of polygons fading through a
// glossy rim.
float aerialShore(float wet, vec2 renderXZ, float cycles) {
  if (wet <= 0.0) return 0.0;
  float n = wNoise(renderXZ, cycles) * 0.5 + wNoise(renderXZ, cycles * 3.0) * 0.3 + wNoise(renderXZ, cycles * 9.0) * 0.2;
  float e = wet + (n - 0.5) * 0.5;
  // about a pixel of shore wherever the grid is fine on screen, wider far off
  float w = max(fwidth(e) * 0.75, 0.04);
  return smoothstep(0.5 - w, 0.5 + w, e);
}
`
