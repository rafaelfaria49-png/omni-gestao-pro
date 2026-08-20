/**
 * Prova opt-in contra PostgreSQL local já provisionado. Sem
 * CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL a suíte é pulada (CI padrão).
 *
 * SELECT + reader A + predicado + checklist + 05-XML. Zero FiscalLog.
 * Não importa xml-storage-reader. Não chama SEFAZ.
 */
import { afterAll, describe, expect, it } from "vitest"
import JSZip from "jszip"

import { PrismaClient } from "@/generated/prisma"
import { resolvePeriodoUtc } from "@/lib/contador/competencia"
import { montarChecklistFechamento } from "@/lib/contador/fechamento"
import { montarConteudoPacote } from "@/lib/contador/pacote/builder"
import {
  carregarFontesPacoteComCliente,
  type PacoteReaderClient,
} from "@/lib/contador/pacote/carregar-fontes"
import { sha256Hex } from "@/lib/contador/pacote/seguranca"
import { ziparArquivos } from "@/lib/contador/pacote/zip"
import { montarDados } from "@/lib/contador/readers"
import {
  lerNotasFiscais,
  toEvidenciaChecklist,
  toEvidenciaPacote,
  type FiscalReaderClient,
} from "@/lib/contador/readers/fiscal"
import type { ContadorScopeInterno } from "@/lib/contador/scope-core"

import { assertLocalHomologationDatabaseUrl } from "./guard-url"
import { COMPETENCIA_REF, LINHAS_MASSA, STORE_A, STORE_B, STORE_IDS } from "./massa"
import { XML_AUTORIZADA_COMPETENCIA } from "./xml-fixtures"

const rawUrl = process.env.CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL
const integration = rawUrl ? describe : describe.skip

const prisma = new PrismaClient({
  datasourceUrl: rawUrl ? assertLocalHomologationDatabaseUrl(rawUrl) : undefined,
  log: ["error"],
})

const ENV_ON = {
  CONTADOR_FISCAL_READER: "on",
  CONTADOR_FISCAL_READER_STORE_ALLOWLIST: STORE_A,
} as const

const scopeA = {
  ok: true,
  storeId: STORE_A,
  userId: "homolog-018",
  permissaoContador: true,
} as unknown as ContadorScopeInterno

const clienteFiscal: FiscalReaderClient = {
  notaFiscal: {
    findMany: (args) => prisma.notaFiscal.findMany(args as never),
  },
}

const clientePacoteVazio: PacoteReaderClient = {
  venda: { findMany: async () => [] },
  produto: { findMany: async () => [] },
  devolucaoVenda: { findMany: async () => [] },
  movimentacaoFinanceira: { findMany: async () => [] },
  contaReceberTitulo: { findMany: async () => [] },
  contaPagarTitulo: { findMany: async () => [] },
  sessaoCaixa: { findMany: async () => [] },
  caixaOperacao: { findMany: async () => [] },
}

async function contarAuditoria() {
  const [fiscalLog, eventoFiscal] = await Promise.all([
    prisma.fiscalLog.count({
      where: {
        OR: [{ storeId: { in: [...STORE_IDS] } }, { notaFiscalId: { in: LINHAS_MASSA.map((l) => l.notaId) } }],
      },
    }),
    prisma.eventoFiscal.count({ where: { storeId: { in: [...STORE_IDS] } } }),
  ])
  return { fiscalLog, eventoFiscal }
}

