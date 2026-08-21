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

/* ────────── GOAL 023 — o aviso global stale foi REMOVIDO ────────── */

describe("Contador HUB — sem aviso global negando funcionalidade real (GOAL 023)", () => {
  it("o GlobalPreviewNotice deixou de existir — nem função, nem ponto de renderização", () => {
    expect(hubSrc).not.toContain("function GlobalPreviewNotice()")
    expect(hubSrc).not.toContain("<GlobalPreviewNotice")
  })

  it("o texto stale que negava envio, fechamento, guia e documento sumiu", () => {
    // Documentos (010), Fechamento (012) e Obrigações (016) são reais desde antes
    // do 023 — um banner afirmando o contrário era a mentira mais visível do HUB.
    expect(norm(hubSrc)).not.toContain(
      "Nenhum envio, fechamento, guia ou documento é processado",
    )
    expect(hubSrc).not.toContain("Experiência híbrida — blocos reais identificados + preview.")
    expect(norm(hubSrc)).not.toContain("a competência selecionada altera somente os blocos reais.")
  })

  it("o header não vende o Fechamento como preview", () => {
    expect(hubSrc).not.toContain("Fechamento · preview")
    // O selo híbrido do HUB permanece — ele é verdadeiro.
    expect(hubSrc).toContain("<HybridStatus />")
  })

  it("o preview restante é identificado NO BLOCO, não globalmente", () => {
    // PreviewBanner segue existindo (Relatórios e Dossiês ainda têm partes preview)…
    expect(hubSrc).toContain("function PreviewBanner(")
    // …mas nenhum deles é renderizado fora do conteúdo trocado por seção.
    const mainIdx = hubSrc.indexOf("SECTION_RENDERERS[active]()")
    expect(mainIdx).toBeGreaterThan(-1)
    const depoisDoMain = hubSrc.slice(mainIdx)
    expect(depoisDoMain).not.toContain("<PreviewBanner")
  })
})

