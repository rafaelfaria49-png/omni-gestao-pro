/**
 * Orquestrador da prova FISCAL-DRY-RUN-INTEGRITY-PROOF-005.
 *
 * COMPÕE componentes Fiscais reais e dormentes já aceitos no repositório:
 * snapshot · XML builder · C14N · signer · verifier interno · verifier Java · validação XSD (adapter).
 *
 * Não transmite, não chama SEFAZ, não grava Prisma, não toca PDV/Caixa/API.
 * Dependências injetáveis; relógio e seed fixos; material criptográfico sintético do GOAL-003.
 */

import { createHash } from "node:crypto"
import {
  ALG_C14N,
  ALG_DIGEST_SHA1,
  ALG_SIGNATURE_RSA_SHA1,
  canonicalizeElement,
  findFirst,
  loadCertificateMaterialFromPem,
  parseXml,
  signNfceXmlDetailed,
  verifyNfceSignature,
  type FiscalCertificateMaterial,
} from "@/lib/fiscal/signing"
import { buildNfceXmlResult, type NfceXmlContext } from "@/lib/fiscal/xml"
import { validarEstruturaNfce, validarXsd, type DryRunXsd } from "@/lib/fiscal/dry-run"
import type { XsdValidationAdapter, XsdValidationOutcome } from "@/lib/fiscal/xsd"
import { XSD_SCHEMA_PACKAGE } from "@/lib/fiscal/xsd"
import { OFFICIAL_XSD_MANIFEST_SHA256 } from "@/lib/fiscal/xsd/official-package"
import { createConfiguredXsdWorkerClient } from "@/lib/fiscal/xsd-worker"
import type { VendaFiscalSnapshot } from "@/lib/fiscal/venda-fiscal-snapshot"
import {
  FIXTURE_VERSION,
  PROOF_CLOCK_ISO,
  PROOF_GOAL,
  PROOF_SEED,
  PROOF_VERSION,
  XSD_PACKAGE_ID,
  LAYOUT_VERSION,
  MODEL_NFCE,
  STORE_PROOF_A,
  STORE_PROOF_B,
  assertSyntheticSafety,
  buildSyntheticSnapshot,
  syntheticCertificateMaterial,
  syntheticXmlContext,
} from "./fixtures"
import { verifySignedXmlExternalJava, type JavaExternalReport } from "./java-external"

/** Motor por trás de uma evidência XSD. `composition-gate` NUNCA prova conformidade com o schema. */
export type XsdEvidenceKind = "composition-gate" | "xmllint-worker"

/** Adapter XSD do harness: declara o próprio motor — a prova nunca o infere do resultado. */
export type ProofXsdAdapter = XsdValidationAdapter & { readonly kind: XsdEvidenceKind }

type XsdEvidenceScope = {
  package: typeof XSD_PACKAGE_ID
  layout: typeof LAYOUT_VERSION
  model: typeof MODEL_NFCE
  schemaRoot: typeof XSD_SCHEMA_PACKAGE
}

/**
 * Evidência XSD da prova, separada por motor — o eixo que o manifesto serializa.
 *
 * `composition-gate`: só o CONTRATO do pacote oficial foi conferido (schema root, hash do
 * manifesto, escopo de loja, presença de assinatura). O XML nunca foi confrontado com o schema.
 * `xmllint-worker`: um `xmllint`/libxml2 real (worker B2) processou o XML e emitiu veredito.
 *
 * A união torna impossível — por tipagem — afirmar validação real sem motor real.
 */
export type XsdEvidence =
  | (XsdEvidenceScope & {
      kind: "composition-gate"
      contractPassed: boolean
      realValidationPassed: false
      engineName: "composition-gate"
      engineVersion: null
      workerReal: false
    })
  | (XsdEvidenceScope & {
      kind: "xmllint-worker"
      contractPassed: boolean
      realValidationPassed: boolean
      engineName: "xmllint"
      engineVersion: string
      workerReal: true
    })

