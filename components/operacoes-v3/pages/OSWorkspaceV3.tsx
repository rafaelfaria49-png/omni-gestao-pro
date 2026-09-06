"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Camera, CreditCard, FileText, Globe, History, ListChecks, Lock, Pencil, Plus, Printer, Search, ShieldCheck, Tag } from "lucide-react";
import type { OrdemServico } from "@/types/os";
import { SectionShellV3 } from "../components/SectionShellV3";
import { OSHeaderV3 } from "../components/OSHeaderV3";
import { OSCommandBarV3 } from "../components/OSCommandBarV3";
import { OSSectionV3 } from "../components/OSSectionV3";
import { OSCardV3 } from "../components/OSCardV3";
import { OSTimelineV3 } from "../components/OSTimelineV3";
import { ChecklistEntradaV3 } from "../components/ChecklistEntradaV3";
import { ProvaEntradaV3 } from "../components/ProvaEntradaV3";
import { HistoricoAparelhoV3 } from "../components/HistoricoAparelhoV3";
import { DiagnosticoTecnicoV3 } from "../components/DiagnosticoTecnicoV3";
import { ServicosExecutadosV3 } from "../components/ServicosExecutadosV3";
import { GarantiaOSV3 } from "../components/GarantiaOSV3";
import { PosVendaV3 } from "../components/PosVendaV3";
import { ProducaoTecnicoV3 } from "../components/ProducaoTecnicoV3";
import { OSHistoricoV3 } from "../components/OSHistoricoV3";
import { OrcamentoPanelV3 } from "../components/OrcamentoPanelV3";
import { PrintPreviewV3 } from "../components/print/PrintPreviewV3";
import { EmptyStateV3 } from "../components/EmptyStateV3";
import { ButtonV3 } from "../components/UiV3";
import { LoadingBlockV3, NoStoreBlockV3 } from "../components/ScreenStateV3";
import { statusMetaV3, statusV3FromOS, type OperacaoStatusV3 } from "@/lib/operacoes-v3/status-machine";
import { aplicarTransicaoStatusV3 } from "@/lib/operacoes-v3/status-actions";
import { lerRecepcaoV3 } from "@/lib/operacoes-v3/workspace-model";
import { lerPagamentoV3, PAGAMENTO_STATUS_META_V3 } from "@/lib/operacoes-v3/payment-model";
import type { EmpresaPrintInputV3 } from "@/lib/operacoes-v3/print-model";
import type { DocumentoTipoV3 } from "@/lib/operacoes-v3/documentos";
import { useLojaAtiva } from "@/lib/loja-ativa";
import { useOperacoesV3 } from "../context/OperacoesV3Context";
import { useOrdemV3 } from "../hooks/use-ordem-v3";
import { useWorkspaceV3 } from "../hooks/use-workspace-v3";
import { useGarantiaV3 } from "../hooks/use-garantia-v3";
import { SCREEN_COPY } from "../data/screen-copy";
import { formatBRL, formatDataHora } from "../lib/format";
import { matchOrdem } from "../lib/os-derive";

function KV({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--ops-v3-subtle)]">{label}</dt>
      <dd className="truncate text-sm text-[var(--ops-v3-body)]">{value || "—"}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Picker() {
  const { ordens, loading, primeiraCarga, openOS, navigate, abrirNovaOS } = useOperacoesV3();
  const [q, setQ] = useState("");
  const lista = useMemo(() => ordens.filter((o) => matchOrdem(o, q)).slice(0, 24), [ordens, q]);

  return (
    <SectionShellV3
      kicker="Prontuário · uma OS por vez"
      titulo={SCREEN_COPY.workspace.titulo}
      subtitulo={SCREEN_COPY.workspace.subtitulo}
      actions={
        <>
          <ButtonV3 variant="outline" onClick={() => navigate("fila")}>
            Ver fila completa
          </ButtonV3>
          <ButtonV3 variant="primary" onClick={abrirNovaOS}>
            <Plus className="h-4 w-4" aria-hidden />
            Nova OS
          </ButtonV3>
        </>
      }
    >
      <div className="mb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ops-v3-subtle)]" aria-hidden />
          <input
            className="v3-mtap w-full rounded-lg border border-[var(--ops-v3-input)] bg-[var(--ops-v3-surface)] px-3 py-2 pl-9 text-sm text-[var(--ops-v3-body)] placeholder:text-[var(--ops-v3-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ops-v3-primary)]/20"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Selecione uma OS para abrir o prontuário…"
            aria-label="Buscar ordem de serviço"
          />
        </div>
      </div>
      {primeiraCarga && loading ? (
        <LoadingBlockV3 />
      ) : lista.length === 0 ? (
        <EmptyStateV3
          icon={<FileText className="h-8 w-8" />}
          titulo="Selecione uma ordem de serviço"
          descricao="Escolha uma OS na fila ou busque acima para abrir o prontuário completo do equipamento."
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {lista.map((os) => (
            <OSCardV3 key={os.id} os={os} onOpen={openOS} />
          ))}
        </div>
      )}
    </SectionShellV3>
  );
}

