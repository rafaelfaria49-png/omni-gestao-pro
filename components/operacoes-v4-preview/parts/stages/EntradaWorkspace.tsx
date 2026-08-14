"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { derivarPendenciasEntradaV4 } from "@/lib/operacoes-v4/entrada-pendencias";
import {
  ENTRADA_SECTION_IDS,
  deriveEntradaSectionCompletion,
  entradaCompletionProgress,
  getEntradaSection,
  isEntradaSectionDirty,
  nextEntradaSection,
  previousEntradaSection,
  type EntradaSectionId,
} from "@/lib/operacoes-v4/entrada-workspace";
import {
  toAcessoriosInput,
  toChecklistInput,
  toIdentificacaoInput,
  toProvaEntradaInput,
  type EntradaEditorV4,
} from "@/lib/operacoes-v4/entrada-form";
import { toDadosBasicosInput, type DadosBasicosEditorV4 } from "@/lib/operacoes-v4/dados-basicos-form";
import type { V4Vals } from "../../use-v4-preview";
import { EntradaSectionRail } from "./EntradaSectionRail";
import { EntradaSections } from "./EntradaSections";
import styles from "./entrada-workspace.module.css";

export function EntradaWorkspace({ v }: { v: V4Vals }) {
  const [active, setActive] = useState<EntradaSectionId>("dados-basicos");
  const [ed, setEd] = useState<EntradaEditorV4>(() => v.entradaEditorSeed);
  const [db, setDb] = useState<DadosBasicosEditorV4>(() => v.dadosBasicosSeed);
  const [savedEd, setSavedEd] = useState<EntradaEditorV4>(() => v.entradaEditorSeed);
  const [savedDb, setSavedDb] = useState<DadosBasicosEditorV4>(() => v.dadosBasicosSeed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const completion = useMemo(
    () => deriveEntradaSectionCompletion(derivarPendenciasEntradaV4(v.realOS)),
    [v.realOS],
  );
  const progress = entradaCompletionProgress(completion);
  const dirty = Object.fromEntries(
    ENTRADA_SECTION_IDS.map((id) => [id, isEntradaSectionDirty(id, ed, db, savedEd, savedDb)]),
  ) as Record<EntradaSectionId, boolean>;
  const meta = getEntradaSection(active);
  const previous = previousEntradaSection(active);
  const next = nextEntradaSection(active);

  const markCurrentSnapshotSaved = (section: EntradaSectionId) => {
    if (section === "dados-basicos") setSavedDb(db);
    if (section === "identificacao") setSavedEd((current) => ({ ...current, identificacao: ed.identificacao }));
    if (section === "seguranca" || section === "estado-fisico") {
      setSavedEd((current) => ({ ...current, credenciais: ed.credenciais, estadoFisico: ed.estadoFisico, avarias: ed.avarias }));
    }
    if (section === "checklist") setSavedEd((current) => ({ ...current, checklist: ed.checklist }));
    if (section === "acessorios") setSavedEd((current) => ({ ...current, acessorios: ed.acessorios }));
  };

  const saveSection = async (section: EntradaSectionId): Promise<boolean> => {
    if (busy || section === "fotos") return false;
    setBusy(true);
    setError("");
    try {
      let saved = false;
      if (section === "dados-basicos") saved = await v.salvarDadosBasicos(toDadosBasicosInput(db));
      if (section === "identificacao") saved = await v.salvarIdentificacao(toIdentificacaoInput(ed));
      if (section === "seguranca" || section === "estado-fisico") saved = await v.salvarProvaEntrada(toProvaEntradaInput(ed));
      if (section === "checklist") saved = await v.salvarChecklist(toChecklistInput(ed));
      if (section === "acessorios") saved = await v.salvarAcessorios(toAcessoriosInput(ed));
      if (!saved) {
        setError("Não foi possível salvar esta seção. Revise os campos e tente novamente.");
        return false;
      }
      markCurrentSnapshotSaved(section);
      return true;
    } catch {
      setError("Não foi possível salvar esta seção. Tente novamente.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveAndContinue = async () => {
    const saved = await saveSection(active);
    if (saved && next) setActive(next);
  };

  const selectSection = (section: EntradaSectionId) => {
    setError("");
    setActive(section);
  };

  return (
    <div className={styles.workspace}>
      <EntradaSectionRail
        active={active}
        completion={completion}
        dirty={dirty}
        completed={progress.completed}
        total={progress.total}
        onSelect={selectSection}
      />
      <section className={styles.canvas} aria-labelledby={`entrada-title-${active}`}>
        <div className={styles.canvasInner}>
          <header className={styles.sectionHeader}>
            <div>
              <div className={styles.eyebrow}>{String(meta.step).padStart(2, "0")} · {meta.eyebrow}</div>
              <h2 className={styles.sectionTitle} id={`entrada-title-${active}`}>{meta.label}</h2>
              <p className={styles.sectionDescription}>{meta.description}</p>
            </div>
            <span className={cn(styles.stateBadge, dirty[active] ? styles.stateBadgeDirty : completion[active] ? styles.stateBadgeComplete : undefined)}>
              {dirty[active] ? "Alterações não salvas" : completion[active] ? "Concluída" : active === "fotos" ? "Upload em breve" : "Pendente"}
            </span>
          </header>

          <div className={styles.formBody}>
            <EntradaSections section={active} v={v} ed={ed} setEd={setEd} db={db} setDb={setDb} />
            {error ? <div className={styles.error} role="alert">{error}</div> : null}
          </div>

          <footer className={styles.actionBar}>
            <div>
              {previous ? <button type="button" className={styles.button} onClick={() => selectSection(previous)} disabled={busy}>Anterior</button> : null}
            </div>
            {meta.canSave ? (
              <div className={styles.actionGroup}>
                <span className={styles.saveNote}>Sem salvamento automático</span>
                <button type="button" className={styles.button} onClick={() => void saveSection(active)} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
                {next ? <button type="button" className={cn(styles.button, styles.buttonPrimary)} onClick={() => void saveAndContinue()} disabled={busy}>{busy ? "Salvando…" : "Salvar e continuar"}</button> : null}
              </div>
            ) : <span className={styles.saveNote}>Upload de fotos em breve</span>}
          </footer>
        </div>
      </section>
    </div>
  );
}
