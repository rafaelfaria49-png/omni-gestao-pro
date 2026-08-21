/**
 * Cópia do link de convite com fallback honesto de seleção.
 *
 * `navigator.clipboard.writeText` falha em contextos legítimos (permissão negada,
 * documento sem foco, política de embedding). Quando falha, a UI NÃO pode se limitar
 * a pedir "selecione manualmente": o link é longo e vive num campo estreito, então
 * Ctrl+A pega a página inteira e o token nunca chega ao usuário. Aqui o fallback
 * SELECIONA o campo de fato, deixando o Ctrl+C funcional.
 *
 * Puro de propósito: as duas capacidades do navegador entram por injeção, o que
 * mantém a decisão testável sem DOM (o harness deste repo é `environment: "node"`).
 */

/** O que efetivamente aconteceu — cada caso tem uma mensagem própria na UI. */
export type ResultadoCopiaLink =
  /** Foi para a área de transferência; nada mais é preciso. */
  | { readonly modo: "clipboard" }
  /** Clipboard indisponível, mas o campo ficou selecionado: Ctrl+C resolve. */
  | { readonly modo: "selecao" }
  /** Nem copiar nem selecionar — só resta o usuário selecionar à mão. */
  | { readonly modo: "indisponivel" }

/** Fallback bem-sucedido: o texto já está selecionado, falta só o atalho. */
export const MENSAGEM_SELECAO = "Link selecionado. Pressione Ctrl+C para copiar."

/** Último recurso: nem a seleção programática funcionou. */
export const MENSAGEM_SEM_SELECAO =
  "Não foi possível copiar nem selecionar automaticamente. Selecione o link no campo e pressione Ctrl+C."

export type CopiarLinkConviteArgs = Readonly<{
  /** URL completa do convite. Vazia ⇒ não há o que copiar. */
  url: string
  /** `navigator.clipboard.writeText` ligado ao seu objeto, ou `null` se ausente. */
  escreverClipboard?: ((texto: string) => Promise<void>) | null
  /** Seleciona o campo do link. Devolve `false` quando não conseguiu. */
  selecionarCampo?: (() => boolean) | null
}>

/**
 * Tenta clipboard e, em qualquer falha, cai para a seleção do campo.
 *
 * Nunca lança: a UI decide a mensagem pelo `modo`. O clipboard é tentado primeiro
 * porque é o caminho sem atrito; a seleção é o degrau seguinte, não um aviso vazio.
 */
export async function copiarLinkConvite({
  url,
  escreverClipboard,
  selecionarCampo,
}: CopiarLinkConviteArgs): Promise<ResultadoCopiaLink> {
  if (url === "") return { modo: "indisponivel" }

  if (typeof escreverClipboard === "function") {
    try {
      await escreverClipboard(url)
      return { modo: "clipboard" }
    } catch {
      // Segue para o fallback — a falha do clipboard é esperada, não excepcional.
    }
  }

  if (typeof selecionarCampo === "function") {
    try {
      if (selecionarCampo()) return { modo: "selecao" }
    } catch {
      // Idem: seleção pode falhar se o nó saiu da árvore entre o clique e aqui.
    }
  }

  return { modo: "indisponivel" }
}

/** Mensagem de fallback correspondente ao resultado — `null` quando copiou. */
export function mensagemDeCopia(resultado: ResultadoCopiaLink): string | null {
  switch (resultado.modo) {
    case "clipboard":
      return null
    case "selecao":
      return MENSAGEM_SELECAO
    case "indisponivel":
      return MENSAGEM_SEM_SELECAO
  }
}
