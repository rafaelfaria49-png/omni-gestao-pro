// ============================================================================
// Operações V4 — Pendências de entrada (GOAL OPS-V4-ORC-COMPLETAR-ENTRADA-027)
// ----------------------------------------------------------------------------
// Módulo PURO (sem I/O, sem React). Deriva, 100% a partir da OS real, quais
// blocos de dados de entrada/recepção já têm contrato V3 real (já chamado
// pela V4 em `EntradaStage.tsx`) e ainda estão vazios. NÃO cria contrato novo,
// NÃO inventa estado: cada `preenchido` é lido de um campo que só existe
// depois de uma action V3 já existente ter sido chamada.
//
// Fonte de cada item (contrato V3 já wired na V4):
//   • dados-basicos         ← lerDadosBasicosV3(os).recebidoPor      · salvarDadosBasicosOSV3
//   • identificacao         ← lerProvaEntradaV3(os).identificacao    · salvarIdentificacaoV3
//   • estado-avarias-acesso ← provaEntradaCriadaV3(os)               · salvarProvaEntradaV3
//   • checklist             ← os.checklist (raw, não o reader com default) · salvarChecklistEntradaV3
//   • acessorios            ← lerProvaEntradaV3(os).acessorios       · salvarAcessoriosEntradaV3
//   • fotos                 ← lerProvaEntradaV3(os).fotos / assinatura · adicionarFotoEntradaV3 / salvarAssinaturaClienteV3
//
// `estadoFisico` sozinho não serve de sinal: o valor padrão de cada componente
// já nasce "ok" (ver `estadoFisicoPadraoV3`), então usar isso daria falso
// "preenchido" numa OS que nunca teve entrada real. `provaEntradaCriadaV3` é o
// sinal honesto de que o botão "Salvar estado, avarias e acesso" já foi usado.
//
// `checklist` também não pode usar `lerChecklistEntradaV3` (o reader): ele
// sempre devolve a lista padrão com "não testado" quando `os.checklist` está
// vazio, então "length > 0" no reader nunca seria 0. O sinal honesto é o campo
// bruto da OS.
// ============================================================================

import type { OrdemServico } from "@/types/os";
import { lerDadosBasicosV3 } from "@/lib/operacoes-v3/dados-basicos-model";
import { lerProvaEntradaV3, provaEntradaCriadaV3 } from "@/lib/operacoes-v3/prova-entrada-model";

export interface PendenciaEntradaV4 {
  /** Identificador estável do bloco — usado pela UI para focar o card real. */
  chave: "dados-basicos" | "identificacao" | "estado-avarias-acesso" | "checklist" | "acessorios" | "fotos";
  rotulo: string;
  preenchido: boolean;
  /** false = sem contrato V3 real de escrita ainda (ex.: upload de fotos) — informativo, nunca acionável. */
  temContrato: boolean;
}

function algumaStringPreenchida(valores: (string | undefined)[]): boolean {
  return valores.some((v) => typeof v === "string" && v.trim() !== "");
}

/**
 * Deriva a lista de pendências de entrada da OS real. Nunca fabrica dado: cada
 * `preenchido` reflete um campo que só existe depois de uma action V3 já
 * chamada pela V4 (ver `EntradaWorkspace.tsx`).
 */
export function derivarPendenciasEntradaV4(os: OrdemServico | null | undefined): PendenciaEntradaV4[] {
  if (!os) return [];

  const dadosBasicos = lerDadosBasicosV3(os);
  const prova = lerProvaEntradaV3(os);
  const checklistRaw = (os as unknown as { checklist?: unknown }).checklist;
  const checklistSalvo = Array.isArray(checklistRaw) && checklistRaw.length > 0;
  const acessoriosPresentes = (prova.acessorios ?? []).some((a) => a.presente === true);
  const eq = os.equipamento;
  const identificacaoPreenchida = algumaStringPreenchida([
    prova.identificacao.imei,
    prova.identificacao.serial,
    prova.identificacao.operadora,
    prova.identificacao.modelo,
    prova.identificacao.cor,
    eq?.modelo,
    eq?.numeroSerie,
  ]);
  const fotos = prova.fotos ?? [];
  const evidenciasPreenchidas = fotos.length > 0 || Boolean(prova.assinaturaCliente?.dataUrl);

  return [
    {
      chave: "dados-basicos",
      rotulo: "Dados básicos da recepção",
      preenchido: dadosBasicos.recebidoPor.trim() !== "",
      temContrato: true,
    },
    {
      chave: "identificacao",
      rotulo: "Identificação do aparelho",
      preenchido: identificacaoPreenchida,
      temContrato: true,
    },
    {
      chave: "estado-avarias-acesso",
      rotulo: "Estado físico, avarias e acesso",
      preenchido: provaEntradaCriadaV3(os),
      temContrato: true,
    },
    {
      chave: "checklist",
      rotulo: "Checklist do aparelho",
      preenchido: checklistSalvo,
      temContrato: true,
    },
    {
      chave: "acessorios",
      rotulo: "Acessórios recebidos",
      preenchido: acessoriosPresentes,
      temContrato: true,
    },
    {
      chave: "fotos",
      rotulo: "Fotos e assinatura da entrada",
      preenchido: evidenciasPreenchidas,
      temContrato: true,
    },
  ];
}

/** Progresso honesto: só conta itens com contrato real (fotos nunca entra). */
export function progressoPendenciasEntradaV4(pendencias: PendenciaEntradaV4[]): { preenchidos: number; total: number } {
  const acionaveis = pendencias.filter((p) => p.temContrato);
  return { preenchidos: acionaveis.filter((p) => p.preenchido).length, total: acionaveis.length };
}
