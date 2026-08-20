/**
 * Contador HUB · CLI do job de retenção (GOAL 019).
 *
 * DRY-RUN é o padrão e é o único modo que este script executa sem que o operador
 * peça `--apply` E o ambiente traga `CONTADOR_RETENCAO_APPLY=on`. Sem os dois, o job
 * recusa — não cai em dry-run silencioso, porque "pedi apply e nada aconteceu" é
 * exatamente o tipo de silêncio que produz surpresa em produção.
 *
 * Em dry-run a porta de escrita NEM É CONSTRUÍDA: o script não resolve o adapter de
 * storage, então uma execução de inspeção não depende sequer de credencial de R2.
 *
 * Uso:
 *   npx tsx scripts/contador/retencao-dry-run.ts --sintetico        # massa ficticia, sem banco
 *   npx tsx scripts/contador/retencao-dry-run.ts                    # todas as lojas
 *   npx tsx scripts/contador/retencao-dry-run.ts --loja=loja-1      # uma loja
 *   npx tsx scripts/contador/retencao-dry-run.ts --json
 *   CONTADOR_RETENCAO_APPLY=on npx tsx scripts/contador/retencao-dry-run.ts --apply
 *
 * Ler o relatório: `docs/contador/OPERACAO_CONTADOR_019.md`.
 */
import {
  executarJobRetencao,
  type CandidatoRetencao,
  type ModoRetencao,
  type RelatorioRetencao,
  type RetencaoLeituraPort,
} from "../../lib/contador/retencao"

/**
 * Massa SINTÉTICA em memória (`--sintetico`) — sem Prisma, sem storage, sem `.env`.
 *
 * Serve para: (a) provar o dry-run de ponta a ponta em ambiente sem banco;
 * (b) o operador conferir COMO se lê o relatório antes de rodar contra dados reais.
 * Cobre os dois lados de cada janela — um item claramente dentro e um claramente
 * fora —, então o relatório mostra candidatos E protegidos ao mesmo tempo.
 */
function leituraSintetica(): RetencaoLeituraPort {
  const item = (id: string, bytes: number, over: Partial<CandidatoRetencao> = {}): CandidatoRetencao => ({
    id,
    storeId: "loja-sintetica",
    competenciaId: `comp-${id}`,
    storageRef: `contador/loja-sintetica/2019-01/${id}`,
    bytes,
    ...over,
  })

  // A seleção por data é do repo Prisma; aqui o "lado da janela" é encenado —
  // cada método devolve diretamente o que a política selecionaria.
  return {
    async documentosAlemDaRetencao({ categoria }) {
      if (categoria === "FINANCEIRO") return [item("fin-antigo-1", 2_400_000, { categoria })]
      if (categoria === "OUTRO") return [item("out-antigo-1", 800_000, { categoria })]
      return []
    },
    async contarDocumentosProtegidos({ categoria }) {
      // FISCAL/JURIDICO/FOLHA: TUDO protegido (PURGE_DISABLED).
      return categoria === "FINANCEIRO" || categoria === "OUTRO" ? 3 : 5
    },
    async blobsSoftDeletadosAlemDaRetencao() {
      return [item("doc-excluido-1", 1_200_000, { categoria: "FISCAL" })]
    },
    async contarBlobsSoftDeletadosProtegidos() {
      return 2
    },
    async pacotesAlemDaRetencao() {
      return [item("pacote-2024-01", 3_500_000, { versao: 1 })]
    },
    async contarPacotesProtegidos() {
      return 11
    },
  }
}

function lerLojasDoArgv(): readonly string[] {
  return process.argv
    .filter((a) => a.startsWith("--loja="))
    .map((a) => a.slice("--loja=".length).trim())
    .filter(Boolean)
}

