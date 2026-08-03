/**
 * Serviço de custódia do certificado A1 (GOAL-016C) — orquestração server-side do ciclo de vida
 * do segredo: armazenar, rotacionar, revogar e descrever, SEMPRE via port `FiscalSecretVault`.
 *
 * Garantias (ADR-0009/ADR-0014):
 *  - O `.pfx` e a senha vivem apenas em memória: a validação abre o PKCS#12 numa CÓPIA do buffer
 *    (a inspeção zera a cópia) e o buffer original é zerado após a gravação — inclusive em erro.
 *  - Nada é persistido em claro: o cofre devolve apenas REFERÊNCIAS OPACAS.
 *  - Fail-closed: provider sem escrita ⇒ `custodia_indisponivel`; certificado inválido/vencido ⇒
 *    bloqueio sanitizado; nenhuma exceção carrega segredo na mensagem.
 *  - Rotação segura: a nova versão é validada e gravada ANTES; as referências anteriores só são
 *    revogadas DEPOIS que o caller confirma a troca do ponteiro (`confirmarTroca`).
 *  - ⚠️ ROLLBACK É CONDICIONAL AO BACKEND. "A versão anterior permanece intacta" vale SOMENTE
 *    para providers de referências VERSIONADAS e versões imutáveis (ADR-0014 §2.1), em que a
 *    versão nova é um objeto separado e pode ser descartada. Num backend de referência ESTÁVEL
 *    (EnvVault: slot canônico por loja) a gravação é IN-PLACE — o material anterior já foi
 *    substituído no instante da escrita e NÃO há rollback a executar. O resultado diz qual dos
 *    dois casos ocorreu em `materialAnterior`; nenhuma mensagem promete rollback não executado.
 *
 * Módulo PURO quanto a banco: não importa Prisma/Next. Quem grava o ponteiro no banco é a rota.
 */
import { inspecionarCertificadoPfx } from "@/lib/fiscal/certificate/certificate-inspection"
import type { CertificadoExtraido, OnboardingBloqueio } from "@/lib/fiscal/certificate/onboarding-types"
import { FiscalVaultError } from "./fiscal-secret-vault"
import type { FiscalSecretMetadata, FiscalSecretVault, FiscalVaultAvailability } from "./fiscal-secret-vault"
import { zeroBuffer } from "./pkcs12-loader"

export type CertificadoRefs = {
  blobRef: string
  senhaRef: string
}

export type CustodiaFalhaCodigo =
  | "certificado_invalido" // arquivo/senha/validade reprovados na inspeção (detalhe em `bloqueios`)
  | "custodia_indisponivel" // provider sem escrita/rotação neste ambiente (fail-closed)
  | "troca_nao_confirmada" // rotação: o caller não conseguiu trocar o ponteiro — versão nova descartada
  | "erro_inesperado"

export type CustodiaFalha = {
  ok: false
  codigo: CustodiaFalhaCodigo
  /** Mensagem sanitizada — NUNCA contém segredo. */
  mensagem: string
  bloqueios: OnboardingBloqueio[]
  /**
   * Só em `troca_nao_confirmada`: o que ACONTECEU de fato com o material anterior.
   *  - `preservado` — backend de refs versionadas: a versão nova foi descartada e a anterior segue servindo;
   *  - `substituido_sem_rollback` — backend de referência estável (ex.: EnvVault): a gravação é
   *    in-place, então o material anterior JÁ foi substituído e não existe rollback a executar.
   * Existe para que nenhum caller precise deduzir rollback a partir da mensagem.
   */
  materialAnterior?: "preservado" | "substituido_sem_rollback"
}

export type ArmazenarResultado =
  | { ok: true; refs: CertificadoRefs; extraido: CertificadoExtraido }
  | CustodiaFalha

export type RotacaoResultado =
  | {
      ok: true
      refs: CertificadoRefs
      extraido: CertificadoExtraido
      /**
       * `pendente` quando o provider não revogou a versão anterior (ex.: piloto sem escrita);
       * `nao_aplicavel` em DOIS casos, ambos sem versão anterior separada para destruir:
       *  - refs iguais (backend canônico/estável como o EnvVault): a nova versão substituiu o
       *    valor in-place;
       *  - a linha não tinha `blobRef`/`senhaRef` anteriores (primeira custódia daquela linha).
       */
      revogacaoAnterior: "concluida" | "pendente" | "nao_aplicavel"
    }
  | CustodiaFalha

const MENSAGEM_CUSTODIA_INDISPONIVEL =
  "O cofre seguro deste ambiente não aceita gravação em runtime — a custódia segue por provisionamento manual (fail-closed)."

function falhaInspecao(bloqueios: OnboardingBloqueio[]): CustodiaFalha {
  return {
    ok: false,
    codigo: "certificado_invalido",
    mensagem: bloqueios[0]?.mensagem ?? "Certificado recusado na validação.",
    bloqueios,
  }
}

