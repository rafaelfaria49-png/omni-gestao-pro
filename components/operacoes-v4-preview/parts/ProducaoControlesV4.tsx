"use client";

import { useEffect, useRef, useState } from "react";
import { PRIORIDADES_V3, PRIORIDADE_META_V3, type PrioridadeV3, type TecnicoRefV3 } from "@/lib/operacoes-v3/producao-model";
import styles from "./bancada-v4.module.css";

export function TecnicoPickerV4({
  conhecidos,
  atualNome,
  pending,
  onAtribuir,
  onRemover,
  onClose,
}: {
  conhecidos: TecnicoRefV3[];
  atualNome: string | null;
  pending: boolean;
  onAtribuir: (nome: string, id?: string) => Promise<boolean>;
  onRemover?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [outro, setOutro] = useState("");
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);

  const escolher = async (nome: string, id?: string) => {
    if (pending || !nome.trim()) return;
    const ok = await onAtribuir(nome.trim(), id);
    if (ok) onClose();
  };

  return (
    <div className={styles.popover} role="dialog" aria-label="Atribuir técnico">
      <div className={styles.popoverTitle}>Atribuir técnico</div>
      {conhecidos.length === 0 ? (
        <p className={styles.err} style={{ color: "var(--muted-foreground)", margin: "0 8px 8px" }}>
          Nenhum técnico disponível para atribuição. Digite o nome para registrar o primeiro.
        </p>
      ) : (
        conhecidos.map((t, i) => (
          <button
            key={t.id}
            ref={i === 0 ? first : undefined}
            type="button"
            disabled={pending}
            className={`${styles.opt} ${t.nome === atualNome ? styles.optOn : ""}`}
            onClick={() => escolher(t.nome, t.id)}
          >
            {t.nome}
          </button>
        ))
      )}
      <div className={styles.other}>
        <input
          value={outro}
          onChange={(e) => setOutro(e.target.value)}
          placeholder="Outro técnico…"
          disabled={pending}
          onKeyDown={(e) => {
            if (e.key === "Enter") void escolher(outro);
          }}
        />
        <button type="button" className={styles.btnPri} disabled={pending || !outro.trim()} onClick={() => escolher(outro)}>
          OK
        </button>
      </div>
      {atualNome && onRemover ? (
        <button
          type="button"
          className={styles.opt}
          disabled={pending}
          onClick={async () => {
            const ok = await onRemover();
            if (ok) onClose();
          }}
        >
          Remover atribuição
        </button>
      ) : null}
    </div>
  );
}

export function PrioridadePickerV4({
  atual,
  pending,
  onEscolher,
  onClose,
}: {
  atual: PrioridadeV3;
  pending: boolean;
  onEscolher: (p: PrioridadeV3) => Promise<boolean>;
  onClose: () => void;
}) {
  return (
    <div className={styles.popover} role="dialog" aria-label="Prioridade">
      <div className={styles.popoverTitle}>Prioridade</div>
      {PRIORIDADES_V3.map((p) => (
        <button
          key={p}
          type="button"
          disabled={pending || p === atual}
          className={`${styles.opt} ${p === atual ? styles.optOn : ""}`}
          onClick={async () => {
            const ok = await onEscolher(p);
            if (ok) onClose();
          }}
        >
          {PRIORIDADE_META_V3[p].label}
        </button>
      ))}
    </div>
  );
}


