import { debugEnabled } from "../dev/debugFlag"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Suspense, useEffect, useRef } from "react"
import * as THREE from "three"
import "./render/colorGrade"
import { World } from "./World"
import { RenderQuality } from "./RenderQuality"
import { PostFX, postRT } from "./render/PostFX"
import { readGpu, warnIfSoftware } from "./render/gpuInfo"
import { worldStreamRT } from "../world/worldRuntime"
import { explorerMotionRT } from "./characters/ExplorerCharacter"
import { companionMotionRT } from "./characters/CompanionCharacter"
import { renderDpr } from "../state/qualityStore"
import { loadVegetationLibrary } from "../world/render/vegetationLibrary"
import { prepareScatterVisibility } from "../world/render/WorldScatter"
import { bootProgress } from "./bootProgress"

/**
 * The R3F canvas. The third-person camera takes over on the first frame;
 * Render at the display's native resolution for crisp geometry and text.
 */
export const GameCanvas = ({
  cinematic,
  rest = false,
  onReady,
}: {
  cinematic: boolean
  /** the world is ready but hidden behind the letter: stop drawing until she enters */
  rest?: boolean
  onReady: () => void
}): React.ReactElement => {
  return (
    <Canvas
      shadows="percentage"
      dpr={renderDpr(window.devicePixelRatio)}
      camera={{ fov: 40, near: 0.3, far: 520, position: [0, 9, 33] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl, scene }) => {
        gl.domElement.tabIndex = 0
        gl.domElement.setAttribute("aria-label", "Explore the world")
        gl.toneMapping = THREE.CustomToneMapping
        gl.toneMappingExposure = 0.92
        scene.background = new THREE.Color("#9fd8f4")
        warnIfSoftware(readGpu(gl.getContext()))
      }}
    >
      <Suspense fallback={null}>
        <World cinematic={cinematic} />
        <RenderQuality />
        <PostFX />
        <SceneReady onReady={onReady} />
        <RestWhileHidden rest={rest} />
        <RenderDiagnostics />
      </Suspense>
    </Canvas>
  )
}

/**
 * Behind the letter the world keeps loading, streaming and compiling at full
 * speed; once it is warm there is nothing to see until she enters, so the
 * render loop rests (phones stay cool and the letter scrolls smoothly).
 */
const RestWhileHidden = ({ rest }: { rest: boolean }): null => {
  const setFrameloop = useThree((s) => s.setFrameloop)
  useEffect(() => {
    if (!rest) return
    setFrameloop("never")
    return () => setFrameloop("always")
  }, [rest, setFrameloop])
  return null
}

/** Suspense has resolved and the complete scene has drawn before Enter enables. */
const SceneReady = ({ onReady }: { onReady: () => void }): null => {
  const { gl, scene, camera } = useThree()
  const notified = useRef(false)
  const pending = useRef<number | null>(null)
  const alive = useRef(true)
  useFrame(() => {
    if (notified.current) return
    if (!worldStreamRT.spawnReady || !explorerMotionRT.modelSettled || !companionMotionRT.modelSettled) return
    notified.current = true
    bootProgress.worldReady()
    const warm = async (): Promise<void> => {
      await Promise.all([loadVegetationLibrary(), document.fonts.ready])
      if (!alive.current) return
      const reveal = scene.getObjectByName("world-reveal")
      const streamed = scene.getObjectByName("streamed-world-reveal")
      const temporary = scene.getObjectByName("cinematic-temporary-set")
      const visible = [reveal, streamed, scene.getObjectByName("scatter-world-reveal"), scene.getObjectByName("explorer"), scene.getObjectByName("companion-character"), scene.getObjectByName("cat-companion")]
        .filter((object): object is THREE.Object3D => Boolean(object))
      const saved = visible.map(object => object.visible)
      const tempVisible = temporary?.visible
      // The cloud crossing briefly has both lighting rigs visible. Prepare
      // that variant as well as the normal world before enabling the journey.
      const target = new THREE.WebGLRenderTarget(32, 32)
      const warmCamera = camera.clone()
      const restore = (): void => {
        visible.forEach((object, i) => { object.visible = saved[i] })
        if (temporary) temporary.visible = tempVisible!
      }
      try {
        for (const overlap of temporary ? [true, false] : [false]) {
          visible.forEach(object => { object.visible = true })
          if (temporary) temporary.visible = overlap
          const compiling = gl.compileAsync(scene, camera)
          restore()
          await compiling
          if (!alive.current) return
          bootProgress.warming(overlap ? 0.35 : 0.7)
          for (const [x, y, z, tx, ty, tz] of [[0, 3, 28, 0, 1, 22.5], [12, 14, 25, 0, 0, 0], [0, 3, 8, 0, 1, -10]]) {
            // Small offscreen draws prepare texture uploads, shadows and skins.
            // Spread those draws over loading frames, behind the opaque cover.
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
            if (!alive.current) return
            const previousTarget = gl.getRenderTarget()
            warmCamera.position.set(x, y, z)
            warmCamera.lookAt(tx, ty, tz)
            warmCamera.updateMatrixWorld(true)
            prepareScatterVisibility(warmCamera)
            visible.forEach(object => { object.visible = true })
            if (temporary) temporary.visible = overlap
            try { gl.setRenderTarget(target); gl.render(scene, warmCamera) }
            finally { gl.setRenderTarget(previousTarget); restore() }
          }
        }
      } finally {
        restore()
        target.dispose()
      }
      bootProgress.warmed()
      pending.current = requestAnimationFrame(onReady)
    }
    void warm().catch(error => console.error("The world could not prepare its shaders", error))
  })
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (pending.current !== null) cancelAnimationFrame(pending.current)
      pending.current = null
      notified.current = false
    }
  }, [])
  return null
}

