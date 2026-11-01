// before anything builds a material: one aerial haze shared by them all
import "./world/render/aerialFog"
import "./styles/global.css"
import { initPersonalization } from "./personalization"

/**
 * Start-up order matters: the personalization (names, letter, memories,
 * photos, models, music) is resolved first, then the game is imported, so
 * every module that reads it sees the final values.
 */
const start = async (): Promise<void> => {
  await initPersonalization()
  const [{ StrictMode, createElement }, { createRoot }, { default: App }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./App"),
  ])
  // QA helpers (window.__worldDev, ?debug) exist only in development builds,
  // or in a build made with VITE_DEV_TOOLS=1 for automated testing.
  if (import.meta.env.DEV || import.meta.env.VITE_DEV_TOOLS === "1") {
    const { installDevTools } = await import("./dev/devTools")
    installDevTools()
  }
  createRoot(document.getElementById("root")!).render(createElement(StrictMode, null, createElement(App)))
}

void start()