describe("Contador HUB — navegação sem contagem inventada (GOAL 023)", () => {
  it("a seção Documentos perdeu o count hardcoded 4", () => {
    expect(dataSrc).not.toMatch(/id:\s*"documentos"[\s\S]{0,120}count:/)
    expect(dataSrc).not.toMatch(/\bcount\s*[?:]/)
  })

  it("nenhuma seção do catálogo declara contador numérico", () => {
    expect(dataSrc).not.toMatch(/count:\s*\d+/)
    // A nav também não renderiza mais `s.count`.
    expect(hubSrc).not.toContain("s.count")
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

describe("Contador HUB — CTAs sem efeito real não podem parecer operacionais (Passo 2 · GOAL 023)", () => {
  it("não existe mais nenhum CTA no-op: o helper `noop` e o toast honesto saíram", () => {
    // Passo 2 (GOAL 002) exigia que todo CTA sem efeito fosse `disabled` + `title`.
    // O GOAL 023 fechou a conta pela raiz: os CTAs falsos foram removidos, não
    // desabilitados. Sem call site, o helper e o texto único perdem função.
    expect(hubSrc).not.toMatch(/\bnoop\(/)
    expect(hubSrc).not.toContain("const noop =")
    expect(hubSrc).not.toContain("CTA_INDISPONIVEL_TITLE")
    expect(hubSrc).not.toContain("pré-visualização, sem efeito real nesta fase")
  })

  it("nenhum <Btn>/<Switch> do HUB está desabilitado por ser preview", () => {
    const tags = hubSrc.match(JSX_TAG) ?? []
    const desabilitados = tags.filter((t) => /\bdisabled\b/.test(t))
    // O único `disabled` legítimo é o do Pacote — condicionado a dado real, não a fase.
    const semJustificativa = desabilitados.filter((t) => !/disabled=\{!realData\}/.test(t))
    expect(
      semJustificativa,
      `CTA(s) desabilitado(s) sem motivo de dado real: ${semJustificativa.join(" | ")}`,
    ).toEqual([])
  })

  it("o Pacote do Contador deixou de ser um CTA de preview desabilitado (GOAL 008)", () => {
    // PacoteCard (lista ilustrativa + botão disabled) deu lugar ao download real
    // (ContadorPacoteDownload). O antigo rótulo de preview não pode sobreviver.
    expect(hubSrc).not.toContain("function PacoteCard(")
    expect(hubSrc).not.toContain("Baixar pacote · preview")
    expect(hubSrc).not.toContain("Gerar pacote · preview")
    expect(hubSrc).toContain("<ContadorPacoteDownload")
  })

  it("'Ver exemplo' saiu da seção Obrigações (GOAL 016 realificou a aba)", () => {
    expect(hubSrc).not.toContain("Ver exemplo")
  })

  it("as ações falsas de Dossiês e Folha saíram (GOAL 023)", () => {
    expect(hubSrc).not.toContain("Montar dossiê")
    expect(hubSrc).not.toContain("Baixar pacote do dossiê")
    expect(hubSrc).not.toContain("Adicionar funcionário")
    expect(hubSrc).not.toContain("Ver holerite")
    expect(hubSrc).not.toContain("Salvar · preview")
  })
})

describe("Contador HUB — catálogos não podem afirmar estado da empresa (Passo 4 · GOAL 023)", () => {
  it("as linhas ilustrativas de Documentos e Obrigações foram removidas do catálogo", () => {
    // Eram fixtures mortas desde os GOALs 010/016 — o 023 apagou o código.
    expect(dataSrc).not.toContain("DOCUMENTOS_ROWS")
    expect(dataSrc).not.toContain("OBRIGACOES_ROWS")
    expect(dataSrc).not.toContain("NF-e de venda 001234")
    expect(dataSrc).not.toContain("Honorários do contador")
  })

  it("as fixtures mortas da Visão geral, do fechamento e de permissões saíram", () => {
    for (const morta of [
      "VISAO_KPIS",
      "VISAO_ALERTAS",
      "VISAO_DOSSIE_PROGRESS",
      "RESUMO_FINANCEIRO",
      "FECHAMENTO_CHECKLIST",
      "PERMISSOES_ROWS",
      "COMPETENCIA_INICIAL",
    ]) {
      expect(dataSrc, `fixture morta ainda presente: ${morta}`).not.toContain(morta)
      expect(hubSrc, `fixture morta ainda consumida: ${morta}`).not.toContain(morta)
    }
  })

  it("nenhum valor monetário/contagem fixa sobrou no catálogo", () => {
    expect(dataSrc).not.toMatch(/R\$\s?\d/)
    expect(dataSrc).not.toContain("48,2k")
  })

  it("Visão geral, Documentos (010), Fechamento (012) e Obrigações (016) leem dados reais", () => {
    const renderVisaoIdx = hubSrc.indexOf("const renderVisao = ()")
    const renderFechamentoIdx = hubSrc.indexOf("const renderFechamento = ()")
    const renderDocumentosIdx = hubSrc.indexOf("const renderDocumentos = ()")
    const renderObrigacoesIdx = hubSrc.indexOf("const renderObrigacoes = ()")
    const renderRelatoriosIdx = hubSrc.indexOf("const renderRelatorios = ()")
    const visao = hubSrc.slice(renderVisaoIdx, renderFechamentoIdx)
    // A Visão geral perdeu o PreviewBanner porque perdeu os cartões ilustrativos.
    expect(visao).not.toContain("<PreviewBanner")
    expect(visao).toContain("<VisaoGeralReal")
    expect(visao).toContain("<ContadorAvisosReal")
    expect(visao).toContain("checklistFechamento.contagem")
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

  it("o progresso fabricado '3 de 9 / 35%' saiu da Visão geral (GOAL 023)", () => {
    // GOAL 007 removeu o mock da seção Fechamento; o GOAL 023 removeu o que
    // sobrava na Visão geral, substituindo pelas contagens REAIS do checklist.
    expect(hubSrc).not.toContain("itens concluídos")
    expect(hubSrc).not.toContain("3 de 9")
    expect(hubSrc).not.toContain("ProgressRing")
    expect(hubSrc).not.toContain("Números ilustrativos de preview")
  })

  it("o breadcrumb não inventa nome de unidade", () => {
    expect(hubSrc).not.toMatch(/<span>Matriz<\/span>/)
    expect(hubSrc).toContain("identificacaoLoja?.nome")
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

describe("Contador HUB — a Visão geral usa a contagem REAL do checklist (CORREÇÃO 9 · GOAL 023)", () => {
  it("o cartão de fechamento da Visão geral lê `checklistFechamento.contagem`, sem percentual", () => {
    const renderVisaoIdx = hubSrc.indexOf("const renderVisao = ()")
    const renderFechamentoIdx = hubSrc.indexOf("const renderFechamento = ()")
    const visao = hubSrc.slice(renderVisaoIdx, renderFechamentoIdx)
    expect(visao).toContain("checklistFechamento.contagem.total")
    expect(visao).toContain("checklistFechamento.contagem.ok")
    expect(visao).toContain("checklistFechamento.contagem.nao_disponivel")
    // Sem anel de progresso, sem percentagem, sem "concluído".
    expect(visao).not.toContain("ProgressRing")
    expect(visao).not.toContain("35%")
    expect(visao.toLowerCase()).not.toContain("concluíd")
  })

  it("o checklist real derivado (seção Fechamento) segue sem ProgressRing nem percentagem", () => {
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

/* ────────── GOAL 018 — relatório fiscal somente leitura ────────── */

describe("Contador HUB — relatório fiscal read-only (GOAL 018)", () => {
  it("exibe estado da fonte, entregáveis, rejeitadas e canceladas", () => {
    expect(realSrc).toContain("function RelatorioFiscalReal")
    expect(realSrc).toContain("Estado da fonte")
    expect(realSrc).toContain("Entregáveis (05-XML)")
    expect(realSrc).toContain("Rejeitadas")
    expect(realSrc).toContain("Canceladas")
    expect(hubSrc).toContain("<RelatorioFiscalReal")
  })

  it("não oferece emissão, cancelamento, inutilização, correção ou reprocessamento", () => {
    const fnStart = realSrc.indexOf("export function RelatorioFiscalReal")
    const nextExport = realSrc.indexOf("\nexport ", fnStart + 1)
    const bloco = realSrc.slice(fnStart, nextExport === -1 ? realSrc.length : nextExport)
    expect(bloco).toContain("Somente leitura")
    expect(bloco).not.toMatch(/<button/i)
    expect(bloco).not.toMatch(/\bEmitir\b|\bCancelar NFC|\bInutilizar\b|\bCarta de correção\b|\bReprocessar\b/i)
  })
})

/* ────────── GOAL 023 — Folha, Portal, Configurações e Dossiês honestos ────────── */

describe("Contador HUB — Folha & DP REAL (GOAL 023)", () => {
  const folhaSrc = readFileSync(join(DIR, "folha/contador-folha-real.tsx"), "utf8")

  it("nenhum funcionário fictício sobreviveu — no catálogo, no HUB ou na aba", () => {
    for (const src of [dataSrc, hubSrc, folhaSrc]) {
      expect(src).not.toContain("FOLHA_FUNCIONARIOS")
      expect(src).not.toContain("Ana Souza")
      expect(src).not.toContain("Carlos Lima")
      expect(src).not.toContain("Marina Reis")
      // O pró-labore ilustrativo trazia até o nome do sócio.
      expect(src).not.toContain("Rafael (titular)")
    }
  })

  it("a seção monta o componente real e não uma tabela estática", () => {
    const inicio = hubSrc.indexOf("const renderFolha = ()")
    const fim = hubSrc.indexOf("const renderPortal = ()")
    expect(inicio).toBeGreaterThan(-1)
    const secao = hubSrc.slice(inicio, fim)
    expect(secao).toContain("<ContadorFolhaReal")
    expect(secao).not.toContain("<PreviewBanner")
    expect(secao).not.toContain("<table")
  })

  it("lê o domínio de Documentos filtrando pela categoria FOLHA", () => {
    expect(folhaSrc).toContain('const CATEGORIA_FOLHA = "folha"')
    expect(folhaSrc).toContain("/api/contador/documentos?c=")
    expect(folhaSrc).toContain("categoria=${CATEGORIA_FOLHA}")
  })

  it("cobre carregando, vazio e erro — e o vazio explica o que aparece ali", () => {
    expect(folhaSrc).toContain("Carregando documentos de folha…")
    expect(folhaSrc).toContain("Nenhum documento de folha em")
    expect(folhaSrc).toContain("aparecem aqui automaticamente")
    expect(folhaSrc).toContain("Documentos de folha indisponíveis.")
    expect(folhaSrc).toContain("Download não autorizado.")
  })

  it("o download reusa a autorização real (POST → URL assinada), sem storageRef", () => {
    expect(folhaSrc).toContain("/download")
    expect(folhaSrc).toContain('method: "POST"')
    expect(folhaSrc).not.toContain("storageRef")
  })

  it("diz explicitamente o que NÃO faz e não cria motor de RH", () => {
    expect(folhaSrc).toContain("não calcula folha")
    expect(folhaSrc).toContain("eSocial")
    expect(folhaSrc).not.toMatch(/\b(prisma|Funcionario|Colaborador|Holerite)\b/)
  })

  it("nunca envia loja nem autor pelo cliente", () => {
    expect(folhaSrc).not.toMatch(/\b(storeId|lojaId)\b/)
    const corpos = folhaSrc.match(/JSON\.stringify\(\{[\s\S]*?\}\)/g) ?? []
    for (const corpo of corpos) {
      expect(corpo).not.toMatch(/\b(autorId|atorId|storeId|lojaId|papel|role|userId)\b/)
    }
  })
})

describe("Contador HUB — Portal do contador com resumo REAL (GOAL 023)", () => {
  const portalSrc = readFileSync(join(DIR, "portal/contador-portal-resumo.tsx"), "utf8")

  it("o escritório fictício e o contato de exemplo saíram", () => {
    for (const src of [hubSrc, dataSrc, portalSrc]) {
      expect(src).not.toContain("Escritório Contábil Exemplo")
      expect(src).not.toContain("contato@escritorio.com.br")
    }
  })

  it("a seção monta o resumo real e liga o gerenciamento a Permissões", () => {
    const inicio = hubSrc.indexOf("const renderPortal = ()")
    const fim = hubSrc.indexOf("const renderPermissoes = ()")
    const secao = hubSrc.slice(inicio, fim)
    expect(secao).toContain("<ContadorPortalResumo")
    expect(secao).toContain('goSection("permissoes")')
    // ADR-CONTADOR-002: simular a sessão do contador continua fora de escopo.
    expect(secao).not.toContain("Pré-visualizar como contador")
  })

  it("consome exatamente os contratos que Permissões já usa", () => {
    expect(portalSrc).toContain("/api/contador-externo/acessos")
    expect(portalSrc).toContain("/api/contador-externo/convites")
    // Somente leitura: nada de POST/PUT/DELETE nesta fatia.
    expect(portalSrc).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/)
    expect(portalSrc).not.toMatch(/\b(storeId|lojaId)\b/)
  })

  it("cobre carregando, sem permissão, erro e vazio — sem confundir 403 com ausência", () => {
    expect(portalSrc).toContain("Carregando acesso externo…")
    expect(portalSrc).toContain("Visível apenas para quem gerencia acesso.")
    expect(portalSrc).toContain("Isso não")
    expect(portalSrc).toContain("Acesso externo indisponível.")
    expect(portalSrc).toContain("Nenhum contador com vínculo ativo nesta loja")
  })

  it("as métricas vêm dos DTOs, não de números fixos", () => {
    expect(portalSrc).toContain("valor={ativos.length}")
    expect(portalSrc).toContain("valor={pendentes.length}")
    expect(portalSrc).toContain("valor={suspensos.length}")
    expect(portalSrc).toContain("valor={revogados.length}")
  })

  it("a lista de capacidades do portal não promete upload", () => {
    const podeIdx = dataSrc.indexOf("export const PORTAL_PODE")
    const naoPodeIdx = dataSrc.indexOf("export const PORTAL_NAO_PODE")
    const pode = dataSrc.slice(podeIdx, naoPodeIdx)
    expect(pode).not.toMatch(/Enviar documentos|upload/i)
    expect(dataSrc.slice(naoPodeIdx)).toContain("Enviar documentos")
  })
})

describe("Contador HUB — Configurações sem empresa de exemplo (GOAL 023)", () => {
  it("razão social e CNPJ fictícios saíram do HUB", () => {
    expect(hubSrc).not.toContain("Loja Exemplo Ltda")
    expect(hubSrc).not.toContain("00.000.000/0001-00")
    expect(dataSrc).not.toContain("Loja Exemplo")
  })

  it("os dados da empresa vêm do cadastro persistido da loja ativa", () => {
    const inicio = hubSrc.indexOf("const renderConfig = ()")
    const fim = hubSrc.indexOf("const SECTION_RENDERERS")
    const secao = hubSrc.slice(inicio, fim)
    expect(secao).toContain("identificacaoLoja")
    expect(secao).toContain("identificacaoLoja.nome")
    expect(secao).toContain("identificacaoLoja.cnpj")
    expect(secao).toContain("Cadastro da loja indisponível.")
  })

  it("controles sem persistência foram OCULTADOS, não fingidos", () => {
    const inicio = hubSrc.indexOf("const renderConfig = ()")
    const fim = hubSrc.indexOf("const SECTION_RENDERERS")
    const secao = hubSrc.slice(inicio, fim)
    expect(secao).not.toContain("<select")
    expect(secao).not.toContain("<Switch")
    expect(secao).not.toMatch(/Salvar/)
    expect(secao).toContain("planejado")
  })

  it("a leitura da loja é server-side e escopada, sem endpoint novo", () => {
    const lojaSrc = readFileSync(join(DIR, "../../../lib/contador/readers/loja.ts"), "utf8")
    const pageSrc = readFileSync(join(DIR, "../../../app/dashboard/contador/page.tsx"), "utf8")
    expect(lojaSrc).toContain("scope.storeId")
    expect(lojaSrc).toContain("select: { id: true, name: true, cnpj: true }")
    // Só leitura: nenhum create/update/delete no reader.
    expect(lojaSrc).not.toMatch(/\.(create|update|upsert|delete|deleteMany|updateMany)\(/)
    expect(pageSrc).toContain("lerIdentificacaoLoja(escopo)")
    expect(pageSrc).toContain("[contador/loja]")
    // A falha é isolada — nunca derruba os demais sinais nem vira empresa de exemplo.
    expect(pageSrc).toMatch(/\[contador\/loja\][\s\S]{0,160}identificacaoLoja = null/)
  })
})

describe("Contador HUB — Dossiês HÍBRIDA honesta (GOAL 023)", () => {
  it("o status fabricado por documento (atualizado/vencido) deixou de existir", () => {
    expect(dataSrc).not.toMatch(/status:\s*"(atualizado|vencido|pendente)"/)
    expect(dataSrc).not.toContain("DossieStatus")
    // …e o filtro por situação sumiu junto: o HUB não sabe essa situação.
    expect(dataSrc).not.toMatch(/id:\s*"vencido"/)
    expect(dataSrc).not.toMatch(/id:\s*"atualizado"/)
  })

  it("os itens de origem `sistema` leem o DTO real da competência", () => {
    expect(hubSrc).toContain("function LeituraDossie(")
    expect(hubSrc).toContain("function lerMetricaSistema(")
    expect(hubSrc).toContain("dados.financeiro.titulosPagarAberto")
    expect(hubSrc).toContain("dados.financeiro.titulosReceberAberto")
    expect(hubSrc).toContain("dados.financeiro")
    expect(hubSrc).toContain("dados.vendas.formaPagamentoDisponibilidade")
    // A disponibilidade declarada pelo DTO é exibida — nunca substituída por "OK".
    expect(hubSrc).toContain("DISP_CHIP[leitura.disponibilidade]")
  })

  it("item `sistema` sem métrica mapeada é dito por extenso, nunca preenchido", () => {
    expect(hubSrc).toContain("sem fonte no OmniGestão nesta fase")
    expect(hubSrc).toContain("leitura indisponível")
    expect(hubSrc).toContain("não rastreado pelo sistema")
  })

  it("só `anexar` tem CTA — as demais origens mostram instrução, não botão", () => {
    const inicio = hubSrc.indexOf("const renderDossies = ()")
    const fim = hubSrc.indexOf("const renderFolha = ()")
    const secao = hubSrc.slice(inicio, fim)
    expect(secao).toContain("Enviar em Documentos")
    expect(secao).toContain('goSection("documentos")')
    expect(secao).toContain("ORIGEM_COMO_OBTER[row.origem]")
    expect(secao).not.toContain("disabled")
  })

  it("o Radar CNPJ não afirma mais situação de certidão/alvará", () => {
    expect(dataSrc).not.toMatch(/status:\s*"(válida|vencida|ativa|em dia|entregue)"/)
    expect(dataSrc).not.toContain("CND Federal válida")
    expect(dataSrc).not.toContain("2 pendências")
    expect(dataSrc).toContain("onde:")
    expect(hubSrc).toContain("não verificado")
  })
})

describe("Contador HUB — Relatórios apontam o arquivo real do Pacote (GOAL 023)", () => {
  it("os botões de exportação individual saíram e o índice do pacote entrou", () => {
    const inicio = hubSrc.indexOf("const renderRelatorios = ()")
    const fim = hubSrc.indexOf("const renderDossies = ()")
    const secao = hubSrc.slice(inicio, fim)
    expect(secao).toContain("arquivosPacote")
    expect(secao).toContain("no pacote:")
    expect(secao).not.toContain("r.formats")
    expect(secao).not.toContain("disabled")
    expect(secao).toContain("<ContadorPacoteDownload")
  })

  it("o catálogo aponta caminhos que existem de fato no ZIP", () => {
    const fontesSrc = readFileSync(join(DIR, "../../../lib/contador/pacote/fontes.ts"), "utf8")
    const caminhos = [...dataSrc.matchAll(/"(\d\d-[A-Z-]+\/[a-z_]+\.(?:csv|md))"/g)].map((m) => m[1])
    expect(caminhos.length).toBeGreaterThan(0)
    for (const c of caminhos) {
      expect(fontesSrc, `caminho inexistente no pacote: ${c}`).toContain(`"${c}"`)
    }
  })

  it("relatório sem fonte é dito sem fonte, não exportado em silêncio", () => {
    expect(dataSrc).toMatch(/title: "Posição de estoque"[\s\S]{0,220}arquivosPacote: \[\]/)
    expect(hubSrc).toContain("Não entra no Pacote do Contador nesta fase")
  })
})
