/**
 * Gerador de XML NFC-e (modelo 65) layout 4.00 — PURO e DORMENTE (BL-FISCAL-004).
 *
 * Princípios (ADR-0008 P3/P4/P5):
 *  - CONSOME exclusivamente o Snapshot Fiscal congelado (`VendaFiscalSnapshot`). Nenhum dado vivo.
 *  - NÃO recalcula tributo: todo valor de imposto vem de `snapshot.tributacao` (motor F2 congelado).
 *  - SEM efeitos colaterais, SEM Prisma/fetch/Next/React. Determinístico (sem Date.now/random).
 *  - NÃO assina, NÃO transmite, NÃO gera DANFE, NÃO toca PDV/Caixa/Financeiro.
 *
 * Campos que o snapshot NÃO carrega (numeração série/número, cNF, parâmetros de emissão) entram
 * pelo `NfceXmlContext` opcional; ausentes → PLACEHOLDER sinalizado como pendência (ver validação).
 *
 * Mapeamentos fiscais do baseline Simples Nacional NFC-e:
 *  - ICMS  → grupo `ICMSSN102` (CSOSN 102/103/300/400), `ICMSSN101` (CSOSN 101, crédito do Simples)
 *            ou `ICMSSN500` (CSOSN 500, ICMS já retido por ST — substituído; GOAL-006).
 *  - PIS   → grupo `PISOutr`    com CST 49 (recolhido no DAS, valores 0).
 *  - COFINS→ grupo `COFINSOutr` com CST 49.
 */

import { onlyDigits } from "../fiscal-validators"
import type {
  SnapshotItem,
  SnapshotItemTributos,
  VendaFiscalSnapshot,
} from "../venda-fiscal-snapshot"
import {
  aammDe,
  cNfDeterministico,
  codigoUf,
  formatDhEmi,
  montarChaveAcesso,
} from "./nfce-chave-acesso"
import { validateNfceSnapshot } from "./nfce-xml-validation"
import {
  NFCE_MODELO,
  NFCE_VER_PROC,
  NFCE_XMLNS,
  NFCE_XML_VERSAO,
  NfceXmlError,
  type BuildNfceXmlResult,
  type NfceXmlContext,
} from "./nfce-xml.types"
import { infNFeSuplOnlineNode, resolveNfceInfNFeSuplOnline } from "./nfce-infnfesupl-online"
import {
  group,
  leaf,
  leafRequired,
  serializeXmlDocument,
  serializeXmlEmbeddable,
  type XmlNode,
} from "./xml-writer"

// ── Formatadores numéricos (estruturais — não são cálculo tributário) ────────────────────

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}
function dec2(n: number): string {
  return round2(n).toFixed(2)
}
function dec4(n: number): string {
  return (Number.isFinite(n) ? n : 0).toFixed(4)
}

function resolveGtin(gtin: string): string {
  const d = onlyDigits(gtin)
  return d.length === 8 || d.length === 12 || d.length === 13 || d.length === 14 ? d : "SEM GTIN"
}

/** Origem da mercadoria (0..8). Ausente → "0" (nacional) — sinalizado como pendência na validação. */
function resolveOrig(origem: string): string {
  const d = onlyDigits(origem)
  if (d.length >= 1) {
    const first = Number(d[0])
    if (first >= 0 && first <= 8) return d[0]
  }
  return "0"
}

// ── Grupos de imposto (consomem snapshot.tributacao — nunca recalculam) ──────────────────

