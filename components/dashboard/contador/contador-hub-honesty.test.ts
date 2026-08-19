/**
 * GOAL CONTADOR-HUB-HONESTY-ROUTE-SAFETY-002 — garantias de honestidade visual do
 * Contador HUB (preview interno) e do portal legado `/contador`.
 *
 * `vitest.config.ts` roda em `environment: "node"` (sem jsdom) e só coleta
 * `*.test.ts`/`*.spec.ts` — por isso este teste é 100% baseado em leitura do
 * código-fonte real (mesma convenção de `components/operacoes-v4-preview/
 * preview-honesty.test.ts`), sem renderizar componentes React.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { montarChecklistFechamento } from "@/lib/contador/fechamento"
import { montarDados, type FontesContador } from "@/lib/contador/readers"

const DIR = dirname(fileURLToPath(import.meta.url))

const hubSrc = readFileSync(join(DIR, "contador-hub-preview.tsx"), "utf8")
const realSrc = readFileSync(join(DIR, "contador-dados-reais.tsx"), "utf8")
const dataSrc = readFileSync(join(DIR, "contador-preview-data.ts"), "utf8")
const legacySrc = readFileSync(join(DIR, "area-contador-pro.tsx"), "utf8")
const checklistSrc = readFileSync(join(DIR, "contador-fechamento-checklist.tsx"), "utf8")

/** Colapsa qualquer sequência de espaços/quebras de linha em um único espaço — o
 * JSX é quebrado em várias linhas por legibilidade, mas o texto renderizado (e o
 * HTML) colapsa esses espaços do mesmo jeito, então a comparação deve fazer o mesmo. */
const norm = (s: string) => s.replace(/\s+/g, " ").trim()

/** Extrai `<Btn ...>`/`<Switch ...>` sem parar no "=>" de `onClick={() => ...}`
 * (um "=>" contém um ">" que não é o fim da tag). */
const JSX_TAG = /<(?:Btn|Switch)\b[\s\S]*?(?<!=)>/g

describe("Contador HUB — banner global e persistente (Passo 1)", () => {
  it("existe um GlobalPreviewNotice com o contrato híbrido explícito", () => {
    expect(hubSrc).toContain("function GlobalPreviewNotice()")
    expect(hubSrc).toContain("Experiência híbrida — blocos reais identificados + preview.")
  })

  it("GlobalPreviewNotice é renderizado fora da troca de seção (fora de SECTION_RENDERERS/active)", () => {
    const renderIdx = hubSrc.indexOf("<GlobalPreviewNotice")
    const switchIdx = hubSrc.indexOf("SECTION_RENDERERS[active]()")
    expect(renderIdx, "GlobalPreviewNotice deve ser renderizado no JSX principal").toBeGreaterThan(-1)
    expect(switchIdx).toBeGreaterThan(-1)
    // Precisa vir ANTES do bloco que troca de seção, e fora de qualquer render* de seção
    // individual — por isso é o único <GlobalPreviewNotice em todo o arquivo.
    expect(renderIdx).toBeLessThan(switchIdx)
    const occurrences = hubSrc.split("<GlobalPreviewNotice").length - 1
    expect(occurrences, "deve haver exatamente 1 ponto de renderização (fora do switch por seção)").toBe(1)
  })

  it("não depende de hover/tooltip/clique: é um <div> estático, sem onMouseEnter/onClick", () => {
    const fnStart = hubSrc.indexOf("function GlobalPreviewNotice()")
    const fnBody = hubSrc.slice(fnStart, fnStart + 800)
    expect(fnBody).not.toContain("onMouseEnter")
    expect(fnBody).not.toContain("onClick")
    expect(fnBody).not.toContain("hidden ")
  })
})

describe("Contador HUB — competência em experiência híbrida (GOAL 006B)", () => {
  it("o aviso limita o efeito da competência aos blocos reais", () => {
    expect(norm(hubSrc)).toContain("a competência selecionada altera somente os blocos reais.")
  })
})

