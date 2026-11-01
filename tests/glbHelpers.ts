/** Test helper: GLB bytes without their textures (three.js cannot decode images in Node). */
export const withoutTextures = (bytes: Buffer): ArrayBuffer => {
  const jsonLength = bytes.readUInt32LE(12)
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"))
  delete json.textures
  delete json.images
  delete json.samplers
  for (const m of json.materials ?? []) {
    delete m.normalTexture
    delete m.occlusionTexture
    delete m.emissiveTexture
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture
      delete m.pbrMetallicRoughness.metallicRoughnessTexture
    }
  }
  if (json.extensionsUsed) json.extensionsUsed = json.extensionsUsed.filter((e: string) => e !== "EXT_texture_webp")
  let text = JSON.stringify(json)
  while (text.length % 4) text += " "
  const head = Buffer.alloc(20)
  const rest = bytes.subarray(20 + jsonLength)
  head.writeUInt32LE(0x46546c67, 0)
  head.writeUInt32LE(2, 4)
  head.writeUInt32LE(20 + text.length + rest.length, 8)
  head.writeUInt32LE(text.length, 12)
  head.writeUInt32LE(0x4e4f534a, 16)
  const out = Buffer.concat([head, Buffer.from(text, "utf8"), rest])
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
}
