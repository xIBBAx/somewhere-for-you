import { defineConfig } from "@playwright/test"

const nativeGpu = process.env.GAME_NATIVE_GPU === "1"
const nativeHeadless = process.env.GAME_BROWSER_HEADLESS === "1"

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: "http://localhost:5199",
    screenshot: "only-on-failure",
    ...(nativeGpu ? { headless: nativeHeadless } : {}),
    launchOptions: {
      ...(process.env.GAME_BROWSER_EXECUTABLE ? { executablePath: process.env.GAME_BROWSER_EXECUTABLE } : {}),
      ...(nativeGpu ? { headless: nativeHeadless, args: (process.env.GAME_BROWSER_ARGS ?? "--force-high-performance-gpu --use-angle=d3d11").split(" ") } : {}),
    },
  },
  webServer: {
    command: "npm run dev -- --port 5199 --strictPort",
    url: "http://localhost:5199",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 720 } } },
  ],
})
