"use client"

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import { maxLojasPermitidas } from "@/lib/plano-lojas"

const STORAGE_KEY = "assistec-pro-config-v2"
const LEGACY_STORAGE_KEY = "assistec-pro-config-v1"

// Tipos para a configuração da empresa
export interface EnderecoEmpresa {
  rua: string
  numero: string
  bairro: string
  cidade: string
  estado: string
  cep: string
}

export interface ContatoEmpresa {
  telefone: string
  whatsapp: string
  /** WhatsApp do dono — recebe fechamento diário e comandos críticos. */
  whatsappDono?: string
  email: string
}

export interface IdentidadeVisual {
  logoUrl: string
  coresTema: string[]
}

export interface DadosFiscais {
  certificadoDigitalStatus: "Pendente de Upload" | "Ativo" | "Expirado"
  tipoCertificado: "A1" | "A3"
  senhaCertificado?: string
}

export interface CategoriaGarantia {
  id: string
  servico: string
  detalhes: string
}

export interface TermosGarantia {
  tituloGeral: string
  garantiaLegal: string
  categorias: CategoriaGarantia[]
}

export interface ConfiguracaoEmpresa {
  nomeFantasia: string
  razaoSocial: string
  cnpj: string
  endereco: EnderecoEmpresa
  contato: ContatoEmpresa
  identidadeVisual: IdentidadeVisual
  fiscal: DadosFiscais
}

/** Multiloja: 1 (bronze), 2 (prata), até 5 (ouro) — estoque/vendas por unidade ativa. */
export interface PerfilLojaUnidade {
  id: string
  /** Nome fantasia = `Store.name` (API). */
  nomeFantasia: string
  razaoSocial: string
  cnpj: string
  endereco: EnderecoEmpresa
  logoUrl: string
  /** Perfil operacional da unidade (`Store.profile`). */
  storeProfile?: "ASSISTENCIA" | "VARIEDADES" | "SUPERMERCADO"
}

export interface MinhasLojasConfig {
  lojas: PerfilLojaUnidade[]
}

export interface ConfigSistema {
  empresa: ConfiguracaoEmpresa
  /** Multiloja: perfis por unidade; vazio = modo único (cadastro empresa). */
  minhasLojas: MinhasLojasConfig
  termosGarantia: TermosGarantia
  assinatura: {
    plano: "bronze" | "prata" | "ouro"
    status: "ativa" | "pendente" | "suspensa"
    vencimento: string
    periodo: "mensal" | "anual"
    valor: number
    formaPagamento: "pix" | "boleto" | "cartao"
  }
  pdv: {
    atalhosRapidos: Array<{
      id: string
      nome: string
      preco: number
    }>
    /** Dias exibidos na linha de garantia da mensagem de orçamento (WhatsApp). */
    garantiaPadraoDias: number
    /** Dias até a data de validade ao criar um orçamento novo. */
    validadeOrcamentoDias: number
    /** Se true, soma imposto estimado ao total do PDV (aba Ajustes). */
    incluirImpostoEstimadoNoPdv: boolean
    /** Percentual sobre o subtotal quando `incluirImpostoEstimadoNoPdv` está ativo. */
    aliquotaImpostoEstimadoPdv: number
    /** Se true, itens das categorias listadas não aparecem na grade até o usuário buscar. */
    ocultarCategoriasNoPdv: boolean
    /** Nomes de categoria (como no cadastro de produtos) ocultas quando `ocultarCategoriasNoPdv` está ativo. */
    categoriasOcultasNoPdv: string[]
    /** Exibe menu e tela de mesas/comandas (consumo sem pagamento na hora). */
    moduloControleConsumo: boolean
  }
}

function mergeCategoriasGarantia(
  base: CategoriaGarantia[],
  salvas?: CategoriaGarantia[]
): CategoriaGarantia[] {
  if (!salvas?.length) return base
  const mapSalvas = new Map(salvas.map((c) => [c.id, c]))
  const merged = base.map((b) => {
    const s = mapSalvas.get(b.id)
    return s ? { ...b, servico: s.servico, detalhes: s.detalhes } : b
  })
  for (const s of salvas) {
    if (!base.some((b) => b.id === s.id)) merged.push(s)
  }
  return merged
}

