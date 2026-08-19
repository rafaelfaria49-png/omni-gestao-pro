/**
 * Contador HUB · leitura do `manifest.json` do ZIP oficial (GOAL 017).
 *
 * Reutiliza primitives já existentes:
 *  - `JSZip.loadAsync` (mesma lib do GOAL 008; `zip.ts` só compacta);
 *  - `sha256Hex` (mesmo hash gravado em `ContadorPacote.manifestoHash`).
 *
 * Não copia adapter de storage nem `ziparArquivos`. Não devolve storageRef/URL.
 */
import JSZip from "jszip"
import { MAX_BYTES_ZIP, sha256Hex } from "@/lib/contador/pacote/seguranca"

export const MANIFESTO_CAMINHO = "manifest.json" as const
export const MANIFESTO_SCHEMA = "omni.contador.pacote.manifest/v1" as const

export type MotivoManifestoIndisponivel = "hash" | "ausente" | "invalido" | "tamanho"

export type ResultadoPendenciasManifesto =
  | { ok: true; pendencias: readonly string[] }
  | { ok: false; motivo: MotivoManifestoIndisponivel }

function linhasPendencias(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== "string") return null
    out.push(item)
  }
  return out
}

/**
 * Extrai e verifica `manifest.pendencias` dos bytes do ZIP oficial.
 * Hash = SHA-256 UTF-8 do arquivo `manifest.json` exatamente como gravado.
 * Falha → `ok: false` (nunca lista vazia silenciosa).
 */
export async function lerPendenciasDoManifestoOficial(
  zipBytes: Uint8Array,
  esperado: Readonly<{ manifestoHash: string; storeId: string }>,
): Promise<ResultadoPendenciasManifesto> {
  if (zipBytes.byteLength === 0 || zipBytes.byteLength > MAX_BYTES_ZIP) {
    return { ok: false, motivo: "tamanho" }
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(zipBytes)
  } catch {
    return { ok: false, motivo: "invalido" }
  }

  const arquivo = zip.file(MANIFESTO_CAMINHO)
  if (!arquivo) return { ok: false, motivo: "ausente" }

  let texto: string
  try {
    texto = await arquivo.async("string")
  } catch {
    return { ok: false, motivo: "invalido" }
  }

  const hash = sha256Hex(texto)
  if (hash !== esperado.manifestoHash) return { ok: false, motivo: "hash" }

  let parsed: unknown
  try {
    parsed = JSON.parse(texto) as unknown
  } catch {
    return { ok: false, motivo: "invalido" }
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, motivo: "invalido" }

  const man = parsed as Record<string, unknown>
  if (man.schema !== MANIFESTO_SCHEMA) return { ok: false, motivo: "invalido" }

  const competencia = man.competencia
  const storeId =
    competencia && typeof competencia === "object"
      ? (competencia as { storeId?: unknown }).storeId
      : undefined
  if (typeof storeId !== "string" || storeId !== esperado.storeId) {
    return { ok: false, motivo: "invalido" }
  }

  const pendencias = linhasPendencias(man.pendencias)
  if (!pendencias) return { ok: false, motivo: "invalido" }

  return { ok: true, pendencias: Object.freeze(pendencias) }
}