integration("homologação fiscal HOMOLOGACAO (GOAL 018)", () => {
  afterAll(async () => {
    await prisma.$disconnect()
  })

  it("persiste as 7 linhas sintéticas sem FiscalLog e sem cruzar loja", async () => {
    const notas = await prisma.notaFiscal.findMany({
      where: { storeId: { in: [...STORE_IDS] } },
      select: {
        id: true,
        storeId: true,
        status: true,
        ambiente: true,
        vigente: true,
        protocolo: true,
        chaveAcesso: true,
        xmlAutorizado: true,
        localKey: true,
        numero: true,
        serie: true,
        modelo: true,
      },
      orderBy: { numero: "asc" },
    })

    expect(notas).toHaveLength(7)

    const vendas = await prisma.venda.count({
      where: { storeId: { in: [...STORE_IDS] } },
    })
    expect(vendas).toBe(7)

    const porCaso = new Map(LINHAS_MASSA.map((l) => [l.notaId, l]))
    for (const nota of notas) {
      const esperado = porCaso.get(nota.id)
      expect(esperado, `nota inesperada ${nota.id}`).toBeTruthy()
      expect(nota.storeId).toBe(esperado!.storeId)
      expect(nota.status).toBe(esperado!.status)
      expect(nota.ambiente).toBe(esperado!.ambiente)
      expect(nota.vigente).toBe(esperado!.vigente)
      expect(nota.chaveAcesso).toBe(esperado!.chaveAcesso)
      expect(nota.xmlAutorizado).toBe(esperado!.xmlAutorizado)
      expect(nota.localKey).toBe(esperado!.localKey)
    }

    const lojaA = notas.filter((n) => n.storeId === STORE_A)
    const lojaB = notas.filter((n) => n.storeId === STORE_B)
    expect(lojaA).toHaveLength(6)
    expect(lojaB).toHaveLength(1)
    expect(lojaB[0]?.id).toBe("nota-homolog-loja-b")

    const vazamento = await prisma.notaFiscal.findMany({
      where: { storeId: STORE_A, id: "nota-homolog-loja-b" },
    })
    expect(vazamento).toHaveLength(0)

    const auditoria = await contarAuditoria()
    expect(auditoria.fiscalLog).toBe(0)
    expect(auditoria.eventoFiscal).toBe(0)

    const feliz = notas.find((n) => n.id === "nota-homolog-ok")
    expect(feliz?.xmlAutorizado).toContain("<dhEmi>2026-07-14T12:00:00-03:00</dhEmi>")
    expect(feliz?.ambiente).toBe("HOMOLOGACAO")
    expect(feliz?.status).toBe("AUTORIZADA")

    const producao = notas.find((n) => n.id === "nota-homolog-prod")
    expect(producao?.ambiente).toBe("PRODUCAO")
    expect(producao?.storeId).toBe(STORE_A)
    expect(producao?.id).not.toBe(feliz?.id)
  })

  it("fluxo Prisma → reader A → predicado → checklist → 05-XML (UTF-8 + sha256)", async () => {
    const leitura = await lerNotasFiscais(scopeA, COMPETENCIA_REF, {
      env: ENV_ON,
      cliente: clienteFiscal,
    })

    expect(leitura.disponivel).toBe(true)
    expect(leitura.leituraOk).toBe(true)
    expect(leitura.entregaveis.length).toBeGreaterThanOrEqual(1)
    expect(leitura.entregaveis).toHaveLength(1)
    expect(leitura.entregaveis[0]?.id).toBe("nota-homolog-ok")
    expect(leitura.entregaveis[0]?.xmlAutorizado).toBe(XML_AUTORIZADA_COMPETENCIA)
    expect(leitura.rejeitadas).toHaveLength(1)
    expect(leitura.canceladas).toHaveLength(1)
    expect(leitura.entregaveis.every((e) => e.storeId === STORE_A)).toBe(true)
    expect(leitura.entregaveis.some((e) => e.id === "nota-homolog-loja-b")).toBe(false)
    expect(leitura.entregaveis.some((e) => e.id === "nota-homolog-prod")).toBe(false)

    const checklist = montarChecklistFechamento({
      dados: montarDados(
        {
          vendas: [],
          devolucoes: [],
          movimentacoes: [],
          receber: [],
          pagar: [],
          sessoes: [],
          operacoes: [],
          falhas: [],
        },
        COMPETENCIA_REF,
      ),
      competencia: COMPETENCIA_REF,
      agora: new Date("2026-07-16T12:00:00.000Z"),
      evidenciaFiscal: toEvidenciaChecklist(leitura),
    })
    const sinal = checklist.itens.find((i) => i.id === "fiscal")
    expect(sinal?.estado).toBe("atencao")
    expect(sinal?.evidencia).toContain("1 entregável")
    expect(sinal?.evidencia).toContain("1 rejeitada")
    expect(sinal?.evidencia).toContain("1 cancelada")

    const detalhadas = await carregarFontesPacoteComCliente(
      scopeA,
      resolvePeriodoUtc(COMPETENCIA_REF),
      COMPETENCIA_REF,
      clientePacoteVazio,
    )
    const dados = montarDados(detalhadas.agregado, COMPETENCIA_REF)
    const conteudo = montarConteudoPacote({
      detalhadas,
      dados,
      checklist,
      competencia: COMPETENCIA_REF,
      agora: new Date("2026-07-16T12:00:00.000Z"),
      storeId: STORE_A,
      userId: "homolog-018",
      fiscal: toEvidenciaPacote(leitura),
    })

    const xmls = conteudo.arquivos.filter((a) => a.caminho.startsWith("05-XML/") && a.caminho.endsWith(".xml"))
    expect(xmls).toHaveLength(1)
    expect(xmls[0]?.conteudo).toBe(XML_AUTORIZADA_COMPETENCIA)
    expect(conteudo.arquivos.find((a) => a.caminho === "05-XML/LEIA-ME.md")).toBeUndefined()
    expect(conteudo.arquivos.length).toBeLessThanOrEqual(15)

    const entrada = conteudo.manifesto.arquivos.find((a) => a.caminho === xmls[0]?.caminho)
    expect(entrada?.sha256).toBe(sha256Hex(XML_AUTORIZADA_COMPETENCIA))

    const bytes = await ziparArquivos(conteudo.arquivos, new Date("2026-07-16T12:00:00.000Z"))
    const zip = await JSZip.loadAsync(bytes)
    const zipXml = await zip.file(xmls[0]!.caminho)!.async("string")
    expect(zipXml).toBe(XML_AUTORIZADA_COMPETENCIA)
    expect(sha256Hex(zipXml)).toBe(entrada?.sha256)

    const fonteXml = conteudo.manifesto.fontes.find((f) => f.nome === "xml")
    expect(fonteXml?.estado).toBe("real")
    expect(fonteXml?.registros).toBe(1)

    const depois = await contarAuditoria()
    expect(depois.fiscalLog).toBe(0)
    expect(depois.eventoFiscal).toBe(0)
  })

  it("flag off no runtime homolog permanece nao_disponivel (não é zero notas)", async () => {
    const leitura = await lerNotasFiscais(scopeA, COMPETENCIA_REF, {
      env: { CONTADOR_FISCAL_READER: "off" },
      cliente: clienteFiscal,
    })
    expect(leitura.disponivel).toBe(false)
    expect(leitura.motivo).toBe("flag_off")
    expect(leitura.entregaveis).toHaveLength(0)
  })

  it("store fora da allowlist no runtime homolog permanece nao_disponivel", async () => {
    const leitura = await lerNotasFiscais(scopeA, COMPETENCIA_REF, {
      env: {
        CONTADOR_FISCAL_READER: "on",
        CONTADOR_FISCAL_READER_STORE_ALLOWLIST: STORE_B,
      },
      cliente: clienteFiscal,
    })
    expect(leitura.disponivel).toBe(false)
    expect(leitura.motivo).toBe("store_nao_allowlisted")
  })
})
