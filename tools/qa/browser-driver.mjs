/**
 * Scripted gameplay captures for machines without a GPU (cloud containers).
 *
 *   node tools/qa/browser-driver.mjs steps.json
 *
 * steps.json:
 *   { "url": "http://127.0.0.1:5199/?debug=1&skipIntro=1",
 *     "out": "qa-artifacts/run", "viewport": [960, 540],
 *     "save": "finale-done" | "fresh" | null,      // seed localStorage first
 *     "quality": "low" | "medium" | "high" | null,
 *     "touch": false,                                 // emulate a phone
 *     "block": ["-real\\.glb$"],                       // abort matching requests (fallback tests)
 *     "steps": [ {"wait": ms} | {"waitFor": "js expression"} | {"click": "button name regex"}
 *              | {"eval": "js"} | {"keys": ["KeyW"], "hold": ms} | {"press": "KeyH"}
 *              | {"tap": "button name regex"} | {"shot": "name"}
 *              | {"capture": "name"} | {"cdp": ["Domain.method", {params}]}
 *              | {"series": "name", "count": 6, "every": 150}   // capture frames over time
 *              | {"wheel": 300} | {"drag": [dx, dy]} | {"reload": true}
 *              | {"down": "KeyW"} | {"up": "KeyW"}       // hold keys across other steps
 *              | {"touchTap": "css selector"} ] }       // a real touch at the element's centre
 *              | {"viewport": [390, 844]}              // resize the actual page for layout checks
 *
 * {"capture"} renders one frame through the game's ?debug capture API
 * (window.__worldCaptureFrame). With window.__worldSetCaptureStepping(true)
 * the simulation keeps running without drawing, so on software WebGL an
 * action plays out in seconds and is captured exactly when wanted.
 *
 * {"cdp"} sends a raw DevTools Protocol command, e.g. Input.dispatchTouchEvent
 * with two touchPoints for a real two-finger pinch.
 *
 * Rendering is software (SwiftShader); timings are not gameplay FPS.
 * Prints JSON with eval results, console errors and page errors.
 */
import { chromium } from "playwright-core"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"))
mkdirSync(cfg.out, { recursive: true })
const MEMORY_IDS = ["first-steps", "cafe-table", "long-way", "little-studio", "cat-garden", "training-corner", "corner-cafe", "rain-spot", "path-ahead"]

