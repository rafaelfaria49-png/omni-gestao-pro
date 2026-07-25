/**
 * Reconciliação do certificado A1 com a loja + procedência por campo (GOAL-016B · itens 3 e 5).
 *
 * Módulo PURO (sem I/O, sem Prisma, sem rede): recebe a extração do certificado, o cadastro
 * conhecido da loja, o resultado da consulta cadastral e o que o usuário digitou, e devolve a
 * PRÉVIA de confirmação — cada campo com valor, origem, fonte, data e confiança.
 *
 * Regras inegociáveis:
 *  - O certificado só é fonte de: CNPJ, nome empresarial (CN) e e-mail do titular.
 *    Endereço, IE, IM, CNAE e regime/CRT **nunca** são atribuídos ao certificado.
 *  - `nomeFantasia` é o NOME COMERCIAL INTERNO, informado pelo usuário. Nunca sobrescreve
 *    `razaoSocial` e nunca é preenchido a partir do certificado.
 *  - Fail-closed: CNPJ divergente, certificado vencido/fora de janela, cadeia inválida ou
 *    certificado vinculado a outra unidade ⇒ `podeConfirmar = false`.
 *  - Nada aqui liga `fiscalEnabled`, altera provider, cria CSC ou transmite qualquer coisa.
 */
import { canonicalEnvRef } from "@/lib/fiscal/vault/fiscal-secret-vault"
import { onlyDigits } from "@/lib/fiscal/fiscal-validators"
import { bloqueio } from "./certificate-inspection"
import type { FiscalIdentityLookupResultado, FiscalLookupCampo } from "./lookup-provider"
import type {
  CampoIdentidadeFiscal,
  CampoOnboarding,
  CertificadoExtraido,
  ConfiancaCampo,
  CustodiaSegredo,
  LookupResumo,
  OnboardingBloqueio,
  OnboardingPreview,
  OrigemCampo,
  ReconciliacaoLoja,
} from "./onboarding-types"

/** Rótulos pt-BR dos campos exibidos na confirmação. */
export const ROTULOS_CAMPO: Record<CampoIdentidadeFiscal, string> = {
  razaoSocial: "Razão social",
  nomeFantasia: "Nome comercial interno",
  cnpj: "CNPJ",
  inscricaoEstadual: "Inscrição estadual (IE)",
  inscricaoMunicipal: "Inscrição municipal (IM)",
  cnae: "CNAE principal",
  regimeTributario: "Regime tributário",
  logradouro: "Logradouro",
  numero: "Número",
  complemento: "Complemento",
  bairro: "Bairro",
  codigoMunicipioIbge: "Código IBGE do município",
  municipio: "Município",
  uf: "UF",
  cep: "CEP",
  fone: "Telefone",
  email: "E-mail fiscal",
}

/** Ordem estável de exibição na tela de confirmação. */
export const ORDEM_CAMPOS: CampoIdentidadeFiscal[] = [
  "cnpj",
  "razaoSocial",
  "nomeFantasia",
  "inscricaoEstadual",
  "inscricaoMunicipal",
  "cnae",
  "regimeTributario",
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "municipio",
  "codigoMunicipioIbge",
  "uf",
  "cep",
  "fone",
  "email",
]

/** Campos que dependem de dígitos — comparados sem máscara. */
const CAMPOS_NUMERICOS = new Set<CampoIdentidadeFiscal>(["cnpj", "cep", "codigoMunicipioIbge", "cnae"])

/** Snapshot da `ConfiguracaoFiscalLoja` relevante ao onboarding (somente leitura). */
export type FiscalLojaSnapshot = {
  fiscalEnabled: boolean
  razaoSocial: string
  nomeFantasia: string
  cnpj: string
  inscricaoEstadual: string
  inscricaoMunicipal: string
  cnae: string
  regimeTributario: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  codigoMunicipioIbge: string
  municipio: string
  uf: string
  cep: string
  fone: string
  email: string
}

/** Snapshot do cadastro operacional da loja (`Store`) usado como pré-preenchimento. */
export type StoreSnapshot = {
  nome: string
  cnpj: string
  telefone: string
  endereco: {
    rua: string
    numero: string
    bairro: string
    cidade: string
    estado: string
    cep: string
  }
}