function buildIcmsNode(orig: string, trib: SnapshotItemTributos): XmlNode {
  const csosn = onlyDigits(trib.icms.codigo) || "102"
  if (csosn === "101") {
    // CSOSN 101 — crédito do Simples (pCredSN/vCredICMSSN informativos; ICMS próprio não destacado).
    return group("ICMS", [
      group("ICMSSN101", [
        leafRequired("orig", orig),
        leafRequired("CSOSN", "101"),
        leafRequired("pCredSN", dec4(trib.icms.pCredSN)),
        leafRequired("vCredICMSSN", dec2(trib.icms.valorCreditoSimples)),
      ]),
    ])
  }
  if (csosn === "500") {
    // CSOSN 500 — ICMS cobrado anteriormente por ST (substituído). Grupo ICMSSN500 (leiaute 4.00).
    // ICMS próprio NÃO destacado; os campos condicionais de ST retido/ICMS efetivo entram quando o
    // Snapshot passar a transportá-los (GOAL de fiação end-to-end). Enquanto isso, o motor barra a
    // montante o CSOSN 500 sem identificação de ST (st_incompleta → tributacao pendente → validação
    // do XML bloqueia), então nunca chega aqui um 500 "vazio" pelo fluxo real. Ver ADR-0012.
    return group("ICMS", [
      group("ICMSSN500", [leafRequired("orig", orig), leafRequired("CSOSN", "500")]),
    ])
  }
  // CSOSN 102/103/300/400 — sem destaque de ICMS (imposto no DAS). Grupo ICMSSN102.
  return group("ICMS", [
    group("ICMSSN102", [leafRequired("orig", orig), leafRequired("CSOSN", csosn)]),
  ])
}

function buildPisNode(pis: SnapshotItemTributos["pis"]): XmlNode {
  const cst = onlyDigits(pis.codigo) || "49"
  // CST 49 ("outras operações de saída") → grupo PISOutr com alíquota em %.
  return group("PIS", [
    group("PISOutr", [
      leafRequired("CST", cst),
      leafRequired("vBC", dec2(pis.baseCalculo)),
      leafRequired("pPIS", dec4(pis.aliquota)),
      leafRequired("vPIS", dec2(pis.valor)),
    ]),
  ])
}

function buildCofinsNode(cofins: SnapshotItemTributos["cofins"]): XmlNode {
  const cst = onlyDigits(cofins.codigo) || "49"
  return group("COFINS", [
    group("COFINSOutr", [
      leafRequired("CST", cst),
      leafRequired("vBC", dec2(cofins.baseCalculo)),
      leafRequired("pCOFINS", dec4(cofins.aliquota)),
      leafRequired("vCOFINS", dec2(cofins.valor)),
    ]),
  ])
}

function buildImpostoNode(item: SnapshotItem, trib: SnapshotItemTributos): XmlNode {
  const orig = resolveOrig(item.origemMercadoria)
  const children: Array<XmlNode | null> = []
  // vTotTrib (Lei da Transparência) — opcional; só emite quando informado (>0).
  if (trib.valorAproximadoTributos > 0) {
    children.push(leafRequired("vTotTrib", dec2(trib.valorAproximadoTributos)))
  }
  children.push(buildIcmsNode(orig, trib))
  children.push(buildPisNode(trib.pis))
  children.push(buildCofinsNode(trib.cofins))
  return group("imposto", children)
}

// ── det (produto + imposto) ──────────────────────────────────────────────────────────────

type ItemDerivado = { vProd: number; vDesc: number }

/** Valores estruturais do item derivados do snapshot (somatórios, não cálculo de imposto). */
function derivarItem(item: SnapshotItem, trib: SnapshotItemTributos): ItemDerivado {
  const vProd = round2(item.quantidade * item.valorUnitario)
  // Desconto efetivo do item: bruto − valorTributável (frete/seguro/outras = 0 no baseline).
  // Recupera o rateio do desconto de cabeçalho aplicado pelo motor (mantém ΣvDesc = desconto da nota).
  const vDesc = Math.max(0, round2(vProd - trib.valorTributavel))
  return { vProd, vDesc }
}

function buildDetNode(item: SnapshotItem, trib: SnapshotItemTributos, der: ItemDerivado): XmlNode {
  const gtin = resolveGtin(item.gtin)
  const prod = group("prod", [
    leafRequired("cProd", item.codigoProduto || String(item.numeroItem)),
    leafRequired("cEAN", gtin),
    leafRequired("xProd", item.descricao || item.codigoProduto || `Item ${item.numeroItem}`),
    leafRequired("NCM", onlyDigits(item.ncm)),
    leaf("CEST", onlyDigits(item.cest) || null),
    leafRequired("CFOP", onlyDigits(item.cfop)),
    leafRequired("uCom", item.unidadeComercial || "UN"),
    leafRequired("qCom", dec4(item.quantidade)),
    leafRequired("vUnCom", dec2(item.valorUnitario)),
    leafRequired("vProd", dec2(der.vProd)),
    leafRequired("cEANTrib", gtin),
    leafRequired("uTrib", item.unidadeTributavel || item.unidadeComercial || "UN"),
    leafRequired("qTrib", dec4(item.quantidade)),
    leafRequired("vUnTrib", dec2(item.valorUnitario)),
    der.vDesc > 0 ? leafRequired("vDesc", dec2(der.vDesc)) : null,
    leafRequired("indTot", "1"),
  ])
  return group("det", [prod, buildImpostoNode(item, trib)], { nItem: String(item.numeroItem) })
}

