/**
 * Operações V4 — união do cadastro real de técnicos com os já atribuídos nas OS.
 *
 * Fonte canônica: `listTecnicos` (Cadastros, tabela `tecnicos`, por loja).
 * Técnicos só conhecidos pelo payload da OS entram depois, para não sumir
 * atribuições históricas. Sem schema novo.
 */
import type { TecnicoRefV3 } from "@/lib/operacoes-v3/producao-model";

function normNome(nome: string): string {
  return nome.trim().toLowerCase();
}

export function mergeTecnicosSeletorV4(
  cadastro: readonly TecnicoRefV3[],
  conhecidosOs: readonly TecnicoRefV3[],
): TecnicoRefV3[] {
  const map = new Map<string, TecnicoRefV3>();
  const nomes = new Set<string>();

  for (const t of cadastro) {
    const id = (t.id ?? "").trim();
    const nome = (t.nome ?? "").trim();
    if (!id || !nome) continue;
    map.set(id, { id, nome });
    nomes.add(normNome(nome));
  }

  for (const t of conhecidosOs) {
    const id = (t.id ?? "").trim();
    const nome = (t.nome ?? "").trim();
    if (!id || !nome) continue;
    if (map.has(id) || nomes.has(normNome(nome))) continue;
    map.set(id, { id, nome });
    nomes.add(normNome(nome));
  }

  return [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}
