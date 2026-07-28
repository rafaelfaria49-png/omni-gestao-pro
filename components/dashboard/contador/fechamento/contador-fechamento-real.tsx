"use client"

/**
 * Contador HUB · seção Fechamento REAL (GOAL 012).
 *
 * Substitui o CTA desabilitado do GOAL 007 pelo ciclo completo: fechar com confirmação
 * textual e pendências assumidas, selo oficial da versão, reabrir com motivo, alerta de
 * alteração pós-fechamento e histórico de versões do pacote.
 *
 * Tudo que o botão oferece o servidor confirma: as capacidades (`podeFechar`/`podeReabrir`)
 * vêm do endpoint, nunca de uma inferência local de papel. O checklist continua sendo o
 * derivado read-only do GOAL 007 — aqui ele ganha a função de listar o que precisa ser
 * assumido para fechar.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  History,
  Loader2,
  Lock,
  RefreshCw,
  Unlock,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCompetencia, type Competencia } from "@/lib/contador/competencia"
import type { ChecklistFechamento } from "@/lib/contador/fechamento/tipos"
import { Botao, Overlay, formatarDataHora, lerErroResposta } from "../contador-ui"

/* ─────────────────────────── contratos de UI ─────────────────────────── */

type PacoteVersao = {
  versao: number
  manifestoHash: string
  bytes: number
  geradoEm: string
  geradoPorTipo: string
  geradoPorId: string
}

type EstadoFechamento = {
  competencia: string
  status: string
  versao: number
  fechada: boolean
  fechadaEm: string | null
  reabertaEm: string | null
  snapshotHash: string | null
  podeFechar: boolean
  podeReabrir: boolean
  pacotes: PacoteVersao[]
}

type ItemDivergencia = {
  chave: string
  snapshot: { valor: number | null; disponibilidade: string }
  atual: { valor: number | null; disponibilidade: string }
  natureza: string
  delta: number | null
}

