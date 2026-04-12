/**
 * Web Speech API (Chrome/Edge) — diagnóstico e mensagens amigáveis.
 * `http://localhost` e `https://localhost` são contextos seguros para mídia no Chrome.
 */

export type SpeechRecognitionErrorCode =
  | "not-allowed"
  | "audio-capture"
  | "network"
  | "service-not-allowed"
  | "bad-grammar"
  | "language-not-supported"
  | "aborted"
  | "no-speech"
  | string

export interface SpeechRecognitionErrorEventLike extends Event {
  error?: SpeechRecognitionErrorCode
  message?: string
}

/** Lista de resultados do Web Speech API (Chrome/Edge). */
export type SpeechRecognitionResultListLike = {
  length: number
  [i: number]: { length: number; isFinal: boolean; [j: number]: { transcript: string } }
}

/** Evento `onresult` — usar `resultIndex`..`length` (não só `results[0]`). */
export interface SpeechRecognitionEventLike extends Event {
  resultIndex: number
  results: SpeechRecognitionResultListLike
}

/** Instância usada pelo Chrome/Edge (webkit) — compatível com dispose e start/stop. */
export type SpeechRecognitionInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives?: number
  onresult: ((e: Event) => void) | null
  onerror: ((ev: Event) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

export function getSpeechRecognitionConstructor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstance
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Registra o erro exato do motor de voz (DevTools → Console). */
export function logSpeechRecognitionError(context: string, ev: Event): void {
  const e = ev as SpeechRecognitionErrorEventLike
  const raw = e as unknown as { error?: string; message?: string }
  console.error(`[OmniGestão Voice] ${context}`, {
    error: raw?.error,
    message: raw?.message,
    type: ev.type,
    isSecureContext: typeof window !== "undefined" ? window.isSecureContext : undefined,
    hostname: typeof window !== "undefined" ? window.location.hostname : undefined,
    protocol: typeof window !== "undefined" ? window.location.protocol : undefined,
  })
}

/** Uma vez por fluxo (opcional): confirma que localhost não bloqueia por segurança. */
export function logVoiceEnvironmentOnce(): void {
  if (typeof window === "undefined") return
  const w = window as unknown as { __omniVoiceEnvLogged?: boolean }
  if (w.__omniVoiceEnvLogged) return
  w.__omniVoiceEnvLogged = true
  console.info("[OmniGestão Voice] ambiente de captura", {
    isSecureContext: window.isSecureContext,
    hostname: window.location.hostname,
    protocol: window.location.protocol,
  })
}

/**
 * Mantido por compatibilidade: não bloqueamos mais por `isSecureContext` (localhost já é seguro;
 * fora disso, o próprio navegador / Permissions-Policy tratam o erro).
 */
export function isLocalhostLikeHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  )
}

/** Sempre `null` — não bloquear UI por verificação de contexto seguro. */
export function getVoiceCaptureBlockReason(): string | null {
  return null
}

export function isBenignSpeechError(code: string | undefined): boolean {
  return code === "aborted" || code === "no-speech"
}

export function humanizeSpeechError(code: string | undefined): string {
  if (!code) return "Erro desconhecido no reconhecimento de voz."
  const map: Record<string, string> = {
    "not-allowed":
      "Permissão do microfone negada ou bloqueada pelo site/navegador. Verifique o cadeado → Microfone: Permitir; se abrir por IP da rede, use HTTPS local ou localhost. O servidor não pode ‘forçar’ SSL via JavaScript.",
    "audio-capture": "Não foi possível acessar o microfone (ocupado ou indisponível).",
    network: "Falha de rede no serviço de reconhecimento. Verifique a internet e tente de novo.",
    "service-not-allowed": "Reconhecimento de voz bloqueado neste site (política do navegador).",
    "bad-grammar": "Erro interno do reconhecimento de voz.",
    "language-not-supported": "Idioma não suportado pelo serviço de voz.",
    aborted: "Captura cancelada.",
    "no-speech": "Nenhuma fala detectada.",
  }
  return map[code] ?? `Erro de voz: ${code}`
}

/** Encerra uma instância de SpeechRecognition e limpa handlers (evita estado inválido). */
export function disposeSpeechRecognition(rec: SpeechRecognitionInstance | null | undefined): void {
  if (!rec) return
  try {
    rec.onresult = null
    rec.onerror = null
    rec.onend = null
  } catch {
    /* ignore */
  }
  try {
    rec.abort()
  } catch {
    try {
      rec.stop()
    } catch {
      /* ignore */
    }
  }
}
