"use client";

// ============================================================================
// Operações V4 Preview — busca REAL de clientes (somente leitura).
// ----------------------------------------------------------------------------
// Consome `GET /api/clientes?q=…&lojaId=…` (header `x-assistec-loja-id`), que busca
// a base real da loja por nome / telefone / documento / cidade, escopada por
// `storeId`. NÃO há fallback para loja-1: sem loja ativa, `semLoja` fica true e a UI
// mostra estado honesto. Nenhuma escrita — só leitura para preencher visualmente o
// cliente na pré-visualização da Nova OS (a Preview não cria OS nem salva cliente).
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers";

export interface ClienteV4 {
  id: string;
  nome: string;
  telefone: string;
  documento: string;
  email: string;
  cidade: string;
}

export interface ClienteSearchV4 {
  query: string;
  setQuery: (q: string) => void;
  clientes: ClienteV4[];
  loading: boolean;
  error: string | null;
  /** true após a primeira resposta para um termo válido (evita "nada encontrado" prematuro). */
  buscou: boolean;
  /** true quando não há loja ativa — a busca não roda (sem fallback). */
  semLoja: boolean;
  /** termo mínimo ainda não atingido (≥ 2 caracteres). */
  termoCurto: boolean;
}

const MIN_CHARS = 2;
const MAX_RESULTS = 30;
const DEBOUNCE_MS = 300;

function mapCliente(raw: Record<string, unknown>): ClienteV4 {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    id: s(raw.id),
    nome: s(raw.name) || s(raw.nome),
    telefone: s(raw.phone) || s(raw.telefone),
    documento: s(raw.document) || s(raw.documento),
    email: s(raw.email),
    cidade: s(raw.city) || s(raw.cidade),
  };
}

/** Busca read-only de clientes da loja ativa, com debounce e cancelamento de corrida. */
export function useClienteSearchV4(storeId: string | null): ClienteSearchV4 {
  const [query, setQuery] = useState("");
  const [clientes, setClientes] = useState<ClienteV4[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buscou, setBuscou] = useState(false);
  const reqRef = useRef(0);

  const sid = (storeId ?? "").trim();
  const term = query.trim();

  useEffect(() => {
    if (!sid || term.length < MIN_CHARS) {
      setClientes([]);
      setLoading(false);
      setError(null);
      setBuscou(false);
      return;
    }
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      const url = `/api/clientes?q=${encodeURIComponent(term)}&lojaId=${encodeURIComponent(sid)}`;
      fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers: { [ASSISTEC_LOJA_HEADER]: sid },
      })
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as
            | { clientes?: Array<Record<string, unknown>>; error?: string }
            | null;
          if (reqRef.current !== reqId) return;
          if (!res.ok) throw new Error(data?.error || `Falha ao buscar clientes (HTTP ${res.status})`);
          const rows = Array.isArray(data?.clientes) ? data!.clientes! : [];
          setClientes(rows.slice(0, MAX_RESULTS).map(mapCliente).filter((c) => c.id));
          setLoading(false);
          setBuscou(true);
        })
        .catch((e) => {
          if (reqRef.current !== reqId) return;
          setError(e instanceof Error ? e.message : "Falha ao buscar clientes.");
          setLoading(false);
          setBuscou(true);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [sid, term]);

  return {
    query,
    setQuery,
    clientes,
    loading,
    error,
    buscou,
    semLoja: !sid,
    termoCurto: !!sid && term.length > 0 && term.length < MIN_CHARS,
  };
}