export type ProofDependencies = {
  clockIso?: string
  seed?: string
  storeId: string
  certificate?: FiscalCertificateMaterial
  senha?: string
  xmlContext?: NfceXmlContext
  xsdAdapter?: ProofXsdAdapter
  /** Quando false, não invoca Java (default true). */
  runExternalJava?: boolean
  repoRoot?: string
  /** Contador de escritas — a prova exige 0. */
  databaseWriteProbe?: { writes: number }
  /** Contador de egress — a prova exige 0. */
  externalEgressProbe?: { calls: number }
  sefazProbe?: { calls: number }
}

export type IntegrityProofResult = {
  goal: typeof PROOF_GOAL
  proofVersion: typeof PROOF_VERSION
  fixtureVersion: typeof FIXTURE_VERSION
  clock: string
  seed: string
  storeId: string
  layout: typeof LAYOUT_VERSION
  model: typeof MODEL_NFCE
  xsdPackage: typeof XSD_PACKAGE_ID
  schemaPackagePath: typeof XSD_SCHEMA_PACKAGE
  schemaManifestHash: string
  referenciaId: string
  chaveAcesso: string | null
  snapshotNormalized: Record<string, unknown>
  hashes: {
    snapshotSha256: string
    unsignedXmlSha256: string
    referencedNodeC14nSha256: string
    signedInfoSha256: string
    signedXmlSha256: string
  }
  signature: {
    canonicalizationMethod: string
    signatureMethod: string
    digestMethod: string
    digestValue: string
  }
  verification: {
    internal: boolean
    externalJava17: boolean
    /** Validação XSD REAL. Só o worker `xmllint` pode torná-la true — ver `xsdEvidence`. */
    xsd: boolean
    structural: boolean
  }
  /** Motor e alcance do veredito XSD — separa gate de composição de validação real. */
  xsdEvidence: XsdEvidence
  integrity: {
    deterministic: boolean | null
    idempotent: boolean | null
    tamperDetected: boolean | null
    storeIsolation: boolean | null
  }
  safety: {
    productiveCallers: number
    databaseWrites: number
    sefazCalls: number
    externalEgress: number
    realCredentials: number
    realData: number
  }
  javaReport: JavaExternalReport | null
  xsdStatus: string
  xsdEngineName: string | null
  /** Diagnósticos XSD normalizados e sanitizados do adapter/worker (nunca XML integral nem segredo). */
  xsdDiagnostics: readonly string[]
  /** Artefatos efêmeros — NÃO serializar em manifesto (contêm XML). */
  artifacts: {
    unsignedXml: string
    signedXml: string
    referencedNodeC14n: string
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex")
}

/**
 * Outcome do gate de composição quando o contrato confere: pacote/manifesto/escopo válidos, mas
 * nenhum `xmllint` processou o XML → fail-closed no contrato compartilhado, com `engine: null`.
 */
const COMPOSITION_GATE_CONTRACT_OK: XsdValidationOutcome = "WORKER_INDISPONIVEL"

const XSD_EVIDENCE_SCOPE: XsdEvidenceScope = {
  package: XSD_PACKAGE_ID,
  layout: LAYOUT_VERSION,
  model: MODEL_NFCE,
  schemaRoot: XSD_SCHEMA_PACKAGE,
}

/** Único predicado autorizado a afirmar XSD real aprovado. */
export function xsdRealValidationPassed(evidence: XsdEvidence): boolean {
  return evidence.kind === "xmllint-worker" && evidence.workerReal && evidence.realValidationPassed
}

/** Barreira de runtime contra combinação desonesta escapar para a serialização. */
export function assertXsdEvidence(evidence: XsdEvidence): void {
  if (evidence.kind === "composition-gate") {
    if (evidence.workerReal || evidence.realValidationPassed) {
      throw new Error("evidência XSD inválida: composition-gate não afirma worker/validação real.")
    }
    if (evidence.engineName !== "composition-gate" || evidence.engineVersion !== null) {
      throw new Error("evidência XSD inválida: composition-gate não declara motor xmllint.")
    }
    return
  }
  if (!evidence.workerReal) {
    throw new Error("evidência XSD inválida: xmllint-worker exige worker real.")
  }
  if (evidence.engineName !== "xmllint") {
    throw new Error("evidência XSD inválida: xmllint-worker exige motor xmllint.")
  }
  if (!evidence.engineVersion || evidence.engineVersion === "composition-gate") {
    throw new Error("evidência XSD inválida: motor xmllint exige versão real do binário.")
  }
}

/**
 * Traduz o resultado do contrato compartilhado na evidência tipada da prova.
 *
 * `engine` não nulo só existe quando um motor real respondeu — o contrato compartilhado
 * (`XsdValidationResult`) o exige em `valid: true` e o tipa com `name: "xmllint"`. Worker
 * configurado porém mudo (`engine: null`) degrada para gate sem contrato, nunca para evidência
 * real: a prova prefere subdeclarar a superdeclarar.
 */
export function buildXsdEvidence(kind: XsdEvidenceKind, xsd: DryRunXsd): XsdEvidence {
  const engine = kind === "xmllint-worker" ? xsd.engine : null
  const evidence: XsdEvidence = engine
    ? {
        ...XSD_EVIDENCE_SCOPE,
        kind: "xmllint-worker",
        contractPassed: true,
        realValidationPassed: xsd.status === "xsd_ok",
        engineName: "xmllint",
        engineVersion: engine.xmllintVersion,
        workerReal: true,
      }
    : {
        ...XSD_EVIDENCE_SCOPE,
        kind: "composition-gate",
        contractPassed: kind === "composition-gate" && xsd.outcome === COMPOSITION_GATE_CONTRACT_OK,
        realValidationPassed: false,
        engineName: "composition-gate",
        engineVersion: null,
        workerReal: false,
      }
  assertXsdEvidence(evidence)
  return evidence
}

export type ProofState = "partial" | "complete"

/** Bloqueio conhecido do GOAL-005: nenhum `xmllint` real confrontou o XML com o schema. */
export const BLOCKER_XSD_WORKER_REAL_UNAVAILABLE = "XSD_WORKER_REAL_UNAVAILABLE" as const

/** Motivos que impedem a prova integral. Vazio ⇒ elegível a `complete`, sujeito aos demais gates. */
export function blockingReasonsFrom(evidence: XsdEvidence): string[] {
  return xsdRealValidationPassed(evidence) ? [] : [BLOCKER_XSD_WORKER_REAL_UNAVAILABLE]
}

/**
 * Estado do artefato no eixo XSD — gate de composição nunca vira estado real.
 *
 * `approved-real`: um `xmllint` real (worker B2) processou o XML e aprovou — o estado que o
 * manifesto completo registra após validação real, só alcançável via worker + `--update-manifest`
 * autorizado (H4). `rejected`: worker real que reprovou. `composition-gate`: nenhum `xmllint`
 * processou o XML. Gate de composição jamais alcança `approved-real`.
 */
function manifestXsdStatus(evidence: XsdEvidence): string {
  if (evidence.kind === "composition-gate") return "composition-gate"
  return evidence.realValidationPassed ? "approved-real" : "rejected"
}

/**
 * Snapshot JSON-serializável e estável para fingerprint da prova.
 *
 * `buildVendaFiscalSnapshot` grava `geradoEm` com `new Date().toISOString()` (relógio de parede
 * do processo — comportamento produtivo herdado, não alterado por este GOAL). Para a prova de
 * integridade, normalizamos `geradoEm` com o clock injetado. O XML NFC-e NÃO embute `geradoEm`,
 * logo a cadeia XML/C14N/assinatura já é determinística sem essa normalização.
 */
function stableSnapshot(
  snapshot: VendaFiscalSnapshot,
  clockIso: string,
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>
  cloned.geradoEm = clockIso
  return cloned
}

function extractSignedInfoC14n(signedXml: string): string {
  const root = parseXml(signedXml)
  const signedInfo = findFirst(root, "SignedInfo")
  if (!signedInfo) throw new Error("SignedInfo ausente no XML assinado.")
  return canonicalizeElement(signedInfo)
}

function extractReferencedC14n(signedXml: string): string {
  const root = parseXml(signedXml)
  const infNFe = findFirst(root, "infNFe")
  if (!infNFe) throw new Error("infNFe ausente no XML assinado.")
  return canonicalizeElement(infNFe)
}

/**
 * Executa a cadeia offline de integridade do dry-run fiscal.
 * Pura quanto a I/O de negócio: sem Prisma, sem SEFAZ, sem filesystem operacional.
 */
export async function runFiscalDryRunIntegrityProof(
  deps: ProofDependencies,
): Promise<IntegrityProofResult> {
  const clock = deps.clockIso ?? PROOF_CLOCK_ISO
  const seed = deps.seed ?? PROOF_SEED
  const storeId = deps.storeId
  const certificate = deps.certificate ?? syntheticCertificateMaterial()
  const xmlContext = deps.xmlContext ?? syntheticXmlContext(clock)
  const dbWrites = deps.databaseWriteProbe?.writes ?? 0
  const egress = deps.externalEgressProbe?.calls ?? 0
  const sefaz = deps.sefazProbe?.calls ?? 0

  if (dbWrites !== 0) throw new Error("databaseWriteProbe não zero — prova abortada.")
  if (egress !== 0) throw new Error("externalEgressProbe não zero — prova abortada.")
  if (sefaz !== 0) throw new Error("sefazProbe não zero — prova abortada.")

  const snapshot = buildSyntheticSnapshot({ storeId, clockIso: clock, seed })
  const snapshotNormalized = stableSnapshot(snapshot, clock)
  const snapshotSha256 = sha256Hex(JSON.stringify(snapshotNormalized))

  const built = buildNfceXmlResult(snapshot, xmlContext)
  const unsignedXml = built.xml
  const unsignedXmlSha256 = sha256Hex(unsignedXml)

  /**
   * Prova de DOCUMENTO standalone, deliberadamente (GOAL-016D-C0).
   *
   * `buildNfceXmlResult` acima emite a declaração `<?xml ?>`, e o manifesto golden em
   * `evidence/manifest.json` sela `unsignedXmlSha256`/`signedXmlSha256` desses bytes desde o
   * GOAL-005B. Estes bytes NUNCA são persistidos em `NotaFiscal.xmlAssinado` nem transmitidos —
   * a prova é de integridade C14N/XMLDSig contra verificador externo, não de transmissibilidade.
   * Trocar o produtor aqui invalidaria o golden sem nada a ganhar, então a prova declara o
   * contrato standalone em vez de fingir ser o caminho de emissão. O caminho de emissão real
   * usa `buildNfceXmlAssinavel`, e o signer recusa declaração por default.
   */
  const signed = signNfceXmlDetailed(unsignedXml, certificate, deps.senha ?? "", {
    ignorarValidade: true,
    agora: new Date(clock),
    permitirDocumentoStandalone: true,
  })
  const signedXml = signed.xml
  const signedXmlSha256 = sha256Hex(signedXml)
  const referencedNodeC14n = extractReferencedC14n(signedXml)
  const referencedNodeC14nSha256 = sha256Hex(referencedNodeC14n)
  const signedInfoC14n = extractSignedInfoC14n(signedXml)
  const signedInfoSha256 = sha256Hex(signedInfoC14n)

  const internal = verifyNfceSignature(signedXml)
  const structural = validarEstruturaNfce(signedXml)

  let javaReport: JavaExternalReport | null = null
  let externalJava17 = false
  if (deps.runExternalJava !== false) {
    const external = verifySignedXmlExternalJava(signedXml, {
      repoRoot: deps.repoRoot,
      label: storeId,
    })
    javaReport = external.report
    externalJava17 =
      external.ok &&
      external.report.declaredDigestValue === signed.digestValue &&
      String(external.report.javaRuntime ?? "").startsWith("17.")
  }

  const xsd = await validarXsd(signedXml, {
    adapter: deps.xsdAdapter,
    storeId,
    correlationId: `proof-005:${storeId}:${unsignedXmlSha256.slice(0, 16)}`,
    jobId: `proof-005-${unsignedXmlSha256.slice(0, 24)}`,
  })
  // Sem adapter injetado, `validarXsd` cai no cliente do worker real (`createConfiguredXsdWorkerClient`).
  const xsdEvidence = buildXsdEvidence(deps.xsdAdapter?.kind ?? "xmllint-worker", xsd)
  const xsdOk = xsdRealValidationPassed(xsdEvidence)

  const result: IntegrityProofResult = {
    goal: PROOF_GOAL,
    proofVersion: PROOF_VERSION,
    fixtureVersion: FIXTURE_VERSION,
    clock,
    seed,
    storeId,
    layout: LAYOUT_VERSION,
    model: MODEL_NFCE,
    xsdPackage: XSD_PACKAGE_ID,
    schemaPackagePath: XSD_SCHEMA_PACKAGE,
    schemaManifestHash: OFFICIAL_XSD_MANIFEST_SHA256,
    referenciaId: signed.referenciaId,
    chaveAcesso: built.chaveAcesso,
    snapshotNormalized,
    hashes: {
      snapshotSha256,
      unsignedXmlSha256,
      referencedNodeC14nSha256,
      signedInfoSha256,
      signedXmlSha256,
    },
    signature: {
      canonicalizationMethod: ALG_C14N,
      signatureMethod: ALG_SIGNATURE_RSA_SHA1,
      digestMethod: ALG_DIGEST_SHA1,
      digestValue: signed.digestValue,
    },
    verification: {
      internal: internal.valido === true,
      externalJava17,
      xsd: xsdOk,
      structural: structural.ok,
    },
    xsdEvidence,
    integrity: {
      deterministic: null,
      idempotent: null,
      tamperDetected: null,
      storeIsolation: null,
    },
    safety: {
      productiveCallers: 0,
      databaseWrites: dbWrites,
      sefazCalls: sefaz,
      externalEgress: egress,
      realCredentials: 0,
      realData: 0,
    },
    javaReport,
    xsdStatus: xsd.status,
    xsdEngineName: xsd.engine?.name ?? null,
    // `xsd.violacoes` já vem sanitizado pelo worker (sem XML/segredo); mensagem como fallback.
    xsdDiagnostics: xsd.violacoes.length > 0 ? xsd.violacoes : xsd.mensagem ? [xsd.mensagem] : [],
    artifacts: {
      unsignedXml,
      signedXml,
      referencedNodeC14n,
    },
  }

  // Segurança: serialização pública nunca inclui chave/XML (assert sobre subset)
  const publicView = toPublicProofView(result)
  assertSyntheticSafety(JSON.stringify(publicView))
  if (JSON.stringify(publicView).includes("PRIVATE KEY")) {
    throw new Error("vazamento de chave privada no resultado público")
  }

  return result
}

/** Visão serializável sem artefatos XML (para manifesto / logs). */
export function toPublicProofView(result: IntegrityProofResult): Omit<IntegrityProofResult, "artifacts" | "snapshotNormalized" | "javaReport"> & {
  snapshotFingerprint: string
  javaValid: boolean | null
} {
  const { artifacts: _a, snapshotNormalized: _s, javaReport, ...rest } = result
  return {
    ...rest,
    snapshotFingerprint: result.hashes.snapshotSha256,
    javaValid: javaReport ? javaReport.valid === true : null,
  }
}

export type IntegrityManifest = {
  goal: typeof PROOF_GOAL
  proofVersion: typeof PROOF_VERSION
  fixtureVersion: typeof FIXTURE_VERSION
  /** `partial` enquanto houver `blockingReasons`. Nunca inferir conclusão a partir dos booleanos. */
  proofState: ProofState
  blockingReasons: string[]
  clock: string
  seed: string
  layout: typeof LAYOUT_VERSION
  model: typeof MODEL_NFCE
  xsdPackage: typeof XSD_PACKAGE_ID
  schemaPackagePath: typeof XSD_SCHEMA_PACKAGE
  schemaManifestHash: string
  storeScope: {
    primary: typeof STORE_PROOF_A
    comparison: typeof STORE_PROOF_B
  }
  hashes: IntegrityProofResult["hashes"]
  signature: IntegrityProofResult["signature"]
  verification: {
    internal: boolean
    externalJava17: boolean
    /** Validação XSD REAL (`xmllint` sobre o schema). Gate de composição jamais a torna true. */
    xsd: boolean
    /** Contrato do pacote XSD oficial conferido — evidência de composição, não de schema. */
    xsdContract: boolean
    xsdStatus: string
    xsdEngineName: string
    xsdEngineVersion: string | null
    xsdWorkerReal: boolean
    structural: boolean
  }
  integrity: {
    deterministic: boolean
    idempotent: boolean
    tamperDetected: boolean
    storeIsolation: boolean
  }
  safety: IntegrityProofResult["safety"]
  referenciaIdPrefix: string
}

/**
 * Serializa a prova no manifesto versionado.
 *
 * `verification.xsd` passa por `xsdRealValidationPassed`: só evidência `xmllint-worker` a torna
 * true. Lido isolado, o artefato precisa dizer qual motor respondeu e o que falta — daí
 * `xsdEngineName`/`xsdWorkerReal`/`proofState`/`blockingReasons`.
 */
export function buildManifestFromProof(
  primary: IntegrityProofResult,
  integrity: IntegrityManifest["integrity"],
): IntegrityManifest {
  const evidence = primary.xsdEvidence
  assertXsdEvidence(evidence)
  const blockingReasons = blockingReasonsFrom(evidence)
  return {
    goal: primary.goal,
    proofVersion: primary.proofVersion,
    fixtureVersion: primary.fixtureVersion,
    proofState: blockingReasons.length === 0 ? "complete" : "partial",
    blockingReasons,
    clock: primary.clock,
    seed: primary.seed,
    layout: primary.layout,
    model: primary.model,
    xsdPackage: primary.xsdPackage,
    schemaPackagePath: primary.schemaPackagePath,
    schemaManifestHash: primary.schemaManifestHash,
    storeScope: {
      primary: STORE_PROOF_A,
      comparison: STORE_PROOF_B,
    },
    hashes: primary.hashes,
    signature: primary.signature,
    verification: {
      internal: primary.verification.internal,
      externalJava17: primary.verification.externalJava17,
      xsd: xsdRealValidationPassed(evidence),
      xsdContract: evidence.contractPassed,
      xsdStatus: manifestXsdStatus(evidence),
      xsdEngineName: evidence.engineName,
      xsdEngineVersion: evidence.engineVersion,
      xsdWorkerReal: evidence.workerReal,
      structural: primary.verification.structural,
    },
    integrity,
    safety: primary.safety,
    referenciaIdPrefix: primary.referenciaId.slice(0, 6),
  }
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/**
 * Gate de composição offline — NÃO é validação XSD.
 *
 * Confere só o CONTRATO com que `lib/fiscal/dry-run` chama o pacote oficial (schema root, hash do
 * manifesto, escopo sintético de loja) e a presença de `<Signature`. Nenhum `xmllint`, nenhum
 * libxml2, nenhum worker B2: o XML não é confrontado com o schema.
 *
 * Por isso jamais devolve `VALIDACAO_APROVADA`. O contrato compartilhado (`XsdValidationResult`)
 * só admite `valid: true` acompanhado de `XsdValidationEngine`, cujo `name` é o literal
 * `"xmllint"` — aprovar aqui obrigaria a forjar esse motor, que foi exatamente o defeito
 * corrigido. Contrato conferido → `WORKER_INDISPONIVEL` (fail-closed, `engine: null`);
 * contrato rejeitado → `XML_INVALIDO`. Só `createConfiguredXsdWorkerClient` aprova XSD.
 */
export function createCompositionXsdAdapter(): ProofXsdAdapter {
  return {
    kind: "composition-gate",
    async validate(request) {
      const hasSignature = request.xmlPayload.includes("<Signature")
      const contractOk =
        request.schemaVersion === XSD_SCHEMA_PACKAGE &&
        request.schemaManifestHash === OFFICIAL_XSD_MANIFEST_SHA256 &&
        request.storeId.startsWith("store-fiscal-proof-")
      if (!hasSignature || !contractOk) {
        return {
          valid: false,
          outcome: "XML_INVALIDO",
          issues: [{ message: "XML ou contrato XSD rejeitado no gate de composição." }],
          engine: null,
          durationMs: 1,
        }
      }
      return {
        valid: false,
        outcome: COMPOSITION_GATE_CONTRACT_OK,
        issues: [
          {
            code: "XSD_COMPOSITION_GATE_ONLY",
            category: "INFRASTRUCTURE",
            message:
              "Gate de composição aprovado (pacote, manifesto e escopo conferem); validação XSD real não executada — worker xmllint ausente.",
            retryable: false,
          },
        ],
        engine: null,
        durationMs: 1,
      }
    },
  }
}

/**
 * Adapter que liga o worker XSD REAL (libxml2/`xmllint`, worker B2) pelo transporte oficial já
 * existente (`createConfiguredXsdWorkerClient`: allowlist loopback + `.internal`, base em
 * `FISCAL_XSD_WORKER_URL`). Declara `kind: "xmllint-worker"`; a evidência real só nasce quando o
 * worker responde com `engine` não nulo. Sem URL na allowlist, o cliente devolve
 * `WORKER_INDISPONIVEL` (engine null) e a evidência degrada honestamente para não-real (exit 2).
 */
export function createRealWorkerXsdAdapter(): ProofXsdAdapter {
  const client = createConfiguredXsdWorkerClient()
  return {
    kind: "xmllint-worker",
    validate: (request) => client.validate(request),
  }
}

/**
 * Seleciona o adapter XSD da prova a partir do ambiente — a ÚNICA decisão que liga o harness ao
 * worker real. Com `FISCAL_XSD_WORKER_URL` definido usa o worker real; senão, o gate de composição
 * (fallback honesto: nunca conclui a prova integral, nunca retorna exit 0, mantém `xsdWorkerReal`
 * false). O composition-gate segue disponível como fallback sem jamais forjar validação real.
 */
export function resolveXsdAdapterFromEnv(
  env: Record<string, string | undefined> = process.env,
): ProofXsdAdapter {
  return env.FISCAL_XSD_WORKER_URL?.trim()
    ? createRealWorkerXsdAdapter()
    : createCompositionXsdAdapter()
}

/** Adapter que simula provider SEFAZ — deve ser impossível de usar na prova. */
export function createForbiddenSefazAdapter(): never {
  throw new Error("provider SEFAZ é proibido no harness da prova 005")
}

/**
 * Taxonomia oficial do veredito XSD do worker real — separa, sem ambiguidade, as naturezas de
 * resultado que a matriz do 005B exige para que transporte/timeout/política JAMAIS sejam confundidos
 * com "XML inválido" (rejeição real de schema):
 *
 *   XSD_APROVADO       — `VALIDACAO_APROVADA` (o `xmllint` real aprovou o XML).
 *   XML_INVALIDO       — `XML_INVALIDO` | `XML_MALFORMADO` (schema/parser rejeitou o XML).
 *   POLITICA_REJEITADA — `POLITICA_REJEITADA` (política segura do worker: XXE, ref. externa, preflight).
 *   TIMEOUT            — `TIMEOUT` (o worker não respondeu dentro do deadline).
 *   FALHA_TRANSPORTE   — indisponibilidade/erro de transporte ou resposta incerta — nunca é veredito de schema.
 *
 * `FALHA_SEGURANCA` (egress/persistência/SEFAZ) NÃO nasce de um outcome do worker: é a fronteira de
 * segurança do próprio harness (net-guard + probes de safety), classificada no exit code 3.
 */
export type XsdMatrixCategory =
  | "XSD_APROVADO"
  | "XML_INVALIDO"
  | "POLITICA_REJEITADA"
  | "TIMEOUT"
  | "FALHA_TRANSPORTE"

export function categorizeXsdOutcome(outcome: XsdValidationOutcome): XsdMatrixCategory {
  switch (outcome) {
    case "VALIDACAO_APROVADA":
      return "XSD_APROVADO"
    case "XML_INVALIDO":
    case "XML_MALFORMADO":
      return "XML_INVALIDO"
    case "POLITICA_REJEITADA":
      return "POLITICA_REJEITADA"
    case "TIMEOUT":
      return "TIMEOUT"
    case "FALHA_TRANSITORIA":
    case "FALHA_PERMANENTE":
    case "WORKER_INDISPONIVEL":
    case "RESPOSTA_INCERTA":
    case "HASH_DIVERGENTE":
    case "VERSAO_NAO_PERMITIDA":
    case "PACOTE_XSD_AUSENTE":
      return "FALHA_TRANSPORTE"
    default: {
      const exhaustive: never = outcome
      return exhaustive
    }
  }
}

/**
 * Sinais para classificação do código de saída do runner (FASE 12).
 * `dependencyAvailable` = verificador Java 17 + manifesto golden presentes.
 * `xsdWorkerReal` = `xmllint` real executou — dependência obrigatória da prova integral.
 * `xsdContract` = gate de contrato do pacote XSD oficial no adapter (NÃO é xmllint real).
 */
export type ProofExitSignals = {
  manifestMatches: boolean
  dependencyAvailable: boolean
  xsdWorkerReal: boolean
  internal: boolean
  externalJava17: boolean
  structural: boolean
  xsdContract: boolean
  deterministic: boolean
  idempotent: boolean
  tamperDetected: boolean
  storeIsolation: boolean
  databaseWrites: number
  sefazCalls: number
  externalEgress: number
}

export type ProofExitCode = 0 | 1 | 2 | 3 | 4

/**
 * Matriz oficial de exit codes (FASE 12), avaliada por prioridade:
 *   3 — violação de segurança (egress/persistência/SEFAZ) — nunca pode ser mascarada;
 *   2 — dependência técnica obrigatória indisponível (Java 17 / golden / worker XSD real) —
 *       nunca retorna 0: só gate de composição NÃO conclui a prova integral;
 *   4 — manifesto divergente do golden;
 *   1 — falha de integridade (interno/Java/estrutura/contrato XSD/determinismo/idempotência/
 *       adulteração/isolamento) — inclui contrato XSD falso → nunca retorna 0;
 *   0 — todas as provas obrigatórias passaram.
 */
export function classifyProofExit(signals: ProofExitSignals): ProofExitCode {
  if (signals.databaseWrites > 0 || signals.sefazCalls > 0 || signals.externalEgress > 0) return 3
  if (!signals.dependencyAvailable || !signals.xsdWorkerReal) return 2
  if (!signals.manifestMatches) return 4
  const integrityOk =
    signals.internal &&
    signals.externalJava17 &&
    signals.structural &&
    signals.xsdContract &&
    signals.deterministic &&
    signals.idempotent &&
    signals.tamperDetected &&
    signals.storeIsolation
  if (!integrityOk) return 1
  return 0
}

export { loadCertificateMaterialFromPem, STORE_PROOF_A, STORE_PROOF_B, PROOF_CLOCK_ISO, PROOF_SEED }
