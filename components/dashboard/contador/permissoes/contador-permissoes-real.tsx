"use client"

/**
 * Contador HUB · seção Permissões REAL (GOAL 014).
 *
 * Substitui o preview (`renderPermissoes` mockado) pela gestão real da identidade
 * EXTERNA do contador, consumindo apenas as APIs internas já existentes:
 *  - POST/GET `/api/contador-externo/convites` (+ revogar);
 *  - GET `/api/contador-externo/acessos` (+ suspender/reativar/revogar vínculo);
 *  - POST `/api/contador-externo/usuarios/[id]/suspender|reativar` (ação ELEVADA
 *    sobre a identidade inteira — exige confirmação explícita; afeta todas as
 *    lojas do contador, por isso o aviso destaca o impacto).
 *
 * NENHUMA lógica de autorização no client: a loja é a ativa da sessão interna e a
 * API devolve 403 quando falta `podeGerenciarAcessoExterno` — aqui isso vira um
 * aviso honesto somente-leitura, sem quebrar a tela. O token/URL do convite é
 * exibido UMA única vez (a resposta da criação); depois disso nem a listagem o
 * conhece (sem `tokenHash`).
 */
import { useCallback, useEffect, useRef, useState } from "react"
import {
  AlertTriangle,
  Check,
  Copy,
  Info,
  Link2,
  Loader2,
  MailPlus,
  MousePointerClick,
  RefreshCw,
  ShieldAlert,
  UserCheck,
  UserX,
} from "lucide-react"
import {
  copiarLinkConvite,
  mensagemDeCopia,
  MENSAGEM_SELECAO,
  MENSAGEM_SEM_SELECAO,
} from "@/lib/contador/auth-externa/copiar-link-convite"
import { cn } from "@/lib/utils"
import { Botao, Overlay, formatarDataHora, lerErroResposta } from "../contador-ui"

/* ─────────────────────────── DTOs das APIs (JSON) ─────────────────────────── */

type PapelExterno = "LEITURA" | "CONFERENCIA"
type StatusAcesso = "ATIVO" | "SUSPENSO" | "REVOGADO"

type ConviteDto = {
  id: string
  email: string
  papel: PapelExterno
  expiraEm: string
  usadoEm: string | null
  revogadoEm: string | null
  criadoPorId: string
  createdAt: string
}

type AcessoDto = {
  id: string
  usuarioId: string
  papel: PapelExterno
  status: StatusAcesso
  concedidoEm: string
  suspensoEm: string | null
  revogadoEm: string | null
  usuario: { id: string; email: string; nome: string; status: "ATIVO" | "SUSPENSO" } | null
}

type EstadoConvite = "pendente" | "expirado" | "usado" | "revogado"

function estadoConvite(c: ConviteDto, agoraMs: number): EstadoConvite {
  if (c.usadoEm) return "usado"
  if (c.revogadoEm) return "revogado"
  if (new Date(c.expiraEm).getTime() <= agoraMs) return "expirado"
  return "pendente"
}

/* ─────────────────────────── chips (mesma paleta do HUB) ─────────────────────────── */

const CHIP: Record<string, string> = {
  pendente: "border-sky-500/30 bg-sky-500/10 text-sky-500",
  expirado: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  usado: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  revogado: "border-border bg-muted text-muted-foreground",
  ATIVO: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  SUSPENSO: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  REVOGADO: "border-border bg-muted text-muted-foreground",
}

function ChipEstado({ rotulo }: { rotulo: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold",
        CHIP[rotulo] ?? CHIP.revogado,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {rotulo.toLowerCase()}
    </span>
  )
}

const PAPEL_ROTULO: Record<PapelExterno, string> = {
  LEITURA: "leitura",
  CONFERENCIA: "conferência",
}

/* ─────────────────────────── seção real ─────────────────────────── */

