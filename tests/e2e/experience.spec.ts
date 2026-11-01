import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  test.setTimeout(420_000)
  // clean slate for every flow (once per test, so a reload inside a test keeps what it saved)
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e-cleared")) return
    localStorage.clear()
    sessionStorage.setItem("e2e-cleared", "1")
  })
})

test("desktop: intro → start → move → first memory → progress", async ({ page }) => {
  await page.goto("/?debug=1")
  await expect(page.getByRole("heading", { name: "A world for Meera" })).toBeVisible()

  await page.getByRole("button", { name: /enter the world/i }).click()
  await expect(page.locator(".hud.on").first()).toBeVisible()

  // movement actually moves the player (debug readout)
  const readPos = async (): Promise<string> => {
    const txt = await page.locator(".debug-panel-pos").innerText()
    return txt.split(" · ")[0]
  }
  await page.evaluate(() => window.__world.teleport("first-steps"))
  await page.waitForTimeout(1200)
  const before = await readPos()
  await page.keyboard.down("KeyS")
  await page.waitForTimeout(2500)
  await page.keyboard.up("KeyS")
  const after = await readPos()
  expect(after).not.toBe(before)

  // interact with the memory stop
  await page.evaluate(() => window.__world.teleport("first-steps"))
  await page.waitForTimeout(1200)
  await page.keyboard.press("KeyE")
  const card = page.locator(".postcard")
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card.getByRole("heading", { name: "Shubh Aarambh" })).toBeVisible()

  await page.getByRole("button", { name: /keep this star/i }).click()
  await expect(page.locator(".hud-stars span").first()).not.toHaveClass(/empty/)
})

test("an idle explorer receives a cat affection moment", async ({ page }) => {
  await page.goto("/?debug=1")
  await page.getByRole("button", { name: /enter the world/i }).click()
  await page.waitForTimeout(800)

  // Skip only the initial wait; approach and mutual animation still run normally.
  await page.evaluate(() => {
    const cat = window.__worldRaw.catRT
    const player = window.__worldRaw.playerRT
    cat.pos.x = player.pos.x + 0.6
    cat.pos.y = 0
    cat.pos.z = player.pos.z + 0.6
    player.idleTime = 2.5
    cat.affectionCooldown = 0
  })

  await expect
    .poll(() => page.evaluate(() => window.__worldRaw.catRT.state), { timeout: 60_000 })
    .toBe("affection")
  await expect
    .poll(() => page.evaluate(() => window.__worldRaw.playerRT.catReaction), { timeout: 30_000 })
    .toBeGreaterThan(0.45)

  await page.keyboard.down("KeyW")
  await expect
    .poll(() => page.evaluate(() => window.__worldRaw.playerRT.moving), { timeout: 5_000 })
    .toBe(true)
  await expect
    .poll(() => page.evaluate(() => window.__worldRaw.catRT.state), { timeout: 5_000 })
    .toBe("follow")
  await page.keyboard.up("KeyW")
  await expect.poll(() => page.evaluate(() => window.__worldRaw.playerRT.catReaction)).toBe(0)
})

