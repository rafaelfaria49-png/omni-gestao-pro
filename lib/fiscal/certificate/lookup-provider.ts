/**
 * Contrato de enriquecimento cadastral fiscal (GOAL-016B · item 4).
 *
 * Port SUBSTITUÍVEL para consultar dados cadastrais de um CNPJ/UF. Mesmo padrão dos demais ports
 * fiscais (cofre, provider de emissão): o chamador não sabe qual fonte está por trás e recebe,
 * por campo, a ORIGEM, a DATA e o NÍVEL DE CONFIANÇA — nunca um dado "órfão".
 *
 * Estado atual do projeto: **não existe fonte automatizada aprovada para uso fiscal**. O único
 * consumo de API cadastral hoje é client-side, no cadastro de CLIENTES do CRM
 * (`components/dashboard/clientes/cadastro-clientes.tsx` → BrasilAPI), sem ADR, sem contrato de
 * confiança/auditoria e fora do escopo fiscal. Adotá-lo como fonte fiscal exige ADR próprio.
 * Por isso o provider default é o `NaoConfiguradoLookupProvider`, que responde
 * `consulta externa ainda não configurada` — sem rede, sem scraping, sem inventar dado.
 *
 * PURO: sem I/O, sem Prisma, sem `fetch`. Uma implementação concreta futura fica em módulo próprio.
 */

import type { ConfiancaCampo } from "./onboarding-types"

/** Campos que uma fonte cadastral pode devolver. Endereço/IE/CRT só entram se a fonte confirmar. */
export type FiscalLookupCampo =
  | "razaoSocial"
  | "nomeFantasia"
  | "situacaoCadastral"
  | "logradouro"
  | "numero"
  | "complemento"
  | "bairro"
  | "municipio"
  | "codigoMunicipioIbge"
  | "uf"
  | "cep"
  | "inscricaoEstadual"
  | "regimeTributario"
  | "cnae"
  | "fone"
  | "email"

/** Valor devolvido pela fonte, sempre acompanhado de procedência. */
export type FiscalLookupValor = {
  valor: string
  /** Rótulo da fonte concreta (ex.: "Receita Federal via <provider>"). */
  fonte: string
  /** ISO-8601 do momento em que a fonte respondeu. */
  obtidoEm: string
  confianca: ConfiancaCampo
}

export type FiscalIdentityLookupEntrada = {
  /** CNPJ em dígitos (14). */
  cnpj: string
  /** UF de referência (2 letras) — algumas fontes exigem para IE/regime. */
  uf: string
}

export type FiscalIdentityLookupResultado =
  | {
      status: "ok"
      fonte: string
      consultadoEm: string
      campos: Partial<Record<FiscalLookupCampo, FiscalLookupValor>>
    }
  | {
      /** Nenhuma fonte automatizada aprovada está configurada. */
      status: "nao_configurado"
      mensagem: string
    }
  | {
      status: "nao_encontrado"
      fonte: string
      consultadoEm: string
      mensagem: string
    }
  | {
      status: "indisponivel"
      fonte: string
      mensagem: string
    }

/** Port do enriquecimento cadastral. Implementações concretas são plugáveis por ADR. */
export interface FiscalIdentityLookupProvider {
  /** Rótulo da fonte (aparece na trilha de origem dos campos). */
  readonly nome: string
  consultar(entrada: FiscalIdentityLookupEntrada): Promise<FiscalIdentityLookupResultado>
}

export const LOOKUP_NAO_CONFIGURADO_MENSAGEM =
  "Consulta externa ainda não configurada — nenhuma fonte cadastral aprovada para uso fiscal."

/**
 * Provider default: declara honestamente que não há fonte configurada. Não faz rede, não faz
 * scraping, não devolve campo algum. O onboarding cai no pré-preenchimento pelos dados da loja.
 */
export class NaoConfiguradoLookupProvider implements FiscalIdentityLookupProvider {
  readonly nome = "nao-configurado"

  async consultar(_entrada: FiscalIdentityLookupEntrada): Promise<FiscalIdentityLookupResultado> {
    void _entrada
    return { status: "nao_configurado", mensagem: LOOKUP_NAO_CONFIGURADO_MENSAGEM }
  }
}

/**
 * Resolve o provider de enriquecimento cadastral em uso. Enquanto não houver fonte aprovada por
 * ADR, devolve sempre o `NaoConfiguradoLookupProvider` (fail-closed quanto a dado externo).
 */
export function resolveFiscalIdentityLookupProvider(): FiscalIdentityLookupProvider {
  return new NaoConfiguradoLookupProvider()
}
