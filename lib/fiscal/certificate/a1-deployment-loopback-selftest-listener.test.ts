import { EventEmitter } from "node:events"
import type { Server } from "node:tls"
import { describe, expect, it, vi } from "vitest"
import { createTestMtlsPki } from "@/lib/fiscal/provider/sefaz/__fixtures__/mtls-test-pki"
import { runA1DeploymentLoopbackSelftest } from "./a1-deployment-loopback-selftest"

class UnavailableLoopbackServer extends EventEmitter {
  readonly listening = false

  listen() {
    queueMicrotask(() => this.emit("error", new Error("bind indisponivel")))
    return this
  }

  address() {
    return null
  }

  close(callback?: (error?: Error) => void) {
    callback?.()
    return this
  }
}

describe("A1 deployment loopback self-test - runtime sem listener", () => {
  it("classifica listener indisponivel, descarta material e nao tenta outro destino", async () => {
    const pki = createTestMtlsPki()
    const dispose = vi.fn(() => pki.clientPfx.fill(0))
    const loadMaterial = vi.fn(async () => ({
      withTlsOptions: (consumer: (options: { pfx: Buffer; passphrase: string }) => unknown) =>
        consumer({ pfx: pki.clientPfx, passphrase: pki.clientPassphrase }),
      dispose,
    }))

    try {
      const result = await runA1DeploymentLoopbackSelftest({
        storeId: "loja-1",
        blobRef: "FISCAL_A1_PFX_B64_LOJA_1",
        senhaRef: "FISCAL_A1_SENHA_LOJA_1",
        loadMaterial,
        createServerForTest: (() => new UnavailableLoopbackServer() as unknown as Server) as never,
      })

      expect(result).toEqual({
        ok: false,
        codigo: "listener_loopback_indisponivel",
        materialResolvido: true,
        secureContextOk: true,
        clientCertificatePresented: false,
        mtlsLoopbackOk: false,
        destination: "loopback",
        externalNetworkAttempted: false,
        listenerClosed: true,
        materialDisposed: true,
      })
      expect(loadMaterial).toHaveBeenCalledOnce()
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      pki.clientPfx.fill(0)
      pki.wrongClientPfx.fill(0)
    }
  })
})
