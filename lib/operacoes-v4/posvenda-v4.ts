import type { EventoTimeline, OrdemServico } from "@/types/os";
import {
  lerEntregaV3,
  lerGarantiaV3,
  lerRetornosV3,
  type GarantiaSituacaoV3,
  type RetornoV3,
} from "@/lib/operacoes-v3/pos-venda-model";
import { termoGarantiaDaOSV3 } from "@/lib/operacoes-v3/print-model";
import { statusV3FromOS } from "@/lib/operacoes-v3/status-machine";

export type PosVendaToneV4 = "success" | "info" | "warn" | "danger" | "neutro";

export interface GarantiaPosVendaV4 {
  temGarantia: boolean;
  situacao: GarantiaSituacaoV3;
  situacaoLabel: string;
  tone: PosVendaToneV4;
  label: string;
  prazoDias: number;
  semCobertura: boolean;
  inicio?: string;
  vencimento?: string;
  diasRestantes?: number;
  origem?: string;
  cobertura: string[];
  observacoes?: string;
}

export type ElegibilidadeRetornoV4Id =
  | "dentro_garantia"
  | "fora_garantia"
  | "garantia_nao_informada"
  | "retorno_aberto"
  | "os_nao_entregue"
  | "condicao_nao_determinada";

export interface ElegibilidadeRetornoV4 {
  id: ElegibilidadeRetornoV4Id;
  label: string;
  descricao: string;
  tone: PosVendaToneV4;
  /** O motor V3 aceita retorno fora/sem garantia; só um retorno já aberto bloqueia a CTA. */
  podeRegistrar: boolean;
}

export interface TimelinePosVendaV4 {
  id: string;
  tipo: EventoTimeline["tipo"];
  texto: string;
  autor?: string;
  criadoEm: string;
}

export interface PosVendaV4 {
  garantia: GarantiaPosVendaV4;
  elegibilidade: ElegibilidadeRetornoV4;
  retornoAberto?: RetornoV3;
  retornos: RetornoV3[];
  podeAbrirRetorno: boolean;
  podeFinalizarRetorno: boolean;
  historico: RetornoV3[];
  timeline: TimelinePosVendaV4[];
  headerLabel: string;
}

export const EMPTY_POSVENDA_V4: PosVendaV4 = {
  garantia: {
    temGarantia: false,
    situacao: "nenhuma",
    situacaoLabel: "Sem garantia registrada",
    tone: "neutro",
    label: "",
    prazoDias: 0,
    semCobertura: false,
    cobertura: [],
  },
  elegibilidade: {
    id: "garantia_nao_informada",
    label: "Garantia não informada",
    descricao: "Selecione uma OS para consultar a condição do retorno.",
    tone: "neutro",
    podeRegistrar: false,
  },
  retornos: [],
  podeAbrirRetorno: false,
  podeFinalizarRetorno: false,
  historico: [],
  timeline: [],
  headerLabel: "Sem garantia",
};

const TONE_GARANTIA: Record<GarantiaSituacaoV3, PosVendaToneV4> = {
  nenhuma: "neutro",
  sem_garantia: "neutro",
  prevista: "info",
  ativa: "success",
  vencida: "warn",
};

