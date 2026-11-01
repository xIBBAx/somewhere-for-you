import * as THREE from "three"
import { describe, expect, it, vi } from "vitest"
import { disposeFadeable, keepAerialSubject, makeFadeable } from "../src/world/render/aerialFog"

const shaderFor = (material: THREE.Material) => {
  const shader = { uniforms: {}, vertexShader: "void main() {}", fragmentShader: "void main() {\n#include <clipping_planes_fragment>\n}" } as unknown as Parameters<THREE.Material["onBeforeCompile"]>[0]
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
  return shader
}
const draw = (mesh: THREE.Mesh) => mesh.onBeforeRender({} as THREE.WebGLRenderer, new THREE.Scene(), new THREE.Camera(), mesh.geometry, mesh.material as THREE.Material, {} as THREE.Group)

describe("animal model fade lifecycle", () => {
  it("keeps travelling subjects out of the terrain dissolve without changing shared materials or distance fades", () => {
    const source = new THREE.MeshStandardMaterial(), geometry = new THREE.BoxGeometry()
    const a = new THREE.Group(), b = new THREE.Group()
    const subject = new THREE.Mesh(geometry, source), ordinary = new THREE.Mesh(geometry, source)
    a.add(subject); b.add(ordinary)
    makeFadeable(a); makeFadeable(b); keepAerialSubject(a)
    const kept = subject.material as THREE.MeshStandardMaterial
    expect(kept.defines?.AERIAL_KEEP).toBe(1)
    expect(kept.fog).toBe(true)
    expect((ordinary.material as THREE.MeshStandardMaterial).defines?.AERIAL_KEEP).toBeUndefined()
    expect(source.defines?.AERIAL_KEEP).toBeUndefined()
    a.userData.fade = 0.6
    const shader = shaderFor(kept); draw(subject)
    expect(shader.uniforms.uModelFade.value[0]).toBeCloseTo(0.6)
    const late = new THREE.Mesh(geometry, source); a.add(late)
    makeFadeable(a); keepAerialSubject(a)
    expect((late.material as THREE.MeshStandardMaterial).defines?.AERIAL_KEEP).toBe(1)
    disposeFadeable(a); disposeFadeable(b); source.dispose(); geometry.dispose()
  })
  it("isolates two instances sharing textures and live coat uniforms, including consecutive draws", () => {
    const texture = new THREE.Texture(), wet = { value: 0.2 }
    const source = new THREE.MeshStandardMaterial({ map: texture })
    source.userData.coat = { uWet: wet }
    source.onBeforeCompile = shader => { shader.uniforms.uWet = wet }
    const a = new THREE.Group(), b = new THREE.Group()
    const ma = new THREE.Mesh(new THREE.BoxGeometry(), source), mb = new THREE.Mesh(ma.geometry, source)
    a.add(ma); b.add(mb); a.userData.fade = 0.8; b.userData.fade = 0
    makeFadeable(a); makeFadeable(b)
    const sa = shaderFor(ma.material as THREE.Material), sb = shaderFor(mb.material as THREE.Material)
    draw(ma); draw(mb)
    expect(sa.uniforms.uModelFade.value[0]).toBeCloseTo(0.8)
    expect(sb.uniforms.uModelFade.value[0]).toBe(0)
    expect(sa.uniforms.uModelFade).not.toBe(sb.uniforms.uModelFade)
    expect((ma.material as THREE.MeshStandardMaterial).map).toBe(texture)
    expect(sa.uniforms.uWet).toBe(wet)
    wet.value = 0.9
    expect(sa.uniforms.uWet.value).toBe(0.9)
    expect((ma.material as THREE.Material).userData).not.toBe(source.userData)
    disposeFadeable(a); disposeFadeable(b)
    ma.geometry.dispose(); source.dispose(); texture.dispose()
  })

  it("includes late LODs once, preserves draw callbacks and releases only owned materials", () => {
    const root = new THREE.Group(), source = new THREE.MeshStandardMaterial()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), source)
    const original = vi.fn(); mesh.onBeforeRender = original
    root.add(mesh); makeFadeable(root)
    const material = mesh.material as THREE.Material, dispose = vi.spyOn(material, "dispose"), sharedDispose = vi.spyOn(source, "dispose")
    const late = new THREE.Mesh(mesh.geometry, source); root.add(late)
    makeFadeable(root); makeFadeable(root)
    expect(late.material).toBe(material)
    draw(mesh); expect(original).toHaveBeenCalledOnce()
    disposeFadeable(root); disposeFadeable(root)
    expect(dispose).toHaveBeenCalledOnce(); expect(sharedDispose).not.toHaveBeenCalled()
    expect(mesh.material).toBe(source); expect(mesh.onBeforeRender).toBe(original)
    mesh.geometry.dispose(); source.dispose()
  })

  it("dissolves shadows with the same owner and preserves custom feather deformation", () => {
    const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    mesh.castShadow = true
    const feather = new THREE.MeshDepthMaterial()
    feather.onBeforeCompile = shader => { shader.vertexShader += "\n// feather bending" }
    mesh.customDepthMaterial = feather; root.add(mesh); root.userData.fade = 0.6
    makeFadeable(root)
    const color = shaderFor(mesh.material as THREE.Material), depth = shaderFor(mesh.customDepthMaterial!)
    draw(mesh)
    expect(depth.uniforms.uModelFade).toBe(color.uniforms.uModelFade)
    expect(depth.vertexShader).toContain("feather bending")
    expect(depth.fragmentShader).toContain("discard")
    expect(depth.uniforms.uModelFade.value[0]).toBeCloseTo(0.6)
    const dispose = vi.spyOn(mesh.customDepthMaterial!, "dispose")
    disposeFadeable(root)
    expect(dispose).toHaveBeenCalledOnce(); expect(mesh.customDepthMaterial).toBe(feather)
    mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); feather.dispose()
  })
})
