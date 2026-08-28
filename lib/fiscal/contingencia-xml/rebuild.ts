/**
 * Rebuild OFFLINE do XML NFC-e modelo 65 em contingência (GOAL 020B).
 *
 * Constrói um XML NOVO a partir do snapshot/input canônico, recalcula chave/cDV/Id
 * com tpEmis=9, assina o XML reconstruído e congela exactBytes. Nunca patcha XML
 * assinado, nunca aloca nNF/série/cNF, nunca persiste, nunca transmite.
 */
import { createHash } from "node:crypto"
import {
  CONTINGENCIA_TP_EMIS,
  REBUILD_AND_RESIGN_REQUIRED,
  SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN,
} from "../contingencia/types"
import {
  decideNormalToOffline,
  signedXmlInPlacePatchPolicy,
  validateContingenciaRequest,
} from "../contingencia/policy"
import { signNfceXmlDetailed, verifyNfceSignature } from "../signing/nfce-signer"
import { formatDhEmi } from "../xml/nfce-chave-acesso"
import { buildNfceXmlAssinavelResult } from "../xml/nfce-xml-builder"
import {
  CONTINGENCIA_XML_XJUST_MAX,
  CONTINGENCIA_XML_XJUST_MIN,
  ContingenciaXmlError,
  type ContingenciaXmlOfflineInput,
  type ContingenciaXmlOfflineResult,
} from "./types"
import { validateNfceXmlXsdOffline } from "./xsd-offline"

const C_NF_PATTERN = /^\d{8}$/

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function freezeResult(
  xml: string,
  meta: Omit<ContingenciaXmlOfflineResult, "exactBytes" | "sha256" | "xml" | "frozen" | "rebuildForbidden">,
): ContingenciaXmlOfflineResult {
  const stored = Uint8Array.from(Buffer.from(xml, "utf8"))
  const result: ContingenciaXmlOfflineResult = {
    ...meta,
    xml,
    sha256: sha256Hex(stored),
    frozen: true,
    rebuildForbidden: true,
    get exactBytes() {
      return Uint8Array.from(stored)
    },
  }
  return Object.freeze(result)
}

/** Qualquer tentativa de patch in-place de XML assinado é recusada. */
export function patchSignedNfceXmlInPlace(_xml: string, _mutation?: unknown): never {
  throw new ContingenciaXmlError(
    SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN,
    "XML assinado não pode ser modificado in-place. Reconstrua e assine de novo (REBUILD_AND_RESIGN_REQUIRED).",
  )
}

function assertNumeracao(input: ContingenciaXmlOfflineInput): { serie: number; nNF: number; cNF: string } {
  if (!Number.isFinite(input.serie) || Number(input.serie) < 0) {
    throw new ContingenciaXmlError("serie_ausente", "Série deve vir do input canônico; o rebuild não aloca série.")
  }
  if (!Number.isFinite(input.nNF) || Number(input.nNF) <= 0) {
    throw new ContingenciaXmlError("nNF_ausente", "nNF deve vir do input canônico; o rebuild não reserva nem incrementa nNF.")
  }
  const cNF = String(input.cNF ?? "")
  if (!cNF) {
    throw new ContingenciaXmlError("cNF_ausente", "cNF deve vir do input canônico; o rebuild não gera cNF.")
  }
  if (!C_NF_PATTERN.test(cNF)) {
    throw new ContingenciaXmlError("cNF_invalido", "cNF deve ter exatamente 8 dígitos (XSD [0-9]{8}).")
  }
  return { serie: Number(input.serie), nNF: Number(input.nNF), cNF }
}

/**
 * Reconstrói, assina e congela o XML de contingência off-line.
 * Única consequência permitida de Normal → tpEmis=9: REBUILD_AND_RESIGN_REQUIRED.
 */
