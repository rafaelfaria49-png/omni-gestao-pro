"use client"

/**
 * Contador HUB (interno) · casca visual — GOAL CONTADOR-HUB-VISUAL-PREVIEW-ONLY-001.
 *
 * Rota: /dashboard/contador (NÃO confundir com o portal externo antigo /contador,
 * que permanece intacto). Esta é a primeira versão VISUAL para lojista/equipe,
 * baseada no design aprovado do Cloud Design e adaptada aos tokens do OmniGestão
 * Pro (o design usava indigo; aqui o acento é o `primary` da marca).
 *
 * Estado após o GOAL CONTADOR-HUB-INTERNAL-REALIFICATION-023: o HUB **não** é mais
 * uma casca. Fechamento (012), Documentos (010), Obrigações (016), Permissões (014),
 * Timeline (011), Avisos (017), Folha (023) e o resumo do Portal (023) leem e
 * escrevem dados reais; Visão geral, Relatórios, Dossiês e Configurações são
 * híbridos, com o que ainda é preview identificado NO BLOCO — não há mais aviso
 * global negando funcionalidades que já existem.
 *
 * `contador-preview-data.ts` guarda apenas CATÁLOGOS (seções, itens de dossiê, o que
 * o portal externo faz). Nenhuma fixture pode afirmar estado da empresa do usuário.
 *
 * O AppShell continua dono único do scroll — este componente flui, não cria scroll
 * de página.
 *
 * Competência (GOAL 005): prop `competencia` vem da URL (`?c=AAAA-MM`) via page.tsx.
 * Navegação anterior/próxima usa router.replace — sem useState de mês/ano.
 */
import { useCallback, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Info,
  MessageSquare,
  Sparkles,
  Upload,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import {
  competenciaAnterior,
  competenciaProxima,
  formatCompetencia,
  formatCompetenciaMmYyyy,
  labelCompetencia,
  labelCompetenciaCurta,
  type Competencia,
} from "@/lib/contador/competencia"
import type { ChecklistFechamento } from "@/lib/contador/fechamento"
import type { LeituraFiscalContador } from "@/lib/contador/readers/fiscal"
import type { IdentificacaoLoja } from "@/lib/contador/readers/loja"
import type { ContadorDadosReais, DisponibilidadeDado } from "@/lib/contador/readers/tipos"
import {
  VisaoGeralReal,
  RelatoriosReal,
  RelatorioFiscalReal,
  ContadorRealIndisponivel,
} from "./contador-dados-reais"
// GOAL 012: `FECHAR_COMPETENCIA_TITLE` (título do CTA desabilitado do GOAL 007) deixou
// de ser importado — o fechamento agora é real e o botão vive em ContadorFechamentoReal.
import { ContadorFechamentoChecklist } from "./contador-fechamento-checklist"
import {
  ContadorPacoteDownload,
  PACOTE_INDISPONIVEL_TITLE,
  usePacoteDownload,
} from "./contador-pacote-download"
import { ContadorDocumentosReal } from "./documentos/contador-documentos-real"
import { ContadorAgendaReal } from "./agenda/contador-agenda-real"
import { ContadorFechamentoReal } from "./fechamento/contador-fechamento-real"
import { ContadorTimelineReal } from "./timeline/contador-timeline-real"
import { ContadorPermissoesReal } from "./permissoes/contador-permissoes-real"
import { ContadorAvisosReal } from "./avisos/contador-avisos-real"
import { ContadorFolhaReal } from "./folha/contador-folha-real"
import { ContadorPortalResumo } from "./portal/contador-portal-resumo"
import {
  CONTADOR_SECTIONS,
  DOSSIES,
  DOSSIE_FILTERS,
  PORTAL_NAO_PODE,
  PORTAL_PODE,
  RADAR_CNPJ,
  RELATORIO_CARDS,
  dossieFilterCount,
  dossieRowMatches,
  type ChipVariant,
  type ContadorSectionId,
  type DossieFilter,
  type DossieOrigem,
  type DossieRow,
  type MetricaSistema,
} from "./contador-preview-data"

/* ───────────────────────── helpers de estilo (tokens semânticos) ───────────────────────── */

const CHIP_CLASS: Record<ChipVariant, string> = {
  pend: "border-border bg-muted text-muted-foreground",
  env: "border-sky-500/30 bg-sky-500/10 text-sky-500",
  conf: "border-violet-500/30 bg-violet-500/10 text-violet-500",
  res: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  venc: "border-rose-500/30 bg-rose-500/10 text-rose-500",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
}

function Chip({ variant, children }: { variant: ChipVariant; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold",
        CHIP_CLASS[variant],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  )
}

function ValidarBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3" />
      validar com contador
    </span>
  )
}