describe("Contador HUB — reconciliação direcional de pagamentos (GOAL 006E)", () => {
  it("Relatórios separa residual, excedente e a soma absoluta sem transformá-los em receita", () => {
    expect(realSrc).toContain('label="Valor sem forma de pagamento identificada"')
    expect(realSrc).toContain('label="Breakdown de pagamentos excede o total das vendas"')
    expect(realSrc).toContain('label="Divergência total do breakdown (residual + excedente)"')
    expect(realSrc).toContain("vendas.reconciliacaoPagamento?.divergenciaAbsoluta")
    expect(realSrc).toContain("(vendas.reconciliacaoPagamento?.divergenciaAbsoluta ?? 0) > 0")
    expect(realSrc).toContain("BRL.format(vendas.reconciliacaoPagamento?.divergenciaAbsoluta ?? 0)")
    expect(realSrc).not.toContain('label="Divergência do breakdown"')
  })
})

describe("Contador HUB — CTAs sem efeito real não podem parecer operacionais (Passo 2)", () => {
  const ctaIndisponivelDecl = /const CTA_INDISPONIVEL_TITLE = ".+"/
  it("existe um texto único reaproveitado para os CTAs indisponíveis nesta fase", () => {
    expect(hubSrc).toMatch(ctaIndisponivelDecl)
    expect(hubSrc).toContain("Disponível na fase de dados reais")
  })

  it("todo <Btn>/<Switch> cujo onClick chama noop(...)/onNoop(...) está genuinamente disabled", () => {
    const tags = hubSrc.match(JSX_TAG) ?? []
    const acaoTags = tags.filter((t) => /\bnoop\(|\bonNoop\(/.test(t))
    // Confirma que a varredura encontrou algo (evita passar "por vazio").
    // GOAL 010 removeu CTAs noop de Documentos; GOAL 016 removeu os de Obrigações.
    expect(acaoTags.length).toBeGreaterThanOrEqual(7)
    const semDisabled = acaoTags.filter((t) => !/\bdisabled\b/.test(t))
    expect(semDisabled, `CTA(s) sem "disabled": ${semDisabled.join(" | ")}`).toEqual([])
  })

  it("o Pacote do Contador deixou de ser um CTA de preview desabilitado (GOAL 008)", () => {
    // PacoteCard (lista ilustrativa + botão disabled) deu lugar ao download real
    // (ContadorPacoteDownload). O antigo rótulo de preview não pode sobreviver.
    expect(hubSrc).not.toContain("function PacoteCard(")
    expect(hubSrc).not.toContain("Baixar pacote · preview")
    expect(hubSrc).not.toContain("Gerar pacote · preview")
    expect(hubSrc).toContain("<ContadorPacoteDownload")
  })

  it("nenhum CTA sem efeito real depende só do toast pós-clique: todos têm title/aux text acessível", () => {
    const tags = hubSrc.match(JSX_TAG) ?? []
    const acaoTags = tags.filter((t) => /\bnoop\(|\bonNoop\(/.test(t))
    // GOAL 007: «Fechar competência» usa FECHAR_COMPETENCIA_TITLE (GOAL 012); demais usam CTA_INDISPONIVEL_TITLE.
    const semTitle = acaoTags.filter(
      (t) => !t.includes("CTA_INDISPONIVEL_TITLE") && !t.includes("FECHAR_COMPETENCIA_TITLE"),
    )
    expect(semTitle, `CTA(s) sem title acessível: ${semTitle.join(" | ")}`).toEqual([])
  })

  it("'Ver exemplo' saiu da seção Obrigações (GOAL 016 realificou a aba)", () => {
    expect(hubSrc).not.toContain("Ver exemplo")
  })
})

describe("Contador HUB — valores sensíveis do preview seguem marcados como ilustrativos (Passo 4)", () => {
  it("as notas fiscais de exemplo em Documentos usam o pill de preview", () => {
    expect(dataSrc).toMatch(/name: "NF-e de venda 001234"[\s\S]*?preview: true/)
    expect(dataSrc).toMatch(/name: "NF-e de compra 5678"[\s\S]*?preview: true/)
  })

  it("o honorário do contador em Obrigações usa o pill de preview", () => {
    expect(dataSrc).toMatch(/name: "Honorários do contador"[\s\S]*?preview: true/)
  })

  it("Visão geral segue preview; Documentos (010), Fechamento (012) e Obrigações (016) são REAIS", () => {
    const renderVisaoIdx = hubSrc.indexOf("const renderVisao = ()")
    const renderFechamentoIdx = hubSrc.indexOf("const renderFechamento = ()")
    const renderDocumentosIdx = hubSrc.indexOf("const renderDocumentos = ()")
    const renderObrigacoesIdx = hubSrc.indexOf("const renderObrigacoes = ()")
    const renderRelatoriosIdx = hubSrc.indexOf("const renderRelatorios = ()")
    expect(hubSrc.slice(renderVisaoIdx, renderFechamentoIdx)).toContain("<PreviewBanner")
    const fechamento = hubSrc.slice(renderFechamentoIdx, renderDocumentosIdx)
    expect(fechamento).toContain("<ContadorFechamentoReal")
    expect(fechamento).not.toContain("<PreviewBanner")
    const documentos = hubSrc.slice(renderDocumentosIdx, renderObrigacoesIdx)
    expect(documentos).toContain("<ContadorDocumentosReal")
    expect(documentos).not.toContain("<PreviewBanner")
    const obrigacoes = hubSrc.slice(renderObrigacoesIdx, renderRelatoriosIdx)
    expect(obrigacoes).toContain("<ContadorAgendaReal")
    expect(obrigacoes).not.toContain("<PreviewBanner")
    expect(obrigacoes).not.toContain("OBRIGACOES_ROWS")
    expect(hubSrc).toContain("<ContadorAvisosReal")
  })
})

/* ────────── GOAL 012 — Fechamento com snapshot e pacote versionado ────────── */

describe("Contador HUB — Fechamento REAL (GOAL 012)", () => {
  const fechamentoSrc = readFileSync(join(DIR, "fechamento/contador-fechamento-real.tsx"), "utf8")

  it("fechar e reabrir passam por modal com confirmação textual da competência", () => {
    expect(fechamentoSrc).toContain("function FecharModal(")
    expect(fechamentoSrc).toContain("function ReabrirModal(")
    expect(fechamentoSrc).toContain("para confirmar")
    // O botão só habilita com pendências assumidas E confirmação digitada.
    expect(fechamentoSrc).toContain("todasAssumidas && confirmado && !ocupado")
  })

  it("reabertura exige motivo não vazio", () => {
    expect(fechamentoSrc).toContain("Motivo da reabertura (obrigatório)")
    expect(fechamentoSrc).toContain("motivo.trim().length > 0")
  })

  it("as capacidades vêm do servidor — a UI não infere papel", () => {
    expect(fechamentoSrc).toContain("estado?.podeFechar")
    expect(fechamentoSrc).toContain("estado.podeReabrir")
    expect(fechamentoSrc).not.toMatch(/\b(masterConsole|financeiro\.edit)\b/)
  })

  it("nunca envia loja, autor ou papel pelo cliente", () => {
    expect(fechamentoSrc).not.toMatch(/\b(storeId|lojaId)\b/)
    const corpos = fechamentoSrc.match(/JSON\.stringify\(\{[\s\S]*?\}\)/g) ?? []
    for (const corpo of corpos) {
      expect(corpo).not.toMatch(/\b(autorId|atorId|storeId|lojaId|papel|role|userId)\b/)
    }
  })

  it("o alerta de divergência é o texto único do domínio e só grava por ação explícita", () => {
    expect(fechamentoSrc).toContain("divergencia.aviso")
    expect(fechamentoSrc).toContain("Registrar divergência na trilha")
    // A avaliação é GET; a persistência do evento é POST disparado por clique.
    expect(fechamentoSrc).toMatch(/method:\s*"POST"[\s\S]{0,200}fechamento\/divergencia|divergencia[\s\S]{0,200}method:\s*"POST"/)
  })

  it("estado vazio de versões é honesto — não promete pacote inexistente", () => {
    expect(fechamentoSrc).toContain("Nenhuma versão oficial ainda")
    expect(fechamentoSrc).toContain("Competência fechada — oficial v")
  })

  it("o download usa URL assinada de curta duração e nunca expõe storageRef", () => {
    expect(fechamentoSrc).toContain("/api/contador/pacote/download")
    expect(fechamentoSrc).not.toContain("storageRef")
  })
})

describe("Portal legado /contador (area-contador-pro.tsx) — rótulos honestos (Passo 5)", () => {
  it("CSV é rotulado como agregados operacionais, não como CSV fiscal", () => {
    expect(legacySrc).toContain("CSV de agregados operacionais")
  })

  it("XML deixa claro que é formato próprio, não XML fiscal", () => {
    expect(legacySrc).toContain("XML de movimentos — formato próprio, não é XML fiscal")
  })

  it("alíquota é rotulada como estimativa manual, não apuração tributária", () => {
    expect(legacySrc).toContain("Estimativa manual — não é apuração tributária")
  })

  it("não alterou funções de exportação nem cálculo (mesmas assinaturas/handlers)", () => {
    expect(legacySrc).toContain("onClick={exportarCsv}")
    expect(legacySrc).toContain("onClick={exportarXml}")
    expect(legacySrc).toContain("estimativaImposto(faturamento, aliquotaPct)")
  })
})

describe("Contador HUB — navegação não afirma ações reais sobre dados estáticos (Passo 6)", () => {
  it("mantém o badge 'Preview' no header (HStatus)", () => {
    const fnStart = hubSrc.indexOf("function HStatus()")
    const fnEnd = hubSrc.indexOf("\nfunction ", fnStart + 1)
    expect(fnStart).toBeGreaterThan(-1)
    expect(fnEnd).toBeGreaterThan(fnStart)
    expect(hubSrc.slice(fnStart, fnEnd)).toContain("Preview")
  })

  it("o header principal usa badge híbrido sem reclassificar seções puramente preview", () => {
    expect(hubSrc).toContain("<HybridStatus />")
    const fnStart = hubSrc.indexOf("function HybridStatus()")
    const fnEnd = hubSrc.indexOf("\nfunction ", fnStart + 1)
    expect(fnStart).toBeGreaterThan(-1)
    expect(hubSrc.slice(fnStart, fnEnd)).toContain("Híbrido")
  })

  it("'3 de 9 itens concluídos' (Visão geral, ainda preview) vem acompanhado de PreviewBanner local", () => {
    // GOAL 007 removeu o mock «3 de 9» da seção Fechamento; permanece só na Visão geral (híbrida).
    const occurrences = [...hubSrc.matchAll(/itens concluídos/g)]
    expect(occurrences.length).toBeGreaterThanOrEqual(1)
    const renderVisaoIdx = hubSrc.indexOf("const renderVisao = ()")
    const renderFechamentoIdx = hubSrc.indexOf("const renderFechamento = ()")
    expect(hubSrc.slice(renderVisaoIdx, renderFechamentoIdx)).toContain("itens concluídos")
    expect(hubSrc.slice(renderFechamentoIdx, hubSrc.indexOf("const renderDocumentos = ()"))).not.toContain(
      "itens concluídos",
    )
  })
})

describe("Contador HUB — checklist de fechamento derivado (GOAL 007)", () => {
  it("Fechamento consome ContadorFechamentoChecklist e não o FECHAMENTO_CHECKLIST mock", () => {
    expect(hubSrc).toContain("ContadorFechamentoChecklist")
    expect(hubSrc).toContain("checklistFechamento")
    expect(hubSrc).not.toContain("FECHAMENTO_CHECKLIST")
  })

  it("o CTA desabilitado «Fechar competência · GOAL 012» deu lugar ao fechamento real", () => {
    const renderFechamentoIdx = hubSrc.indexOf("const renderFechamento = ()")
    const renderDocsIdx = hubSrc.indexOf("const renderDocumentos = ()")
    const body = hubSrc.slice(renderFechamentoIdx, renderDocsIdx)
    // O placeholder do GOAL 007 não pode sobreviver ao GOAL 012.
    expect(body).not.toContain("FECHAR_COMPETENCIA_TITLE")
    expect(body).not.toContain("Fechar competência · GOAL 012")
    expect(body).toContain("<ContadorFechamentoReal")
    // O checklist derivado (GOAL 007) continua read-only ao lado do fechamento real.
    expect(body).toContain("ContadorFechamentoChecklist")
    expect(body).not.toContain("ProgressRing")
    expect(body).not.toContain("3 de 9")
  })

  it("page monta o checklist a partir do DTO (sem reconsultar readers)", () => {
    const pageSrc = readFileSync(join(DIR, "../../../app/dashboard/contador/page.tsx"), "utf8")
    expect(pageSrc).toContain("montarChecklistFechamento")
    expect(pageSrc).toContain("construirDadosContador")
    // Uso (não import): checklist depois da única carga do DTO.
    const callConstruir = pageSrc.indexOf("realData = await construirDadosContador")
    const callChecklist = pageSrc.indexOf("montarChecklistFechamento({")
    expect(callConstruir).toBeGreaterThan(-1)
    expect(callChecklist).toBeGreaterThan(callConstruir)
    expect(pageSrc).not.toMatch(/carregarFontes|prisma\./)
  })
})

/* ─────────────────────── GOAL 007B — semântica honesta ─────────────────────── */

const VAZIO: FontesContador = {
  vendas: [],
  devolucoes: [],
  movimentacoes: [],
  receber: [],
  pagar: [],
  sessoes: [],
  operacoes: [],
  falhas: [],
}
const AGORA = new Date("2026-07-16T12:00:00.000Z") // 09:00 America/Sao_Paulo → Julho/2026
const ATUAL = { ano: 2026, mes: 7 }

function checklistDe(fontes: Partial<FontesContador>, competencia = ATUAL) {
  const dados = montarDados({ ...VAZIO, ...fontes }, competencia)
  return montarChecklistFechamento({ dados, competencia, agora: AGORA })
}
function estado(checklist: ReturnType<typeof montarChecklistFechamento>, id: string) {
  return checklist.itens.find((i) => i.id === id)?.estado
}

describe("Contador HUB — componente do checklist real (GOAL 007B)", () => {
  it("exibe o título honesto 'Checklist de fechamento — somente leitura'", () => {
    expect(checklistSrc).toContain("Checklist de fechamento — somente leitura")
    expect(checklistSrc).toContain("somente leitura")
  })

  it("não exibe percentual/progresso: sem '%', sem ProgressRing, sem 'concluíd' hardcoded", () => {
    expect(checklistSrc).not.toContain("ProgressRing")
    expect(checklistSrc).not.toContain("%")
    // O componente rotula estados por ESTADO_LABEL — nunca "concluída/concluído".
    expect(checklistSrc.toLowerCase()).not.toContain("concluíd")
    expect(checklistSrc).toContain('pendente: "pendente"')
    expect(checklistSrc).toContain('nao_disponivel: "não disponível"')
  })

  it("é somente leitura: sem fetch/POST/localStorage/create/update no componente", () => {
    expect(checklistSrc).not.toMatch(/fetch\(|POST|PUT|PATCH|DELETE|localStorage|sessionStorage|\.create\(|\.update\(|\.upsert\(/)
  })
})

describe("Contador HUB — estados derivados que a UI renderiza (GOAL 007B, sem snapshot)", () => {
  it("vendas zero → pendente (a UI não pode mostrar como concluída)", () => {
    expect(estado(checklistDe({}), "vendas")).toBe("pendente")
  })

  it("sessão da competência atual aberta → pendente", () => {
    const c = checklistDe({ sessoes: [{ status: "ABERTA", saldoFinal: null, saldoContado: null }] }, ATUAL)
    expect(estado(c, "sessoes_caixa")).toBe("pendente")
  })

  it("títulos vencidos (a receber e a pagar) → não disponível", () => {
    const c = checklistDe({
      receber: [{ valor: 150, status: "aberto", vencimento: "2026-07-15" }],
      pagar: [{ valor: 80, status: "aberto", vencimento: "2026-07-20" }],
    })
    expect(estado(c, "titulos_vencidos_receber")).toBe("nao_disponivel")
    expect(estado(c, "titulos_vencidos_pagar")).toBe("nao_disponivel")
  })

  it("Documentos, Conferência e Fiscal → não disponível; Fechamento oficial → pendente", () => {
    const c = checklistDe({})
    expect(estado(c, "documentos")).toBe("nao_disponivel")
    expect(estado(c, "conferencia_contador")).toBe("nao_disponivel")
    expect(estado(c, "fiscal")).toBe("nao_disponivel")
    expect(estado(c, "fechamento_oficial")).toBe("pendente")
  })

  it("o resumo não tem percentual: soma dos estados == total", () => {
    const c = checklistDe({})
    const { ok, atencao, pendente, nao_disponivel, total } = c.contagem
    expect(ok + atencao + pendente + nao_disponivel).toBe(total)
    expect(JSON.stringify(c.contagem)).not.toMatch(/percent|%|score/i)
  })
})

describe("Contador HUB — card ilustrativo Preview ≠ checklist real derivado (CORREÇÃO 9)", () => {
  it("o card '3 de 9 / 35%' da Visão geral está rotulado como Preview ilustrativo", () => {
    const renderVisaoIdx = hubSrc.indexOf("const renderVisao = ()")
    const renderFechamentoIdx = hubSrc.indexOf("const renderFechamento = ()")
    const visao = hubSrc.slice(renderVisaoIdx, renderFechamentoIdx)
    // A percentagem ilustrativa (ProgressRing/3 de 9) permanece SÓ na Visão geral…
    expect(visao).toContain("ProgressRing")
    expect(visao).toContain("3 de 9")
    // …mas agora identificada como preview ilustrativo, apontando para o checklist real.
    expect(visao).toContain("Preview ilustrativo")
    expect(visao).toContain("Números ilustrativos de preview")
  })

  it("o checklist real derivado (seção Fechamento) não usa ProgressRing nem percentagem", () => {
    const renderFechamentoIdx = hubSrc.indexOf("const renderFechamento = ()")
    const renderDocsIdx = hubSrc.indexOf("const renderDocumentos = ()")
    const fechamento = hubSrc.slice(renderFechamentoIdx, renderDocsIdx)
    expect(fechamento).toContain("ContadorFechamentoChecklist")
    expect(fechamento).not.toContain("ProgressRing")
    expect(fechamento).not.toContain("3 de 9")
    expect(fechamento).not.toContain("35%")
  })

  it("o header do HUB não apresenta mais um percentual de fechamento fabricado", () => {
    expect(hubSrc).not.toContain("Fechamento · 35%")
  })
})

/* ────────────── GOAL 008B — Pacote do Contador (download GET direto, sem blob) ────────────── */

describe("Contador HUB — Pacote do Contador com download GET direto (GOAL 008B)", () => {
  const downloadSrc = readFileSync(join(DIR, "contador-pacote-download.tsx"), "utf8")

  it("usa o endpoint interno autenticado GET /api/contador/pacote com competência canônica", () => {
    expect(downloadSrc).toContain('PACOTE_ENDPOINT = "/api/contador/pacote"')
    expect(downloadSrc).toContain("formatCompetencia(competencia)")
    expect(downloadSrc).toContain("?c=")
  })

  it("é download GET DIRETO: zero fetch, zero blob, zero objectURL", () => {
    expect(downloadSrc).not.toMatch(/\bfetch\(/)
    expect(downloadSrc).not.toMatch(/\.blob\(/)
    expect(downloadSrc).not.toMatch(/createObjectURL|revokeObjectURL/)
    // Âncora GET direta.
    expect(downloadSrc).toContain('document.createElement("a")')
  })

  it("nunca envia storeId pelo cliente e não persiste estado local", () => {
    expect(downloadSrc).not.toMatch(/storeId|lojaId/)
    expect(downloadSrc).not.toMatch(/localStorage|sessionStorage/)
  })

  it("o botão só habilita com dados reais e mostra o motivo honesto quando indisponível", () => {
    expect(downloadSrc).toContain("disabled={!disponivel}")
    expect(downloadSrc).toContain("PACOTE_INDISPONIVEL_TITLE")
    // O cabeçalho do HUB condiciona o botão ao mesmo realData.
    expect(hubSrc).toContain("disabled={!realData}")
  })

  it("estado honesto: 'Solicitação de download iniciada', sem afirmar sucesso/arquivamento", () => {
    expect(downloadSrc).toContain("Solicitação de download iniciada")
    expect(downloadSrc).not.toContain("gerado com sucesso")
    expect(downloadSrc).not.toMatch(/arquivad|histórico|%/)
  })

  it("mantém a honestidade: não é fechamento oficial e não inclui XML nesta fase", () => {
    expect(norm(downloadSrc)).toContain("não é fechamento oficial")
    expect(downloadSrc).toContain("Notas fiscais (XML)")
    expect(downloadSrc).toContain("placeholder honesto")
  })

  it("o HUB compartilha um único estado de download entre cabeçalho e seções", () => {
    expect(hubSrc).toContain("const pacoteDownload = usePacoteDownload(competencia)")
    // Duas seções (Visão geral + Relatórios) reutilizam o mesmo estado.
    const usos = hubSrc.split("download={pacoteDownload}").length - 1
    expect(usos).toBe(2)
  })
})

/* ────────── GOAL 011 — Timeline, status e comentários deixaram de ser mock ────────── */

describe("Contador HUB — Timeline REAL (GOAL 011)", () => {
  const timelineSrc = readFileSync(join(DIR, "timeline/contador-timeline-real.tsx"), "utf8")
  const comentariosSrc = readFileSync(join(DIR, "timeline/contador-comentarios.tsx"), "utf8")
  const documentosSrc = readFileSync(join(DIR, "documentos/contador-documentos-real.tsx"), "utf8")

  it("a seção Timeline renderiza o componente real, sem PreviewBanner", () => {
    const inicio = hubSrc.indexOf("const renderTimeline = ()")
    const fim = hubSrc.indexOf("const renderConfig = ()")
    expect(inicio).toBeGreaterThan(-1)
    const secao = hubSrc.slice(inicio, fim)
    expect(secao).toContain("<ContadorTimelineReal")
    expect(secao).not.toContain("<PreviewBanner")
    expect(secao).not.toContain("CTA_INDISPONIVEL_TITLE")
  })

  it("a conversa mockada e o array TIMELINE_ITEMS foram removidos do HUB e dos dados", () => {
    expect(hubSrc).not.toContain("TIMELINE_ITEMS")
    expect(hubSrc).not.toContain("Conversa com o contador")
    expect(hubSrc).not.toContain("Enviar observação")
    expect(dataSrc).not.toContain("export const TIMELINE_ITEMS")
    expect(dataSrc).not.toContain("Pode anexar o extrato do Banco principal")
  })

  it("a timeline lê o endpoint real e é somente leitura (sem POST/PUT/DELETE)", () => {
    expect(timelineSrc).toContain("/api/contador/timeline")
    expect(timelineSrc).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/)
  })

  it("timeline e comentários nunca enviam loja nem autor pelo cliente", () => {
    for (const src of [timelineSrc, comentariosSrc, documentosSrc]) {
      // Loja jamais aparece — nem como tipo, nem como valor.
      expect(src).not.toMatch(/\b(storeId|lojaId)\b/)
      // `autorId`/`atorId` só podem existir como campo de DTO LIDO do servidor;
      // nunca dentro de um corpo de requisição.
      const corpos = src.match(/JSON\.stringify\(\{[\s\S]*?\}\)/g) ?? []
      for (const corpo of corpos) {
        expect(corpo).not.toMatch(/\b(autorId|atorId|storeId|lojaId|papel|role)\b/)
      }
    }
  })

  it("estado vazio é honesto: não inventa atividade de exemplo", () => {
    expect(timelineSrc).toContain("Nenhuma atividade nesta competência")
    expect(comentariosSrc).toContain("Nenhum comentário")
  })

  it("a caixa de comentários distingue interno de compartilhado antes do envio", () => {
    expect(comentariosSrc).toContain("Interno — só a sua equipe")
    expect(comentariosSrc).toContain("Compartilhado — visível ao contador")
    expect(comentariosSrc).toContain("nunca sai para o contador externo")
    // O portal externo ainda não existe — a UI diz isso em vez de prometer.
    expect(comentariosSrc).toContain("GOAL 015")
  })

  it("as transições oferecidas vêm da matriz do domínio, não de uma lista solta na UI", () => {
    expect(documentosSrc).toContain("transicoesDisponiveis")
    expect(documentosSrc).toContain("@/lib/contador/status/matriz")
    // Nenhum status hardcoded como botão fixo.
    expect(documentosSrc).not.toMatch(/Marcar como conferido"/)
  })

  it("rejeição sempre passa por modal com motivo obrigatório", () => {
    expect(documentosSrc).toContain("function RejeitarModal(")
    expect(documentosSrc).toContain("Motivo da rejeição (obrigatório)")
    expect(documentosSrc).toContain("disabled={ocupado || vazio}")
  })

  it("capacidade de conferir nasce fail-closed e vem do servidor", () => {
    expect(documentosSrc).toContain('useState<Capacidades>({ podeConferir: false })')
    expect(documentosSrc).toContain('fetch("/api/contador/status"')
    expect(documentosSrc).toContain("Conferir e resolver exigem papel financeiro ou administrador.")
  })

  it("`vencido` aparece como flag derivada, nunca como status", () => {
    expect(documentosSrc).toContain("<VencidoChip")
    const uiSrc = readFileSync(join(DIR, "contador-ui.tsx"), "utf8")
    expect(uiSrc).toContain("Derivado do vencimento — não é um status gravado.")
    // O chip de status só conhece os 4 estados persistidos.
    expect(uiSrc).not.toMatch(/STATUS_CHIP[\s\S]{0,200}VENCIDO/)
  })
})

/* ────────── GOAL 016 — Obrigações e Guias reais ────────── */

describe("Contador HUB — Obrigações REAL (GOAL 016)", () => {
  const agendaSrc = readFileSync(join(DIR, "agenda/contador-agenda-real.tsx"), "utf8")
  const pageSrc = readFileSync(join(DIR, "../../../app/dashboard/contador/page.tsx"), "utf8")
  const checklistSrc = readFileSync(join(DIR, "../../../lib/contador/fechamento/montar-checklist.ts"), "utf8")

  it("a seção usa o componente real, sem mock de linhas e sem badge Preview na nav", () => {
    expect(hubSrc).toContain("<ContadorAgendaReal")
    expect(hubSrc).not.toContain("OBRIGACOES_ROWS")
    expect(dataSrc).not.toMatch(/id: "obrigacoes"[\s\S]{0,80}badge: "Preview"/)
  })

  it("microcopy permanente: informado pelo responsável", () => {
    expect(agendaSrc).toContain("informado pelo responsável")
    expect(agendaSrc).toContain("Gerar deste mês")
    expect(agendaSrc).toContain("Nenhuma guia informada")
    expect(agendaSrc).not.toMatch(/estimativaImposto|lib\/contador-aggregates/)
  })

  it("page carrega resumo de guias fora do checklist e isola a falha", () => {
    expect(pageSrc).toContain("carregarResumoGuiasChecklist")
    expect(pageSrc).toContain("evidenciaAgenda")
    expect(pageSrc).toContain("[contador/agenda-resumo]")
    expect(pageSrc).toContain("leituraOk: false")
    expect(checklistSrc).not.toMatch(/from ["']@\/lib\/prisma["']/)
    expect(checklistSrc).not.toMatch(/prisma\./)
  })
})

describe("Contador HUB — central de avisos REAL (GOAL 017)", () => {
  const avisosSrc = readFileSync(join(DIR, "avisos/contador-avisos-real.tsx"), "utf8")

  it("a Visão geral monta a central real e não o array VISAO_ALERTAS", () => {
    const renderVisaoIdx = hubSrc.indexOf("const renderVisao = ()")
    const renderFechamentoIdx = hubSrc.indexOf("const renderFechamento = ()")
    const visao = hubSrc.slice(renderVisaoIdx, renderFechamentoIdx)
    expect(visao).toContain("<ContadorAvisosReal")
    expect(visao).not.toContain("VISAO_ALERTAS")
    expect(hubSrc).not.toMatch(/VISAO_ALERTAS/)
  })

  it("não há botão Enviar; há atualizar, tratado, rascunho e copiar", () => {
    expect(avisosSrc).toContain("Atualizar avisos")
    expect(avisosSrc).toContain("Marcar tratado")
    expect(avisosSrc).toContain("Gerar rascunho")
    expect(avisosSrc).toContain("Copiar rascunho")
    expect(avisosSrc).not.toMatch(/>\s*Enviar\s*</)
    expect(avisosSrc).not.toContain("/enviar")
    expect(avisosSrc).not.toContain("sendCloudApi")
    expect(avisosSrc).not.toContain("sendWhatsAppMessage")
  })

  it("GET inicial é read-only; persistir só via POST /avaliar", () => {
    expect(avisosSrc).toContain("/api/contador/notificacoes?c=")
    expect(avisosSrc).toContain("/api/contador/notificacoes/avaliar")
    expect(avisosSrc).toContain('method: "POST"')
  })

  it("fonte de pacote indisponível é honesta e não afirma ausência de pendências", () => {
    expect(avisosSrc).toContain("fontePacote")
    expect(avisosSrc).toContain("Não foi possível ler o manifesto oficial do pacote desta competência.")
  })

  it("agenda mantém microcopy informado pelo responsável", () => {
    expect(avisosSrc).toContain("informado pelo responsável")
    expect(avisosSrc).not.toContain("janela de 7 dias informada pelo responsável")
  })
})
