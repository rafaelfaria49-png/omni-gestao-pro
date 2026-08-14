"use client";

import { useEffect, useMemo, useState } from "react";
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers";

export interface ServicoCatalogoV4 {
  id: string;
  nome: string;
  preco: number;
  custo: number;
  garantia: number;
  tempo: string;
  termo: string;
  active: boolean;
}

export function useServicosV4(storeId: string | null) {
  const [items, setItems] = useState<ServicoCatalogoV4[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const sid = (storeId ?? "").trim();

  useEffect(() => {
    if (!sid) {
      setItems([]);
      return;
    }
    let vivo = true;
    setLoading(true);
    setError(null);
    fetch("/api/ops/servicos", {
      credentials: "include",
      cache: "no-store",
      headers: { [ASSISTEC_LOJA_HEADER]: sid },
    })
      .then(async (r) => {
        const data = (await r.json()) as { items?: ServicoCatalogoV4[]; error?: string };
        if (!r.ok) throw new Error(data.error || "Falha ao carregar serviços.");
        return data.items ?? [];
      })
      .then((rows) => {
        if (vivo) setItems(rows.filter((s) => s.active !== false && s.nome?.trim()));
      })
      .catch((e) => {
        if (vivo) setError(e instanceof Error ? e.message : "Falha ao carregar serviços.");
      })
      .finally(() => {
        if (vivo) setLoading(false);
      });
    return () => {
      vivo = false;
    };
  }, [sid]);

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 12);
    return items.filter((s) => s.nome.toLowerCase().includes(q)).slice(0, 12);
  }, [items, query]);

  return { items, filtrados, loading, error, query, setQuery, semLoja: !sid };
}