function PreviewPill({ children = "preview" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-primary">
      {children}
    </span>
  )
}

const ORIGEM_META: Record<DossieOrigem, { label: string; icon: LucideIcon; className: string }> = {
  sistema: { label: "OmniGestão", icon: Sparkles, className: "border-primary/25 bg-primary/10 text-primary" },
  anexar: { label: "anexar", icon: Upload, className: "border-sky-500/25 bg-sky-500/10 text-sky-500" },
  portal: { label: "portal", icon: ExternalLink, className: "border-border bg-muted text-muted-foreground" },
  solicitar: { label: "solicitar", icon: MessageSquare, className: "border-violet-500/25 bg-violet-500/10 text-violet-500" },
}

function OrigemChip({ origem }: { origem: DossieOrigem }) {
  const m = ORIGEM_META[origem]
  const Icon = m.icon
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold", m.className)}>
      <Icon className="h-3 w-3" />
      {m.label}
    </span>
  )
}

const TINT_CLASS: Record<string, string> = {
  primary: "bg-primary/10 text-primary",
  info: "bg-sky-500/10 text-sky-500",
  danger: "bg-rose-500/10 text-rose-500",
  conf: "bg-violet-500/10 text-violet-500",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
}

/* Blocos reutilizáveis */

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-xl border border-border bg-card shadow-sm", className)}>{children}</div>
}

function CardHead({ title, right }: { title: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
      <h3 className="min-w-0 text-[15px] font-semibold text-foreground">{title}</h3>
      {right}
    </div>
  )
}

function SectionHeader({ title, desc, actions }: { title: string; desc: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-xl font-bold tracking-tight text-foreground">{title}</h2>
        <p className="mt-1 max-w-[64ch] text-[13px] text-muted-foreground">{desc}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  )
}

function EmptyPreview({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <Card className="grid place-items-center gap-2 px-6 py-14 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
        <Eye className="h-5 w-5" />
      </div>
      <div className="text-[15px] font-semibold text-foreground">{title}</div>
      <p className="max-w-[48ch] text-[13px] text-muted-foreground">
        {children ?? "Preview visual — integração real será feita em fase futura."}
      </p>
      <PreviewPill>preview</PreviewPill>
    </Card>
  )
}

