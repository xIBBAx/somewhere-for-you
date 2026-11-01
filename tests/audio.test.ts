import { beforeEach, describe, expect, it, vi } from "vitest"

const { created, files } = vi.hoisted(() => ({
  created: [] as unknown[],
  files: { ambient: undefined, memoryChime: undefined, bell: undefined } as Record<string, string | undefined>,
}))

vi.mock("../src/content/assets", () => ({ assets: { audio: files } }))

vi.mock("howler", () => ({
  Howler: { mute: vi.fn() },
  Howl: class MockHowl {
    private level = 0

    constructor() {
      created.push(this)
    }

    state(): string {
      return "loaded"
    }

    playing(): boolean {
      return false
    }

    play(): number {
      return 1
    }

    pause(): void {}

    unload(): void {}

    volume(): number {
      return this.level
    }

    fade(_from: number, to: number): void {
      this.level = to
    }
  },
}))

describe("background audio", () => {
  beforeEach(() => {
    vi.resetModules()
    created.splice(0, created.length)
    for (const key of Object.keys(files)) files[key] = `/assets/audio/${key}.mp3`
  })

  it("waits for a user gesture, then reuses one Howler instance", async () => {
    const { getAudioDiagnostics, initAudio, setAmbient } = await import("../src/game/audio/audio")
    setAmbient(true)
    expect(created).toHaveLength(0)
    initAudio()
    expect(created).toHaveLength(1)
    setAmbient(true)
    setAmbient(true)
    expect(created).toHaveLength(1)
    expect(getAudioDiagnostics().ambientInstancesCreated).toBe(1)
  })

  it("never requests absent optional music or interaction samples", async () => {
    for (const key of Object.keys(files)) files[key] = undefined
    const { getAudioDiagnostics, initAudio, setAmbient, sfx } = await import("../src/game/audio/audio")
    initAudio()
    setAmbient(true)
    sfx.chime()
    sfx.bell()
    expect(created).toHaveLength(0)
    expect(getAudioDiagnostics().ambientInstancesCreated).toBe(0)
  })
})
