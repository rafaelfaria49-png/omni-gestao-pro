// ============================================================================
// Operações V4 — Nova OS · mapeamento PURO do formulário V4 → NovaOSDraftV3.
// ----------------------------------------------------------------------------
// Módulo PURO (sem I/O, sem React, sem Prisma). Converte os campos coletados pelo
// modal "Nova OS" da Operações V4 no rascunho canônico da V3 (`NovaOSDraftV3`),
// reaproveitando `novaOSDraftVazioV3()` como base (defaults de recepção/pagamento/
// garantia). A criação real é feita depois por `criarOSEnterpriseV3(storeId, draft)`
// — esta função NÃO persiste nada e NÃO valida (use `validarNovaOSDraftV3`).
//
// Escopo do slice 1 (OPS-V4-NOVA-OS-REAL-001): apenas os campos mínimos para abrir
// uma OS — cliente (existente OU novo), equipamento (tipo/marca/modelo/IMEI),
// defeito, observações, recebido por e origem. Itens/peças/serviços, pagamento,
// garantia e acessórios ficam nos defaults (slices posteriores).
// ============================================================================

import {
  novaOSDraftVazioV3,
  type NovaOSClienteKindV3,
  type NovaOSDraftV3,
  type NovaOSOrigemV3,
} from "@/lib/operacoes-v3/nova-os-model";

/** Chave de tipo de equipamento usada pelos botões do modal V4. */
export type NovaOSEquipV4 = "celular" | "tablet" | "notebook" | "videogame" | "outro";

/** Origem da recepção no modal V4 — mesma vocabulário da V3 (mapeamento 1:1). */
export type NovaOSOrigemV4 = NovaOSOrigemV3;

/** Cliente existente selecionado pela busca real (read-only) da loja ativa. */
export interface NovaOSClienteExistenteV4 {
  id: string;
  nome: string;
  telefone?: string;
  documento?: string;
}

/** Campos do cliente novo (usados quando nenhum cliente existente está selecionado). */
export interface NovaOSClienteNovoV4 {
  nome: string;
  telefone?: string;
  documento?: string;
  email?: string;
  tipo?: NovaOSClienteKindV3;
}

export type TipoEntradaOSV4 = "servico_autorizado" | "precisa_diagnostico" | "retorno_garantia";

/** Forma bruta do formulário do modal "Nova OS" da V4. */
export interface NovaOSFormV4 {
  /** Cliente existente — tem prioridade sobre os campos de cliente novo. */
  clienteExistente?: NovaOSClienteExistenteV4 | null;
  clienteNovo: NovaOSClienteNovoV4;
  equipamentoTipo: NovaOSEquipV4;
  marca: string;
  modelo: string;
  imei?: string;
  cor?: string;
  defeitoRelatado: string;
  observacoes?: string;
  recebidoPor?: string;
  origem: NovaOSOrigemV4;
  tipoEntrada?: TipoEntradaOSV4;
  prioridade?: "baixa" | "media" | "alta";
  localFisico?: "balcao" | "bancada" | "aguardando_diagnostico";
  previsaoEntrega?: string;
  servicoAutorizado?: {
    descricao: string;
    valor: number;
    custo: number;
    garantiaDias: number;
    prazoTexto?: string;
  } | null;
}

/** Tipo de equipamento (chave V4) → rótulo canônico da V3 (`TIPO_EQUIPAMENTO_V3`). */
const EQUIP_TIPO_LABEL: Record<NovaOSEquipV4, string> = {
  celular: "Smartphone",
  tablet: "Tablet",
  notebook: "Notebook",
  videogame: "Console",
  outro: "Outro",
};

export function equipTipoLabelV4(tipo: NovaOSEquipV4): string {
  return EQUIP_TIPO_LABEL[tipo] ?? "Equipamento";
}

/** Trim → string não-vazia ou undefined (não inventa valor). */
function clean(value: string | undefined | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length ? s : undefined;
}

/**
 * Converte o formulário V4 no rascunho canônico da V3. Não valida nem persiste.
 * `now` é injetável para testes determinísticos (default = agora).
 */
export function buildNovaOSDraftFromFormV4(form: NovaOSFormV4, now: Date = new Date()): NovaOSDraftV3 {
  const base = novaOSDraftVazioV3(now);

  const existenteId = clean(form.clienteExistente?.id);
  const cliente: NovaOSDraftV3["cliente"] = existenteId
    ? {
        id: existenteId,
        nome: clean(form.clienteExistente?.nome) ?? "",
        telefone: clean(form.clienteExistente?.telefone),
        documento: clean(form.clienteExistente?.documento),
        tipo: "PF",
      }
    : {
        nome: clean(form.clienteNovo?.nome) ?? "",
        telefone: clean(form.clienteNovo?.telefone),
        documento: clean(form.clienteNovo?.documento),
        email: clean(form.clienteNovo?.email),
        tipo: form.clienteNovo?.tipo ?? "PF",
      };

  const origem: NovaOSOrigemV4 =
    form.tipoEntrada === "retorno_garantia" ? (form.origem === "garantia" ? "garantia" : "retorno") : form.origem;

  const serv = form.tipoEntrada === "servico_autorizado" && form.servicoAutorizado?.descricao.trim() && form.servicoAutorizado.valor > 0
    ? form.servicoAutorizado
    : null;

  const itens = serv
    ? [
        {
          id: "autorizado",
          categoria: "servico" as const,
          descricao: serv.descricao.trim(),
          quantidade: 1,
          custoUnitario: Math.max(0, serv.custo),
          valorUnitario: Math.max(0, serv.valor),
          kind: "cobrado" as const,
          baixaEstoque: false,
          garantiaDias: serv.garantiaDias > 0 ? serv.garantiaDias : undefined,
        },
      ]
    : base.itens;

  return {
    ...base,
    cliente,
    equipamento: {
      ...base.equipamento,
      tipo: equipTipoLabelV4(form.equipamentoTipo),
      marca: clean(form.marca) ?? "",
      modelo: clean(form.modelo) ?? "",
      imei: clean(form.imei),
    },
    recepcao: {
      ...base.recepcao,
      origem,
      recebidoPor: clean(form.recebidoPor),
      prioridade: form.prioridade ?? base.recepcao.prioridade,
      localFisico: form.localFisico ?? base.recepcao.localFisico,
      previsaoEntrega: clean(form.previsaoEntrega) ?? base.recepcao.previsaoEntrega,
    },
    problema: {
      ...base.problema,
      defeitoRelatado: clean(form.defeitoRelatado) ?? "",
      observacoesInternas: clean(form.observacoes),
      condicaoAparelho: clean(form.cor),
    },
    itens,
    garantia: serv?.garantiaDias
      ? { ...base.garantia, prazoDias: serv.garantiaDias }
      : base.garantia,
  };
}
