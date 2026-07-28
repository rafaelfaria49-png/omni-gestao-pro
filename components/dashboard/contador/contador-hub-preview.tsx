"use client"

/**
 * Contador HUB (interno) · casca visual — GOAL CONTADOR-HUB-VISUAL-PREVIEW-ONLY-001.
 *
 * Rota: /dashboard/contador (NÃO confundir com o portal externo antigo /contador,
 * que permanece intacto). Esta é a primeira versão VISUAL para lojista/equipe,
 * baseada no design aprovado do Cloud Design e adaptada aos tokens do OmniGestão
 * Pro (o design usava indigo; aqui o acento é o `primary` da marca).
 *
 * ⚠️ Fase preview: NADA aqui persiste. Sem backend, API, upload, download, emissão
 * fiscal ou motor de imposto. Todos os dados são estáticos (contador-preview-data.ts)
 * e todos os botões sem efeito real disparam um toast honesto. O AppShell continua
 * dono único do scroll — este componente flui, não cria scroll de página.
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
  Plus,
  Sparkles,
  Upload,
  X,
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
import type { ContadorDadosReais } from "@/lib/contador/readers/tipos"
import {
  VisaoGeralReal,
  RelatoriosReal,
  ContadorRealIndisponivel,
} from "./contador-dados-reais"
import {
  ContadorFechamentoChecklist,
  FECHAR_COMPETENCIA_TITLE,
} from "./contador-fechamento-checklist"
import {
  ContadorPacoteDownload,
  PACOTE_INDISPONIVEL_TITLE,
  usePacoteDownload,
} from "./contador-pacote-download"
import { ContadorDocumentosReal } from "./documentos/contador-documentos-real"
import { ContadorTimelineReal } from "./timeline/contador-timeline-real"
import {
  CONTADOR_SECTIONS,
  DOSSIES,
  DOSSIE_FILTERS,
  FOLHA_FUNCIONARIOS,
  OBRIGACOES_ROWS,
  PERMISSOES_ROWS,
  PORTAL_NAO_PODE,
  PORTAL_PODE,
  RADAR_CNPJ,
  RELATORIO_CARDS,
  RESUMO_FINANCEIRO,
  VISAO_ALERTAS,
  VISAO_DOSSIE_PROGRESS,
  VISAO_KPIS,
  dossieFilterCount,
  dossieRowMatches,
  type ChipVariant,
  type ContadorSectionId,
  type DossieFilter,
  type DossieOrigem,
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

/**
 * GOAL CONTADOR-HUB-HONESTY-ROUTE-SAFETY-002 — texto único reaproveitado em todo
 * CTA sem efeito real, para manter a mensagem consistente e fácil de auditar.
 */
const CTA_INDISPONIVEL_TITLE = "Disponível na fase de dados reais — pré-visualização, sem efeito real."

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
}

