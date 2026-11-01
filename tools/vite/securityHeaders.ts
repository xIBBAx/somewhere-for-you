/**
 * The Content Security Policy the game is built and tested against.
 * `npm run preview` sends it; copy it to your host's header configuration
 * when you deploy (docs/DEPLOYMENT.md).
 *
 * - scripts only from this site; 'wasm-unsafe-eval' lets the meshopt decoder
 *   (compressed models) compile its WebAssembly, nothing else is evaluated
 * - blob: images, media and workers are the photos, music and models a person
 *   adds in the Personalize screen, read back from this browser's storage
 * - the only outside address is Open-Meteo, used only when live weather is on
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self' blob: data: https://api.open-meteo.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ")
