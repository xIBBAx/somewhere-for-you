/** Offline compression; preserve metre-space positions used by coat shaders. */
import { readdir, stat, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
const modules = process.env.GLTF_TOOLS_MODULES || "node_modules"
const load = (p) => import(pathToFileURL(`${modules}/${p}`).href)
const { NodeIO } = await load("@gltf-transform/core/dist/index.js")
const { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } = await load(
  "@gltf-transform/extensions/dist/index.js",
)
const { dedup, prune, reorder, quantize } = await load("@gltf-transform/functions/dist/index.js")
const { MeshoptEncoder, MeshoptDecoder } = await load("meshoptimizer/index.js")
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready])
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder })
const folder = process.env.DEER_ASSET_DIR || "public/assets/deer",
  manifest = []
for (const name of (await readdir(folder)).filter((n) => n.endsWith(".glb")).sort()) {
  const path = `${folder}/${name}`,
    before = (await stat(path)).size,
    doc = await io.read(path)
  await doc.transform(
    dedup(),
    prune(),
    reorder({ encoder: MeshoptEncoder, target: "size" }),
    quantize({
      pattern: /^(COLOR|NORMAL|WEIGHTS)/,
      patternTargets: /^NORMAL$/,
      quantizeNormal: 12,
      quantizeWeight: 12,
    }),
  )
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
  // NORMAL-only quantization still requires this extension even though the
  // POSITION accessor stays Float32 for procedural coat coordinates.
  doc.createExtension(KHRMeshQuantization).setRequired(true)
  const bytes = await io.writeBinary(doc)
  await writeFile(path, bytes)
  const check = await io.read(path),
    root = check.getRoot()
  if (root.listSkins().length < 1 || root.listAnimations().length < 1) throw Error(`Rig or animation lost: ${name}`)
  const triangles = root
    .listMeshes()
    .reduce((sum, m) => sum + m.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0)
  manifest.push({
    file: name,
    bytes: bytes.byteLength,
    before,
    triangles,
    skins: root.listSkins().length,
    joints: Math.max(...root.listSkins().map((s) => s.listJoints().length)),
    clips: root.listAnimations().map((a) => a.getName()),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  })
  console.log(`${name}: ${before} -> ${bytes.byteLength}`)
}
await writeFile(process.env.DEER_MANIFEST || "asset-pipeline/deer/asset-manifest.json", JSON.stringify(manifest, null, 2) + "\n")
console.log(
  "Total",
  manifest.reduce((s, a) => s + a.before, 0),
  "->",
  manifest.reduce((s, a) => s + a.bytes, 0),
)