export function ContadorPermissoesReal() {
  const [convites, setConvites] = useState<ConviteDto[]>([])
  const [acessos, setAcessos] = useState<AcessoDto[]>([])
  const [carregando, setCarregando] = useState(true)
  const [semPermissao, setSemPermissao] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [email, setEmail] = useState("")
  const [papel, setPapel] = useState<PapelExterno>("LEITURA")
  const [enviando, setEnviando] = useState(false)
  const [erroConvite, setErroConvite] = useState<string | null>(null)
  const [linkRevelado, setLinkRevelado] = useState<{ url: string } | null>(null)
  const [copiado, setCopiado] = useState(false)
  /** Aviso do fallback de cópia. Não é erro — por isso não usa `erroConvite`. */
  const [avisoCopia, setAvisoCopia] = useState<string | null>(null)
  /** O campo do link: precisa ser selecionável quando o clipboard falha. */
  const campoLinkRef = useRef<HTMLInputElement | null>(null)

  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null)
  const [confirmacaoIdentidade, setConfirmacaoIdentidade] = useState<{
    acesso: AcessoDto
    acao: "suspender" | "reativar"
  } | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const [resConvites, resAcessos] = await Promise.all([
        fetch("/api/contador-externo/convites", { cache: "no-store" }),
        fetch("/api/contador-externo/acessos", { cache: "no-store" }),
      ])
      if (resConvites.status === 403 || resAcessos.status === 403) {
        // A API nega sem `podeGerenciarAcessoExterno` — aviso honesto, tela intacta.
        setSemPermissao(true)
        setConvites([])
        setAcessos([])
        return
      }
      setSemPermissao(false)
      if (!resConvites.ok || !resAcessos.ok) {
        setErro(await lerErroResposta(!resConvites.ok ? resConvites : resAcessos))
        setConvites([])
        setAcessos([])
        return
      }
      const jConvites = (await resConvites.json()) as { convites: ConviteDto[] }
      const jAcessos = (await resAcessos.json()) as { acessos: AcessoDto[] }
      setConvites(Array.isArray(jConvites.convites) ? jConvites.convites : [])
      setAcessos(Array.isArray(jAcessos.acessos) ? jAcessos.acessos : [])
    } catch {
      setErro("Não foi possível carregar convites e acessos agora.")
      setConvites([])
      setAcessos([])
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const gerarConvite = async () => {
    setErroConvite(null)
    setLinkRevelado(null)
    setAvisoCopia(null)
    setEnviando(true)
    try {
      const res = await fetch("/api/contador-externo/convites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, papel }),
      })
      if (!res.ok) {
        setErroConvite(await lerErroResposta(res))
        return
      }
      const j = (await res.json()) as { url: string }
      // URL+token exibidos UMA única vez — nem a listagem conhece o token (sem hash).
      setLinkRevelado({ url: j.url })
      setEmail("")
      setPapel("LEITURA")
      await carregar()
    } catch {
      setErroConvite("Falha de rede ao gerar o convite. Tente novamente.")
    } finally {
      setEnviando(false)
    }
  }

  /** Seleciona a URL inteira no campo. `false` quando o campo não está montado. */
  const selecionarCampoLink = useCallback(() => {
    const campo = campoLinkRef.current
    if (!campo) return false
    campo.focus()
    campo.setSelectionRange(0, campo.value.length)
    return true
  }, [])

  const copiarLink = async () => {
    if (!linkRevelado) return
    const escreverClipboard =
      typeof navigator !== "undefined" && navigator.clipboard
        ? (texto: string) => navigator.clipboard.writeText(texto)
        : null

    const resultado = await copiarLinkConvite({
      url: linkRevelado.url,
      escreverClipboard,
      selecionarCampo: selecionarCampoLink,
    })

    setAvisoCopia(mensagemDeCopia(resultado))
    if (resultado.modo === "clipboard") {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    }
  }

  const executarAcao = async (chave: string, url: string) => {
    setAcaoEmCurso(chave)
    setErro(null)
    try {
      const res = await fetch(url, { method: "POST" })
      if (!res.ok) {
        setErro(await lerErroResposta(res))
        return
      }
      await carregar()
    } catch {
      setErro("Falha de rede ao concluir a ação. Verifique e tente novamente.")
    } finally {
      setAcaoEmCurso(null)
    }
  }

  const confirmarAcaoIdentidade = async () => {
    if (!confirmacaoIdentidade) return
    const { acesso, acao } = confirmacaoIdentidade
    setConfirmacaoIdentidade(null)
    await executarAcao(
      `identidade-${acao}-${acesso.usuarioId}`,
      `/api/contador-externo/usuarios/${encodeURIComponent(acesso.usuarioId)}/${acao}`,
    )
  }

  const agoraMs = Date.now()

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-foreground">Permissões & acesso externo</h2>
          <p className="mt-1 max-w-[64ch] text-[13px] text-muted-foreground">
            Convites e vínculos do portal externo do contador desta loja. O convite é um link
            copiável de uso único (válido por 72h); o contador só enxerga as empresas com
            vínculo ativo — nunca dados de outra loja.
          </p>
        </div>
        <Botao size="sm" onClick={() => void carregar()} disabled={carregando}>
          <RefreshCw className={cn("h-4 w-4", carregando && "animate-spin")} />
          Atualizar
        </Botao>
      </div>

      {semPermissao ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[13px] text-foreground">
          <ShieldAlert className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <b className="text-amber-600 dark:text-amber-400">Somente leitura para o seu papel.</b>{" "}
            Gerenciar convites e acessos do contador exige papel financeiro ou administrador.
            Se você precisa desta permissão, fale com o administrador da loja.
          </div>
        </div>
      ) : null}

      {erro ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[13px] text-foreground">
          <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <b className="text-amber-600 dark:text-amber-400">Ação não concluída.</b> {erro}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── gerar convite ── */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-foreground">
            <MailPlus className="h-4.5 w-4.5 text-primary" />
            Convidar contador
          </h3>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void gerarConvite()
            }}
            className="space-y-3"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="convite-email" className="text-xs font-semibold text-foreground/80">
                E-mail do contador
              </label>
              <input
                id="convite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contato@escritorio.com.br"
                className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-primary focus:bg-card"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="convite-papel" className="text-xs font-semibold text-foreground/80">
                Papel no portal externo
              </label>
              <select
                id="convite-papel"
                value={papel}
                onChange={(e) => setPapel(e.target.value === "CONFERENCIA" ? "CONFERENCIA" : "LEITURA")}
                className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-primary focus:bg-card"
              >
                <option value="LEITURA">Leitura (padrão)</option>
                <option value="CONFERENCIA">Conferência (escolha explícita)</option>
              </select>
            </div>
            {erroConvite ? <p className="text-[13px] text-rose-500">{erroConvite}</p> : null}
            <Botao
              variant="primary"
              className="w-full"
              disabled={enviando || semPermissao || !email.trim()}
              onClick={() => void gerarConvite()}
            >
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Gerar link de convite
            </Botao>
          </form>

          {linkRevelado ? (
            <div className="mt-4 space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <div className="flex items-start gap-2.5 text-xs text-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>
                  <b>Convite criado — este link é mostrado uma única vez.</b> Copie e envie ao
                  contador pelo canal de vocês. Vale por 72h e só pode ser usado uma vez.
                </span>
              </div>
              {/*
                Campo de verdade, não `<code truncate>`: o valor carrega a URL
                COMPLETA e o usuário consegue selecioná-la — com Ctrl+A dentro do
                campo, com o clique, ou pelo botão de fallback. Rola na horizontal
                em vez de estourar o card.
              */}
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <input
                  ref={campoLinkRef}
                  readOnly
                  value={linkRevelado.url}
                  aria-label="Link do convite do contador"
                  spellCheck={false}
                  onFocus={(e) => e.currentTarget.select()}
                  onClick={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-card px-2.5 py-2 font-mono text-[11.5px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Botao size="sm" onClick={() => void copiarLink()}>
                  {copiado ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  {copiado ? "Copiado" : "Copiar"}
                </Botao>
                <Botao
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAvisoCopia(selecionarCampoLink() ? MENSAGEM_SELECAO : MENSAGEM_SEM_SELECAO)
                  }}
                >
                  <MousePointerClick className="h-4 w-4" />
                  Selecionar link
                </Botao>
              </div>
              {avisoCopia ? (
                <p className="text-[11.5px] font-medium text-foreground">{avisoCopia}</p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
            Se já existir um convite aberto para o mesmo e-mail nesta loja, ele é revogado
            automaticamente ao gerar o novo.
          </div>
        </div>

        {/* ── convites ── */}
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-[15px] font-semibold text-foreground">Convites desta loja</h3>
          </div>
          <div className="px-4 py-1.5">
            {carregando ? (
              <div className="grid place-items-center gap-2 px-4 py-10 text-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <div className="text-[13px] text-muted-foreground">Carregando convites…</div>
              </div>
            ) : convites.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted-foreground">
                Nenhum convite gerado ainda. Use o formulário ao lado para criar o primeiro.
              </p>
            ) : (
              convites.map((c, i) => {
                const estado = estadoConvite(c, agoraMs)
                const revogavel = estado === "pendente" || estado === "expirado"
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "flex items-center justify-between gap-3.5 py-3",
                      i < convites.length - 1 && "border-b border-border/60",
                    )}
                  >
                    <div className="min-w-0">
                      <b className="block truncate text-[13.5px] font-semibold text-foreground">{c.email}</b>
                      <small className="block text-[11.5px] text-muted-foreground">
                        {PAPEL_ROTULO[c.papel]} · criado em {formatarDataHora(c.createdAt)} · expira em{" "}
                        {formatarDataHora(c.expiraEm)}
                      </small>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <ChipEstado rotulo={estado} />
                      {revogavel ? (
                        <Botao
                          size="sm"
                          variant="danger"
                          disabled={semPermissao || acaoEmCurso !== null}
                          onClick={() =>
                            void executarAcao(
                              `convite-${c.id}`,
                              `/api/contador-externo/convites/${encodeURIComponent(c.id)}/revogar`,
                            )
                          }
                        >
                          {acaoEmCurso === `convite-${c.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          Revogar
                        </Botao>
                      ) : null}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* ── acessos (vínculos) ── */}
      <div className="mt-4 rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-[15px] font-semibold text-foreground">Acessos vinculados a esta loja</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Suspender ou revogar o vínculo bloqueia esta loja para o contador na próxima
            requisição; as demais lojas dele não são afetadas.
          </p>
        </div>
        <div className="px-4 py-1.5">
          {carregando ? (
            <div className="grid place-items-center gap-2 px-4 py-10 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div className="text-[13px] text-muted-foreground">Carregando acessos…</div>
            </div>
          ) : acessos.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">
              Nenhum contador vinculado a esta loja ainda. O vínculo nasce quando o contador
              aceita um convite.
            </p>
          ) : (
            acessos.map((a, i) => {
              const chaveBase = `acesso-${a.id}`
              return (
                <div
                  key={a.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3.5 py-3",
                    i < acessos.length - 1 && "border-b border-border/60",
                  )}
                >
                  <div className="min-w-0">
                    <b className="block truncate text-[13.5px] font-semibold text-foreground">
                      {a.usuario?.nome ?? "Usuário externo"}
                    </b>
                    <small className="block text-[11.5px] text-muted-foreground">
                      <span className="font-mono">{a.usuario?.email ?? a.usuarioId}</span> ·{" "}
                      {PAPEL_ROTULO[a.papel]} · desde {formatarDataHora(a.concedidoEm)}
                      {a.usuario?.status === "SUSPENSO" ? " · identidade suspensa" : ""}
                    </small>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <ChipEstado rotulo={a.status} />
                    {a.status === "ATIVO" ? (
                      <Botao
                        size="sm"
                        disabled={semPermissao || acaoEmCurso !== null}
                        onClick={() =>
                          void executarAcao(
                            `${chaveBase}-suspender`,
                            `/api/contador-externo/acessos/${encodeURIComponent(a.id)}/suspender`,
                          )
                        }
                      >
                        {acaoEmCurso === `${chaveBase}-suspender` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        Suspender
                      </Botao>
                    ) : null}
                    {a.status === "SUSPENSO" ? (
                      <Botao
                        size="sm"
                        disabled={semPermissao || acaoEmCurso !== null}
                        onClick={() =>
                          void executarAcao(
                            `${chaveBase}-reativar`,
                            `/api/contador-externo/acessos/${encodeURIComponent(a.id)}/reativar`,
                          )
                        }
                      >
                        {acaoEmCurso === `${chaveBase}-reativar` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        Reativar
                      </Botao>
                    ) : null}
                    {a.status !== "REVOGADO" ? (
                      <Botao
                        size="sm"
                        variant="danger"
                        disabled={semPermissao || acaoEmCurso !== null}
                        onClick={() =>
                          void executarAcao(
                            `${chaveBase}-revogar`,
                            `/api/contador-externo/acessos/${encodeURIComponent(a.id)}/revogar`,
                          )
                        }
                      >
                        {acaoEmCurso === `${chaveBase}-revogar` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        Revogar
                      </Botao>
                    ) : null}
                    {a.usuario?.status === "ATIVO" ? (
                      <Botao
                        size="sm"
                        variant="danger"
                        disabled={semPermissao || acaoEmCurso !== null}
                        title="Ação elevada: suspende a identidade inteira, em todas as lojas."
                        onClick={() => setConfirmacaoIdentidade({ acesso: a, acao: "suspender" })}
                      >
                        <UserX className="h-4 w-4" />
                        Suspender identidade
                      </Botao>
                    ) : (
                      <Botao
                        size="sm"
                        disabled={semPermissao || acaoEmCurso !== null}
                        title="Ação elevada: reativa a identidade inteira (vínculos continuam no estado em que estão)."
                        onClick={() => setConfirmacaoIdentidade({ acesso: a, acao: "reativar" })}
                      >
                        <UserCheck className="h-4 w-4" />
                        Reativar identidade
                      </Botao>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── confirmação explícita da ação elevada ── */}
      {confirmacaoIdentidade ? (
        <Overlay onClose={() => setConfirmacaoIdentidade(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
              <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              {confirmacaoIdentidade.acao === "suspender"
                ? "Suspender a identidade inteira?"
                : "Reativar a identidade inteira?"}
            </h3>
            <p className="mt-2 text-[13px] text-muted-foreground">
              {confirmacaoIdentidade.acao === "suspender" ? (
                <>
                  Esta é uma <b className="text-foreground">ação elevada</b>: a conta de{" "}
                  <b className="text-foreground">
                    {confirmacaoIdentidade.acesso.usuario?.nome ?? "este contador"}
                  </b>{" "}
                  será suspensa em <b className="text-foreground">todas as lojas</b> que ela
                  atende (não apenas esta), todas as sessões abertas serão encerradas na hora e
                  o login será bloqueado até a reativação. A ação fica registrada na trilha com
                  esta loja como origem.
                </>
              ) : (
                <>
                  A conta de{" "}
                  <b className="text-foreground">
                    {confirmacaoIdentidade.acesso.usuario?.nome ?? "este contador"}
                  </b>{" "}
                  voltará a poder fazer login. Os vínculos com cada loja permanecem no estado em
                  que estão (suspensos/revogados não são reabertos automaticamente). A ação fica
                  registrada na trilha com esta loja como origem.
                </>
              )}
            </p>
            <div className="mt-4 flex justify-end gap-2.5">
              <Botao onClick={() => setConfirmacaoIdentidade(null)}>Cancelar</Botao>
              <Botao
                variant={confirmacaoIdentidade.acao === "suspender" ? "danger" : "primary"}
                onClick={() => void confirmarAcaoIdentidade()}
              >
                {confirmacaoIdentidade.acao === "suspender"
                  ? "Sim, suspender identidade"
                  : "Sim, reativar identidade"}
              </Botao>
            </div>
          </div>
        </Overlay>
      ) : null}
    </>
  )
}
