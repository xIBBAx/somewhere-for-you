/**
 * Which GPU is actually drawing the game. The canvas asks the browser for the
 * high-performance GPU, but a browser with hardware acceleration off, or a
 * laptop that hands it the integrated GPU, can still end up on a software
 * rasteriser, which makes everything crawl. ?debug shows the name; a software
 * renderer also gets a console warning saying how to fix it.
 */
export type GpuInfo = { vendor: string; renderer: string; software: boolean }

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render driver|lavapipe/i

export const isSoftwareRenderer = (renderer: string): boolean => SOFTWARE.test(renderer)

/** Shorten "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)". */
export const gpuLabel = (renderer: string): string => {
  const software = SOFTWARE.exec(renderer)
  if (software) return `${software[0]} (software)`
  const angle = /^ANGLE \([^,]+,\s*(.*)\)$/.exec(renderer.trim())
  if (!angle) return renderer.trim()
  return angle[1]
    .replace(/,[^,]*$/, "") // ", D3D11"
    .replace(/\s*\(0x[0-9a-f]+\).*$/i, "") // device id and everything after
    .replace(/\s+(Direct3D|OpenGL|Vulkan|Metal).*$/i, "")
    .trim()
}

export const readGpu = (gl: WebGLRenderingContext | WebGL2RenderingContext): GpuInfo => {
  let vendor = ""
  let renderer = ""
  // Chrome and Safari keep the real names behind this extension; Firefox
  // reports them directly and deprecates the extension.
  const ext = /firefox/i.test(navigator.userAgent) ? null : gl.getExtension("WEBGL_debug_renderer_info")
  if (ext) {
    vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? "")
    renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "")
  }
  vendor ||= String(gl.getParameter(gl.VENDOR) ?? "")
  renderer ||= String(gl.getParameter(gl.RENDERER) ?? "")
  return { vendor, renderer, software: isSoftwareRenderer(renderer) }
}

let warned = false

export const warnIfSoftware = (gpu: GpuInfo): void => {
  if (!gpu.software || warned) return
  warned = true
  console.warn(
    `This world is rendering without a graphics card (${gpu.renderer}). ` +
      "Turn on hardware acceleration in the browser settings, and on a laptop with two GPUs set the browser to " +
      "'High performance' in the operating system's graphics settings.",
  )
}