function falhaCustodiaIndisponivel(): CustodiaFalha {
  return { ok: false, codigo: "custodia_indisponivel", mensagem: MENSAGEM_CUSTODIA_INDISPONIVEL, bloqueios: [] }
}

function isOperacaoNaoSuportada(e: unknown): boolean {
  return e instanceof FiscalVaultError && e.code === "operacao_nao_suportada"
}

/**
 * Valida o `.pfx` EM MEMÓRIA (numa cópia — a inspeção zera o buffer que recebe) e devolve a
 * extração saneada. Retorna `null` quando há bloqueio (o caller monta a falha).
 */
function validarEmMemoria(params: {
  pfx: Buffer
  senha: string
  agora?: Date
}): { extraido: CertificadoExtraido | null; bloqueios: OnboardingBloqueio[] } {
  const copia = Buffer.from(params.pfx)
  const inspecao = inspecionarCertificadoPfx({ pfx: copia, senha: params.senha, agora: params.agora })
  return { extraido: inspecao.extraido, bloqueios: inspecao.bloqueios }
}

/**
 * Armazena o certificado A1 no cofre e devolve as referências opacas + metadados seguros.
 * Rejeita certificado inválido, vencido, fora de janela, de chave fraca ou sem CNPJ (a inspeção
 * bloqueia todos esses casos). Fail-closed quando o provider não grava em runtime.
 */
export async function armazenarCertificadoA1(params: {
  vault: FiscalSecretVault
  storeId: string
  pfx: Buffer
  senha: string
  agora?: Date
}): Promise<ArmazenarResultado> {
  const { vault, storeId, pfx, senha } = params
  try {
    const { extraido, bloqueios } = validarEmMemoria({ pfx, senha, agora: params.agora })
    if (!extraido || bloqueios.length > 0) return falhaInspecao(bloqueios)

    try {
      const refs = await vault.putCertificadoPfx(storeId, pfx, senha)
      return { ok: true, refs, extraido }
    } catch (e) {
      if (isOperacaoNaoSuportada(e)) return falhaCustodiaIndisponivel()
      throw e
    }
  } catch (e) {
    if (e instanceof FiscalVaultError) {
      return { ok: false, codigo: "erro_inesperado", mensagem: "Falha ao gravar no cofre (fail-closed).", bloqueios: [] }
    }
    throw e
  } finally {
    zeroBuffer(pfx)
  }
}

/**
 * Rotação segura do A1 (GOAL-016C · ADR-0014 §2.1):
 *  1. valida a NOVA versão em memória (inválida/vencida ⇒ nada muda);
 *  2. grava a nova versão no cofre;
 *  3. o caller troca o ponteiro no banco dentro de `confirmarTroca` (ato atômico dele);
 *  4. confirmada a troca, as referências anteriores são revogadas (best-effort reportado).
 *
 * O passo 2 só deixa "as refs anteriores intactas" em backend de refs VERSIONADAS. Com refs
 * estáveis a escrita é in-place e a versão anterior deixa de existir ali mesmo — por isso a falha
 * no passo 3 devolve `materialAnterior` dizendo se houve ou não preservação real.
 */