/** Sinais sobre certificados já registrados — apurados pela camada com Prisma, escopados por loja. */
export type CertificadosContexto = {
  /** Mesma fingerprint já registrada NESTA unidade. */
  fingerprintJaRegistradaNestaLoja: boolean
  /** Existe certificado ativo nesta unidade com fingerprint diferente. */
  possuiAtivoComOutraFingerprint: boolean
  /** Mesma fingerprint vinculada a OUTRA unidade (checagem booleana de integridade). */
  fingerprintVinculadaAOutraLoja: boolean
}

export type ReconciliarParams = {
  storeId: string
  extraido: CertificadoExtraido | null
  /** Bloqueios já apurados na inspeção do arquivo. */
  bloqueiosInspecao: OnboardingBloqueio[]
  fiscalLoja: FiscalLojaSnapshot | null
  store: StoreSnapshot | null
  lookup: FiscalIdentityLookupResultado
  certificados: CertificadosContexto
  /** Valores digitados pelo usuário nesta confirmação. */
  manual?: Partial<Record<CampoIdentidadeFiscal, string>>
}

type Candidato = {
  valor: string
  origem: Exclude<OrigemCampo, "divergente" | "pendente">
  fonte: string
  obtidoEm: string | null
  confianca: ConfiancaCampo
}

function txt(v: unknown): string {
  return String(v ?? "").trim()
}

/** Normaliza para comparação de divergência (dígitos em campos numéricos; caixa/espaços nos demais). */
function normalizar(campo: CampoIdentidadeFiscal, valor: string): string {
  if (CAMPOS_NUMERICOS.has(campo)) return onlyDigits(valor)
  return txt(valor).toUpperCase().replace(/\s+/g, " ")
}

/**
 * Resolve um campo a partir dos candidatos em ordem de precedência. O primeiro candidato não
 * vazio vence; se outro candidato não vazio discordar dele, o campo é marcado `divergente` e
 * exige decisão humana.
 */
function resolverCampo(campo: CampoIdentidadeFiscal, candidatos: Candidato[]): CampoOnboarding {
  const validos = candidatos.filter((c) => txt(c.valor) !== "")
  const base = {
    campo,
    rotulo: ROTULOS_CAMPO[campo],
  }

  if (validos.length === 0) {
    return {
      ...base,
      valor: "",
      origem: "pendente",
      fonte: "",
      obtidoEm: null,
      confianca: "baixa",
      requerConfirmacao: true,
    }
  }

  const principal = validos[0]!

  // O usuário acabou de decidir: valor manual vence sem alarde de divergência.
  if (principal.origem === "manual") {
    return {
      ...base,
      valor: txt(principal.valor),
      origem: "manual",
      fonte: principal.fonte,
      obtidoEm: principal.obtidoEm,
      confianca: principal.confianca,
      requerConfirmacao: false,
    }
  }

  const conflitante = validos
    .slice(1)
    .find((c) => normalizar(campo, c.valor) !== normalizar(campo, principal.valor))

  if (conflitante) {
    return {
      ...base,
      valor: txt(principal.valor),
      origem: "divergente",
      fonte: principal.fonte,
      obtidoEm: principal.obtidoEm,
      confianca: principal.confianca,
      valorAlternativo: txt(conflitante.valor),
      fonteAlternativa: conflitante.fonte,
      requerConfirmacao: true,
    }
  }

  return {
    ...base,
    valor: txt(principal.valor),
    origem: principal.origem,
    fonte: principal.fonte,
    obtidoEm: principal.obtidoEm,
    confianca: principal.confianca,
    requerConfirmacao: principal.confianca === "baixa",
  }
}

/** Candidato vindo da fonte cadastral externa, quando ela devolveu o campo. */
function daFonteCadastral(
  lookup: FiscalIdentityLookupResultado,
  campo: FiscalLookupCampo,
): Candidato | null {
  if (lookup.status !== "ok") return null
  const v = lookup.campos[campo]
  if (!v || txt(v.valor) === "") return null
  return {
    valor: v.valor,
    origem: "fonte_cadastral",
    fonte: v.fonte,
    obtidoEm: v.obtidoEm,
    confianca: v.confianca,
  }
}

