import * as THREE from "three"
import { groundHistory, WEAR_RESOLUTION } from "./groundHistory"
import { makeSurfaceField, SURFACE_RESOLUTION } from "./groundSurface"

const dataTexture = (data: Uint8Array, size: number): THREE.DataTexture => {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}
let shared: ReturnType<typeof createResources> | undefined
const createResources = () => ({
  surface: { value: dataTexture(makeSurfaceField(), SURFACE_RESOLUTION) },
  history: { value: dataTexture(groundHistory.field, WEAR_RESOLUTION) },
  wetness: { value: 0 },
  /** snow lying on the ground (weatherRT.snowCover) */
  snow: { value: 0 },
  rain: { value: 0 },
  surfaceWater: { value: 0 },
  skyColor: { value: new THREE.Color("#a8cbd7") },
  time: { value: 0 },
  wind: { value: new THREE.Vector2(0.05, 0) },
  gardenOpen: { value: 0 },
})
export const groundResources = (): ReturnType<typeof createResources> => shared ??= createResources()

export const groundCommon = /* glsl */`
uniform sampler2D gSurface;
uniform sampler2D gHistory;
uniform float gWetness;
varying vec3 gWorld;
vec2 groundUV(vec2 p) { return (p + vec2(48.,54.)) / vec2(96.,104.); }
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
float gNoise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(gHash(i),gHash(i+vec2(1,0)),f.x),mix(gHash(i+vec2(0,1)),gHash(i+1.),f.x),f.y);
}
vec3 groundColor(vec3 p, vec4 field, vec4 traffic) {
  float macro=gNoise(p.xz*.38), meso=gNoise(p.xz*3.7 + macro*2.);
  float micro=gNoise(p.xz*78.);
  float visible=1.-smoothstep(.4,1.6,length(fwidth(p.xz*78.)));
  float worn=smoothstep(.22,.78,traffic.g);
  vec3 grass=mix(vec3(.12,.225,.073),vec3(.245,.34,.115),macro*.65+meso*.35);
  vec3 soil=mix(vec3(.18,.115,.065),vec3(.31,.224,.132),meso*.55+macro*.45);
  vec3 sand=mix(vec3(.45,.355,.215),vec3(.62,.50,.315),macro*.55+meso*.45);
  vec3 col=mix(grass,soil,max(field.g,worn));
  col=mix(col,sand,field.r*.87);
  float damp=clamp(field.b+gWetness*.65,0.,1.);
  col*=mix(1.,.65,damp*max(field.r,field.g));
  col*=1.+(micro-.5)*.17*visible;
  // Fine dead blades and scattered bare soil are substrate variation, not props.
  float organic=gNoise(p.xz*19.+meso*2.);
  col=mix(col,soil*.86,smoothstep(.73,.91,organic)*(1.-max(field.r,field.g))*.32);
  float cover=(1.-max(field.r,field.g))*(1.-worn);
  col=mix(col,col*vec3(.95,.97,1.02),traffic.r*cover*.22);
  return col;
}
float groundRelief(vec3 p, vec4 field, float disturbance) {
  float micro=gNoise(p.xz*66.);
  float aa=1.-smoothstep(.3,1.6,length(fwidth(p.xz*66.)));
  float clod=gNoise(p.xz*14.)*.0025;
  float ripple=sin(dot(p.xz,vec2(8.,23.))+gNoise(p.xz*.8)*3.);
  float rippleAA=1.-smoothstep(.5,2.,length(fwidth(p.xz*23.)));
  return (micro*.0017*aa+clod*field.g+ripple*.0024*field.r*rippleAA)*(1.-disturbance);
}
vec3 groundBump(vec3 n, float h) {
  vec3 sx=dFdx(-vViewPosition), sy=dFdy(-vViewPosition);
  vec3 r1=cross(sy,n), r2=cross(n,sx);
  float det=dot(sx,r1);
  return normalize(abs(det)*n-sign(det)*(dFdx(h)*r1+dFdy(h)*r2));
}
`