test("desktop mouse camera rotates, zooms, and drives camera-relative movement", async ({ page }) => {
  await page.goto("/?debug=1")
  await page.getByRole("button", { name: /enter the world/i }).click()
  await page.bringToFront()
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
  const canvas = page.locator('canvas[aria-label="Explore the world"]')
  await canvas.click({ position: { x: 640, y: 360 } })
  await expect
    .poll(() => page.evaluate(() => window.__worldRaw.cameraRT.pointerLocked))
    .toBe(true)
  await page.waitForTimeout(500)

  // Chromium automation recenters absolute mouse moves under pointer lock, so
  // inject one raw device delta to exercise the same document event path.
  const rawLook = await page.evaluate(() => {
    window.__worldRaw.cameraRT.yaw = 0
    window.__worldRaw.cameraRT.targetYaw = 0
    window.__worldRaw.cameraRT.pitch = 0.61
    window.__worldRaw.cameraRT.targetPitch = 0.61
    const event = new MouseEvent("mousemove")
    Object.defineProperties(event, {
      movementX: { value: 260 },
      movementY: { value: -70 },
    })
    document.dispatchEvent(event)
    return {
      yaw: window.__worldRaw.cameraRT.targetYaw,
      pitch: window.__worldRaw.cameraRT.targetPitch,
    }
  })
  expect(rawLook.yaw).toBeLessThan(-0.5)
  expect(rawLook.pitch).toBeLessThan(0.55)

  // Hold a deterministic quarter-turn after proving the raw event handler;
  // Playwright itself may emit a paired recenter delta under pointer lock.
  await page.evaluate(() => {
    window.__worldRaw.cameraRT.targetYaw = -Math.PI / 2
    window.__worldRaw.cameraRT.targetPitch = 0.45
  })
  await expect
    .poll(() => page.evaluate(() => window.__worldRaw.cameraRT.yaw))
    .toBeLessThan(-1.2)
  await expect
    .poll(() => page.evaluate(() => window.__worldRaw.cameraRT.pitch))
    .toBeLessThan(0.55)

  const before = await page.evaluate(() => ({
    x: window.__worldRaw.playerRT.pos.x,
    z: window.__worldRaw.playerRT.pos.z,
    yaw: window.__worldRaw.cameraRT.yaw,
    zoom: window.__worldRaw.cameraRT.targetDistance,
  }))
  await page.keyboard.down("KeyW")
  await page.waitForTimeout(2_500)
  await page.keyboard.up("KeyW")
  const after = await page.evaluate(() => ({
    x: window.__worldRaw.playerRT.pos.x,
    z: window.__worldRaw.playerRT.pos.z,
  }))
  const forwardDot =
    (after.x - before.x) * -Math.sin(before.yaw) +
    (after.z - before.z) * -Math.cos(before.yaw)
  expect(forwardDot).toBeGreaterThan(0.35)

  await page.mouse.wheel(0, -500)
  await expect
    .poll(() => page.evaluate(() => window.__worldRaw.cameraRT.targetDistance))
    .toBeLessThan(before.zoom)
  await page.keyboard.press("Escape")
  await expect
    .poll(() => page.evaluate(() => window.__worldRaw.cameraRT.pointerLocked))
    .toBe(false)
})

test("cat navigation routes a closed fence and performs a physical low jump", async ({ page }) => {
  await page.goto("/?debug=1")
  await page.getByRole("button", { name: /enter the world/i }).click()

  await page.evaluate(() => window.__world.catFenceTest())
  await expect
    .poll(() => page.evaluate(() => window.__worldRaw.catRT.navMode), { timeout: 12_000 })
    .toBe("path")
  const fenceRouteMinX = await page.evaluate(() =>
    Math.min(...window.__worldRaw.catRT.navPath.map((point) => point.x)),
  )
  expect(fenceRouteMinX).toBeLessThan(8.8)

  await page.evaluate(() => window.__world.catJumpTest())
  await expect
    .poll(() => page.evaluate(() => window.__worldRaw.catRT.navMode), { timeout: 45_000 })
    .toBe("jump")
  await expect
    .poll(() => page.evaluate(() => window.__worldRaw.catRT.pos.y), { timeout: 45_000 })
    .toBeGreaterThan(0.42)
  await expect
    .poll(() => page.evaluate(() => window.__worldRaw.catRT.pos.x), { timeout: 45_000 })
    .toBeGreaterThan(10.9)
})

test("debug finale: jump → choreography → closing card", async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto("/?debug=1")
  await page.getByRole("button", { name: /enter the world/i }).click()
  await page.evaluate(() => window.__world.jumpToFinale())

  const message = page.locator(".finale-card")
  await expect(message).toBeVisible({ timeout: 120_000 })
  await expect(message.getByRole("heading", { name: /For Meera/ })).toBeVisible()
  await expect(message.getByText(/\[Replace with/)).toHaveCount(0)

  await message.getByRole("button", { name: /stay a while/i }).click()
  await expect(page.locator(".closing-line")).toBeVisible({ timeout: 20_000 })
})