function daLoja(valor: string | undefined, fonte: string, confianca: ConfiancaCampo = "media"): Candidato | null {
  if (txt(valor) === "") return null
  return { valor: txt(valor), origem: "loja", fonte, obtidoEm: null, confianca }
}

function doManual(valor: string | undefined): Candidato | null {
  if (txt(valor) === "") return null
  return { valor: txt(valor), origem: "manual", fonte: "Informado nesta confirmação", obtidoEm: null, confianca: "alta" }
}

function doCertificado(valor: string | null | undefined, obtidoEm: string | null): Candidato | null {
  if (txt(valor) === "") return null
  return {
    valor: txt(valor),
    origem: "certificado",
    fonte: "Certificado A1",
    obtidoEm,
    confianca: "alta",
  }
}

function resumoLookup(lookup: FiscalIdentityLookupResultado): LookupResumo {
  switch (lookup.status) {
    case "ok":
      return { status: "ok", fonte: lookup.fonte, consultadoEm: lookup.consultadoEm, mensagem: "" }
    case "nao_encontrado":
      return { status: "nao_encontrado", fonte: lookup.fonte, consultadoEm: lookup.consultadoEm, mensagem: lookup.mensagem }
    case "indisponivel":
      return { status: "indisponivel", fonte: lookup.fonte, consultadoEm: null, mensagem: lookup.mensagem }
    default:
      return { status: "nao_configurado", fonte: "", consultadoEm: null, mensagem: lookup.mensagem }
  }
}

function custodiaPendente(storeId: string): CustodiaSegredo {
  return {
    pendente: true,
    blobRefEsperada: canonicalEnvRef("pfx", storeId),
    senhaRefEsperada: canonicalEnvRef("senha", storeId),
    mensagem:
      "O arquivo e a senha do certificado não são gravados por este fluxo. Para ativar o certificado, " +
      "provisione o material no cofre nas referências indicadas e use a validação/ativação do certificado.",
  }
}

/**
 * Reconcilia a extração do certificado com o cadastro da loja e monta a prévia de confirmação.
 * Não persiste, não consulta rede e não transmite nada.
 */
