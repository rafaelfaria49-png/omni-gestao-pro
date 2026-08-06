/**
 * Esteira do Dry-Run fiscal (BL-FISCAL-006 · TAREFA 2) — A SECO, dormente, em memória.
 *
 * `runFiscalDryRun(snapshot, opts)` executa: validação do snapshot → (tributação já congelada) →
 * geração de XML → assinatura com certificado de TESTE → verificação da assinatura → validação
 * XSD oficial → assinatura → validação estrutural → relatório. DESCARTA o XML (não persiste, não transmite, não
 * toca banco/SEFAZ). PURO exceto hashing (node:crypto). Determinístico (sem timestamps).
 */

import { createHash } from "node:crypto"
import {
  buildNfceXmlAssinavelResult,
  NfceXmlError,
  type NfceXmlContext,
} from "../xml"
import {
  signNfceXmlDetailed,
  verifyNfceSignature,
  NfceSignError,
  type FiscalCertificateMaterial,
} from "../signing"
import type { VendaFiscalSnapshot } from "../venda-fiscal-snapshot"
import type { XsdValidationAdapter } from "../xsd"
import { DRY_RUN_TEST_CERT } from "./dry-run-fixtures"
import { buildDryRunReport } from "./dry-run-report"
import { validarEstruturaNfce, validarXsd } from "./dry-run-validation"
import {
  type DryRunEtapa,
  type DryRunEtapaNome,
  type DryRunEtapaStatus,
  type DryRunReport,
  type DryRunValidacaoEstrutural,
  type DryRunXsd,
} from "./dry-run.types"

export type RunFiscalDryRunOptions = {
  /** Contexto de numeração/emissão (série/número). Ausente ⇒ placeholder (não emite de verdade). */
  contexto?: NfceXmlContext
  /** Certificado de TESTE (default: cert descartável do dry-run). Nunca um A1 real. */
  certificado?: FiscalCertificateMaterial
  /** Senha do certificado de teste (default vazio — chave em claro). */
  senha?: string
  /** Adapter do worker B2. Ausência de configuração ou indisponibilidade falha fechada. */
  xsdAdapter?: XsdValidationAdapter
  /** Valida a janela temporal do certificado (default false — cert de teste). */
  validarCertificado?: boolean
  /** Instante de referência se `validarCertificado` (default: agora). */
  agora?: Date
}

/** Resultado detalhado: relatório + artefatos EM MEMÓRIA (não persistidos — descartados ao retornar). */
export type RunFiscalDryRunDetailed = {
  report: DryRunReport
  /** XML não assinado (efêmero). */
  xml: string | null
  /** XML assinado (efêmero). */
  xmlAssinado: string | null
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex")
}

function etapa(nome: DryRunEtapaNome, status: DryRunEtapaStatus, mensagem: string): DryRunEtapa {
  return { nome, status, mensagem }
}

function xsdEtapaStatus(xsd: DryRunXsd): DryRunEtapaStatus {
  switch (xsd.status) {
    case "xsd_ok":
      return "ok"
    case "xsd_invalido":
      return "erro"
    default:
      return "erro"
  }
}

