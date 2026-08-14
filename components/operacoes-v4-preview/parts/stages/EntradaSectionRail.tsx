"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ENTRADA_SECTIONS,
  type EntradaSectionCompletion,
  type EntradaSectionId,
} from "@/lib/operacoes-v4/entrada-workspace";
import styles from "./entrada-workspace.module.css";

export function EntradaSectionRail({
  active,
  completion,
  dirty,
  completed,
  total,
  onSelect,
}: {
  active: EntradaSectionId;
  completion: EntradaSectionCompletion;
  dirty: Record<EntradaSectionId, boolean>;
  completed: number;
  total: number;
  onSelect: (id: EntradaSectionId) => void;
}) {
  const percent = total ? Math.round((completed / total) * 100) : 0;

  return (
    <nav className={styles.sectionRail} aria-label="Seções da entrada">
      <div className={styles.railHeading}>
        <div className={styles.railEyebrow}>Entrada da OS</div>
        <div className={styles.railProgress}>{completed} de {total} concluídas</div>
        <div className={styles.progressTrack} aria-label={`${percent}% da entrada concluída`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div className={styles.progressValue} style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className={styles.railList}>
        {ENTRADA_SECTIONS.map((section) => {
          const selected = active === section.id;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelect(section.id)}
              aria-current={selected ? "step" : undefined}
              className={cn(styles.railItem, selected && styles.railItemActive, dirty[section.id] && styles.railItemDirty)}
            >
              <span className={styles.step}>{section.step}</span>
              <span className={styles.railLabel}>{section.label}</span>
              {dirty[section.id] ? <span className={styles.dirtyDot} title="Alterações não salvas" /> : completion[section.id] ? <Check className={styles.complete} aria-label="Concluída" /> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