type Divergencia = {
  aplicavel: boolean
  divergente: boolean
  diffHash: string | null
  itens: ItemDivergencia[]
  aviso: string | null
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

/* ─────────────────────────── componente principal ─────────────────────────── */

export function ContadorFechamentoReal({
  competencia,
  checklist,
}: {
  competencia: Competencia
  checklist: ChecklistFechamento
}) {
  const compCodigo = formatCompetencia(competencia)
  const [estado, setEstado] = useState<EstadoFechamento | null>(null)
  const [divergencia, setDivergencia] = useState<Divergencia | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [fecharAberto, setFecharAberto] = useState(false)
  const [reabrirAberto, setReabrirAberto] = useState(false)
  const [registrando, setRegistrando] = useState(false)

  /** Itens que não estão `ok` — precisam ser assumidos explicitamente para fechar. */
  const pendencias = useMemo(
    () => checklist.itens.filter((i) => i.estado !== "ok"),
    [checklist],
  )

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/contador/fechamento?c=${encodeURIComponent(compCodigo)}`, {
        cache: "no-store",
      })
      if (!res.ok) {
        setErro(await lerErroResposta(res))
        setEstado(null)
        return
      }
      const j = (await res.json()) as EstadoFechamento
      setEstado(j)

      // Divergência só faz sentido com competência fechada (precisa de linha de base).
      if (j.fechada) {
        const d = await fetch(
          `/api/contador/fechamento/divergencia?c=${encodeURIComponent(compCodigo)}`,
          { cache: "no-store" },
        )
        setDivergencia(d.ok ? ((await d.json()) as Divergencia) : null)
      } else {
        setDivergencia(null)
      }
    } catch {
      setErro("Não foi possível carregar o estado do fechamento agora.")
      setEstado(null)
    } finally {
      setCarregando(false)
    }
  }, [compCodigo])

  useEffect(() => {
    void carregar()
  }, [carregar])

  /** Persiste o evento de divergência — ação explícita, nunca efeito de render. */
  const registrarDivergencia = async () => {
    setRegistrando(true)
    try {
      await fetch("/api/contador/fechamento/divergencia", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ competencia: compCodigo }),
      })
      await carregar()
    } finally {
      setRegistrando(false)
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-foreground">Fechamento mensal</h2>
          <p className="mt-1 max-w-[70ch] text-[13px] text-muted-foreground">
            Fechar <b className="text-foreground">{compCodigo}</b> congela o domínio contábil,
            grava um snapshot imutável e materializa uma versão oficial do pacote. Documentos,
            status e comentários deixam de aceitar alteração até uma reabertura auditada.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Botao size="sm" onClick={() => void carregar()} disabled={carregando}>
            <RefreshCw className={cn("h-4 w-4", carregando && "animate-spin")} />
            Atualizar
          </Botao>
          {estado?.fechada ? (
            <Botao
              variant="danger"
              disabled={!estado.podeReabrir}
              title={estado.podeReabrir ? undefined : "Exige papel financeiro ou administrador."}
              onClick={() => setReabrirAberto(true)}
            >
              <Unlock className="h-4 w-4" />
              Reabrir competência
            </Botao>
          ) : (
            <Botao
              variant="primary"
              disabled={!estado?.podeFechar}
              title={estado?.podeFechar ? undefined : "Exige papel financeiro ou administrador."}
              onClick={() => setFecharAberto(true)}
            >
              <Lock className="h-4 w-4" />
              Fechar competência
            </Botao>
          )}
        </div>
      </div>

      {erro ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[13px]">
          <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <b className="text-amber-600 dark:text-amber-400">Fechamento indisponível.</b> {erro}
          </div>
        </div>
      ) : null}

      {carregando && !estado ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-5 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Carregando estado do fechamento…
        </div>
      ) : null}

      {estado?.fechada ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="min-w-0 text-[13px]">
            <b className="text-emerald-600 dark:text-emerald-400">
              Competência fechada — oficial v{estado.versao}
            </b>
            <div className="text-muted-foreground">
              Fechada em {estado.fechadaEm ? formatarDataHora(estado.fechadaEm) : "—"} ·{" "}
              <span className="font-mono text-[11px]">
                snapshot {estado.snapshotHash?.slice(0, 12)}…
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {divergencia?.divergente ? (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <b className="text-amber-600 dark:text-amber-400">{divergencia.aviso}</b>
              <ul className="mt-2 grid list-none gap-1 p-0 text-[12.5px] text-foreground/85">
                {divergencia.itens.map((i) => (
                  <li key={i.chave} className="font-mono text-[11.5px]">
                    {i.chave}: {i.snapshot.valor == null ? "—" : BRL.format(i.snapshot.valor)} →{" "}
                    {i.atual.valor == null ? "—" : BRL.format(i.atual.valor)}
                    {i.delta != null ? ` (${i.delta > 0 ? "+" : ""}${BRL.format(i.delta)})` : ""}
                  </li>
                ))}
              </ul>
              <Botao
                size="sm"
                className="mt-3"
                disabled={registrando}
                onClick={() => void registrarDivergencia()}
              >
                {registrando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Registrar divergência na trilha
              </Botao>
            </div>
          </div>
        </div>
      ) : null}

      <HistoricoVersoes
        competencia={compCodigo}
        pacotes={estado?.pacotes ?? []}
        onErro={setErro}
      />

      {fecharAberto ? (
        <FecharModal
          competencia={compCodigo}
          pendencias={pendencias}
          onCancelar={() => setFecharAberto(false)}
          onFechado={() => {
            setFecharAberto(false)
            void carregar()
          }}
        />
      ) : null}

      {reabrirAberto ? (
        <ReabrirModal
          competencia={compCodigo}
          versao={estado?.versao ?? 1}
          onCancelar={() => setReabrirAberto(false)}
          onReaberto={() => {
            setReabrirAberto(false)
            void carregar()
          }}
        />
      ) : null}
    </>
  )
}

/* ─────────────────────────── histórico de versões ─────────────────────────── */

function HistoricoVersoes({
  competencia,
  pacotes,
  onErro,
}: {
  competencia: string
  pacotes: PacoteVersao[]
  onErro: (m: string) => void
}) {
  const [baixando, setBaixando] = useState<number | null>(null)
  const [comparando, setComparando] = useState(false)
  const [diff, setDiff] = useState<{
    de: { versao: number }
    para: { versao: number }
    resumo: { adicionados: number; removidos: number; alterados: number; inalterados: number; identicos: boolean }
    alterados: { caminho: string; deltaBytes: number }[]
    adicionados: { caminho: string }[]
    removidos: { caminho: string }[]
  } | null>(null)

  const baixar = async (versao: number) => {
    setBaixando(versao)
    try {
      const res = await fetch("/api/contador/pacote/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ competencia, versao }),
      })
      if (!res.ok) {
        onErro(await lerErroResposta(res))
        return
      }
      const j = (await res.json()) as { url: string }
      // Download direto pela URL assinada de curta duração (nunca persistida).
      const a = document.createElement("a")
      a.href = j.url
      a.rel = "noopener"
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      onErro("Não foi possível autorizar o download agora.")
    } finally {
      setBaixando(null)
    }
  }

  const comparar = async () => {
    if (pacotes.length < 2) return
    setComparando(true)
    try {
      const de = pacotes[pacotes.length - 2].versao
      const para = pacotes[pacotes.length - 1].versao
      const res = await fetch(
        `/api/contador/pacote/comparar?c=${encodeURIComponent(competencia)}&de=${de}&para=${para}`,
        { cache: "no-store" },
      )
      if (!res.ok) {
        onErro(await lerErroResposta(res))
        return
      }
      setDiff(await res.json())
    } catch {
      onErro("Não foi possível comparar as versões agora.")
    } finally {
      setComparando(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
          <History className="h-4 w-4 text-muted-foreground" />
          Versões oficiais do pacote
        </h3>
        {pacotes.length >= 2 ? (
          <Botao size="sm" onClick={() => void comparar()} disabled={comparando}>
            {comparando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Comparar as duas últimas
          </Botao>
        ) : null}
      </div>

      {pacotes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-4 text-[12.5px] text-muted-foreground">
          Nenhuma versão oficial ainda. A v1 nasce no primeiro fechamento desta competência.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Versão</th>
                <th className="px-3 py-2 font-semibold">Gerada em</th>
                <th className="px-3 py-2 font-semibold">Tamanho</th>
                <th className="px-3 py-2 font-semibold">Manifesto</th>
                <th className="px-3 py-2 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {pacotes.map((p) => (
                <tr key={p.versao} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-semibold text-foreground">v{p.versao}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatarDataHora(p.geradoEm)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{formatBytes(p.bytes)}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {p.manifestoHash.slice(0, 12)}…
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Botao size="sm" disabled={baixando === p.versao} onClick={() => void baixar(p.versao)}>
                      {baixando === p.versao ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      Baixar
                    </Botao>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {diff ? (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-[12.5px]">
          <b className="text-foreground">
            v{diff.de.versao} → v{diff.para.versao}
          </b>{" "}
          {diff.resumo.identicos ? (
            <span className="text-muted-foreground">— conteúdo idêntico.</span>
          ) : (
            <span className="text-muted-foreground">
              — {diff.resumo.alterados} alterado(s), {diff.resumo.adicionados} adicionado(s),{" "}
              {diff.resumo.removidos} removido(s), {diff.resumo.inalterados} inalterado(s).
            </span>
          )}
          <ul className="mt-2 grid list-none gap-0.5 p-0 font-mono text-[11px] text-foreground/80">
            {diff.alterados.map((a) => (
              <li key={a.caminho}>~ {a.caminho}</li>
            ))}
            {diff.adicionados.map((a) => (
              <li key={a.caminho}>+ {a.caminho}</li>
            ))}
            {diff.removidos.map((a) => (
              <li key={a.caminho}>− {a.caminho}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/* ─────────────────────────── modal de fechamento ─────────────────────────── */

/**
 * Fechar exige DUAS provas de intenção: assumir cada pendência do checklist e digitar
 * o código da competência. O servidor revalida as duas — o modal não é a barreira.
 */
function FecharModal({
  competencia,
  pendencias,
  onCancelar,
  onFechado,
}: {
  competencia: string
  pendencias: readonly { id: string; titulo: string; estado: string }[]
  onCancelar: () => void
  onFechado: () => void
}) {
  const [assumidas, setAssumidas] = useState<string[]>([])
  const [confirmacao, setConfirmacao] = useState("")
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const todasAssumidas = pendencias.every((p) => assumidas.includes(p.id))
  const confirmado = confirmacao.trim() === competencia
  const pronto = todasAssumidas && confirmado && !ocupado

  const alternar = (id: string) =>
    setAssumidas((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))

  const fechar = async () => {
    setOcupado(true)
    setErro(null)
    try {
      const res = await fetch("/api/contador/fechamento", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ competencia, confirmacao: confirmacao.trim(), pendenciasAssumidas: assumidas }),
      })
      if (!res.ok) throw new Error(await lerErroResposta(res))
      onFechado()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao fechar a competência.")
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Overlay onClose={ocupado ? undefined : onCancelar}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl">
        <h3 className="mb-1 text-[16px] font-bold text-foreground">Fechar {competencia}</h3>
        <p className="mb-3 text-[12.5px] text-muted-foreground">
          O fechamento gera um snapshot imutável e a versão oficial do pacote, e congela
          documentos, status e comentários desta competência. Reabrir depois exige motivo
          e fica registrado na trilha.
        </p>

        {pendencias.length > 0 ? (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <b className="text-[12.5px] text-amber-600 dark:text-amber-400">
              Pendências que serão assumidas ({pendencias.length})
            </b>
            <ul className="mt-2 grid list-none gap-1.5 p-0">
              {pendencias.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-start gap-2 text-[12.5px] text-foreground/90">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={assumidas.includes(p.id)}
                      disabled={ocupado}
                      onChange={() => alternar(p.id)}
                    />
                    <span>
                      {p.titulo}{" "}
                      <span className="font-mono text-[11px] text-muted-foreground">({p.estado})</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-600 dark:text-emerald-400">
            Nenhuma pendência no checklist desta competência.
          </p>
        )}

        <label className="mb-1 block text-xs font-semibold text-foreground/80" htmlFor="confirmar-fechamento">
          Digite <b className="font-mono text-foreground">{competencia}</b> para confirmar
        </label>
        <input
          id="confirmar-fechamento"
          value={confirmacao}
          disabled={ocupado}
          onChange={(e) => setConfirmacao(e.target.value)}
          placeholder={competencia}
          className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-[13px] text-foreground outline-none focus:border-primary focus:bg-card"
        />

        {erro ? (
          <p className="mt-3 flex items-start gap-2 text-[12px] leading-snug text-rose-500">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {erro}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2.5">
          <Botao onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </Botao>
          <Botao
            variant="primary"
            disabled={!pronto}
            title={
              !todasAssumidas
                ? "Assuma todas as pendências para continuar."
                : !confirmado
                  ? `Digite ${competencia} para confirmar.`
                  : undefined
            }
            onClick={() => void fechar()}
          >
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Fechar competência
          </Botao>
        </div>
      </div>
    </Overlay>
  )
}

/* ─────────────────────────── modal de reabertura ─────────────────────────── */

function ReabrirModal({
  competencia,
  versao,
  onCancelar,
  onReaberto,
}: {
  competencia: string
  versao: number
  onCancelar: () => void
  onReaberto: () => void
}) {
  const [motivo, setMotivo] = useState("")
  const [confirmacao, setConfirmacao] = useState("")
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const pronto = motivo.trim().length > 0 && confirmacao.trim() === competencia && !ocupado

  const reabrir = async () => {
    setOcupado(true)
    setErro(null)
    try {
      const res = await fetch("/api/contador/fechamento/reabrir", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ competencia, confirmacao: confirmacao.trim(), motivo: motivo.trim() }),
      })
      if (!res.ok) throw new Error(await lerErroResposta(res))
      onReaberto()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao reabrir a competência.")
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Overlay onClose={ocupado ? undefined : onCancelar}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl">
        <h3 className="mb-1 text-[16px] font-bold text-foreground">Reabrir {competencia}</h3>
        <p className="mb-3 text-[12.5px] text-muted-foreground">
          A competência volta para <b className="text-foreground">aberta</b> e passa para a
          versão <b className="text-foreground">v{versao + 1}</b>. O pacote v{versao} e o
          snapshot atual são preservados. O motivo fica registrado como comentário interno
          imutável.
        </p>

        <label className="mb-1 block text-xs font-semibold text-foreground/80" htmlFor="motivo-reabertura">
          Motivo da reabertura (obrigatório)
        </label>
        <textarea
          id="motivo-reabertura"
          rows={3}
          value={motivo}
          disabled={ocupado}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: nota de compra de junho chegou depois do fechamento."
          className="w-full resize-y rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] text-foreground outline-none focus:border-rose-500 focus:bg-card"
        />

        <label className="mb-1 mt-3 block text-xs font-semibold text-foreground/80" htmlFor="confirmar-reabertura">
          Digite <b className="font-mono text-foreground">{competencia}</b> para confirmar
        </label>
        <input
          id="confirmar-reabertura"
          value={confirmacao}
          disabled={ocupado}
          onChange={(e) => setConfirmacao(e.target.value)}
          placeholder={competencia}
          className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-[13px] text-foreground outline-none focus:border-rose-500 focus:bg-card"
        />

        {erro ? (
          <p className="mt-3 flex items-start gap-2 text-[12px] leading-snug text-rose-500">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {erro}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2.5">
          <Botao onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </Botao>
          <Botao variant="danger" disabled={!pronto} onClick={() => void reabrir()}>
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
            Reabrir competência
          </Botao>
        </div>
      </div>
    </Overlay>
  )
}