export async function rotacionarCertificadoA1(params: {
  vault: FiscalSecretVault
  storeId: string
  novoPfx: Buffer
  novaSenha: string
  refsAnteriores: { blobRef: string | null; senhaRef: string | null }
  /** Troca o ponteiro para as novas refs. Deve lançar se não conseguir confirmar. */
  confirmarTroca: (novasRefs: CertificadoRefs, extraido: CertificadoExtraido) => Promise<void>
  agora?: Date
}): Promise<RotacaoResultado> {
  const { vault, storeId, novoPfx, novaSenha } = params
  try {
    const { extraido, bloqueios } = validarEmMemoria({ pfx: novoPfx, senha: novaSenha, agora: params.agora })
    if (!extraido || bloqueios.length > 0) return falhaInspecao(bloqueios)

    let novasRefs: CertificadoRefs
    try {
      novasRefs = await vault.rotateCertificadoPfx(storeId, novoPfx, novaSenha)
    } catch (e) {
      if (isOperacaoNaoSuportada(e)) return falhaCustodiaIndisponivel()
      throw e
    }

    /**
     * Backend de refs canônicas/estáveis (ex.: EnvVault): a "nova versão" substitui o valor
     * IN-PLACE e as refs devolvidas são as mesmas das anteriores. Nesse caso NÃO há versão
     * separada para descartar ou revogar — revogar apagaria o segredo recém-gravado. A garantia
     * plena de "anterior servindo até a confirmação" exige provider com refs versionadas
     * (ADR-0014); com refs estáveis, a troca do ponteiro é trivialmente consistente (mesma ref).
     */
    const refsIdenticas =
      novasRefs.blobRef === params.refsAnteriores.blobRef && novasRefs.senhaRef === params.refsAnteriores.senhaRef

    /** Havia material anterior a ser descartado? Linha sem custódia prévia ⇒ nada a revogar. */
    const possuiRefsAnteriores = Boolean(
      String(params.refsAnteriores.blobRef ?? "").trim() || String(params.refsAnteriores.senhaRef ?? "").trim(),
    )

    try {
      await params.confirmarTroca(novasRefs, extraido)
    } catch {
      // A anterior NUNCA foi revogada aqui. Com refs versionadas a versão nova é um objeto
      // separado e pode ser descartada; com refs idênticas o valor in-place JÁ é o novo — revogar
      // apagaria o único material existente.
      if (!refsIdenticas) {
        await revogarSegredosCertificado({ vault, storeId, ...novasRefs })
      }
      return {
        ok: false,
        codigo: "troca_nao_confirmada",
        // Verdadeira nos dois backends: afirma o que NÃO mudou (o ponteiro) em vez de prometer
        // um rollback do material que só o backend versionado executa.
        mensagem: refsIdenticas
          ? "Não foi possível confirmar a troca do certificado — o ponteiro no banco não foi alterado. Este cofre grava por referência estável, então o material já é o da nova versão: confira o certificado da unidade antes de qualquer emissão."
          : "Não foi possível confirmar a troca do certificado — o ponteiro no banco não foi alterado e a versão nova foi descartada (fail-closed).",
        bloqueios: [],
        materialAnterior: refsIdenticas ? "substituido_sem_rollback" : "preservado",
      }
    }

    // Refs idênticas (in-place) ou linha sem custódia prévia: não existe versão anterior separada
    // para revogar. Reportar "concluida" aqui afirmaria uma destruição que nunca aconteceu.
    if (refsIdenticas || !possuiRefsAnteriores) {
      return { ok: true, refs: novasRefs, extraido, revogacaoAnterior: "nao_aplicavel" }
    }

    const revogacao = await revogarSegredosCertificado({
      vault,
      storeId,
      blobRef: params.refsAnteriores.blobRef,
      senhaRef: params.refsAnteriores.senhaRef,
    })
    return {
      ok: true,
      refs: novasRefs,
      extraido,
      revogacaoAnterior: revogacao.pendentes.length > 0 ? "pendente" : "concluida",
    }
  } catch (e) {
    if (e instanceof FiscalVaultError) {
      return { ok: false, codigo: "erro_inesperado", mensagem: "Falha ao rotacionar no cofre (fail-closed).", bloqueios: [] }
    }
    throw e
  } finally {
    zeroBuffer(novoPfx)
  }
}

export type RevogacaoResultado = {
  /** Referências efetivamente revogadas. */
  revogadas: string[]
  /** Referências cuja revogação ficou pendente (provider sem suporte) — reportadas, nunca escondidas. */
  pendentes: string[]
}

/**
 * Revoga (destrói) as referências do certificado no cofre. Tolerante a ref ausente; NUNCA lança
 * por provider sem suporte — reporta em `pendentes` para o caller auditar a remoção manual.
 */
export async function revogarSegredosCertificado(params: {
  vault: FiscalSecretVault
  storeId: string
  blobRef: string | null | undefined
  senhaRef: string | null | undefined
}): Promise<RevogacaoResultado> {
  const { vault, storeId } = params
  const revogadas: string[] = []
  const pendentes: string[] = []
  for (const ref of [params.blobRef, params.senhaRef]) {
    const name = String(ref ?? "").trim()
    if (!name) continue
    try {
      await vault.revoke(storeId, name)
      revogadas.push(name)
    } catch (e) {
      if (isOperacaoNaoSuportada(e)) {
        pendentes.push(name)
        continue
      }
      if (e instanceof FiscalVaultError) {
        // ref fora de escopo / store inválida: não é revogável por este caminho — reporta pendente.
        pendentes.push(name)
        continue
      }
      throw e
    }
  }
  return { revogadas, pendentes }
}

export type DescricaoCustodia = {
  /** `true` quando AMBAS as referências existem no backend. */
  configurada: boolean
  availability: FiscalVaultAvailability
  blob: FiscalSecretMetadata | null
  senha: FiscalSecretMetadata | null
}

/**
 * Descreve a custódia atual SEM tocar o segredo: existência das refs + disponibilidade do provider.
 * É a única leitura que a UI/API precisa para dizer "configurado ou não" e "qual provider".
 */
export async function descreverCustodiaCertificado(params: {
  vault: FiscalSecretVault
  storeId: string
  blobRef: string | null | undefined
  senhaRef: string | null | undefined
}): Promise<DescricaoCustodia> {
  const { vault, storeId } = params
  const [blob, senha, availability] = await Promise.all([
    vault.describeSecret(storeId, params.blobRef),
    vault.describeSecret(storeId, params.senhaRef),
    vault.checkAvailability(),
  ])
  return {
    configurada: Boolean(blob?.configurada && senha?.configurada),
    availability,
    blob,
    senha,
  }
}
