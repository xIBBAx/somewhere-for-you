/// <reference types="vitest/config" />
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { giftLetterPlugin } from "./tools/vite/giftLetterPlugin"
import { giftMediaPlugin } from "./tools/vite/giftMediaPlugin"
import { CONTENT_SECURITY_POLICY } from "./tools/vite/securityHeaders"

// WSL users with the project on a Windows drive (/mnt/c, /mnt/d…) get no
// file-change events there: set WATCH_POLLING=1 for hot reload to work.
const polling = process.env.WATCH_POLLING === "1"

export default defineConfig({
  plugins: [react(), giftMediaPlugin(), giftLetterPlugin()],
  // Parallel dev servers must not share node_modules/.vite (it duplicates three.js).
  cacheDir: process.env.GAME_VITE_CACHE || undefined,
  // Pre-bundle the post-processing stack with React/three on first start, so
  // a lazily discovered dependency never reloads into duplicate instances.
  optimizeDeps: { include: ["postprocessing", "@react-three/postprocessing", "n8ao"] },
  server: {
    // localhost only; `npm run dev -- --host` opts in to your network
    host: "localhost",
    hmr: { overlay: process.env.GAME_HMR_OVERLAY !== "0" },
    watch: {
      usePolling: polling,
      interval: 300,
      ignored: ["**/dist/**", "**/test-results/**", "**/playwright-report/**", "**/docs/**"],
    },
  },
  preview: {
    host: "localhost",
    // the policy a static host should send (docs/DEPLOYMENT.md); preview uses it so it is tested
    headers: {
      "Content-Security-Policy": CONTENT_SECURITY_POLICY,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(self), payment=(), usb=()",
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1200,
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
})
