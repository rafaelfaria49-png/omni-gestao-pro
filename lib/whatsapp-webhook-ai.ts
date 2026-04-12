import { prisma } from "@/lib/prisma"
import { analyzeProductImageFromDataUrl } from "@/lib/vision-product-openai"
import { transcribeAudioBuffer } from "@/lib/transcribe-openai"
import { classifyTranscriptFinanceVsSuporte } from "@/lib/whatsapp-audio-classify"
import {
  clearPending,
  savePending,
  takePending,
  type ExpensePayload,
  type ProductPayload,
} from "@/lib/whatsapp-pending-actions"
import { getOwnerDigitsNormalized, isWhatsAppOwner } from "@/lib/whatsapp-owner"
import { sendWhatsAppText, sendWhatsAppButtons } from "@/lib/whatsapp-send"
import { orchestrateCommand, type PlanoAssinatura } from "@/services/ai-orchestrator"
import { parseVoiceIntent, extractBrlFromUtterance } from "@/lib/voice-intents"
import { sendDailyClosingToPhone } from "@/lib/whatsapp-daily-server"
import type { InboundExtract } from "@/lib/whatsapp-webhook-parse"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"

const MAX_DETAIL = 4000

const BTN_CONFIRM = "ap_confirm"
const BTN_CANCEL = "ap_cancel"

function planoAssinatura(): PlanoAssinatura {
  const p = process.env.ASSISTEC_PLANO_ASSINATURA?.trim().toLowerCase()
  if (p === "bronze" || p === "prata" || p === "ouro") return p
  return "ouro"
}

