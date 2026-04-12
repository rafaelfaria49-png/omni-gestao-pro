/**
 * Envio de ESC/POS para impressora raw (localhost:9100) via proxy Next.js,
 * download de .bin para QZ Tray / utilitários, ou impressão HTML mínima (80mm).
 */

export function uint8ToBase64(u8: Uint8Array): string {
  let s = ""
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
  if (typeof btoa !== "undefined") return btoa(s)
  return Buffer.from(u8).toString("base64")
}

export type SendEscPosResult =
  | { ok: true; via: "proxy" }
  | { ok: false; error: string }

/**
 * POST /api/print/raw com corpo JSON { data: base64 }.
 * O servidor envia por TCP (padrão 127.0.0.1:9100) ou THERMAL_PRINT_HTTP_URL se configurado.
 */
export async function sendEscPosViaProxy(bytes: Uint8Array): Promise<SendEscPosResult> {
  try {
    const res = await fetch("/api/print/raw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: uint8ToBase64(bytes) }),
    })
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok || !j.ok) {
      return { ok: false, error: j.error || res.statusText || "Falha no proxy de impressão" }
    }
    return { ok: true, via: "proxy" }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

export function downloadEscPosFile(bytes: Uint8Array, filename = "cupom-escpos.bin") {
  const blob = new Blob([bytes], { type: "application/octet-stream" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * HTML 80mm para impressão pelo navegador: margens zeradas em @page.
 * Aviso: cabeçalho/rodapé (data, URL) dependem da opção "Cabeçalhos e rodapés" do diálogo de impressão.
 */
export function openThermalHtmlPrint(htmlBodyInner: string, title = "Cupom") {
  const w = window.open("", "_blank")
  if (!w) return
  const doc = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
    font-size: 12px;
    color: #000;
    background: #fff;
  }
  .wrap {
    box-sizing: border-box;
    width: 72mm;
    max-width: 100%;
    margin: 0 auto;
    padding: 2mm 3mm 4mm;
  }
  @media print {
    @page { size: 80mm auto; margin: 0; }
    html, body { background: #fff; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<div class="wrap">${htmlBodyInner}</div>
<p class="no-print" style="padding:8px;font-size:11px;color:#666">
  Desative &quot;Cabeçalhos e rodapés&quot; na impressão para ocultar data e URL.
</p>
<script>
  window.onload = function () {
    window.setTimeout(function () {
      window.print();
    }, 200);
  };
</script>
</body>
</html>`
  w.document.open()
  w.document.write(doc)
  w.document.close()
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
