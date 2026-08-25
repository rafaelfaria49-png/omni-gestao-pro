/**
 * Pipeline Oficial de Emissão Fiscal (GOAL_007) — orquestração DORMENTE.
 *
 * Executa, sobre o snapshot CONGELADO (GOAL_005) e o provider resolvido (GOAL_006):
 *   validarConfiguracao → validarSnapshot → prepararEmissao → emitir
 * e interpreta o retorno para decidir o próximo `Venda.fiscalStatus`.
 *
 * Regras de mutação (mínimas e explícitas):
 *  - A ÚNICA escrita de estado é `ports.setFiscalStatus`. Tudo o mais é trilha (`ports.log`).
 *  - O status só avança no CAMINHO DE EMISSÃO: EMITINDO (antes de `emitir`) → status final.
 *  - Pré-condições que falham (provider ausente, snapshot inexistente/inválido, loja
 *    inválida, snapshot pendente) NÃO mexem em `fiscalStatus` — apenas relatam o motivo.
 *  - Idempotência: AUTORIZADA → no-op; EMITINDO → no-op (em andamento); CANCELADA/BLOQUEADA → bloqueada.
 *  - Sem prisma, sem rede, sem XML/DANFE/QRCode. Provider é sempre `simulado = true` nesta fase.
 */
import { FiscalStatusVenda } from "@/generated/prisma"
import { normalizeFiscalStatus } from "../venda-fiscal-state-machine"
import type {
  FiscalProvider,
  FiscalProviderContexto,
  FiscalProviderDados,
  FiscalProviderError,
  FiscalProviderResponse,
} from "../provider/types"
import type { VendaFiscalSnapshot } from "../venda-fiscal-snapshot"
import type {
  EmissionEtapaNome,
  EmissionEtapaResumo,
  EmissionErrorCode,
  EmissionOutcome,
  EmissionPipelineInput,
  EmissionPorts,
  EmissionResultado,
} from "./emission.types"

const S = FiscalStatusVenda

/** Estados a partir dos quais o pipeline pode iniciar uma emissão. */
const STARTABLE = new Set<string>([S.NAO_FISCAL, S.PENDENTE, S.REJEITADA, S.EM_CONTINGENCIA])

function nowFn(ports: EmissionPorts): () => number {
  return ports.now ?? Date.now
}

function resumoEtapa(etapa: EmissionEtapaNome, resp: FiscalProviderResponse): EmissionEtapaResumo {
  return {
    etapa,
    resultado: resp.resultado,
    ok: resp.ok,
    mensagem: resp.mensagem,
    pendencias: resp.pendencias ?? [],
    erros: (resp.erros ?? []).map((e) => e.code),
  }
}

function resumirSnapshot(snapshot: VendaFiscalSnapshot | null): Record<string, unknown> {
  if (!snapshot) return { presente: false }
  return {
    presente: true,
    vendaId: snapshot.vendaId,
    modelo: snapshot.modelo,
    ambiente: snapshot.ambiente,
    itens: Array.isArray(snapshot.itens) ? snapshot.itens.length : 0,
    total: snapshot.totais?.valorTotal ?? null,
    prontoParaEmissao: snapshot.diagnostico?.prontoParaEmissao ?? null,
  }
}

function resumirResponse(resp: FiscalProviderResponse): Record<string, unknown> {
  return {
    resultado: resp.resultado,
    ok: resp.ok,
    statusNota: resp.statusNota ?? null,
    mensagem: resp.mensagem,
    chaveAcesso: resp.dados?.chaveAcesso ?? null,
    protocolo: resp.dados?.protocolo ?? null,
    pendencias: resp.pendencias ?? [],
    erros: (resp.erros ?? []).map((e) => e.code),
  }
}

