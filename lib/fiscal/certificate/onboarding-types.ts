/**
 * Tipos do onboarding fiscal orientado por certificado A1 (GOAL-016B).
 *
 * Módulo PURO e sem I/O — pode ser importado com `import type` pelo cliente sem arrastar
 * `node-forge`/`node:crypto` para o bundle (mesmo cuidado já adotado em `certificado-alerta`).
 *
 * Princípio central: TODO campo da identidade fiscal carrega a sua ORIGEM. O que veio do
 * certificado é dito como vindo do certificado; o que veio da loja é dito como herdado da loja;
 * o que ninguém confirmou fica `pendente`. Endereço, IE, CRT e CSC NUNCA são atribuídos ao
 * certificado — um A1 ICP-Brasil não carrega esses dados.
 */

/** De onde saiu o valor exibido/proposto para um campo da identidade fiscal. */
export type OrigemCampo =
  /** Extraído do certificado A1 (titular/CNPJ/e-mail do próprio X.509). */
  | "certificado"
  /** Encontrado na fonte cadastral externa (provider de enriquecimento). */
  | "fonte_cadastral"
  /** Herdado do cadastro já existente da loja (`Store` / `ConfiguracaoFiscalLoja`). */
  | "loja"
  /** Informado manualmente pelo usuário nesta confirmação. */
  | "manual"
  /** Fontes conflitantes — exige decisão humana antes de gravar. */
  | "divergente"
  /** Ninguém forneceu o valor — segue pendente. */
  | "pendente"

/** Confiança da origem — usada para ordenar precedência e sinalizar na UI. */
export type ConfiancaCampo = "alta" | "media" | "baixa"

/** Campos da identidade fiscal cobertos pelo onboarding. */
export type CampoIdentidadeFiscal =
  | "razaoSocial"
  | "nomeFantasia"
  | "cnpj"
  | "inscricaoEstadual"
  | "inscricaoMunicipal"
  | "cnae"
  | "regimeTributario"
  | "logradouro"
  | "numero"
  | "complemento"
  | "bairro"
  | "codigoMunicipioIbge"
  | "municipio"
  | "uf"
  | "cep"
  | "fone"
  | "email"

/** Um campo da prévia de confirmação, com procedência explícita. */
export type CampoOnboarding = {
  campo: CampoIdentidadeFiscal
  /** Rótulo legível (pt-BR) para a tela de confirmação. */
  rotulo: string
  valor: string
  origem: OrigemCampo
  /** Fonte concreta ("Certificado A1", "Cadastro da loja", …). Vazio quando pendente. */
  fonte: string
  /** ISO-8601 de quando o valor foi obtido na fonte. `null` quando a fonte não informa. */
  obtidoEm: string | null
  confianca: ConfiancaCampo
  /** Valor conflitante da outra fonte, quando `origem === "divergente"`. */
  valorAlternativo?: string
  /** Fonte do valor conflitante, quando `origem === "divergente"`. */
  fonteAlternativa?: string
  /** `true` quando o usuário precisa confirmar/preencher o campo antes de gravar. */
  requerConfirmacao: boolean
}

/** Motivos que impedem a confirmação (fail-closed — a gravação não acontece). */
export type OnboardingBloqueioCodigo =
  | "arquivo_ausente"
  | "arquivo_muito_grande"
  | "tipo_arquivo_invalido"
  | "senha_ausente"
  | "senha_incorreta"
  | "arquivo_invalido"
  | "certificado_sem_chave"
  | "certificado_sem_titular"
  | "chave_fraca"
  | "certificado_vencido"
  | "certificado_ainda_nao_valido"
  | "cadeia_invalida"
  | "cnpj_certificado_ausente"
  | "cnpj_divergente"
  | "certificado_de_outra_loja"
  | "erro_inesperado"

export type OnboardingBloqueio = {
  codigo: OnboardingBloqueioCodigo
  mensagem: string
}