// ── pag (best-effort sobre o paymentBreakdown congelado) ─────────────────────────────────

const MAP_TPAG: Record<string, string> = {
  dinheiro: "01", especie: "01", cash: "01",
  cheque: "02",
  credito: "03", cartaocredito: "03", creditcard: "03",
  debito: "04", cartaodebito: "04", debitcard: "04",
  creditoloja: "05", crediario: "05",
  valealimentacao: "10", valerefeicao: "11", valepresente: "12",
  boleto: "15", boletobancario: "15",
  deposito: "16",
  pix: "17",
  transferencia: "18", ted: "18", doc: "18",
  fidelidade: "19", cashback: "19",
  sempagamento: "90",
  vale: "99", outros: "99", outro: "99",
}
function tPagDe(key: string): string {
  const k = key.toLowerCase().replace(/[^a-z]/g, "")
  return MAP_TPAG[k] ?? "99"
}

type Pagamento = { tPag: string; vPag: number }

function parsePagamentos(breakdown: Record<string, unknown> | null): Pagamento[] {
  if (!breakdown) return []
  if (Array.isArray(breakdown)) {
    return (breakdown as unknown[])
      .map((entry): Pagamento => {
        const o = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {}
        const rawKey = String(o.forma ?? o.tipo ?? o.metodo ?? o.method ?? o.tPag ?? "")
        const valor = round2(Number(o.valor ?? o.amount ?? o.vPag ?? o.value ?? 0))
        const tPag = /^\d{2}$/.test(rawKey) ? rawKey : tPagDe(rawKey)
        return { tPag, vPag: valor }
      })
      .filter((p) => p.vPag > 0)
  }
  return Object.keys(breakdown)
    .map((k): Pagamento => ({ tPag: tPagDe(k), vPag: round2(Number(breakdown[k])) }))
    .filter((p) => p.vPag > 0)
}

/**
 * Resolve as formas de pagamento. Usa o detalhamento congelado quando ele FECHA com o total
 * (Σ vPag = vNF, tolerância de 1 centavo); caso contrário, cai para um único `detPag` com o
 * total (garante consistência exigida pela SEFAZ). NFC-e exige `pag` com ao menos um `detPag`.
 */
function buildPagNode(snapshot: VendaFiscalSnapshot, vNF: number): XmlNode {
  const totalR = round2(vNF)
  const parsed = parsePagamentos(snapshot.venda.paymentBreakdown)
  const soma = round2(parsed.reduce((s, p) => s + p.vPag, 0))
  const pagamentos: Pagamento[] =
    parsed.length > 0 && Math.abs(soma - totalR) <= 0.01 ? parsed : [{ tPag: "01", vPag: totalR }]
  return group(
    "pag",
    pagamentos.map((p) => group("detPag", [leafRequired("tPag", p.tPag), leafRequired("vPag", dec2(p.vPag))])),
  )
}

// ── emit / dest / ide ────────────────────────────────────────────────────────────────────

