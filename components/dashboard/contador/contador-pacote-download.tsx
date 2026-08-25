"use client"

/**
 * Contador HUB · botão real de download do Pacote do Contador (GOAL 008 · 008B).
 *
 * Download GET DIRETO para o endpoint interno autenticado `GET /api/contador/pacote?c=AAAA-MM`
 * via âncora temporária — não usa requisição assíncrona nem cópia do arquivo em memória
 * (o pacote detalhado pode crescer e não deve ser duplicado no heap do navegador). O request
 * carrega apenas a competência `c`; a loja vem só do escopo do servidor. O endpoint é
 * responsável pelo Content-Disposition.
 *
 * Estado local honesto: “Solicitação de download iniciada.” — nunca afirma “pacote gerado
 * com sucesso”. Não é fechamento oficial. XML autorizado só entra com a leitura fiscal ligada.
 */
import { useCallback, useState } from "react"
import { AlertTriangle, Check, Download, FileArchive } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCompetencia, type Competencia } from "@/lib/contador/competencia"

/** Endpoint interno autenticado do pacote (GET, download direto). */
export const PACOTE_ENDPOINT = "/api/contador/pacote"

export const PACOTE_INDISPONIVEL_TITLE =
  "Disponível quando os dados reais da competência carregam (sessão + loja ativa + permissão financeiro)."

type EstadoDownload = "idle" | "solicitado"

export type UsePacoteDownload = Readonly<{
  estado: EstadoDownload
  iniciar: () => void
}>

/**
 * Hook de download compartilhado (cabeçalho + cartão). Dispara um GET direto via âncora
 * temporária (sem fetch/blob) e mantém apenas um estado local honesto.
 */
export function usePacoteDownload(competencia: Competencia): UsePacoteDownload {
  const [estado, setEstado] = useState<EstadoDownload>("idle")

  const iniciar = useCallback(() => {
    const codigo = formatCompetencia(competencia)
    // Âncora sem `download` para que o filename venha do Content-Disposition do servidor.
    const link = document.createElement("a")
    link.href = `${PACOTE_ENDPOINT}?c=${encodeURIComponent(codigo)}`
    link.rel = "noopener"
    document.body.appendChild(link)
    link.click()
    link.remove()
    setEstado("solicitado")
    window.setTimeout(() => setEstado("idle"), 4000)
  }, [competencia])

  return { estado, iniciar }
}

const INCLUIDO: readonly string[] = [
  "Vendas, itens e devoluções (linha a linha)",
  "Movimentações, contas a receber e a pagar",
  "Sessões e operações de caixa",
  "Resumo, pendências e índice",
  "Manifesto v1 com sha256 de cada arquivo",
]

const NAO_INCLUIDO: readonly string[] = [
  "Notas fiscais (XML) — placeholder honesto se a leitura fiscal estiver off; XML autorizado/HOMOLOGACAO só com CONTADOR_FISCAL_READER=on e loja na allowlist",
  "Documentos anexos — não incluídos diretamente neste pacote",
  "Dados pessoais (nome, documento, contato) — minimizados",
]

export type ContadorPacoteDownloadProps = Readonly<{
  competencia: Competencia
  /** Dados reais disponíveis (escopo ok + leitura). Quando false, o download fica bloqueado. */
  disponivel: boolean
  /** Motivo honesto quando indisponível (escopo/leitura). */
  motivoIndisponivel?: string | null
  /** Estado de download compartilhado (mesmo hook do cabeçalho). */
  download: UsePacoteDownload
}>

/** Cartão premium on-brand do Pacote do Contador com download GET direto. */
export function ContadorPacoteDownload({
  competencia,
  disponivel,
  motivoIndisponivel,
  download,
}: ContadorPacoteDownloadProps) {
  const motivo = motivoIndisponivel?.trim() || PACOTE_INDISPONIVEL_TITLE

  return (
    <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/[0.04] to-transparent p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[17px] font-bold text-foreground">
          <FileArchive className="h-4.5 w-4.5 text-primary" />
          Pacote do Contador
        </h3>
        <span className="rounded-md bg-primary/10 px-2 py-1 font-mono text-[11px] text-primary">
          {formatCompetencia(competencia)}
        </span>
      </div>

      <p className="mb-4 text-[12.5px] leading-relaxed text-muted-foreground">
        Gera um único arquivo <b className="text-foreground">.zip</b> com a leitura real da competência —
        sob demanda, sem armazenar nada. Reflete os dados vivos no momento do download; não é
        fechamento oficial.
      </p>

      <div className="mb-4 grid gap-1.5">
        {INCLUIDO.map((item) => (
          <div key={item} className="flex items-center gap-2.5 text-[12.5px] text-foreground">
            <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            {item}
          </div>
        ))}
        {NAO_INCLUIDO.map((item) => (
          <div key={item} className="flex items-center gap-2.5 text-[12.5px] text-muted-foreground">
            <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border border-dashed border-border" />
            {item}
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled={!disponivel}
        title={disponivel ? undefined : motivo}
        onClick={download.iniciar}
        className={cn(
          "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-primary bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90",
          "disabled:cursor-not-allowed disabled:opacity-40",
        )}
      >
        <Download className="h-4 w-4" />
        Baixar pacote (.zip)
      </button>

      {!disponivel ? (
        <p className="mt-2.5 flex items-start gap-2 text-[11.5px] leading-snug text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          {motivo}
        </p>
      ) : download.estado === "solicitado" ? (
        <p className="mt-2.5 text-[11.5px] leading-snug text-muted-foreground">
          Solicitação de download iniciada. Se o navegador não iniciar o download, verifique bloqueios de pop-up.
        </p>
      ) : null}
    </div>
  )
}
