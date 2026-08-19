import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { gerarRascunho } from "@/lib/contador/notificacoes/rascunhos"
import { CHECKLIST_IDS_STALE, EXTERNAL_SEND_ALLOWED } from "@/lib/contador/notificacoes/tipos"
import { DOCUMENTO_PENDENTE_THRESHOLD, FECHAMENTO_PROXIMO_DAYS, THRESHOLD_HUMAN_DECISION_REQUIRED } from "@/lib/contador/notificacoes/limiares"

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

  it("GET da API é somente leitura (não persiste alerta)", () => {
    const getSrc = readFileSync(join(API_DIR, "route.ts"), "utf8")
    expect(getSrc).toContain("listarAlertas")
    expect(getSrc).not.toContain("avaliarEPersistir")
    expect(getSrc).not.toContain("registrarEventoUnico")
    expect(getSrc).not.toContain("garantirEmitidoETratado")
  })

  it("não usa os sinais stale do checklist como fonte nem reconstrói pendências", () => {
    const regras = readFileSync(join(NOTIF_DIR, "regras.ts"), "utf8")
    const fontePacote = readFileSync(join(NOTIF_DIR, "pacote-fonte.ts"), "utf8")
    const repoPrisma = readFileSync(join(NOTIF_DIR, "repo-prisma.ts"), "utf8")
    const manifestoZip = readFileSync(join(NOTIF_DIR, "manifesto-zip.ts"), "utf8")
    expect(fontePacote).toContain("CHECKLIST_IDS_STALE")
    expect(fontePacote).not.toContain("montarPendencias")
    expect(fontePacote).not.toContain("detalhadasSemParcial")
    expect(CHECKLIST_IDS_STALE).toEqual(["documentos", "fechamento_oficial"])
    expect(regras).not.toContain("snapshot.checklist")
    expect(regras).not.toContain("pendenciasOperacionaisDoSnapshot")
    expect(regras).not.toContain("montarPendencias")
    expect(regras).toContain("pendenciasOperacionaisDoManifesto")
    expect(repoPrisma).toContain("lerPendenciasDoManifestoOficial")
    expect(repoPrisma).toContain("abrirConteudoPrivado")
    expect(manifestoZip).toContain("sha256Hex")
    expect(manifestoZip).toContain("manifest.json")
  })

  it("limiares ratificados: estado do documento, 7 dias de fechamento, sem pendência humana", () => {
    expect(DOCUMENTO_PENDENTE_THRESHOLD).toBe("STATE_ONLY")
    expect(FECHAMENTO_PROXIMO_DAYS).toBe(7)
    expect(THRESHOLD_HUMAN_DECISION_REQUIRED).toBe(false)
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
