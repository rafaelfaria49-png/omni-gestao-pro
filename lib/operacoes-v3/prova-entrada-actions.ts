"use server";

// ============================================================================
// Operações V3 — SPRINT_3E.1 · write-paths da PROVA DE ENTRADA (side-effect-free)
// ----------------------------------------------------------------------------
// Grava SOMENTE `payload.provaEntradaV3` + timeline. NÃO toca estoque/Financeiro/
// WhatsApp/Portal/V2/schema. Reusa o reader puro (`lerProvaEntradaV3`) para
// normalizar/semear. Eventos (item 7): prova_entrada_criada/atualizada (carrier
// `observacao`), foto_adicionada/removida (carrier `anexo_adicionado/removido`),
// acessorio_registrado (carrier `observacao`).
// ============================================================================

import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import type { Prisma } from "@/generated/prisma";
import type { EventoTimeline, EventoTipo, OrdemServico } from "@/types/os";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireEnterpriseWith } from "@/lib/auth/guard-enterprise";
import { assertActiveStoreId } from "@/lib/operacoes/assert-active-store";
import {
  ACESSORIOS_ENTRADA_V3,
  COMPONENTES_FISICOS_V3,
  ESTADO_FISICO_STATUS_META_V3,
  TIPOS_AVARIA_V3,
  bytesDeDataUrlV3,
  lerProvaEntradaV3,
  provaEntradaCriadaV3,
  validarAssinaturaV3,
  validarFotoEntradaV3,
  type AcessorioEntradaV3,
  type AvariaV3,
  type CategoriaFotoV3,
  type CredenciaisEntradaV3,
  type EstadoFisicoItemV3,
  type EstadoFisicoStatusV3,
  type FotoEntradaV3,
  type IdentificacaoV3,
  type ProvaEntradaV3,
} from "./prova-entrada-model";