// GAME_GPU=1 runs a headed browser on the real GPU (WSLg: set DISPLAY=:0,
// WAYLAND_DISPLAY=wayland-0, XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir and
// GALLIUM_DRIVER=d3d12); otherwise software rendering (SwiftShader).
const gpu = !!process.env.GAME_GPU
const browser = await chromium.launch({
  executablePath: process.env.GAME_BROWSER_EXECUTABLE || "/opt/pw-browsers/chromium",
  headless: !gpu,
  args: gpu
    ? ["--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"]
    : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
})
const [w, h] = cfg.viewport ?? [960, 540]
const context = await browser.newContext(cfg.touch
  ? { viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
  : { viewport: { width: w, height: h } })
await context.addInitScript(({ save, quality, ids }) => {
  if (sessionStorage.getItem("qa-seeded")) return
  sessionStorage.setItem("qa-seeded", "1")
  if (quality) localStorage.setItem("gift-world/quality", quality)
  if (save === "finale-done") {
    localStorage.setItem("gift-world/save", JSON.stringify({
      version: 1, started: true, visited: ids, stars: ids.length, secrets: [], audioOn: false, timeMode: "day", finale: "done",
    }))
  } else if (save === "fresh") {
    localStorage.removeItem("gift-world/save")
  }
}, { save: cfg.save ?? null, quality: cfg.quality ?? null, ids: MEMORY_IDS })
for (const pattern of cfg.block ?? []) {
  const re = new RegExp(pattern)
  await context.route((url) => re.test(url.pathname), (route) => route.abort())
}
const page = await context.newPage()
const errors = []
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)) })
page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`))
await page.goto(cfg.url, { waitUntil: "domcontentloaded", timeout: 120000 })
const cdp = await context.newCDPSession(page)
const results = []
const started = Date.now()
for (const step of cfg.steps) {
  try {
    if (step.viewport) await page.setViewportSize({ width: step.viewport[0], height: step.viewport[1] })
    if (step.wait) await page.waitForTimeout(step.wait)
    if (step.waitFor) await page.waitForFunction(step.waitFor, null, { timeout: step.timeout ?? 240000, polling: 500 })
    if (step.click) await page.getByRole("button", { name: new RegExp(step.click, "i") }).first().click({ timeout: step.timeout ?? 120000, force: true })
    if (step.tap) await page.getByRole("button", { name: new RegExp(step.tap, "i") }).first().tap({ timeout: step.timeout ?? 60000, force: true })
    if (step.eval) results.push({ eval: step.eval.slice(0, 80), result: await page.evaluate(step.eval) })
    if (step.reload) await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 })
    if (step.wheel || step.drag) {
      const vp = page.viewportSize()
      await page.mouse.move(vp.width / 2, vp.height / 2)
      if (step.wheel) await page.mouse.wheel(0, step.wheel)
      if (step.drag) {
        await page.mouse.down()
        await page.mouse.move(vp.width / 2 + step.drag[0], vp.height / 2 + step.drag[1], { steps: 8 })
        await page.mouse.up()
      }
    }
    if (step.series) {
      for (let i = 0; i < (step.count ?? 6); i++) {
        if (i) await page.waitForTimeout(step.every ?? 150)
        const data = await page.evaluate(() => window.__worldCaptureFrame?.() ?? null)
        if (!data) throw new Error("capture API unavailable (needs ?debug)")
        writeFileSync(`${cfg.out}/${step.series}-${i}.png`, Buffer.from(data.split(",")[1], "base64"))
      }
      results.push({ series: step.series, count: step.count ?? 6 })
    }
    if (step.touchTap) {
      const box = await page.evaluate((sel) => {
        const r = document.querySelector(sel)?.getBoundingClientRect()
        return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
      }, step.touchTap)
      if (!box) throw new Error(`no element for ${step.touchTap}`)
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x, y: box.y, id: 9 }] })
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
      results.push({ touchTap: step.touchTap, at: [Math.round(box.x), Math.round(box.y)] })
    }
    if (step.cdp) results.push({ cdp: step.cdp[0], result: await cdp.send(step.cdp[0], step.cdp[1] ?? {}) })
    if (step.press) await page.keyboard.press(step.press)
    if (step.down) for (const k of [step.down].flat()) await page.keyboard.down(k)
    if (step.up) for (const k of [step.up].flat()) await page.keyboard.up(k)
    if (step.keys) {
      for (const k of step.keys) await page.keyboard.down(k)
      await page.waitForTimeout(step.hold ?? 1000)
      for (const k of [...step.keys].reverse()) await page.keyboard.up(k)
    }
    if (step.capture) {
      const data = await page.evaluate(() => window.__worldCaptureFrame?.() ?? null)
      if (!data) throw new Error("capture API unavailable (needs ?debug)")
      const path = `${cfg.out}/${step.capture}.png`
      writeFileSync(path, Buffer.from(data.split(",")[1], "base64"))
      results.push({ capture: path, t: Math.round((Date.now() - started) / 1000) })
    }
    if (step.shot) {
      const path = `${cfg.out}/${step.shot}.png`
      await page.screenshot({ path, timeout: 120000 })
      results.push({ shot: path, t: Math.round((Date.now() - started) / 1000) })
    }
  } catch (error) {
    results.push({ step: JSON.stringify(step).slice(0, 120), error: String(error).slice(0, 300) })
    if (cfg.failFast) {
      if (cfg.report) writeFileSync(cfg.report, JSON.stringify({ results, errors: errors.slice(0, 40) }, null, 1))
      break
    }
  }
  // Long software-rendered tours leave useful, inspectable evidence even
  // before the last capture or when the browser has to be interrupted.
  if (cfg.report) writeFileSync(cfg.report, JSON.stringify({ results, errors: errors.slice(0, 40) }, null, 1))
}
console.log(JSON.stringify({ results, errors: errors.slice(0, 40) }, null, 1))
await browser.close()
