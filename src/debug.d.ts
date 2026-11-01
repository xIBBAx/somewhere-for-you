export {}

declare global {
  interface Window {
    __worldRenderInfo?: () => import("./game/GameCanvas").RenderInfo
    __worldCaptureFrame?: () => string
    __worldSetCaptureStepping?: (enabled: boolean) => void
    /** dev QA helpers, see src/dev/devTools.ts (systems register their own) */
    __worldDev?: Record<string, unknown> & Partial<import("./world/life/lifeDebug").WorldDevApi>
    __world: {
      teleport: (id: string) => void
      teleportTo: (x: number, z: number) => void
      unlockAll: () => void
      jumpToFinale: () => void
      catFenceTest: () => void
      catJumpTest: () => void
      animalThreatTest: () => void
      animalForceDecision: () => void
      airplane: () => void
      aircraft: (type?: string) => void
      reset: () => void
    }
    __worldRaw: import("./ui/DebugPanel").WorldRawApi
  }
}
