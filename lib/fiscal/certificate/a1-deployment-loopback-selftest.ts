/**
 * Self-test administrativo do A1 dentro do deployment (GOAL-016D-C-008).
 *
 * Esta capacidade NÃO é um transporte SEFAZ e não reutiliza/relaxa a authority test-only do
 * PR #49. O único socket criado é um par TLS local, preso por construção a `127.0.0.1` numa porta
 * efêmera escolhida pelo sistema operacional. Nenhum destino, porta ou opção de socket é aceito
 * do caller.
 */
import "server-only"

import { generateKeyPairSync, randomBytes } from "node:crypto"
import { createServer, connect, createSecureContext, type Server, type TLSSocket } from "node:tls"
import type { AddressInfo, Socket } from "node:net"
import forge from "node-forge"
import {
  loadA1MtlsMaterial,
  type A1MtlsMaterial,
  type LoadA1MtlsMaterialParams,
} from "./a1-mtls-material"

const LOOPBACK_HOST = "127.0.0.1" as const
const LOOPBACK_SERVER_NAME = "localhost" as const
const MATERIAL_TIMEOUT_MS = 5_000
const HANDSHAKE_TIMEOUT_MS = 10_000
const CLEANUP_TIMEOUT_MS = 2_000

export type A1DeploymentLoopbackSelftestCode =
  | "ok"
  | "listener_loopback_indisponivel"
  | "material_indisponivel"
  | "material_ou_tls_invalido"
  | "handshake_mtls_falhou"

export type A1DeploymentLoopbackSelftestResult = {
  ok: boolean
  codigo: A1DeploymentLoopbackSelftestCode
  materialResolvido: boolean
  secureContextOk: boolean
  clientCertificatePresented: boolean
  mtlsLoopbackOk: boolean
  destination: "loopback"
  externalNetworkAttempted: false
  /** Evidência interna/testável; a rota administrativa não a projeta. */
  listenerClosed: boolean
  /** Evidência interna/testável; a rota administrativa não a projeta. */
  materialDisposed: boolean
}

export type A1DeploymentLoopbackSelftestParams = {
  readonly storeId: string
  readonly blobRef: string
  readonly senhaRef: string
  /** Seam exclusivamente para testes determinísticos; a rota usa o loader real sobre process.env. */
  readonly loadMaterial?: (
    params: LoadA1MtlsMaterialParams,
  ) => Promise<A1MtlsMaterial>
  /** Hook de teste: só observa a porta já presa a loopback; não altera nenhum destino. */
  readonly beforeClientConnectForTest?: (port: number) => Promise<void>
  /** Seam de teste para simular runtime sem suporte a listener; a rota sempre usa node:tls. */
  readonly createServerForTest?: typeof createServer
}

type EphemeralServerIdentity = {
  privateKeyPem: string
  certificatePem: string
}

function ephemeralLoopbackServerIdentity(): EphemeralServerIdentity {
  const generated = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const privateKeyPem = generated.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem) as forge.pki.rsa.PrivateKey
  const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e)

  const certificate = forge.pki.createCertificate()
  certificate.publicKey = publicKey
  certificate.serialNumber = randomBytes(16).toString("hex").replace(/^0+/, "") || "01"
  certificate.validity.notBefore = new Date(Date.now() - 60_000)
  certificate.validity.notAfter = new Date(Date.now() + 5 * 60_000)
  const subject = [{ name: "commonName", value: LOOPBACK_SERVER_NAME }]
  certificate.setSubject(subject)
  certificate.setIssuer(subject)
  certificate.setExtensions([
    { name: "basicConstraints", cA: true },
    {
      name: "keyUsage",
      digitalSignature: true,
      keyEncipherment: true,
      keyCertSign: true,
      cRLSign: true,
    },
    { name: "extKeyUsage", serverAuth: true },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: LOOPBACK_SERVER_NAME },
        { type: 7, ip: LOOPBACK_HOST },
      ],
    },
  ])
  certificate.sign(privateKey, forge.md.sha256.create())

  return {
    privateKeyPem,
    certificatePem: forge.pki.certificateToPem(certificate),
  }
}

