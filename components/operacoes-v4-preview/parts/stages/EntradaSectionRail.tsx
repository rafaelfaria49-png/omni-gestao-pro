"use client";

import type { LucideIcon } from "lucide-react";
import {
  BadgeInfo,
  Camera,
  Check,
  ClipboardList,
  KeyRound,
  ListChecks,
  PackageCheck,
  Pin,
  Smartphone,
} from "lucide-react";
import { CollapsibleHoverRail } from "@/components/ui/collapsible-hover-rail";
import { WORKSPACE_OVERLAY_PRIORITY } from "@/lib/workspace-overlay-orchestrator";
import { cn } from "@/lib/utils";
import {
  ENTRADA_SECTIONS,
  type EntradaSectionCompletion,
  type EntradaSectionId,
} from "@/lib/operacoes-v4/entrada-workspace";
import styles from "./entrada-workspace.module.css";

const SECTION_ICONS: Record<EntradaSectionId, LucideIcon> = {
  "dados-basicos": ClipboardList,
  identificacao: BadgeInfo,
  seguranca: KeyRound,
  "estado-fisico": Smartphone,
  checklist: ListChecks,
  acessorios: PackageCheck,
  fotos: Camera,
};

type EntradaSectionRailProps = {
  active: EntradaSectionId;
  completion: EntradaSectionCompletion;
  dirty: Record<EntradaSectionId, boolean>;
  completed: number;
  total: number;
  onSelect: (id: EntradaSectionId) => void;
};

function RailItems({
  active,
  completion,
  dirty,
  expanded,
  onSelect,
}: Pick<EntradaSectionRailProps, "active" | "completion" | "dirty" | "onSelect"> & { expanded: boolean }) {
  return (
    <div className={styles.railList}>
      {ENTRADA_SECTIONS.map((section) => {
        const selected = active === section.id;
        const Icon = SECTION_ICONS[section.id];
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => onSelect(section.id)}
            aria-current={selected ? "step" : undefined}
            aria-label={!expanded ? section.label : undefined}
            title={dirty[section.id]
              ? `${section.label} — Alterações não salvas`
              : !expanded ? section.label : undefined}
            className={cn(styles.railItem, selected && styles.railItemActive, dirty[section.id] && styles.railItemDirty)}
          >
            <span className={styles.sectionIcon}>
              <Icon aria-hidden="true" />
              <span className={styles.step}>{section.step}</span>
              {completion[section.id] ? <span className={styles.completeMark}><Check aria-label="Concluída" /></span> : null}
              {dirty[section.id] ? <span className={styles.dirtyDot} title="Alterações não salvas" /> : null}
            </span>
            <span className={styles.railLabel}>{section.label}</span>
            <span className={styles.railState}>{completion[section.id] ? "Concluída" : dirty[section.id] ? "Não salva" : "Pendente"}</span>
          </button>
        );
      })}
    </div>
  );
}

export function EntradaSectionRail(props: EntradaSectionRailProps) {
  const percent = props.total ? Math.round((props.completed / props.total) * 100) : 0;

  return (
    <>
      <div className={styles.desktopRail}>
        <CollapsibleHoverRail
          ariaLabel="Seções da entrada"
          compactWidth={66}
          expandedWidth={224}
          overlayId="entrada-nav"
          overlayGroup="workspace-left"
          priority={WORKSPACE_OVERLAY_PRIORITY["entrada-nav"]}
          className={styles.railSlot}
          panelClassName={styles.sectionRailPanel}
        >
          {({ expanded, pinned, togglePinned, collapse }) => (
            <nav className={styles.sectionRail} aria-label="Seções da entrada" data-entrada-expanded={expanded ? "true" : "false"}>
              <div className={styles.railHeadingCompact} aria-hidden={expanded}>
                <span>EN</span>
                <strong>{props.completed}/{props.total}</strong>
              </div>
              <div className={cn(styles.railHeading, !expanded && styles.railHeadingHidden)}>
                <div className={styles.railHeadingCopy}>
                  <div className={styles.railEyebrow}>Entrada da OS</div>
                  <div className={styles.railProgress}>{props.completed} de {props.total} concluídas</div>
                </div>
                <button type="button" onClick={togglePinned} aria-label={pinned ? "Desafixar seções da entrada" : "Fixar seções da entrada"} aria-pressed={pinned} className={cn(styles.pinButton, pinned && styles.pinButtonActive)}>
                  <Pin aria-hidden="true" fill={pinned ? "currentColor" : "none"} />
                </button>
                <div className={styles.progressTrack} aria-label={`${percent}% da entrada concluída`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                  <div className={styles.progressValue} style={{ width: `${percent}%` }} />
                </div>
              </div>
              <RailItems
                {...props}
                expanded={expanded}
                onSelect={(id) => {
                  props.onSelect(id);
                  if (!pinned) collapse();
                }}
              />
            </nav>
          )}
        </CollapsibleHoverRail>
      </div>

      <nav className={styles.mobileRail} aria-label="Seções da entrada">
        <RailItems {...props} expanded={false} />
      </nav>
    </>
  );
}
