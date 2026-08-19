/**
 * Contador HUB · leitura do manifesto oficial no ZIP (GOAL 017 corretivo).
 *
 * A–J: pendências reais de `manifest.json`, versão efetiva, hash fail-closed,
 * cross-store, DTO sem storageRef/URL.
 */
import { describe, expect, it } from "vitest"
import JSZip from "jszip"
import { sha256Hex } from "@/lib/contador/pacote/seguranca"
import { criarRepoNotificacoes } from "@/lib/contador/notificacoes/repo-prisma"
import { lerPendenciasDoManifestoOficial, MANIFESTO_SCHEMA } from "@/lib/contador/notificacoes/manifesto-zip"
import { avaliarRegras } from "@/lib/contador/notificacoes/regras"
import { listarAlertas } from "@/lib/contador/notificacoes/service"
import { COMP, ESCOPO_A, ESCOPO_B, competenciaRow, fakeRepoNotificacoes } from "./helpers"

const HOJE = new Date("2026-08-31T15:00:00.000Z")
const FONTE_PARCIAL = "Fonte parcial: vendas — cobertura incompleta"
const CHECKLIST = "[atencao] caixa — conferência"

async function zipManifesto(input: {
  pendencias: readonly string[]
  storeId?: string
  schema?: string
  textoBruto?: string
}): Promise<{ bytes: Uint8Array; hash: string; texto: string }> {
  const texto =
    input.textoBruto ??
    `${JSON.stringify(
      {
        schema: input.schema ?? MANIFESTO_SCHEMA,
        competencia: { storeId: input.storeId ?? "loja-1" },
        pendencias: input.pendencias,
      },
      null,
      2,
    )}\n`
  const zip = new JSZip()
  zip.file("manifest.json", texto)
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" })
  return { bytes, hash: sha256Hex(texto), texto }
}

function dbComPacotes(
  pacotes: Array<{ versao: number; storageRef: string; manifestoHash: string }>,
  storeId = "loja-1",
) {
  return {
    contadorPacote: {
      findMany: async () => pacotes,
    },
    contadorCompetencia: {
      findUnique: async () => (storeId ? { storeId } : null),
    },
  } as never
}