async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = () => {
      server.off("listening", onListening)
      reject(new Error("listener_loopback_indisponivel"))
    }
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("listener_loopback_indisponivel")
  return (address as AddressInfo).port
}

async function closeLoopbackServer(server: Server | null, sockets: Set<Socket>): Promise<boolean> {
  for (const socket of sockets) socket.destroy()
  if (!server?.listening) return true
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (closed: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(closed)
    }
    const timer = setTimeout(() => {
      for (const socket of sockets) socket.destroy()
      server.unref()
      finish(false)
    }, CLEANUP_TIMEOUT_MS)
    timer.unref?.()
    try {
      server.close((error) => finish(!error))
    } catch {
      finish(false)
    }
  })
}

async function loadMaterialBeforeDeadline(
  loadMaterial: (params: LoadA1MtlsMaterialParams) => Promise<A1MtlsMaterial>,
  params: LoadA1MtlsMaterialParams,
): Promise<A1MtlsMaterial> {
  const pending = loadMaterial(params)
  let timer: ReturnType<typeof setTimeout> | null = null
  let timedOut = false
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          reject(new Error("material_indisponivel"))
        }, MATERIAL_TIMEOUT_MS)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    if (timedOut) {
      // Providers futuros podem não ser abortáveis. Se resolverem tarde, o material ainda é
      // descartado sem reabrir a execução, listener ou resposta administrativa.
      void pending.then(
        (lateMaterial) => {
          try {
            lateMaterial.dispose()
          } catch {
            // best-effort: nunca propaga erro tardio nem material para logs
          }
        },
        () => undefined,
      )
    }
  }
}

function emptyResult(): A1DeploymentLoopbackSelftestResult {
  return {
    ok: false,
    codigo: "handshake_mtls_falhou",
    materialResolvido: false,
    secureContextOk: false,
    clientCertificatePresented: false,
    mtlsLoopbackOk: false,
    destination: "loopback",
    externalNetworkAttempted: false,
    listenerClosed: false,
    materialDisposed: false,
  }
}

/**
 * Prova em memória: material resolve, OpenSSL aceita PFX/senha e o peer TLS local recebe um
 * certificado de cliente cuja chave privada foi usada no handshake. Toda falha é sanitizada.
 */
