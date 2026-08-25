import { createHash } from "node:crypto"
import { lstat, readFile, realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"

const root = resolve(import.meta.dirname, "../..")
const dir = join(root, "lib", "fiscal", "xsd", "inutilizacao")
const schemaRoot = join(root, "lib", "fiscal", "xsd", "schemas", "PL_010d_v1.03", "NFe")
const pl010eTipos = join(root, "lib", "fiscal", "xsd", "schemas", "PL_010e_v1.02", "NFe", "tiposBasico_v4.00.xsd")
const pl010eDsig = join(root, "lib", "fiscal", "xsd", "schemas", "PL_010e_v1.02", "NFe", "xmldsig-core-schema_v1.01.xsd")

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function regularInside(directory, path) {
  const [directoryReal, info] = await Promise.all([realpath(directory), lstat(path)])
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Artefato não regular: ${basename(path)}`)
  const pathReal = await realpath(path)
  const rel = relative(directoryReal, pathReal)
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Escape de path: ${basename(path)}`)
  return readFile(pathReal)
}

const manifestBytes = await regularInside(dir, join(dir, "manifest.json"))
const manifestHashLine = (await readFile(join(dir, "manifest.sha256"), "utf8")).trim()
const match = manifestHashLine.match(/^([a-f0-9]{64})\s+manifest\.json$/)
if (!match || match[1] !== sha256(manifestBytes)) throw new Error("Hash do manifesto de inutilização divergente.")
const manifest = JSON.parse(manifestBytes.toString("utf8"))
if (manifest.layout.package !== "PL_010d_v1.03") throw new Error("Pacote de leiaute divergente.")
if (manifest.doesNotReplace !== "PL_010e_v1.02") throw new Error("Isolamento de PL_010e não declarado.")

const zip010d = await regularInside(join(dir, "archives"), join(dir, "archives", "PL_010d_v1.03.zip"))
if (zip010d.byteLength !== manifest.layout.bytes || sha256(zip010d) !== manifest.layout.sha256) {
  throw new Error("ZIP PL_010d_v1.03 divergente.")
}
const zip009j = await regularInside(join(dir, "archives"), join(dir, "archives", "PL_009j_NT2022_003_v100b.zip"))
if (zip009j.byteLength !== manifest.entrypoints.bytes || sha256(zip009j) !== manifest.entrypoints.sha256) {
  throw new Error("ZIP PL_009j divergente.")
}

const sourcesDir = join(dir, "sources")
for (const doc of [manifest.documentation.moc, manifest.documentation.anexoI]) {
  const bytes = await regularInside(sourcesDir, join(sourcesDir, doc.originalFilename))
  if (bytes.byteLength !== doc.bytes || sha256(bytes) !== doc.sha256) {
    throw new Error(`Documento oficial divergente: ${doc.originalFilename}`)
  }
}

for (const file of manifest.extractedGraph.files) {
  const bytes = await regularInside(schemaRoot, join(schemaRoot, file.name))
  if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
    throw new Error(`Integridade divergente: ${file.name}`)
  }
  const text = bytes.toString("utf8")
  for (const dependency of text.matchAll(/schemaLocation\s*=\s*["']([^"']+)["']/g)) {
    if (!manifest.extractedGraph.files.some((candidate) => candidate.name === dependency[1])) {
      throw new Error(`Dependência externa: ${dependency[1]}`)
    }
    if (dependency[1].includes("..") || dependency[1].includes("/") || /https?:/i.test(dependency[1])) {
      throw new Error(`schemaLocation inseguro: ${dependency[1]}`)
    }
  }
}

const tiposInut = await readFile(join(schemaRoot, "tiposBasico_v4.00.xsd"))
const tipos010e = await readFile(pl010eTipos)
if (sha256(tiposInut) !== sha256(tipos010e)) throw new Error("tiposBasico da inutilização divergiu de PL_010e.")
const dsigInut = await readFile(join(schemaRoot, "xmldsig-core-schema_v1.01.xsd"))
const dsig010e = await readFile(pl010eDsig)
if (sha256(dsigInut) !== sha256(dsig010e)) throw new Error("xmldsig da inutilização divergiu de PL_010e.")

const leiaute = (await readFile(join(schemaRoot, "leiauteInutNFe_v4.00.xsd"))).toString("utf8")
if (!leiaute.includes("ID[0-9]{4}[0-9A-Z]{12}[0-9]{25}")) {
  throw new Error("Padrão de Id vigente ausente do leiaute.")
}
if (leiaute.includes("ID[0-9]{41}")) {
  throw new Error("Leiaute vigente ainda usa o Id numérico antigo.")
}

console.log(JSON.stringify({
  ok: true,
  package: manifest.layout.package,
  manifestSha256: match[1],
  files: manifest.extractedGraph.files.length,
}))
