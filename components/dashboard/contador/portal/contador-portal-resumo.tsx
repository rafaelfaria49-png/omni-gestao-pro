"use client"

/**
 * Contador HUB · resumo REAL do acesso externo (GOAL 023).
 *
 * Substitui o cartão de escritório contábil fictício do preview por leitura dos
 * mesmos contratos que a aba Permissões já consome (GOAL 014):
 *  - `GET /api/contador-externo/acessos`  — vínculos contador ↔ loja ativa;
 *  - `GET /api/contador-externo/convites` — convites emitidos pela loja ativa.
 *
 * Somente leitura: nenhuma ação de suspender/reativar/revogar/convidar vive
 * aqui — isso continua em Permissões, e o botão apenas navega até lá. As APIs
 * negam com 403 sem `podeGerenciarAcessoExterno`; nesse caso a tela diz isso em
 * vez de mostrar "nenhum contador" (ausência de permissão ≠ ausência de acesso).
 */
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { Botao, formatarDataHora, lerErroResposta } from "../contador-ui"

type PapelExterno = "LEITURA" | "CONFERENCIA"
type StatusAcesso = "ATIVO" | "SUSPENSO" | "REVOGADO"

type ConviteDto = {
  id: string
  email: string
  papel: PapelExterno
  expiraEm: string
  usadoEm: string | null
  revogadoEm: string | null
}

type AcessoDto = {
  id: string
  usuarioId: string
  papel: PapelExterno
  status: StatusAcesso
  concedidoEm: string
  usuario: { id: string; email: string; nome: string; status: "ATIVO" | "SUSPENSO" } | null
}

const PAPEL_ROTULO: Record<PapelExterno, string> = {
  LEITURA: "leitura",
  CONFERENCIA: "conferência",
}

/** Convite ainda utilizável: não usado, não revogado e dentro da validade. */
function convitePendente(c: ConviteDto, agoraMs: number): boolean {
  return !c.usadoEm && !c.revogadoEm && new Date(c.expiraEm).getTime() > agoraMs
}

function Metrica({ label, valor, tom }: { label: string; valor: number; tom?: "ativo" | "atencao" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-2xl font-semibold leading-none tracking-tight",
          tom === "ativo" && valor > 0 && "text-emerald-600 dark:text-emerald-400",
          tom === "atencao" && valor > 0 && "text-amber-600 dark:text-amber-400",
          !tom && "text-foreground",
        )}
      >
        {valor}
      </span>
    </div>
  )
}