export async function runA1DeploymentLoopbackSelftest(
  params: A1DeploymentLoopbackSelftestParams,
): Promise<A1DeploymentLoopbackSelftestResult> {
  const result = emptyResult()
  const loadMaterial = params.loadMaterial ?? loadA1MtlsMaterial
  const createLoopbackServer = params.createServerForTest ?? createServer
  const sockets = new Set<Socket>()
  const connection: { client: TLSSocket | null } = { client: null }
  let server: Server | null = null
  let material: A1MtlsMaterial | null = null
  let identity: EphemeralServerIdentity | null = null
  let handshakeTimer: ReturnType<typeof setTimeout> | null = null
  let closing = false
  let phase: "listener" | "material" | "secure_context" | "handshake" = "material"

  try {
    material = await loadMaterialBeforeDeadline(loadMaterial, {
      storeId: params.storeId,
      blobRef: params.blobRef,
      senhaRef: params.senhaRef,
    })
    result.materialResolvido = true

    phase = "secure_context"
    // PKI exclusivamente sintética/efêmera para autenticar o peer servidor local.
    identity = ephemeralLoopbackServerIdentity()
    const secureContextHolder: { value: ReturnType<typeof createSecureContext> | null } = {
      value: null,
    }
    material.withTlsOptions(({ pfx, passphrase }) => {
      secureContextHolder.value = createSecureContext({
        pfx,
        passphrase,
        ca: identity!.certificatePem,
        minVersion: "TLSv1.2",
      })
    })
    if (!secureContextHolder.value) throw new Error("material_ou_tls_invalido")
    result.secureContextOk = true

    phase = "listener"
    const peerCertificates = new Map<number, Buffer>()
    const peerWaiters = new Map<number, (raw: Buffer) => void>()
    const peerCertificateForPort = (port: number): Promise<Buffer> => {
      const existing = peerCertificates.get(port)
      if (existing) return Promise.resolve(existing)
      return new Promise<Buffer>((resolve) => peerWaiters.set(port, resolve))
    }

    server = createLoopbackServer(
      {
        key: identity.privateKeyPem,
        cert: identity.certificatePem,
        requestCert: true,
        rejectUnauthorized: false,
        minVersion: "TLSv1.2",
      },
      (socket) => {
        const remotePort = socket.remotePort
        const peer = socket.getPeerCertificate()
        if (socket.remoteAddress === LOOPBACK_HOST && remotePort && peer.raw?.length) {
          const raw = Buffer.from(peer.raw)
          peerCertificates.set(remotePort, raw)
          peerWaiters.get(remotePort)?.(raw)
          peerWaiters.delete(remotePort)
        }
        socket.end()
      },
    )
    server.on("connection", (socket) => {
      if (closing) {
        socket.destroy()
        return
      }
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
    })

    const port = await listenOnLoopback(server)

    phase = "handshake"
    await params.beforeClientConnectForTest?.(port)
    const clientConnected = new Promise<void>((resolve, reject) => {
      connection.client = connect({
        host: LOOPBACK_HOST,
        port,
        servername: LOOPBACK_SERVER_NAME,
        secureContext: secureContextHolder.value!,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
      })
      connection.client.once("secureConnect", resolve)
      connection.client.once("error", () => reject(new Error("handshake_mtls_falhou")))
    })
    const timeout = new Promise<never>((_, reject) => {
      handshakeTimer = setTimeout(
        () => reject(new Error("handshake_mtls_falhou")),
        HANDSHAKE_TIMEOUT_MS,
      )
      handshakeTimer.unref?.()
    })
    await Promise.race([clientConnected, timeout])
    const activeClient = connection.client
    const localPort = activeClient?.localPort
    const localCertificate = activeClient?.getCertificate() as { raw?: Buffer } | undefined
    if (!localPort || !localCertificate?.raw?.length) throw new Error("handshake_mtls_falhou")

    const peerRaw = await Promise.race([peerCertificateForPort(localPort), timeout])
    const presented = peerRaw.equals(localCertificate.raw)
    result.clientCertificatePresented = presented
    if (!presented) throw new Error("handshake_mtls_falhou")

    result.ok = true
    result.codigo = "ok"
    result.mtlsLoopbackOk = true

  } catch {
    result.codigo =
      phase === "listener"
        ? "listener_loopback_indisponivel"
        : phase === "material"
          ? "material_indisponivel"
          : phase === "secure_context"
            ? "material_ou_tls_invalido"
            : "handshake_mtls_falhou"
  } finally {
    closing = true
    if (handshakeTimer) clearTimeout(handshakeTimer)
    handshakeTimer = null
    connection.client?.destroy()
    connection.client = null
    if (material) {
      try {
        material.dispose()
        result.materialDisposed = true
      } catch {
        result.materialDisposed = false
      }
      material = null
    }
    try {
      result.listenerClosed = await closeLoopbackServer(server, sockets)
    } catch {
      result.listenerClosed = false
    }
    server = null
    // Strings JavaScript não são zeráveis; removemos as referências e deixamos a coleta ao GC.
    identity = null
  }

  if (!result.listenerClosed || (result.materialResolvido && !result.materialDisposed)) {
    result.ok = false
    result.mtlsLoopbackOk = false
    result.codigo = "handshake_mtls_falhou"
  }
  return result
}