async function fetchAudioBuffer(url: string): Promise<Buffer> {
  const key = process.env.WHATSAPP_API_KEY
  const res = await fetch(url, {
    headers: key ? { apikey: key } : {},
  })
  if (!res.ok) {
    throw new Error(`Download áudio HTTP ${res.status}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

async function imageToDataUrl(extracted: InboundExtract): Promise<string | null> {
  if (extracted.imageBase64 && extracted.imageMime) {
    return `data:${extracted.imageMime};base64,${extracted.imageBase64}`
  }
  if (extracted.imageUrl) {
    const key = process.env.WHATSAPP_API_KEY
    const res = await fetch(extracted.imageUrl, {
      headers: key ? { apikey: key } : {},
    })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const mime =
      extracted.imageMime?.split(";")[0]?.trim() ||
      res.headers.get("content-type")?.split(";")[0]?.trim() ||
      "image/jpeg"
    return `data:${mime};base64,${buf.toString("base64")}`
  }
  return null
}

async function handleOwnerButton(fromDigits: string, buttonId: string): Promise<void> {
  const id = buttonId.trim().toLowerCase()
  if (id === BTN_CANCEL || id === "cancel" || id.includes("cancelar")) {
    await clearPending(fromDigits)
    await sendWhatsAppText(fromDigits, `${APP_DISPLAY_NAME}: cancelado. Nada foi registrado.`)
    return
  }

  if (id !== BTN_CONFIRM && id !== "confirm" && !id.includes("confirmar")) {
    await sendWhatsAppText(fromDigits, `${APP_DISPLAY_NAME}: opção de botão não reconhecida.`)
    return
  }

  const pending = await takePending(fromDigits)
  if (!pending) {
    await sendWhatsAppText(fromDigits, `${APP_DISPLAY_NAME}: não há confirmação pendente.`)
    return
  }

  if (pending.kind === "expense_confirm") {
    const p = pending.payload as ExpensePayload
    await prisma.logsAuditoria.create({
      data: {
        action: "whatsapp_gasto_confirmado",
        userLabel: `wa:${fromDigits}`,
        detail: `R$ ${p.amountBrl.toFixed(2)} — ${p.description.slice(0, 500)}`,
        metadata: JSON.stringify({ transcript: p.transcript, amountBrl: p.amountBrl }),
        source: "webhook",
      },
    })
    await clearPending(fromDigits)
    await sendWhatsAppText(
      fromDigits,
      `${APP_DISPLAY_NAME}: gasto registrado — R$ ${p.amountBrl.toFixed(2)} (${p.description}).`
    )
    return
  }

  if (pending.kind === "product_confirm") {
    const p = pending.payload as ProductPayload
    await prisma.logsAuditoria.create({
      data: {
        action: "whatsapp_produto_confirmado",
        userLabel: `wa:${fromDigits}`,
        detail: `${p.product.nome} | NCM ${p.product.ncm} | ${p.product.categoria}`,
        metadata: JSON.stringify(p.product),
        source: "webhook",
      },
    })
    await clearPending(fromDigits)
    await sendWhatsAppText(
      fromDigits,
      `${APP_DISPLAY_NAME}: dados do produto confirmados para cadastro manual:\n${p.product.nome}\nNCM ${p.product.ncm}\n${p.product.descricaoVenda}`
    )
  }
}

async function handleOwnerImage(fromDigits: string, extracted: InboundExtract): Promise<void> {
  const dataUrl = await imageToDataUrl(extracted)
  if (!dataUrl) {
    await sendWhatsAppText(
      fromDigits,
      `${APP_DISPLAY_NAME}: não consegui baixar a imagem. Tente enviar de novo ou use foto menor.`
    )
    return
  }

  let product
  try {
    product = await analyzeProductImageFromDataUrl(dataUrl)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro na análise"
    await prisma.logsAuditoria.create({
      data: {
        action: "whatsapp_vision_erro",
        userLabel: `wa:${fromDigits}`,
        detail: msg.slice(0, MAX_DETAIL),
        source: "webhook",
      },
    })
    await sendWhatsAppText(fromDigits, `${APP_DISPLAY_NAME}: falha na IA de visão — ${msg.slice(0, 200)}`)
    return
  }

  await savePending(fromDigits, "product_confirm", { product })
  const desc = [
    `Nome: ${product.nome}`,
    `Categoria: ${product.categoria}`,
    `NCM: ${product.ncm}`,
    product.descricaoVenda.slice(0, 400),
  ].join("\n")

  const sent = await sendWhatsAppButtons(fromDigits, {
    title: "Cadastro sugerido",
    description: desc,
    footer: APP_DISPLAY_NAME,
    buttons: [
      { id: BTN_CONFIRM, displayText: "Confirmar cadastro" },
      { id: BTN_CANCEL, displayText: "Cancelar" },
    ],
  })

  if (!sent.ok) {
    await clearPending(fromDigits)
    await sendWhatsAppText(
      fromDigits,
      `${APP_DISPLAY_NAME} (sem botões na API): ${desc}\n\nConfirme cadastro no sistema. Erro botões: ${sent.error}`
    )
  }
}

async function handleOwnerAudio(fromDigits: string, extracted: InboundExtract): Promise<void> {
  let buf: Buffer
  let mime = extracted.audioMime ?? "audio/ogg"
  let filename = "audio.ogg"
  if (extracted.audioUrl) {
    buf = await fetchAudioBuffer(extracted.audioUrl)
    if (mime.includes("mpeg")) filename = "audio.mp3"
  } else if (extracted.audioBase64) {
    buf = Buffer.from(extracted.audioBase64, "base64")
    if (mime.includes("mpeg")) filename = "audio.mp3"
  } else {
    buf = Buffer.alloc(0)
  }
  if (buf.length === 0) {
    await sendWhatsAppText(fromDigits, `${APP_DISPLAY_NAME}: áudio vazio ou não suportado.`)
    return
  }

  const transcript = await transcribeAudioBuffer(buf, filename, mime)
  if (!transcript.trim()) {
    await sendWhatsAppText(fromDigits, `${APP_DISPLAY_NAME}: transcrição vazia.`)
    return
  }

  await prisma.logsAuditoria.create({
    data: {
      action: "whatsapp_audio_transcrito",
      userLabel: `wa:${fromDigits}`,
      detail: transcript.slice(0, MAX_DETAIL),
      source: "webhook",
    },
  })

  const kind = classifyTranscriptFinanceVsSuporte(transcript)
  if (kind === "gasto_financeiro") {
    const amount = extractBrlFromUtterance(transcript)
    const description = transcript.replace(/\s+/g, " ").trim().slice(0, 500)
    if (amount == null || amount <= 0) {
      await sendWhatsAppText(
        fromDigits,
        `${APP_DISPLAY_NAME}: entendi um gasto, mas não achei valor. Diga de novo com valor (ex: "gastei 20 reais de almoço").\nTranscrição: ${transcript.slice(0, 300)}`
      )
      return
    }

    await savePending(fromDigits, "expense_confirm", {
      amountBrl: amount,
      description: description || "Gasto (WhatsApp)",
      transcript,
    })

    const sent = await sendWhatsAppButtons(fromDigits, {
      title: "Confirmar gasto",
      description: `Registrar despesa de R$ ${amount.toFixed(2)}?\n${description}`,
      footer: APP_DISPLAY_NAME,
      buttons: [
        { id: BTN_CONFIRM, displayText: `Confirmar R$ ${amount.toFixed(0)}` },
        { id: BTN_CANCEL, displayText: "Cancelar" },
      ],
    })

    if (!sent.ok) {
      await clearPending(fromDigits)
      await sendWhatsAppText(
        fromDigits,
        `Confirmar gasto R$ ${amount.toFixed(2)}? Responda SIM ou NÃO. (Botões indisponíveis: ${sent.error})`
      )
    }
    return
  }

  const result = orchestrateCommand(transcript, planoAssinatura())
  await sendWhatsAppText(fromDigits, `${APP_DISPLAY_NAME} — ${result.message}`)
}

async function handleOwnerText(fromDigits: string, utterance: string): Promise<void> {
  const voice = parseVoiceIntent(utterance)
  if (voice?.kind === "fechar_dia") {
    const nome = process.env.ASSISTEC_EMPRESA_NOME?.trim() || APP_DISPLAY_NAME
    const dono = process.env.ASSISTEC_WHATSAPP_DONO?.replace(/\D/g, "") ?? fromDigits
    const send = await sendDailyClosingToPhone({ phoneDigits: dono, empresaNome: nome })
    const extra = send.ok
      ? " Resumo enviado."
      : ` Aviso: ${"error" in send ? send.error : ""}`
    await sendWhatsAppText(fromDigits, `${APP_DISPLAY_NAME} — fechamento do dia.${extra}`)
    await prisma.logsAuditoria.create({
      data: {
        action: "whatsapp_comando",
        userLabel: `wa:${fromDigits}`,
        detail: `fechar_dia | envio: ${send.ok ? "ok" : "falha"}`,
        source: "webhook",
      },
    })
    return
  }

  const result = orchestrateCommand(utterance, planoAssinatura())
  await sendWhatsAppText(fromDigits, `${APP_DISPLAY_NAME} — ${result.message}`)
  await prisma.logsAuditoria.create({
    data: {
      action: "whatsapp_orquestrador",
      userLabel: `wa:${fromDigits}`,
      detail: utterance.slice(0, MAX_DETAIL),
      metadata: JSON.stringify(result),
      source: "webhook",
    },
  })
}

/**
 * Processa mensagem já extraída (somente após verificar webhook secret na rota).
 */
export async function processOwnerWhatsAppAI(extracted: InboundExtract): Promise<void> {
  const from = extracted.fromDigits

  if (!getOwnerDigitsNormalized()) {
    return
  }

  if (!isWhatsAppOwner(from)) {
    await sendWhatsAppText(
      from,
      `${APP_DISPLAY_NAME}: comandos de IA, financeiro e cadastro por aqui são exclusivos do proprietário. Para atendimento da loja, use o canal habitual.`
    )
    return
  }

  if (extracted.buttonId) {
    await handleOwnerButton(from, extracted.buttonId)
    return
  }

  if (extracted.imageUrl || extracted.imageBase64) {
    await handleOwnerImage(from, extracted)
    return
  }

  if (extracted.audioUrl || extracted.audioBase64) {
    await handleOwnerAudio(from, extracted)
    return
  }

  const text = extracted.text?.trim() ?? ""
  if (text) {
    await handleOwnerText(from, text)
    return
  }

  await sendWhatsAppText(from, `${APP_DISPLAY_NAME}: envie texto, áudio ou imagem.`)
}
