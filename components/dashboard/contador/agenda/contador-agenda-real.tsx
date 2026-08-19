"use client"

/**
 * Contador HUB · seção Obrigações & Guias REAL (GOAL 016).
 *
 * 100% manual/informada: valor, vencimento e tipo vêm do responsável.
 * Sem cálculo fiscal, sem Preview. Reusa documentos (010) e a matriz de status (011).
 */
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Loader2, Plus, RefreshCw } from "lucide-react"
import { formatCompetencia, type Competencia } from "@/lib/contador/competencia"
import { Botao, Overlay, StatusChip, VencidoChip, lerErroResposta } from "../contador-ui"
import { MICROCOPY_INFORMADO, OBRIGACAO_TIPOS, type GuiaDto, type ObrigacaoDto, type TemplateDto } from "@/lib/contador/agenda/tipos"

type Props = { competencia: Competencia }

type AgendaOk = { obrigacoes: ObrigacaoDto[]; guias: GuiaDto[] }
type DocOpt = { id: string; titulo: string; mime: string; nomeArquivo: string }

const TIPO_LABEL: Record<string, string> = {
  envio_documento: "Envio de documento",
  pagamento_guia: "Pagamento de guia",
  conferencia: "Conferência",
  declaracao: "Declaração",
  entrega_arquivo: "Entrega de arquivo",
  fechamento: "Fechamento",
  tarefa: "Tarefa",
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const DIA_FMT = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

function fmtDia(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : DIA_FMT.format(d)
}

function fmtValor(centavos: number): string {
  return BRL.format(centavos / 100)
}

export function ContadorAgendaReal({ competencia }: Props) {
  const codigo = formatCompetencia(competencia)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [agenda, setAgenda] = useState<AgendaOk | null>(null)
  const [templates, setTemplates] = useState<TemplateDto[]>([])
  const [docs, setDocs] = useState<DocOpt[]>([])
  const [podeConferir, setPodeConferir] = useState(false)
  const [painelTpl, setPainelTpl] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  const [novaOb, setNovaOb] = useState({ titulo: "", tipo: "tarefa", vencimento: "" })
  const [novaGuia, setNovaGuia] = useState({
    titulo: "",
    valor: "",
    vencimento: "",
    pdfDocumentoId: "",
    comprovanteDocumentoId: "",
    obrigacaoId: "",
  })
  const [novoTpl, setNovoTpl] = useState({
    titulo: "",
    tipo: "pagamento_guia",
    diaVencimento: "20",
    recorrencia: "mensal",
  })

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const [ag, tpl, st, dcs] = await Promise.all([
        fetch(`/api/contador/agenda?c=${codigo}`, { cache: "no-store" }),
        fetch("/api/contador/agenda/templates", { cache: "no-store" }),
        fetch("/api/contador/status", { cache: "no-store" }),
        fetch(`/api/contador/documentos?c=${codigo}`, { cache: "no-store" }),
      ])
      if (!ag.ok) throw new Error(await lerErroResposta(ag))
      const agJ = (await ag.json()) as AgendaOk & { ok: boolean }
      setAgenda({ obrigacoes: agJ.obrigacoes ?? [], guias: agJ.guias ?? [] })
      if (tpl.ok) {
        const tJ = (await tpl.json()) as { templates?: TemplateDto[] }
        setTemplates(tJ.templates ?? [])
      }
      if (st.ok) {
        const sJ = (await st.json()) as { capacidades?: { podeConferir?: boolean } }
        setPodeConferir(sJ.capacidades?.podeConferir === true)
      }
      if (dcs.ok) {
        const dJ = (await dcs.json()) as { documentos?: DocOpt[] }
        setDocs(dJ.documentos ?? [])
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar a agenda.")
      setAgenda(null)
    } finally {
      setCarregando(false)
    }
  }, [codigo])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function postJson(url: string, body: unknown): Promise<Response> {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  async function gerarDesteMes() {
    setOcupado(true)
    try {
      const res = await postJson("/api/contador/agenda/obrigacoes/instanciar", { competencia: codigo })
      if (!res.ok) throw new Error(await lerErroResposta(res))
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar obrigações.")
    } finally {
      setOcupado(false)
    }
  }

  async function criarObManual() {
    setOcupado(true)
    try {
      const res = await postJson("/api/contador/agenda/obrigacoes", {
        competencia: codigo,
        titulo: novaOb.titulo,
        tipo: novaOb.tipo,
        vencimento: novaOb.vencimento || undefined,
      })
      if (!res.ok) throw new Error(await lerErroResposta(res))
      setNovaOb({ titulo: "", tipo: "tarefa", vencimento: "" })
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao criar obrigação.")
    } finally {
      setOcupado(false)
    }
  }

  async function instanciarTemplate(templateId: string) {
    setOcupado(true)
    try {
      const res = await postJson("/api/contador/agenda/obrigacoes", { competencia: codigo, templateId })
      if (!res.ok) throw new Error(await lerErroResposta(res))
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao instanciar template.")
    } finally {
      setOcupado(false)
    }
  }

  async function statusOb(id: string, para: string, motivo?: string) {
    setOcupado(true)
    try {
      const res = await postJson(`/api/contador/agenda/obrigacoes/${id}/status`, { para, motivo })
      if (!res.ok) throw new Error(await lerErroResposta(res))
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao alterar status.")
    } finally {
      setOcupado(false)
    }
  }

  async function criarGuia() {
    const valorNum = Number(novaGuia.valor.replace(",", "."))
    const valorCentavos = Number.isFinite(valorNum) ? Math.round(valorNum * 100) : NaN
    setOcupado(true)
    try {
      const res = await postJson("/api/contador/agenda/guias", {
        competencia: codigo,
        titulo: novaGuia.titulo,
        valorCentavos,
        vencimento: novaGuia.vencimento,
        origem: "manual",
        obrigacaoId: novaGuia.obrigacaoId || undefined,
        pdfDocumentoId: novaGuia.pdfDocumentoId || undefined,
        comprovanteDocumentoId: novaGuia.comprovanteDocumentoId || undefined,
      })
      if (!res.ok) throw new Error(await lerErroResposta(res))
      setNovaGuia({ titulo: "", valor: "", vencimento: "", pdfDocumentoId: "", comprovanteDocumentoId: "", obrigacaoId: "" })
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao informar guia.")
    } finally {
      setOcupado(false)
    }
  }

  async function associarDoc(guiaId: string, campo: "pdfDocumentoId" | "comprovanteDocumentoId", documentoId: string) {
    setOcupado(true)
    try {
      const res = await fetch(`/api/contador/agenda/guias/${guiaId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [campo]: documentoId || null }),
      })
      if (!res.ok) throw new Error(await lerErroResposta(res))
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao associar documento.")
    } finally {
      setOcupado(false)
    }
  }

  async function pagar(guiaId: string) {
    setOcupado(true)
    try {
      const res = await postJson(`/api/contador/agenda/guias/${guiaId}/pagar`, {})
      if (!res.ok) throw new Error(await lerErroResposta(res))
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao marcar guia paga.")
    } finally {
      setOcupado(false)
    }
  }

  async function criarTemplate() {
    setOcupado(true)
    try {
      const res = await postJson("/api/contador/agenda/templates", {
        titulo: novoTpl.titulo,
        tipo: novoTpl.tipo,
        recorrencia: novoTpl.recorrencia,
        diaVencimento: novoTpl.recorrencia === "mensal" ? Number(novoTpl.diaVencimento) : null,
      })
      if (!res.ok) throw new Error(await lerErroResposta(res))
      setNovoTpl({ titulo: "", tipo: "pagamento_guia", diaVencimento: "20", recorrencia: "mensal" })
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao criar template.")
    } finally {
      setOcupado(false)
    }
  }

  const pdfs = docs.filter((d) => d.mime.toLowerCase() === "application/pdf")
  const comps = docs.filter((d) => /pdf|png|jpe?g/i.test(d.mime))

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">Obrigações &amp; vencimentos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Acompanhamento de obrigações e guias da competência {codigo}. Tudo é{" "}
            <span className="font-medium text-foreground">{MICROCOPY_INFORMADO}</span>
            {" — "}o sistema não calcula nem emite guias.
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Botao size="sm" onClick={() => void carregar()} disabled={carregando || ocupado}>
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </Botao>
          <Botao size="sm" onClick={() => setPainelTpl(true)}>
            Templates
          </Botao>
          <Botao size="sm" variant="primary" onClick={() => void gerarDesteMes()} disabled={ocupado}>
            Gerar deste mês
          </Botao>
        </div>
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando obrigações e guias…
        </div>
      ) : null}

      {erro ? (
        <div className="flex min-w-0 items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-500">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">{erro}</span>
        </div>
      ) : null}

      {!carregando && agenda ? (
        <>
          <section className="min-w-0 rounded-lg border border-border bg-card">
            <header className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Obrigações</h3>
              <p className="text-xs text-muted-foreground">Status reutiliza a matriz do HUB. Vencido/vencendo são flags derivadas.</p>
            </header>
            {agenda.obrigacoes.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Nenhuma obrigação nesta competência. Use «Gerar deste mês» (templates mensais) ou informe uma obrigação
                avulsa. Templates «nenhuma» só entram por seleção explícita.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {agenda.obrigacoes.map((o) => (
                  <li key={o.id} className="flex min-w-0 flex-wrap items-center gap-2 px-4 py-3 text-[13px]">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-foreground">{o.titulo}</div>
                      <div className="text-xs text-muted-foreground">
                        {TIPO_LABEL[o.tipo] ?? o.tipo} · vence {fmtDia(o.vencimento)} · {MICROCOPY_INFORMADO}
                      </div>
                    </div>
                    <StatusChip status={o.status} />
                    {o.vencido ? <VencidoChip /> : null}
                    {o.vencendo && !o.vencido ? <ChipAviso>vencendo</ChipAviso> : null}
                    {o.transicoes.map((t) => (
                      <Botao
                        key={t.para}
                        size="sm"
                        disabled={ocupado}
                        onClick={() => {
                          if (t.exigeMotivo) {
                            const m = window.prompt("Motivo da rejeição (obrigatório)")
                            if (!m?.trim()) return
                            void statusOb(o.id, t.para, m.trim())
                          } else {
                            void statusOb(o.id, t.para)
                          }
                        }}
                      >
                        {t.rotulo}
                      </Botao>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            <form
              className="grid min-w-0 gap-2 border-t border-border p-4 sm:grid-cols-[1fr_auto_auto_auto]"
              onSubmit={(e) => {
                e.preventDefault()
                void criarObManual()
              }}
            >
              <input
                className="min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="Nova obrigação (título informado pelo responsável)"
                value={novaOb.titulo}
                onChange={(e) => setNovaOb((s) => ({ ...s, titulo: e.target.value }))}
              />
              <select
                className="min-w-0 rounded-md border border-border bg-background px-2 py-2 text-sm"
                value={novaOb.tipo}
                onChange={(e) => setNovaOb((s) => ({ ...s, tipo: e.target.value }))}
              >
                {OBRIGACAO_TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_LABEL[t]}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className="min-w-0 rounded-md border border-border bg-background px-2 py-2 text-sm"
                value={novaOb.vencimento}
                onChange={(e) => setNovaOb((s) => ({ ...s, vencimento: e.target.value }))}
              />
              <Botao type="submit" size="sm" variant="primary" disabled={ocupado || !novaOb.titulo.trim()}>
                <Plus className="h-3.5 w-3.5" />
                Informar
              </Botao>
            </form>
          </section>

          <section className="min-w-0 rounded-lg border border-border bg-card">
            <header className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Guias</h3>
              <p className="text-xs text-muted-foreground">
                Valor e vencimento são {MICROCOPY_INFORMADO}. Sem motor fiscal. PDF/comprovante reutilizam Documentos.
              </p>
            </header>
            {agenda.guias.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Nenhuma guia informada nesta competência. Zero guias não prova ausência de obrigação.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {agenda.guias.map((g) => (
                  <li key={g.id} className="min-w-0 space-y-2 px-4 py-3 text-[13px]">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-foreground">{g.titulo}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtValor(g.valorCentavos)} · vence {fmtDia(g.vencimento)} · {MICROCOPY_INFORMADO}
                        </div>
                      </div>
                      {g.paga ? <ChipOk>paga</ChipOk> : <StatusChip status="PENDENTE" />}
                      {g.vencido ? <VencidoChip /> : null}
                      {g.vencendo && !g.vencido && !g.paga ? <ChipAviso>vencendo</ChipAviso> : null}
                      {g.pdfAusente ? <span className="text-xs text-muted-foreground">PDF ausente</span> : null}
                      {g.comprovanteAusente ? (
                        <span className="text-xs text-muted-foreground">comprovante ausente</span>
                      ) : null}
                      {!g.paga && podeConferir ? (
                        <Botao size="sm" variant="primary" disabled={ocupado} onClick={() => void pagar(g.id)}>
                          Marcar como paga
                        </Botao>
                      ) : null}
                    </div>
                    {!g.paga ? (
                      <div className="flex min-w-0 flex-wrap gap-2">
                        <label className="min-w-0 text-xs text-muted-foreground">
                          PDF
                          <select
                            className="ml-1 min-w-0 rounded-md border border-border bg-background px-2 py-1 text-xs"
                            value={g.pdfDocumentoId ?? ""}
                            onChange={(e) => void associarDoc(g.id, "pdfDocumentoId", e.target.value)}
                          >
                            <option value="">— associar PDF —</option>
                            {pdfs.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.titulo || d.nomeArquivo}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="min-w-0 text-xs text-muted-foreground">
                          Comprovante
                          <select
                            className="ml-1 min-w-0 rounded-md border border-border bg-background px-2 py-1 text-xs"
                            value={g.comprovanteDocumentoId ?? ""}
                            onChange={(e) => void associarDoc(g.id, "comprovanteDocumentoId", e.target.value)}
                          >
                            <option value="">— associar comprovante —</option>
                            {comps.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.titulo || d.nomeArquivo}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <form
              className="grid min-w-0 gap-2 border-t border-border p-4 md:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault()
                void criarGuia()
              }}
            >
              <input
                className="min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="Título da guia (informado pelo responsável)"
                value={novaGuia.titulo}
                onChange={(e) => setNovaGuia((s) => ({ ...s, titulo: e.target.value }))}
              />
              <input
                className="min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="Valor em R$ (informado, sem cálculo)"
                inputMode="decimal"
                value={novaGuia.valor}
                onChange={(e) => setNovaGuia((s) => ({ ...s, valor: e.target.value }))}
              />
              <input
                type="date"
                className="min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={novaGuia.vencimento}
                onChange={(e) => setNovaGuia((s) => ({ ...s, vencimento: e.target.value }))}
              />
              <select
                className="min-w-0 rounded-md border border-border bg-background px-2 py-2 text-sm"
                value={novaGuia.obrigacaoId}
                onChange={(e) => setNovaGuia((s) => ({ ...s, obrigacaoId: e.target.value }))}
              >
                <option value="">Sem obrigação ligada</option>
                {(agenda.obrigacoes ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.titulo}
                  </option>
                ))}
              </select>
              <select
                className="min-w-0 rounded-md border border-border bg-background px-2 py-2 text-sm"
                value={novaGuia.pdfDocumentoId}
                onChange={(e) => setNovaGuia((s) => ({ ...s, pdfDocumentoId: e.target.value }))}
              >
                <option value="">PDF da guia (opcional)</option>
                {pdfs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.titulo || d.nomeArquivo}
                  </option>
                ))}
              </select>
              <select
                className="min-w-0 rounded-md border border-border bg-background px-2 py-2 text-sm"
                value={novaGuia.comprovanteDocumentoId}
                onChange={(e) => setNovaGuia((s) => ({ ...s, comprovanteDocumentoId: e.target.value }))}
              >
                <option value="">Comprovante (opcional)</option>
                {comps.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.titulo || d.nomeArquivo}
                  </option>
                ))}
              </select>
              <Botao
                type="submit"
                size="sm"
                variant="primary"
                className="md:col-span-2"
                disabled={ocupado || !novaGuia.titulo.trim() || !novaGuia.vencimento}
              >
                Informar guia
              </Botao>
            </form>
          </section>
        </>
      ) : null}

      {painelTpl ? (
        <Overlay onClose={() => setPainelTpl(false)} alinhar="right">
          <aside className="flex h-full w-[min(420px,92vw)] min-w-0 flex-col border-l border-border bg-card">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Templates</h3>
              <Botao size="sm" onClick={() => setPainelTpl(false)}>
                Fechar
              </Botao>
            </div>
            <div className="min-w-0 flex-1 space-y-3 overflow-y-auto p-4">
              <p className="text-xs text-muted-foreground">
                «Gerar deste mês» usa só templates <strong>mensais ativos</strong>. Recorrência «nenhuma» exige seleção
                explícita abaixo. Nada é gerado por tempo ou cron.
              </p>
              {templates.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum template nesta unidade.</p>
              ) : (
                <ul className="space-y-2">
                  {templates.map((t) => (
                    <li key={t.id} className="min-w-0 rounded-md border border-border p-3 text-sm">
                      <div className="font-medium">{t.titulo}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.recorrencia} · dia {t.diaVencimento ?? "—"} · {t.ativo ? "ativo" : "inativo"}
                      </div>
                      <Botao
                        size="sm"
                        className="mt-2"
                        disabled={ocupado || !t.ativo}
                        onClick={() => void instanciarTemplate(t.id)}
                      >
                        Gerar nesta competência
                      </Botao>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="space-y-2 border-t border-border pt-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  void criarTemplate()
                }}
              >
                <input
                  className="w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Título do template"
                  value={novoTpl.titulo}
                  onChange={(e) => setNovoTpl((s) => ({ ...s, titulo: e.target.value }))}
                />
                <select
                  className="w-full min-w-0 rounded-md border border-border bg-background px-2 py-2 text-sm"
                  value={novoTpl.tipo}
                  onChange={(e) => setNovoTpl((s) => ({ ...s, tipo: e.target.value }))}
                >
                  {OBRIGACAO_TIPOS.map((t) => (
                    <option key={t} value={t}>
                      {TIPO_LABEL[t]}
                    </option>
                  ))}
                </select>
                <select
                  className="w-full min-w-0 rounded-md border border-border bg-background px-2 py-2 text-sm"
                  value={novoTpl.recorrencia}
                  onChange={(e) => setNovoTpl((s) => ({ ...s, recorrencia: e.target.value }))}
                >
                  <option value="mensal">mensal</option>
                  <option value="nenhuma">nenhuma</option>
                </select>
                {novoTpl.recorrencia === "mensal" ? (
                  <input
                    type="number"
                    min={1}
                    max={31}
                    className="w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={novoTpl.diaVencimento}
                    onChange={(e) => setNovoTpl((s) => ({ ...s, diaVencimento: e.target.value }))}
                  />
                ) : null}
                <Botao type="submit" size="sm" variant="primary" disabled={ocupado || !novoTpl.titulo.trim()}>
                  Criar template
                </Botao>
              </form>
            </div>
          </aside>
        </Overlay>
      ) : null}
    </div>
  )
}

function ChipAviso({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11.5px] font-semibold text-amber-600 dark:text-amber-400">
      {children}
    </span>
  )
}

function ChipOk({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">
      {children}
    </span>
  )
}
