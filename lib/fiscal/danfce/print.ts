/**
 * Integração do DANFC-e com o stack de impressão já existente.
 *
 * HTML: `openThermalHtmlPrint` (58/80 mm).
 * Térmica raw: `printWithFallback` + ESC/POS do renderer fiscal.
 * Não cria proxy, porta ou ESC/POS paralelos.
 */

import { BOBINA_CHARS, type PdvImpressaoConfig } from "@/lib/pdv-impressao-config"
import { printWithFallback, type PrintJobResult } from "@/lib/pdv-print-runtime"
import { openThermalHtmlPrint } from "@/lib/thermal-print"
import { renderDanfceEscPos } from "./render-escpos"
import { renderDanfceHtml } from "./render-html"
import type { DanfceModel } from "./types"

export type DanfcePrintBobina = "58mm" | "80mm"

export function previewDanfceInBrowser(model: DanfceModel, bobina: DanfcePrintBobina = "80mm"): void {
  const title = model.homologacaoSemValorFiscal ? "DANFC-e HOMOLOGAÇÃO SEM VALOR FISCAL" : "DANFC-e"
  openThermalHtmlPrint(renderDanfceHtml(model), title, { bobina })
}

export async function printDanfceWithExistingStack(
  model: DanfceModel,
  config: PdvImpressaoConfig,
): Promise<PrintJobResult> {
  const bobina: DanfcePrintBobina = config.bobinaTamanho === "58mm" ? "58mm" : "80mm"
  const maxChars = BOBINA_CHARS[bobina]
  const bytes = renderDanfceEscPos(model, {
    maxChars,
    qrModuleSize: bobina === "58mm" ? 3 : 4,
  })
  return printWithFallback(bytes, {
    config,
    htmlTitle: model.homologacaoSemValorFiscal ? "DANFC-e HOMOLOGAÇÃO SEM VALOR FISCAL" : "DANFC-e",
    filename: `danfce-${model.chaveAcesso}.bin`,
    buildHtmlBody: () => renderDanfceHtml(model),
  })
}