type OSPayloadFull = OrdemServico & Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}
function uid(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `${prefix}_${crypto.randomUUID()}` : `${prefix}_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
}
function operadorLabel(session: Session | null): string {
  const u = session?.user;
  return (u?.name || u?.email || "Você").trim() || "Você";
}
function makeEvento(tipo: EventoTipo, autor: string, conteudo: string, metadata?: Record<string, unknown>): EventoTimeline {
  return { id: uid("ev"), tipo, autor, autorTipo: "usuario", conteudo, metadata, criadoEm: nowIso() };
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function carregar(storeId: string, osId: string): Promise<{ id: string; session: Session | null; payload: OSPayloadFull }> {
  const sid = (storeId ?? "").trim();
  const id = (osId ?? "").trim();
  assertActiveStoreId(sid, "Operações V3");
  if (!id) throw new Error("OS não informada.");
  const session = await auth();
  if (!session?.user?.id) throw new Error("Faça login para registrar a prova de entrada.");
  const guard = await requireEnterpriseWith(sid, (p) => p.operacoes.editarOs, "Sem permissão para editar esta OS.");
  if (!guard.ok) throw new Error(guard.error);
  const row = await prisma.ordemServico.findFirst({ where: { id, storeId: sid }, select: { id: true, payload: true } });
  if (!row) throw new Error("OS não encontrada.");
  const payload = row.payload as unknown as OSPayloadFull | null;
  if (!payload || typeof payload !== "object") throw new Error("OS sem payload compatível.");
  return { id, session, payload };
}

async function gravar(id: string, next: OSPayloadFull): Promise<OrdemServico> {
  await prisma.ordemServico.update({ where: { id }, data: { payload: next as unknown as Prisma.InputJsonValue } });
  revalidatePath("/dashboard/operacoes-v3");
  return next as unknown as OrdemServico;
}

/** Aplica a prova + evento ao payload e persiste. Define versão/criadoEm/criadoPor.
 *  `patchPayload` permite sincronizar campos legados (ex.: senhaEquipamento). */
async function persistirProva(
  id: string,
  payload: OSPayloadFull,
  prova: ProvaEntradaV3,
  operador: string,
  evento: EventoTimeline,
  patchPayload?: Record<string, unknown>,
): Promise<OrdemServico> {
  const next: OSPayloadFull = {
    ...payload,
    ...(patchPayload ?? {}),
    provaEntradaV3: {
      ...prova,
      versao: Math.max(1, prova.versao || 0) || 1,
      criadoEm: str(prova.criadoEm) || nowIso(),
      criadoPor: prova.criadoPor || operador,
      atualizadoEm: nowIso(),
    },
    timeline: [...(Array.isArray(payload.timeline) ? (payload.timeline as EventoTimeline[]) : []), evento],
    atualizadoEm: nowIso(),
  } as OSPayloadFull;
  return gravar(id, next);
}

// ----------------------------------------------------------------------------
// 1/2/4 — Estado físico + avarias + credenciais (uma única tela do prontuário)
// ----------------------------------------------------------------------------

export interface SalvarProvaEntradaInputV3 {
  estadoFisico: EstadoFisicoItemV3[];
  avarias: AvariaV3[];
  credenciais: CredenciaisEntradaV3;
}

const COMPONENTE_IDS = new Set(COMPONENTES_FISICOS_V3.map((c) => c.id));
const STATUS_IDS = new Set(Object.keys(ESTADO_FISICO_STATUS_META_V3) as EstadoFisicoStatusV3[]);
const AVARIA_IDS = new Set(TIPOS_AVARIA_V3.map((a) => a.id));

function sanitEstadoFisico(input: EstadoFisicoItemV3[]): EstadoFisicoItemV3[] {
  const porId = new Map<string, EstadoFisicoItemV3>();
  for (const it of Array.isArray(input) ? input : []) {
    if (!COMPONENTE_IDS.has(it?.componente)) continue;
    porId.set(it.componente, {
      componente: it.componente,
      status: STATUS_IDS.has(it?.status) ? it.status : "ok",
      obs: str(it?.obs) || undefined,
    });
  }
  return COMPONENTES_FISICOS_V3.map((c) => porId.get(c.id) ?? { componente: c.id, status: "ok" });
}

function sanitAvarias(input: AvariaV3[]): AvariaV3[] {
  return (Array.isArray(input) ? input : [])
    .filter((a) => AVARIA_IDS.has(a?.tipo))
    .map((a) => ({ id: str(a.id) || uid("av"), tipo: a.tipo, local: str(a.local), descricao: str(a.descricao) || undefined }));
}

function sanitCredenciais(input: CredenciaisEntradaV3): CredenciaisEntradaV3 {
  const tipo = input?.senhaTipo;
  return {
    pin: str(input?.pin) || undefined,
    senha: str(input?.senha) || undefined,
    senhaTipo: tipo === "numerica" || tipo === "texto" || tipo === "padrao" ? tipo : undefined,
    contaGoogle: str(input?.contaGoogle) || undefined,
    contaApple: str(input?.contaApple) || undefined,
    faceId: typeof input?.faceId === "boolean" ? input.faceId : undefined,
    biometria: typeof input?.biometria === "boolean" ? input.biometria : undefined,
  };
}

export async function salvarProvaEntradaV3(storeId: string, osId: string, input: SalvarProvaEntradaInputV3): Promise<OrdemServico> {
  const { id, session, payload } = await carregar(storeId, osId);
  const operador = operadorLabel(session);
  const atual = lerProvaEntradaV3(payload as unknown as OrdemServico);
  const jaCriada = provaEntradaCriadaV3(payload as unknown as OrdemServico);

  const next: ProvaEntradaV3 = {
    ...atual,
    estadoFisico: sanitEstadoFisico(input.estadoFisico),
    avarias: sanitAvarias(input.avarias),
    credenciais: sanitCredenciais(input.credenciais),
  };

  const resumo = next.estadoFisico.filter((i) => i.status !== "ok").length;
  const evento = makeEvento(
    "observacao",
    operador,
    jaCriada ? "Prova de entrada atualizada." : "Prova de entrada registrada (estado físico, avarias e credenciais).",
    { evento: jaCriada ? "prova_entrada_atualizada" : "prova_entrada_criada", avariados: resumo, avarias: next.avarias.length },
  );
  // Consolidação (item 4): a senha agora é editada aqui — sincroniza o campo legado
  // `senhaEquipamento` (lido pela impressão da OS / pad 3×3) para fonte única.
  const senha = next.credenciais.senha;
  const patch = senha
    ? { senhaEquipamento: senha, senhaEquipamentoTipo: next.credenciais.senhaTipo ?? "texto" }
    : undefined;
  return persistirProva(id, payload, next, operador, evento, patch);
}

// ----------------------------------------------------------------------------
// SPRINT_3E.2 — Identificação completa (item 1)
// ----------------------------------------------------------------------------

export async function salvarIdentificacaoV3(storeId: string, osId: string, input: IdentificacaoV3): Promise<OrdemServico> {
  const { id, session, payload } = await carregar(storeId, osId);
  const operador = operadorLabel(session);
  const atual = lerProvaEntradaV3(payload as unknown as OrdemServico);
  const next: ProvaEntradaV3 = {
    ...atual,
    identificacao: {
      imei: str(input?.imei) || undefined,
      serial: str(input?.serial) || undefined,
      operadora: str(input?.operadora) || undefined,
      modelo: str(input?.modelo) || undefined,
      cor: str(input?.cor) || undefined,
    },
  };
  const evento = makeEvento("observacao", operador, "Identificação do aparelho atualizada (IMEI/serial/operadora).", { evento: "identificacao_atualizada" });
  const equipamentoAtual = payload.equipamento && typeof payload.equipamento === "object"
    ? { ...(payload.equipamento as unknown as Record<string, unknown>) }
    : {};
  if (next.identificacao.modelo) equipamentoAtual.modelo = next.identificacao.modelo;
  if (next.identificacao.imei) equipamentoAtual.numeroSerie = next.identificacao.imei;
  return persistirProva(id, payload, next, operador, evento, { equipamento: equipamentoAtual });
}

// ----------------------------------------------------------------------------
// SPRINT_3E.2 — Assinatura digital do cliente na ENTRADA (item 2)
// ----------------------------------------------------------------------------

export async function salvarAssinaturaClienteV3(storeId: string, osId: string, dataUrl: string, por?: string): Promise<OrdemServico> {
  const { id, session, payload } = await carregar(storeId, osId);
  const veredito = validarAssinaturaV3(dataUrl ?? "");
  if (!veredito.ok) throw new Error(veredito.motivo ?? "Assinatura inválida.");
  const operador = operadorLabel(session);
  const atual = lerProvaEntradaV3(payload as unknown as OrdemServico);
  const next: ProvaEntradaV3 = {
    ...atual,
    assinaturaCliente: {
      dataUrl: dataUrl.trim(),
      criadoEm: nowIso(),
      por: str(por) || str((payload as unknown as OrdemServico).cliente?.nome) || undefined,
    },
  };
  const evento = makeEvento("observacao", operador, "Assinatura do cliente capturada (entrada).", { evento: "assinatura_cliente_capturada" });
  return persistirProva(id, payload, next, operador, evento);
}

// ----------------------------------------------------------------------------
// 5 — Acessórios recebidos (checklist) → evento acessorio_registrado
// ----------------------------------------------------------------------------

const ACESSORIO_IDS = new Set(ACESSORIOS_ENTRADA_V3.map((a) => a.id));

export async function salvarAcessoriosEntradaV3(storeId: string, osId: string, acessorios: AcessorioEntradaV3[]): Promise<OrdemServico> {
  const { id, session, payload } = await carregar(storeId, osId);
  const operador = operadorLabel(session);
  const atual = lerProvaEntradaV3(payload as unknown as OrdemServico);

  const porId = new Map<string, boolean>();
  for (const a of Array.isArray(acessorios) ? acessorios : []) {
    if (ACESSORIO_IDS.has(a?.id)) porId.set(a.id, a.presente === true);
  }
  const next: ProvaEntradaV3 = {
    ...atual,
    acessorios: ACESSORIOS_ENTRADA_V3.map((a) => ({ id: a.id, presente: porId.get(a.id) ?? false })),
  };

  const presentes = next.acessorios.filter((a) => a.presente).length;
  const evento = makeEvento("observacao", operador, `Acessórios recebidos registrados (${presentes} item(ns)).`, {
    evento: "acessorio_registrado",
    presentes,
  });
  return persistirProva(id, payload, next, operador, evento);
}

// ----------------------------------------------------------------------------
// 3 — Fotos da entrada (upload real → data URL no payload, com limites)
// ----------------------------------------------------------------------------

export interface AdicionarFotoEntradaInputV3 {
  categoria: CategoriaFotoV3;
  nome?: string;
  /** Data URL JPEG já reduzida no cliente. */
  dataUrl: string;
}

export async function adicionarFotoEntradaV3(storeId: string, osId: string, input: AdicionarFotoEntradaInputV3): Promise<OrdemServico> {
  const { id, session, payload } = await carregar(storeId, osId);
  const operador = operadorLabel(session);
  const atual = lerProvaEntradaV3(payload as unknown as OrdemServico);

  const veredito = validarFotoEntradaV3(input?.dataUrl ?? "", atual.fotos.length);
  if (!veredito.ok) throw new Error(veredito.motivo ?? "Foto inválida.");
  const categoria: CategoriaFotoV3 =
    input?.categoria === "frontal" || input?.categoria === "traseira" || input?.categoria === "lateral" || input?.categoria === "defeito"
      ? input.categoria
      : "defeito";

  const foto: FotoEntradaV3 = {
    id: uid("foto"),
    categoria,
    nome: str(input?.nome) || undefined,
    dataUrl: input.dataUrl.trim(),
    tamanho: bytesDeDataUrlV3(input.dataUrl),
    criadoEm: nowIso(),
  };
  const next: ProvaEntradaV3 = { ...atual, fotos: [...atual.fotos, foto] };
  const evento = makeEvento("anexo_adicionado", operador, `Foto de entrada adicionada (${categoria}).`, { evento: "foto_adicionada", categoria, fotoId: foto.id });
  return persistirProva(id, payload, next, operador, evento);
}

export async function removerFotoEntradaV3(storeId: string, osId: string, fotoId: string): Promise<OrdemServico> {
  const { id, session, payload } = await carregar(storeId, osId);
  const operador = operadorLabel(session);
  const atual = lerProvaEntradaV3(payload as unknown as OrdemServico);
  const fid = str(fotoId);
  const alvo = atual.fotos.find((f) => f.id === fid);
  if (!alvo) throw new Error("Foto não encontrada nesta OS.");

  const next: ProvaEntradaV3 = { ...atual, fotos: atual.fotos.filter((f) => f.id !== fid) };
  const evento = makeEvento("anexo_removido", operador, `Foto de entrada removida (${alvo.categoria}).`, { evento: "foto_removida", categoria: alvo.categoria, fotoId: fid });
  return persistirProva(id, payload, next, operador, evento);
}