export function ContadorHubPreview({
  competencia,
  realData,
  realErro,
  checklistFechamento,
}: ContadorHubPreviewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Download real do Pacote do Contador (GOAL 008) — estado único p/ cabeçalho + seções.
  const pacoteDownload = usePacoteDownload(competencia)

  const [active, setActive] = useState<ContadorSectionId>("visao")
  const [modo, setModo] = useState(false)
  const [dossieFilter, setDossieFilter] = useState<DossieFilter>("all")
  const [toast, setToast] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<{ kind: "doc" | "guia"; title: string } | null>(null)

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

  let toastTimer: ReturnType<typeof setTimeout> | undefined
  const noop = (action: string) => {
    setToast(`«${action}» — pré-visualização, sem efeito real nesta fase.`)
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => setToast(null), 2800)
  }

  const openDrawer = (kind: "doc" | "guia", title: string) => setDrawer({ kind, title })
  const closeDrawer = () => setDrawer(null)

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

      {realData ? (
        <PreviewBanner
          title="Cartões abaixo — dados ilustrativos."
          text="O bloco “Resumo da competência” acima é leitura real da loja. Os cartões de pendências, progresso do fechamento e dossiês a seguir ainda são fixos e exemplificam o layout. O Pacote do Contador ao final gera um ZIP real da competência."
        />
      ) : (
        <PreviewBanner
          title="Preview — dados ilustrativos."
          text="Pendências, KPIs, progresso do fechamento e alertas desta visão geral são fixos e exemplificam o layout. Nenhum valor aqui reflete seu Financeiro, Fiscal ou Caixa reais."
        />
      )}

      <div className="mb-4 mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {VISAO_KPIS.map((k) => {
          const Icon = k.icon
          return (
            <Card key={k.label} className="flex flex-col gap-2 p-4">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Icon className="h-4 w-4 text-primary" />
                {k.label}
              </span>
              <span className="text-2xl font-bold leading-none tracking-tight text-foreground">
                {k.value}
                {k.unit ? <small className="ml-1 text-[13px] font-medium text-muted-foreground">{k.unit}</small> : null}
              </span>
              <span className="text-[11.5px] text-muted-foreground">{k.foot}</span>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <div className="grid gap-4">
          <Card>
            <CardHead title={<>Fechamento de {compShort}</>} right={<PreviewPill>Preview ilustrativo</PreviewPill>} />
            <div className="flex flex-wrap items-center gap-4 p-4">
              <ProgressRing pct={35} />
              <div className="min-w-[160px] flex-1">
                <div className="mb-0.5 font-semibold text-foreground">3 de 9 itens concluídos</div>
                <div className="text-[12.5px] text-muted-foreground">
                  Números ilustrativos de preview — não é o fechamento real. O checklist derivado
                  (somente leitura) está na aba <b className="text-foreground">Fechamento</b>.
                </div>
              </div>
              <Btn variant="ghost" size="sm" onClick={() => goSection("fechamento")}>
                Abrir checklist
              </Btn>
            </div>
          </Card>

          <Card>
            <CardHead title="Resumo financeiro" right={<PreviewPill>Gerencial</PreviewPill>} />
            <div className="p-4">
              <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
                {RESUMO_FINANCEIRO.map((f) => (
                  <div key={f.label} className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">{f.label}</span>
                    <span className="font-mono text-xl font-semibold tracking-tight text-foreground">{f.value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <b className="text-amber-600 dark:text-amber-400">Valores gerenciais — não substituem a contabilidade oficial.</b>{" "}
                  Lidos do módulo Financeiro para acompanhamento interno. A apuração e os demonstrativos contábeis oficiais são
                  responsabilidade do seu contador.
                </div>
              </div>
            </div>
          </Card>
        </div>

        <Card>
          <CardHead title="Alertas" right={<span className="text-xs text-muted-foreground">preview</span>} />
          <div className="grid gap-2.5 p-4">
            {VISAO_ALERTAS.map((a) => {
              const Icon = a.icon
              const tone =
                a.tone === "danger"
                  ? { border: "border-rose-500/30", text: "text-rose-500" }
                  : a.tone === "warn"
                    ? { border: "border-amber-500/30", text: "text-amber-600 dark:text-amber-400" }
                    : { border: "border-sky-500/30", text: "text-sky-500" }
              return (
                <div key={a.title} className={cn("flex items-start gap-3 rounded-lg border bg-card p-3", tone.border)}>
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone.text)} />
                  <div className="min-w-0 flex-1">
                    <span className={cn("block font-mono text-[9px] font-semibold uppercase tracking-wider", tone.text)}>
                      {a.cat}
                    </span>
                    <div className="text-[13px] font-semibold text-foreground">{a.title}</div>
                    <div className="text-xs text-muted-foreground">{a.desc}</div>
                  </div>
                  {a.when ? <span className="font-mono text-[11px] text-muted-foreground">{a.when}</span> : null}
                </div>
              )
            })}
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
        <div className="p-4">
          <div className="grid gap-3.5">
            {VISAO_DOSSIE_PROGRESS.map((d) => (
              <div key={d.label}>
                <div className="mb-1.5 flex justify-between gap-2.5 text-[13px]">
                  <b className="font-semibold text-foreground">{d.label}</b>
                  <span className="font-mono text-muted-foreground">
                    {d.done} de {d.total} prontos
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${d.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3.5 flex items-center gap-2 text-[11.5px] text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            Prontos = documentos gerenciais atualizados. Documentos oficiais e fiscais dependem de portal e do contador.
          </div>
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
            Notas fiscais (XML) e documentos anexos entram numa fase futura — por ora seguem como
            placeholders honestos dentro do pacote.
          </p>
        </Card>
      </div>
    </>
  )

  /* ── seção: Fechamento (GOAL 007 — checklist derivado, somente leitura) ── */
  const renderFechamento = () => (
    <>
      <SectionHeader
        title="Fechamento mensal"
        desc={
          <>
            Sinais reais da competência de <b className="text-foreground">{compShort}</b>, derivados
            do DTO já carregado.{" "}
            <span className="text-amber-600 dark:text-amber-400">
              Não é fechamento oficial — sem snapshot e sem trava.
            </span>
          </>
        }
        actions={
          <Btn disabled title={FECHAR_COMPETENCIA_TITLE} onClick={() => noop("Fechar competência")}>
            Fechar competência · GOAL 012
          </Btn>
        }
      />
      <PreviewBanner
        title="Checklist derivado — o fechamento não é executado pelo sistema."
        text="Cada item reflete um sinal real da competência (ou a ausência honesta de evidência). O botão «Fechar competência» permanece desabilitado: o fechamento real com snapshot será o GOAL 012."
      />
      <div className="mt-4">
        <ContadorFechamentoChecklist checklist={checklistFechamento} />
      </div>
    </>
  )

  /* ── seção: Documentos (GOAL 010 — REAL: upload/listagem/download/exclusão) ── */
  const renderDocumentos = () => <ContadorDocumentosReal competencia={competencia} />

  /* ── seção: Obrigações ── */
  const renderObrigacoes = () => (
    <>
      <SectionHeader title="Obrigações & vencimentos" desc="Acompanhamento de guias e prazos da competência." />
      <PreviewBanner
        title="Preview — validar com contador."
        text="O Contador HUB não calcula nem emite guias. Valores, prazos e a apuração são definidos pelo seu contador. Aqui você apenas acompanha e anexa comprovantes."
      />
      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <Thead cols={["Obrigação", "Competência", "Vencimento", "Valor", "Status", "Ações"]} rightCols={[4, 6]} />
            </thead>
            <tbody>
              {OBRIGACOES_ROWS.map((o, i) => (
                <tr key={i} className="border-b border-border/60 last:border-b-0 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap items-center gap-1.5 font-semibold text-foreground">
                      {o.name}
                      {o.preview ? <PreviewPill /> : null}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{o.comp}</td>
                  <td className="px-4 py-3 font-mono text-xs">{o.venc}</td>
                  <td className="px-4 py-3 text-right">
                    {o.valor ? (
                      <span className="font-mono font-medium text-foreground">{o.valor}</span>
                    ) : (
                      <span className="font-mono font-medium text-muted-foreground">— validar —</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Chip variant={o.status.variant}>{o.status.label}</Chip>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {o.kind === "guia" ? (
                      <Btn size="sm" onClick={() => openDrawer("guia", o.name)}>
                        Ver exemplo
                      </Btn>
                    ) : (
                      <Btn size="sm" disabled title={CTA_INDISPONIVEL_TITLE} onClick={() => noop("Anexar comprovante")}>
                        Anexar
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )

  /* ── seção: Relatórios ── */
  const renderRelatorios = () => (
    <>
      <SectionHeader
        title="Relatórios para o contador"
        desc="Relatórios básicos com dados reais da competência. Exportação e pacote seguem em preview."
        actions={
          <Btn size="sm" onClick={() => goSection("dossies")}>
            Dossiês empresariais
          </Btn>
        }
      />

      {realErro ? <ContadorRealIndisponivel motivo={realErro} /> : null}
      {realData ? <RelatoriosReal dados={realData} /> : null}

      {realData ? (
        <PreviewBanner
          title="Exportações por relatório — em preview."
          text="Os relatórios básicos acima são leitura real da loja. A exportação individual (CSV/PDF) dos cartões abaixo ainda não gera arquivo nesta fase. Já o Pacote do Contador ao lado gera um ZIP real da competência."
        />
      ) : null}

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
            return (
              <Card key={r.title} className="flex items-center gap-3 p-4">
                <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", TINT_CLASS[r.tint])}>
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <b className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
                    {r.title}
                    {r.preview ? <PreviewPill /> : null}
                  </b>
                  <div className="text-xs text-muted-foreground">{r.sub}</div>
                </div>
                {r.formats.map((f) => (
                  <Btn
                    key={f}
                    size="sm"
                    disabled
                    title={CTA_INDISPONIVEL_TITLE}
                    onClick={() => noop(`Exportar ${r.title} (${f})`)}
                  >
                    {f}
                  </Btn>
                ))}
              </Card>
            )
          })}
        </div>
      </div>
    </>
  )

  /* ── seção: Dossiês ── */
  const renderDossies = () => {
    const radarDot: Record<string, string> = {
      ok: "bg-emerald-500",
      warn: "bg-amber-500",
      venc: "bg-rose-500",
    }
    const radarText: Record<string, string> = {
      ok: "text-emerald-600 dark:text-emerald-400",
      warn: "text-amber-600 dark:text-amber-400",
      venc: "text-rose-500",
    }
    return (
      <>
        <SectionHeader
          title="Documentos empresariais"
          desc="Dossiês prontos para banco, crédito, fornecedor, financiamento, Pronampe e cadastro comercial — o que comprova o seu CNPJ, reunido num lugar só."
          actions={<HStatus />}
        />
        <PreviewBanner
          title="O sistema não emite certidões oficiais nem gera DAS real sem integração."
          text="Os relatórios do OmniGestão são gerenciais. Documentos oficiais — cartão CNPJ, contrato social, certidões, alvará, inscrições — você anexa manualmente ou abre o portal oficial. Todo documento fiscal/contábil traz o selo validar com contador."
        />

        <Card className="mb-4 mt-4">
          <CardHead
            title={
              <span className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-500/10 text-sky-500">
                  <Eye className="h-4.5 w-4.5" />
                </span>
                <span>
                  <span className="block text-[15px] font-semibold text-foreground">Radar CNPJ</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    Situação do CNPJ num relance · indicativo, validar com contador
                  </span>
                </span>
              </span>
            }
            right={<PreviewPill>indicativo</PreviewPill>}
          />
          <div className="grid gap-x-6 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
            {RADAR_CNPJ.map((r) => (
              <div key={r.label} className="flex items-center gap-2.5 border-b border-border/50 py-2">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", radarDot[r.state])} />
                <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground">{r.label}</span>
                <span className={cn("font-mono text-[10.5px] font-semibold", radarText[r.state])}>{r.status}</span>
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
                  <div className="flex flex-wrap gap-2">
                    <Btn size="sm" disabled title={CTA_INDISPONIVEL_TITLE} onClick={() => noop("Montar dossiê")}>
                      Montar dossiê · preview
                    </Btn>
                    <Btn size="sm" disabled title={CTA_INDISPONIVEL_TITLE} onClick={() => noop("Baixar pacote do dossiê")}>
                      Baixar pacote
                    </Btn>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-[13px]">
                    <thead>
                      <Thead cols={["Documento", "Origem", "Status", "Ação"]} lastRight />
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i} className="border-b border-border/60 last:border-b-0 hover:bg-muted/40">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <FileText className="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
                              <div>
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
                            <Chip variant={row.status === "atualizado" ? "res" : row.status === "vencido" ? "venc" : "pend"}>
                              {row.status}
                            </Chip>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Btn
                              size="sm"
                              disabled
                              title={CTA_INDISPONIVEL_TITLE}
                              onClick={() => noop(ORIGEM_ACAO[row.origem])}
                            >
                              {ORIGEM_ACAO_LABEL[row.origem]}
                            </Btn>
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
  }

  /* ── seção: Folha & DP ── */
  const renderFolha = () => (
    <>
      <SectionHeader
        title="Folha & DP"
        desc="Funcionários e folha — registro e organização para o contador. Vira um HUB próprio (“Pessoas”) no futuro."
      />
      <PreviewBanner
        title="Preview — validar com contador."
        text="Esta área não calcula folha, holerite, encargos nem envia eSocial / FGTS. Serve para registrar funcionários, anexar documentos e organizar o que o contador precisa."
      />
      <Card className="mt-4 mb-4 overflow-hidden">
        <CardHead
          title="Funcionários"
          right={
            <Btn size="sm" disabled title={CTA_INDISPONIVEL_TITLE} onClick={() => noop("Adicionar funcionário")}>
              Adicionar
            </Btn>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <Thead cols={["Funcionário", "Cargo", "Admissão", "Documentos", "Holerite"]} lastRight />
            </thead>
            <tbody>
              {FOLHA_FUNCIONARIOS.map((f) => (
                <tr key={f.nome} className="border-b border-border/60 last:border-b-0 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[13px] font-bold text-primary">
                        {f.iniciais}
                      </span>
                      <b className="font-semibold text-foreground">{f.nome}</b>
                    </div>
                  </td>
                  <td className="px-4 py-3">{f.cargo}</td>
                  <td className="px-4 py-3 font-mono text-xs">{f.admissao}</td>
                  <td className="px-4 py-3">
                    <Chip variant={f.docs.variant}>{f.docs.label}</Chip>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Btn size="sm" disabled title={CTA_INDISPONIVEL_TITLE} onClick={() => noop("Ver holerite")}>
                      Ver · preview
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-1 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-foreground">
            Pró-labore <PreviewPill />
          </h3>
          <div className="mb-3 text-[12.5px] text-muted-foreground">Registro do valor — sem cálculo de INSS/IRRF.</div>
          <Kv label="Sócio" value="Rafael (titular)" />
          <Kv label="Valor" value="— validar com contador —" muted />
        </Card>
        <Card className="p-4">
          <h3 className="mb-1 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-foreground">
            Holerite <PreviewPill />
          </h3>
          <div className="mb-3 text-[12.5px] text-muted-foreground">Demonstrativo ilustrativo — não calculado pelo sistema.</div>
          <Kv label="Salário base" value="—" muted />
          <Kv label="Descontos" value="—" muted />
          <Kv label="Líquido" value="— validar —" muted last />
        </Card>
      </div>
    </>
  )

  /* ── seção: Portal do contador ── */
  const renderPortal = () => (
    <>
      <SectionHeader
        title="Portal do contador"
        desc={
          <>
            A porta de acesso externo. Ative <b className="text-foreground">Modo contador</b> no topo para pré-visualizar
            exatamente o que o contador enxerga.
          </>
        }
        actions={
          <Btn variant="primary" onClick={() => handleModo(!modo)}>
            <Eye className="h-4 w-4" />
            Pré-visualizar como contador
          </Btn>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
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
      <Card className="mt-4 flex flex-wrap items-center gap-3.5 p-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-500/10 text-[13px] font-bold text-sky-500">
          EC
        </span>
        <div className="min-w-[180px] flex-1">
          <b className="text-sm text-foreground">Escritório Contábil Exemplo</b>
          <div className="text-[12.5px] text-muted-foreground">
            <span className="font-mono">contato@escritorio.com.br</span> · acesso somente leitura
          </div>
        </div>
        <Chip variant="res">ativo</Chip>
      </Card>
    </>
  )

  /* ── seção: Permissões ── */
  const renderPermissoes = () => (
    <>
      <SectionHeader
        title="Permissões & acesso"
        desc="Convide o contador e defina o que ele enxerga. Tudo é somente leitura para ele."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 text-[15px] font-semibold text-foreground">Convidar contador</h3>
          <div className="mb-4 flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground/80">E-mail do contador</label>
            <input
              type="email"
              placeholder="contato@escritorio.com.br"
              className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-primary focus:bg-card"
            />
          </div>
          <Btn variant="primary" className="w-full" disabled title={CTA_INDISPONIVEL_TITLE} onClick={() => noop("Enviar convite")}>
            Enviar convite · preview
          </Btn>
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
            O acesso externo real é uma fase futura (autenticação + LGPD).
          </div>
        </Card>
        <Card>
          <CardHead title="O que o contador vê" right={<span className="text-xs text-muted-foreground">somente leitura</span>} />
          <div className="px-4 py-1.5">
            {PERMISSOES_ROWS.map((p, i) => (
              <div
                key={p.label}
                className={cn("flex items-center justify-between gap-3.5 py-3", i < PERMISSOES_ROWS.length - 1 && "border-b border-border/60")}
              >
                <div>
                  <b className="text-[13.5px] font-semibold text-foreground">{p.label}</b>
                  <small className="block text-[11.5px] text-muted-foreground">{p.sub}</small>
                </div>
                <Switch defaultChecked={p.on} disabled title={CTA_INDISPONIVEL_TITLE} aria-label={p.label} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  )

  /* ── seção: Timeline (REAL — GOAL 011) ── */
  const renderTimeline = () => <ContadorTimelineReal competencia={competencia} />


  /* ── seção: Configurações ── */
  const renderConfig = () => (
    <>
      <SectionHeader title="Configurações" desc="Dados da empresa e preferências do HUB." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3.5 text-[15px] font-semibold text-foreground">Dados da empresa</h3>
          <Field label="Razão social" value="Loja Exemplo Ltda" readOnly />
          <Field label="CNPJ" value="00.000.000/0001-00" readOnly mono />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground/80">
              Regime tributário{" "}
              <span className="font-normal text-muted-foreground">(exibição — define o modelo de checklist · validar com contador)</span>
            </label>
            <select className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-primary focus:bg-card">
              <option>Simples Nacional</option>
              <option>Lucro Presumido</option>
              <option>Lucro Real</option>
              <option>MEI</option>
            </select>
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="mb-3.5 text-[15px] font-semibold text-foreground">Preferências</h3>
          <div className="mb-4 flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground/80">Competência padrão ao abrir</label>
            <select className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-primary focus:bg-card">
              <option>Mês atual</option>
              <option>Último mês fechado</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-3.5 border-b border-border/60 py-3">
            <div>
              <b className="text-[13.5px] font-semibold text-foreground">Avisar vencimentos</b>
              <small className="block text-[11.5px] text-muted-foreground">badges no painel · preview</small>
            </div>
            <Switch defaultChecked disabled title={CTA_INDISPONIVEL_TITLE} aria-label="Avisar vencimentos" />
          </div>
          <div className="flex items-center justify-between gap-3.5 py-3">
            <div>
              <b className="text-[13.5px] font-semibold text-foreground">Lembrar de fechar o mês</b>
              <small className="block text-[11.5px] text-muted-foreground">alerta de fechamento</small>
            </div>
            <Switch defaultChecked disabled title={CTA_INDISPONIVEL_TITLE} aria-label="Lembrar de fechar o mês" />
          </div>
          <Btn className="mt-3.5" disabled title={CTA_INDISPONIVEL_TITLE} onClick={() => noop("Salvar configurações")}>
            Salvar · preview
          </Btn>
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
          <span>Matriz</span>
          <span className="text-muted-foreground/50">/</span>
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
            <PreviewPill>Fechamento · preview</PreviewPill>
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

      {/* aviso global e persistente — visível em todas as seções, ver GlobalPreviewNotice */}
      <GlobalPreviewNotice />

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
                  {s.count != null ? (
                    <span
                      className={cn(
                        "ml-auto hidden min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] font-semibold lg:inline-grid lg:h-[18px] lg:place-items-center",
                        isActive ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/80",
                      )}
                    >
                      {s.count}
                    </span>
                  ) : null}
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

      {/* drawer de detalhe (doc / guia) */}
      {drawer ? <DetailDrawer drawer={drawer} compShort={compShort} onClose={closeDrawer} onNoop={noop} /> : null}

      {/* toast honesto auto-contido */}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
          <div className="max-w-[90vw] rounded-lg bg-foreground px-4 py-3 text-center text-[13px] font-medium text-background shadow-lg">
            {toast}
          </div>
        </div>
      ) : null}
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

function ProgressRing({ pct }: { pct: number }) {
  return (
    <div
      className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full"
      style={{ background: `conic-gradient(var(--primary) ${pct}%, var(--muted) 0)` }}
    >
      <div className="grid h-[46px] w-[46px] place-items-center rounded-full bg-card text-sm font-bold text-foreground">
        {pct}%
      </div>
    </div>
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

/**
 * Aviso global e persistente (GOAL CONTADOR-HUB-HONESTY-ROUTE-SAFETY-002).
 * Renderizado uma única vez, fora do conteúdo trocado por seção — por isso continua
 * visível em todas as 11 áreas e ao trocar de aba/competência, sem depender de
 * hover/tooltip/clique. Tom informativo (primary), não de erro/alerta.
 */
function GlobalPreviewNotice() {
  return (
    <div className="flex flex-wrap items-start gap-2.5 border-b border-primary/20 bg-primary/[0.06] px-4 py-2.5 sm:px-6">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-foreground/85">
        <b className="font-semibold text-foreground">Experiência híbrida — blocos reais identificados + preview.</b>{" "}
        Na Visão Geral e em Relatórios, os blocos com selo verde leem a loja e a competência quando disponíveis;
        indisponibilidade é mostrada sem presumir zero.{" "}
        Os demais cartões e seções continuam ilustrativos. Nenhum envio, fechamento, guia ou documento é processado;
        a competência selecionada altera somente os blocos reais.
      </p>
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
        <b className="block text-sm font-bold text-foreground">Pré-visualização do Portal do Contador — acesso somente leitura</b>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
          Você está vendo o que o contador externo enxerga. Ele pode baixar, enviar documentos, comentar e abrir
          solicitações — mas não edita vendas, estoque, caixa ou configurações, e não acessa permissões.
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

/** Ações "no-op" por origem do dossiê (rótulo + texto do toast honesto). */
const ORIGEM_ACAO_LABEL: Record<DossieOrigem, string> = {
  sistema: "Gerar",
  anexar: "Anexar",
  portal: "Abrir portal",
  solicitar: "Solicitar",
}
const ORIGEM_ACAO: Record<DossieOrigem, string> = {
  sistema: "Gerar relatório do sistema",
  anexar: "Anexar documento",
  portal: "Abrir portal oficial",
  solicitar: "Solicitar ao contador",
}

function DetailDrawer({
  drawer,
  compShort,
  onClose,
  onNoop,
}: {
  drawer: { kind: "doc" | "guia"; title: string }
  compShort: string
  onClose: () => void
  onNoop: (action: string) => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-foreground/40" onClick={onClose} aria-hidden />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-[430px] max-w-[92vw] flex-col bg-card shadow-2xl"
        aria-label="Detalhe"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h3 className="min-w-0 truncate text-base font-bold text-foreground">{drawer.title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border text-foreground/70 hover:bg-muted/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {drawer.kind === "guia" ? (
            <>
              <PreviewBanner
                title="Preview — validar com contador."
                text="O sistema não calcula nem emite esta guia. Use para acompanhar o prazo e anexar o comprovante."
              />
              <div className="mt-3">
                <Kv label="Competência" value={compShort} />
                <Kv label="Vencimento" value="20/07/2026" />
                <Kv label="Valor" value="— validar —" muted />
                <Kv label="Status" value="pendente" muted last />
              </div>
              <div className="mb-2.5 mt-4 font-mono text-[10.5px] uppercase tracking-widest text-muted-foreground">
                Comprovante
              </div>
              <div className="grid min-h-[110px] place-items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-3.5 text-center text-[12.5px] text-muted-foreground">
                <Plus className="h-6 w-6 text-muted-foreground/50" />
                Nenhum comprovante anexado
              </div>
              <div className="mt-3 flex flex-wrap gap-2.5 border-t border-border pt-3.5">
                <Btn variant="primary" disabled title={CTA_INDISPONIVEL_TITLE} onClick={() => onNoop("Anexar comprovante")}>
                  Anexar comprovante
                </Btn>
                <Btn disabled title={CTA_INDISPONIVEL_TITLE} onClick={() => onNoop("Marcar como pago")}>
                  Marcar como pago
                </Btn>
              </div>
            </>
          ) : (
            <>
              <div className="grid min-h-[140px] place-items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-3.5 text-center text-[12.5px] text-muted-foreground">
                <FileText className="h-6 w-6 text-muted-foreground/50" />
                Pré-visualização do documento
              </div>
              <div className="mt-4">
                <Kv label="Competência" value={compShort} />
                <Kv label="Tipo" value="Documento para o contador" />
                <Kv label="Status" value="pendente" muted last />
              </div>
              <div className="mb-2.5 mt-4 font-mono text-[10.5px] uppercase tracking-widest text-muted-foreground">Andamento</div>
              <div className="flex flex-col gap-0">
                <FlowStep state="done" title="Pendente" sub="criado no checklist do mês" />
                <FlowStep state="curr" title="Enviado" sub="aguardando o contador" />
                <FlowStep state="todo" title="Conferido" />
                <FlowStep state="todo" title="Resolvido" last />
              </div>
              <div className="mb-2.5 mt-4 font-mono text-[10.5px] uppercase tracking-widest text-muted-foreground">Observações</div>
              <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-[12.5px] text-foreground/90">
                <div className="mb-1 text-xs font-semibold text-foreground">
                  Contador <span className="font-mono text-[11px] font-normal text-muted-foreground">· 27/06</span>
                </div>
                Preciso deste documento para fechar a competência.
              </div>
              <div className="mt-3 flex flex-wrap gap-2.5 border-t border-border pt-3.5">
                <Btn variant="primary" disabled title={CTA_INDISPONIVEL_TITLE} onClick={() => onNoop("Enviar ao contador")}>
                  Enviar ao contador
                </Btn>
                <Btn disabled title={CTA_INDISPONIVEL_TITLE} onClick={() => onNoop("Baixar documento")}>
                  Baixar
                </Btn>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  )
}

function FlowStep({
  state,
  title,
  sub,
  last,
}: {
  state: "done" | "curr" | "todo"
  title: string
  sub?: string
  last?: boolean
}) {
  return (
    <div className="relative flex gap-3 pb-3.5">
      {!last ? <span className="absolute bottom-0 left-2 top-[18px] w-0.5 bg-border" /> : null}
      <span
        className={cn(
          "mt-0.5 h-[18px] w-[18px] shrink-0 rounded-full border-2 bg-card",
          state === "done" && "border-emerald-500 bg-emerald-500",
          state === "curr" && "border-sky-500 bg-sky-500",
          state === "todo" && "border-border",
        )}
      />
      <div>
        <b className={cn("text-[13px] font-semibold", state === "todo" ? "text-muted-foreground" : "text-foreground")}>{title}</b>
        {sub ? <small className="block text-[11.5px] text-muted-foreground">{sub}</small> : null}
      </div>
    </div>
  )
}
