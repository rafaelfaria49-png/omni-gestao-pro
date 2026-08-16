/**
 * Verificação OFFLINE da adjudicação nProt/chNFe/CNPJ (GOAL 040).
 * Sem rede. Não altera o manifesto 039 nem o grafo PL_010e_v1.02.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { lstat, readFile, realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"

const root = resolve(import.meta.dirname, "../..")
const base = join(root, "lib", "fiscal", "xsd", "evento-cancelamento")
const adjPath = join(base, "adjudication-040.json")
const manifest039Path = join(base, "manifest.json")

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

function extractPattern(text, name) {
  const block = text.match(new RegExp(`<xs:simpleType name="${name}">[\\s\\S]*?</xs:simpleType>`))
  if (!block) throw new Error(`${name} não encontrado`)
  const pattern = block[0].match(/<xs:pattern value="([^"]+)"/)
  if (!pattern) throw new Error(`pattern ${name} ausente`)
  return pattern[1]
}

const adjBytes = await regularInside(dirname(adjPath), adjPath)
const adjHashLine = (await readFile(join(base, "adjudication-040.sha256"), "utf8")).trim()
const adjMatch = adjHashLine.match(/^([a-f0-9]{64})\s+adjudication-040\.json$/)
if (!adjMatch || adjMatch[1] !== sha256(adjBytes)) {
  throw new Error("Hash da adjudicação 040 divergente.")
}
const adj = JSON.parse(adjBytes.toString("utf8"))
if (adj.goal !== "FISCAL-018-CANCELAMENTO-NPROT-IDENTIFIERS-ADJUDICATION-040") {
  throw new Error("GOAL da adjudicação divergente.")
}
if (adj.runtimeNetwork !== "forbidden") throw new Error("Rede de runtime deve ser forbidden.")
if (adj.classification !== "B") {
  throw new Error("Classificação 040 deve permanecer B enquanto e110111 não for republicado.")
}
if (adj.containsE110111 === true) throw new Error("010d não deve declarar e110111.")
if (!Array.isArray(adj.doesNotReplace) || !adj.doesNotReplace.includes("PL_010e_v1.02")) {
  throw new Error("Isolamento de PL_010e não declarado.")
}

const manifest039Bytes = await regularInside(dirname(manifest039Path), manifest039Path)
const manifest039HashLine = (await readFile(join(base, "manifest.sha256"), "utf8")).trim()
const m039 = manifest039HashLine.match(/^([a-f0-9]{64})\s+manifest\.json$/)
if (!m039 || m039[1] !== sha256(manifest039Bytes)) {
  throw new Error("Manifesto 039 foi alterado — GOAL 040 não deve substituí-lo.")
}
const manifest039 = JSON.parse(manifest039Bytes.toString("utf8"))
if (manifest039.classification !== "B") throw new Error("Classificação 039 deve permanecer B.")

const plRoot = join(root, "lib", "fiscal", "xsd", "schemas", "PL_010e_v1.02", "NFe")
for (const file of manifest039.pl010eSnapshot.files) {
  const bytes = await regularInside(plRoot, join(plRoot, file.name))
  if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
    throw new Error(`PL_010e alterado: ${file.name}`)
  }
}

const pkg = adj.package010d_v1_03
const zipPath = join(root, pkg.archive)
const zipBytes = await regularInside(join(base, "archives"), zipPath)
if (zipBytes.byteLength !== pkg.bytes || sha256(zipBytes) !== pkg.sha256) {
  throw new Error("ZIP 010d_v1.03 divergente.")
}
if (zipBytes[0] !== 0x50 || zipBytes[1] !== 0x4b) throw new Error("010d_v1.03 não é ZIP.")
unzipTest(zipPath)
const zipListed = unzipNames(zipPath)
const expectedEntries = adj.archivesAdded[0].entries
if (zipListed.length !== expectedEntries.length || zipListed.some((n, i) => n !== expectedEntries[i])) {
  throw new Error("Entradas ZIP 010d_v1.03 divergentes.")
}
if (zipListed.some((n) => /e110111|CancNFe/i.test(n) && !/retCancNFe|TRetCancNFe|TVerCancNFe|leiauteConsSit/i.test(n))) {
  throw new Error("ZIP 010d_v1.03 contém entrada e110111/CancNFe de evento.")
}
if (zipListed.some((n) => /e110111/.test(n))) {
  throw new Error("ZIP 010d_v1.03 contém e110111.")
}

const schemaRoot = join(root, pkg.directory, "Evento")
const names = new Set(pkg.eventoFiles.map((f) => f.name))
for (const file of pkg.eventoFiles) {
  const filePath = join(schemaRoot, file.name)
  const bytes = await regularInside(schemaRoot, filePath)
  if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
    throw new Error(`Integridade Evento 010d divergente: ${file.name}`)
  }
  const text = bytes.toString("utf8")
  if (text.includes("<!DOCTYPE") || text.includes("<!ENTITY")) {
    throw new Error(`DTD/ENTITY proibido: ${file.name}`)
  }
  xmllintNonet(filePath)
  const extracted = execFileSync("unzip", ["-p", zipPath, file.zipPath])
  if (sha256(extracted) !== file.sha256) {
    throw new Error(`XSD 010d diverge do ZIP: ${file.zipPath}`)
  }
  for (const loc of parseSchemaLocations(text)) {
    if (/^(https?:|file:)/i.test(loc)) throw new Error(`schemaLocation de rede: ${file.name} -> ${loc}`)
    if (loc.includes("/") || loc.includes("\\") || loc.includes("..")) {
      throw new Error(`schemaLocation não local: ${file.name} -> ${loc}`)
    }
    if (!names.has(loc)) throw new Error(`Dependência ausente (010d Evento): ${file.name} -> ${loc}`)
  }
}

const pkgRoot = join(root, pkg.directory)
for await (const file of (async function* walk(dir) {
  const { readdir } = await import("node:fs/promises")
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else if (entry.name.endsWith(".xsd")) yield p
  }
})(pkgRoot)) {
  const bytes = await readFile(file)
  const text = bytes.toString("utf8")
  if (text.includes("<!DOCTYPE") || text.includes("<!ENTITY")) {
    throw new Error(`DTD/ENTITY proibido: ${relative(pkgRoot, file)}`)
  }
  xmllintNonet(file)
}

const nfeTiposPath = join(root, pkg.directory, "NFe", "tiposBasico_v4.00.xsd")
const nfeTiposBytes = await regularInside(join(root, pkg.directory, "NFe"), nfeTiposPath)
if (
  nfeTiposBytes.byteLength !== pkg.nfeTiposBasico_v4_00.bytes ||
  sha256(nfeTiposBytes) !== pkg.nfeTiposBasico_v4_00.sha256
) {
  throw new Error("010d NFe/tiposBasico_v4.00 divergente.")
}
xmllintNonet(nfeTiposPath)
if (!pkg.nfeTiposBasico_v4_00.identicalToPl010e) {
  throw new Error("Adjudicação deveria registrar identidade 010d NFe tiposBasico × PL_010e.")
}
const plTipos = await regularInside(plRoot, join(plRoot, "tiposBasico_v4.00.xsd"))
if (sha256(plTipos) !== pkg.nfeTiposBasico_v4_00.sha256) {
  throw new Error("010d NFe/tiposBasico_v4.00 não é idêntico ao PL_010e.")
}

for (const doc of adj.documentsAdded) {
  const bytes = await regularInside(join(base, "sources"), join(base, "sources", doc.name))
  if (bytes.byteLength !== doc.bytes || sha256(bytes) !== doc.sha256) {
    throw new Error(`Fonte 040 divergente: ${doc.name}`)
  }
  if (doc.mimeType === "application/pdf" && bytes.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error(`Não é PDF: ${doc.name}`)
  }
}

const v101 = adj.comparison010d_v1_01
const zip101 = join(base, "archives", v101.identicalTo039Archive)
const zip101Bytes = await regularInside(join(base, "archives"), zip101)
if (zip101Bytes.byteLength !== v101.bytes || sha256(zip101Bytes) !== v101.sha256) {
  throw new Error("010d_v1.01 / arquivo 039 CCC divergente.")
}

const tProt010d = extractPattern(
  (await readFile(join(schemaRoot, "tiposBasico_v1.03.xsd"), "utf8")),
  "TProt",
)
const tChNFe010d = extractPattern(
  (await readFile(join(schemaRoot, "tiposBasico_v1.03.xsd"), "utf8")),
  "TChNFe",
)
const tCnpj010d = extractPattern(
  (await readFile(join(schemaRoot, "tiposBasico_v1.03.xsd"), "utf8")),
  "TCnpj",
)
const tProtCanc = extractPattern(
  (await readFile(join(root, "lib/fiscal/xsd/schemas/Evento_Canc_PL_v1.01/tiposBasico_v1.03.xsd"), "utf8")),
  "TProt",
)
if (tProt010d !== "[0-9]{15}|[0-9]{17}") throw new Error(`TProt 010d inesperado: ${tProt010d}`)
if (tChNFe010d !== "[0-9]{6}[0-9A-Z]{12}[0-9]{26}") throw new Error(`TChNFe 010d inesperado: ${tChNFe010d}`)
if (tCnpj010d !== "[0-9A-Z]{12}[0-9]{2}") throw new Error(`TCnpj 010d inesperado: ${tCnpj010d}`)
if (tProtCanc !== "[0-9]{15}") throw new Error(`TProt clássico 110111 inesperado: ${tProtCanc}`)
if (pkg.identifierPatterns["Evento/tiposBasico_v1.03.xsd"].TProt !== tProt010d) {
  throw new Error("Pattern TProt da adjudicação diverge do XSD.")
}

const aviso = await readFile(join(base, "sources", "portal-nfe-informe-page3-2026-08-16.html"), "utf8")
if (!aviso.includes("name=\"1372\"") || !aviso.includes("17 caracteres")) {
  throw new Error("Snapshot do aviso 04/07/2025 não contém o informe 1372.")
}
const sp = await readFile(join(base, "sources", "portal-fazenda-sp-servicos-nfce-2026-08-16.html"), "utf8")
if (!sp.includes("11/03/2026") || !/17 posi/i.test(sp) || !/NT2025\.002/i.test(sp)) {
  throw new Error("Snapshot SP não contém o anúncio de 11/03/2026.")
}
if (adj.sp.production17 !== "nao_comprovado") {
  throw new Error("Produção SP 17 deve permanecer não comprovada.")
}

console.log(JSON.stringify({
  ok: true,
  classification: adj.classification,
  zip010d: pkg.sha256,
  tProt010d,
  tProtClassic110111: tProtCanc,
  tChNFe010d,
  tCnpj010d,
  identical010dNfeTiposToPl010e: true,
  identical010d_v1_01_to_039_ccc: true,
  containsE110111: false,
  pl010eIntact: true,
  manifest039Intact: true,
  network: "forbidden",
}))
