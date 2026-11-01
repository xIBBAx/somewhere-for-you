import { expect, test } from "@playwright/test"
// Include the game's Window contract when this spec is type-checked alone.
import type {} from "../../src/debug"

const SAVE_KEY = "gift-world/save"

// the world can take minutes to warm up in a dev server under test load
test.beforeEach(() => { test.setTimeout(420_000) })

test("malformed progress recovers without unlocking the companion early", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({ version: 1, started: true, visited: "broken", secrets: {}, stars: "nine", finale: "playing" })), SAVE_KEY)
  await page.goto("/?debug=1")
  // a started save goes straight into the world
  await expect(page.locator(".hud.on").first()).toBeAttached({ timeout: 300_000 })
  await expect.poll(() => page.evaluate(() => window.__worldRaw.game.getState().finale)).toBe("locked")
  await expect.poll(() => page.evaluate(() => window.__worldRaw.characterRT.companionReady)).toBe(true)
  await page.keyboard.press("KeyQ")
  await expect.poll(() => page.evaluate(() => window.__worldRaw.input.switchCharacter)).toBe(false)
  expect(await page.evaluate(() => window.__worldRaw.characterRT.active)).toBe("explorer")
  expect(await page.evaluate(() => window.__worldRaw.characterRT.companionPresent)).toBe(false)
  await expect(page.locator(".hud-character")).toHaveCount(0)
  expect(await page.evaluate(() => window.__worldRaw.game.getState().visitOrder)).toEqual([])
  expect(errors).toEqual([])
})

test("blocked session storage and malformed cached weather do not break entry", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", { get() { throw new DOMException("Storage denied", "SecurityError") } })
  })
  await page.goto("/?debug=1")
  await page.getByRole("button", { name: "Enter the world" }).click()
  await expect(page.locator(".hud.on").first()).toBeVisible()
  expect(errors).toEqual([])
})

test("postcards keep keyboard focus and immediately flush earned progress", async ({ page }) => {
  await page.goto("/?debug=1")
  await page.getByRole("button", { name: "Enter the world" }).click()
  await page.evaluate(() => window.__world.teleport("first-steps"))
  await page.keyboard.press("KeyE")
  await expect(page.getByRole("dialog", { name: "Shubh Aarambh" })).toBeVisible()
  const close = page.getByRole("button", { name: "Close", exact: true })
  await expect(close).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await expect(page.getByRole("button", { name: /keep this star/i })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(close).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.locator('canvas[aria-label="Explore the world"]')).toBeFocused({ timeout: 30_000 })
  // Leave inside the 250 ms debounce; pagehide must preserve the new star.
  await page.evaluate(() => {
    window.__worldRaw.game.getState().openMemory("corner-cafe")
    window.__worldRaw.game.getState().closeMemory()
    window.dispatchEvent(new Event("pagehide"))
  })
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SAVE_KEY)
  expect(saved.visited).toEqual(["first-steps", "corner-cafe"])
  expect(saved.stars).toBe(2)
  await page.reload()
  await expect.poll(() => page.evaluate(() => window.__worldRaw?.game?.getState().stars), { timeout: 240_000 }).toBe(2)
})

test("malformed weather cache is replaced with valid weather", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.addInitScript(() => {
    sessionStorage.setItem("gift-world/weather-v1", JSON.stringify({ version: 1, savedAt: Date.now(), weather: { condition: "rain" } }))
  })
  await page.goto("/?debug=1")
  await expect.poll(() => page.evaluate(() => window.__worldRaw?.weatherRT.data.windSpeed)).toBeGreaterThanOrEqual(0)
  await page.getByRole("button", { name: "Enter the world" }).click()
  expect(errors).toEqual([])
})
