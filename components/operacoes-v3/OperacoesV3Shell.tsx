"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { ChevronRight, Maximize2, Minimize2, Plus, RefreshCw, Search } from "lucide-react";
import { useLojaAtiva } from "@/lib/loja-ativa";
import { cn } from "@/lib/utils";
import { aplicarTransicaoStatusV3 } from "@/lib/operacoes-v3/status-actions";
import { statusMetaV3, type OperacaoStatusV3 } from "@/lib/operacoes-v3/status-machine";
import { OperacoesV3Context, type OperacoesV3ContextValue } from "./context/OperacoesV3Context";
import { NovaOSEnterpriseModalV3 } from "./components/NovaOSEnterpriseModalV3";
import { OSContextRailV3 } from "./components/OSContextRailV3";
import { OperacoesV3MiniRail, OperacoesV3TopTabs } from "./OperacoesV3Nav";
import { OSModeToggleV3, type ModoOperacoesV3 } from "./components/OSModeToggleV3";
import { OSClienteColV3 } from "./components/OSClienteColV3";
import { useOrdensV3 } from "./hooks/use-ordens-v3";
import type { ScreenId } from "./data/types";
import { ButtonV3 } from "./components/UiV3";
import styles from "./operacoes-v3-skin.module.css";

import { DashboardV3 } from "./pages/DashboardV3";
import { FilaOSV3 } from "./pages/FilaOSV3";
import { AtendimentoRapidoV3 } from "./pages/AtendimentoRapidoV3";
import { BancadaV3 } from "./pages/BancadaV3";
import { SlaAtrasosV3 } from "./pages/SlaAtrasosV3";
import { OSWorkspaceV3 } from "./pages/OSWorkspaceV3";
import { PdvServicoV3 } from "./pages/PdvServicoV3";
import { OrcamentosV3 } from "./pages/OrcamentosV3";
import { GarantiasV3 } from "./pages/GarantiasV3";
import { RetornosV3 } from "./pages/RetornosV3";
import { PortalClienteV3 } from "./pages/PortalClienteV3";
import { NotificacoesV3 } from "./pages/NotificacoesV3";
import { ServicosV3 } from "./pages/ServicosV3";
import { PecasPedidosV3 } from "./pages/PecasPedidosV3";
import { RastreioFisicoV3 } from "./pages/RastreioFisicoV3";
import { TecnicosV3 } from "./pages/TecnicosV3";
import { HistoricoClientesV3 } from "./pages/HistoricoClientesV3";
import { RelatoriosV3 } from "./pages/RelatoriosV3";
import { ConfiguracoesV3 } from "./pages/ConfiguracoesV3";

const SCREENS: Record<ScreenId, ComponentType> = {
  dashboard: DashboardV3,
  fila: FilaOSV3,
  atendimento: AtendimentoRapidoV3,
  bancada: BancadaV3,
  sla: SlaAtrasosV3,
  workspace: OSWorkspaceV3,
  "pdv-servico": PdvServicoV3,
  orcamentos: OrcamentosV3,
  garantias: GarantiasV3,
  retornos: RetornosV3,
  portal: PortalClienteV3,
  notificacoes: NotificacoesV3,
  servicos: ServicosV3,
  pecas: PecasPedidosV3,
  rastreio: RastreioFisicoV3,
  tecnicos: TecnicosV3,
  historico: HistoricoClientesV3,
  relatorios: RelatoriosV3,
  configuracoes: ConfiguracoesV3,
};

/** Modo Bancada desativa ambas as laterais; Recepção abre ambas; Auditoria só a direita. */
const MODO_COLS: Record<ModoOperacoesV3, { left: boolean; right: boolean }> = {
  recepcao: { left: true, right: true },
  bancada: { left: false, right: false },
  auditoria: { left: false, right: true },
};

interface ToastItem {
  id: number;
  msg: string;
}

