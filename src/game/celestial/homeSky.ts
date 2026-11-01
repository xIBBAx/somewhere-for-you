/**
 * How much of home's own painted sky is still drawn: its night stars and
 * moon (SkyStars) and its clouds (Clouds) fade out as you climb, while the
 * real sky (celestial/render) shows through the thinning air in their place.
 * Shared uniforms, written each frame by CelestialSky.
 */
export const homeSky = {
  stars: { value: 1 },
  clouds: { value: 1 },
}