export function mergeConfigArmazenada(base: ConfigSistema, salvo: Partial<ConfigSistema> | null): ConfigSistema {
  if (!salvo) return base
  const planoMerged = salvo.assinatura?.plano ?? base.assinatura.plano
  const maxLojas = maxLojasPermitidas(planoMerged)
  return {
    empresa: {
      ...base.empresa,
      ...salvo.empresa,
      endereco: { ...base.empresa.endereco, ...salvo.empresa?.endereco },
      contato: { ...base.empresa.contato, ...salvo.empresa?.contato },
      identidadeVisual: {
        ...base.empresa.identidadeVisual,
        ...salvo.empresa?.identidadeVisual,
      },
      fiscal: { ...base.empresa.fiscal, ...salvo.empresa?.fiscal },
    },
    minhasLojas: {
      lojas: Array.isArray(salvo.minhasLojas?.lojas)
        ? salvo.minhasLojas.lojas.slice(0, maxLojas)
        : base.minhasLojas.lojas,
    },
    termosGarantia: {
      ...base.termosGarantia,
      ...salvo.termosGarantia,
      categorias: mergeCategoriasGarantia(
        base.termosGarantia.categorias,
        salvo.termosGarantia?.categorias
      ),
    },
    pdv: {
      ...base.pdv,
      ...salvo.pdv,
      garantiaPadraoDias:
        typeof salvo.pdv?.garantiaPadraoDias === "number"
          ? salvo.pdv.garantiaPadraoDias
          : base.pdv.garantiaPadraoDias,
      validadeOrcamentoDias:
        typeof salvo.pdv?.validadeOrcamentoDias === "number"
          ? salvo.pdv.validadeOrcamentoDias
          : base.pdv.validadeOrcamentoDias,
      atalhosRapidos: salvo.pdv?.atalhosRapidos?.length
        ? salvo.pdv.atalhosRapidos
        : base.pdv.atalhosRapidos,
      incluirImpostoEstimadoNoPdv:
        typeof salvo.pdv?.incluirImpostoEstimadoNoPdv === "boolean"
          ? salvo.pdv.incluirImpostoEstimadoNoPdv
          : base.pdv.incluirImpostoEstimadoNoPdv,
      aliquotaImpostoEstimadoPdv:
        typeof salvo.pdv?.aliquotaImpostoEstimadoPdv === "number"
          ? salvo.pdv.aliquotaImpostoEstimadoPdv
          : base.pdv.aliquotaImpostoEstimadoPdv,
      ocultarCategoriasNoPdv:
        typeof salvo.pdv?.ocultarCategoriasNoPdv === "boolean"
          ? salvo.pdv.ocultarCategoriasNoPdv
          : base.pdv.ocultarCategoriasNoPdv,
      categoriasOcultasNoPdv: Array.isArray(salvo.pdv?.categoriasOcultasNoPdv)
        ? salvo.pdv.categoriasOcultasNoPdv
        : base.pdv.categoriasOcultasNoPdv,
      moduloControleConsumo:
        typeof salvo.pdv?.moduloControleConsumo === "boolean"
          ? salvo.pdv.moduloControleConsumo
          : base.pdv.moduloControleConsumo,
    },
    assinatura: {
      ...base.assinatura,
      ...salvo.assinatura,
    },
  }
}

function enderecoCompletoDeEmpresa(emp: ConfiguracaoEmpresa["endereco"]): string {
  const { rua, numero, bairro, cidade, estado, cep } = emp
  return `${rua}, ${numero} - ${bairro}, ${cidade}/${estado} - CEP: ${cep}`
}

/** Marca interna para validar blob ofuscado da assinatura no armazenamento local. */
const ASSISTEC_ASSIN_PACK = "__ap1"