export function OperacoesV3Shell() {
  const { lojaAtivaId, empresaDocumentos } = useLojaAtiva();
  const storeId = (lojaAtivaId ?? "").trim() || null;
  const { ordens, loading, primeiraCarga, error, reload } = useOrdensV3(storeId);

  const [activeScreen, setActiveScreen] = useState<ScreenId>("dashboard");
  const [selectedOsId, setSelectedOsId] = useState<string | null>(null);
  const [novaOSOpen, setNovaOSOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Cockpit layout state — puro UI, sem I/O.
  const [modo, setModo] = useState<ModoOperacoesV3>("recepcao");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const mainRef = useRef<HTMLElement>(null);

  const handleModo = useCallback((m: ModoOperacoesV3) => {
    setModo(m);
    setLeftOpen(MODO_COLS[m].left);
    setRightOpen(MODO_COLS[m].right);
  }, []);

  const navigate = useCallback((screen: ScreenId, osId?: string | null) => {
    setActiveScreen(screen);
    if (osId !== undefined) setSelectedOsId(osId);
  }, []);

  const openOS = useCallback((osId: string) => {
    setSelectedOsId(osId);
    setActiveScreen("workspace");
  }, []);

  const notificar = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  const abrirNovaOS = useCallback(() => {
    if (!storeId) {
      notificar("Selecione uma unidade ativa para abrir uma OS.");
      return;
    }
    setNovaOSOpen(true);
  }, [storeId, notificar]);

  const onOSCriada = useCallback(
    (osId: string) => {
      setNovaOSOpen(false);
      reload();
      notificar("OS criada com sucesso.");
      openOS(osId);
    },
    [reload, notificar, openOS],
  );

  const acaoEmConstrucao = useCallback(
    (label?: string) => {
      notificar(label ? `${label} — disponível na próxima fase.` : "Ação disponível na próxima fase.");
    },
    [notificar],
  );

  const mudarStatus = useCallback(
    async (osId: string, to: OperacaoStatusV3): Promise<boolean> => {
      if (!storeId) {
        notificar("Selecione uma unidade ativa para alterar o status.");
        return false;
      }
      try {
        await aplicarTransicaoStatusV3(storeId, osId, to);
        reload();
        notificar(`Status atualizado para "${statusMetaV3(to).label}".`);
        return true;
      } catch (e) {
        notificar(e instanceof Error ? e.message : "Não foi possível alterar o status.");
        return false;
      }
    },
    [storeId, reload, notificar],
  );

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [activeScreen, selectedOsId]);

  const ctx: OperacoesV3ContextValue = useMemo(
    () => ({
      storeId,
      activeScreen,
      selectedOsId,
      navigate,
      openOS,
      ordens,
      loading,
      primeiraCarga,
      error,
      reload,
      mudarStatus,
      abrirNovaOS,
      notificar,
      acaoEmConstrucao,
    }),
    [storeId, activeScreen, selectedOsId, navigate, openOS, ordens, loading, primeiraCarga, error, reload, mudarStatus, abrirNovaOS, notificar, acaoEmConstrucao],
  );

  const ActiveScreen = SCREENS[activeScreen];

  // Colunas laterais do cockpit: só no workspace com uma OS aberta (≥ xl, via CSS).
  const selectedOs = activeScreen === "workspace" && selectedOsId
    ? (ordens.find((o) => o.id === selectedOsId) ?? null)
    : null;
  const showCols = selectedOs !== null;
  const focusActive = showCols && !leftOpen && !rightOpen;

  const toggleFocus = useCallback(() => {
    if (focusActive) {
      handleModo("recepcao");
      return;
    }
    setModo("bancada");
    setLeftOpen(false);
    setRightOpen(false);
  }, [focusActive, handleModo]);

  const unidade = empresaDocumentos?.nomeFantasia?.trim() || storeId || null;

  return (
    <OperacoesV3Context.Provider value={ctx}>
      <div className={cn(styles.skin, "flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--ops-v3-line)] bg-[var(--ops-v3-app)] text-[var(--ops-v3-ink)]")}>

        {/* ── Top bar (40 px, slim — vive dentro do AppShell real) ────────── */}
        <header className="flex h-10 flex-none items-center gap-2 border-b border-[var(--ops-v3-line)] bg-[var(--ops-v3-surface)] px-2 sm:gap-3 sm:px-3">
          {/* Identidade */}
          <div className="flex flex-none items-center gap-2">
            <span className="inline-flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-md bg-[var(--ops-v3-ink)] text-[12px] font-bold text-white">
              O
            </span>
            <span className="hidden text-[13px] font-semibold text-[var(--ops-v3-body)] sm:inline">OmniGestão</span>
            <span className="hidden whitespace-nowrap text-[11.5px] text-[var(--ops-v3-subtle)] md:inline">
              Operações <span className="font-semibold text-[var(--ops-v3-primary)]">V3</span>
            </span>
          </div>

          {/* Busca global — barra que cresce (flex-1, até 380px) abre o Picker do workspace */}
          <button
            type="button"
            onClick={() => navigate("workspace", null)}
            title="Buscar ordem de serviço"
            aria-label="Buscar ordem de serviço"
            className="flex h-7 min-w-0 max-w-[380px] flex-1 items-center gap-2 rounded-lg border border-[var(--ops-v3-line)] bg-[var(--ops-v3-muted-bg)] px-2.5 text-[12.5px] text-[var(--ops-v3-subtle)] transition-colors hover:bg-[var(--ops-v3-muted-bg-2)] hover:text-[var(--ops-v3-body)]"
          >
            <Search className="h-[13px] w-[13px] shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-left">Ir para OS, cliente, IMEI…</span>
            <kbd className="hidden shrink-0 rounded border border-[var(--ops-v3-input)] bg-[var(--ops-v3-surface)] px-1 py-px text-[10px] font-medium text-[var(--ops-v3-subtle)] sm:inline">⌘K</kbd>
          </button>

          {/* Modo de uso — segmented no command header, imediatamente após a busca global */}
          <OSModeToggleV3 value={modo} onChange={handleModo} />
          <ButtonV3
            variant="outline"
            onClick={toggleFocus}
            disabled={!showCols}
            className={cn(
              "h-7 shrink-0 px-3 text-xs",
              focusActive && "border-[var(--ops-v3-primary)] bg-[var(--ops-v3-primary)] text-white hover:bg-[var(--ops-v3-primary-hover)]",
            )}
          >
            {focusActive ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
            <span className="hidden xl:inline">{focusActive ? "Sair do foco" : "Modo foco"}</span>
          </ButtonV3>

          {/* Grupo direito */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {unidade ? (
              <span className="hidden truncate text-[11.5px] text-[var(--ops-v3-muted)] lg:inline" title={unidade}>
                {unidade}
              </span>
            ) : null}
            <ButtonV3 variant="outline" onClick={reload} disabled={!storeId} className="h-7 px-2.5 text-xs">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden />
              <span className="hidden sm:inline">Atualizar</span>
            </ButtonV3>
            <ButtonV3 variant="primary" onClick={abrirNovaOS} disabled={!storeId} className="h-7 px-3 text-xs">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Nova OS</span>
            </ButtonV3>
          </div>
        </header>

        <OperacoesV3TopTabs active={activeScreen} onNavigate={(id) => navigate(id)} />

        {/* ── Cockpit body ────────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 overflow-hidden">

          {/* Rail mínimo de módulos-chave */}
          <OperacoesV3MiniRail active={activeScreen} onNavigate={(id) => navigate(id)} />

          {/* Coluna de cliente (esquerda) — workspace com OS, ≥ xl */}
          {showCols && (
            <div className="hidden shrink-0 xl:flex">
              <OSClienteColV3 os={selectedOs} open={leftOpen} onToggle={() => setLeftOpen((v) => !v)} />
            </div>
          )}

          {/* Centro: conteúdo principal (1 coluna; largura útil contida) */}
          <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-[var(--ops-v3-app)]">
            <div className="mx-auto w-full max-w-[1080px] min-w-0 px-3 py-3 sm:px-5 sm:py-4">
              <div key={`${activeScreen}-${selectedOsId ?? "none"}`} className={styles.viewEnter}>
                <ActiveScreen />
              </div>
            </div>
          </main>

          {/* Coluna de atividade (direita) — workspace com OS, ≥ xl */}
          {showCols && (
            <div className="hidden shrink-0 xl:flex">
              {rightOpen ? (
                <aside className="flex w-72 flex-none flex-col border-l border-[var(--ops-v3-line)] bg-[var(--ops-v3-surface)]">
                  {/* Header strip 36 px */}
                  <div className="flex h-9 flex-none items-center justify-between border-b border-[var(--ops-v3-line)] px-3">
                    <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--ops-v3-subtle)]">
                      Atividade
                    </span>
                    <button
                      type="button"
                      onClick={() => setRightOpen(false)}
                      title="Recolher atividade"
                      aria-label="Recolher coluna de atividade"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--ops-v3-subtle)] hover:bg-[var(--ops-v3-muted-bg)] hover:text-[var(--ops-v3-ink)]"
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    <OSContextRailV3
                      os={selectedOs}
                      onAbrirHistorico={() => navigate("historico")}
                      onAcao={acaoEmConstrucao}
                    />
                  </div>
                </aside>
              ) : (
                /* Trilho recolhido — o strip inteiro reabre a coluna (padrão V4) */
                <button
                  type="button"
                  onClick={() => setRightOpen(true)}
                  title="Expandir atividade"
                  aria-label="Expandir coluna de atividade"
                  className="flex w-8 flex-none flex-col items-center gap-[9px] border-l border-[var(--ops-v3-line)] bg-[var(--ops-v3-surface)] pt-[9px] text-[var(--ops-v3-subtle)] transition-colors hover:bg-[var(--ops-v3-soft)] hover:text-[var(--ops-v3-ink)]"
                >
                  <span className="flex h-[23px] w-[23px] items-center justify-center rounded-md bg-[var(--ops-v3-muted-bg)] text-[13px] font-semibold">
                    ‹
                  </span>
                  <span className="[writing-mode:vertical-rl] mt-1 text-[10.5px] font-semibold uppercase tracking-[0.04em]">
                    Atividade
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Toasts (feedback único, role=status) ────────────────────────── */}
        {toasts.length > 0 ? (
          <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
            {toasts.map((t) => (
              <div
                key={t.id}
                className={`${styles.toastIn} pointer-events-auto max-w-md rounded-full border border-[var(--ops-v3-line)] bg-[var(--ops-v3-surface)] px-4 py-2 text-center text-[12.5px] font-medium text-[var(--ops-v3-body)] shadow-[var(--ops-v3-shadow-toast)]`}
              >
                {t.msg}
              </div>
            ))}
          </div>
        ) : null}

        <NovaOSEnterpriseModalV3
          open={novaOSOpen}
          storeId={storeId}
          onClose={() => setNovaOSOpen(false)}
          onCreated={onOSCriada}
        />
      </div>
    </OperacoesV3Context.Provider>
  );
}