function buildEmitNode(snapshot: VendaFiscalSnapshot): XmlNode {
  const e = snapshot.emitente
  const crt = e.crt >= 1 && e.crt <= 4 ? e.crt : 1
  const enderEmit = group("enderEmit", [
    leafRequired("xLgr", e.endereco.logradouro || "SEM LOGRADOURO"),
    leafRequired("nro", e.endereco.numero || "SN"),
    leaf("xCpl", e.endereco.complemento || null),
    leafRequired("xBairro", e.endereco.bairro || "SEM BAIRRO"),
    leafRequired("cMun", onlyDigits(e.endereco.codigoMunicipioIbge)),
    leafRequired("xMun", e.endereco.municipio || "SEM MUNICIPIO"),
    leafRequired("UF", e.endereco.uf),
    leaf("CEP", onlyDigits(e.endereco.cep) || null),
    leafRequired("cPais", onlyDigits(e.endereco.codigoPais) || "1058"),
    leafRequired("xPais", "BRASIL"),
    leaf("fone", onlyDigits(e.fone) || null),
  ])
  return group("emit", [
    leafRequired("CNPJ", onlyDigits(e.cnpj)),
    leafRequired("xNome", e.razaoSocial),
    leaf("xFant", e.nomeFantasia || null),
    enderEmit,
    leafRequired("IE", onlyDigits(e.inscricaoEstadual) || "ISENTO"),
    leafRequired("CRT", String(crt)),
  ])
}

/** Destinatário NFC-e: só emitido quando há CPF/CNPJ válido (consumidor sem documento → sem grupo). */
function buildDestNode(snapshot: VendaFiscalSnapshot): XmlNode | null {
  const d = snapshot.destinatario
  if (!d) return null
  const doc = onlyDigits(d.documento ?? "")
  const docNode =
    d.documentoTipo === "CPF" && doc.length === 11
      ? leaf("CPF", doc)
      : d.documentoTipo === "CNPJ" && doc.length === 14
        ? leaf("CNPJ", doc)
        : null
  if (!docNode) return null
  const children: Array<XmlNode | null> = [docNode]
  if (d.nome) children.push(leaf("xNome", d.nome))
  children.push(leafRequired("indIEDest", "9")) // 9 = não contribuinte
  if (d.email) children.push(leaf("email", d.email))
  return group("dest", children)
}

function buildIdeNode(args: {
  cUF: string
  cNF: string
  natOp: string
  serie: number
  numero: number
  dhEmi: string
  cMunFG: string
  tpEmis: number
  cDV: string
  tpAmb: number
  verProc: string
}): XmlNode {
  return group("ide", [
    leafRequired("cUF", args.cUF),
    leafRequired("cNF", args.cNF),
    leafRequired("natOp", args.natOp),
    leafRequired("mod", NFCE_MODELO),
    leafRequired("serie", String(args.serie)),
    leafRequired("nNF", String(args.numero)),
    leafRequired("dhEmi", args.dhEmi),
    leafRequired("tpNF", "1"), // 1 = saída
    leafRequired("idDest", "1"), // 1 = operação interna
    leafRequired("cMunFG", args.cMunFG),
    leafRequired("tpImp", "4"), // 4 = DANFE NFC-e
    leafRequired("tpEmis", String(args.tpEmis)),
    leafRequired("cDV", args.cDV),
    leafRequired("tpAmb", String(args.tpAmb)),
    leafRequired("finNFe", "1"), // 1 = normal
    leafRequired("indFinal", "1"), // 1 = consumidor final
    leafRequired("indPres", "1"), // 1 = presencial
    leafRequired("procEmi", "0"), // 0 = aplicativo do contribuinte
    leafRequired("verProc", args.verProc),
  ])
}

function buildTotalNode(snapshot: VendaFiscalSnapshot, vProdTotal: number, vDescTotal: number, vNF: number): XmlNode {
  const tt = snapshot.tributacao!.totais
  return group("total", [
    group("ICMSTot", [
      leafRequired("vBC", dec2(tt.baseCalculoIcms)),
      leafRequired("vICMS", dec2(tt.valorIcms)),
      leafRequired("vICMSDeson", dec2(0)),
      leafRequired("vFCP", dec2(0)),
      leafRequired("vBCST", dec2(0)),
      leafRequired("vST", dec2(0)),
      leafRequired("vFCPST", dec2(0)),
      leafRequired("vFCPSTRet", dec2(0)),
      leafRequired("vProd", dec2(vProdTotal)),
      leafRequired("vFrete", dec2(0)),
      leafRequired("vSeg", dec2(0)),
      leafRequired("vDesc", dec2(vDescTotal)),
      leafRequired("vII", dec2(0)),
      leafRequired("vIPI", dec2(0)),
      leafRequired("vIPIDevol", dec2(0)),
      leafRequired("vPIS", dec2(tt.valorPis)),
      leafRequired("vCOFINS", dec2(tt.valorCofins)),
      leafRequired("vOutro", dec2(0)),
      leafRequired("vNF", dec2(vNF)),
      leafRequired("vTotTrib", dec2(tt.valorAproximadoTributos)),
    ]),
  ])
}