function packAssinaturaForStorage(a: ConfigSistema["assinatura"]): string {
  const payload = { ...a, [ASSISTEC_ASSIN_PACK]: true as const }
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
}

function unpackAssinaturaFromStorage(s: string): Partial<ConfigSistema["assinatura"]> | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(s)))) as Record<string, unknown>
    if (parsed[ASSISTEC_ASSIN_PACK] !== true) return null
    delete parsed[ASSISTEC_ASSIN_PACK]
    return parsed as Partial<ConfigSistema["assinatura"]>
  } catch {
    return null
  }
}

type StoredConfigBlob = Partial<ConfigSistema> & { __sa?: string }

function normalizeArmazenado(raw: StoredConfigBlob): Partial<ConfigSistema> {
  const { __sa, ...rest } = raw
  const out: Partial<ConfigSistema> = { ...rest }
  if (typeof __sa === "string") {
    const unpacked = unpackAssinaturaFromStorage(__sa)
    if (unpacked) {
      out.assinatura = unpacked as ConfigSistema["assinatura"]
    }
  }
  return out
}

/** IDs exibidos no seletor de garantia da OS: Telas, Baterias, Conectores (textos em Configurações). */
export const IDS_GARANTIA_OS = [
  "garantia_troca_tela",
  "garantia_bateria",
  "conectores_oxidacao",
] as const

/** Placeholders white-label (sem dados reais de tenant). Substitua em Configurações → Dados da Empresa. */
export const WHITELABEL_NOME_FANTASIA_PADRAO = "Minha Loja"
export const WHITELABEL_RAZAO_SOCIAL_PADRAO = "Minha Loja"
export const WHITELABEL_CNPJ_PADRAO = "00.000.000/0001-00"
export const WHITELABEL_TELEFONE_PADRAO = "(00) 00000-0000"
export const WHITELABEL_EMAIL_PADRAO = "contato@minhaempresa.com.br"

