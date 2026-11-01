/** Attach to the visible WSLg browser; no second browser or viewport emulation.
 * Native CDP avoids Playwright trying to attach to Chromium's toolbar targets. */
import { writeFile } from "node:fs/promises"
export async function connect(
  endpoint = "http://127.0.0.1:9334",
  browser = false,
  match = /localhost:5174|workers\.dev/,
) {
  const targets = await (await fetch(`${endpoint}/json/${browser ? "version" : "list"}`)).json()
  const target = browser ? targets : targets.find((t) => t.type === "page" && match.test(t.url))
  if (!target) throw new Error("No game page in the visible browser")
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let id = 0
  const pending = new Map()
  const listeners = new Map()
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.method) listeners.get(message.method)?.(message.params)
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    clearTimeout(waiter.timer)
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
    else waiter.resolve(message.result)
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const key = ++id
      const timer = setTimeout(() => {
        pending.delete(key)
        reject(new Error(`${method}: 20s timeout`))
      }, 20000)
      pending.set(key, { resolve, reject, timer })
      ws.send(JSON.stringify({ id: key, method, params }))
    })
  return {
    send,
    on: (method, listener) => {
      listeners.set(method, listener)
      return () => listeners.delete(method)
    },
    async evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    },
    async screenshot(path) {
      const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })
      await writeFile(path, Buffer.from(result.data, "base64"))
    },
    async key(code, held = 120) {
      const key = code.startsWith("Key") ? code.slice(3).toLowerCase() : code === "Space" ? " " : code
      await send("Input.dispatchKeyEvent", { type: "keyDown", code, key })
      await new Promise((resolve) => setTimeout(resolve, held))
      await send("Input.dispatchKeyEvent", { type: "keyUp", code, key })
    },
    close: () => ws.close(),
  }
}