// ── Builder principal ────────────────────────────────────────────────────────────────────

function buildInternal(
  snapshot: VendaFiscalSnapshot,
  contexto?: NfceXmlContext,
  destino: "standalone" | "embutivel" = "standalone",
): BuildNfceXmlResult {
  const validacao = validateNfceSnapshot(snapshot, contexto)
  if (!validacao.ok) {
    const first = validacao.erros[0]
    throw new NfceXmlError(first.code, first.mensagem, first.itemIndex, first.campo)
  }

  const emit = snapshot.emitente
  const cUF = codigoUf(emit.endereco.uf)!
  const cnpj = onlyDigits(emit.cnpj)

  const serie = Number.isFinite(contexto?.serie) ? Number(contexto?.serie) : 0
  const numero = Number.isFinite(contexto?.numero) ? Number(contexto?.numero) : 0
  const numeracaoPlaceholder = !contexto || !Number.isFinite(contexto.numero) || Number(contexto.numero) <= 0
  const tpEmis = Number.isFinite(contexto?.tpEmis) ? Number(contexto?.tpEmis) : 1
  const dataEmissao = contexto?.dataEmissao ?? snapshot.venda.data
  const natOp = (contexto?.naturezaOperacao ?? "VENDA AO CONSUMIDOR").trim() || "VENDA AO CONSUMIDOR"
  const verProc = (contexto?.versaoAplicativo ?? NFCE_VER_PROC).trim() || NFCE_VER_PROC

  const aamm = aammDe(dataEmissao)
  const cNF = onlyDigits(contexto?.cNF ?? "") || cNfDeterministico(`${snapshot.vendaId}:${serie}:${numero}`, numero)
  const chave = montarChaveAcesso({
    cUF,
    aamm,
    cnpj,
    modelo: NFCE_MODELO,
    serie,
    numero,
    tpEmis,
    cNF,
  })
  const cDV = chave.slice(-1)
  const tpAmb = String(emit.ambiente).toUpperCase() === "PRODUCAO" ? 1 : 2

  // det + somatórios (estruturais).
  const tribByNum = new Map<number, SnapshotItemTributos>()
  for (const t of snapshot.tributacao!.itens) tribByNum.set(t.numeroItem, t)

  let vProdTotal = 0
  let vDescTotal = 0
  const detNodes: XmlNode[] = snapshot.itens.map((item) => {
    const trib = tribByNum.get(item.numeroItem)
    if (!trib) {
      throw new NfceXmlError(
        "tributacao_desalinhada",
        `Item ${item.numeroItem} sem tributação congelada correspondente.`,
        item.numeroItem,
      )
    }
    const der = derivarItem(item, trib)
    vProdTotal = round2(vProdTotal + der.vProd)
    vDescTotal = round2(vDescTotal + der.vDesc)
    return buildDetNode(item, trib, der)
  })

  const vNF = round2(vProdTotal - vDescTotal)

  const ide = buildIdeNode({
    cUF,
    cNF,
    natOp,
    serie,
    numero,
    dhEmi: formatDhEmi(dataEmissao),
    cMunFG: onlyDigits(emit.endereco.codigoMunicipioIbge),
    tpEmis,
    cDV,
    tpAmb,
    verProc,
  })
  const emitNode = buildEmitNode(snapshot)
  const destNode = buildDestNode(snapshot)
  const totalNode = buildTotalNode(snapshot, vProdTotal, vDescTotal, vNF)
  const transpNode = group("transp", [leafRequired("modFrete", "9")]) // 9 = sem ocorrência de transporte
  const pagNode = buildPagNode(snapshot, vNF)
  const infAdicNode = group("infAdic", [
    leafRequired(
      "infCpl",
      `Pedido ${snapshot.venda.pedidoId || snapshot.vendaId}. Documento gerado em modo dormente (sem valor fiscal).`,
    ),
  ])

  const infNFe = group(
    "infNFe",
    [ide, emitNode, destNode, ...detNodes, totalNode, transpNode, pagNode, infAdicNode],
    { versao: NFCE_XML_VERSAO, Id: `NFe${chave}` },
  )
  const infNFeSupl =
    contexto?.qrOnlineV3 !== undefined
      ? resolveNfceInfNFeSuplOnline({
          chave,
          tpAmb: tpAmb === 1 ? 1 : 2,
          config: contexto.qrOnlineV3,
        })
      : undefined
  // Ordem XSD TNfe: infNFe → infNFeSupl (0–1) → ds:Signature (o signer acrescenta a Signature).
  const nfe = group("NFe", [infNFe, infNFeSupl ? infNFeSuplOnlineNode(infNFeSupl) : null], {
    xmlns: NFCE_XMLNS,
  })
  // Sem declaração ⇒ contrato EMBUTÍVEL, provado byte a byte antes de sair daqui. Com declaração
  // ⇒ contrato de DOCUMENTO standalone. `omitDeclaration` cai no primeiro justamente para que não
  // exista nenhum caminho que produza NFC-e sem declaração sem passar pela prova de contrato.
  const embutivel = destino === "embutivel" || contexto?.omitDeclaration === true
  const xml = embutivel
    ? serializeXmlEmbeddable(nfe)
    : serializeXmlDocument(nfe, { declaration: true })

  return {
    xml,
    chaveAcesso: chave,
    serie,
    numero,
    numeracaoPlaceholder,
    validacao,
    ...(infNFeSupl ? { infNFeSupl } : {}),
  }
}

