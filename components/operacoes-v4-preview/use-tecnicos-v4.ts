"use client";

/**
 * Operações V4 — leitura do cadastro real de técnicos da loja ativa.
 *
 * Reusa `listTecnicos` (Cadastros / tabela `tecnicos`). Sem schema novo,
 * sem User PIN, sem inventar equipe. Falha = lista vazia (o seletor cai
 * nos técnicos já conhecidos das OS).
 */
import { useEffect, useState } from "react";
import { listTecnicos } from "@/app/actions/cadastros";
import type { TecnicoRefV3 } from "@/lib/operacoes-v3/producao-model";

export function useTecnicosCadastroV4(storeId: string | null): TecnicoRefV3[] {
  const [tecnicos, setTecnicos] = useState<TecnicoRefV3[]>([]);
  const sid = (storeId ?? "").trim();

  useEffect(() => {
    if (!sid) {
      setTecnicos([]);
      return;
    }
    let cancelled = false;
    listTecnicos(sid)
      .then((rows) => {
        if (cancelled) return;
        setTecnicos(
          (rows ?? [])
            .filter((t) => t.active !== false)
            .map((t) => ({ id: t.id, nome: (t.name ?? "").trim() }))
            .filter((t) => t.id && t.nome),
        );
      })
      .catch(() => {
        if (!cancelled) setTecnicos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sid]);

  return tecnicos;
}