// ---------------------------------------------------------------------------

function Workspace({ os, reloadOrdem }: { os: OrdemServico; reloadOrdem: () => void }) {
  const { acaoEmConstrucao, navigate, openOS, storeId, ordens, reload: reloadLista, mudarStatus, notificar } = useOperacoesV3();
  const { empresaDocumentos } = useLojaAtiva();
  const pagV3 = lerPagamentoV3(os);
  const osStatus = statusV3FromOS(os);
  const recepcao = lerRecepcaoV3(os);
  const [printTipo, setPrintTipo] = useState<DocumentoTipoV3 | null>(null);

  // Dados da empresa para o cabeçalho do documento (unidade ativa, com fallback honesto no helper).
  const empresaPrint = useMemo<EmpresaPrintInputV3>(
    () => ({
      nomeFantasia: empresaDocumentos.nomeFantasia,
      razaoSocial: empresaDocumentos.razaoSocial,
      cnpj: empresaDocumentos.cnpj,
      endereco: empresaDocumentos.endereco,
      contato: empresaDocumentos.contato,
      logoUrl: empresaDocumentos.identidadeVisual?.logoUrl,
      responsavel: recepcao.recebidoPor,
    }),
    [empresaDocumentos, recepcao.recebidoPor],
  );

  const refresh = useCallback(() => {
    reloadOrdem();
    reloadLista();
  }, [reloadOrdem, reloadLista]);

  const wsActions = useWorkspaceV3(storeId, os.id, () => refresh());
  const garantiaActions = useGarantiaV3(storeId, os.id, () => refresh());

  // Toda mudança de status passa pela máquina única (via contexto).
  const onMudarStatus = useCallback(
    async (to: OperacaoStatusV3): Promise<boolean> => {
      const ok = await mudarStatus(os.id, to);
      if (ok) reloadOrdem();
      return ok;
    },
    [mudarStatus, os.id, reloadOrdem],
  );

  // Cancelamento (GOAL OPS-V3-CANCELAR-OS-CONTRATO-SEGURO-019): chama
  // `aplicarTransicaoStatusV3` direto (mesmo contrato reforçado) em vez do
  // `mudarStatus` genérico do contexto, para poder exigir motivo sem alterar a
  // assinatura compartilhada por outras telas (Bancada/Fila). Recarrega a OS E a
  // lista (mesmos dois reloads que `mudarStatus` já fazia).
  const onCancelarOS = useCallback(
    async (motivo: string): Promise<boolean> => {
      if (!storeId) {
        notificar("Selecione uma unidade ativa para cancelar.");
        return false;
      }
      try {
        await aplicarTransicaoStatusV3(storeId, os.id, "cancelada", { motivo });
        reloadOrdem();
        reloadLista();
        notificar(`Status atualizado para "${statusMetaV3("cancelada").label}".`);
        return true;
      } catch (e) {
        notificar(e instanceof Error ? e.message : "Não foi possível cancelar a OS.");
        return false;
      }
    },
    [storeId, os.id, reloadOrdem, reloadLista, notificar],
  );

  const irPara = (id: string) =>
    typeof document !== "undefined" && document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const acao = (label: string) => (
    <ButtonV3 variant="subtle" onClick={() => acaoEmConstrucao(label)}>
      {label}
    </ButtonV3>
  );

  // Ações rápidas do cabeçalho (item 2) — navegam dentro do próprio prontuário.
  const quickActions = (
    <>
      <ButtonV3 variant="outline" onClick={() => irPara("checklist")}>
        <Pencil className="h-4 w-4" aria-hidden /> Editar
      </ButtonV3>
      <ButtonV3 variant="outline" onClick={() => setPrintTipo("os_cliente")}>
        <Printer className="h-4 w-4" aria-hidden /> Imprimir
      </ButtonV3>
      <ButtonV3 variant="outline" onClick={() => irPara("anexos")}>
        <Camera className="h-4 w-4" aria-hidden /> Anexos
      </ButtonV3>
      <ButtonV3 variant="outline" onClick={() => irPara("garantia")}>
        <ShieldCheck className="h-4 w-4" aria-hidden /> Garantia
      </ButtonV3>
      <ButtonV3 variant="outline" onClick={() => irPara("historico")}>
        <History className="h-4 w-4" aria-hidden /> Histórico
      </ButtonV3>
    </>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ButtonV3 variant="ghost" onClick={() => navigate("fila")}>
          <ArrowLeft className="h-4 w-4" />
          Voltar à fila
        </ButtonV3>
        <ButtonV3 variant="ghost" onClick={() => openOS("")}>
          Trocar OS
        </ButtonV3>
      </div>

      <OSHeaderV3 os={os} actions={quickActions} />
      <OSCommandBarV3 os={os} onMudarStatus={onMudarStatus} onCancelar={onCancelarOS} onAcao={acaoEmConstrucao} />
      <OSTimelineV3 os={os} />

      <div className="min-w-0 space-y-3">
          <OSSectionV3
            titulo="Identificação / Atendimento"
            tone="info"
            resumo={`${os.cliente?.nome ?? "Cliente"} · ${[os.equipamento?.marca, os.equipamento?.modelo].filter(Boolean).join(" ") || os.equipamento?.tipo || "Equipamento"}`}
          >
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <KV label="Cliente" value={os.cliente?.nome} />
              <KV label="Documento" value={os.cliente?.documento} />
              <KV label="Telefone" value={os.cliente?.telefone} />
              <KV label="E-mail" value={os.cliente?.email} />
              <KV label="Tipo" value={os.equipamento?.tipo} />
              <KV label="Marca / modelo" value={[os.equipamento?.marca, os.equipamento?.modelo].filter(Boolean).join(" ")} />
              <KV label="Nº de série / IMEI" value={os.equipamento?.numeroSerie} />
              <KV label="Origem" value={recepcao.origem ?? os.origem} />
              <KV label="Recebido por" value={recepcao.recebidoPor} />
            </dl>
            {os.equipamento?.defeitoRelatado ? (
              <div className="mt-3 rounded-lg border border-[var(--ops-v3-line)] bg-[var(--ops-v3-soft)] p-3">
                <p className="text-xs font-medium text-[var(--ops-v3-muted)]">Defeito relatado</p>
                <p className="mt-0.5 text-sm text-[var(--ops-v3-body)]">{os.equipamento.defeitoRelatado}</p>
              </div>
            ) : null}
          </OSSectionV3>

          {/* Prova de entrada (Fase 3E.1): estado físico, avarias, fotos, credenciais, acessórios */}
          <ProvaEntradaV3 os={os} storeId={storeId} onChanged={refresh} notificar={notificar} />

          {/* Histórico do aparelho (Fase 3E.3): OS anteriores por IMEI/Serial + alertas + timeline */}
          <HistoricoAparelhoV3 os={os} ordens={ordens} onOpen={openOS} />

          {/* Produção / Técnico (Fase 3B): técnico, prioridade, SLA, localização, status de bancada */}
          <ProducaoTecnicoV3
            os={os}
            storeId={storeId}
            ordens={ordens}
            onChanged={refresh}
            notificar={notificar}
            onMudarStatus={onMudarStatus}
          />

          {/* Checklist de entrada (item 4) — editável + persistível */}
          <ChecklistEntradaV3
            os={os}
            storeId={storeId}
            onChanged={refresh}
            salvar={wsActions.salvarChecklist}
            pending={wsActions.pending === "checklist"}
            notificar={notificar}
          />

          {/* Senha/acessórios consolidados na Prova de Entrada (SPRINT_3E.2) — bloco legado removido. */}

          {/* Diagnóstico técnico (item 6) — editável + persistível */}
          <DiagnosticoTecnicoV3
            os={os}
            storeId={storeId}
            onChanged={refresh}
            salvar={wsActions.salvarDiagnostico}
            pending={wsActions.pending === "diagnostico"}
            notificar={notificar}
          />

          {/* Orçamento — área comercial (Fase 1C anterior) */}
          <div id="orcamento">
            <OrcamentoPanelV3
              os={os}
              storeId={storeId}
              onChanged={refresh}
              onIniciarServico={() => onMudarStatus("em_execucao")}
              notificar={notificar}
            />
          </div>

          {/* Serviços executados (item 7) — somente leitura, sem custo interno */}
          <ServicosExecutadosV3 os={os} />

          <OSSectionV3
            titulo="Financeiro / Pagamento"
            tone={pagV3.status === "quitado" ? "success" : pagV3.status === "parcial" ? "info" : "warning"}
            statusVisual={PAGAMENTO_STATUS_META_V3[pagV3.status].label}
            resumo={`Total ${formatBRL(pagV3.total)} · saldo ${formatBRL(pagV3.saldo)}`}
            acaoPrincipal={
              pagV3.status !== "sem_cobranca" && pagV3.saldo > 0 ? (
                <ButtonV3
                  variant="primary"
                  onClick={() => navigate("pdv-servico", os.id)}
                >
                  <CreditCard className="h-4 w-4" aria-hidden />
                  {(osStatus === "pronta" || osStatus === "recebida") ? "Entregar e receber" : "Receber no PDV de Serviço"}
                </ButtonV3>
              ) : undefined
            }
          >
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <KV label="Total da OS" value={formatBRL(pagV3.total)} />
              <KV label="Recebido" value={formatBRL(pagV3.recebido)} />
              <KV label="Saldo a receber" value={formatBRL(pagV3.saldo)} />
              <KV label="Status do pagamento" value={PAGAMENTO_STATUS_META_V3[pagV3.status].label} />
              <KV label="Última forma" value={pagV3.ultimaForma} />
              <KV label="Pagamento previsto (abertura)" value={os.faturamentoFormaPagamento ?? os.faturamentoModoCobranca} />
            </dl>
            <p className="mt-3 rounded-lg border border-dashed border-[var(--ops-v3-dashed)] bg-[var(--ops-v3-soft)] px-3 py-1.5 text-xs text-[var(--ops-v3-muted)]">
              O recebimento real (Dinheiro/PIX/Débito/Crédito, parcial e quitação) é feito no <strong>PDV de Serviço</strong> — baixa em Conta a Receber + entra no caixa do dia. Exige caixa aberto.
            </p>
          </OSSectionV3>

          <OSSectionV3
            titulo="Execução"
            tone={os.status === "em_execucao" ? "primary" : "neutral"}
            statusVisual={os.status === "em_execucao" ? "em andamento" : undefined}
            resumo="Checklist técnico de bancada (pós-reparo)"
            vazio={<p className="text-sm text-[var(--ops-v3-muted)]">Sem checklist técnico registrado nesta OS.</p>}
          >
            {os.checklistTecnico && os.checklistTecnico.length > 0 ? (
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {os.checklistTecnico.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${c.ok ? "bg-[var(--ops-v3-success)]" : "bg-[var(--ops-v3-faint)]"}`} aria-hidden />
                    <span className="truncate text-[var(--ops-v3-body)]">{c.label}</span>
                  </div>
                ))}
              </div>
            ) : undefined}
          </OSSectionV3>

          <OSSectionV3
            titulo="Entrega"
            tone={os.status === "entregue" ? "success" : "neutral"}
            statusVisual={os.retirada?.confirmado ? "retirada confirmada" : os.entregueEm ? "entregue" : undefined}
            resumo="Retirada e conferência pelo cliente"
            vazio={<p className="text-sm text-[var(--ops-v3-muted)]">Entrega ainda não registrada.</p>}
          >
            {os.retirada?.confirmado || os.entregueEm ? (
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <KV label="Retirado por" value={os.retirada?.retiradoPor} />
                <KV label="Retirado em" value={os.retirada?.retiradoEm ? formatDataHora(os.retirada.retiradoEm) : ""} />
                <KV label="Entregue em" value={os.entregueEm ? formatDataHora(os.entregueEm) : ""} />
                {os.retirada?.observacao ? <KV label="Observação" value={os.retirada.observacao} /> : null}
              </dl>
            ) : undefined}
          </OSSectionV3>

          {/* Garantia (Fase 1E): aba editável + sugestão + imprimir termo */}
          <GarantiaOSV3
            os={os}
            storeId={storeId}
            onChanged={refresh}
            onImprimirTermo={() => setPrintTipo("termo_garantia")}
            salvarGarantia={garantiaActions.salvarGarantia}
            pending={garantiaActions.pending}
            notificar={notificar}
          />

          {/* Pós-venda (Fase 3A): entrega + garantia (situação) + retornos + histórico do cliente */}
          <PosVendaV3
            os={os}
            storeId={storeId}
            ordens={ordens}
            onChanged={refresh}
            notificar={notificar}
            onImprimirEntrega={() => setPrintTipo("termo_entrega")}
            onAbrirRetornos={() => navigate("retornos")}
          />

          {/* Fotos consolidadas na Prova de Entrada (SPRINT_3E.2) — AnexosV3 (placeholder) removido. */}

          {/* Histórico completo (item 10) — auditável */}
          <OSHistoricoV3 os={os} />
      </div>

      {/* Rodapé utilitário — documentos (Fase 1E) */}
      <footer className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-[var(--ops-v3-line)] bg-[var(--ops-v3-surface)] p-2.5 shadow-sm sm:gap-2 sm:p-3">
        <ButtonV3 variant="outline" onClick={() => setPrintTipo("os_cliente")}>
          <Printer className="h-4 w-4" />
          Imprimir OS
        </ButtonV3>
        <ButtonV3 variant="outline" onClick={() => setPrintTipo("termo_garantia")}>
          <ShieldCheck className="h-4 w-4" />
          Imprimir Garantia
        </ButtonV3>
        <ButtonV3 variant="outline" onClick={() => setPrintTipo("comprovante_interno")}>
          <Lock className="h-4 w-4" />
          Via Interna
        </ButtonV3>
        <ButtonV3 variant="outline" onClick={() => setPrintTipo("etiqueta")}>
          <Tag className="h-4 w-4" />
          Etiqueta
        </ButtonV3>
        <ButtonV3 variant="ghost" onClick={() => acaoEmConstrucao("Abrir portal do cliente")}>
          <Globe className="h-4 w-4" />
          Portal do cliente
        </ButtonV3>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-[var(--ops-v3-muted)]">
          <ListChecks className="h-3.5 w-3.5" aria-hidden />
          Prontuário do equipamento — tudo da OS em uma tela.
        </span>
      </footer>

      <PrintPreviewV3
        tipo={printTipo}
        os={os}
        empresa={empresaPrint}
        onClose={() => setPrintTipo(null)}
        onPrinted={(t) => garantiaActions.registrarImpressao(t)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function OSWorkspaceV3() {
  const { storeId, selectedOsId, navigate } = useOperacoesV3();
  const { ordem, loading, error, reload } = useOrdemV3(storeId, selectedOsId);

  if (!storeId) {
    return (
      <SectionShellV3 titulo={SCREEN_COPY.workspace.titulo} subtitulo={SCREEN_COPY.workspace.subtitulo}>
        <NoStoreBlockV3 />
      </SectionShellV3>
    );
  }
  if (!selectedOsId) return <Picker />;
  if (loading && !ordem) {
    return (
      <SectionShellV3 titulo={SCREEN_COPY.workspace.titulo} subtitulo={SCREEN_COPY.workspace.subtitulo}>
        <LoadingBlockV3 label="Carregando OS…" />
      </SectionShellV3>
    );
  }
  if (!ordem) {
    return (
      <SectionShellV3 titulo={SCREEN_COPY.workspace.titulo} subtitulo={SCREEN_COPY.workspace.subtitulo}>
        <EmptyStateV3
          icon={<FileText className="h-8 w-8" />}
          titulo="OS não encontrada"
          descricao={error ?? "A ordem selecionada não existe nesta unidade ou foi removida."}
          acao={<ButtonV3 variant="outline" onClick={() => navigate("fila")}>Voltar à fila</ButtonV3>}
        />
      </SectionShellV3>
    );
  }
  return <Workspace os={ordem} reloadOrdem={reload} />;
}