export type RenderInfo = {
  fps: number
  gpuMs: number
  captureStepping: boolean
  calls: number
  triangles: number
  lines: number
  points: number
  geometries: number
  textures: number
  programs: number
  sceneObjects: number
  cinematicSets: number
  /** the GPU actually drawing, and whether it is a software rasteriser */
  gpu: string
  softwareGpu: boolean
}

/** Read-only renderer counters, exposed only for ?debug visual/performance QA. */
const RenderDiagnostics = (): null => {
  const { gl, scene, camera } = useThree()
  const timing = useRef({ time: 0, frames: 0, fps: 0, captureStepping: false })
  useFrame(() => {
    const sample = timing.current
    if (sample.captureStepping) return
    const now = performance.now()
    sample.frames++
    if (sample.time === 0) {
      sample.time = now
      sample.frames = 0
    } else if (now - sample.time >= 1000) {
      // Renderer.frame counts shadow/postprocessing passes as well. Count
      // presented game ticks so High's extra passes cannot inflate FPS.
      sample.fps = sample.frames * 1000 / (now - sample.time)
      sample.time = now
      sample.frames = 0
    }
  })
  useEffect(() => {
    if (!debugEnabled()) return
    const debugWindow = window as typeof window & {
      __worldRenderInfo?: () => RenderInfo
      __worldCaptureFrame?: () => string
      __worldSetCaptureStepping?: (enabled: boolean) => void
      __worldScene?: THREE.Scene
      __worldGL?: THREE.WebGLRenderer
    }
    const renderFrame = gl.render.bind(gl)
    // GPU frame time (ms) from timer queries, smoothed; vsync-quantised fps
    // hides real headroom, so performance work is measured with this.
    const context = gl.getContext() as WebGL2RenderingContext
    const timerExt = context.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
    const pendingQueries: WebGLQuery[] = []
    let gpuMs = 0
    const timedRender = (s: THREE.Object3D, c: THREE.Camera): void => {
      // Drain completed queries even when the queue is full. Returning before
      // polling left GPU timing frozen after the first slow loading frame.
      while (pendingQueries.length && context.getQueryParameter(pendingQueries[0], context.QUERY_RESULT_AVAILABLE)) {
        const done = pendingQueries.shift() as WebGLQuery
        if (timerExt && !context.getParameter(timerExt.GPU_DISJOINT_EXT)) {
          const ms = (context.getQueryParameter(done, context.QUERY_RESULT) as number) / 1e6
          gpuMs = gpuMs === 0 ? ms : gpuMs * 0.9 + ms * 0.1
        }
        context.deleteQuery(done)
      }
      if (!timerExt || pendingQueries.length >= 4) { renderFrame(s, c); return }
      const query = context.createQuery()
      if (!query) { renderFrame(s, c); return }
      context.beginQuery(timerExt.TIME_ELAPSED_EXT, query)
      renderFrame(s, c)
      context.endQuery(timerExt.TIME_ELAPSED_EXT)
      pendingQueries.push(query)
    }
    if (timerExt) gl.render = timedRender
    debugWindow.__worldScene = scene
    debugWindow.__worldGL = gl
    debugWindow.__worldSetCaptureStepping = (enabled) => {
      // Only the inspection harness uses this: useFrame still updates every
      // simulation tick, while software WebGL draws just the requested frames.
      gl.render = enabled ? () => undefined : timerExt ? timedRender : renderFrame
      timing.current.captureStepping = enabled
      timing.current.time = 0
      timing.current.fps = 0
    }
    // Capture the real WebGL canvas synchronously while Playwright's clock is
    // paused. This avoids compositor waits and does not alter simulation state.
    // On High the image players see comes out of the composer, which owns the
    // colour grade (the renderer's own tone mapping is off meanwhile), so the
    // capture goes through it too; stepping stubs gl.render, so the real one
    // is lent back for this one frame.
    debugWindow.__worldCaptureFrame = () => {
      const stub = gl.render
      gl.render = renderFrame
      try {
        if (postRT.composer) postRT.composer.render()
        else renderFrame(scene, camera)
      } finally {
        gl.render = stub
      }
      return gl.domElement.toDataURL("image/png")
    }
    const gpu = readGpu(context)
    debugWindow.__worldRenderInfo = () => {
      let sceneObjects = 0
      scene.traverse(() => sceneObjects++)
      return {
        fps: timing.current.fps,
        gpuMs,
        captureStepping: timing.current.captureStepping,
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        lines: gl.info.render.lines,
        points: gl.info.render.points,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        programs: gl.info.programs?.length ?? 0,
        sceneObjects,
        cinematicSets: scene.getObjectByName("cinematic-temporary-set") ? 1 : 0,
        gpu: gpu.renderer,
        softwareGpu: gpu.software,
      }
    }
    return () => {
      delete debugWindow.__worldRenderInfo
      delete debugWindow.__worldCaptureFrame
      delete debugWindow.__worldSetCaptureStepping
      delete debugWindow.__worldScene
      delete debugWindow.__worldGL
      gl.render = renderFrame
      for (const query of pendingQueries) context.deleteQuery(query)
    }
  }, [gl, scene, camera])
  return null
}
