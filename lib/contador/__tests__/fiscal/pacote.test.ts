/**
 * Contador HUB · GOAL 018 — pacote 05-XML (UTF-8 persistido, hash, limite, cross-store).
 */
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import JSZip from "jszip"
import { resolvePeriodoUtc } from "@/lib/contador/competencia"
import { montarChecklistFechamento } from "@/lib/contador/fechamento"
import {
  classificarNotasFiscais,
  toEvidenciaPacote,
  type EvidenciaFiscalPacote,
  type NotaFiscalRow,
} from "@/lib/contador/readers/fiscal"
import { montarDados } from "@/lib/contador/readers"
import {
  XML_AUTORIZADA_COMPETENCIA,
  STORE_A,
  STORE_B,
} from "@/lib/contador/homologation"
import type { ContadorScopeInterno } from "@/lib/contador/scope-core"
import { montarConteudoPacote } from "@/lib/contador/pacote/builder"
import {
  carregarFontesPacoteComCliente,
  type PacoteReaderClient,
} from "@/lib/contador/pacote/carregar-fontes"
import { ziparArquivos } from "@/lib/contador/pacote/zip"
import {
  MAX_ARQUIVOS_PACOTE,
  PacoteLimiteExcedidoError,
  sha256Hex,
} from "@/lib/contador/pacote/seguranca"

const COMPETENCIA = { ano: 2026, mes: 7 }
const PERIODO = resolvePeriodoUtc(COMPETENCIA)
const AGORA = new Date("2026-07-16T12:00:00.000Z")
const STORE = "loja-teste-42"
const USER = "user-abc"
const CHAVE_OK = "35260700000000000000000000000000000000000001"

const scope = {
  ok: true,
  storeId: STORE,
  userId: USER,
  permissaoContador: true,
} as unknown as ContadorScopeInterno

const clienteVazio: PacoteReaderClient = {
  venda: { findMany: async () => [] },
  produto: { findMany: async () => [] },
  devolucaoVenda: { findMany: async () => [] },
  movimentacaoFinanceira: { findMany: async () => [] },
  contaReceberTitulo: { findMany: async () => [] },
  contaPagarTitulo: { findMany: async () => [] },
  sessaoCaixa: { findMany: async () => [] },
  caixaOperacao: { findMany: async () => [] },
}

function nota(partial: Partial<NotaFiscalRow> = {}): NotaFiscalRow {
  return {
    id: partial.id ?? "nota-ok",
    storeId: STORE_A,
    status: "AUTORIZADA",
    ambiente: "HOMOLOGACAO",
    vigente: true,
    protocolo: "135260000000001",
    chaveAcesso: CHAVE_OK,
    xmlAutorizado: XML_AUTORIZADA_COMPETENCIA,
    cStat: "100",
    ...partial,
  }
}

function fiscalOff(): EvidenciaFiscalPacote {
  return {
    disponivel: false,
    motivo: "flag_off",
    entregaveis: [],
  }
}

async function montar(fiscal: EvidenciaFiscalPacote | null) {
  const detalhadas = await carregarFontesPacoteComCliente(scope, PERIODO, COMPETENCIA, clienteVazio)
  const dados = montarDados(detalhadas.agregado, COMPETENCIA)
  const checklist = montarChecklistFechamento({
    dados,
    competencia: COMPETENCIA,
    agora: AGORA,
    evidenciaFiscal: fiscal
      ? {
          leituraOk: fiscal.disponivel,
          disponivel: fiscal.disponivel,
          motivo: fiscal.motivo,
          entregaveis: fiscal.entregaveis.length,
          rejeitadas: 0,
          canceladas: 0,
        }
      : null,
  })
  return montarConteudoPacote({
    detalhadas,
    dados,
    checklist,
    competencia: COMPETENCIA,
    agora: AGORA,
    storeId: STORE,
    userId: USER,
    fiscal,
  })
}