/**
 * Monta o XML NFC-e 4.00 STANDALONE a partir do snapshot congelado. PURO. Lança `NfceXmlError`
 * quando falta informação OBRIGATÓRIA (emitente/UF/itens/NCM/CFOP/tributação). Pendências
 * não-bloqueantes (numeração placeholder, IE/GTIN ausentes) NÃO impedem a montagem.
 *
 * ⚠️ Sai COM declaração `<?xml ?>` — é um documento, não conteúdo embutível. Para o caminho de
 * assinatura/transmissão use `buildNfceXmlAssinavel`.
 */
export function buildNfceXml(snapshot: VendaFiscalSnapshot, contexto?: NfceXmlContext): string {
  return buildInternal(snapshot, contexto).xml
}

/** Igual a `buildNfceXml`, mas devolve também chave de acesso, numeração e diagnóstico. */
export function buildNfceXmlResult(snapshot: VendaFiscalSnapshot, contexto?: NfceXmlContext): BuildNfceXmlResult {
  return buildInternal(snapshot, contexto)
}

/**
 * Produtor canônico do XML NFC-e destinado a ASSINATURA e TRANSMISSÃO (GOAL-016D-C0).
 *
 * Esta é a ÚNICA entrada sancionada para bytes que serão assinados, hasheados, persistidos em
 * `NotaFiscal.xmlAssinado` e concatenados dentro de `<nfeDadosMsg>` no envelope SOAP da SEFAZ.
 * Emite conteúdo EMBUTÍVEL (sem declaração, sem BOM, sem espaço fora da raiz) e prova o contrato
 * antes de devolver — nada aqui remove declaração depois: ela simplesmente nunca é escrita.
 *
 * `omitDeclaration` do contexto é irrelevante neste caminho: o destino já é embutível.
 */
export function buildNfceXmlAssinavel(snapshot: VendaFiscalSnapshot, contexto?: NfceXmlContext): string {
  return buildInternal(snapshot, contexto, "embutivel").xml
}

/** Igual a `buildNfceXmlAssinavel`, mas devolve chave de acesso, numeração e diagnóstico. */
export function buildNfceXmlAssinavelResult(
  snapshot: VendaFiscalSnapshot,
  contexto?: NfceXmlContext,
): BuildNfceXmlResult {
  return buildInternal(snapshot, contexto, "embutivel")
}
