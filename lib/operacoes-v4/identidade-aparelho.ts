// ============================================================================
// Operações V4 — identidade canônica do aparelho
// (GOAL OPS-V4-PIPELINE-ENTRADA-NAV-SIMPLIFY-002).
// ----------------------------------------------------------------------------
// Uma fonte efetiva para a identidade operacional atual. `os.equipamento` é o
// cadastro vivo (abertura + edições). `provaEntradaV3.identificacao` é snapshot
// / fallback legado. Nunca inventa valor.
// ============================================================================

import type { OrdemServico } from "@/types/os";
import { lerDadosBasicosV3 } from "@/lib/operacoes-v3/dados-basicos-model";
import { lerProvaEntradaV3 } from "@/lib/operacoes-v3/prova-entrada-model";

export type CampoIdentidadeAparelhoV4 =
  | "tipo"
  | "marca"
  | "modelo"
  | "imei"
  | "serial"
  | "cor"
  | "operadora";

export type FonteIdentidadeAparelhoV4 = "equipamento" | "prova" | "abertura" | "ausente";

export interface IdentidadeAparelhoCampoV4 {
  value: string;
  source: FonteIdentidadeAparelhoV4;
  informedAtOpening: boolean;
}

export interface IdentidadeAparelhoV4 {
  tipo: IdentidadeAparelhoCampoV4;
  marca: IdentidadeAparelhoCampoV4;
  modelo: IdentidadeAparelhoCampoV4;
  imei: IdentidadeAparelhoCampoV4;
  serial: IdentidadeAparelhoCampoV4;
  cor: IdentidadeAparelhoCampoV4;
  operadora: IdentidadeAparelhoCampoV4;
}

function txt(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function field(value: string, source: FonteIdentidadeAparelhoV4, informedAtOpening: boolean): IdentidadeAparelhoCampoV4 {
  return { value, source: value ? source : "ausente", informedAtOpening: informedAtOpening && !!value };
}

/**
 * Resolve a identidade operacional atual do aparelho.
 * Preferência: equipamento (cadastro vivo) → prova de entrada (legado/snapshot)
 * → campos de abertura (defeito/condição).
 */
export function resolverIdentidadeAparelhoV4(os: OrdemServico | null | undefined): IdentidadeAparelhoV4 {
  const eq = os?.equipamento;
  const prova = lerProvaEntradaV3(os ?? null).identificacao;
  const condicao = txt((os as { problema?: { condicaoAparelho?: unknown } } | null | undefined)?.problema?.condicaoAparelho);

  const tipoEq = txt(eq?.tipo);
  const marcaEq = txt(eq?.marca);
  const modeloEq = txt(eq?.modelo);
  const imeiEq = txt(eq?.numeroSerie);
  const modeloProva = txt(prova.modelo);
  const imeiProva = txt(prova.imei);
  const serialProva = txt(prova.serial);
  const corProva = txt(prova.cor);
  const operadoraProva = txt(prova.operadora);

  return {
    tipo: field(tipoEq, "equipamento", !!tipoEq),
    marca: field(marcaEq, "equipamento", !!marcaEq),
    modelo: field(modeloEq || modeloProva, modeloEq ? "equipamento" : "prova", !!modeloEq),
    imei: field(imeiEq || imeiProva, imeiEq ? "equipamento" : "prova", !!imeiEq),
    serial: field(serialProva, "prova", false),
    cor: field(corProva || condicao, corProva ? "prova" : "abertura", !!condicao && !corProva),
    operadora: field(operadoraProva, "prova", false),
  };
}

export function identidadeAtualV4(os: OrdemServico | null | undefined): Record<CampoIdentidadeAparelhoV4, string> {
  const id = resolverIdentidadeAparelhoV4(os);
  return {
    tipo: id.tipo.value,
    marca: id.marca.value,
    modelo: id.modelo.value,
    imei: id.imei.value,
    serial: id.serial.value,
    cor: id.cor.value,
    operadora: id.operadora.value,
  };
}

export interface AberturaRecepcionV4 {
  defeitoRelatado: string;
  origem: string;
  recebidoPor: string;
}

export function lerAberturaRecepcionV4(os: OrdemServico | null | undefined): AberturaRecepcionV4 {
  const dados = lerDadosBasicosV3(os ?? null);
  return {
    defeitoRelatado: dados.defeitoRelatado,
    origem: dados.origem,
    recebidoPor: dados.recebidoPor,
  };
}

/**
 * Espelha modelo/IMEI no cadastro vivo do aparelho sem apagar tipo/marca.
 * Serial/cor/operadora continuam no snapshot da prova.
 */
export function aplicarIdentidadeNoEquipamentoV4(
  equipamento: unknown,
  identidade: { modelo?: string; imei?: string },
): Record<string, unknown> {
  const atual = equipamento && typeof equipamento === "object" ? { ...(equipamento as Record<string, unknown>) } : {};
  const modelo = txt(identidade.modelo);
  const imei = txt(identidade.imei);
  if (modelo) atual.modelo = modelo;
  if (imei) atual.numeroSerie = imei;
  return atual;
}
