/**
 * Autoridade de execução da aquisição de WSDL (GOAL-017 · H-9/H-10).
 *
 * A capacidade de aquisição é **inerte por construção**: sem uma autoridade íntegra, ela recusa
 * antes de resolver o A1, antes de criar contexto TLS e antes de qualquer socket. A autoridade
 * não é um booleano nem uma flag de ambiente — é um token opaco, **one-shot**, criado junto do
 * runtime que ele autoriza e **preso à tupla do alvo**.
 *
 * ## Por que não existe fábrica de autoridade real neste GOAL
 *
 * Este slice para ANTES da rede externa. A única fábrica exportada exige `NODE_ENV === "test"`
 * e devolve um runtime cravado em `127.0.0.1`. Consequência honesta e intencional: **em
 * produção não existe caminho para autorizar um GET externo** — nem por env, nem por flag, nem
 * por wiring acidental. O gate humano do próximo GOAL adiciona a fábrica real; até lá, a
 * ausência dela é a barreira.
 *
 * Uma flag de ambiente seria a escolha errada aqui: a contenção
 * `FISCAL_016D_C_CONTAINMENT_016` provou que `vercel env rm` fecha apenas o alias — cada
 * deployment antigo carrega o snapshot da env e permanece com a capacidade ligada. Uma
 * capacidade que só existe se o código for alterado não tem esse resíduo.
 *
 * ## Vínculo ao alvo
 *
 * A autoridade é emitida para UM `(uf, ambiente, serviço, versão)`. Reapresentá-la para outro
 * serviço não autoriza nada. Isso é o que torna mecânica a regra "no máximo um GET autenticado
 * por endpoint canônico" do próximo GOAL: cada endpoint exige a sua própria emissão.
 *
 * Este módulo NÃO reutiliza nem relaxa a authority loopback do transporte SOAP
 * (`sefaz-runtime-ports`) e NÃO reutiliza o self-test de deployment já encerrado. Ele
 * compartilha apenas os **tipos de porta Node** — `request`/`createSecureContext` —, que são
 * infraestrutura, não capacidade.
 */
import { request as nodeHttpsRequest } from "node:https"
import { createSecureContext as nodeCreateSecureContext } from "node:tls"
import type { SefazHttpsRequestOptions, SefazHttpsRuntimePorts } from "../sefaz-runtime-ports"
import {
  SEFAZ_WSDL_METHOD,
  SEFAZ_WSDL_QUERY,
  canonicalSefazWsdlTarget,
  type SefazWsdlTarget,
} from "./wsdl-acquisition-target"
import {
  consumeWsdlTargetExecutionPermit,
  type WsdlExecutionActivation,
  wsdlExecutionActivationStillActive,
} from "./wsdl-ephemeral-execution-window"

const WSDL_EXECUTION_AUTHORITY = Symbol("sefaz-wsdl-execution-authority")

/** Tupla mínima que identifica o alvo autorizado. Sem URL, host ou path. */
export type SefazWsdlAuthorityScope = {
  readonly uf: string
  readonly ambiente: string
  readonly servico: string
  readonly versao: string
}

/**
 * Token opaco. Não expõe runtime nem método de autorização; a associação vive no `WeakMap`
 * privado abaixo. Copiar, clonar ou forjar o objeto não reproduz a autoridade.
 */
export type SefazWsdlExecutionAuthority = {
  readonly [WSDL_EXECUTION_AUTHORITY]: true
}

/** Observabilidade exclusivamente de teste; nenhum campo carrega segredo. */
export type SefazWsdlLoopbackTestProbe = {
  secureContextCalls: number
  runtimeRequestCalls: number
  nodeRequestCalls: number
  destroyCalls: number
  destinations: string[]
  methods: string[]
  paths: string[]
  /** Host lógico/SNI efetivamente apresentado — prova de qual destino seria alcançado na rede. */
  servernames: string[]
}

