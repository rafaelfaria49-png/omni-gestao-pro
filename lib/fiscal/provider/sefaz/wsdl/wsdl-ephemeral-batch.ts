/**
 * Batch fechado da futura evidência H-9/H-10: exatamente os seis alvos canônicos, uma authority
 * e no máximo um GET por serviço. Não aceita URL, host, path, porta, serviço, quantidade ou retry.
 */
import "server-only"

import { randomUUID } from "node:crypto"
import type { SecureContext } from "node:tls"
import type { SefazServico } from "../sefaz-endpoint-catalog"
import {
  SefazWsdlAcquisition,
  type SefazWsdlAcquisitionOutcome,
} from "./wsdl-acquisition"
import {
  SEFAZ_WSDL_ACQUISITION_TARGETS,
  canonicalSefazWsdlTarget,
  type SefazWsdlTarget,
} from "./wsdl-acquisition-target"
import {
  createWsdlEphemeralExternalAuthority,
  type SefazWsdlExecutionAuthority,
} from "./wsdl-execution-authority"
import type { WsdlExecutionActivation } from "./wsdl-ephemeral-execution-window"
import {
  WSDL_EXECUTION_EXPECTED_TARGETS,
} from "./wsdl-ephemeral-execution-window"
import { extractSefazWsdlContract } from "./wsdl-extraction"

type CertificateRefs = {
  readonly storeId: string
  readonly blobRef: string
  readonly senhaRef: string
}

export type WsdlEphemeralServiceEvidence = {
  readonly service: SefazServico
  readonly httpStatus: number | null
  readonly byteLength: number | null
  readonly sha256: string | null
  readonly contentTypeEvidence: string | null
  readonly h9: boolean
  readonly h10: boolean
  readonly operation: string | null
  readonly binding: string | null
  readonly soapAction: string | null
  readonly inputWrapper: string | null
  readonly inputNamespace: string | null
  readonly outputWrapper: string | null
  readonly outputNamespace: string | null
  readonly failureClass: string | null
}

export type WsdlEphemeralBatchResult = {
  readonly ok: boolean
  readonly code: "completed" | "catalog_invalid"
  readonly services: readonly WsdlEphemeralServiceEvidence[]
}

type BatchDependencies = {
  readonly createAuthority: (input: {
    readonly activation: WsdlExecutionActivation
    readonly target: SefazWsdlTarget
  }) => SefazWsdlExecutionAuthority | null
  readonly acquire: (input: {
    readonly target: SefazWsdlTarget
    readonly authority: SefazWsdlExecutionAuthority
    readonly certificate: CertificateRefs
    readonly preparedSecureContext: SecureContext
    readonly correlationId: string
  }) => Promise<SefazWsdlAcquisitionOutcome>
  readonly correlationId: () => string
}

const DEFAULT_DEPENDENCIES: BatchDependencies = {
  createAuthority: createWsdlEphemeralExternalAuthority,
  acquire: async ({ target, authority, certificate, preparedSecureContext, correlationId }) =>
    new SefazWsdlAcquisition({ executionAuthority: authority }).acquire({
      uf: target.uf,
      ambiente: target.ambiente,
      servico: target.servico,
      versao: target.versao,
      certificate,
      preparedSecureContext,
      correlationId,
    }),
  correlationId: randomUUID,
}

function failureEvidence(service: SefazServico, failureClass: string): WsdlEphemeralServiceEvidence {
  return {
    service,
    httpStatus: null,
    byteLength: null,
    sha256: null,
    contentTypeEvidence: null,
    h9: false,
    h10: false,
    operation: null,
    binding: null,
    soapAction: null,
    inputWrapper: null,
    inputNamespace: null,
    outputWrapper: null,
    outputNamespace: null,
    failureClass,
  }
}