/** Executa o Dry-Run e devolve relatório + artefatos em memória (para inspeção/golden). */
export async function runFiscalDryRunDetailed(
  snapshot: VendaFiscalSnapshot,
  options: RunFiscalDryRunOptions = {},
): Promise<RunFiscalDryRunDetailed> {
  const etapas: DryRunEtapa[] = []
  const erros: string[] = []
  const warnings: string[] = []

  let xml: string | null = null
  let xmlAssinado: string | null = null
  let chaveAcesso: string | null = null
  let referenciaId: string | null = null
  let numeracaoPlaceholder = true
  let assinaturaValida = false

  // 1) Tributação congelada (lida do snapshot — o dry-run NÃO recalcula imposto).
  const trib = snapshot?.tributacao
  if (!trib) {
    etapas.push(etapa("tributacao", "erro", "Tributação não congelada no snapshot."))
    erros.push("Tributação ausente no snapshot.")
  } else if (!trib.ok) {
    etapas.push(etapa("tributacao", "erro", "Tributação fora do baseline (pendente)."))
    erros.push(...trib.pendencias)
  } else {
    etapas.push(etapa("tributacao", trib.semDestaque ? "ok" : "ok", `Regime ${trib.regime} (congelado).`))
  }

  // 2) Snapshot + XML (o builder valida o snapshot e lança em erro bloqueante).
  //    Produtor ASSINÁVEL (embutível): o dry-run precisa exercitar exatamente os bytes que a
  //    emissão real assinaria e enviaria dentro de `nfeDadosMsg` — um XML standalone provaria
  //    integridade de bytes que nunca seriam transmitidos.
  try {
    const built = buildNfceXmlAssinavelResult(snapshot, options.contexto)
    xml = built.xml
    chaveAcesso = built.chaveAcesso
    numeracaoPlaceholder = built.numeracaoPlaceholder
    warnings.push(...built.validacao.pendencias)
    etapas.push(etapa("snapshot", "ok", "Snapshot válido para emissão."))
    etapas.push(etapa("xml", "ok", `XML NFC-e 4.00 gerado (chave ${built.chaveAcesso}).`))
  } catch (e) {
    const msg = e instanceof NfceXmlError ? `${e.code}: ${e.message}` : "Falha ao gerar XML."
    etapas.push(etapa("snapshot", "erro", "Snapshot inválido para emissão."))
    etapas.push(etapa("xml", "erro", msg))
    etapas.push(etapa("assinatura", "pulada", "Pulada (sem XML)."))
    etapas.push(etapa("verificacao_assinatura", "pulada", "Pulada (sem assinatura)."))
    etapas.push(etapa("validacao_estrutural", "pulada", "Pulada (sem XML assinado)."))
    etapas.push(etapa("xsd", "pulada", "Pulada (sem XML)."))
    erros.push(msg)
    const validacaoEstrutural: DryRunValidacaoEstrutural = {
      ok: false,
      erros: ["XML não gerado — validação estrutural não executada."],
      pendencias: [],
    }
    const xsd: DryRunXsd = {
      status: "xsd_falha_infraestrutura",
      outcome: "FALHA_PERMANENTE",
      engine: null,
      mensagem: "Não executado (sem XML).",
      violacoes: [],
    }
    const report = buildDryRunReport({
      etapas,
      erros,
      warnings,
      chaveAcesso,
      referenciaId,
      assinaturaPresente: false,
      assinaturaValida: false,
      validacaoEstrutural,
      xsd,
      hashXml: null,
      hashXmlAssinado: null,
      numeracaoPlaceholder,
    })
    return { report, xml, xmlAssinado }
  }

  // 3) Assinatura com certificado de TESTE (simulada — nunca A1 real, nunca transmite).
  const cert = options.certificado ?? DRY_RUN_TEST_CERT
  try {
    const signed = signNfceXmlDetailed(xml, cert, options.senha ?? "", {
      ignorarValidade: options.validarCertificado !== true,
      agora: options.agora,
    })
    xmlAssinado = signed.xml
    referenciaId = signed.referenciaId
    etapas.push(etapa("assinatura", "ok", "XML assinado com certificado de teste (descartável)."))
  } catch (e) {
    const msg = e instanceof NfceSignError ? `${e.code}: ${e.message}` : "Falha ao assinar."
    etapas.push(etapa("assinatura", "erro", msg))
    etapas.push(etapa("verificacao_assinatura", "pulada", "Pulada (assinatura falhou)."))
    erros.push(msg)
  }

  // 4) Verificação da assinatura.
  if (xmlAssinado) {
    const v = verifyNfceSignature(xmlAssinado)
    assinaturaValida = v.valido
    if (v.valido) {
      etapas.push(etapa("verificacao_assinatura", "ok", "Assinatura íntegra (digest + SignatureValue)."))
    } else {
      etapas.push(etapa("verificacao_assinatura", "erro", `Assinatura inválida: ${v.problemas.join(", ")}.`))
      erros.push(`Assinatura inválida: ${v.problemas.join(", ")}.`)
    }
  }

  // 5) Validação estrutural do XML assinado.
  const validacaoEstrutural = validarEstruturaNfce(xmlAssinado)
  if (validacaoEstrutural.ok) {
    etapas.push(etapa("validacao_estrutural", "ok", "Estrutura mínima do infNFe 4.00 presente."))
  } else {
    etapas.push(etapa("validacao_estrutural", "erro", validacaoEstrutural.erros.join(" ")))
    erros.push(...validacaoEstrutural.erros)
  }
  warnings.push(...validacaoEstrutural.pendencias)

  // 6) XSD oficial. Valida o XML **assinado**: o schema da NF-e exige <Signature>
  //    (leiauteNFe_v4.00.xsd — `<xs:element ref="ds:Signature"/>`, sem minOccurs="0"), logo XML
  //    não assinado é inválido por definição, e é o assinado que a SEFAZ recebe. Sem assinatura,
  //    falha fechada — nunca aprovado por omissão.
  const xsd: DryRunXsd = xmlAssinado
    ? await validarXsd(xmlAssinado, {
        adapter: options.xsdAdapter,
        storeId: snapshot.storeId,
        correlationId: `dry-run:${snapshot.storeId}:${sha256Hex(xml).slice(0, 16)}`,
      })
    : {
        status: "xsd_falha_infraestrutura",
        outcome: "FALHA_PERMANENTE",
        engine: null,
        mensagem: "Não executado (sem XML assinado).",
        violacoes: [],
      }
  etapas.push(etapa("xsd", xmlAssinado ? xsdEtapaStatus(xsd) : "pulada", xsd.mensagem))
  if (xsd.status !== "xsd_ok") erros.push(xsd.mensagem, ...xsd.violacoes)

  // 7) Relatório (descarta XML — só hashes/status). Nada persistido.
  const report = buildDryRunReport({
    etapas,
    erros,
    warnings,
    chaveAcesso,
    referenciaId,
    assinaturaPresente: Boolean(xmlAssinado),
    assinaturaValida,
    validacaoEstrutural,
    xsd,
    hashXml: xml ? sha256Hex(xml) : null,
    hashXmlAssinado: xmlAssinado ? sha256Hex(xmlAssinado) : null,
    numeracaoPlaceholder,
  })

  return { report, xml, xmlAssinado }
}

/**
 * Executa o Dry-Run e devolve SOMENTE o relatório (XML é descartado — não retornado, não
 * persistido, não transmitido). Determinístico e sem informação sensível.
 */
export async function runFiscalDryRun(
  snapshot: VendaFiscalSnapshot,
  options: RunFiscalDryRunOptions = {},
): Promise<DryRunReport> {
  return (await runFiscalDryRunDetailed(snapshot, options)).report
}
