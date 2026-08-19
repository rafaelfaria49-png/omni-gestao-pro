import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { gerarRascunho } from "@/lib/contador/notificacoes/rascunhos"
import { CHECKLIST_IDS_STALE, EXTERNAL_SEND_ALLOWED } from "@/lib/contador/notificacoes/tipos"
import { THRESHOLD_HUMAN_DECISION_REQUIRED } from "@/lib/contador/notificacoes/limiares"

const DIR = dirname(fileURLToPath(import.meta.url))
const NOTIF_DIR = join(DIR, "../../notificacoes")
const API_DIR = join(DIR, "../../../../app/api/contador/notificacoes")

function lerArvore(dir: string): string {
  let out = ""
  for (const nome of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, nome.name)
    if (nome.isDirectory()) out += lerArvore(p)
    else if (/\.(ts|tsx)$/.test(nome.name)) out += readFileSync(p, "utf8")
  }
  return out
}

describe("notificacoes · honesty de envio e fontes", () => {
  it("EXTERNAL_SEND_ALLOWED=false e nenhum import/call de send Cloud/WhatsApp/Graph", () => {
    expect(EXTERNAL_SEND_ALLOWED).toBe(false)
    const src = lerArvore(NOTIF_DIR) + lerArvore(API_DIR)
    expect(src).not.toMatch(/sendCloudApi|sendWhatsAppMessage|graph\.facebook|graph\.instagram/i)
    expect(src).not.toMatch(/tipo:\s*EVENTO_MENSAGEM_ENVIADA/)
    expect(src).not.toMatch(/tipo:\s*["']mensagem_enviada["']/)
    expect(src).not.toContain("/enviar")
    expect(src).not.toMatch(/from ["']@\/lib\/whatsapp/)
    expect(src).not.toMatch(/from ["']@\/lib\/omni-agent/)
  })

  it("não usa os sinais stale do checklist como fonte", () => {
    const regras = readFileSync(join(NOTIF_DIR, "regras.ts"), "utf8")
    expect(regras).toContain("CHECKLIST_IDS_STALE")
    expect(CHECKLIST_IDS_STALE).toEqual(["documentos", "fechamento_oficial"])
    expect(regras).toContain("STALE.has(id)")
    expect(regras).not.toMatch(/id === ["']documentos["']/)
    expect(regras).not.toMatch(/id === ["']fechamento_oficial["']/)
  })

  it("limiares sem número aprovado ficam explícitos", () => {
    expect(THRESHOLD_HUMAN_DECISION_REQUIRED).toEqual([
      "docPendenteDiasAntesFechamento",
      "competenciaAbertaAposDia",
    ])
  })

  it("rascunho recusa se o texto cair no padrão proibido", () => {
    expect(() =>
      gerarRascunho(
        {
          regra: "documento_pendente",
          alvo: "doc-1",
          origem: "documento",
          severidade: "media",
          titulo: "ver https://evil.example/token",
          prazo: null,
          janela: "dia:2026-08-19",
        },
        { competencia: "2026-08", lojaRef: "loja:loja-1" },
      ),
    ).toThrow(/contrato mínimo/)
  })
})
