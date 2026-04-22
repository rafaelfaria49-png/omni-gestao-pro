import { labelStatusOS } from "@/lib/os-status"
import type { StatusOrdemServico } from "@/generated/prisma"

export type ViaClientePayload = {
  id: string
  clienteNome: string
  clienteTelefone?: string | null
  equipamento: string
  imei?: string | null
  corAparelho?: string | null
  senhaAparelho?: string | null
  checklistEntrada?: Partial<Record<"liga" | "touch" | "cameras" | "botoes" | "wifi", "ok" | "nok" | "nt">>
  acessorios?: { chip?: boolean; cartaoSd?: boolean; capinha?: boolean; carregador?: boolean }
  /** Valor da mão de obra (serviço sem peças). */
  valorMaoObra?: number
  /** Soma custo das peças (custo interno). */
  custoPecas?: number
  /** Subtotal peças (venda). */
  valorPecas?: number
  defeito: string
  laudoTecnico?: string | null
  valorTotal: number
  status: StatusOrdemServico
  createdAt: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "R$ 0,00"
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function checklistLabel(v: "ok" | "nok" | "nt" | undefined): string {
  if (v === "ok") return "OK"
  if (v === "nok") return "N/OK"
  return "N/T"
}

function fmtBool(v: boolean | undefined): string {
  return v ? "Sim" : "Não"
}

function formatData(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
}

/**
 * Abre uma janela com layout simples preto e branco (térmica ou A4) e dispara a impressão.
 */
export function imprimirViaCliente(payload: ViaClientePayload): void {
  const w = window.open("", "_blank", "noopener,noreferrer")
  if (!w) {
    window.alert("Permita pop-ups para imprimir a via do cliente.")
    return
  }

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>OS ${escapeHtml(payload.id.slice(0, 8))}… — Via cliente</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12mm;
      font-family: ui-monospace, "Courier New", Courier, monospace;
      font-size: 12px;
      line-height: 1.35;
      color: #000;
      background: #fff;
      max-width: 210mm;
    }
    h1 {
      font-size: 14px;
      margin: 0 0 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 2px solid #000;
      padding-bottom: 6px;
    }
    .muted { color: #333; font-size: 11px; }
    .row { margin: 6px 0; }
    .label { font-weight: 700; display: inline-block; min-width: 9em; }
    .block { margin-top: 10px; white-space: pre-wrap; word-break: break-word; }
    .footer { margin-top: 14px; padding-top: 8px; border-top: 1px dashed #000; font-size: 10px; text-align: center; }
    @media print {
      body { padding: 8mm; }
    }
  </style>
</head>
<body>
  <h1>Ordem de serviço — Via do cliente</h1>
  <p class="muted">ID: ${escapeHtml(payload.id)} · Entrada: ${escapeHtml(formatData(payload.createdAt))}</p>
  <div class="row"><span class="label">Cliente:</span> ${escapeHtml(payload.clienteNome)}</div>
  <div class="row"><span class="label">Telefone:</span> ${escapeHtml(payload.clienteTelefone?.trim() || "—")}</div>
  <div class="row"><span class="label">Equipamento:</span> ${escapeHtml(payload.equipamento)}</div>
  <div class="row"><span class="label">IMEI:</span> ${escapeHtml(payload.imei?.trim() || "—")}</div>
  <div class="row"><span class="label">Cor:</span> ${escapeHtml(payload.corAparelho?.trim() || "—")}</div>
  <div class="row"><span class="label">Senha:</span> ${escapeHtml(payload.senhaAparelho?.trim() || "—")}</div>
  <div class="row"><span class="label">Checklist:</span>
    Liga ${escapeHtml(checklistLabel(payload.checklistEntrada?.liga))} ·
    Touch ${escapeHtml(checklistLabel(payload.checklistEntrada?.touch))} ·
    Câmeras ${escapeHtml(checklistLabel(payload.checklistEntrada?.cameras))} ·
    Botões ${escapeHtml(checklistLabel(payload.checklistEntrada?.botoes))} ·
    Wi‑Fi ${escapeHtml(checklistLabel(payload.checklistEntrada?.wifi))}
  </div>
  <div class="row"><span class="label">Acessórios:</span>
    Chip ${escapeHtml(fmtBool(payload.acessorios?.chip))} ·
    SD ${escapeHtml(fmtBool(payload.acessorios?.cartaoSd))} ·
    Capinha ${escapeHtml(fmtBool(payload.acessorios?.capinha))} ·
    Carregador ${escapeHtml(fmtBool(payload.acessorios?.carregador))}
  </div>
  <div class="row"><span class="label">Status:</span> ${escapeHtml(labelStatusOS(payload.status))}</div>
  <div class="row"><span class="label">Mão de obra:</span> ${escapeHtml(formatMoney(payload.valorMaoObra ?? 0))}</div>
  <div class="row"><span class="label">Peças:</span> ${escapeHtml(formatMoney(payload.valorPecas ?? 0))}</div>
  <div class="row"><span class="label">Custo peças:</span> ${escapeHtml(formatMoney(payload.custoPecas ?? 0))}</div>
  <div class="row"><span class="label">Valor total:</span> ${escapeHtml(formatMoney(payload.valorTotal))}</div>
  <div class="block"><span class="label">Defeito relatado:</span><br/>${escapeHtml(payload.defeito)}</div>
  ${
    payload.laudoTecnico?.trim()
      ? `<div class="block"><span class="label">Laudo técnico:</span><br/>${escapeHtml(payload.laudoTecnico.trim())}</div>`
      : ""
  }
  <div class="footer">
    Documento sem valor fiscal · ${escapeHtml(new Date().toLocaleString("pt-BR"))}
  </div>
</body>
</html>`

  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => {
    w.print()
  }, 200)
}