const printFunctions = /* glsl */`
varying vec4 gPrint;
varying vec2 gPrintUV;
varying float gClarity;
float ellipse(vec2 p, vec2 c, vec2 r) { return length((p-c)/r)-1.; }
float printShape(vec2 uv) {
  vec2 p=(uv-.5)*2.; p.x*=gPrint.y;
  float shape=gPrint.x, d=2.;
  if(shape<.5) {
    d=min(ellipse(p,vec2(.02,.31),vec2(.62,.55)),ellipse(p,vec2(-.04,-.46),vec2(.47,.31)));
    d=min(d,ellipse(p,vec2(.06,-.03),vec2(.39,.40)));
  } else if(shape<1.5) {
    d=ellipse(p,vec2(0.,-.26),vec2(.49,.44));
    for(int i=0;i<4;i++) { float a=(float(i)-1.5)*.49; d=min(d,ellipse(p,vec2(sin(a)*.69,cos(a)*.69-.12),vec2(.20,.24))); }
  } else if(shape<2.5) {
    d=ellipse(p,vec2(0.,.02),vec2(.73,.84));
    d=max(d,-ellipse(p,vec2(0.,-.25),vec2(.42,.55)));
  } else if(shape<3.5) {
    d=min(ellipse(p,vec2(-.31,.08),vec2(.28,.80)),ellipse(p,vec2(.31,.08),vec2(.28,.80)));
  } else if(shape<4.5) {
    for(int i=0;i<3;i++) {
      float a=(float(i)-1.)*.72;
      vec2 q=mat2(cos(a),-sin(a),sin(a),cos(a))*p;
      d=min(d,ellipse(q,vec2(0.,.30),vec2(.11,.57)));
    }
    d=min(d,ellipse(p,vec2(0.,-.36),vec2(.10,.30)));
  } else if(shape<5.5) {
    d=ellipse(p,vec2(0.,-.1),vec2(.49,.83));
  } else if(shape<6.5) {
    d=ellipse(p,vec2(0.,-.25),vec2(.51,.49));
    for(int i=0;i<4;i++) { float a=(float(i)-1.5)*.35; d=min(d,ellipse(p,vec2(a,.48-abs(a)*.3),vec2(.14,.38))); }
  } else {
    d=max(abs(p.x)-(.17+.55*(p.y+.8)/1.6),max(p.y-.62,-p.y-.8));
    for(int i=0;i<3;i++) d=min(d,ellipse(p,vec2((float(i)-1.)*.52,.57),vec2(.18,.22)));
  }
  return d;
}
`

export const makeGroundMaterial = (prints = false): THREE.MeshStandardMaterial => {
  const resources = groundResources()
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, color: "white", transparent: prints, depthWrite: !prints })
  if (prints) { material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1 }
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { gSurface: resources.surface, gHistory: resources.history, gWetness: resources.wetness })
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\nvarying vec3 gWorld;${prints ? "attribute vec4 printData; attribute float printClarity; varying vec4 gPrint; varying vec2 gPrintUV; varying float gClarity;" : ""}`)
    shader.vertexShader = shader.vertexShader.replace("#include <worldpos_vertex>", `#include <worldpos_vertex>\ngWorld=(modelMatrix*vec4(transformed,1.)).xyz;${prints ? "gPrint=printData;gPrintUV=uv;gClarity=printClarity;" : ""}`)
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>\n${groundCommon}${prints ? printFunctions : ""}`)
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      vec4 field=texture2D(gSurface,groundUV(gWorld.xz));
      vec4 traffic=texture2D(gHistory,groundUV(gWorld.xz));
      float impression=0.; float printHeight=0.;
      ${prints ? `
      float d=printShape(gPrintUV);
      float aged=1.-gPrint.w;
      float breakup=gNoise(gWorld.xz*95.);
      d+=(breakup-.5)*(.08+aged*.55);
      float edge=.07+aged*.22;
      impression=1.-smoothstep(-edge,edge,d);
      float rim=exp(-pow((d-.07)/(.13+aged*.13),2.));
      float partial=mix(1.,smoothstep(aged*.68,aged*.68+.20,breakup),aged*.85);
      float lod=1.-smoothstep(9.,21.,length(vViewPosition));
      diffuseColor.a=(1.-smoothstep(.28,.42,d))*gClarity*lod*partial;
      if(diffuseColor.a<.006) discard;
      printHeight=(-impression+rim*.22)*gPrint.z*mix(.18,1.,gPrint.w);
      ` : ""}
      diffuseColor.rgb=groundColor(gWorld,field,traffic);
      ${prints ? "diffuseColor.rgb*=1.-impression*.14*gPrint.w;" : ""}
    `)
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\nroughnessFactor=clamp(.96-(field.b+gWetness*.65)*max(field.r,field.g)*.29-impression*.045,.58,.98);`)
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\nnormal=groundBump(normal,groundRelief(gWorld,field,max(impression,traffic.r*.5))+printHeight);`)
  }
  material.customProgramCacheKey = () => `ground-v1-${prints ? "prints" : "terrain"}`
  return material
}

/** Contact tint comes from its actual substrate, not the finite home map.
 * One lit, transparent batch covers shoes, paws, hooves and hands everywhere. */
export const makeWorldTrackMaterial = (): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.94, vertexColors: true, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
      attribute vec4 printData; attribute float printClarity;
      varying vec4 gPrint; varying vec2 gPrintUV; varying float gClarity;`)
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      gPrint=printData; gPrintUV=uv; gClarity=printClarity;`)
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>\n${printFunctions}`)
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      float d=printShape(gPrintUV);
      float edge=max(.035,fwidth(d)*1.3)+(1.-gPrint.w)*.10;
      float impression=1.-smoothstep(-edge,edge,d);
      float lod=1.-smoothstep(13.,28.,length(vViewPosition));
      diffuseColor.a=impression*gClarity*lod;
      if(diffuseColor.a<.006) discard;
      diffuseColor.rgb*=1.-impression*.10*gPrint.w;`)
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
      vec3 sx=dFdx(-vViewPosition), sy=dFdy(-vViewPosition);
      vec3 r1=cross(sy,normal), r2=cross(normal,sx);
      float det=dot(sx,r1);
      float relief=-impression*gPrint.z;
      normal=normalize(abs(det)*normal-sign(det)*(dFdx(relief)*r1+dFdy(relief)*r2));`)
  }
  material.customProgramCacheKey = () => "world-contact-tracks-v1"
  return material
}