export function reconciliarOnboarding(params: ReconciliarParams): OnboardingPreview {
  const { storeId, extraido, fiscalLoja, store, lookup, certificados } = params
  const manual = params.manual ?? {}
  const validadeDe = extraido?.validoDe ?? null

  const cnpjCertificado = extraido?.cnpj ? onlyDigits(extraido.cnpj) : null
  const cnpjLojaFiscal = onlyDigits(fiscalLoja?.cnpj) || null
  const cnpjStore = onlyDigits(store?.cnpj) || null
  /** CNPJ conhecido da loja: a identidade fiscal manda; o cadastro operacional é o fallback. */
  const cnpjConhecido = cnpjLojaFiscal ?? cnpjStore
  const confere = Boolean(cnpjCertificado && cnpjConhecido && cnpjCertificado === cnpjConhecido)

  const reconciliacao: ReconciliacaoLoja = {
    cnpjCertificado,
    cnpjLojaFiscal,
    cnpjStore,
    confere,
    jaRegistradoNestaLoja: certificados.fingerprintJaRegistradaNestaLoja,
    substituiraCertificadoAtivo: certificados.possuiAtivoComOutraFingerprint,
    vinculadoAOutraLoja: certificados.fingerprintVinculadaAOutraLoja,
  }

  const bloqueios: OnboardingBloqueio[] = [...params.bloqueiosInspecao]
  if (cnpjCertificado && cnpjConhecido && cnpjCertificado !== cnpjConhecido) {
    bloqueios.push(bloqueio("cnpj_divergente"))
  }
  if (certificados.fingerprintVinculadaAOutraLoja) {
    bloqueios.push(bloqueio("certificado_de_outra_loja"))
  }

  const campos: CampoOnboarding[] = ORDEM_CAMPOS.map((campo) => {
    switch (campo) {
      // ── Do certificado (o A1 realmente carrega) ────────────────────────────────────────────
      case "cnpj":
        return resolverCampo(campo, [
          doCertificado(cnpjCertificado, validadeDe),
          daLoja(cnpjLojaFiscal ?? undefined, "Identidade fiscal da loja"),
          daLoja(cnpjStore ?? undefined, "Cadastro da loja"),
          doManual(manual.cnpj),
        ].filter(Boolean) as Candidato[])

      // `Store.name` é apelido operacional da unidade — nunca entra como razão social.
      case "razaoSocial":
        return resolverCampo(campo, [
          doManual(manual.razaoSocial),
          doCertificado(extraido?.nomeEmpresarial, validadeDe),
          daFonteCadastral(lookup, "razaoSocial"),
          daLoja(fiscalLoja?.razaoSocial, "Identidade fiscal da loja"),
        ].filter(Boolean) as Candidato[])

      // ── Nome COMERCIAL INTERNO: só manual ou o que a loja já tinha. Nunca do certificado. ──
      case "nomeFantasia":
        return resolverCampo(campo, [
          doManual(manual.nomeFantasia),
          daLoja(fiscalLoja?.nomeFantasia, "Identidade fiscal da loja"),
          daLoja(store?.nome, "Cadastro da loja", "baixa"),
        ].filter(Boolean) as Candidato[])

      case "email":
        return resolverCampo(campo, [
          doManual(manual.email),
          doCertificado(extraido?.email, validadeDe),
          daFonteCadastral(lookup, "email"),
          daLoja(fiscalLoja?.email, "Identidade fiscal da loja"),
        ].filter(Boolean) as Candidato[])

      case "fone":
        return resolverCampo(campo, [
          doManual(manual.fone),
          daFonteCadastral(lookup, "fone"),
          daLoja(fiscalLoja?.fone, "Identidade fiscal da loja"),
          daLoja(store?.telefone, "Cadastro da loja", "baixa"),
        ].filter(Boolean) as Candidato[])

      // ── Endereço: fonte cadastral > loja > manual. NUNCA do certificado. ───────────────────
      case "logradouro":
        return resolverCampo(campo, [
          doManual(manual.logradouro),
          daFonteCadastral(lookup, "logradouro"),
          daLoja(fiscalLoja?.logradouro, "Identidade fiscal da loja"),
          daLoja(store?.endereco.rua, "Cadastro da loja", "baixa"),
        ].filter(Boolean) as Candidato[])

      case "numero":
        return resolverCampo(campo, [
          doManual(manual.numero),
          daFonteCadastral(lookup, "numero"),
          daLoja(fiscalLoja?.numero, "Identidade fiscal da loja"),
          daLoja(store?.endereco.numero, "Cadastro da loja", "baixa"),
        ].filter(Boolean) as Candidato[])

      case "complemento":
        return resolverCampo(campo, [
          doManual(manual.complemento),
          daFonteCadastral(lookup, "complemento"),
          daLoja(fiscalLoja?.complemento, "Identidade fiscal da loja"),
        ].filter(Boolean) as Candidato[])

      case "bairro":
        return resolverCampo(campo, [
          doManual(manual.bairro),
          daFonteCadastral(lookup, "bairro"),
          daLoja(fiscalLoja?.bairro, "Identidade fiscal da loja"),
          daLoja(store?.endereco.bairro, "Cadastro da loja", "baixa"),
        ].filter(Boolean) as Candidato[])

      case "municipio":
        return resolverCampo(campo, [
          doManual(manual.municipio),
          daFonteCadastral(lookup, "municipio"),
          daLoja(fiscalLoja?.municipio, "Identidade fiscal da loja"),
          daLoja(store?.endereco.cidade, "Cadastro da loja", "baixa"),
        ].filter(Boolean) as Candidato[])

      case "codigoMunicipioIbge":
        return resolverCampo(campo, [
          doManual(manual.codigoMunicipioIbge),
          daFonteCadastral(lookup, "codigoMunicipioIbge"),
          daLoja(fiscalLoja?.codigoMunicipioIbge, "Identidade fiscal da loja"),
        ].filter(Boolean) as Candidato[])

      case "uf":
        return resolverCampo(campo, [
          doManual(manual.uf),
          daFonteCadastral(lookup, "uf"),
          daLoja(fiscalLoja?.uf, "Identidade fiscal da loja"),
          daLoja(store?.endereco.estado, "Cadastro da loja", "baixa"),
        ].filter(Boolean) as Candidato[])

      case "cep":
        return resolverCampo(campo, [
          doManual(manual.cep),
          daFonteCadastral(lookup, "cep"),
          daLoja(fiscalLoja?.cep, "Identidade fiscal da loja"),
          daLoja(store?.endereco.cep, "Cadastro da loja", "baixa"),
        ].filter(Boolean) as Candidato[])

      // ── Dados que só valem se a FONTE confirmar (nunca do certificado) ────────────────────
      case "inscricaoEstadual":
        return resolverCampo(campo, [
          doManual(manual.inscricaoEstadual),
          daFonteCadastral(lookup, "inscricaoEstadual"),
          daLoja(fiscalLoja?.inscricaoEstadual, "Identidade fiscal da loja"),
        ].filter(Boolean) as Candidato[])

      case "inscricaoMunicipal":
        return resolverCampo(campo, [
          doManual(manual.inscricaoMunicipal),
          daLoja(fiscalLoja?.inscricaoMunicipal, "Identidade fiscal da loja"),
        ].filter(Boolean) as Candidato[])

      case "cnae":
        return resolverCampo(campo, [
          doManual(manual.cnae),
          daFonteCadastral(lookup, "cnae"),
          daLoja(fiscalLoja?.cnae, "Identidade fiscal da loja"),
        ].filter(Boolean) as Candidato[])

      case "regimeTributario":
        return resolverCampo(campo, [
          doManual(manual.regimeTributario),
          daFonteCadastral(lookup, "regimeTributario"),
          daLoja(fiscalLoja?.regimeTributario, "Identidade fiscal da loja"),
        ].filter(Boolean) as Candidato[])
    }
  })

  const pendencias = campos.filter((c) => c.origem === "pendente").map((c) => c.campo)

  return {
    podeConfirmar: bloqueios.length === 0 && Boolean(extraido),
    storeId,
    certificado: extraido,
    reconciliacao,
    campos,
    bloqueios,
    pendencias,
    lookup: resumoLookup(lookup),
    custodia: custodiaPendente(storeId),
    fiscalEnabledAtual: Boolean(fiscalLoja?.fiscalEnabled),
    transmissao: "nenhuma",
  }
}

