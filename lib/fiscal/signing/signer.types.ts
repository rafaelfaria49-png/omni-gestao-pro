/**
 * Tipos e constantes da assinatura digital XMLDSig da NFC-e (BL-FISCAL-005).
 *
 * Camada PURA: o assinador recebe XML + material do certificado (PEM) + senha e devolve o XML
 * assinado. NÃO acessa banco/Prisma/fetch/Next. A RESOLUÇÃO do certificado é feita pela
 * orquestração via `FiscalSecretVault` (ADR-0009) — aqui só consumimos o material já em memória.
 */

/**
 * Algoritmos do XMLDSig da NFC-e 4.00. Os valores NÃO são escolha nossa: o schema oficial
 * `xmldsig-core-schema_v1.01.xsd` os declara `fixed` (SignatureMethod L34, DigestMethod L52,
 * CanonicalizationMethod L29), logo qualquer outro algoritmo é XSD-inválido e a SEFAZ rejeita.
 * Ver ADR-0011. SHA-1 vale SOMENTE aqui — nunca para senhas, tokens ou hashes internos.
 */
export const DSIG_NS = "http://www.w3.org/2000/09/xmldsig#"
export const ALG_C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"
export const ALG_ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature"
export const ALG_SIGNATURE_RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1"
export const ALG_DIGEST_SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1"

/**
 * Material do certificado A1 já extraído para PEM (chave privada + certificado X.509).
 * A conversão `.pfx` (PKCS#12, vinda do cofre) → PEM é um adaptador da orquestração (precisa de
 * um leitor PKCS#12) — fora desta camada pura para não adicionar dependência. Ver `Pkcs12Loader`.
 */
export type FiscalCertificateMaterial = {
  /** PEM da chave privada (pode estar cifrado; nesse caso exige `senha`). NUNCA logar. */
  privateKeyPem: string
  /** PEM do certificado X.509 (cadeia mínima = certificado do titular). */
  certificatePem: string
}

export type SignNfceOptions = {
  /** Senha da chave privada (quando o PEM está cifrado). NUNCA logar/serializar. */
  senha?: string
  /** Instante de referência p/ validar validade do certificado (default: agora). */
  agora?: Date
  /** Ignora a checagem de validade temporal do certificado (somente testes/dry-run). */
  ignorarValidade?: boolean
  /** Se true, reassina um XML já assinado (remove a assinatura anterior). Default false. */
  permitirReassinatura?: boolean
  /**
   * Aceita XML de DOCUMENTO standalone (com declaração `<?xml ?>` ou BOM). Default false.
   *
   * ⚠️ Só para provas e fixtures cujos bytes NUNCA são persistidos em `NotaFiscal.xmlAssinado`
   * nem transmitidos à SEFAZ. Bytes assinados sob esta flag são irreversivelmente inadequados
   * para `nfeDadosMsg`: a declaração não pode ser removida depois sem quebrar o XMLDSig e
   * divergir do hash persistido (ADR-0017/0018). Nenhum caminho de emissão pode ligá-la.
   */
  permitirDocumentoStandalone?: boolean
}

export type NfceSignErrorCode =
  | "xml_invalido"
  | "xml_nao_embutivel"
  | "sem_infnfe"
  | "infnfe_sem_id"
  | "ja_assinado"
  | "nao_assinado"
  | "material_ausente"
  | "certificado_invalido"
  | "certificado_expirado"
  | "senha_invalida"
  | "chave_privada_invalida"
  | "chave_incompativel"
  | "estrutura_assinatura_invalida"
  | "algoritmo_nao_permitido"
  | "referencia_invalida"
  | "referencia_ambigua"
  | "digest_invalido"
  | "assinatura_invalida"
  | "vault_erro"

/** Erro da assinatura — a mensagem NUNCA contém segredo (chave/senha). */
export class NfceSignError extends Error {
  readonly code: NfceSignErrorCode
  constructor(code: NfceSignErrorCode, message: string) {
    super(message)
    this.name = "NfceSignError"
    this.code = code
  }
}

/** Resultado rico da assinatura (XML + metadados úteis sem reparsear). */
export type SignNfceResult = {
  /** XML completo com o elemento `<Signature>` inserido em `<NFe>`. */
  xml: string
  /** Id do `infNFe` referenciado (ex.: `NFe35...`). */
  referenciaId: string
  /** Digest SHA-1 (base64) do `infNFe` canonicalizado. */
  digestValue: string
  /** SignatureValue (base64) — assinatura RSA-SHA1 do SignedInfo canonicalizado. */
  signatureValue: string
  /** Certificado (DER base64) embutido em X509Data. */
  certificadoBase64: string
}

export type VerifyNfceResult = {
  /** true quando há assinatura E digest E SignatureValue conferem. */
  valido: boolean
  assinado: boolean
  digestConfere: boolean
  assinaturaConfere: boolean
  referenciaId: string | null
  /** Motivos quando inválido (sem segredo). */
  problemas: string[]
}