export function ContadorPortalResumo({
  onGerenciar,
}: {
  /** Navega até a aba Permissões. `null` quando ela não está visível (Modo contador). */
  onGerenciar: (() => void) | null
}) {
  const [acessos, setAcessos] = useState<AcessoDto[]>([])
  const [convites, setConvites] = useState<ConviteDto[]>([])
  const [carregando, setCarregando] = useState(true)
  const [semPermissao, setSemPermissao] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const [resAcessos, resConvites] = await Promise.all([
        fetch("/api/contador-externo/acessos", { cache: "no-store" }),
        fetch("/api/contador-externo/convites", { cache: "no-store" }),
      ])
      if (resAcessos.status === 403 || resConvites.status === 403) {
        setSemPermissao(true)
        setAcessos([])
        setConvites([])
        return
      }
      setSemPermissao(false)
      if (!resAcessos.ok || !resConvites.ok) {
        setErro(await lerErroResposta(!resAcessos.ok ? resAcessos : resConvites))
        setAcessos([])
        setConvites([])
        return
      }
      const jAcessos = (await resAcessos.json()) as { acessos: AcessoDto[] }
      const jConvites = (await resConvites.json()) as { convites: ConviteDto[] }
      setAcessos(Array.isArray(jAcessos.acessos) ? jAcessos.acessos : [])
      setConvites(Array.isArray(jConvites.convites) ? jConvites.convites : [])
    } catch {
      setErro("Não foi possível carregar o acesso externo desta loja agora.")
      setAcessos([])
      setConvites([])
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const agoraMs = Date.now()
  const ativos = acessos.filter((a) => a.status === "ATIVO")
  const suspensos = acessos.filter((a) => a.status === "SUSPENSO")
  const revogados = acessos.filter((a) => a.status === "REVOGADO")
  const pendentes = convites.filter((c) => convitePendente(c, agoraMs))

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <h3 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-foreground">
          <Users className="h-4 w-4 text-primary" />
          Quem tem acesso a esta loja
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Botao size="sm" onClick={() => void carregar()} disabled={carregando}>
            <RefreshCw className={cn("h-4 w-4", carregando && "animate-spin")} />
            Atualizar
          </Botao>
          {onGerenciar ? (
            <Botao size="sm" variant="ghost" onClick={onGerenciar}>
              Gerenciar em Permissões
            </Botao>
          ) : null}
        </div>
      </div>

      {carregando ? (
        <div className="grid place-items-center gap-2 px-6 py-10 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div className="text-[13px] text-muted-foreground">Carregando acesso externo…</div>
        </div>
      ) : semPermissao ? (
        <div className="flex items-start gap-3 p-4 text-[13px] text-foreground">
          <ShieldAlert className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <b className="text-amber-600 dark:text-amber-400">Visível apenas para quem gerencia acesso.</b>{" "}
            Sua conta não tem permissão para consultar convites e vínculos do contador. Isso não
            significa que a loja esteja sem contador — significa que este dado não é seu para ver.
          </div>
        </div>
      ) : erro ? (
        <div className="flex items-start gap-3 p-4 text-[13px] text-foreground">
          <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <b className="text-amber-600 dark:text-amber-400">Acesso externo indisponível.</b> {erro}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <Metrica label="Acessos ativos" valor={ativos.length} tom="ativo" />
            <Metrica label="Convites pendentes" valor={pendentes.length} tom="atencao" />
            <Metrica label="Suspensos" valor={suspensos.length} />
            <Metrica label="Revogados" valor={revogados.length} />
          </div>

          {ativos.length === 0 ? (
            <div className="border-t border-border/60 px-4 py-6 text-center">
              <div className="text-[14px] font-semibold text-foreground">
                Nenhum contador com vínculo ativo nesta loja
              </div>
              <p className="mx-auto mt-1 max-w-[52ch] text-[13px] text-muted-foreground">
                {pendentes.length > 0
                  ? `Há ${pendentes.length} convite(s) ainda dentro da validade — o acesso passa a valer quando o contador aceitar.`
                  : "Gere um convite em Permissões & acesso para liberar o portal externo ao seu contador."}
              </p>
            </div>
          ) : (
            <ul className="border-t border-border/60">
              {ativos.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-[13px] font-bold text-primary">
                    {(a.usuario?.nome || a.usuario?.email || "?").trim().slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-[180px] flex-1">
                    <b className="block truncate text-sm text-foreground">
                      {a.usuario?.nome?.trim() || a.usuario?.email || "Contador sem identificação"}
                    </b>
                    <span className="block truncate font-mono text-[12px] text-muted-foreground">
                      {a.usuario?.email ?? "—"}
                    </span>
                  </div>
                  <span className="whitespace-nowrap rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {PAPEL_ROTULO[a.papel]}
                  </span>
                  <span className="whitespace-nowrap text-[11.5px] text-muted-foreground">
                    desde {formatarDataHora(a.concedidoEm)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="border-t border-border/60 px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
            Papel <b className="text-foreground">leitura</b> baixa pacote e documentos e comenta;
            papel <b className="text-foreground">conferência</b> também marca documento como
            conferido. Nenhum papel externo envia arquivo, fecha competência ou altera dados.
          </p>
        </>
      )}
    </div>
  )
}