// Dados padrão neutros até o cliente preencher (localStorage vazio ou novo ambiente).
export const configPadrao: ConfigSistema = {
  minhasLojas: {
    lojas: [],
  },
  empresa: {
    nomeFantasia: WHITELABEL_NOME_FANTASIA_PADRAO,
    razaoSocial: WHITELABEL_RAZAO_SOCIAL_PADRAO,
    cnpj: WHITELABEL_CNPJ_PADRAO,
    endereco: {
      rua: "Rua Exemplo",
      numero: "0",
      bairro: "Centro",
      cidade: "São Paulo",
      estado: "SP",
      cep: "00000-000"
    },
    contato: {
      telefone: WHITELABEL_TELEFONE_PADRAO,
      whatsapp: WHITELABEL_TELEFONE_PADRAO,
      whatsappDono: "",
      email: WHITELABEL_EMAIL_PADRAO
    },
    identidadeVisual: {
      logoUrl: "",
      coresTema: ["#000000", "#FF0000", "#FFFFFF"]
    },
    fiscal: {
      certificadoDigitalStatus: "Pendente de Upload",
      tipoCertificado: "A1"
    }
  },
  termosGarantia: {
    tituloGeral: "Termos de Garantia e Condições de Serviço",
    garantiaLegal: "Conforme o Código de Defesa do Consumidor, todos os serviços e peças possuem Garantia Legal de 90 dias contra defeitos de fabricação.",
    categorias: [
      {
        id: "garantia_troca_tela",
        servico: "Troca de Tela",
        detalhes:
          "Garantia Legal (90 dias). Cobre: Falhas de imagem e touch de origem lógica. NÃO COBRE: Vidro trincado, quebrado, manchas por pressão (uso no bolso), riscos profundos ou danos por líquidos."
      },
      {
        id: "garantia_bateria",
        servico: "Troca de Bateria",
        detalhes:
          "Garantia Legal (90 dias). Cobre: Estufamento ou vício de carga. NÃO COBRE: Desgaste natural por ciclos, danos por carregadores paralelos ou oxidação."
      },
      {
        id: "conectores_oxidacao",
        servico: "Conector de Carga",
        detalhes:
          "Garantia Legal (90 dias). Cobre: Falha de comunicação. NÃO COBRE: Pinos internos tortos, quebrados, oxidados ou com sujeira."
      },
      {
        id: "desoxidacao_limpeza_quimica",
        servico: "Desoxidação (Limpeza Química)",
        detalhes:
          "Procedimento de tentativa de recuperação. Sem garantia de funcionamento pleno posterior devido à natureza corrosiva da oxidação. O cliente declara ciência do risco de o aparelho parar de funcionar após o processo."
      },
      {
        id: "venda_celular_novo",
        servico: "Venda de Celular Novo",
        detalhes:
          "Garantia de 1 ano pelo fabricante. 90 dias diretamente com a loja para auxílio. Exige caixa e acessórios originais."
      },
      {
        id: "venda_celular_usado",
        servico: "Venda de Celular Usado",
        detalhes:
          "Garantia Legal de 90 dias sobre placa e bateria. Não cobre danos estéticos relatados na compra ou mau uso."
      },
      {
        id: "perda_garantia",
        servico: "Regras de Exclusão",
        detalhes: "A garantia será invalidada se o selo de segurança estiver rompido, se houver sinais de queda, contato com líquidos ou intervenção por terceiros."
      }
    ]
  },
  assinatura: {
    plano: "bronze",
    status: "ativa",
    /** Data fixa no bundle para SSR e cliente coincidirem (evita hydration mismatch). Após hidratar localStorage, o valor real substitui. */
    vencimento: "2099-12-31",
    periodo: "mensal",
    valor: 49.9,
    formaPagamento: "pix",
  },
  pdv: {
    atalhosRapidos: [
      { id: "svc-limpeza", nome: "Limpeza Técnica", preco: 30 },
      { id: "svc-backup", nome: "Backup / Transferência", preco: 50 },
      { id: "svc-software", nome: "Software / Desbloqueio", preco: 80 },
    ],
    garantiaPadraoDias: 90,
    validadeOrcamentoDias: 7,
    incluirImpostoEstimadoNoPdv: false,
    aliquotaImpostoEstimadoPdv: 8,
    ocultarCategoriasNoPdv: false,
    categoriasOcultasNoPdv: ["Telas", "Baterias", "Conectores"],
    moduloControleConsumo: false,
  },
}

// Contexto
interface ConfigContextType {
  config: ConfigSistema
  /** true após hidratar localStorage (e antes disso não deve decidir bloqueio só pelo cliente). */
  configHydrated: boolean
  updateEmpresa: (empresa: Partial<ConfiguracaoEmpresa>) => void
  updateTermosGarantia: (termos: Partial<TermosGarantia>) => void
  updateCategoriaGarantia: (id: string, detalhes: string, servico?: string) => void
  addCategoriaGarantia: (categoria: CategoriaGarantia) => void
  removeCategoriaGarantia: (id: string) => void
  resetConfig: () => void
  getEnderecoCompleto: () => string
  getGarantiaParaServico: (servicoId: string) => CategoriaGarantia | undefined
  gerarTextoGarantiaOS: (servicoIds: string[], rodapeEmpresa?: ConfiguracaoEmpresa) => string
  updateAtalhosRapidosPDV: (atalhos: Array<{ id: string; nome: string; preco: number }>) => void
  updatePdv: (patch: Partial<ConfigSistema["pdv"]>) => void
  updateMinhasLojas: (minhasLojas: MinhasLojasConfig) => void
  updateAssinatura: (assinatura: Partial<ConfigSistema["assinatura"]>) => void
}

const ConfigContext = createContext<ConfigContextType | null>(null)