/** Interpreta a resposta de `emitir` no próximo estado fiscal da venda. */
function interpretarEmissao(resp: FiscalProviderResponse): { status: FiscalStatusVenda; resultado: EmissionResultado } {
  const st = String(resp.statusNota ?? "").toUpperCase()
  if (resp.resultado === "ok") {
    if (st === "CONTINGENCIA") return { status: S.EM_CONTINGENCIA, resultado: "contingencia" }
    return { status: S.AUTORIZADA, resultado: "autorizada" }
  }
  if (resp.resultado === "rejeitado") return { status: S.REJEITADA, resultado: "rejeitada" }
  if (resp.resultado === "pendente") return { status: S.PENDENTE, resultado: "pendente" }
  // resultado "erro": falha de transmissão (simulada) → recuperável via contingência.
  return { status: S.EM_CONTINGENCIA, resultado: "contingencia" }
}

/**
 * Executa o pipeline de emissão. `ports` injeta os efeitos (persistir fiscalStatus + log),
 * mantendo esta função independente de Prisma/rede e plenamente testável.
 */
export async function runEmissionPipeline(
  input: EmissionPipelineInput,
  ports: EmissionPorts,
): Promise<EmissionOutcome> {
  const clock = nowFn(ports)
  const start = clock()
  const anterior = normalizeFiscalStatus(input.currentFiscalStatus)
  const provider: FiscalProvider | null = input.provider
  const providerNome = input.providerTipo || provider?.tipo || ""
  const simulado = provider?.simulado ?? true
  const etapas: EmissionEtapaResumo[] = []

  const finalize = (p: {
    ok: boolean
    resultado: EmissionResultado
    fiscalStatusNovo: FiscalStatusVenda
    idempotente?: boolean
    dados?: FiscalProviderDados | null
    mensagem: string
    pendencias?: string[]
    erros?: FiscalProviderError[]
    errorCode?: EmissionErrorCode | null
  }): EmissionOutcome => ({
    ok: p.ok,
    resultado: p.resultado,
    simulado,
    provider: providerNome,
    fiscalStatusAnterior: anterior,
    fiscalStatusNovo: p.fiscalStatusNovo,
    idempotente: p.idempotente ?? false,
    notaFiscalId: input.notaFiscalId,
    dados: p.dados ?? null,
    mensagem: p.mensagem,
    pendencias: p.pendencias ?? [],
    erros: p.erros ?? [],
    errorCode: p.errorCode ?? null,
    etapas,
    durationMs: Math.max(0, clock() - start),
  })

  const baseDetalhe = () => ({
    provider: providerNome,
    simulado,
    fiscalStatusAnterior: anterior,
    snapshot: resumirSnapshot(input.snapshot),
    etapas,
    durationMs: Math.max(0, clock() - start),
  })

  // ── 0) Idempotência / gate de estado ────────────────────────────────────────────────
  if (anterior === S.AUTORIZADA) {
    await ports.log({
      acao: "emissao.idempotente",
      nivel: "INFO",
      mensagem: "Venda já AUTORIZADA — emissão ignorada (idempotente).",
      detalhe: { ...baseDetalhe(), resultado: "ja_autorizada" },
    })
    return finalize({ ok: true, resultado: "ja_autorizada", fiscalStatusNovo: S.AUTORIZADA, idempotente: true, mensagem: "Nota já autorizada — nada a fazer." })
  }
  if (anterior === S.EMITINDO) {
    await ports.log({
      acao: "emissao.idempotente",
      nivel: "INFO",
      mensagem: "Venda já em EMITINDO — execução concorrente ignorada.",
      detalhe: { ...baseDetalhe(), resultado: "em_andamento" },
    })
    return finalize({ ok: true, resultado: "em_andamento", fiscalStatusNovo: S.EMITINDO, idempotente: true, mensagem: "Emissão já em andamento." })
  }
  if (!STARTABLE.has(anterior)) {
    await ports.log({
      acao: "emissao.bloqueada",
      nivel: "WARN",
      mensagem: `Estado fiscal ${anterior} não permite emissão.`,
      detalhe: { ...baseDetalhe(), resultado: "bloqueada" },
    })
    return finalize({
      ok: false,
      resultado: "bloqueada",
      fiscalStatusNovo: anterior,
      idempotente: true,
      mensagem: `Venda em ${anterior} — emissão bloqueada.`,
      errorCode: "estado_bloqueado",
    })
  }

  // ── 1) Provider ausente ───────────────────────────────────────────────────────────────
  if (!provider) {
    const code: EmissionErrorCode = input.resolveError?.code === "config_ausente" ? "config_ausente" : "provider_ausente"
    const err: FiscalProviderError =
      input.resolveError ?? { code: "provider_desconhecido", mensagem: "Provider fiscal não resolvido." }
    await ports.log({
      acao: "emissao.erro",
      nivel: "ERROR",
      mensagem: err.mensagem,
      detalhe: { ...baseDetalhe(), errorCode: code, erro: err },
    })
    return finalize({ ok: false, resultado: "erro", fiscalStatusNovo: anterior, mensagem: err.mensagem, erros: [err], errorCode: code })
  }

  // ── 2) Snapshot inexistente ─────────────────────────────────────────────────────────
  if (!input.snapshot) {
    const mensagem = "Snapshot fiscal inexistente — não há NotaFiscal vigente para a venda."
    await ports.log({
      acao: "emissao.erro",
      nivel: "ERROR",
      mensagem,
      detalhe: { ...baseDetalhe(), errorCode: "snapshot_inexistente" },
    })
    return finalize({ ok: false, resultado: "erro", fiscalStatusNovo: anterior, mensagem, errorCode: "snapshot_inexistente" })
  }
  const snapshot = input.snapshot
  const contexto: FiscalProviderContexto = {
    storeId: snapshot.storeId,
    notaFiscalId: input.notaFiscalId,
    modelo: snapshot.modelo,
    ambiente: snapshot.ambiente,
  }

  // ── 3) validarConfiguracao ────────────────────────────────────────────────────────────
  const vc = provider.validarConfiguracao(input.config)
  etapas.push(resumoEtapa("validarConfiguracao", vc))
  if (!vc.ok) {
    await ports.log({
      acao: "emissao.config_invalida",
      nivel: "WARN",
      mensagem: vc.mensagem,
      detalhe: { ...baseDetalhe(), errorCode: "loja_invalida", response: resumirResponse(vc) },
    })
    return finalize({
      ok: false,
      resultado: "erro",
      fiscalStatusNovo: anterior,
      mensagem: vc.mensagem,
      pendencias: vc.pendencias,
      erros: vc.erros,
      errorCode: "loja_invalida",
    })
  }

  // ── 4) validarSnapshot ────────────────────────────────────────────────────────────────
  const vs = provider.validarSnapshot(snapshot)
  etapas.push(resumoEtapa("validarSnapshot", vs))
  if (!vs.ok) {
    const pendente = vs.resultado === "pendente"
    const errorCode: EmissionErrorCode | null = pendente ? null : "snapshot_invalido"
    await ports.log({
      acao: pendente ? "emissao.snapshot_pendente" : "emissao.snapshot_invalido",
      nivel: "WARN",
      mensagem: vs.mensagem,
      detalhe: { ...baseDetalhe(), errorCode, response: resumirResponse(vs) },
    })
    return finalize({
      ok: false,
      resultado: pendente ? "pendente" : "erro",
      fiscalStatusNovo: anterior,
      mensagem: vs.mensagem,
      pendencias: vs.pendencias,
      erros: vs.erros,
      errorCode,
    })
  }

  // ── 5) prepararEmissao ────────────────────────────────────────────────────────────────
  const pe = provider.prepararEmissao({ contexto, snapshot })
  etapas.push(resumoEtapa("prepararEmissao", pe))
  if (!pe.ok) {
    const pendente = pe.resultado === "pendente"
    const errorCode: EmissionErrorCode | null = pendente ? null : "snapshot_invalido"
    await ports.log({
      acao: "emissao.preparo_falhou",
      nivel: "WARN",
      mensagem: pe.mensagem,
      detalhe: { ...baseDetalhe(), errorCode, response: resumirResponse(pe) },
    })
    return finalize({
      ok: false,
      resultado: pendente ? "pendente" : "erro",
      fiscalStatusNovo: anterior,
      mensagem: pe.mensagem,
      pendencias: pe.pendencias,
      erros: pe.erros,
      errorCode,
    })
  }

  // ── 5b) Numeração fiscal (GOAL_008) — série+número ANTES de emitir ────────────────────
  // Pré-condição de emissão: a NotaFiscal precisa de (modelo, série, número, ambiente).
  // Falha aqui (ex.: nenhuma série ativa) NÃO muta fiscalStatus e NÃO emite.
  if (ports.allocateNumero) {
    const alloc = await ports.allocateNumero({
      storeId: snapshot.storeId,
      notaFiscalId: input.notaFiscalId,
      modelo: snapshot.modelo,
      ambiente: snapshot.ambiente,
    })
    if (ports.recordLacunasParaInutilizacao && alloc.lacunas.length > 0) {
      await ports.recordLacunasParaInutilizacao(alloc.lacunas)
    }
    if (!alloc.ok) {
      await ports.log({
        acao: "emissao.numeracao_indisponivel",
        nivel: "ERROR",
        mensagem: alloc.mensagem,
        detalhe: { ...baseDetalhe(), errorCode: "numeracao_indisponivel", numeracao: { erro: alloc.errorCode } },
      })
      return finalize({
        ok: false,
        resultado: "erro",
        fiscalStatusNovo: anterior,
        mensagem: alloc.mensagem,
        errorCode: "numeracao_indisponivel",
      })
    }
    // Snapshot/contexto NUMERADO entregue ao provider em `emitir`.
    contexto.serie = alloc.serie
    contexto.numero = alloc.numero
    await ports.log({
      acao: "emissao.numeracao",
      nivel: "INFO",
      mensagem: `Número fiscal ${alloc.reused ? "reaproveitado (idempotente)" : "alocado"}: modelo ${alloc.modelo} série ${alloc.serie} nº ${alloc.numero}.`,
      detalhe: {
        ...baseDetalhe(),
        numeracao: {
          numeroAlocado: alloc.numero,
          serie: alloc.serie,
          modelo: alloc.modelo,
          ambiente: alloc.ambiente,
          serieFiscalId: alloc.serieFiscalId,
          reused: alloc.reused,
        },
      },
    })
  }

  // ── 6) Transição para EMITINDO (antes de transmitir) ──────────────────────────────────
  await ports.setFiscalStatus(S.EMITINDO)
  await ports.log({
    acao: "emissao.emitindo",
    nivel: "INFO",
    mensagem: "Iniciando emissão (simulada).",
    detalhe: { ...baseDetalhe(), fiscalStatusNovo: S.EMITINDO },
  })

  // ── 7) emitir + interpretação ──────────────────────────────────────────────────────────
  const em = await provider.emitir({ contexto, snapshot })
  etapas.push(resumoEtapa("emitir", em))
  const { status: novo, resultado } = interpretarEmissao(em)
  await ports.setFiscalStatus(novo)
  await ports.log({
    acao: "emissao.resultado",
    nivel: resultado === "autorizada" ? "INFO" : resultado === "rejeitada" ? "WARN" : "WARN",
    mensagem: em.mensagem,
    cStat: em.dados?.cStat ?? null,
    xMotivo: em.dados?.xMotivo ?? null,
    detalhe: { ...baseDetalhe(), resultado, fiscalStatusNovo: novo, request: resumirSnapshot(snapshot), response: resumirResponse(em) },
  })

  return finalize({
    ok: resultado === "autorizada",
    resultado,
    fiscalStatusNovo: novo,
    dados: em.dados,
    mensagem: em.mensagem,
    pendencias: em.pendencias,
    erros: em.erros,
  })
}
