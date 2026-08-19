/** Erros tipados da agenda (GOAL 016) — mapeados a HTTP em `./http.ts`. */

export class AgendaValidacaoError extends Error {
  readonly code = "AGENDA_VALIDACAO" as const
  constructor(
    readonly campo: string,
    message: string,
  ) {
    super(message)
    this.name = "AgendaValidacaoError"
  }
}

export class TemplateNaoEncontradoError extends Error {
  readonly code = "TEMPLATE_NAO_ENCONTRADO" as const
  constructor() {
    super("Template não encontrado nesta unidade.")
    this.name = "TemplateNaoEncontradoError"
  }
}

export class TemplateInativoError extends Error {
  readonly code = "TEMPLATE_INATIVO" as const
  constructor() {
    super("Este template está inativo e não gera obrigação.")
    this.name = "TemplateInativoError"
  }
}

export class ObrigacaoNaoEncontradaError extends Error {
  readonly code = "OBRIGACAO_NAO_ENCONTRADA" as const
  constructor() {
    super("Obrigação não encontrada nesta unidade.")
    this.name = "ObrigacaoNaoEncontradaError"
  }
}

export class GuiaNaoEncontradaError extends Error {
  readonly code = "GUIA_NAO_ENCONTRADA" as const
  constructor() {
    super("Guia não encontrada nesta unidade.")
    this.name = "GuiaNaoEncontradaError"
  }
}

export class GuiaPagaError extends Error {
  readonly code = "GUIA_PAGA" as const
  constructor() {
    super("Esta guia já foi marcada como paga e não aceita alteração.")
    this.name = "GuiaPagaError"
  }
}

export class DocumentoAgendaInvalidoError extends Error {
  readonly code = "DOCUMENTO_AGENDA_INVALIDO" as const
  constructor(message: string) {
    super(message)
    this.name = "DocumentoAgendaInvalidoError"
  }
}
