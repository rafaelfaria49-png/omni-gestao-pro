/**
 * GOAL-016D-A — `SefazDiretoProvider` offline.
 *
 * Prova as barreiras que sustentam o slice: transporte default sempre recusa, zero import de
 * cliente HTTP, `SEFAZ_DIRETO` fora do `REGISTRY` de P1, métodos P1 inertes, coordenador
 * bloqueando o provider real ANTES de `transmit`, e zero contato com material do cofre.
 */
import { readFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { FiscalProviderTipo } from "@/generated/prisma"
import { resolveFiscalProvider } from "../resolver"
import { transmitWithUncertainStateSafety } from "@/lib/fiscal/emission/uncertain-state-coordinator"
import type {
  FiscalDocumentIdentity,
  PersistedFiscalDocument,
  UncertainStatePersistence,
  FinalizedDocumentPreparer,
} from "@/lib/fiscal/emission/uncertain-state.types"
import { SefazAdapterBlockedError, SefazDiretoProvider } from "./sefaz-direto-provider"
import type { SefazGuardPorts } from "./sefaz-guards"
import type { SefazTransport } from "./sefaz-transport.types"

const LOJA_PILOTO = "store-piloto-real"
const CHAVE = "3".repeat(44)
const XML = `<NFe><infNFe versao="4.00"><ide><tpAmb>2</tpAmb></ide></infNFe></NFe>`
const BYTES = new TextEncoder().encode(XML)
const SHA = createHash("sha256").update(BYTES).digest("hex")

const BLOB_REF_SENTINELA = "FISCAL_A1_PFX_B64_SENTINELA"
const SENHA_REF_SENTINELA = "FISCAL_A1_SENHA_SENTINELA"

function documento(overrides: Partial<FiscalDocumentIdentity> = {}): FiscalDocumentIdentity {
  return {
    storeId: LOJA_PILOTO,
    vendaId: "venda-1",
    notaFiscalId: "nota-1",
    modelo: "NFCE",
    ambiente: "HOMOLOGACAO",
    serie: 1,
    numero: 1,
    chaveAcesso: CHAVE,
    uf: "SP",
    correlationId: "corr-1",
    ...overrides,
  }
}

function portasAprovadas(overrides: Partial<SefazGuardPorts> = {}): SefazGuardPorts {
  return {
    resolvePilotStoreId: vi.fn(async () => LOJA_PILOTO),
    loadFiscalConfig: vi.fn(async () => ({ provider: "SEFAZ_DIRETO" })),
    readXsdAttestation: vi.fn(async (i: { bytesSha256: string }) => ({
      outcome: "VALIDACAO_APROVADA",
      xmlSha256: i.bytesSha256,
      schemaVersion: "PL_010e_v1.02/NFe/nfe_v4.00.xsd",
    })),
    resolveActiveCertificate: vi.fn(async () => ({
      ok: true as const,
      storeId: LOJA_PILOTO,
      certificadoId: "cert-1",
      blobRef: BLOB_REF_SENTINELA,
      senhaRef: SENHA_REF_SENTINELA,
      provider: "env-piloto",
    })),
    ...overrides,
  }
}

describe("transporte default — sempre bloqueado", () => {
  it("transmit termina em SefazAdapterBlockedError, mesmo com TODOS os guards aprovados", async () => {
    const provider = new SefazDiretoProvider({ ports: portasAprovadas() })
    const erro = await provider
      .transmit({ document: documento(), exactBytes: BYTES, bytesSha256: SHA })
      .catch((e: unknown) => e)

    expect(erro).toBeInstanceOf(SefazAdapterBlockedError)
    expect((erro as SefazAdapterBlockedError).codigo).toBe("transporte_offline_bloqueado")
    expect((erro as SefazAdapterBlockedError).externalTransmissionAttempted).toBe(false)
  })

  it("consult também termina bloqueado", async () => {
    const provider = new SefazDiretoProvider({ ports: portasAprovadas() })
    const erro = await provider.consult({ document: documento() }).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(SefazAdapterBlockedError)
    expect((erro as SefazAdapterBlockedError).codigo).toBe("transporte_offline_bloqueado")
  })

  it("NUNCA devolve desfecho fabricado (AUTHORIZED/REJECTED/UNCERTAIN)", async () => {
    const provider = new SefazDiretoProvider({ ports: portasAprovadas() })
    const resultado = await provider
      .transmit({ document: documento(), exactBytes: BYTES, bytesSha256: SHA })
      .then((r) => ({ retornou: true, r }))
      .catch(() => ({ retornou: false, r: null }))
    expect(resultado.retornou).toBe(false)
  })

  it("um guard reprovado bloqueia ANTES do transporte (transporte nem é chamado)", async () => {
    const transport: SefazTransport = { permiteRede: false, send: vi.fn() }
    const provider = new SefazDiretoProvider({
      ports: portasAprovadas({ loadFiscalConfig: vi.fn(async () => null) }),
      transport,
    })
    const erro = await provider
      .transmit({ document: documento(), exactBytes: BYTES, bytesSha256: SHA })
      .catch((e: unknown) => e)
    expect((erro as SefazAdapterBlockedError).codigo).toBe("provider_divergente")
    expect(transport.send).not.toHaveBeenCalled()
  })

  it("o erro de bloqueio não carrega cStat, protocolo, XML nem referências de cofre", async () => {
    const provider = new SefazDiretoProvider({ ports: portasAprovadas() })
    const erro = (await provider
      .transmit({ document: documento(), exactBytes: BYTES, bytesSha256: SHA })
      .catch((e: unknown) => e)) as SefazAdapterBlockedError
    const serializado = `${erro.name} ${erro.message} ${JSON.stringify({ codigo: erro.codigo })}`
    expect(serializado).not.toContain(BLOB_REF_SENTINELA)
    expect(serializado).not.toContain(SENHA_REF_SENTINELA)
    expect(serializado).not.toContain(XML)
    expect(serializado).not.toMatch(/cStat|protocolo/i)
  })
})

describe("proveniência de rede", () => {
  it("reporta externalTransmissionAttempted=false — nada tentou contato externo", async () => {
    const provider = new SefazDiretoProvider({ ports: portasAprovadas() })
    expect(provider.reportExternalTransmissionAttempted()).toBe(false)
    await provider
      .transmit({ document: documento(), exactBytes: BYTES, bytesSha256: SHA })
      .catch(() => null)
    expect(provider.reportExternalTransmissionAttempted()).toBe(false)
  })
})

describe("proveniência de rede é monotônica (segura sob reuso de instância)", () => {
  it("uma tentativa externa registrada NUNCA é apagada por uma execução offline seguinte", async () => {
    /**
     * Instâncias podem ser reaproveitadas entre jobs num worker pool. Se a flag fosse
     * reatribuída a cada chamada, uma execução que não alcançou a rede poderia sobrescrever
     * com `false` o registro de uma transmissão que de fato ocorreu — sub-reportar
     * transmissão é o erro caro (leva a retransmitir documento já enviado).
     */
    const transporteQueTentou: SefazTransport = {
      permiteRede: true,
      send: vi.fn(async () => ({
        ok: false as const,
        codigo: "transporte_destino_recusado" as const,
        mensagem: "falhou depois de tentar",
        externalTransmissionAttempted: false as const,
      })),
    }
    const provider = new SefazDiretoProvider({
      ports: portasAprovadas(),
      transport: transporteQueTentou,
    })

    // Simula o registro de uma tentativa externa real e confirma que ela é preservada
    // após uma execução subsequente cujo transporte não alcançou a rede.
    ;(provider as unknown as { externalAttempted: boolean }).externalAttempted = true
    await provider
      .transmit({ document: documento(), exactBytes: BYTES, bytesSha256: SHA })
      .catch(() => undefined)

    expect(provider.reportExternalTransmissionAttempted()).toBe(true)
  })
})

describe("zero import de cliente HTTP em todo o adapter", () => {
  const dir = __dirname
  const fontes = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))

  it("nenhum arquivo do adapter importa fetch/undici/axios/http/https/net/tls", () => {
    expect(fontes.length).toBeGreaterThan(0)
    for (const arquivo of fontes) {
      const src = readFileSync(join(dir, arquivo), "utf8")
      expect(src, arquivo).not.toMatch(/from\s+["']node:(http|https|net|tls|dgram)["']/)
      expect(src, arquivo).not.toMatch(/from\s+["'](undici|axios|node-fetch|got|superagent)["']/)
      expect(src, arquivo).not.toMatch(/require\(\s*["']node:(http|https|net|tls)["']\s*\)/)
      // `fetch(` como chamada — menções em comentário/string de nome não contam
      expect(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), arquivo).not.toMatch(
        /\bfetch\s*\(/,
      )
      expect(src, arquivo).not.toMatch(/new\s+XMLHttpRequest|WebSocket\s*\(/)
    }
  })

  it("nenhum arquivo do adapter importa Prisma ou o cofre de segredos", () => {
    for (const arquivo of fontes) {
      const src = readFileSync(join(dir, arquivo), "utf8")
      expect(src, arquivo).not.toMatch(/from\s+["']@\/lib\/prisma["']/)
      expect(src, arquivo).not.toMatch(/from\s+["']@\/lib\/fiscal\/vault/)
    }
  })

  it("nenhum arquivo do adapter chama métodos de material do cofre", () => {
    for (const arquivo of fontes) {
      const src = readFileSync(join(dir, arquivo), "utf8")
      const semComentarios = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
      expect(semComentarios, arquivo).not.toMatch(
        /\.(getCertificadoPfx|getCertificadoSenha|getCscToken|putCertificadoPfx|putCscToken|rotateCertificadoPfx|revoke)\s*\(/,
      )
    }
  })
})

describe("REGISTRY de P1 permanece sem SEFAZ_DIRETO (ADR-0020 §2.2 · D11 regra 1)", () => {
  it("resolveFiscalProvider(SEFAZ_DIRETO) ⇒ provider_nao_implementado", () => {
    const r = resolveFiscalProvider({
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      ambiente: "HOMOLOGACAO",
      modeloFiscal: "NFCE",
      fiscalEnabled: false,
      cnpj: "11222333000181",
      razaoSocial: "Loja Piloto",
      uf: "SP",
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe("provider_nao_implementado")
  })

  it("o pipeline P1 continua incapaz de instanciar o adapter real pelo resolver", () => {
    const r = resolveFiscalProvider({
      provider: "SEFAZ_DIRETO",
      ambiente: "HOMOLOGACAO",
      modeloFiscal: "NFCE",
      fiscalEnabled: true,
      cnpj: "11222333000181",
      razaoSocial: "Loja Piloto",
      uf: "SP",
    })
    expect(r.ok).toBe(false)
  })
})

describe("superfície P1 — inerte, sem rede/venda/série/NotaFiscal", () => {
  const provider = new SefazDiretoProvider({ ports: portasAprovadas() })

  it("emitir/prepararEmissao/validarSnapshot/consultar/cancelar/inutilizar ⇒ operacao_nao_suportada", async () => {
    const respostas = [
      provider.prepararEmissao({} as never),
      provider.validarSnapshot(null),
      await provider.emitir({} as never),
      await provider.consultar({} as never),
      await provider.cancelar({} as never),
      await provider.inutilizar({} as never),
    ]
    for (const r of respostas) {
      expect(r.ok).toBe(false)
      expect(r.erros[0]?.code).toBe("operacao_nao_suportada")
      expect(r.dados).toBeNull()
      expect(r.statusNota).toBeNull()
    }
  })

  it("statusServico fica bloqueado pelo transporte offline — sem fingir 107", async () => {
    const status = await provider.statusServico({
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      ambiente: "HOMOLOGACAO",
    })
    expect(status.online).toBe(false)
    expect(status.cStat).toBeNull()
    expect(status.simulado).toBe(false)
    expect(status.mensagem).toMatch(/offline|indispon/i)
  })

  it("o bloqueio de statusServico DERIVA do transporte, não de um literal do adapter", async () => {
    /**
     * Com um transporte que declara `permiteRede`, a mensagem muda — prova de que o adapter
     * consulta a capacidade real do transporte injetado em vez de afirmar "offline" sobre si
     * mesmo. `online` continua `false` e `cStat` continua `null`: sem parser (016D-B) nenhuma
     * resposta pode ser interpretada, então nada é fingido em nenhum dos dois casos.
     */
    const comRede = new SefazDiretoProvider({
      ports: portasAprovadas(),
      transport: {
        permiteRede: true,
        send: vi.fn(),
      },
    })
    const status = await comRede.statusServico({
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      ambiente: "HOMOLOGACAO",
    })
    expect(status.online).toBe(false)
    expect(status.cStat).toBeNull()
    expect(status.mensagem).toMatch(/parser/i)
    expect(status.mensagem).not.toMatch(/transporte SEFAZ é offline/i)
  })

  it("validarConfiguracao é pura e aponta as pendências reais do piloto", async () => {
    const ok = provider.validarConfiguracao({
      provider: "SEFAZ_DIRETO",
      ambiente: "HOMOLOGACAO",
      modeloFiscal: "NFCE",
      fiscalEnabled: false,
      cnpj: "11222333000181",
      razaoSocial: "Loja Piloto",
      uf: "SP",
    })
    expect(ok.ok).toBe(true)
    expect(ok.pendencias).toEqual([])

    const ruim = provider.validarConfiguracao({
      provider: "STUB_HOMOLOGACAO",
      ambiente: "PRODUCAO",
      modeloFiscal: "NFE",
      fiscalEnabled: true,
      cnpj: "",
      razaoSocial: "",
      uf: "RJ",
    })
    expect(ruim.ok).toBe(false)
    expect(ruim.pendencias).toEqual(
      expect.arrayContaining(["provider", "ambiente", "modeloFiscal", "uf", "cnpj", "razaoSocial"]),
    )

    expect(provider.validarConfiguracao(null).erros[0]?.code).toBe("config_ausente")
  })

  it("`fiscalEnabled` não é condição de aprovação da configuração", () => {
    const desligado = provider.validarConfiguracao({
      provider: "SEFAZ_DIRETO",
      ambiente: "HOMOLOGACAO",
      modeloFiscal: "NFCE",
      fiscalEnabled: false,
      cnpj: "11222333000181",
      razaoSocial: "Loja Piloto",
      uf: "SP",
    })
    expect(desligado.ok).toBe(true)
  })
})

describe("coordenador bloqueia o provider real ANTES de transmit (ADR-0017 · F-1)", () => {
  it("provider não simulado ⇒ REAL_PROVIDER_BLOCKED, sem tocar persistência nem preparer", async () => {
    const provider = new SefazDiretoProvider({ ports: portasAprovadas() })
    const transmitSpy = vi.spyOn(provider, "transmit")

    const persistence = {
      load: vi.fn(),
      persistBeforeTransmission: vi.fn(),
      recordUncertainAndEnsureConsultation: vi.fn(),
      markAuthorized: vi.fn(),
      markRejected: vi.fn(),
      authorizeExactRetransmission: vi.fn(),
    } as unknown as UncertainStatePersistence
    const preparer = { prepare: vi.fn() } as unknown as FinalizedDocumentPreparer

    const outcome = await transmitWithUncertainStateSafety({
      locator: { storeId: LOJA_PILOTO, vendaId: "venda-1", notaFiscalId: "nota-1" },
      persistence,
      preparer,
      provider,
    })

    expect(outcome).toMatchObject({ kind: "blocked", code: "REAL_PROVIDER_BLOCKED" })
    expect(transmitSpy).not.toHaveBeenCalled()
    expect(persistence.load).not.toHaveBeenCalled()
    expect(preparer.prepare).not.toHaveBeenCalled()
  })

  it("o adapter se declara honestamente NÃO simulado (simulado nunca é a barreira)", () => {
    const provider = new SefazDiretoProvider({ ports: portasAprovadas() })
    expect(provider.simulado).toBe(false)
    expect(provider.tipo).toBe(FiscalProviderTipo.SEFAZ_DIRETO)
  })
})

describe("fiação real de ponta a ponta pelo executor da fila", () => {
  it("SefazDiretoProvider pelo executor ⇒ terminal bloqueado, sem tentativa externa", async () => {
    /**
     * Fecha a lacuna entre os dois lados já provados isoladamente (derivação de flags com
     * provider dublê × coordenador barrando o provider real): aqui o adapter REAL atravessa
     * o executor REAL, que é o caminho que 016D-B passará a exercitar.
     */
    const { createUncertainStateJobExecutor } = await import(
      "@/lib/fiscal/emission/uncertain-state-job-executor"
    )
    const provider = new SefazDiretoProvider({ ports: portasAprovadas() })
    const transmitSpy = vi.spyOn(provider, "transmit")

    const persistence = {
      load: vi.fn(),
      persistBeforeTransmission: vi.fn(),
      recordUncertainAndEnsureConsultation: vi.fn(),
      markAuthorized: vi.fn(),
      markRejected: vi.fn(),
      authorizeExactRetransmission: vi.fn(),
    } as unknown as UncertainStatePersistence

    const executor = createUncertainStateJobExecutor({
      persistence,
      preparer: { prepare: vi.fn() } as unknown as FinalizedDocumentPreparer,
      provider,
    })

    const resultado = await executor({
      id: "job-1",
      storeId: LOJA_PILOTO,
      vendaId: "venda-1",
      notaFiscalId: "nota-1",
      tipo: "EMISSAO",
      status: "PROCESSANDO",
      tentativas: 1,
      maxTentativas: 3,
      proximaTentativaEm: null,
      prioridade: 0,
      lockOwner: "w1",
      lockedAt: null,
      lockExpiresAt: null,
      dedupeKey: null,
      payload: { version: 2 },
      ultimoErro: null,
      concluidoEm: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    expect(resultado.kind).toBe("terminal")
    expect(resultado.code).toBe("real_provider_blocked")
    // O provider real nunca é invocado, e a trilha registra isso honestamente.
    expect(transmitSpy).not.toHaveBeenCalled()
    expect(resultado.externalTransmissionAttempted).toBe(false)
    expect(resultado.simulado).toBe(true)
    // Nenhum efeito colateral: nada foi lido, preparado ou persistido.
    expect(persistence.load).not.toHaveBeenCalled()
  })
})

describe("stub existente continua simulado (nenhuma regressão do GOAL-012)", () => {
  it("UncertainStateTestStub mantém simulado = true e passa pelo coordenador", async () => {
    const { UncertainStateTestStub } = await import("../uncertain-state-test-stub")
    const stub = new UncertainStateTestStub({ transmission: ["AUTHORIZED"], consultation: "AUTHORIZED" })
    expect(stub.simulado).toBe(true)

    const persisted: PersistedFiscalDocument = {
      ...documento(),
      status: "TRANSMITINDO",
      xmlAssinado: XML,
      xmlBytesSha256: SHA,
    }
    const persistence = {
      load: vi.fn(async () => persisted),
      persistBeforeTransmission: vi.fn(async () => persisted),
      recordUncertainAndEnsureConsultation: vi.fn(),
      markAuthorized: vi.fn(async () => undefined),
      markRejected: vi.fn(),
      authorizeExactRetransmission: vi.fn(),
    } as unknown as UncertainStatePersistence

    const outcome = await transmitWithUncertainStateSafety({
      locator: { storeId: LOJA_PILOTO, vendaId: "venda-1", notaFiscalId: "nota-1" },
      persistence,
      preparer: { prepare: vi.fn() } as unknown as FinalizedDocumentPreparer,
      provider: stub,
      retryAuthorizedByConsultation: true,
    })
    expect(outcome.kind).toBe("authorized")
  })
})