describe("notificacoes · lerPendenciasDoManifestoOficial", () => {
  it("A. manifesto sem pendências → lista vazia ok", async () => {
    const zip = await zipManifesto({ pendencias: [] })
    const r = await lerPendenciasDoManifestoOficial(zip.bytes, {
      manifestoHash: zip.hash,
      storeId: "loja-1",
    })
    expect(r).toEqual({ ok: true, pendencias: [] })
  })

  it("B/C. checklist e fonte parcial saem do array oficial", async () => {
    const zip = await zipManifesto({ pendencias: [CHECKLIST, FONTE_PARCIAL] })
    const r = await lerPendenciasDoManifestoOficial(zip.bytes, {
      manifestoHash: zip.hash,
      storeId: "loja-1",
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect([...r.pendencias]).toEqual([CHECKLIST, FONTE_PARCIAL])
  })

  it("G. hash inválido ou manifesto ausente não vira lista ok", async () => {
    const zip = await zipManifesto({ pendencias: [CHECKLIST] })
    const hash = await lerPendenciasDoManifestoOficial(zip.bytes, {
      manifestoHash: "0".repeat(64),
      storeId: "loja-1",
    })
    expect(hash).toEqual({ ok: false, motivo: "hash" })

    const vazio = new JSZip()
    const bytesVazio = await vazio.generateAsync({ type: "uint8array" })
    const ausente = await lerPendenciasDoManifestoOficial(bytesVazio, {
      manifestoHash: sha256Hex("{}"),
      storeId: "loja-1",
    })
    expect(ausente).toEqual({ ok: false, motivo: "ausente" })
  })

  it("storeId do manifesto divergente é inválido", async () => {
    const zip = await zipManifesto({ pendencias: [FONTE_PARCIAL], storeId: "loja-2" })
    const r = await lerPendenciasDoManifestoOficial(zip.bytes, {
      manifestoHash: zip.hash,
      storeId: "loja-1",
    })
    expect(r).toEqual({ ok: false, motivo: "invalido" })
  })
})

describe("notificacoes · listarPacotes lê só a versão efetiva do ZIP", () => {
  it("F. duas versões → só a maior; v1 com pendência é ignorada", async () => {
    const v1 = await zipManifesto({ pendencias: [CHECKLIST] })
    const v2 = await zipManifesto({ pendencias: [] })
    const abertos: string[] = []
    const repo = criarRepoNotificacoes(dbComPacotes([
      { versao: 1, storageRef: "ref-v1", manifestoHash: v1.hash },
      { versao: 2, storageRef: "ref-v2", manifestoHash: v2.hash },
    ]), async (ref) => {
      abertos.push(ref)
      if (ref === "ref-v1") return v1.bytes
      if (ref === "ref-v2") return v2.bytes
      throw new Error("storageRef desconhecido")
    })
    const list = await repo.listarPacotes("comp-1", "loja-1")
    expect(abertos).toEqual(["ref-v2"])
    expect(list).toEqual([{ versao: 2, pendencias: [], fonte: "ok" }])
    const json = JSON.stringify(list)
    expect(json).not.toMatch(/storageRef|signedUrl|https?:\/\//i)
  })

  it("C/F. versão efetiva só com fonte parcial", async () => {
    const v1 = await zipManifesto({ pendencias: [] })
    const v2 = await zipManifesto({ pendencias: [FONTE_PARCIAL] })
    const repo = criarRepoNotificacoes(dbComPacotes([
      { versao: 1, storageRef: "ref-v1", manifestoHash: v1.hash },
      { versao: 2, storageRef: "ref-v2", manifestoHash: v2.hash },
    ]), async (ref) => (ref === "ref-v2" ? v2.bytes : v1.bytes))
    const list = await repo.listarPacotes("comp-1", "loja-1")
    expect(list).toEqual([{ versao: 2, pendencias: [FONTE_PARCIAL], fonte: "ok" }])
  })

  it("G. hash inválido → fonte indisponivel, não ok vazio", async () => {
    const zip = await zipManifesto({ pendencias: [CHECKLIST] })
    const repo = criarRepoNotificacoes(dbComPacotes([
      { versao: 3, storageRef: "ref-v3", manifestoHash: "f".repeat(64) },
    ]), async () => zip.bytes)
    const list = await repo.listarPacotes("comp-1", "loja-1")
    expect(list).toEqual([{ versao: 3, pendencias: [], fonte: "indisponivel" }])
  })

  it("G. falha de storage → fonte indisponivel", async () => {
    const repo = criarRepoNotificacoes(dbComPacotes([
      { versao: 1, storageRef: "ref-ausente", manifestoHash: "a".repeat(64) },
    ]), async () => {
      throw new Error("objeto ausente")
    })
    const list = await repo.listarPacotes("comp-1", "loja-1")
    expect(list).toEqual([{ versao: 1, pendencias: [], fonte: "indisponivel" }])
  })

  it("H. cross-store não abre o ZIP e não afirma ok", async () => {
    const zip = await zipManifesto({ pendencias: [FONTE_PARCIAL] })
    const abertos: string[] = []
    const repo = criarRepoNotificacoes(dbComPacotes([
      { versao: 1, storageRef: "ref-loja-1", manifestoHash: zip.hash },
    ], "loja-1"), async (ref) => {
      abertos.push(ref)
      return zip.bytes
    })
    const list = await repo.listarPacotes("comp-1", "loja-2")
    expect(abertos).toEqual([])
    expect(list).toEqual([{ versao: 1, pendencias: [], fonte: "indisponivel" }])
  })

  it("I. retorno nunca inclui storageRef nem URL", async () => {
    const zip = await zipManifesto({ pendencias: [FONTE_PARCIAL] })
    const repo = criarRepoNotificacoes(dbComPacotes([
      { versao: 1, storageRef: "contador/loja-1/2026-08/pacotes/v1/abc.zip", manifestoHash: zip.hash },
    ]), async () => zip.bytes)
    const list = await repo.listarPacotes("comp-1", "loja-1")
    const json = JSON.stringify(list)
    expect(json).not.toContain("storageRef")
    expect(json).not.toContain("contador/loja-1")
    expect(json).not.toMatch(/https?:\/\//)
    expect(Object.keys(list[0] ?? {})).toEqual(["versao", "pendencias", "fonte"])
  })
})

describe("notificacoes · alerta segue o manifesto oficial, não o snapshot", () => {
  it("A. sem pendências → sem alerta e fonte ok", async () => {
    const repo = fakeRepoNotificacoes({
      competencias: [competenciaRow({ snapshot: { checklist: { itens: [{ id: "caixa", estado: "atencao" }] } } })],
      pacotes: [{ versao: 1, fonte: "ok", pendencias: [], competenciaId: "comp-1" }],
    })
    const r = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    expect(r.fontePacote).toBe("ok")
    expect(r.avisos.some((a) => a.regra === "pacote_com_pendencias")).toBe(false)
  })

  it("B. pendência de checklist no manifesto → alerta", async () => {
    const repo = fakeRepoNotificacoes({
      competencias: [competenciaRow()],
      pacotes: [{ versao: 1, fonte: "ok", pendencias: [CHECKLIST], competenciaId: "comp-1" }],
    })
    const r = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    expect(r.avisos.some((a) => a.regra === "pacote_com_pendencias" && a.alvo === "v1")).toBe(true)
  })

  it("C. só fonte parcial → alerta", async () => {
    const repo = fakeRepoNotificacoes({
      competencias: [competenciaRow({ snapshot: { checklist: { itens: [] } } })],
      pacotes: [{ versao: 1, fonte: "ok", pendencias: [FONTE_PARCIAL], competenciaId: "comp-1" }],
    })
    const r = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    expect(r.avisos.some((a) => a.regra === "pacote_com_pendencias")).toBe(true)
  })

  it("D. snapshot limpo e manifesto com pendência → segue manifesto", () => {
    const r = avaliarRegras(
      {
        competencia: competenciaRow({ snapshot: { checklist: { itens: [{ id: "caixa", estado: "ok" }] } } }),
        documentos: [],
        guias: [],
        pacotes: [{ versao: 2, fonte: "ok", pendencias: [FONTE_PARCIAL] }],
        eventosPosFechamento: [],
        eventosAlerta: [],
      },
      HOJE,
    )
    expect(r.some((a) => a.regra === "pacote_com_pendencias" && a.alvo === "v2")).toBe(true)
  })

  it("E. snapshot com pendência e manifesto vazio → segue manifesto", () => {
    const r = avaliarRegras(
      {
        competencia: competenciaRow({
          snapshot: { checklist: { itens: [{ id: "caixa", estado: "atencao" }] } },
        }),
        documentos: [],
        guias: [],
        pacotes: [{ versao: 2, fonte: "ok", pendencias: [] }],
        eventosPosFechamento: [],
        eventosAlerta: [],
      },
      HOJE,
    )
    expect(r.some((a) => a.regra === "pacote_com_pendencias")).toBe(false)
  })

  it("G. manifesto indisponível não vira falso sem pendências", async () => {
    const repo = fakeRepoNotificacoes({
      competencias: [competenciaRow()],
      pacotes: [{ versao: 1, fonte: "indisponivel", pendencias: [], competenciaId: "comp-1" }],
    })
    const r = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    expect(r.fontePacote).toBe("indisponivel")
    expect(r.avisos.some((a) => a.regra === "pacote_com_pendencias")).toBe(false)
  })

  it("H/I. loja B não vê pacote da loja A; DTO sem storageRef", async () => {
    const repoA = fakeRepoNotificacoes({
      competencias: [competenciaRow()],
      pacotes: [{ versao: 1, fonte: "ok", pendencias: [FONTE_PARCIAL], competenciaId: "comp-1" }],
    })
    const repoB = fakeRepoNotificacoes({
      competencias: [competenciaRow({ id: "comp-2", storeId: "loja-2" })],
    })
    const a = await listarAlertas(ESCOPO_A, COMP, repoA, HOJE)
    const b = await listarAlertas(ESCOPO_B, COMP, repoB, HOJE)
    expect(a.avisos.some((x) => x.regra === "pacote_com_pendencias")).toBe(true)
    expect(b.fontePacote).toBe("ausente")
    expect(b.avisos.some((x) => x.regra === "pacote_com_pendencias")).toBe(false)
    const json = JSON.stringify(a)
    expect(json).not.toMatch(/storageRef|signedUrl|https?:\/\//i)
  })
})