function closedTargets(): readonly SefazWsdlTarget[] | null {
  if (SEFAZ_WSDL_ACQUISITION_TARGETS.length !== WSDL_EXECUTION_EXPECTED_TARGETS) return null
  const targets: SefazWsdlTarget[] = []
  const services = new Set<SefazServico>()
  for (const candidate of SEFAZ_WSDL_ACQUISITION_TARGETS) {
    const target = canonicalSefazWsdlTarget(candidate)
    if (!target || services.has(target.servico)) return null
    services.add(target.servico)
    targets.push(target)
  }
  return services.size === WSDL_EXECUTION_EXPECTED_TARGETS ? Object.freeze(targets) : null
}

async function executeBatch(
  input: {
    readonly activation: WsdlExecutionActivation
    readonly certificate: CertificateRefs
    readonly preparedSecureContext: SecureContext
  },
  dependencies: BatchDependencies,
): Promise<WsdlEphemeralBatchResult> {
  const targets = closedTargets()
  if (!targets) return { ok: false, code: "catalog_invalid", services: [] }

  const services: WsdlEphemeralServiceEvidence[] = []
  for (const target of targets) {
    const authority = dependencies.createAuthority({ activation: input.activation, target })
    if (!authority) {
      services.push(failureEvidence(target.servico, "authority_unavailable"))
      continue
    }

    let outcome: SefazWsdlAcquisitionOutcome
    try {
      outcome = await dependencies.acquire({
        target,
        authority,
        certificate: input.certificate,
        preparedSecureContext: input.preparedSecureContext,
        correlationId: `${dependencies.correlationId()}:${target.servico}`,
      })
    } catch {
      services.push(failureEvidence(target.servico, "acquisition_exception"))
      continue
    }
    if (!outcome.ok) {
      services.push(failureEvidence(target.servico, `acquisition:${outcome.codigo}`))
      continue
    }

    const extraction = extractSefazWsdlContract({
      servico: target.servico,
      alvo: target,
      documento: outcome.documento,
    })
    if (!extraction.ok) {
      services.push({
        ...failureEvidence(target.servico, `extraction:${extraction.codigo}`),
        httpStatus: outcome.httpStatus,
        byteLength: outcome.byteLength,
        sha256: outcome.sha256,
        contentTypeEvidence: outcome.contentTypeEvidencia,
      })
      continue
    }

    const contract = extraction.contrato
    services.push({
      service: target.servico,
      httpStatus: outcome.httpStatus,
      byteLength: outcome.byteLength,
      sha256: outcome.sha256,
      contentTypeEvidence: outcome.contentTypeEvidencia,
      h9: extraction.fechaH9,
      h10: extraction.fechaH10,
      operation: contract.operationName,
      binding: contract.bindingName,
      soapAction: contract.soapAction,
      inputWrapper: contract.inputWrapperLocalName,
      inputNamespace: contract.inputWrapperNamespace,
      outputWrapper: contract.outputWrapperLocalName,
      outputNamespace: contract.outputWrapperNamespace,
      failureClass: null,
    })
  }

  return {
    ok:
      services.length === WSDL_EXECUTION_EXPECTED_TARGETS &&
      services.every((service) => service.h9 && service.h10 && service.failureClass === null),
    code: "completed",
    services: Object.freeze(services),
  }
}

export async function runConfiguredWsdlEphemeralBatch(input: {
  readonly activation: WsdlExecutionActivation
  readonly certificate: CertificateRefs
  readonly preparedSecureContext: SecureContext
}): Promise<WsdlEphemeralBatchResult> {
  return executeBatch(input, DEFAULT_DEPENDENCIES)
}

/** Seam estritamente test-only; não existe forma de injetar runtime/destino na função produtiva. */
export function createWsdlEphemeralBatchTestRunner(
  dependencies: BatchDependencies,
): (input: {
    readonly activation: WsdlExecutionActivation
    readonly certificate: CertificateRefs
    readonly preparedSecureContext: SecureContext
  }) => Promise<WsdlEphemeralBatchResult> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Runner injetável do batch WSDL disponível somente em testes.")
  }
  return (input) => executeBatch(input, dependencies)
}
