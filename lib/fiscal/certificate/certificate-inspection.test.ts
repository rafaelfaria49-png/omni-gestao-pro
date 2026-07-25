/**
 * GOAL-016B — inspeção do certificado A1 no onboarding.
 *
 * Prova: extração do que o A1 realmente carrega (CNPJ, titular, validade, AC, série, fingerprint),
 * matriz fail-closed (senha incorreta, vencido, cadeia inválida, arquivo ilegível, chave fraca),
 * limites de arquivo e — inegociável — ZERO segredo no resultado.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { scanForSecrets } from "@/lib/fiscal/vault/secret-scan"
import type { Pkcs12Meta } from "@/lib/fiscal/vault/pkcs12-loader"
import {
  makeTestPfx,
  expiredTestPfx,
  TEST_PFX_PRIVATE_KEY_PEM,
} from "@/lib/fiscal/vault/__fixtures__/make-test-pfx"
import {
  PFX_TAMANHO_MAXIMO_BYTES,
  avaliarMaterialCertificado,
  bloqueiosDoCertificadoDeclarado,
  inspecionarCertificadoPfx,
  nomeEmpresarialDoCn,
  validarArquivoPfx,
} from "./certificate-inspection"
import type { CertificadoExtraido } from "./onboarding-types"

const CNPJ = "11222333000181"

function codigos(bloqueios: { codigo: string }[]): string[] {
  return bloqueios.map((b) => b.codigo)
}

function metaFixture(over: Partial<Pkcs12Meta> = {}): Pkcs12Meta {
  const agora = Date.now()
  return {
    titularCn: `RAFACELL COMERCIO LTDA:${CNPJ}`,
    subject: `CN=RAFACELL COMERCIO LTDA:${CNPJ}`,
    cnpj: CNPJ,
    issuerCn: "AC TESTE RFB v5",
    issuer: "CN=AC TESTE RFB v5",
    email: "fiscal@rafacell.test",
    serialNumber: "0a1b2c3d",
    fingerprintSha1: "aa".repeat(20),
    notBefore: new Date(agora - 86_400_000),
    notAfter: new Date(agora + 86_400_000),
    chavePublicaRsaBits: 2048,
    ...over,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("inspecionarCertificadoPfx · extração (item 2)", () => {
  it("PFX válido de teste ⇒ extrai CNPJ, titular, nome empresarial, validade, AC, série e fingerprint", () => {
    const { pfx, senha, notBefore, notAfter } = makeTestPfx({ cnpj: CNPJ })

    const r = inspecionarCertificadoPfx({ pfx, senha })

    expect(r.ok).toBe(true)
    expect(r.bloqueios).toEqual([])
    expect(r.extraido).not.toBeNull()
    expect(r.extraido!.cnpj).toBe(CNPJ)
    expect(r.extraido!.titularCn).toBe(`RAFACELL COMERCIO LTDA:${CNPJ}`)
    // Nome empresarial = CN sem o sufixo `:CNPJ` — não é "nome fantasia".
    expect(r.extraido!.nomeEmpresarial).toBe("RAFACELL COMERCIO LTDA")
    expect(r.extraido!.autoridadeCertificadora).toBe(`RAFACELL COMERCIO LTDA:${CNPJ}`) // auto-assinado no fixture
    expect(r.extraido!.serialNumber).not.toBe("")
    expect(r.extraido!.fingerprintSha1).toMatch(/^[0-9a-f]{40}$/)
    // O X.509 guarda a validade com resolução de SEGUNDOS — comparar em ms falharia por truncamento.
    const emSegundos = (v: Date | string) => Math.floor(new Date(v).getTime() / 1000)
    expect(emSegundos(r.extraido!.validoDe!)).toBe(emSegundos(notBefore))
    expect(emSegundos(r.extraido!.validoAte!)).toBe(emSegundos(notAfter))
    expect(r.extraido!.vigente).toBe(true)
    expect(r.extraido!.cadeiaDisponivel).toBe(true)
    expect(r.extraido!.chavePublicaRsaBits).toBe(2048)
  })

  it("não afirma endereço, IE, CRT ou CSC — esses campos não existem no resultado da extração", () => {
    const { pfx, senha } = makeTestPfx({ cnpj: CNPJ })
    const r = inspecionarCertificadoPfx({ pfx, senha })
    const chaves = Object.keys(r.extraido ?? {})
    for (const proibida of ["logradouro", "cep", "municipio", "uf", "inscricaoEstadual", "crt", "cscId", "regimeTributario"]) {
      expect(chaves).not.toContain(proibida)
    }
  })

  it("certificado sem CNPJ identificável ⇒ bloqueio cnpj_certificado_ausente", () => {
    const { pfx, senha } = makeTestPfx({ cnpj: null, cn: "TITULAR SEM CNPJ" })
    const r = inspecionarCertificadoPfx({ pfx, senha })
    expect(r.ok).toBe(false)
    expect(codigos(r.bloqueios)).toContain("cnpj_certificado_ausente")
  })
})

describe("inspecionarCertificadoPfx · fail-closed (item 8)", () => {
  it("senha incorreta ⇒ senha_incorreta, sem extração", () => {
    const { pfx } = makeTestPfx({ senha: "senha-correta" })
    const r = inspecionarCertificadoPfx({ pfx, senha: "senha-errada" })
    expect(r.ok).toBe(false)
    expect(r.extraido).toBeNull()
    expect(codigos(r.bloqueios)).toEqual(["senha_incorreta"])
  })

  it("senha ausente ⇒ senha_ausente (nem tenta abrir o container)", () => {
    const { pfx } = makeTestPfx()
    const r = inspecionarCertificadoPfx({ pfx, senha: "" })
    expect(codigos(r.bloqueios)).toEqual(["senha_ausente"])
  })

  it("arquivo ausente/vazio ⇒ arquivo_ausente", () => {
    expect(codigos(inspecionarCertificadoPfx({ pfx: null, senha: "x" }).bloqueios)).toEqual(["arquivo_ausente"])
    expect(codigos(inspecionarCertificadoPfx({ pfx: Buffer.alloc(0), senha: "x" }).bloqueios)).toEqual(["arquivo_ausente"])
  })

  it("bytes que não são PKCS#12 ⇒ arquivo_invalido", () => {
    const lixo = Buffer.from("isto-definitivamente-nao-e-um-pkcs12", "utf8")
    const r = inspecionarCertificadoPfx({ pfx: lixo, senha: "qualquer" })
    expect(r.extraido).toBeNull()
    expect(codigos(r.bloqueios)).toEqual(["arquivo_invalido"])
  })

  it("certificado vencido ⇒ certificado_vencido e vigente=false", () => {
    const { pfx, senha } = expiredTestPfx({ cnpj: CNPJ })
    const r = inspecionarCertificadoPfx({ pfx, senha })
    expect(r.ok).toBe(false)
    expect(codigos(r.bloqueios)).toContain("certificado_vencido")
    expect(r.extraido!.vigente).toBe(false)
  })

  it("certificado ainda não vigente ⇒ certificado_ainda_nao_valido", () => {
    const daquiUmMes = new Date(Date.now() + 30 * 86_400_000)
    const { pfx, senha } = makeTestPfx({
      cnpj: CNPJ,
      notBefore: daquiUmMes,
      notAfter: new Date(daquiUmMes.getTime() + 365 * 86_400_000),
    })
    const r = inspecionarCertificadoPfx({ pfx, senha })
    expect(codigos(r.bloqueios)).toContain("certificado_ainda_nao_valido")
  })

  it("zera o buffer do .pfx após a leitura (o material não sobrevive na memória do chamador)", () => {
    const { pfx, senha } = makeTestPfx({ cnpj: CNPJ })
    const copia = Buffer.from(pfx)
    inspecionarCertificadoPfx({ pfx, senha })
    expect(pfx.every((b) => b === 0)).toBe(true)
    expect(copia.some((b) => b !== 0)).toBe(true) // a cópia prova que havia conteúdo antes
  })
})

describe("avaliarMaterialCertificado · cenários que o leitor PKCS#12 rejeita antes", () => {
  it("cadeia indisponível ⇒ cadeia_invalida", () => {
    const { bloqueios } = avaliarMaterialCertificado({ meta: metaFixture(), cadeiaDisponivel: false })
    expect(codigos(bloqueios)).toContain("cadeia_invalida")
  })

  it("chave RSA abaixo de 2048 ⇒ chave_fraca", () => {
    const { bloqueios } = avaliarMaterialCertificado({
      meta: metaFixture({ chavePublicaRsaBits: 1024 }),
      cadeiaDisponivel: true,
    })
    expect(codigos(bloqueios)).toContain("chave_fraca")
  })

  it("material íntegro ⇒ nenhum bloqueio e AC/e-mail extraídos do X.509", () => {
    const { extraido, bloqueios } = avaliarMaterialCertificado({ meta: metaFixture(), cadeiaDisponivel: true })
    expect(bloqueios).toEqual([])
    expect(extraido.autoridadeCertificadora).toBe("AC TESTE RFB v5")
    expect(extraido.email).toBe("fiscal@rafacell.test")
  })
})

describe("validarArquivoPfx · limites de upload (item 1)", () => {
  it("aceita .pfx e .p12 dentro do limite", () => {
    expect(validarArquivoPfx({ nome: "cert.pfx", tamanho: 4096, contentType: "application/x-pkcs12" })).toEqual([])
    expect(validarArquivoPfx({ nome: "CERT.P12", tamanho: 4096, contentType: "application/octet-stream" })).toEqual([])
  })

  it("recusa extensão e content-type fora da lista", () => {
    expect(codigos(validarArquivoPfx({ nome: "cert.pem", tamanho: 100, contentType: "text/plain" }))).toContain(
      "tipo_arquivo_invalido",
    )
    expect(codigos(validarArquivoPfx({ nome: "cert.pfx", tamanho: 100, contentType: "text/html" }))).toContain(
      "tipo_arquivo_invalido",
    )
  })

  it("recusa arquivo acima do limite e arquivo vazio", () => {
    expect(
      codigos(validarArquivoPfx({ nome: "c.pfx", tamanho: PFX_TAMANHO_MAXIMO_BYTES + 1, contentType: "application/x-pkcs12" })),
    ).toContain("arquivo_muito_grande")
    expect(codigos(validarArquivoPfx({ nome: "c.pfx", tamanho: 0, contentType: "application/x-pkcs12" }))).toContain(
      "arquivo_ausente",
    )
  })
})

describe("inspecionarCertificadoPfx · nenhum segredo escapa (item 8)", () => {
  it("resultado serializado não contém senha, bytes do .pfx nem a chave privada", () => {
    const { pfx, senha } = makeTestPfx({ cnpj: CNPJ, senha: "senha-pfx-super-secreta" })
    const copiaPfx = Buffer.from(pfx)

    const r = inspecionarCertificadoPfx({ pfx, senha })

    const scan = scanForSecrets(r, {
      senha,
      pfxBytes: copiaPfx,
      privateKeyPem: TEST_PFX_PRIVATE_KEY_PEM,
    })
    expect(scan).toEqual({ vazou: false, ocorrencias: [] })
  })

  it("resultado de erro (senha incorreta) também não vaza a senha tentada", () => {
    const { pfx } = makeTestPfx({ senha: "senha-correta" })
    const tentativa = "senha-que-o-usuario-digitou-errada"
    const r = inspecionarCertificadoPfx({ pfx, senha: tentativa })
    expect(scanForSecrets(r, { senha: tentativa }).vazou).toBe(false)
  })
})

describe("inspecionarCertificadoPfx · zero transmissão (bloqueio de escopo)", () => {
  it("a leitura do certificado não faz nenhuma chamada de rede", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const { pfx, senha } = makeTestPfx({ cnpj: CNPJ })
    inspecionarCertificadoPfx({ pfx, senha })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("bloqueiosDoCertificadoDeclarado · a confirmação não confia no cliente", () => {
  const declarado = (over: Partial<CertificadoExtraido> = {}): CertificadoExtraido => ({
    cnpj: CNPJ,
    titularCn: `RAFACELL COMERCIO LTDA:${CNPJ}`,
    subject: `CN=RAFACELL COMERCIO LTDA:${CNPJ}`,
    nomeEmpresarial: "RAFACELL COMERCIO LTDA",
    email: null,
    validoDe: new Date(Date.now() - 86_400_000).toISOString(),
    validoAte: new Date(Date.now() + 86_400_000).toISOString(),
    autoridadeCertificadora: "AC TESTE RFB v5",
    serialNumber: "0a1b",
    fingerprintSha1: "aa".repeat(20),
    cadeiaDisponivel: true,
    vigente: true,
    chavePublicaRsaBits: 2048,
    ...over,
  })

  it("metadados íntegros ⇒ nenhum bloqueio", () => {
    expect(bloqueiosDoCertificadoDeclarado(declarado())).toEqual([])
  })

  it("re-deriva o vencimento a partir das datas declaradas (mesmo com vigente=true forjado)", () => {
    const vencido = declarado({
      validoDe: new Date(Date.now() - 800 * 86_400_000).toISOString(),
      validoAte: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      vigente: true,
    })
    expect(codigos(bloqueiosDoCertificadoDeclarado(vencido))).toContain("certificado_vencido")
  })

  it("cadeia ausente, chave fraca e CNPJ ausente continuam bloqueando na confirmação", () => {
    expect(codigos(bloqueiosDoCertificadoDeclarado(declarado({ cadeiaDisponivel: false })))).toContain("cadeia_invalida")
    expect(codigos(bloqueiosDoCertificadoDeclarado(declarado({ chavePublicaRsaBits: 1024 })))).toContain("chave_fraca")
    expect(codigos(bloqueiosDoCertificadoDeclarado(declarado({ cnpj: null })))).toContain("cnpj_certificado_ausente")
  })

  it("datas ausentes ou inválidas ⇒ arquivo_invalido", () => {
    expect(codigos(bloqueiosDoCertificadoDeclarado(declarado({ validoAte: null })))).toContain("arquivo_invalido")
    expect(codigos(bloqueiosDoCertificadoDeclarado(declarado({ validoDe: "não-é-data" })))).toContain("arquivo_invalido")
  })
})

describe("nomeEmpresarialDoCn", () => {
  it("remove o sufixo :CNPJ do padrão ICP-Brasil e preserva o restante", () => {
    expect(nomeEmpresarialDoCn(`RAFACELL COMERCIO LTDA:${CNPJ}`)).toBe("RAFACELL COMERCIO LTDA")
    expect(nomeEmpresarialDoCn("EMPRESA SEM CNPJ")).toBe("EMPRESA SEM CNPJ")
  })
})