function renderizar(relatorio: RelatorioRetencao): string {
  const l: string[] = []
  const alvos = [relatorio.documentos, relatorio.blobsSoftDeletados, relatorio.pacotes]

  l.push(`Contador HUB · retencao · modo ${relatorio.modo.toUpperCase()} · ${relatorio.executadoEm}`)
  l.push(`lojas varridas: ${relatorio.lojas.length || 0}${relatorio.lojas.length ? ` (${relatorio.lojas.join(", ")})` : ""}`)
  l.push("")
  l.push("cortes vigentes:")
  for (const [categoria, corte] of Object.entries(relatorio.cortesDocumentos)) {
    l.push(`  documentos ${categoria.padEnd(11, " ")} ${corte ?? "PURGE_DISABLED (sem purga automatica)"}`)
  }
  l.push(`  pacotes (12 meses)      ${relatorio.cortePacotes}`)
  l.push(`  blob soft-del (90 dias) ${relatorio.corteBlobsSoftDeletados}`)
  l.push("")
  l.push("alvo                  candidatos    bytes  protegidos  descartados  ja_ausentes  falhas")
  for (const a of alvos) {
    l.push(
      `  ${a.alvo.padEnd(20, " ")}${String(a.candidatos).padStart(9, " ")}${String(a.bytesCandidatos).padStart(9, " ")}${String(a.protegidos).padStart(12, " ")}${String(a.descartados).padStart(13, " ")}${String(a.jaAusentes).padStart(13, " ")}${String(a.falhas).padStart(8, " ")}`,
    )
  }
  l.push("")
  l.push(`bytes estimados para liberacao: ${relatorio.bytesEstimadosLiberados}`)
  l.push(`itens protegidos pela politica: ${relatorio.protegidosPorPolitica}`)
  const porCategoria = Object.entries(relatorio.documentos.porCategoria)
  if (porCategoria.length) {
    l.push(`candidatos por categoria: ${porCategoria.map(([c, n]) => `${c}=${n}`).join(" ")}`)
  }
  if (relatorio.erros.length) {
    l.push("")
    l.push(`erros/indisponibilidades: ${relatorio.erros.length}`)
    for (const e of relatorio.erros) {
      l.push(`  [${e.alvo}] loja=${e.storeId} registro=${e.registroId ?? "-"} motivo=${e.motivo}`)
    }
  } else {
    l.push("erros/indisponibilidades: 0")
  }
  if (relatorio.modo === "dry-run") {
    l.push("")
    l.push("DRY-RUN: nada foi alterado em banco nem em storage.")
  }
  return l.join("\n")
}

async function main(): Promise<void> {
  const modo: ModoRetencao = process.argv.includes("--apply") ? "apply" : "dry-run"
  const comoJson = process.argv.includes("--json")
  const sintetico = process.argv.includes("--sintetico")

  if (sintetico && modo === "apply") {
    throw Object.assign(
      new Error("--sintetico nao aceita --apply: a massa e ficticia e nao ha o que descartar."),
      { code: "SINTETICO_SEM_APPLY" },
    )
  }

  if (sintetico) {
    const agora = new Date()
    const relatorioSintetico = await executarJobRetencao(
      { leitura: leituraSintetica() },
      { storeIds: ["loja-sintetica"], modo: "dry-run", agora },
    )
    process.stdout.write(
      comoJson
        ? `${JSON.stringify(relatorioSintetico, null, 2)}\n`
        : `${renderizar(relatorioSintetico)}\n\nMASSA SINTETICA em memoria — sem Prisma, sem storage, sem banco.\n`,
    )
    return
  }

  // Imports dinâmicos: `--sintetico` não deve exigir Prisma nem credencial de storage.
  const { criarEscritaRetencao, criarLeituraRetencaoPrisma, listarLojasComDadosContador } =
    await import("../../lib/contador/retencao/repo-prisma")

  const lojasArg = lerLojasDoArgv()
  const storeIds = lojasArg.length ? lojasArg : await listarLojasComDadosContador()

  const relatorio = await executarJobRetencao(
    {
      leitura: criarLeituraRetencaoPrisma(),
      // Em dry-run a porta de escrita nem é resolvida: `criarEscritaRetencao()`
      // dispara `resolverStorageDocumentos()`, que exige provider e credenciais.
      ...(modo === "apply" ? { escrita: criarEscritaRetencao() } : {}),
    },
    { storeIds, modo },
  )

  process.stdout.write(
    comoJson ? `${JSON.stringify(relatorio, null, 2)}\n` : `${renderizar(relatorio)}\n`,
  )

  if (relatorio.erros.length > 0) process.exitCode = 1
}

main().catch((erro: unknown) => {
  // Mensagem do erro tipado do job (apply bloqueado / escrita ausente) é segura.
  // Qualquer outra vira rótulo curto: erro de infraestrutura pode carregar DSN.
  const seguro =
    erro instanceof Error && typeof (erro as { code?: unknown }).code === "string"
      ? erro.message
      : `Falha ao executar o job de retencao (${erro instanceof Error ? erro.name : "erro"}).`
  process.stderr.write(`${seguro}\n`)
  process.exitCode = 1
})