export function rebuildNfceContingenciaXmlOffline(
  input: ContingenciaXmlOfflineInput,
): ContingenciaXmlOfflineResult {
  if (input.xmlAssinadoParaPatch != null) {
    patchSignedNfceXmlInPlace(input.xmlAssinadoParaPatch)
  }
  if (signedXmlInPlacePatchPolicy() !== SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN) {
    throw new ContingenciaXmlError(
      SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN,
      "Policy 020A exige recusa de patch in-place de XML assinado.",
    )
  }

  if (input.conversao) {
    const decision = decideNormalToOffline(input.conversao)
    if (!decision.ok) {
      throw new ContingenciaXmlError("conversao_proibida", decision.code)
    }
    if (decision.xmlMutation !== REBUILD_AND_RESIGN_REQUIRED) {
      throw new ContingenciaXmlError(
        SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN,
        "Normal → contingência exige rebuild e nova assinatura.",
      )
    }
  }

  const pedido = validateContingenciaRequest({
    modelo: "NFCE",
    modeloCodigo: "65",
    uf: "SP",
    modalidade: "OFFLINE",
    tpEmis: CONTINGENCIA_TP_EMIS,
    ambiente: input.ambiente,
    dhCont: input.dhCont,
    xJust: input.xJust,
  })
  if (!pedido.ok) {
    throw new ContingenciaXmlError("pedido_invalido", pedido.errors.map((e) => e.code).join(", "))
  }

  const xJust = pedido.value.xJust
  if (xJust.length < CONTINGENCIA_XML_XJUST_MIN || xJust.length > CONTINGENCIA_XML_XJUST_MAX) {
    throw new ContingenciaXmlError(
      "x_just_tamanho_invalido",
      `xJust deve ter ${CONTINGENCIA_XML_XJUST_MIN}–${CONTINGENCIA_XML_XJUST_MAX} caracteres (XSD PL_010e).`,
    )
  }

  const ufEmitente = String(input.snapshot.emitente?.endereco?.uf ?? "").trim().toUpperCase()
  if (ufEmitente !== "SP") {
    throw new ContingenciaXmlError(
      "uf_emitente_nao_piloto",
      "Emitente do snapshot deve ser da UF piloto SP.",
    )
  }

  const { serie, nNF, cNF } = assertNumeracao(input)
  const dataEmissao = input.dhEmi ?? input.snapshot.venda.data
  const dhEmi = formatDhEmi(dataEmissao)

  const built = buildNfceXmlAssinavelResult(input.snapshot, {
    serie,
    numero: nNF,
    cNF,
    tpEmis: CONTINGENCIA_TP_EMIS,
    dataEmissao,
    dhCont: pedido.value.dhCont,
    xJust,
  })

  if (built.numero !== nNF || built.serie !== serie) {
    throw new ContingenciaXmlError("nNF_ausente", "nNF/série do XML reconstruído divergem do input canônico.")
  }
  if (!built.xml.includes(`<cNF>${cNF}</cNF>`)) {
    throw new ContingenciaXmlError("cNF_invalido", "cNF do XML reconstruído diverge do input canônico.")
  }
  if (built.chaveAcesso.length !== 44 || built.chaveAcesso[34] !== "9") {
    throw new ContingenciaXmlError("id_inconsistente", "Chave reconstruída deve ter 44 posições com tpEmis=9.")
  }

  const infNFeId = `NFe${built.chaveAcesso}`
  if (!built.xml.includes(`Id="${infNFeId}"`)) {
    throw new ContingenciaXmlError("id_inconsistente", "infNFe/@Id deve corresponder exatamente à nova chave.")
  }

  const signed = signNfceXmlDetailed(built.xml, input.signer.certificado, input.signer.senha ?? "", {
    agora: input.signer.agora,
  })
  if (signed.referenciaId !== infNFeId) {
    throw new ContingenciaXmlError(
      "assinatura_invalida",
      "Assinatura deve referenciar o infNFe/@Id reconstruído.",
    )
  }

  const verification = verifyNfceSignature(signed.xml)
  if (!verification.valido || !verification.digestConfere || verification.referenciaId !== infNFeId) {
    throw new ContingenciaXmlError("assinatura_invalida", "Assinatura/digest inválidos sobre o XML reconstruído.")
  }

  const xsd = validateNfceXmlXsdOffline(signed.xml)
  if (!xsd.ok) {
    throw new ContingenciaXmlError(xsd.code, xsd.issues[0] ?? "Validação XSD offline recusada.")
  }

  return freezeResult(signed.xml, {
    chave: built.chaveAcesso,
    infNFeId,
    tpEmis: CONTINGENCIA_TP_EMIS,
    dhCont: pedido.value.dhCont,
    xJust,
    dhEmi,
    nNF,
    serie,
    cNF,
    cDV: built.chaveAcesso.slice(-1),
  })
}
