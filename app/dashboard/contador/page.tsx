import type { Metadata } from "next"
import { Suspense } from "react"
import { ContadorHubPreview } from "@/components/dashboard/contador/contador-hub-preview"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"
import { formatCompetencia, resolveCompetenciaFromSearchParam } from "@/lib/contador/competencia"
import { montarChecklistFechamento } from "@/lib/contador/fechamento"
import type { ChecklistFechamento } from "@/lib/contador/fechamento"
import type { EvidenciaAgendaGuias } from "@/lib/contador/fechamento/montar-checklist"
import { requireContadorScope } from "@/lib/contador/scope"
import { construirDadosContador } from "@/lib/contador/readers"
import { lerIdentificacaoLoja } from "@/lib/contador/readers/loja"
import type { IdentificacaoLoja } from "@/lib/contador/readers/loja"
import type { ContadorDadosReais } from "@/lib/contador/readers/tipos"
import { lerNotasFiscais, toEvidenciaChecklist, type LeituraFiscalContador } from "@/lib/contador/readers/fiscal"
import { carregarResumoGuiasChecklist, criarRepoAgenda } from "@/lib/contador/agenda"

export const metadata: Metadata = {
  title: `Contador HUB · ${APP_DISPLAY_NAME}`,
  description:
    "Contador HUB interno — Visão Geral e relatórios básicos com dados reais da loja ativa por competência (leitura).",
}

export const dynamic = "force-dynamic"
export const revalidate = 0

type ContadorHubPageProps = {
  /**
   * Next.js 16: `searchParams` é Promise.
   * Competência canônica: `?c=AAAA-MM` (GOAL CONTADOR-HUB-COMPETENCIA-CONTRATOS-005).
   */
  searchParams: Promise<{ c?: string | string[] }>
}

const MOTIVO_MSG: Record<string, string> = {
  nao_autenticado: "Sessão não encontrada. Faça login para ver os dados reais da competência.",
  loja_ausente: "Nenhuma loja ativa selecionada. Escolha uma unidade para carregar os dados reais.",
  sem_acesso_loja: "Dados reais indisponíveis para a unidade ativa.",
  sem_permissao: "Sua conta não tem permissão para acessar os dados financeiros do Contador HUB.",
}

/**
 * Contador HUB interno (lojista/equipe) · GOAL 006 + 007.
 *
 * A Visão Geral e os relatórios básicos leem DADOS REAIS (read-only) da loja ativa na
 * competência `?c=AAAA-MM`. O checklist de Fechamento (GOAL 007) é **derivado em memória**
 * do mesmo DTO — sem reconsultar readers/Prisma. Escopo por sessão NextAuth + cookie de
 * loja + ACL multi-loja. Fonte fiscal: GOAL 018 (flag off → nao_disponivel). Fechamento real = GOAL 012.
 * Não confundir com o portal EXTERNO `/contador`.
 *
 * Fonte da competência: `searchParams.c` (AAAA-MM). Inválido/ausente → mês atual
 * em America/Sao_Paulo. Falha de escopo/leitura vira estado honesto (`realErro`), nunca zero.
 */
export default async function ContadorHubPage({ searchParams }: ContadorHubPageProps) {
  const params = await searchParams
  const competencia = resolveCompetenciaFromSearchParam(params.c)

  let realData: ContadorDadosReais | null = null
  let realErro: string | null = null
  let evidenciaAgenda: EvidenciaAgendaGuias | null = null
  let relatorioFiscal: LeituraFiscalContador | null = null
  let identificacaoLoja: IdentificacaoLoja | null = null

  const escopo = await requireContadorScope()
  if (!escopo.ok) {
    realErro = MOTIVO_MSG[escopo.motivo] ?? "Dados reais indisponíveis nesta fase."
  } else {
    try {
      // Única carga das sete fontes (GOAL 006). O checklist (GOAL 007) reusa este DTO.
      realData = await construirDadosContador(escopo, competencia)
    } catch (e) {
      console.error("[contador/dados-reais]", e instanceof Error ? e.message : String(e))
      realErro = "Não foi possível carregar os dados reais desta competência agora. Tente novamente em instantes."
    }
    // Agenda (GOAL 016): leitura independente — falha NÃO derruba os demais sinais.
    try {
      evidenciaAgenda = await carregarResumoGuiasChecklist(
        { storeId: escopo.storeId, userId: escopo.userId },
        formatCompetencia(competencia),
        { repo: criarRepoAgenda() },
      )
    } catch (e) {
      console.error("[contador/agenda-resumo]", e instanceof Error ? e.message : String(e))
      evidenciaAgenda = { leituraOk: false, total: 0, vencidas: 0, vencendo: 0, pagas: 0 }
    }
    // Loja (GOAL 023): cadastro persistido da unidade ativa — leitura independente.
    // Falha NÃO vira empresa de exemplo: a aba Configurações mostra indisponível.
    try {
      identificacaoLoja = await lerIdentificacaoLoja(escopo)
    } catch (e) {
      console.error("[contador/loja]", e instanceof Error ? e.message : String(e))
      identificacaoLoja = null
    }
    // Fiscal (GOAL 018): leitura independente — falha NÃO vira zero notas.
    try {
      relatorioFiscal = await lerNotasFiscais(escopo, competencia)
    } catch (e) {
      console.error("[contador/fiscal]", e instanceof Error ? e.message : String(e))
      relatorioFiscal = {
        disponivel: false,
        leituraOk: false,
        motivo: "leitura_falhou",
        entregaveis: [],
        rejeitadas: [],
        canceladas: [],
      }
    }
  }

  // Derivação pura em memória — zero Prisma no checklist.
  const checklistFechamento: ChecklistFechamento = montarChecklistFechamento({
    dados: realData,
    competencia,
    agora: new Date(),
    motivoIndisponivel: realErro,
    evidenciaAgenda,
    evidenciaFiscal: relatorioFiscal ? toEvidenciaChecklist(relatorioFiscal) : null,
  })

  return (
    <div className="w-full min-w-0">
      {/* useSearchParams no seletor exige boundary de Suspense (Next.js). */}
      <Suspense
        fallback={
          <div className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
            Carregando Contador HUB…
          </div>
        }
      >
        <ContadorHubPreview
          competencia={competencia}
          realData={realData}
          realErro={realErro}
          checklistFechamento={checklistFechamento}
          relatorioFiscal={relatorioFiscal}
          identificacaoLoja={identificacaoLoja}
        />
      </Suspense>
    </div>
  )
}