const LABEL_GARANTIA: Record<GarantiaSituacaoV3, string> = {
  nenhuma: "Sem garantia registrada",
  sem_garantia: "Sem cobertura",
  prevista: "Prevista",
  ativa: "Vigente",
  vencida: "Vencida",
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function origemGarantia(os: OrdemServico): string | undefined {
  const raw = os as OrdemServico & {
    aberturaV3?: { garantiaPrevista?: unknown };
  };
  if (raw.aberturaV3?.garantiaPrevista) return "Garantia definida na OS";
  if (os.garantia?.inicioEm || os.garantia?.fimEm || os.garantia?.ativa) return "Garantia registrada na OS";
  if (os.garantiasOperacionais?.length) return "Garantia operacional registrada";
  return undefined;
}

export function buildGarantiaPosVendaV4(os: OrdemServico, now: Date = new Date()): GarantiaPosVendaV4 {
  const garantia = lerGarantiaV3(os, now);
  const termo = garantia.temGarantia ? termoGarantiaDaOSV3(os) : null;
  return {
    temGarantia: garantia.temGarantia,
    situacao: garantia.situacao,
    situacaoLabel: LABEL_GARANTIA[garantia.situacao],
    tone: TONE_GARANTIA[garantia.situacao],
    label: garantia.label,
    prazoDias: garantia.prazoDias,
    semCobertura: garantia.semCobertura,
    inicio: garantia.inicio,
    vencimento: garantia.vencimento,
    diasRestantes: garantia.diasRestantes,
    origem: origemGarantia(os),
    cobertura: termo?.cobertura ?? [],
    observacoes: termo?.observacao || undefined,
  };
}

function elegibilidadeRetorno(
  os: OrdemServico,
  garantia: GarantiaPosVendaV4,
  retornoAberto: RetornoV3 | undefined,
): ElegibilidadeRetornoV4 {
  if (retornoAberto) {
    return {
      id: "retorno_aberto",
      label: "Retorno em andamento",
      descricao: "Finalize o retorno atual antes de registrar outro.",
      tone: "warn",
      podeRegistrar: false,
    };
  }

  if (!lerEntregaV3(os).entregue) {
    return {
      id: "os_nao_entregue",
      label: "OS não entregue",
      descricao: "A cobertura ainda não iniciou. O motor V3 permite registrar o relato sem prometer garantia.",
      tone: "info",
      podeRegistrar: true,
    };
  }

  if (garantia.situacao === "ativa") {
    return {
      id: "dentro_garantia",
      label: "Dentro da garantia",
      descricao: "A garantia estava vigente na leitura atual da OS.",
      tone: "success",
      podeRegistrar: true,
    };
  }

  if (garantia.situacao === "vencida" || garantia.situacao === "sem_garantia") {
    return {
      id: "fora_garantia",
      label: "Fora da garantia",
      descricao: "O retorno pode ser registrado, mas a cobertura não é prometida.",
      tone: "warn",
      podeRegistrar: true,
    };
  }

  if (garantia.situacao === "nenhuma") {
    return {
      id: "garantia_nao_informada",
      label: "Garantia não informada",
      descricao: "O retorno pode ser registrado sem classificar a cobertura.",
      tone: "neutro",
      podeRegistrar: true,
    };
  }

  return {
    id: "condicao_nao_determinada",
    label: "Condição não determinada",
    descricao: "A garantia está prevista, mas ainda não possui vigência calculada.",
    tone: "info",
    podeRegistrar: true,
  };
}

function timelinePosVenda(os: OrdemServico): TimelinePosVendaV4[] {
  const tipos = new Set<EventoTimeline["tipo"]>(["garantia_gerada", "entrega_cliente", "retirada_confirmada"]);
  return (Array.isArray(os.timeline) ? os.timeline : [])
    .filter((evento) => tipos.has(evento.tipo))
    .slice()
    .sort((a, b) => Date.parse(b.criadoEm) - Date.parse(a.criadoEm))
    .map((evento) => ({
      id: evento.id,
      tipo: evento.tipo,
      texto: text(evento.titulo) || text(evento.conteudo) || evento.tipo,
      autor: text(evento.autor) || undefined,
      criadoEm: evento.criadoEm,
    }));
}

function headerLabel(garantia: GarantiaPosVendaV4, retornoAberto: RetornoV3 | undefined): string {
  if (retornoAberto) return "Retorno aberto";
  if (garantia.situacao === "ativa" && garantia.vencimento) return `Garantia até ${garantia.vencimento}`;
  if (garantia.situacao === "vencida") return "Garantia vencida";
  if (garantia.situacao === "prevista" && garantia.prazoDias > 0) return `Garantia ${garantia.prazoDias} dias`;
  if (garantia.situacao === "sem_garantia") return "Sem cobertura";
  return "Sem garantia";
}

export function buildPosVendaV4(os: OrdemServico, now: Date = new Date()): PosVendaV4 {
  const garantia = buildGarantiaPosVendaV4(os, now);
  const retornos = lerRetornosV3(os);
  const retornoAberto = retornos.find((retorno) => retorno.status === "aberto");
  const elegibilidade = elegibilidadeRetorno(os, garantia, retornoAberto);
  return {
    garantia,
    elegibilidade,
    retornoAberto,
    retornos,
    podeAbrirRetorno: !!text(os.id) && elegibilidade.podeRegistrar,
    podeFinalizarRetorno: !!retornoAberto,
    historico: retornos,
    timeline: timelinePosVenda(os),
    headerLabel: headerLabel(garantia, retornoAberto),
  };
}

export type GarantiaPortfolioFiltroV4 = "todas" | "vigentes" | "vencendo" | "vencidas" | "com_retorno";

export interface GarantiaPortfolioItemV4 {
  osId: string;
  codigo: string;
  cliente: string;
  aparelho: string;
  vencimento?: string;
  diasRestantes?: number;
  situacao: GarantiaSituacaoV3;
  situacaoLabel: string;
  tone: PosVendaToneV4;
  retornoAberto: boolean;
  busca: string;
}

export interface GarantiasPortfolioV4 {
  itens: GarantiaPortfolioItemV4[];
  vigentes: number;
  vencendo: number;
  vencidas: number;
  retornosAbertos: number;
  vencendoDias: number;
}

export function buildGarantiasPortfolioV4(
  ordens: OrdemServico[],
  opts: { now?: Date; vencendoDias?: number } = {},
): GarantiasPortfolioV4 {
  const now = opts.now ?? new Date();
  const vencendoDias = opts.vencendoDias ?? 7;
  const itens = (ordens ?? []).flatMap((os): GarantiaPortfolioItemV4[] => {
    const posVenda = buildPosVendaV4(os, now);
    const garantia = posVenda.garantia;
    if (!garantia.temGarantia) return [];
    const cliente = text(os.cliente?.nome) || "Cliente não identificado";
    const aparelho = [text(os.equipamento?.marca), text(os.equipamento?.modelo)].filter(Boolean).join(" ") || text(os.equipamento?.tipo) || "Equipamento";
    const codigo = text(os.codigo) || os.id;
    return [{
      osId: os.id,
      codigo,
      cliente,
      aparelho,
      vencimento: garantia.vencimento,
      diasRestantes: garantia.diasRestantes,
      situacao: garantia.situacao,
      situacaoLabel: garantia.situacaoLabel,
      tone: garantia.tone,
      retornoAberto: !!posVenda.retornoAberto,
      busca: `${codigo} ${cliente} ${aparelho}`.toLocaleLowerCase("pt-BR"),
    }];
  });

  itens.sort((a, b) => {
    if (a.retornoAberto !== b.retornoAberto) return a.retornoAberto ? -1 : 1;
    if (!a.vencimento) return 1;
    if (!b.vencimento) return -1;
    return Date.parse(a.vencimento) - Date.parse(b.vencimento);
  });

  return {
    itens,
    vigentes: itens.filter((item) => item.situacao === "ativa").length,
    vencendo: itens.filter((item) => item.situacao === "ativa" && typeof item.diasRestantes === "number" && item.diasRestantes <= vencendoDias).length,
    vencidas: itens.filter((item) => item.situacao === "vencida").length,
    retornosAbertos: itens.filter((item) => item.retornoAberto).length,
    vencendoDias,
  };
}

export function filtrarGarantiasPortfolioV4(
  portfolio: GarantiasPortfolioV4,
  filtro: GarantiaPortfolioFiltroV4,
  busca = "",
): GarantiaPortfolioItemV4[] {
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  return portfolio.itens.filter((item) => {
    if (termo && !item.busca.includes(termo)) return false;
    if (filtro === "vigentes") return item.situacao === "ativa";
    if (filtro === "vencendo") return item.situacao === "ativa" && typeof item.diasRestantes === "number" && item.diasRestantes <= portfolio.vencendoDias;
    if (filtro === "vencidas") return item.situacao === "vencida";
    if (filtro === "com_retorno") return item.retornoAberto;
    return true;
  });
}

/** O status é exposto só para auditoria/testes; o motor de retorno não o usa como bloqueio. */
export function statusOsNaElegibilidadeV4(os: OrdemServico): ReturnType<typeof statusV3FromOS> {
  return statusV3FromOS(os);
}