export type SefazWsdlLoopbackTestAuthorityOptions = {
  readonly port: number
  readonly trustedCaPem: string
  readonly escopo: SefazWsdlAuthorityScope
  readonly withoutClientCertificate?: boolean
  readonly throwSynchronouslyBeforeNodeRequest?: boolean
  readonly probe?: SefazWsdlLoopbackTestProbe
}

type AuthorityBinding = {
  available: boolean
  readonly runtime: SefazHttpsRuntimePorts
  readonly escopo: SefazWsdlAuthorityScope
}

const bindings = new WeakMap<object, AuthorityBinding>()

function bindAuthority(
  runtime: SefazHttpsRuntimePorts,
  escopo: SefazWsdlAuthorityScope,
): SefazWsdlExecutionAuthority {
  const authority = Object.freeze({ [WSDL_EXECUTION_AUTHORITY]: true as const })
  bindings.set(authority, {
    available: true,
    runtime,
    escopo: Object.freeze({ ...escopo }),
  })
  return authority
}

export function novoWsdlLoopbackTestProbe(): SefazWsdlLoopbackTestProbe {
  return {
    secureContextCalls: 0,
    runtimeRequestCalls: 0,
    nodeRequestCalls: 0,
    destroyCalls: 0,
    destinations: [],
    methods: [],
    paths: [],
    servernames: [],
  }
}

function assertLoopbackOptions(options: SefazWsdlLoopbackTestAuthorityOptions): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Authority loopback de WSDL disponível somente no ambiente de testes.")
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new Error("Porta loopback de teste inválida.")
  }
  if (!options.trustedCaPem.trim()) {
    throw new Error("CA sintética de teste obrigatória.")
  }
  const { uf, ambiente, servico, versao } = options.escopo ?? ({} as SefazWsdlAuthorityScope)
  if (!uf?.trim() || !ambiente?.trim() || !servico?.trim() || !versao?.trim()) {
    throw new Error("Escopo do alvo é obrigatório para emitir a authority.")
  }
}

/**
 * Cria autoridade + runtime como unidade indivisível. O runtime sempre reescreve o destino
 * físico para `127.0.0.1:<port>`; host lógico e SNI continuam vindos do alvo canônico, para que
 * o teste exerça a mesma verificação de certificado que a rede real exigiria.
 */
export function createWsdlLoopbackTestAuthority(
  options: SefazWsdlLoopbackTestAuthorityOptions,
): SefazWsdlExecutionAuthority {
  assertLoopbackOptions(options)

  const runtime: SefazHttpsRuntimePorts = {
    createSecureContext: (tlsOptions) => {
      if (options.probe) options.probe.secureContextCalls += 1
      return nodeCreateSecureContext({
        ...tlsOptions,
        ...(options.withoutClientCertificate ? { pfx: undefined, passphrase: undefined } : {}),
        ca: options.trustedCaPem,
      })
    },
    request: (requestOptions, onResponse) => {
      if (options.probe) options.probe.runtimeRequestCalls += 1
      if (options.throwSynchronouslyBeforeNodeRequest) {
        throw new Error("Falha sintética antes de node:https.request.")
      }
      if (options.probe) {
        options.probe.nodeRequestCalls += 1
        options.probe.destinations.push(`127.0.0.1:${options.port}`)
        options.probe.methods.push(String(requestOptions.method ?? ""))
        options.probe.paths.push(String(requestOptions.path ?? ""))
        options.probe.servernames.push(String(requestOptions.servername ?? ""))
      }
      // Allowlist fechada de opções: nunca encaminhar `agent`, `createConnection`, `socketPath`,
      // `lookup` ou qualquer outro override de conexão recebido de um deep import.
      const loopbackOptions: SefazHttpsRequestOptions = {
        protocol: "https:",
        hostname: "127.0.0.1",
        port: options.port,
        path: requestOptions.path,
        method: requestOptions.method,
        headers: requestOptions.headers,
        agent: false,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        secureContext: requestOptions.secureContext,
        servername: requestOptions.servername,
      }
      const request = nodeHttpsRequest(loopbackOptions, onResponse)
      if (options.probe) {
        const destroy = request.destroy.bind(request)
        request.destroy = ((error?: Error) => {
          options.probe!.destroyCalls += 1
          return destroy(error)
        }) as typeof request.destroy
      }
      return request
    },
  }

  return bindAuthority(runtime, options.escopo)
}

