/**
 * Portal externo read-only — competência: documentos, pacotes, andamento e
 * comentários compartilhados (GOAL 015, fase 3).
 *
 * Server component: escopo revalidado a cada render; leitura direta do domínio
 * read-only (`lib/contador/portal`). As AÇÕES (download, conferir, confirmar
 * recebimento, comentar) ficam em componentes-cliente que chamam as rotas
 * `/api/contador-externo/**` — o mesmo caminho autorizado e já coberto por teste.
 *
 * Nenhum provider do ERP, nenhuma store do dashboard: o portal é uma árvore
 * própria, montada só a partir do escopo externo.
 */
import Link from "next/link"
import { notFound } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { parseCompetencia } from "@/lib/contador/competencia"
import {
  carregarResumoPortal,
  carregarTimelinePortal,
  listarComentariosPortal,
  listarDocumentosPortal,
  listarPacotesPortal,
  carregarDadosPortal,
  repoComentariosPortal,
  repoDocumentosPortal,
  repoFechamentoPortal,
  repoTimelinePortal,
} from "@/lib/contador/portal"
import { ComentarioForm } from "@/components/contador-externo/comentario-form"
import { DocumentoItem } from "@/components/contador-externo/documento-item"
import { PacoteItem } from "@/components/contador-externo/pacote-item"
import { PortalIndisponivel } from "@/components/contador-externo/portal-indisponivel"
import { escopoDaPaginaPortal } from "../../../../_portal-pagina"

export const dynamic = "force-dynamic"
export const revalidate = 0

/** Falha de leitura de UMA seção não derruba a página — vira estado honesto. */
async function tolerante<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p
  } catch {
    return null
  }
}

function dataHora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
}

function tamanho(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function SecaoVazia({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

export default async function CompetenciaPortalPage({
  params,
}: {
  params: Promise<{ loja: string; c: string }>
}) {
  const { loja, c } = await params
  const escopo = await escopoDaPaginaPortal(loja)
  if (!escopo) return <PortalIndisponivel />

  const comp = parseCompetencia(c)
  if (!comp) notFound()

  const [resumo, documentos, pacotes, timeline, comentarios] = await Promise.all([
    tolerante(
      carregarResumoPortal(escopo, comp, {
        repo: repoFechamentoPortal(),
        carregarDados: carregarDadosPortal(),
      }),
    ),
    tolerante(listarDocumentosPortal(escopo, c, {}, { repo: repoDocumentosPortal() })),
    tolerante(listarPacotesPortal(escopo, comp, { repo: repoFechamentoPortal() })),
    tolerante(carregarTimelinePortal(escopo, { competencia: c }, { repo: repoTimelinePortal() })),
    tolerante(listarComentariosPortal(escopo, { competencia: c }, { repo: repoComentariosPortal() })),
  ])

  const podeConferir = escopo.papel === "CONFERENCIA"

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-4 py-10">
      <header className="flex flex-col gap-1">
        <Link
          href={`/contador-externo/lojas/${encodeURIComponent(loja)}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Competências
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Competência {c}</h1>
          {resumo?.selo ? (
            <Badge variant="secondary">{resumo.selo}</Badge>
          ) : (
            <Badge variant="outline">em andamento</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {resumo === null
            ? "Não foi possível carregar o andamento desta competência agora."
            : resumo.fechada
              ? `Fechada em ${resumo.fechadaEm ? dataHora(resumo.fechadaEm) : "—"}. Os números vêm da versão oficial.`
              : "Competência aberta — os números ainda podem mudar até o fechamento."}
        </p>
      </header>

      {/* ─────────────── documentos ─────────────── */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Documentos</CardTitle>
          <CardDescription>
            O download é autorizado por um link curto e fica registrado na trilha de auditoria.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {documentos === null ? (
            <SecaoVazia>Não foi possível carregar os documentos agora.</SecaoVazia>
          ) : documentos.length === 0 ? (
            <SecaoVazia>Nenhum documento nesta competência.</SecaoVazia>
          ) : (
            <ul className="divide-y divide-border">
              {documentos.map((d) => (
                <DocumentoItem
                  key={d.id}
                  loja={loja}
                  documentoId={d.id}
                  titulo={d.titulo}
                  nomeArquivo={d.nomeArquivo}
                  categoria={d.categoria}
                  status={d.status}
                  vencido={d.vencido}
                  tamanho={tamanho(d.bytes)}
                  podeConferir={podeConferir}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ─────────────── pacotes ─────────────── */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Pacotes</CardTitle>
          <CardDescription>
            Cada fechamento gera uma versão. Confirme o recebimento da versão que você baixou.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pacotes === null ? (
            <SecaoVazia>Não foi possível carregar os pacotes agora.</SecaoVazia>
          ) : pacotes.length === 0 ? (
            <SecaoVazia>Nenhum pacote gerado nesta competência.</SecaoVazia>
          ) : (
            <ul className="divide-y divide-border">
              {pacotes.map((p) => (
                <PacoteItem
                  key={p.versao}
                  loja={loja}
                  competencia={c}
                  versao={p.versao}
                  geradoEm={dataHora(p.geradoEm)}
                  tamanho={tamanho(p.bytes)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ─────────────── andamento ─────────────── */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Andamento</CardTitle>
          <CardDescription>Histórico compartilhado desta competência.</CardDescription>
        </CardHeader>
        <CardContent>
          {timeline === null ? (
            <SecaoVazia>Não foi possível carregar o andamento agora.</SecaoVazia>
          ) : timeline.timeline.itens.length === 0 ? (
            <SecaoVazia>Nada registrado nesta competência ainda.</SecaoVazia>
          ) : (
            <ol className="flex flex-col gap-3">
              {timeline.timeline.itens.map((i) => (
                <li key={i.id} className="min-w-0 border-l-2 border-border pl-3">
                  <p className="text-sm">
                    {i.texto ?? i.tipo.replace(/_/g, " ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dataHora(i.em)} · {i.atorTipo === "externo" ? "contador" : "empresa"}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* ─────────────── comentários ─────────────── */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Comentários</CardTitle>
          <CardDescription>Visíveis para você e para a empresa.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {comentarios === null ? (
            <SecaoVazia>Não foi possível carregar os comentários agora.</SecaoVazia>
          ) : comentarios.length === 0 ? (
            <SecaoVazia>Nenhum comentário ainda.</SecaoVazia>
          ) : (
            <ul className="flex flex-col gap-3">
              {comentarios.map((m) => (
                <li key={m.id} className="min-w-0 rounded-md border border-border p-3">
                  <p className="whitespace-pre-wrap text-sm">{m.texto}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dataHora(m.criadoEm)} · {m.autorTipo === "externo" ? "você/contador" : "empresa"}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <ComentarioForm loja={loja} competencia={c} />
        </CardContent>
      </Card>
    </div>
  )
}
