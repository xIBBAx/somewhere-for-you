import { defineConfig } from "vitest/config"

/** Developer tools (maps, timing probes) — not part of `npm test`. */
export default defineConfig({
  test: { environment: "node", include: ["tools/*.tool.ts"], root: ".", testTimeout: 600000 },
})