/** Payload da identidade fiscal confirmada — exatamente os campos do cadastro, nada além. */
export type IdentidadeConfirmadaPayload = Record<CampoIdentidadeFiscal, string>

/**
 * Campos que o usuário NÃO pode sobrescrever na confirmação: o CNPJ é a chave da reconciliação —
 * aceitar um valor digitado aqui anularia o bloqueio por divergência.
 */
const CAMPOS_SEM_OVERRIDE_MANUAL = new Set<CampoIdentidadeFiscal>(["cnpj"])

/**
 * Converte a prévia (com os valores confirmados) no payload de gravação da identidade fiscal.
 * NÃO inclui `fiscalEnabled`, provider, CSC, ambiente, modelo ou série — esses são preservados
 * pela rota a partir do estado atual da loja.
 */
export function montarPayloadIdentidadeConfirmada(
  campos: CampoOnboarding[],
  manual?: Partial<Record<CampoIdentidadeFiscal, string>>,
): IdentidadeConfirmadaPayload {
  const porCampo = new Map(campos.map((c) => [c.campo, c.valor]))
  const out = {} as IdentidadeConfirmadaPayload
  for (const campo of ORDEM_CAMPOS) {
    const confirmado = CAMPOS_SEM_OVERRIDE_MANUAL.has(campo) ? "" : txt(manual?.[campo])
    out[campo] = confirmado !== "" ? confirmado : txt(porCampo.get(campo))
  }
  return out
}