/* Botões */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost"
  size?: "sm" | "md"
}
function Btn({ variant = "default", size = "md", className, children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-[13px]",
        variant === "primary" && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "ghost" && "border-transparent bg-transparent text-primary hover:bg-primary/10",
        variant === "default" && "border-border bg-card text-foreground hover:bg-muted/60",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ───────────────────────── componente principal ───────────────────────── */

export type ContadorHubPreviewProps = {
  /**
   * Competência canônica resolvida na page (searchParams.c → lib/contador/competencia).
   * Fonte da verdade da competência — sem useState espelhado.
   */
  competencia: Competencia
  /**
   * Dados reais da loja ativa na competência (GOAL 006). `null` quando o escopo não
   * resolve ou a leitura falha — nesse caso `realErro` traz a mensagem honesta.
   * `undefined` = página não forneceu (mantém apenas o preview).
   */
  realData?: ContadorDadosReais | null
  realErro?: string | null
  /**
   * Checklist de fechamento derivado do DTO do GOAL 006 (GOAL 007).
   * Montado na page em memória — nunca reconsulta readers.
   */
  checklistFechamento: ChecklistFechamento
  /**
   * Leitura fiscal read-only (GOAL 018). Sempre um DTO honesto: flag off / loja
   * fora da allowlist / falha → `disponivel: false` (nunca “zero notas”).
   */
  relatorioFiscal?: LeituraFiscalContador | null
  /**
   * Cadastro persistido da loja ativa (`Store`, GOAL 023). `null` quando o escopo
   * não resolve, a linha não existe ou a leitura falha — a aba Configurações
   * mostra isso como indisponível, nunca como empresa de exemplo.
   */
  identificacaoLoja?: IdentificacaoLoja | null
}

export function ContadorHubPreview({
  competencia,
  realData,
  realErro,
  checklistFechamento,
  relatorioFiscal,
  identificacaoLoja,
}: ContadorHubPreviewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Download real do Pacote do Contador (GOAL 008) — estado único p/ cabeçalho + seções.
  const pacoteDownload = usePacoteDownload(competencia)

  const [active, setActive] = useState<ContadorSectionId>("visao")
  const [modo, setModo] = useState(false)
  const [dossieFilter, setDossieFilter] = useState<DossieFilter>("all")

  const compName = labelCompetencia(competencia)
  const compCode = formatCompetenciaMmYyyy(competencia)
  const compShort = labelCompetenciaCurta(competencia)

  /**
   * Navega a competência via URL (?c=AAAA-MM), preservando demais query params.
   * router.replace + scroll:false evita empilhar histórico e não re-rola a página.
   * Sem estado local de competência → sem loop de sync URL↔state.
   */
  const navigateCompetencia = useCallback(
    (next: Competencia) => {
      const params = new URLSearchParams(searchParams.toString())
      const nextCode = formatCompetencia(next)
      if (params.get("c") === nextCode) return
      params.set("c", nextCode)
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const stepComp = (d: number) => {
    navigateCompetencia(d < 0 ? competenciaAnterior(competencia) : competenciaProxima(competencia))
  }

  const goSection = (id: ContadorSectionId) => {
    const sec = CONTADOR_SECTIONS.find((s) => s.id === id)
    if (modo && sec?.ownerOnly) return
    setActive(id)
  }

  const handleModo = (next: boolean) => {
    setModo(next)
    if (next) {
      const sec = CONTADOR_SECTIONS.find((s) => s.id === active)
      if (sec?.ownerOnly) setActive("visao")
    }
  }

  const visibleSections = CONTADOR_SECTIONS.filter((s) => !(modo && s.ownerOnly))

  /* ── seção: Visão geral ── */
  const renderVisao = () => (
    <>
      <SectionHeader
        title="Visão geral"
        desc={
          <>
            Resumo da competência de <b className="text-foreground">{compShort}</b>: o que falta, o que vence e o pacote do
            mês.
          </>
        }
      />

      {realErro ? <ContadorRealIndisponivel motivo={realErro} /> : null}
      {realData ? <VisaoGeralReal dados={realData} /> : null}
      {relatorioFiscal ? <RelatorioFiscalReal leitura={relatorioFiscal} compacto /> : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <Card>
          <CardHead title={<>Fechamento de {compShort}</>} right={<PreviewPill>somente leitura</PreviewPill>} />
          <div className="flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-[200px] flex-1">
              <div className="mb-1 font-semibold text-foreground">
                {checklistFechamento.contagem.total} sinais derivados desta competência
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Chip variant="res">{checklistFechamento.contagem.ok} ok</Chip>
                <Chip variant="warn">{checklistFechamento.contagem.atencao} atenção</Chip>
                <Chip variant="pend">{checklistFechamento.contagem.pendente} pendente</Chip>
                <Chip variant="env">{checklistFechamento.contagem.nao_disponivel} não disponível</Chip>
              </div>
              <div className="mt-2 text-[12.5px] text-muted-foreground">
                Sinais lidos da competência — não é percentual de conclusão nem fechamento
                oficial. O checklist completo está na aba <b className="text-foreground">Fechamento</b>.
              </div>
            </div>
            <Btn variant="ghost" size="sm" onClick={() => goSection("fechamento")}>
              Abrir checklist
            </Btn>
          </div>
        </Card>

        <Card>
          <CardHead title="Avisos" />
          <div className="p-4">
            <ContadorAvisosReal competencia={competencia} />
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHead
          title="Dossiês empresariais"
          right={
            <Btn size="sm" onClick={() => goSection("dossies")}>
              Abrir dossiês
            </Btn>
          }
        />
        <div className="p-4 text-[13px] text-muted-foreground">
          Roteiro dos documentos que banco, fornecedor e financiamento costumam pedir. O
          OmniGestão não consulta Receita, Junta, Sefaz, Prefeitura nem e-CAC — por isso o HUB
          não sabe se a sua certidão está válida, e não afirma que sabe. Os itens lidos do
          sistema mostram o valor real da competência ao abrir o dossiê.
        </div>
      </Card>

      <div className="mb-2.5 mt-5 font-mono text-[10.5px] font-semibold uppercase tracking-widest text-muted-foreground">
        Pacote do mês
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <ContadorPacoteDownload
          competencia={competencia}
          disponivel={!!realData}
          motivoIndisponivel={realErro}
          download={pacoteDownload}
        />
        <Card className="flex flex-col justify-center gap-2.5 p-4">
          <h3 className="text-base font-semibold text-foreground">O que é o Pacote do Contador</h3>
          <p className="text-[13px] text-muted-foreground">
            Um único ZIP por competência com a leitura real da loja: resumo, CSVs (vendas, devoluções,
            financeiro, caixa), checklist de fechamento, avisos e um manifesto com o hash de cada arquivo.
            Em vez de mandar arquivos soltos por e-mail e WhatsApp, você gera o pacote e o contador baixa de uma vez.
          </p>
          <p className="text-[12px] text-muted-foreground">
            Notas fiscais (XML) entram no pacote somente quando a leitura fiscal está ligada
            (CONTADOR_FISCAL_READER=on, loja na allowlist) e o predicado ADR-007 é cumprido;
            caso contrário o placeholder em 05-XML permanece honesto. Documentos anexos seguem
            no domínio de upload.
          </p>
        </Card>
      </div>
    </>
  )

  /* ── seção: Fechamento (GOAL 007 — checklist derivado, somente leitura) ── */
  /* ── seção: Fechamento (REAL — GOAL 012: snapshot, pacote versionado, reabertura) ── */
  const renderFechamento = () => (
    <>
      <ContadorFechamentoReal competencia={competencia} checklist={checklistFechamento} />
      <div className="mt-4">
        <ContadorFechamentoChecklist checklist={checklistFechamento} />
      </div>
    </>
  )

  /* ── seção: Documentos (GOAL 010 — REAL: upload/listagem/download/exclusão) ── */
  const renderDocumentos = () => <ContadorDocumentosReal competencia={competencia} />

  /* ── seção: Obrigações (GOAL 016 — REAL: obrigações, guias, templates) ── */
  const renderObrigacoes = () => <ContadorAgendaReal competencia={competencia} />

  /* ── seção: Relatórios ── */
  const renderRelatorios = () => (
    <>
      <SectionHeader
        title="Relatórios para o contador"
        desc="Relatórios básicos com dados reais da competência. A entrega dos arquivos é feita pelo Pacote do Contador — não há exportação individual nesta fase."
        actions={
          <Btn size="sm" onClick={() => goSection("dossies")}>
            Dossiês empresariais
          </Btn>
        }
      />

      {realErro ? <ContadorRealIndisponivel motivo={realErro} /> : null}
      {realData ? <RelatoriosReal dados={realData} /> : null}
      {relatorioFiscal ? <RelatorioFiscalReal leitura={relatorioFiscal} /> : null}

      <PreviewBanner
        title="Exportação individual por relatório — não existe nesta fase."
        text="Os cartões abaixo são um índice: cada um aponta o arquivo real equivalente dentro do Pacote do Contador (ZIP da competência). Não há botão de CSV/PDF por relatório porque não há endpoint que gere um arquivo isolado — quando houver, ele nasce reusando o mesmo gerador do pacote, sem CSV duplicado."
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <ContadorPacoteDownload
          competencia={competencia}
          disponivel={!!realData}
          motivoIndisponivel={realErro}
          download={pacoteDownload}
        />
        <div className="grid content-start gap-3">
          {RELATORIO_CARDS.map((r) => {
            const Icon = r.icon
            const noPacote = r.arquivosPacote.length > 0
            return (
              <Card key={r.title} className="flex items-start gap-3 p-4">
                <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", TINT_CLASS[r.tint])}>
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <b className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
                    {r.title}
                    {noPacote ? null : <PreviewPill>sem fonte</PreviewPill>}
                  </b>
                  <div className="text-xs text-muted-foreground">{r.sub}</div>
                  {noPacote ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">no pacote:</span>
                      {r.arquivosPacote.map((a) => (
                        <span
                          key={a}
                          className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-foreground/80"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1.5 text-[11.5px] text-muted-foreground">
                      Não entra no Pacote do Contador nesta fase — o DTO do HUB não lê Estoque.
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      </div>
    </>
  )

  /* ── seção: Dossiês (HÍBRIDA — itens `sistema` leem o DTO real da competência) ── */
  const renderDossies = () => (
    <>
      <SectionHeader
        title="Documentos empresariais"
        desc="Dossiês prontos para banco, crédito, fornecedor, financiamento, Pronampe e cadastro comercial — o que comprova o seu CNPJ, reunido num lugar só."
        actions={<HStatus />}
      />
      <PreviewBanner
        title="O HUB não consulta órgão nenhum — e por isso não afirma situação de documento."
        text="Receita, Junta Comercial, Sefaz, Prefeitura, Caixa e e-CAC ficam fora do OmniGestão: o sistema não sabe se a sua certidão está válida ou vencida. Os itens marcados «OmniGestão» mostram o valor REAL da competência selecionada; os demais indicam apenas onde obter o documento."
      />

      <Card className="mb-4 mt-4">
        <CardHead
          title={
            <span className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-500/10 text-sky-500">
                <Eye className="h-4.5 w-4.5" />
              </span>
              <span>
                <span className="block text-[15px] font-semibold text-foreground">O que acompanhar no CNPJ</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  Roteiro de regularidade · consulta feita por você ou pelo contador, fora do OmniGestão
                </span>
              </span>
            </span>
          }
          right={<PreviewPill>não verificado</PreviewPill>}
        />
        <div className="grid gap-x-6 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
          {RADAR_CNPJ.map((r) => (
            <div key={r.label} className="flex items-center gap-2.5 border-b border-border/50 py-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground/40" />
              <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground">{r.label}</span>
              <span className="whitespace-nowrap font-mono text-[10.5px] text-muted-foreground">{r.onde}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {DOSSIE_FILTERS.map((f) => {
          const activeF = dossieFilter === f.id
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setDossieFilter(f.id)}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                activeF
                  ? "border-primary/25 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {f.label}
              <span
                className={cn(
                  "rounded font-mono text-[10px]",
                  "min-w-[18px] px-1.5 text-center",
                  activeF ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {dossieFilterCount(f.id)}
              </span>
            </button>
          )
        })}
      </div>

      <div className="grid gap-4">
        {DOSSIES.map((dossie) => {
          const rows = dossie.rows.filter((r) => dossieRowMatches(r, dossieFilter))
          if (rows.length === 0) return null
          const Icon = dossie.icon
          return (
            <Card key={dossie.id} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", TINT_CLASS[dossie.tint])}>
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold text-foreground">{dossie.title}</h3>
                    <span className="text-xs text-muted-foreground">{dossie.sub}</span>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-[13px]">
                  <thead>
                    <Thead cols={["Documento", "Origem", "No OmniGestão", "Como obter"]} lastRight />
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className="border-b border-border/60 last:border-b-0 hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <FileText className="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <span className="flex flex-wrap items-center gap-1.5 font-semibold text-foreground">
                                {row.doc}
                                {row.validar ? <ValidarBadge /> : null}
                              </span>
                              <span className="text-[11.5px] text-muted-foreground">{row.sub}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <OrigemChip origem={row.origem} />
                        </td>
                        <td className="px-4 py-3">
                          <LeituraDossie row={row} dados={realData ?? null} motivo={realErro ?? null} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.origem === "anexar" ? (
                            <Btn size="sm" onClick={() => goSection("documentos")}>
                              Enviar em Documentos
                            </Btn>
                          ) : (
                            <span className="text-[11.5px] text-muted-foreground">{ORIGEM_COMO_OBTER[row.origem]}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        })}
      </div>
    </>
  )

  /* ── seção: Folha & DP (REAL — GOAL 023: documentos de categoria FOLHA) ── */
  const renderFolha = () => (
    <ContadorFolhaReal competencia={competencia} onIrParaDocumentos={() => goSection("documentos")} />
  )

  /* ── seção: Portal do contador (resumo REAL do acesso externo — GOAL 023) ── */
  const renderPortal = () => (
    <>
      <SectionHeader
        title="Portal do contador"
        desc={
          <>
            A porta de acesso externo do seu contador. O vínculo é por loja e por papel — quem
            gerencia convites e acessos faz isso em{" "}
            <b className="text-foreground">Permissões &amp; acesso</b>.
          </>
        }
      />
      <ContadorPortalResumo onGerenciar={modo ? null : () => goSection("permissoes")} />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title="O contador pode" />
          <ul className="grid list-disc gap-2.5 py-4 pl-9 pr-4 text-[13.5px] text-foreground/90">
            {PORTAL_PODE.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHead title="O contador não pode" />
          <ul className="grid list-disc gap-2.5 py-4 pl-9 pr-4 text-[13.5px] text-foreground/90">
            {PORTAL_NAO_PODE.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )

  /* ── seção: Permissões (REAL — GOAL 014) ── */
  const renderPermissoes = () => <ContadorPermissoesReal />

  /* ── seção: Timeline (REAL — GOAL 011) ── */
  const renderTimeline = () => <ContadorTimelineReal competencia={competencia} />


  /* ── seção: Configurações (cadastro REAL da loja + o que ainda não tem persistência) ── */
  const renderConfig = () => (
    <>
      <SectionHeader
        title="Configurações"
        desc="Cadastro da loja ativa lido do servidor e o que o HUB ainda não guarda."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-1 text-[15px] font-semibold text-foreground">Dados da empresa</h3>
          <p className="mb-3.5 text-[12.5px] text-muted-foreground">
            Cadastro persistido da loja ativa (somente leitura aqui). Para alterar, use as
            Configurações do sistema.
          </p>
          {identificacaoLoja ? (
            <>
              <Field
                label="Razão social / nome da loja"
                value={identificacaoLoja.nome || "— não preenchido no cadastro da loja —"}
                readOnly
              />
              <Field
                label="CNPJ"
                value={identificacaoLoja.cnpj || "— não preenchido no cadastro da loja —"}
                readOnly
                mono
              />
              <Kv label="Identificador da loja" value={identificacaoLoja.id} muted last />
            </>
          ) : (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <b className="text-amber-600 dark:text-amber-400">Cadastro da loja indisponível.</b>{" "}
                {realErro ??
                  "Não foi possível ler o cadastro da loja ativa agora. Nenhum dado de exemplo é exibido no lugar."}
              </div>
            </div>
          )}
        </Card>
        <Card className="p-4">
          <h3 className="mb-1 text-[15px] font-semibold text-foreground">Ainda não configurável aqui</h3>
          <p className="mb-3.5 text-[12.5px] text-muted-foreground">
            Estes ajustes não têm onde ser gravados: o HUB não tem tabela de preferências. Os
            controles ficam fora da tela até existir persistência — botão de salvar que não salva é
            promessa falsa.
          </p>
          <Kv label="Regime tributário" value="planejado" muted />
          <Kv label="Competência padrão ao abrir" value="planejado" muted />
          <Kv label="Avisar vencimentos" value="planejado" muted />
          <Kv label="Lembrar de fechar o mês" value="planejado" muted last />
          <div className="mt-3.5 flex items-start gap-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Enquanto isso, a competência é sempre a da URL (<span className="font-mono">?c=AAAA-MM</span>),
            os vencimentos vivem em Obrigações e o lembrete de fechamento aparece nos Avisos da Visão
            geral — todos com dado real.
          </div>
        </Card>
      </div>
    </>
  )

  const SECTION_RENDERERS: Record<ContadorSectionId, () => React.ReactNode> = {
    visao: renderVisao,
    fechamento: renderFechamento,
    documentos: renderDocumentos,
    obrigacoes: renderObrigacoes,
    relatorios: renderRelatorios,
    dossies: renderDossies,
    folha: renderFolha,
    portal: renderPortal,
    permissoes: renderPermissoes,
    timeline: renderTimeline,
    config: renderConfig,
  }

  return (
    <div className="flex min-w-0 flex-col">
      {/* breadcrumb discreto */}
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5 text-[12.5px] sm:px-6">
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <span>OmniGestão</span>
          <span className="text-muted-foreground/50">/</span>
          {identificacaoLoja?.nome ? (
            <>
              <span className="truncate">{identificacaoLoja.nome}</span>
              <span className="text-muted-foreground/50">/</span>
            </>
          ) : null}
          <span className="font-semibold text-foreground">Contador HUB</span>
        </div>
        <span className="ml-auto hidden items-center gap-2 font-mono text-[11px] text-muted-foreground sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" />
          experiência híbrida · leitura real + preview
        </span>
      </div>

      {/* HUB header + competência */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4 border-b border-border bg-card px-4 py-4 sm:px-6">
        <div className="flex min-w-[220px] flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Módulo OmniGestão · comunicação com o contador
          </span>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[23px] font-bold tracking-tight text-foreground">Contador HUB</h1>
            <HybridStatus />
          </div>
          <span className="text-[12.5px] text-muted-foreground">
            Organize documentos, pendências e o fechamento do mês com seu contador.
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3.5">
          <div className="flex items-center rounded-full border border-border bg-card p-1">
            <button
              type="button"
              onClick={() => stepComp(-1)}
              aria-label="Competência anterior"
              className="grid h-[30px] w-[30px] place-items-center rounded-full text-foreground/70 hover:bg-primary/10 hover:text-primary"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex min-w-[120px] flex-col items-center px-3 leading-tight">
              <small className="text-[9.5px] uppercase tracking-widest text-muted-foreground">Competência</small>
              <span className="text-sm font-semibold text-foreground">{compName}</span>
            </div>
            <button
              type="button"
              onClick={() => stepComp(1)}
              aria-label="Próxima competência"
              className="grid h-[30px] w-[30px] place-items-center rounded-full text-foreground/70 hover:bg-primary/10 hover:text-primary"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="pr-1">
              <span className="rounded-md border border-border bg-muted/60 px-2 py-1 font-mono text-[11px] text-foreground/80">
                {compCode}
              </span>
            </span>
          </div>

          <label
            className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-foreground/80"
            title="Pré-visualiza o que o contador vê (somente leitura)"
          >
            <span>Modo contador</span>
            <Switch checked={modo} onCheckedChange={handleModo} aria-label="Modo contador" />
          </label>

          <Btn
            variant="primary"
            disabled={!realData}
            title={realData ? undefined : (realErro ?? PACOTE_INDISPONIVEL_TITLE)}
            onClick={pacoteDownload.iniciar}
          >
            <Download className="h-4 w-4" />
            Baixar pacote
          </Btn>
        </div>
      </div>

      {/* corpo: nav interna + conteúdo */}
      <div className="flex flex-col lg:flex-row">
        <nav
          aria-label="Seções do Contador HUB"
          className="flex gap-1 overflow-x-auto border-b border-border bg-card p-3 lg:w-56 lg:shrink-0 lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r"
        >
          {visibleSections.map((s, i) => {
            const Icon = s.icon
            const isActive = active === s.id
            const showGroup = s.group && (i === 0 || visibleSections[i - 1].group !== s.group)
            return (
              <div key={s.id} className="contents lg:block">
                {showGroup ? (
                  <div className="hidden px-3 pb-1.5 pt-3.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground lg:block">
                    {s.group}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => goSection(s.id)}
                  className={cn(
                    "relative flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-[13.5px] font-medium transition-colors lg:w-full",
                    isActive
                      ? "bg-primary/10 font-semibold text-primary shadow-[inset_2px_0_0_var(--primary)]"
                      : "text-foreground/80 hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className={cn("h-[17px] w-[17px] shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                  {s.label}
                  {s.badge ? (
                    <span className="ml-auto hidden rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-primary lg:inline">
                      {s.badge}
                    </span>
                  ) : null}
                  {/* GOAL 023: a nav não exibe contador numérico. O único badge é
                      textual (maturidade da seção) — número sem leitura real é mock. */}
                </button>
              </div>
            )
          })}
        </nav>

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          {modo ? <ContadorModeBanner /> : null}
          <div key={active} className="animate-in fade-in-50 duration-200">
            {SECTION_RENDERERS[active]()}
          </div>
        </main>
      </div>

    </div>
  )
}

/* ───────────────────────── subcomponentes auxiliares ───────────────────────── */

function HStatus() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide text-primary">
      <span className="h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-primary/20" />
      Preview
    </span>
  )
}

function HybridStatus() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide text-primary">
      <span className="h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-primary/20" />
      Híbrido
    </span>
  )
}

function PreviewBanner({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5">
      <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div>
        <b className="text-amber-600 dark:text-amber-400">{title}</b>
        <p className="mt-0.5 text-[12.5px] text-foreground/80">{text}</p>
      </div>
    </div>
  )
}

function ContadorModeBanner() {
  return (
    <div className="relative mb-4 flex flex-wrap items-center gap-3.5 overflow-hidden rounded-lg border border-primary/20 bg-primary/5 p-3.5">
      <span className="absolute inset-y-0 left-0 w-1 bg-primary" />
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Eye className="h-5 w-5" />
      </span>
      <div className="min-w-[210px] flex-1">
        <b className="block text-sm font-bold text-foreground">Modo contador — as abas restritas ao lojista estão ocultas</b>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
          É um recorte desta tela, não o portal externo: o contador acessa outro endereço, com outra
          sessão e outro layout. No portal ele baixa pacote e documentos, comenta e — no papel
          Conferência — marca documento como conferido; nunca envia arquivo nem edita dados.
        </div>
      </div>
      <span className="whitespace-nowrap rounded-full border border-primary/30 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-primary">
        Somente leitura
      </span>
    </div>
  )
}

function Thead({ cols, lastRight, rightCols }: { cols: string[]; lastRight?: boolean; rightCols?: number[] }) {
  return (
    <tr>
      {cols.map((c, i) => {
        const right = rightCols ? rightCols.includes(i + 1) : lastRight && i === cols.length - 1
        return (
          <th
            key={c}
            className={cn(
              "whitespace-nowrap border-b border-border/60 bg-muted/40 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
              right ? "text-right" : "text-left",
            )}
          >
            {c}
          </th>
        )
      })}
    </tr>
  )
}

function Kv({ label, value, muted, last }: { label: string; value: string; muted?: boolean; last?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3 py-2.5 text-[13px]", !last && "border-b border-border/60")}>
      <span className="text-muted-foreground">{label}</span>
      <b className={cn("font-semibold", muted ? "font-mono font-medium text-muted-foreground" : "text-foreground")}>{value}</b>
    </div>
  )
}

function Field({ label, value, readOnly, mono }: { label: string; value: string; readOnly?: boolean; mono?: boolean }) {
  return (
    <div className="mb-4 flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-foreground/80">{label}</label>
      <input
        value={value}
        readOnly={readOnly}
        className={cn(
          "w-full rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[13px] outline-none focus:border-primary focus:bg-card",
          readOnly ? "text-muted-foreground" : "text-foreground",
          mono && "font-mono",
        )}
      />
    </div>
  )
}

/**
 * Como obter o item quando a origem NÃO é o OmniGestão. É instrução, não ação: o HUB
 * não abre portal de órgão nem despacha pedido ao contador, então não existe botão
 * prometendo isso. `anexar` é a exceção — tem contrato real (aba Documentos) e por
 * isso ganha CTA de verdade no lugar deste texto.
 */
const ORIGEM_COMO_OBTER: Record<DossieOrigem, string> = {
  sistema: "leitura da competência",
  anexar: "envie o arquivo em Documentos",
  portal: "baixe no portal oficial do órgão",
  solicitar: "peça ao seu contador",
}

/**
 * Coluna «No OmniGestão» dos dossiês. Só um item de origem `sistema` COM `metrica`
 * mapeada tem valor real; qualquer outro estado é dito por extenso, nunca preenchido
 * com "OK", vencimento, arquivo ou status inventado.
 */
function LeituraDossie({
  row,
  dados,
  motivo,
}: {
  row: DossieRow
  dados: ContadorDadosReais | null
  motivo: string | null
}) {
  if (row.origem !== "sistema") {
    return <span className="text-[11.5px] text-muted-foreground">não rastreado pelo sistema</span>
  }
  if (!row.metrica) {
    return (
      <span className="text-[11.5px] text-muted-foreground">
        sem fonte no OmniGestão nesta fase
      </span>
    )
  }
  if (!dados) {
    return (
      <span className="text-[11.5px] text-muted-foreground" title={motivo ?? undefined}>
        leitura indisponível
      </span>
    )
  }
  const leitura = lerMetricaSistema(dados, row.metrica)
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[12px] font-semibold text-foreground">{leitura.texto}</span>
      <Chip variant={DISP_CHIP[leitura.disponibilidade]}>{DISP_ROTULO[leitura.disponibilidade]}</Chip>
    </span>
  )
}

const DISP_CHIP: Record<DisponibilidadeDado, ChipVariant> = {
  real: "res",
  parcial: "warn",
  indisponivel: "pend",
}
const DISP_ROTULO: Record<DisponibilidadeDado, string> = {
  real: "real",
  parcial: "parcial",
  indisponivel: "não disponível",
}

const BRL_DOSSIE = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

/**
 * Traduz uma `MetricaSistema` no par (texto, disponibilidade) do DTO real da
 * competência (GOAL 006). Nenhum ramo fabrica valor: `valor === null` sai como "—"
 * com a disponibilidade que o próprio DTO declarou.
 */
function lerMetricaSistema(
  dados: ContadorDadosReais,
  metrica: MetricaSistema,
): { texto: string; disponibilidade: DisponibilidadeDado } {
  const money = (d: { valor: number | null; disponibilidade: DisponibilidadeDado }) => ({
    texto: d.valor === null ? "—" : BRL_DOSSIE.format(d.valor),
    disponibilidade: d.disponibilidade,
  })
  switch (metrica) {
    case "fluxo": {
      const { entradasRealizadas: e, saidasRealizadas: sa } = dados.financeiro
      const pior: DisponibilidadeDado =
        e.disponibilidade === "indisponivel" || sa.disponibilidade === "indisponivel"
          ? "indisponivel"
          : e.disponibilidade === "parcial" || sa.disponibilidade === "parcial"
            ? "parcial"
            : "real"
      if (e.valor === null || sa.valor === null) return { texto: "—", disponibilidade: pior }
      return {
        texto: `+${BRL_DOSSIE.format(e.valor)} / -${BRL_DOSSIE.format(sa.valor)}`,
        disponibilidade: pior,
      }
    }
    case "contas_pagar":
      return money(dados.financeiro.titulosPagarAberto)
    case "contas_receber":
      return money(dados.financeiro.titulosReceberAberto)
    case "formas_pagamento": {
      const n = dados.vendas.formasPagamento.length
      return {
        texto: n === 0 ? "—" : `${n} forma(s)`,
        disponibilidade: dados.vendas.formaPagamentoDisponibilidade,
      }
    }
  }
}
