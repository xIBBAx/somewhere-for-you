/** Validate the decoded GLBs, including skin weights, clip channels and winding. */
import { readFile, readdir, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
const modules = process.env.GLTF_TOOLS_MODULES || "node_modules"
const load = (p) => import(pathToFileURL(`${modules}/${p}`).href)
const { NodeIO } = await load("@gltf-transform/core/dist/index.js")
const { ALL_EXTENSIONS } = await load("@gltf-transform/extensions/dist/index.js")
const { MeshoptDecoder } = await load("meshoptimizer/index.js")
const { default: validator } = await load("gltf-validator/index.js")
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder })
const results = []
const folder = process.env.DEER_ASSET_DIR || "public/assets/deer"
for (const file of (await readdir(folder)).filter((x) => x.endsWith(".glb")).sort()) {
  const document = await io.readBinary(await readFile(`${folder}/${file}`)),
    root = document.getRoot()
  for (const ext of root.listExtensionsUsed()) if (ext.extensionName === "EXT_meshopt_compression") ext.dispose()
  const decoded = await io.writeBinary(document),
    report = await validator.validateBytes(decoded, { uri: file, maxIssues: 30 })
  let tested = 0,
    backward = 0
  for (const m of root.listMeshes())
    for (const p of m.listPrimitives()) {
      const pos = p.getAttribute("POSITION"),
        normal = p.getAttribute("NORMAL"),
        indices = p.getIndices()
      if (!pos || !normal || !indices || !p.getAttribute("JOINTS_0") || !p.getAttribute("WEIGHTS_0"))
        throw Error(`Incomplete deform mesh ${file}`)
      const a = [],
        b = [],
        c = [],
        n = []
      for (let k = 0; k < indices.getCount(); k += 3) {
        const id = [indices.getScalar(k), indices.getScalar(k + 1), indices.getScalar(k + 2)]
        pos.getElement(id[0], a)
        pos.getElement(id[1], b)
        pos.getElement(id[2], c)
        normal.getElement(id[0], n)
        const ab = b.map((v, j) => v - a[j]),
          ac = c.map((v, j) => v - a[j])
        const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]
        if (Math.hypot(...cross) < 1e-10) continue
        tested++
        if (cross.reduce((sum, v, j) => sum + v * n[j], 0) < -1e-9) backward++
      }
    }
  const item = {
    file,
    errors: report.issues.numErrors,
    warnings: report.issues.numWarnings,
    issues: report.issues.messages,
    triangles: tested,
    opposedNormals: backward,
    joints: root.listSkins()[0]?.listJoints().length,
    clips: root.listAnimations().map((a) => ({ name: a.getName(), channels: a.listChannels().length })),
  }
  results.push(item)
  console.log(file, `${item.errors} errors; ${item.warnings} warnings; ${backward}/${tested} opposed`)
}
await writeFile("/tmp/explorer-deer-qa/asset-validation.json", JSON.stringify(results, null, 2))
if (results.some((x) => x.errors || x.opposedNormals > x.triangles * 0.025)) process.exitCode = 1
