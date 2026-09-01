/**
 * Verificação OFFLINE do pacote regulatório de evento/cancelamento NFC-e (GOAL 039).
 * Sem rede. Não altera nem revalida o grafo PL_010e_v1.02 (há verifier próprio).
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { lstat, readFile, realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"

const root = resolve(import.meta.dirname, "../..")
const base = join(root, "lib", "fiscal", "xsd", "evento-cancelamento")
const manifestPath = join(base, "manifest.json")

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

function parseSchemaLocations(text) {
  return [...text.matchAll(/schemaLocation\s*=\s*["']([^"']+)["']/g)].map((m) => m[1])
}

function unzipTest(zipPath) {
  execFileSync("unzip", ["-t", zipPath], { stdio: "pipe" })
}

function unzipNames(zipPath) {
  const out = execFileSync("unzip", ["-Z", "-1", zipPath], { encoding: "utf8" })
  return out.split("\n").map((s) => s.trim()).filter(Boolean)
}

function xmllintNonet(xsdPath) {
  execFileSync("xmllint", ["--nonet", "--noout", xsdPath], {
    stdio: "pipe",
    env: { ...process.env, XML_CATALOG_FILES: "" },
  })
}

const manifestBytes = await regularInside(dirname(manifestPath), manifestPath)
const manifestHashLine = (await readFile(join(base, "manifest.sha256"), "utf8")).trim()
const match = manifestHashLine.match(/^([a-f0-9]{64})\s+manifest\.json$/)
if (!match || match[1] !== sha256(manifestBytes)) {
  throw new Error("Hash do manifesto de evento/cancelamento divergente.")
}
const manifest = JSON.parse(manifestBytes.toString("utf8"))
if (manifest.doesNotReplace !== "PL_010e_v1.02") throw new Error("Isolamento de PL_010e não declarado.")
if (manifest.runtimeNetwork !== "forbidden") throw new Error("Rede de runtime deve ser forbidden.")
if (manifest.classification !== "B") throw new Error("Classificação do manifesto deve permanecer B enquanto nProt divergir.")

const plRoot = join(root, "lib", "fiscal", "xsd", "schemas", "PL_010e_v1.02", "NFe")
for (const file of manifest.pl010eSnapshot.files) {
  const bytes = await regularInside(plRoot, join(plRoot, file.name))
  if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
    throw new Error(`PL_010e alterado: ${file.name}`)
  }
}

const packageZip = {
  "Evento_Canc_PL_v1.01": join(base, "archives", "Evento_Canc_PL_v1.01_NT_2018_004.zip"),
  "PL_Evento_NT2026.004_v1.01": join(base, "archives", "PL_Evento.zip"),
}

for (const [key, pkg] of Object.entries(manifest.packages)) {
  const schemaRoot = join(root, pkg.directory)
  const names = new Set(pkg.files.map((f) => f.name))
  const zipFile = packageZip[key]
  for (const file of pkg.files) {
    const filePath = join(schemaRoot, file.name)
    const bytes = await regularInside(schemaRoot, filePath)
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      throw new Error(`Integridade divergente (${key}): ${file.name}`)
    }
    const text = bytes.toString("utf8")
    if (text.includes("<!DOCTYPE") || text.includes("<!ENTITY")) {
      throw new Error(`DTD/ENTITY proibido: ${file.name}`)
    }
    xmllintNonet(filePath)
    if (zipFile && file.zipPath) {
      const extracted = execFileSync("unzip", ["-p", zipFile, file.zipPath])
      if (sha256(extracted) !== file.sha256) {
        throw new Error(`XSD diverge do ZIP (${key}): ${file.zipPath}`)
      }
    }
    for (const loc of parseSchemaLocations(text)) {
      if (/^(https?:|file:)/i.test(loc)) throw new Error(`schemaLocation de rede: ${file.name} -> ${loc}`)
      if (loc.includes("/") || loc.includes("\\") || loc.includes("..")) {
        throw new Error(`schemaLocation não local: ${file.name} -> ${loc}`)
      }
      if (!names.has(loc)) throw new Error(`Dependência ausente (${key}): ${file.name} -> ${loc}`)
    }
  }
  for (const [from, deps] of Object.entries(pkg.dependencyGraph)) {
    if (!names.has(from)) throw new Error(`Grafo referencia arquivo ausente: ${from}`)
    for (const dep of deps) if (!names.has(dep)) throw new Error(`Grafo quebrado: ${from} -> ${dep}`)
  }
}

for (const archive of manifest.archives) {
  const zipPath = join(base, "archives", archive.name)
  const bytes = await regularInside(join(base, "archives"), zipPath)
  if (bytes.byteLength !== archive.bytes || sha256(bytes) !== archive.sha256) {
    throw new Error(`ZIP divergente: ${archive.name}`)
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error(`Não é ZIP: ${archive.name}`)
  unzipTest(zipPath)
  if (archive.entries) {
    const names = unzipNames(zipPath)
    const expected = archive.entries.map((e) => e.name.replace(/\/$/, ""))
    const listed = names.map((n) => n.replace(/\/$/, ""))
    if (listed.length !== expected.length || listed.some((n, i) => n !== expected[i])) {
      throw new Error(`Entradas ZIP divergentes: ${archive.name}`)
    }
  }
}

for (const doc of manifest.documents) {
  const bytes = await regularInside(join(base, "sources"), join(base, "sources", doc.name))
  if (bytes.byteLength !== doc.bytes || sha256(bytes) !== doc.sha256) {
    throw new Error(`PDF divergente: ${doc.name}`)
  }
  if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error(`Não é PDF: ${doc.name}`)
}

const canc = manifest.packages["Evento_Canc_PL_v1.01"]
if (!canc.files.some((f) => f.name === "e110111_v1.00.xsd")) throw new Error("e110111 ausente")
if (!canc.files.some((f) => f.name === "envEventoCancNFe_v1.00.xsd")) throw new Error("envEventoCancNFe ausente")
if (!canc.files.some((f) => f.name === "retEnvEventoCancNFe_v1.00.xsd")) throw new Error("retEnvEventoCancNFe ausente")
if (canc.files.some((f) => f.name === "envEvento_v1.00.xsd")) {
  throw new Error("envEvento_v1.00.xsd não pertence ao pacote clássico 110111")
}

const generic = manifest.packages["PL_Evento_NT2026.004_v1.01"]
if (!generic.files.some((f) => f.name === "envEvento_v1.00.xsd")) throw new Error("envEvento genérico ausente")
if (generic.files.some((f) => /e110111|CancNFe/i.test(f.name))) {
  throw new Error("PL_Evento NT 2026.004 não deve conter 110111")
}

const rtcNames = unzipNames(join(base, "archives", "Eventos_RTC.zip"))
if (rtcNames.some((n) => /e110111|CancNFe/i.test(n))) {
  throw new Error("Eventos_RTC.zip contém entrada 110111/CancNFe — revisar prova negativa.")
}

const tProtCanc = (await readFile(join(root, canc.directory, "tiposBasico_v1.03.xsd"), "utf8"))
const tProtGeneric = (await readFile(join(root, generic.directory, "tiposBasico_v1.03.xsd"), "utf8"))
const tProt010e = (await readFile(join(plRoot, "tiposBasico_v4.00.xsd"), "utf8"))
const extractTProt = (text) => {
  const block = text.match(/<xs:simpleType name="TProt">[\s\S]*?<\/xs:simpleType>/)
  if (!block) throw new Error("TProt não encontrado")
  const pattern = block[0].match(/<xs:pattern value="([^"]+)"/)
  if (!pattern) throw new Error("pattern TProt ausente")
  return pattern[1]
}
const patterns = {
  Evento_Canc_PL_v1_01: extractTProt(tProtCanc),
  PL_Evento_NT2026: extractTProt(tProtGeneric),
  PL_010e_v1_02: extractTProt(tProt010e),
}
if (patterns.Evento_Canc_PL_v1_01 !== "[0-9]{15}") {
  throw new Error(`TProt 110111 inesperado: ${patterns.Evento_Canc_PL_v1_01}`)
}
if (patterns.PL_Evento_NT2026 !== "[0-9]{15}|[0-9]{17}") {
  throw new Error(`TProt envelope 2026 inesperado: ${patterns.PL_Evento_NT2026}`)
}
if (patterns.PL_010e_v1_02 !== "[0-9]{15}|[0-9]{17}") {
  throw new Error(`TProt PL_010e inesperado: ${patterns.PL_010e_v1_02}`)
}

console.log(JSON.stringify({
  ok: true,
  classification: manifest.classification,
  packages: Object.keys(manifest.packages),
  manifestSha256: match[1],
  pl010eIntact: true,
  rtcWithout110111: true,
  tProtPatterns: patterns,
  network: "forbidden",
}))
