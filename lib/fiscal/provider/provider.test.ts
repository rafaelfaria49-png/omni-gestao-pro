/**
 * Testes da abstração de provider fiscal (GOAL_006).
 *
 * Cobrem: resolver (stub / config ausente / desconhecido / não implementado), validação de
 * snapshot, statusServico, emitir/cancelar controlados, normalização de erro e a garantia
 * estrutural de que o provider NÃO depende de Produto vivo nem do banco.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { PRODUTO_FISCAL_VAZIO, type ProdutoFiscal } from "@/lib/produto-fiscal"
import {
  buildVendaFiscalSnapshot,
  type BuildSnapshotInput,
  type VendaFiscalSnapshot,
} from "../venda-fiscal-snapshot"
import { stubHomologacaoProvider } from "./stub-homologacao"
import {
  assertProviderConfigurado,
  FiscalProviderConfigError,
  isFiscalProviderReady,
  normalizeProviderError,
  resolveFiscalProvider,
} from "./resolver"
import type { FiscalProviderConfigInput, FiscalProviderRequest } from "./types"

const HERE = path.dirname(fileURLToPath(import.meta.url))

// ── Fixtures ──────────────────────────────────────────────────────────────────────────

const LOJA_OK: NonNullable<BuildSnapshotInput["loja"]> = {
  cnpj: "11.222.333/0001-81",
  razaoSocial: "Loja Teste LTDA",
  nomeFantasia: "Loja Teste",
  inscricaoEstadual: "123456789",
  inscricaoMunicipal: "",
  regimeTributario: "SIMPLES_NACIONAL",
  crt: 1,
  ambiente: "HOMOLOGACAO",
  modeloFiscal: "NFCE",
  fiscalEnabled: false,
  logradouro: "Rua A",
  numero: "100",
  complemento: "",
  bairro: "Centro",
  codigoMunicipioIbge: "3550308",
  municipio: "São Paulo",
  uf: "SP",
  cep: "01001000",
  codigoPais: "1058",
  fone: "",
  email: "",
}

const FISCAL_COMPLETO: ProdutoFiscal = {
  ...PRODUTO_FISCAL_VAZIO,
  ncm: "22021000",
  cfop: "5102",
  csosn: "102",
  origemMercadoria: "0",
  unidadeComercial: "UN",
  unidadeTributavel: "UN",
}

function snapshotComFiscal(fiscal: ProdutoFiscal): VendaFiscalSnapshot {
  const built = buildVendaFiscalSnapshot({
    storeId: "loja-1",
    vendaId: "venda-1",
    loja: LOJA_OK,
    cliente: null,
    venda: {
      pedidoId: "PED-1",
      data: new Date("2026-06-19T12:00:00Z"),
      total: 10,
      desconto: 0,
      operador: "Maria",
      terminal: "PDV1",
      paymentBreakdown: { dinheiro: 10 },
    },
    itens: [
      {
        itemVendaId: "iv-1",
        produtoId: "prod-1",
        codigoProduto: "SKU1",
        descricao: "Refrigerante",
        gtin: "7890000000017",
        quantidade: 1,
        valorUnitario: 10,
        valorDesconto: 0,
        valorTotal: 10,
        fiscal,
      },
    ],
  })
  if (!built.ok) throw new Error(`fixture inválida: ${built.error}`)
  return built.snapshot
}

const SNAPSHOT_OK = snapshotComFiscal(FISCAL_COMPLETO)
const SNAPSHOT_PENDENTE = snapshotComFiscal(PRODUTO_FISCAL_VAZIO)

const CONFIG_OK: FiscalProviderConfigInput = {
  provider: "STUB_HOMOLOGACAO",
  ambiente: "HOMOLOGACAO",
  modeloFiscal: "NFCE",
  fiscalEnabled: false,
  cnpj: "11.222.333/0001-81",
  razaoSocial: "Loja Teste LTDA",
  uf: "SP",
}

function requestDe(snapshot: VendaFiscalSnapshot): FiscalProviderRequest {
  return {
    contexto: { storeId: "loja-1", notaFiscalId: "nf-1", modelo: "NFCE", ambiente: "HOMOLOGACAO" },
    snapshot,
  }
}

// ── Resolver ─────────────────────────────────────────────────────────────────────────

describe("resolveFiscalProvider", () => {
  it("resolve o STUB_HOMOLOGACAO a partir da config", () => {
    const r = resolveFiscalProvider(CONFIG_OK)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.provider.tipo).toBe("STUB_HOMOLOGACAO")
      expect(r.provider.simulado).toBe(true)
    }
  })

  it("falha com config ausente (config_ausente)", () => {
    const r = resolveFiscalProvider(null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe("config_ausente")
  })

  it("falha com provider desconhecido (provider_desconhecido)", () => {
    const r = resolveFiscalProvider({ ...CONFIG_OK, provider: "PROVIDER_INEXISTENTE" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe("provider_desconhecido")
  })

  it("falha com provider do enum ainda não implementado (provider_nao_implementado)", () => {
    const r = resolveFiscalProvider({ ...CONFIG_OK, provider: "SEFAZ_DIRETO" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe("provider_nao_implementado")
  })
})

describe("helpers de configuração", () => {
  it("isFiscalProviderReady = true para config válida", () => {
    expect(isFiscalProviderReady(CONFIG_OK)).toBe(true)
  })

  it("isFiscalProviderReady = false para config incompleta", () => {
    expect(isFiscalProviderReady({ ...CONFIG_OK, cnpj: "" })).toBe(false)
    expect(isFiscalProviderReady(null)).toBe(false)
  })

  it("assertProviderConfigurado retorna o provider quando ok", () => {
    const p = assertProviderConfigurado(CONFIG_OK)
    expect(p.tipo).toBe("STUB_HOMOLOGACAO")
  })

  it("assertProviderConfigurado lança FiscalProviderConfigError quando não configurado", () => {
    expect(() => assertProviderConfigurado(null)).toThrow(FiscalProviderConfigError)
    expect(() => assertProviderConfigurado({ ...CONFIG_OK, provider: "X" })).toThrow(FiscalProviderConfigError)
  })
})

// ── Validações ───────────────────────────────────────────────────────────────────────

describe("validarConfiguracao (stub)", () => {
  it("aprova config mínima válida", () => {
    const r = stubHomologacaoProvider.validarConfiguracao(CONFIG_OK)
    expect(r.ok).toBe(true)
    expect(r.simulado).toBe(true)
  })

  it("marca pendência (não erro fatal) quando falta CNPJ/UF", () => {
    const r = stubHomologacaoProvider.validarConfiguracao({ ...CONFIG_OK, cnpj: "", uf: "" })
    expect(r.ok).toBe(false)
    expect(r.resultado).toBe("pendente")
    expect(r.pendencias.length).toBeGreaterThan(0)
  })

  it("erro quando config ausente", () => {
    const r = stubHomologacaoProvider.validarConfiguracao(null)
    expect(r.ok).toBe(false)
    expect(r.erros[0]?.code).toBe("config_ausente")
  })
})

describe("validarSnapshot (stub)", () => {
  it("aprova snapshot completo", () => {
    const r = stubHomologacaoProvider.validarSnapshot(SNAPSHOT_OK)
    expect(r.ok).toBe(true)
    expect(r.statusNota).toBe("VALIDANDO")
  })

  it("marca pendência para snapshot com item sem fiscal", () => {
    const r = stubHomologacaoProvider.validarSnapshot(SNAPSHOT_PENDENTE)
    expect(r.ok).toBe(false)
    expect(r.resultado).toBe("pendente")
    expect(r.pendencias.length).toBeGreaterThan(0)
  })

  it("erro para snapshot inválido (null ou sem itens)", () => {
    expect(stubHomologacaoProvider.validarSnapshot(null).erros[0]?.code).toBe("snapshot_invalido")
    const vazio = { ...SNAPSHOT_OK, itens: [] } as unknown as VendaFiscalSnapshot
    expect(stubHomologacaoProvider.validarSnapshot(vazio).erros[0]?.code).toBe("snapshot_invalido")
  })
})

// ── Operações simuladas ────────────────────────────────────────────────────────────────

describe("statusServico (stub)", () => {
  it("retorna online + simulado", async () => {
    const st = await stubHomologacaoProvider.statusServico({ provider: "STUB_HOMOLOGACAO", ambiente: "HOMOLOGACAO" })
    expect(st.online).toBe(true)
    expect(st.simulado).toBe(true)
    expect(st.cStat).toBe("107")
  })
})

describe("emitir (stub)", () => {
  it("retorna resposta controlada e SIMULADA para snapshot completo", async () => {
    const r = await stubHomologacaoProvider.emitir(requestDe(SNAPSHOT_OK))
    expect(r.ok).toBe(true)
    expect(r.simulado).toBe(true)
    expect(r.statusNota).toBe("AUTORIZADA")
    expect(r.dados?.placeholder).toBe(true)
    expect(String(r.dados?.chaveAcesso)).toMatch(/^SIM-/)
  })

  it("não emite (pendente) para snapshot incompleto", async () => {
    const r = await stubHomologacaoProvider.emitir(requestDe(SNAPSHOT_PENDENTE))
    expect(r.ok).toBe(false)
    expect(r.resultado).toBe("pendente")
    expect(r.statusNota).toBe("RASCUNHO")
  })
})

describe("cancelar (stub)", () => {
  it("retorna resposta controlada e SIMULADA com justificativa válida", async () => {
    const r = await stubHomologacaoProvider.cancelar({
      contexto: { storeId: "loja-1", notaFiscalId: "nf-1", modelo: "NFCE", ambiente: "HOMOLOGACAO" },
      chaveAcesso: "SIM-CHAVE-XYZ",
      justificativa: "Cancelamento de teste em homologação",
    })
    expect(r.ok).toBe(true)
    expect(r.simulado).toBe(true)
    expect(r.statusNota).toBe("CANCELADA")
    expect(r.dados?.cStat).toBe("135")
  })

  it("rejeita justificativa curta", async () => {
    const r = await stubHomologacaoProvider.cancelar({
      contexto: { storeId: "loja-1", notaFiscalId: "nf-1", modelo: "NFCE", ambiente: "HOMOLOGACAO" },
      justificativa: "curto",
    })
    expect(r.ok).toBe(false)
    expect(r.resultado).toBe("rejeitado")
    expect(r.erros[0]?.code).toBe("justificativa_invalida")
  })
})

// ── Normalização de erro ────────────────────────────────────────────────────────────────

describe("normalizeProviderError", () => {
  it("preserva um FiscalProviderError canônico", () => {
    const e = normalizeProviderError({ code: "snapshot_incompleto", mensagem: "faltou NCM", campo: "ncm" })
    expect(e.code).toBe("snapshot_incompleto")
    expect(e.campo).toBe("ncm")
  })

  it("normaliza um Error nativo", () => {
    const e = normalizeProviderError(new Error("falha X"))
    expect(e.code).toBe("erro_interno")
    expect(e.mensagem).toBe("falha X")
  })

  it("normaliza string", () => {
    expect(normalizeProviderError("boom").code).toBe("erro_interno")
  })

  it("normaliza objeto de gateway { message, code }", () => {
    const e = normalizeProviderError({ message: "timeout", code: 504 })
    expect(e.code).toBe("erro_interno")
    expect(e.mensagem).toBe("timeout")
    expect(e.origem).toBe("504")
  })

  it("extrai o erro de FiscalProviderConfigError", () => {
    const e = normalizeProviderError(new FiscalProviderConfigError({ code: "config_ausente", mensagem: "sem config" }))
    expect(e.code).toBe("config_ausente")
  })
})

// ── Isolamento: não depende de Produto vivo nem do banco ───────────────────────────────

describe("isolamento do provider", () => {
  it("opera SOMENTE sobre o snapshot congelado (sem Produto/banco em escopo)", async () => {
    // O único insumo é o snapshot já congelado — nada de Produto vivo é necessário.
    expect(Object.isFrozen(SNAPSHOT_OK)).toBe(true)
    const r = await stubHomologacaoProvider.emitir(requestDe(SNAPSHOT_OK))
    expect(r.ok).toBe(true)
    // O snapshot permanece intacto após a operação (provider não muta a entrada).
    expect(Object.isFrozen(SNAPSHOT_OK)).toBe(true)
    expect(SNAPSHOT_OK.itens[0]?.ncm).toBe("22021000")
  })

  it("o código do stub não importa prisma nem o módulo de Produto", () => {
    const src = readFileSync(path.join(HERE, "stub-homologacao.ts"), "utf8")
    // Alvo: declarações de import — menções em comentário não contam.
    expect(src).not.toMatch(/from\s+["']@\/lib\/prisma["']/)
    expect(src).not.toMatch(/from\s+["']@\/lib\/produto-fiscal["']/)
  })

  it("o resolver não importa prisma", () => {
    const src = readFileSync(path.join(HERE, "resolver.ts"), "utf8")
    expect(src).not.toMatch(/from\s+["']@\/lib\/prisma["']/)
  })
})