export function ConfigEmpresaProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ConfigSistema>(configPadrao)
  const [configPersistOk, setConfigPersistOk] = useState(false)

  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as StoredConfigBlob
        setConfig(mergeConfigArmazenada(configPadrao, normalizeArmazenado(parsed)))
      }
      /** Sem `raw`: estado inicial = apenas `configPadrao` (white-label neutro; nada vem do servidor aqui). */
    } catch {
      /* ignore */
    }
    setConfigPersistOk(true)
  }, [])

  useEffect(() => {
    if (!configPersistOk) return
    try {
      const { assinatura, ...rest } = config
      const toSave: StoredConfigBlob = { ...rest, __sa: packAssinaturaForStorage(assinatura) }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [config, configPersistOk])

  useEffect(() => {
    if (!configPersistOk) return
    const { vencimento, plano, status } = config.assinatura
    void fetch("/api/subscription/seal", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vencimento, plano, status }),
    }).catch(() => {})
  }, [configPersistOk, config.assinatura.vencimento, config.assinatura.plano, config.assinatura.status])

  const updateEmpresa = useCallback((empresa: Partial<ConfiguracaoEmpresa>) => {
    setConfig(prev => ({
      ...prev,
      empresa: { ...prev.empresa, ...empresa }
    }))
  }, [])

  const updateTermosGarantia = useCallback((termos: Partial<TermosGarantia>) => {
    setConfig(prev => ({
      ...prev,
      termosGarantia: { ...prev.termosGarantia, ...termos }
    }))
  }, [])

  const updateCategoriaGarantia = useCallback((id: string, detalhes: string, servico?: string) => {
    setConfig(prev => ({
      ...prev,
      termosGarantia: {
        ...prev.termosGarantia,
        categorias: prev.termosGarantia.categorias.map(cat =>
          cat.id === id ? { ...cat, detalhes, servico: servico || cat.servico } : cat
        )
      }
    }))
  }, [])

  const addCategoriaGarantia = useCallback((categoria: CategoriaGarantia) => {
    setConfig(prev => ({
      ...prev,
      termosGarantia: {
        ...prev.termosGarantia,
        categorias: [...prev.termosGarantia.categorias, categoria]
      }
    }))
  }, [])

  const removeCategoriaGarantia = useCallback((id: string) => {
    setConfig(prev => ({
      ...prev,
      termosGarantia: {
        ...prev.termosGarantia,
        categorias: prev.termosGarantia.categorias.filter(cat => cat.id !== id)
      }
    }))
  }, [])

  const updatePdv = useCallback((patch: Partial<ConfigSistema["pdv"]>) => {
    setConfig((prev) => ({
      ...prev,
      pdv: { ...prev.pdv, ...patch },
    }))
  }, [])

  const updateMinhasLojas = useCallback((minhasLojas: MinhasLojasConfig) => {
    setConfig((prev) => ({
      ...prev,
      minhasLojas: {
        lojas: minhasLojas.lojas.slice(0, maxLojasPermitidas(prev.assinatura.plano)),
      },
    }))
  }, [])

  const updateAtalhosRapidosPDV = useCallback((atalhos: Array<{ id: string; nome: string; preco: number }>) => {
    updatePdv({ atalhosRapidos: atalhos })
  }, [updatePdv])

  const updateAssinatura = useCallback((assinatura: Partial<ConfigSistema["assinatura"]>) => {
    setConfig((prev) => ({
      ...prev,
      assinatura: { ...prev.assinatura, ...assinatura },
    }))
  }, [])

  const resetConfig = useCallback(() => {
    setConfig(configPadrao)
    try {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const getEnderecoCompleto = useCallback(() => {
    return enderecoCompletoDeEmpresa(config.empresa.endereco)
  }, [config.empresa.endereco])

  useEffect(() => {
    if (typeof window === "undefined") return
    const [, corPrimaria] = config.empresa.identidadeVisual.coresTema
    const primary = corPrimaria || "#FF0000"
    document.documentElement.style.setProperty("--brand-primary-light", primary)
    document.documentElement.style.setProperty("--brand-primary-dark", primary)
  }, [config.empresa.identidadeVisual.coresTema])

  const getGarantiaParaServico = useCallback((servicoId: string) => {
    return (
      config.termosGarantia.categorias.find((cat) => cat.id === servicoId) ??
      configPadrao.termosGarantia.categorias.find((cat) => cat.id === servicoId)
    )
  }, [config.termosGarantia.categorias])

  // Gera o texto completo de garantia para impressão da OS
  const gerarTextoGarantiaOS = useCallback(
    (servicoIds: string[], rodapeEmpresa?: ConfiguracaoEmpresa) => {
      const empRodape = rodapeEmpresa ?? config.empresa
      const linhas: string[] = []

      linhas.push(config.termosGarantia.tituloGeral)
      linhas.push("")
      linhas.push("GARANTIA LEGAL:")
      linhas.push(config.termosGarantia.garantiaLegal)
      linhas.push("")

      if (servicoIds.length > 0) {
        linhas.push("CONDIÇÕES ESPECÍFICAS DO SERVIÇO:")
        servicoIds.forEach((id) => {
          const categoria = getGarantiaParaServico(id)
          if (categoria) {
            linhas.push("")
            linhas.push(`• ${categoria.servico}:`)
            linhas.push(`  ${categoria.detalhes}`)
          }
        })
        linhas.push("")
      }

      const exclusao = getGarantiaParaServico("perda_garantia")
      if (exclusao) {
        linhas.push("EXCLUSÕES DE GARANTIA:")
        linhas.push(exclusao.detalhes)
      }

      const nomeFantasia =
        (empRodape.nomeFantasia || "").trim() || configPadrao.empresa.nomeFantasia
      const razaoSocial =
        (empRodape.razaoSocial || "").trim() || configPadrao.empresa.razaoSocial
      const cnpj = (empRodape.cnpj || "").trim() || configPadrao.empresa.cnpj
      const telefone =
        (config.empresa.contato.telefone || "").trim() || configPadrao.empresa.contato.telefone
      const wa =
        (config.empresa.contato.whatsapp || "").trim() || configPadrao.empresa.contato.whatsapp
      linhas.push("")
      linhas.push("---")
      linhas.push(nomeFantasia)
      linhas.push(`Razão Social: ${razaoSocial}`)
      linhas.push(`CNPJ: ${cnpj}`)
      linhas.push(enderecoCompletoDeEmpresa(empRodape.endereco))
      linhas.push(`Telefone: ${telefone}`)
      linhas.push(`WhatsApp: ${wa}`)

      return linhas.join("\n")
    },
    [config.termosGarantia, config.empresa.contato, getGarantiaParaServico]
  )

  return (
    <ConfigContext.Provider value={{
      config,
      configHydrated: configPersistOk,
      updateEmpresa,
      updateTermosGarantia,
      updateCategoriaGarantia,
      addCategoriaGarantia,
      removeCategoriaGarantia,
      resetConfig,
      getEnderecoCompleto,
      getGarantiaParaServico,
      gerarTextoGarantiaOS,
      updateAtalhosRapidosPDV,
      updatePdv,
      updateMinhasLojas,
      updateAssinatura
    }}>
      {children}
    </ConfigContext.Provider>
  )
}

export function useConfigEmpresa() {
  const context = useContext(ConfigContext)
  if (!context) {
    // Retorna valores padrão se usado fora do provider
    return {
      config: configPadrao,
      configHydrated: false,
      updateEmpresa: () => {},
      updateTermosGarantia: () => {},
      updateCategoriaGarantia: () => {},
      addCategoriaGarantia: () => {},
      removeCategoriaGarantia: () => {},
      resetConfig: () => {},
      getEnderecoCompleto: () => {
        const { rua, numero, bairro, cidade, estado, cep } = configPadrao.empresa.endereco
        return `${rua}, ${numero} - ${bairro}, ${cidade}/${estado} - CEP: ${cep}`
      },
      getGarantiaParaServico: (servicoId: string) => 
        configPadrao.termosGarantia.categorias.find(cat => cat.id === servicoId),
      gerarTextoGarantiaOS: () => "",
      updateAtalhosRapidosPDV: () => {},
      updatePdv: () => {},
      updateMinhasLojas: () => {},
      updateAssinatura: () => {},
    }
  }
  return context
}
