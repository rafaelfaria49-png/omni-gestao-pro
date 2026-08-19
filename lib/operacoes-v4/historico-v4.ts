// ============================================================================
// Operações V4 — Histórico transversal da OS (adapter puro).
// ----------------------------------------------------------------------------
// GOAL OPS-V4-DASHBOARD-HISTORICO-FINAL-017.
// Sem I/O. Consolida timeline da OS + aparelho (V3) + cliente + retornos/garantia
// + evidências (anexos/assinatura). Nada inventa OS relacionada.
// ============================================================================

import type { OrdemServico } from "@/types/os";
import { construirHistoricoAparelhoV3, type HistoricoOSAparelhoV3 } from "@/lib/operacoes-v3/historico-aparelho-model";
import { lerEntregaV3, lerGarantiaV3, lerRetornosV3, lerVinculoRetornoV3 } from "@/lib/operacoes-v3/pos-venda-model";
import { statusMetaV3, statusV3FromOS } from "@/lib/operacoes-v3/status-machine";
import { resolverIdentidadeAparelhoV4 } from "@/lib/operacoes-v4/identidade-aparelho";

export interface HistoricoOsRelacionadaV4 {
  osId: string;
  codigo: string;
  statusLabel: string;
  quando: string;
  papel: "atual" | "aparelho" | "cliente" | "retorno" | "origem";
  extra: string;
}

export interface HistoricoTransversalV4 {
  temOs: boolean;
  cliente: string;
  telefone: string;
  aparelho: string;
  imei: string;
  serial: string;
  osAtual: string;
  aparelhoTemHistorico: boolean;
  relacionadas: HistoricoOsRelacionadaV4[];
  garantiaLabel: string;
  retornosAbertos: number;
  temAssinatura: boolean;
  temAnexos: boolean;
}

function txt(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function clienteChave(os: OrdemServico): string {
  const id = txt(os.clienteId) || txt(os.cliente?.id);
  if (id) return `id:${id}`;
  const tel = txt(os.cliente?.telefone) || txt(os.cliente?.whatsapp);
  const nome = txt(os.cliente?.nome).toLowerCase();
  if (tel) return `tel:${tel.replace(/\D/g, "")}`;
  if (nome) return `nome:${nome}`;
  return "";
}

export function buildHistoricoTransversalV4(
  os: OrdemServico | null | undefined,
  todas: OrdemServico[],
  now: Date = new Date(),
): HistoricoTransversalV4 {
  if (!os) {
    return {
      temOs: false,
      cliente: "",
      telefone: "",
      aparelho: "",
      imei: "",
      serial: "",
      osAtual: "",
      aparelhoTemHistorico: false,
      relacionadas: [],
      garantiaLabel: "",
      retornosAbertos: 0,
      temAssinatura: false,
      temAnexos: false,
    };
  }

  const ident = resolverIdentidadeAparelhoV4(os);
  const aparelhoLabel = [ident.marca.value, ident.modelo.value].filter(Boolean).join(" ") || ident.tipo.value;
  const aparelhoHist = construirHistoricoAparelhoV3(os, todas, now);
  const entrega = lerEntregaV3(os);
  const garantia = lerGarantiaV3(os, now);
  const retornos = lerRetornosV3(os);
  const vinculo = lerVinculoRetornoV3(os);
  const chaveCli = clienteChave(os);
  const seen = new Set<string>([os.id]);
  const relacionadas: HistoricoOsRelacionadaV4[] = [];

  const push = (row: HistoricoOsRelacionadaV4) => {
    if (!row.osId || seen.has(row.osId)) return;
    seen.add(row.osId);
    relacionadas.push(row);
  };

  for (const linha of aparelhoHist.anteriores) {
    push(deLinhaAparelho(linha));
  }

  if (chaveCli) {
    for (const outra of todas) {
      if (outra.id === os.id) continue;
      if (clienteChave(outra) !== chaveCli) continue;
      push({
        osId: outra.id,
        codigo: txt(outra.codigo) || "OS",
        statusLabel: statusMetaV3(statusV3FromOS(outra)).label,
        quando: txt(outra.criadoEm),
        papel: "cliente",
        extra: "Mesmo cliente",
      });
    }
  }

  if (vinculo?.osOrigemId) {
    push({
      osId: vinculo.osOrigemId,
      codigo: vinculo.osOrigemCodigo || "OS original",
      statusLabel: "OS original",
      quando: "",
      papel: "origem",
      extra: "Atendimento de retorno",
    });
  }
  for (const ret of retornos) {
    const alvo = ret.osRetornoId || ret.osOriginalId;
    if (!alvo || alvo === os.id) continue;
    push({
      osId: alvo,
      codigo: ret.osRetornoCodigo || ret.osOriginalCodigo || "OS",
      statusLabel: ret.status === "aberto" ? "Retorno aberto" : "Retorno",
      quando: ret.criadoEm,
      papel: "retorno",
      extra: ret.motivo || "Retorno em garantia",
    });
  }

  const anexos = Array.isArray(os.anexos) ? os.anexos.length : 0;
  const fotosEntrada = Array.isArray((os as { provaEntradaV3?: { fotos?: unknown[] } }).provaEntradaV3?.fotos)
    ? ((os as { provaEntradaV3?: { fotos?: unknown[] } }).provaEntradaV3?.fotos?.length ?? 0)
    : 0;

  return {
    temOs: true,
    cliente: txt(os.cliente?.nome) || "Cliente não informado",
    telefone: txt(os.cliente?.telefone) || txt(os.cliente?.whatsapp),
    aparelho: aparelhoLabel || "Aparelho não informado",
    imei: ident.imei.value,
    serial: ident.serial.value,
    osAtual: txt(os.codigo) || os.id,
    aparelhoTemHistorico: aparelhoHist.temHistorico,
    relacionadas,
    garantiaLabel: garantia.situacao === "nenhuma" ? "" : garantia.label || garantia.situacao,
    retornosAbertos: retornos.filter((r) => r.status === "aberto").length,
    temAssinatura: !!entrega.assinaturaRetiradaDataUrl || !!txt(os.retirada?.assinaturaTexto),
    temAnexos: anexos + fotosEntrada > 0,
  };
}

function deLinhaAparelho(linha: HistoricoOSAparelhoV3): HistoricoOsRelacionadaV4 {
  return {
    osId: linha.osId,
    codigo: linha.codigo,
    statusLabel: linha.statusLabel,
    quando: linha.entregueEm || linha.criadoEm || "",
    papel: "aparelho",
    extra: linha.defeito || "Mesmo aparelho",
  };
}

export function montarAuditoriaExportV4(input: {
  codigo: string;
  cliente: string;
  aparelho: string;
  eventos: Array<{ text: string; meta: string }>;
}): string {
  const linhas = [
    `Auditoria operacional — ${input.codigo}`,
    `Cliente: ${input.cliente}`,
    `Aparelho: ${input.aparelho}`,
    "",
    ...input.eventos.map((ev) => `- ${ev.text} (${ev.meta})`),
  ];
  return linhas.join("\n");
}
