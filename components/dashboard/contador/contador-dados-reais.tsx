"use client"

/**
 * Contador HUB · UI dos dados reais (GOAL 006).
 *
 * Consome o DTO honesto de `lib/contador/readers`. Cada métrica exibe seu estado
 * (`real` / `parcial` / `indisponível`) — dado indisponível nunca vira 0 silencioso:
 * mostra "—" com selo. Sem no-op, sem persistência: leitura pura da competência ativa.
 */
import { AlertTriangle, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  ContadorDadosReais,
  DadoMonetario,
  DadoNumerico,
  DisponibilidadeDado,
} from "@/lib/contador/readers/tipos"
import {
  mensagemFiscalIndisponivel,
  type LeituraFiscalContador,
} from "@/lib/contador/readers/fiscal"

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

function fmtMoney(d: DadoMonetario): string {
  return d.valor === null ? "—" : BRL.format(d.valor)
}
function fmtNum(d: DadoNumerico): string {
  return d.valor === null ? "—" : String(d.valor)
}

function DispBadge({ d }: { d: DisponibilidadeDado }) {
  if (d === "real") return null
  const isParcial = d === "parcial"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wide",
        isParcial
          ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {isParcial ? "parcial" : "indisponível"}
    </span>
  )
}

function Metric({
  label,
  value,
  disponibilidade,
  observacao,
  strong,
}: {
  label: string
  value: string
  disponibilidade: DisponibilidadeDado
  observacao?: string
  strong?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-sm">
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span className="min-w-0 truncate">{label}</span>
        <DispBadge d={disponibilidade} />
      </span>
      <span
        className={cn(
          "font-mono font-semibold tracking-tight text-foreground",
          strong ? "text-2xl" : "text-xl",
          disponibilidade === "indisponivel" && "text-muted-foreground",
        )}
      >
        {value}
      </span>
      {observacao ? <span className="text-[11px] leading-snug text-muted-foreground">{observacao}</span> : null}
    </div>
  )
}

function GerencialNota() {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div>
        <b className="text-amber-600 dark:text-amber-400">Valores gerenciais — não substituem a contabilidade oficial.</b>{" "}
        Leitura direta da loja ativa na competência selecionada. Caixa físico e posição de títulos não são resultado
        contábil. A apuração e os demonstrativos oficiais são responsabilidade do seu contador.
      </div>
    </div>
  )
}

function DadosReaisHeader({ titulo }: { titulo: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-2.5">
      <span className="text-[13px] font-semibold text-foreground">{titulo}</span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Dados reais · somente leitura
      </span>
    </div>
  )
}

/** Estado de erro/indisponibilidade quando o escopo não resolve ou a leitura falha. */
export function ContadorRealIndisponivel({ motivo }: { motivo: string }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-foreground">Dados reais indisponíveis</div>
        <p className="mt-0.5 max-w-[64ch] text-[13px] text-muted-foreground">{motivo}</p>
      </div>
    </div>
  )
}

/* ─────────────────────────── Visão geral (real) ─────────────────────────── */

