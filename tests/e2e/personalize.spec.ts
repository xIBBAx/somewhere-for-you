import { expect, test, type Page } from "@playwright/test"
import { readFileSync } from "node:fs"

/**
 * The Personalize screen with fictional data: a photo goes in and loses its
 * metadata, a model is checked before use, the world exports and imports, and
 * "delete everything" really deletes it. Nothing here may leave the browser.
 */
const openScreen = async (page: Page, outside: string[]) => {
  page.on("request", (r) => {
    const u = new URL(r.url())
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && !["blob:", "data:"].includes(u.protocol)) outside.push(r.url())
  })
  await page.goto("/?personalize")
  const dialog = page.getByRole("dialog", { name: /make this world for someone/i })
  await expect(dialog).toBeVisible({ timeout: 120_000 })
  return dialog
}

/** A small JPEG made in the page, with a fake EXIF block spliced in after the SOI marker. */
const jpegWithExif = async (page: Page): Promise<Buffer> => {
  const bytes = await page.evaluate(async () => {
    const c = document.createElement("canvas")
    c.width = 640
    c.height = 400
    const x = c.getContext("2d")!
    x.fillStyle = "#e8381d"
    x.fillRect(0, 0, 640, 400)
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/jpeg", 0.9))
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  const marker = Buffer.from("Exif\0\0GPSLatitude=12.34;Owner=Fictional Test Person")
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (marker.length + 2) >> 8, (marker.length + 2) & 255]), marker])
  const jpg = Buffer.from(bytes)
  return Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)])
}

test("a photo is re-encoded without its metadata, and the world exports, imports and deletes", async ({ page }) => {
  test.setTimeout(420_000)
  const outside: string[] = []
  const dialog = await openScreen(page, outside)
  await dialog.getByLabel("Who is this world for?").fill("Asha")
  await dialog.getByLabel("Who made it?").fill("Dev")

  // a photo on the first memory place
  await dialog.getByRole("tab", { name: /memories/i }).click()
  const photo = dialog.locator('input[type="file"][accept^="image/"]').first()
  await photo.setInputFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: await jpegWithExif(page) })
  await expect(dialog.locator(".pz-message")).toContainText("Photo added", { timeout: 60_000 })

  // what was stored has no trace of the metadata
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open("gift-world-personal")
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const out: string[] = []
    for (const name of db.objectStoreNames) {
      const values = await new Promise<unknown[]>((res, rej) => {
        const r = db.transaction(name).objectStore(name).getAll()
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      for (const v of values) {
        for (const field of Object.values(v as Record<string, unknown>)) {
          if (field instanceof Blob) out.push(new TextDecoder("latin1").decode(await field.arrayBuffer()))
          else if (field instanceof ArrayBuffer) out.push(new TextDecoder("latin1").decode(field))
        }
      }
    }
    db.close()
    return out
  })
  expect(stored.length).toBeGreaterThan(0)
  for (const s of stored) expect(s).not.toContain("GPSLatitude")

  // export
  await dialog.getByRole("tab", { name: "Your data" }).first().click()
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: /export this world/i }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.zip$/)
  const zipPath = await download.path()
  const zip = readFileSync(zipPath)
  expect(zip.subarray(0, 2).toString()).toBe("PK")
  expect(zip.includes(Buffer.from("gift.json"))).toBe(true)

  // import an oversized/garbage archive is refused, the real one is accepted
  const importer = dialog.locator('input[type="file"][accept^=".zip"]')
  await importer.setInputFiles({ name: "not-a-zip.zip", mimeType: "application/zip", buffer: Buffer.from("this is not an archive") })
  await expect(dialog.locator(".pz-message.bad")).toBeVisible({ timeout: 20_000 })
  await importer.setInputFiles(zipPath)
  await expect(dialog).toContainText(/imported/i, { timeout: 30_000 })

  // save, and the letter uses the words
  await dialog.getByRole("button", { name: /save and restart/i }).click()
  await page.waitForURL((u) => !u.search.includes("personalize"), { timeout: 60_000 })
  await expect(page.locator("#letter-veil").getByText("For Asha")).toBeVisible()

  // delete everything: the demo world returns
  await page.goto("/?personalize")
  const again = page.getByRole("dialog", { name: /make this world for someone/i })
  await expect(again).toBeVisible({ timeout: 120_000 })
  await again.getByRole("tab", { name: "Your data" }).first().click()
  await again.getByRole("button", { name: /delete everything personal/i }).click()
  await again.getByRole("button", { name: /yes, delete it all/i }).click()
  await page.waitForURL((u) => !u.search.includes("personalize"), { timeout: 60_000 }).catch(() => undefined)
  await page.goto("/")
  await expect(page.locator("#letter-veil").getByText("For Meera")).toBeVisible({ timeout: 60_000 })
  expect(await page.evaluate(() => localStorage.getItem("gift-world/personal/v1"))).toBeNull()

  expect(outside).toEqual([])
})

test("a custom character is checked before it can be used", async ({ page }) => {
  test.setTimeout(420_000)
  const outside: string[] = []
  const dialog = await openScreen(page, outside)
  await dialog.getByRole("tab", { name: /characters/i }).click()
  const picker = dialog.locator('input[type="file"][accept^=".glb"]').first()

  await picker.setInputFiles({ name: "broken.glb", mimeType: "model/gltf-binary", buffer: Buffer.from("definitely not a model") })
  await expect(dialog.locator(".pz-report.bad, .pz-message.bad").first()).toBeVisible({ timeout: 30_000 })
  
  await picker.setInputFiles("public/assets/characters/companion.glb")
  await expect(dialog.locator(".pz-report:not(.bad)").first()).toBeVisible({ timeout: 60_000 })
  expect(outside).toEqual([])
})

test("the letter can be typed key by key, spaces and blank lines included", async ({ page }) => {
  test.setTimeout(420_000)
  const outside: string[] = []
  const dialog = await openScreen(page, outside)
  const name = dialog.getByLabel("Who is this world for?")
  await name.fill("")
  await name.pressSequentially("Asha Rao", { delay: 60 })
  await expect(name).toHaveValue("Asha Rao")
  await dialog.getByRole("tab", { name: "Letter" }).click()
  const letter = dialog.getByLabel("The letter")
  await letter.click()
  await page.keyboard.press("Control+A")
  await page.keyboard.press("Delete")
  await letter.pressSequentially("Happy Diwali, Asha.", { delay: 30 })
  await letter.press("Enter")
  await letter.press("Enter")
  await letter.pressSequentially("Nine stars are hidden near home.", { delay: 20 })
  await expect(letter).toHaveValue("Happy Diwali, Asha.\n\nNine stars are hidden near home.")
  await expect(dialog.getByLabel("Letter preview")).toContainText("Happy Diwali, Asha.")
  await expect(dialog.getByLabel("Letter preview")).toContainText("Nine stars are hidden near home.")
  expect(outside).toEqual([])
})
