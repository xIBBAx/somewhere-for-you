import * as THREE from "three"
import { groundResources } from "./groundMaterial"

/** Material-only detailing for existing hard ground slabs; geometry is untouched. */
export const makeBuiltGroundMaterial = (color: string): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.94 })
  material.onBeforeCompile = shader => {
    shader.uniforms.gWetness = groundResources().wetness
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 gPavingWorld;")
    shader.vertexShader = shader.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\ngPavingWorld=(modelMatrix*vec4(transformed,1.)).xyz;")
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
      varying vec3 gPavingWorld;
      uniform float gWetness;
      float pavingHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      vec2 pavingCells(vec2 p) {
        vec2 cell=floor(p), local=fract(p);
        float first=10., second=10., tone=0.;
        for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
          vec2 offset=vec2(float(x),float(y));
          vec2 seed=vec2(pavingHash(cell+offset),pavingHash(cell+offset+47.));
          float distance=length(offset+.5+(seed-.5)*.55-local);
          if(distance<first) { second=first;first=distance;tone=seed.x; }
          else second=min(second,distance);
        }
        return vec2(second-first,tone);
      }
    `)
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      vec2 cells=pavingCells(gPavingWorld.xz*3.2);
      float joint=1.-smoothstep(.015,.06,cells.x);
      float visible=1.-smoothstep(.12,.6,length(fwidth(gPavingWorld.xz*3.2)));
      diffuseColor.rgb*=mix(.82,1.06,cells.y)*(1.-joint*.22*visible)*(1.-gWetness*.18);
    `)
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor=.94-gWetness*.18;")
  }
  material.customProgramCacheKey = () => "ground-paving-v1"
  return material
}
