import { describe, expect, it } from "vitest"
import { gpuLabel, isSoftwareRenderer } from "../src/game/render/gpuInfo"

describe("GPU detection", () => {
  it("recognises software rasterisers", () => {
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)")).toBe(true)
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true)
    expect(isSoftwareRenderer("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(true)
    expect(isSoftwareRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false)
    expect(isSoftwareRenderer("Apple M2")).toBe(false)
  })

  it("names the card without the driver noise", () => {
    expect(gpuLabel("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("NVIDIA GeForce RTX 4070")
    expect(gpuLabel("ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("Intel(R) UHD Graphics 620")
    expect(gpuLabel("Apple M2")).toBe("Apple M2")
    expect(gpuLabel("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)")).toBe("SwiftShader (software)")
  })
})