export function VisaoGeralReal({ dados }: { dados: ContadorDadosReais }) {
  const { vendas, devolucoes, financeiro, caixa, liquidoCompetencia, alertas } = dados
  return (
    <div className="mb-4 grid gap-4">
      <DadosReaisHeader titulo="Resumo real da competência" />
      <GerencialNota />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Vendas (qtd)" value={fmtNum(vendas.quantidade)} disponibilidade={vendas.quantidade.disponibilidade} />
        <Metric label="Vendas (total)" value={fmtMoney(vendas.total)} disponibilidade={vendas.total.disponibilidade} strong />
        <Metric
          label="Devoluções"
          value={fmtMoney(devolucoes.total)}
          disponibilidade={devolucoes.total.disponibilidade}
          observacao="Reduz a competência em que ocorreu"
        />
        <Metric
          label="Líquido da competência"
          value={fmtMoney(liquidoCompetencia)}
          disponibilidade={liquidoCompetencia.disponibilidade}
          strong
          observacao="Vendas − devoluções (sem dupla subtração)"
        />
        <Metric
          label="Entradas realizadas"
          value={fmtMoney(financeiro.entradasRealizadas)}
          disponibilidade={financeiro.entradasRealizadas.disponibilidade}
        />
        <Metric
          label="Saídas realizadas"
          value={fmtMoney(financeiro.saidasRealizadas)}
          disponibilidade={financeiro.saidasRealizadas.disponibilidade}
        />
        <Metric
          label="Transferências internas"
          value={fmtMoney(financeiro.transferencias)}
          disponibilidade={financeiro.transferencias.disponibilidade}
          observacao="Volume neutro no resultado econômico"
        />
        <Metric
          label="Movimentos não classificados"
          value={fmtMoney(financeiro.naoClassificados)}
          disponibilidade={financeiro.naoClassificados.disponibilidade}
          observacao={financeiro.naoClassificados.observacao}
        />
        <Metric
          label="A receber (aberto)"
          value={fmtMoney(financeiro.titulosReceberAberto)}
          disponibilidade={financeiro.titulosReceberAberto.disponibilidade}
          observacao={financeiro.titulosReceberAberto.observacao}
        />
        <Metric
          label="A pagar (aberto)"
          value={fmtMoney(financeiro.titulosPagarAberto)}
          disponibilidade={financeiro.titulosPagarAberto.disponibilidade}
          observacao={financeiro.titulosPagarAberto.observacao}
        />
        <Metric label="Sessões de caixa" value={fmtNum(caixa.sessoes)} disponibilidade={caixa.sessoes.disponibilidade} />
        <Metric
          label="Sessões abertas"
          value={fmtNum(caixa.sessoesAbertas)}
          disponibilidade={caixa.sessoesAbertas.disponibilidade}
        />
        <Metric label="Sangrias" value={fmtMoney(caixa.sangriasTotal)} disponibilidade={caixa.sangriasTotal.disponibilidade} />
        <Metric
          label="Suprimentos"
          value={fmtMoney(caixa.suprimentosTotal)}
          disponibilidade={caixa.suprimentosTotal.disponibilidade}
        />
        <Metric
          label="Diferenças de caixa"
          value={fmtMoney(caixa.diferencas)}
          disponibilidade={caixa.diferencas.disponibilidade}
          observacao={caixa.diferencas.observacao}
        />
      </div>

      {alertas.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2 text-[13px] font-semibold text-foreground">Qualidade dos dados</h3>
          <ul className="grid gap-2">
            {alertas.map((a, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[12.5px]">
                <span
                  className={cn(
                    "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                    a.nivel === "atencao" ? "bg-amber-500" : "bg-sky-500",
                  )}
                />
                <span className="min-w-0">
                  <b className="font-semibold text-foreground">{a.titulo}.</b>{" "}
                  <span className="text-muted-foreground">{a.detalhe}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/* ─────────────────────────── Relatórios básicos (real) ─────────────────────────── */

function Bloco({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h3 className="mb-3 text-[14px] font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  )
}

function LinhaKv({ label, value, disp }: { label: string; value: string; disp?: DisponibilidadeDado }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2 text-[13px] last:border-b-0">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        {disp ? <DispBadge d={disp} /> : null}
        <b className="font-mono font-semibold text-foreground">{value}</b>
      </span>
    </div>
  )
}

export function RelatoriosReal({ dados }: { dados: ContadorDadosReais }) {
  const { vendas, devolucoes, financeiro, caixa, liquidoCompetencia } = dados
  return (
    <div className="mb-4 grid gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <DadosReaisHeader titulo="Relatórios básicos reais da competência" />
      </div>
      <Bloco title="Vendas por período">
        <LinhaKv label="Quantidade" value={fmtNum(vendas.quantidade)} disp={vendas.quantidade.disponibilidade} />
        <LinhaKv label="Total (bruto)" value={fmtMoney(vendas.total)} disp={vendas.total.disponibilidade} />
        <LinhaKv label="Devoluções" value={fmtMoney(devolucoes.total)} disp={devolucoes.total.disponibilidade} />
        <LinhaKv label="Líquido" value={fmtMoney(liquidoCompetencia)} disp={liquidoCompetencia.disponibilidade} />
        <LinhaKv label="Desconto (informativo)" value={fmtMoney(vendas.descontoTotal)} disp={vendas.descontoTotal.disponibilidade} />
      </Bloco>

      <Bloco title="Vendas por forma de pagamento">
        {vendas.formaPagamentoDisponibilidade === "indisponivel" ? (
          <p className="text-[12.5px] text-muted-foreground">
            Sem forma de pagamento identificável no payload das vendas desta competência.
          </p>
        ) : (
          <>
            {vendas.formasPagamento.map((f) => (
              <LinhaKv key={f.chave} label={f.label} value={BRL.format(f.valor)} />
            ))}
            {(vendas.naoIdentificadoQuantidade.valor ?? 0) > 0 ? (
              <LinhaKv
                label="Não identificado"
                value={fmtMoney(vendas.naoIdentificadoValor)}
                disp={vendas.naoIdentificadoValor.disponibilidade}
              />
            ) : null}
            {(vendas.reconciliacaoPagamento?.residualNaoIdentificado ?? 0) > 0 ? (
              <LinhaKv
                label="Valor sem forma de pagamento identificada"
                value={BRL.format(vendas.reconciliacaoPagamento?.residualNaoIdentificado ?? 0)}
                disp="parcial"
              />
            ) : null}
            {(vendas.reconciliacaoPagamento?.excedenteBreakdown ?? 0) > 0 ? (
              <LinhaKv
                label="Breakdown de pagamentos excede o total das vendas"
                value={BRL.format(vendas.reconciliacaoPagamento?.excedenteBreakdown ?? 0)}
                disp="parcial"
              />
            ) : null}
            {(vendas.reconciliacaoPagamento?.divergenciaAbsoluta ?? 0) > 0 ? (
              <LinhaKv
                label="Divergência total do breakdown (residual + excedente)"
                value={BRL.format(vendas.reconciliacaoPagamento?.divergenciaAbsoluta ?? 0)}
                disp="parcial"
              />
            ) : null}
          </>
        )}
      </Bloco>

      <Bloco title="Cancelamentos">
        <LinhaKv label="Quantidade" value={fmtNum(vendas.canceladasQuantidade)} disp={vendas.canceladasQuantidade.disponibilidade} />
        <LinhaKv label="Total (fora do faturamento)" value={fmtMoney(vendas.canceladasTotal)} disp={vendas.canceladasTotal.disponibilidade} />
      </Bloco>

      <Bloco title="Devoluções">
        <LinhaKv label="Quantidade" value={fmtNum(devolucoes.quantidade)} disp={devolucoes.quantidade.disponibilidade} />
        <LinhaKv label="Total" value={fmtMoney(devolucoes.total)} disp={devolucoes.total.disponibilidade} />
      </Bloco>

      <Bloco title="Movimentações realizadas">
        <LinhaKv label="Entradas" value={fmtMoney(financeiro.entradasRealizadas)} disp={financeiro.entradasRealizadas.disponibilidade} />
        <LinhaKv label="Saídas" value={fmtMoney(financeiro.saidasRealizadas)} disp={financeiro.saidasRealizadas.disponibilidade} />
        <LinhaKv label="Estornos (à parte)" value={fmtMoney(financeiro.estornos)} disp={financeiro.estornos.disponibilidade} />
        <LinhaKv
          label="Transferências internas (volume)"
          value={`${fmtMoney(financeiro.transferencias)} · ${fmtNum(financeiro.transferenciasQuantidade)}`}
          disp={financeiro.transferencias.disponibilidade}
        />
        <LinhaKv
          label="Não classificados"
          value={`${fmtMoney(financeiro.naoClassificados)} · ${fmtNum(financeiro.naoClassificadosQuantidade)}`}
          disp={financeiro.naoClassificados.disponibilidade}
        />
      </Bloco>

      <Bloco title="Títulos em aberto (posição na competência)">
        <LinhaKv
          label="A receber"
          value={`${fmtMoney(financeiro.titulosReceberAberto)} · ${fmtNum(financeiro.titulosReceberQuantidade)} tít.`}
          disp={financeiro.titulosReceberAberto.disponibilidade}
        />
        <LinhaKv
          label="A pagar"
          value={`${fmtMoney(financeiro.titulosPagarAberto)} · ${fmtNum(financeiro.titulosPagarQuantidade)} tít.`}
          disp={financeiro.titulosPagarAberto.disponibilidade}
        />
      </Bloco>

      <Bloco title="Resumo de caixa">
        <LinhaKv label="Sessões" value={fmtNum(caixa.sessoes)} disp={caixa.sessoes.disponibilidade} />
        <LinhaKv label="Sessões abertas" value={fmtNum(caixa.sessoesAbertas)} disp={caixa.sessoesAbertas.disponibilidade} />
        <LinhaKv label="Sangrias" value={`${fmtMoney(caixa.sangriasTotal)} · ${fmtNum(caixa.sangriasQuantidade)}`} disp={caixa.sangriasTotal.disponibilidade} />
        <LinhaKv label="Suprimentos" value={`${fmtMoney(caixa.suprimentosTotal)} · ${fmtNum(caixa.suprimentosQuantidade)}`} disp={caixa.suprimentosTotal.disponibilidade} />
        <LinhaKv label="Diferenças" value={fmtMoney(caixa.diferencas)} disp={caixa.diferencas.disponibilidade} />
      </Bloco>
    </div>
  )
}

/* ─────────────────────────── Relatório fiscal (GOAL 018 · somente leitura) ─────────────────────────── */

/**
 * Relatório mínimo da fonte fiscal. Sem botão de emissão, cancelamento,
 * inutilização, correção ou reprocessamento.
 */
export function RelatorioFiscalReal({
  leitura,
  compacto = false,
}: {
  leitura: LeituraFiscalContador
  compacto?: boolean
}) {
  const disp: DisponibilidadeDado = leitura.disponivel ? "real" : "indisponivel"
  const estadoFonte = leitura.disponivel
    ? "disponível"
    : leitura.motivo === "leitura_falhou"
      ? "erro de leitura"
      : "não disponível"

  return (
    <div className={cn("min-w-0", compacto ? "mb-4" : "mb-4 grid gap-4 lg:col-span-2")}>
      <Bloco title={compacto ? "Notas fiscais (leitura)" : "Notas fiscais da competência"}>
        <p className="mb-2 text-[12px] text-muted-foreground">
          Somente leitura. Sem emissão, cancelamento, inutilização, correção ou reprocessamento fiscal.
        </p>
        <LinhaKv label="Estado da fonte" value={estadoFonte} disp={disp} />
        {leitura.disponivel ? (
          <>
            <LinhaKv label="Entregáveis (05-XML)" value={String(leitura.entregaveis.length)} disp="real" />
            <LinhaKv label="Rejeitadas" value={String(leitura.rejeitadas.length)} disp="real" />
            <LinhaKv label="Canceladas" value={String(leitura.canceladas.length)} disp="real" />
          </>
        ) : (
          <>
            <LinhaKv label="Entregáveis (05-XML)" value="—" disp="indisponivel" />
            <LinhaKv label="Rejeitadas" value="—" disp="indisponivel" />
            <LinhaKv label="Canceladas" value="—" disp="indisponivel" />
            <p className="min-w-0 pt-2 text-[12.5px] text-muted-foreground">
              {mensagemFiscalIndisponivel(leitura.motivo)}
            </p>
          </>
        )}
      </Bloco>
    </div>
  )
}