/**
 * Emite UMA authority externa somente depois que o ledger global consumiu a ativação e somente
 * para uma entrada canônica ainda disponível. Destino, porta, método, path, headers e SNI são
 * reconstruídos a partir do alvo versionado; nenhum deles é aceito do caller HTTP.
 */
export function createWsdlEphemeralExternalAuthority(options: {
  readonly activation: WsdlExecutionActivation
  readonly target: SefazWsdlTarget
}): SefazWsdlExecutionAuthority | null {
  const target = canonicalSefazWsdlTarget(options.target)
  if (!target || !consumeWsdlTargetExecutionPermit(options.activation, target)) return null

  const expectedPath = `${target.path}?${SEFAZ_WSDL_QUERY}`
  const runtime: SefazHttpsRuntimePorts = {
    createSecureContext: (tlsOptions) =>
      nodeCreateSecureContext({
        pfx: tlsOptions.pfx,
        passphrase: tlsOptions.passphrase,
        minVersion: "TLSv1.2",
      }),
    request: (requestOptions, onResponse) => {
      // A1/vault/SecureContext podem consumir o restante da janela. Revalidar aqui, na última
      // instrução anterior a `node:https.request`, impede socket iniciado após `expiresAt`.
      if (!wsdlExecutionActivationStillActive(options.activation)) {
        throw new Error("Janela efêmera WSDL expirada antes da tentativa de rede.")
      }
      if (
        requestOptions.protocol !== "https:" ||
        requestOptions.hostname !== target.host ||
        requestOptions.servername !== target.host ||
        requestOptions.port !== 443 ||
        requestOptions.path !== expectedPath ||
        requestOptions.method !== SEFAZ_WSDL_METHOD
      ) {
        throw new Error("Runtime WSDL recusou opções divergentes do alvo canônico.")
      }
      const fixedOptions: SefazHttpsRequestOptions = {
        protocol: "https:",
        hostname: target.host,
        port: 443,
        path: expectedPath,
        method: SEFAZ_WSDL_METHOD,
        headers: {
          Accept: "text/xml, application/xml",
          Connection: "close",
        },
        agent: false,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        secureContext: requestOptions.secureContext,
        servername: target.host,
      }
      return nodeHttpsRequest(fixedOptions, onResponse)
    },
  }

  return bindAuthority(runtime, {
    uf: target.uf,
    ambiente: target.ambiente,
    servico: target.servico,
    versao: target.versao,
  })
}

/** Validação nominal em runtime; cast, clone e objeto estrutural não atravessam o `WeakMap`. */
export function isWsdlExecutionAuthority(
  authority: SefazWsdlExecutionAuthority | null,
): boolean {
  return authority !== null && bindings.has(authority)
}

/**
 * Consome no máximo UMA vez e somente para o alvo emitido. Devolve apenas o runtime — nunca uma
 * capability separável, nunca um runtime retargetable. Divergência de escopo não consome a
 * autoridade: ela continua disponível para o alvo correto, e a tentativa errada morre sem rede.
 */
export function consumeWsdlExecutionAuthority(
  authority: SefazWsdlExecutionAuthority,
  contexto: { readonly alvo: SefazWsdlTarget; readonly correlationId: string },
): SefazHttpsRuntimePorts | null {
  const binding = bindings.get(authority)
  if (!binding?.available) return null
  const { escopo } = binding
  if (
    escopo.uf !== contexto.alvo.uf ||
    escopo.ambiente !== contexto.alvo.ambiente ||
    escopo.servico !== contexto.alvo.servico ||
    escopo.versao !== contexto.alvo.versao
  ) {
    return null
  }
  binding.available = false
  return binding.runtime
}
