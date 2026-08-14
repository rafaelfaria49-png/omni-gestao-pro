"use client";

import type { LucideIcon } from "lucide-react";
import { Check, ClipboardCheck, KeyRound, PackageCheck, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ENTRADA_GROUPS,
  type EntradaGroupCompletion,
  type EntradaGroupId,
} from "@/lib/operacoes-v4/entrada-workspace";
import styles from "./entrada-workspace.module.css";

const GROUP_ICONS: Record<EntradaGroupId, LucideIcon> = {
  recepcao: Search,
  "seguranca-custodia": KeyRound,
  inspecao: ClipboardCheck,
  evidencias: PackageCheck,
};

type EntradaSectionRailProps = {
  active: EntradaGroupId;
  completion: EntradaGroupCompletion;
  dirty: Record<EntradaGroupId, boolean>;
  completed: number;
  total: number;
  onSelect: (id: EntradaGroupId) => void;
};

export function EntradaSectionRail({
  active,
  completion,
  dirty,
  completed,
  total,
  onSelect,
}: EntradaSectionRailProps) {
  const percent = total ? Math.round((completed / total) * 100) : 0;

  return (
    <nav className={styles.groupSwitch} aria-label="Grupos da entrada">
      <div className={styles.groupSwitchMeta}>
        <span className={styles.groupSwitchEyebrow}>Entrada operacional</span>
        <span className={styles.groupSwitchProgress}>{completed} de {total} grupos</span>
      </div>
      <div className={styles.progressTrack} aria-label={`${percent}% da entrada concluída`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className={styles.progressValue} style={{ width: `${percent}%` }} />
      </div>
      <div className={styles.groupSwitchList}>
        {ENTRADA_GROUPS.map((group) => {
          const selected = active === group.id;
          const Icon = GROUP_ICONS[group.id];
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => onSelect(group.id)}
              aria-current={selected ? "step" : undefined}
              title={dirty[group.id] ? `${group.label} — Alterações não salvas` : group.label}
              className={cn(styles.groupChip, selected && styles.groupChipActive, dirty[group.id] && styles.groupChipDirty)}
            >
              <span className={styles.groupChipIcon}>
                <Icon aria-hidden="true" />
                {completion[group.id] ? <span className={styles.completeMark}><Check aria-label="Concluído" /></span> : null}
              </span>
              <span className={styles.groupChipCopy}>
                <span className={styles.groupChipStep}>{String(group.step).padStart(2, "0")}</span>
                <span className={styles.groupChipLabel}>{group.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