test("The companion stays offstage until the nine-star finale, then both bodies are playable", async ({ page }) => {
  await page.goto("/?debug=1&skipIntro=1")
  await page.getByRole("button", { name: /enter the world/i }).click()
  await expect.poll(() => page.evaluate(() => window.__worldRaw.characterRT.companionReady)).toBe(true)
  await expect(page.locator('.hud-character')).toHaveCount(0)
  await page.keyboard.press("KeyQ")
  await page.waitForTimeout(400)
  expect(await page.evaluate(() => window.__worldRaw.characterRT.active)).toBe("explorer")
  expect(await page.evaluate(() => window.__worldRaw.characterRT.companionPresent)).toBe(false)
  await page.evaluate(() => window.__world.jumpToFinale())
  await expect(page.locator('.finale-card')).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('.hud-character')).toHaveCount(0)
  await page.keyboard.press("KeyQ")
  expect(await page.evaluate(() => window.__worldRaw.characterRT.active)).toBe("explorer")
  await page.getByRole('button', { name: 'stay a while' }).click()
  await expect.poll(() => page.evaluate(() => window.__worldRaw.game.getState().finale), { timeout: 30_000 }).toBe("done")
  await page.evaluate(() => { window.__world.teleportTo(0, 20); (document.activeElement as HTMLElement)?.blur() })
  // T: whoever is not being played waits here instead of following
  await page.keyboard.press("KeyT")
  await page.waitForTimeout(500)
  await page.keyboard.down("KeyQ")
  await page.waitForTimeout(800)
  expect(await page.evaluate(() => window.__worldRaw.characterRT.active)).toBe("companion")
  await page.keyboard.up("KeyQ")
  const before = await page.evaluate(() => ({
    explorer: window.__worldRaw.playerRT.pos.toArray(), companion: window.__worldRaw.companionRT.pos.toArray(),
  }))
  await page.keyboard.down("KeyS")
  await page.waitForTimeout(1800)
  await page.keyboard.up("KeyS")
  await page.waitForTimeout(500)
  const after = await page.evaluate(() => ({
    explorer: window.__worldRaw.playerRT.pos.toArray(), companion: window.__worldRaw.companionRT.pos.toArray(),
  }))
  expect(Math.hypot(after.explorer[0] - before.explorer[0], after.explorer[2] - before.explorer[2])).toBeLessThan(0.02)
  expect(Math.hypot(after.companion[0] - before.companion[0], after.companion[2] - before.companion[2])).toBeGreaterThan(0.4)
  await page.keyboard.down("KeyQ")
  await page.waitForTimeout(800)
  await page.keyboard.up("KeyQ")
  await expect.poll(() => page.evaluate(() => window.__worldRaw.characterRT.active)).toBe("explorer")
  const parked = await page.evaluate(() => window.__worldRaw.companionRT.pos.toArray())
  // Grounding keeps running, and the final braking step may happen between
  // the earlier sample and the click. Control transfer must not displace the companion.
  expect(Math.hypot(parked[0] - after.companion[0], parked[2] - after.companion[2])).toBeLessThan(0.001)
  await page.keyboard.down("KeyW")
  await expect.poll(() => page.evaluate(() => window.__worldRaw.playerRT.moving)).toBe(true)
  await page.waitForTimeout(300)
  const inactive = await page.evaluate(() => window.__worldRaw.companionRT.pos.toArray())
  expect(Math.hypot(inactive[0] - parked[0], inactive[2] - parked[2])).toBeLessThan(0.001)
  await page.evaluate(() => window.dispatchEvent(new Event("blur")))
  await page.keyboard.up("KeyW")
  await expect.poll(() => page.evaluate(() => window.__worldRaw.playerRT.speed)).toBeLessThan(0.01)
})

test("the letter opens with the demo's words and no outside requests", async ({ page }) => {
  const outside: string[] = []
  page.on("request", (r) => { const u = new URL(r.url()); if (!["localhost", "127.0.0.1"].includes(u.hostname) && !["blob:", "data:"].includes(u.protocol)) outside.push(r.url()) })
  await page.goto("/")
  const veil = page.locator("#letter-veil")
  await expect(veil.getByText("For Meera")).toBeVisible()
  await expect(veil.getByText("— Kabir")).toBeVisible()
  await expect(veil.getByRole("link", { name: /enter the world/i })).toBeVisible()
  await page.waitForTimeout(3000)
  expect(outside).toEqual([])
})

test("personalizing in the browser changes the letter and survives a reload", async ({ page }) => {
  await page.goto("/?personalize")
  const dialog = page.getByRole("dialog", { name: /make this world for someone/i })
  await expect(dialog).toBeVisible({ timeout: 120_000 })
  await dialog.getByLabel("Who is this world for?").fill("Asha <b>")
  await dialog.getByLabel("Who made it?").fill("Dev")
  await dialog.getByRole("tab", { name: "Letter" }).click()
  await dialog.getByLabel("Greeting").fill("Dear Asha,")
  await expect(dialog.getByLabel("Letter preview")).toContainText("For Asha <b>")
  await dialog.getByRole("button", { name: /save and restart/i }).click()
  await page.waitForURL((u) => !u.search.includes("personalize"))
  const veil = page.locator("#letter-veil")
  // text, never markup
  await expect(veil.getByText("For Asha <b>")).toBeVisible()
  await expect(veil.getByText("Dear Asha,")).toBeVisible()
  expect(await page.evaluate(() => document.title)).toBe("A world for Asha <b>")
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("gift-world/personal/v1") ?? "{}").creator?.name)).toBe("Dev")
})