/** Dados efetivamente presentes num A1 ICP-Brasil. Nada aqui é inferido de outra fonte. */
export type CertificadoExtraido = {
  /** CNPJ do titular (14 dígitos) quando identificável no X.509; senão `null`. */
  cnpj: string | null
  /** CN completo do titular (padrão ICP `RAZAO:CNPJ`). */
  titularCn: string
  /** Subject completo, em uma linha. */
  subject: string
  /** Nome empresarial do titular (CN sem o sufixo `:CNPJ`). Não é "nome fantasia". */
  nomeEmpresarial: string
  /** E-mail do titular quando presente no certificado; senão `null`. */
  email: string | null
  /** Início da validade (ISO-8601). */
  validoDe: string | null
  /** Fim da validade (ISO-8601). */
  validoAte: string | null
  /** Autoridade certificadora emissora (CN do issuer). */
  autoridadeCertificadora: string
  serialNumber: string
  /** Fingerprint SHA-1 (hex minúsculo, sem `:`) — identidade estável para auditoria. */
  fingerprintSha1: string
  /** Cadeia presente no container PKCS#12. */
  cadeiaDisponivel: boolean
  /** Certificado dentro da janela de validade no instante da leitura. */
  vigente: boolean
  chavePublicaRsaBits: number
}

/** Estado da consulta cadastral externa. */
export type LookupStatus =
  /** Nenhuma fonte automatizada aprovada está configurada no projeto. */
  | "nao_configurado"
  | "ok"
  | "nao_encontrado"
  | "indisponivel"

export type LookupResumo = {
  status: LookupStatus
  /** Rótulo da fonte quando configurada; vazio caso contrário. */
  fonte: string
  consultadoEm: string | null
  mensagem: string
}

/** Resultado da reconciliação do certificado com a unidade selecionada. */
export type ReconciliacaoLoja = {
  /** CNPJ extraído do certificado (dígitos) ou `null`. */
  cnpjCertificado: string | null
  /** CNPJ da `ConfiguracaoFiscalLoja` (dígitos) ou `null`. */
  cnpjLojaFiscal: string | null
  /** CNPJ do cadastro da `Store` (dígitos) ou `null`. */
  cnpjStore: string | null
  /** `true` quando o CNPJ do certificado bate com o CNPJ conhecido da loja. */
  confere: boolean
  /** Certificado com a mesma fingerprint já registrado NESTA unidade (confirmação é idempotente). */
  jaRegistradoNestaLoja: boolean
  /** Já existe certificado ativo com fingerprint diferente — a ativação futura o substituirá. */
  substituiraCertificadoAtivo: boolean
  /** Fingerprint idêntica vinculada a OUTRA unidade — bloqueia (checagem booleana, sem expor dados). */
  vinculadoAOutraLoja: boolean
}

/** Custódia do segredo — o `.pfx`/senha NUNCA são persistidos por este fluxo. */
export type CustodiaSegredo = {
  /** `true` enquanto o material do certificado não estiver provisionado no cofre. */
  pendente: boolean
  /** Nome canônico da referência do `.pfx` esperada pelo cofre desta loja. */
  blobRefEsperada: string
  /** Nome canônico da referência da senha esperada pelo cofre desta loja. */
  senhaRefEsperada: string
  mensagem: string
}

/** Prévia de confirmação devolvida pela leitura do certificado. Não persiste nada. */
export type OnboardingPreview = {
  /** `true` quando não há bloqueio — a confirmação pode ser submetida. */
  podeConfirmar: boolean
  storeId: string
  certificado: CertificadoExtraido | null
  reconciliacao: ReconciliacaoLoja
  campos: CampoOnboarding[]
  bloqueios: OnboardingBloqueio[]
  /** Campos que seguem sem valor confirmado. */
  pendencias: CampoIdentidadeFiscal[]
  lookup: LookupResumo
  custodia: CustodiaSegredo
  /** Reflexo do estado real da loja — este fluxo nunca liga a emissão. */
  fiscalEnabledAtual: boolean
  /** Declaração explícita: este fluxo não transmite nada à SEFAZ. */
  transmissao: "nenhuma"
}