describe("pacote 05-XML — GOAL 018", () => {
  it("mantém placeholder quando a flag está desligada", async () => {
    const conteudo = await montar(fiscalOff())
    expect(conteudo.arquivos.find((a) => a.caminho === "05-XML/LEIA-ME.md")).toBeDefined()
    expect(conteudo.arquivos.filter((a) => a.caminho.startsWith("05-XML/") && a.caminho.endsWith(".xml"))).toHaveLength(
      0,
    )
    const manifesto = JSON.parse(conteudo.arquivos.find((a) => a.caminho === "manifest.json")!.conteudo) as {
      fontes: Array<{ nome: string; estado: string }>
    }
    expect(manifesto.fontes.find((f) => f.nome === "xml")?.estado).toBe("indisponivel")
  })

  it("empacota o XML UTF-8 persistido sem reconstruir e registra sha256 correspondente", async () => {
    const classif = classificarNotasFiscais([nota()], STORE_A, PERIODO)
    expect(classif.entregaveis).toHaveLength(1)
    const fiscal = toEvidenciaPacote({
      disponivel: true,
      leituraOk: true,
      motivo: null,
      ...classif,
    })
    const conteudo = await montar(fiscal)
    const xml = conteudo.arquivos.find((a) => a.caminho.endsWith(".xml"))
    expect(xml?.conteudo).toBe(XML_AUTORIZADA_COMPETENCIA)
    expect(xml?.caminho).toBe(`05-XML/${CHAVE_OK}.xml`)
    expect(conteudo.arquivos.find((a) => a.caminho === "05-XML/LEIA-ME.md")).toBeUndefined()

    const bytes = await ziparArquivos(conteudo.arquivos, AGORA)
    const zip = await JSZip.loadAsync(bytes)
    const zipXml = await zip.file(xml!.caminho)!.async("string")
    expect(zipXml).toBe(XML_AUTORIZADA_COMPETENCIA)

    const entrada = conteudo.manifesto.arquivos.find((a) => a.caminho === xml!.caminho)
    expect(entrada?.sha256).toBe(sha256Hex(XML_AUTORIZADA_COMPETENCIA))
    expect(entrada?.sha256).toBe(createHash("sha256").update(Buffer.from(XML_AUTORIZADA_COMPETENCIA, "utf8")).digest("hex"))
    expect(sha256Hex(zipXml)).toBe(entrada?.sha256)
  })

  it("não inclui XML rejeitado, cancelado ou de PRODUCAO", async () => {
    const rows: NotaFiscalRow[] = [
      nota({ id: "ok", chaveAcesso: CHAVE_OK, protocolo: "p1" }),
      nota({
        id: "rej",
        status: "REJEITADA",
        chaveAcesso: "35260700000000000000000000000000000000000002",
        xmlAutorizado: null,
        protocolo: null,
      }),
      nota({
        id: "can",
        status: "CANCELADA",
        chaveAcesso: "35260700000000000000000000000000000000000003",
      }),
      nota({
        id: "prod",
        ambiente: "PRODUCAO",
        chaveAcesso: "35260700000000000000000000000000000000000004",
      }),
    ]
    const classif = classificarNotasFiscais(rows, STORE_A, PERIODO)
    expect(classif.entregaveis).toHaveLength(1)
    expect(classif.rejeitadas).toHaveLength(1)
    expect(classif.canceladas).toHaveLength(1)
    const fiscal = toEvidenciaPacote({
      disponivel: true,
      leituraOk: true,
      motivo: null,
      ...classif,
    })
    const conteudo = await montar(fiscal)
    const xmls = conteudo.arquivos.filter((a) => a.caminho.startsWith("05-XML/") && a.caminho.endsWith(".xml"))
    expect(xmls).toHaveLength(1)
    expect(xmls[0]?.caminho).toBe(`05-XML/${CHAVE_OK}.xml`)
    expect(xmls[0]?.conteudo).toBe(XML_AUTORIZADA_COMPETENCIA)
  })

  it("não vaza XML de outra storeId", async () => {
    const classif = classificarNotasFiscais(
      [nota({ storeId: STORE_B, chaveAcesso: "35260700000000000000000000000000000000000006" })],
      STORE_A,
      PERIODO,
    )
    expect(classif.entregaveis).toHaveLength(0)
    const fiscal = toEvidenciaPacote({
      disponivel: true,
      leituraOk: true,
      motivo: null,
      ...classif,
    })
    const conteudo = await montar(fiscal)
    expect(conteudo.arquivos.filter((a) => a.caminho.endsWith(".xml"))).toHaveLength(0)
    expect(conteudo.arquivos.find((a) => a.caminho === "05-XML/LEIA-ME.md")).toBeDefined()
  })

  it("não trunca a lista de XML para caber no limite", async () => {
    const rows = [1, 2, 3].map((i) =>
      nota({
        id: `nf-${i}`,
        chaveAcesso: `352607${String(i).padStart(38, "0")}`,
        protocolo: `p-${i}`,
      }),
    )
    const classif = classificarNotasFiscais(rows, STORE_A, PERIODO)
    expect(classif.entregaveis).toHaveLength(3)
    const fiscal = toEvidenciaPacote({
      disponivel: true,
      leituraOk: true,
      motivo: null,
      ...classif,
    })
    await expect(montar(fiscal)).rejects.toBeInstanceOf(PacoteLimiteExcedidoError)
    try {
      await montar(fiscal)
    } catch (erro) {
      expect(erro).toBeInstanceOf(PacoteLimiteExcedidoError)
      expect((erro as PacoteLimiteExcedidoError).message).toMatch(/não foi truncada/)
      expect((erro as PacoteLimiteExcedidoError).limite).toBe("arquivos_pacote")
    }
  })

  it("a massa homolog de 1 XML cabe no teto de 15 arquivos", async () => {
    const classif = classificarNotasFiscais([nota()], STORE_A, PERIODO)
    const fiscal = toEvidenciaPacote({
      disponivel: true,
      leituraOk: true,
      motivo: null,
      ...classif,
    })
    const conteudo = await montar(fiscal)
    expect(conteudo.arquivos.length).toBeLessThanOrEqual(MAX_ARQUIVOS_PACOTE)
    expect(conteudo.arquivos.some((a) => a.caminho.endsWith(".xml"))).toBe(true)
    expect(MAX_ARQUIVOS_PACOTE).toBe(15)
  })
})
