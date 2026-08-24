/**
 * Operações V4 — coalescência do checklist técnico em cliques rápidos.
 *
 * O card da Execução persistia cada clique com `busy` bloqueando os seguintes.
 * Em rajada, só o primeiro item era gravado. Aqui o último snapshot sempre
 * entra na fila; writes em voo não descartam marcas posteriores.
 */

export type ChecklistTecnicoItemBurst = {
  id: string;
  label: string;
  ok: boolean;
};

export function toggleChecklistTecnicoItem<T extends { id: string; ok: boolean }>(
  itens: T[],
  id: string,
): T[] {
  return itens.map((it) => (it.id === id ? { ...it, ok: !it.ok } : it));
}

export function createChecklistBurstSaver<T>(persist: (snapshot: T) => Promise<unknown>) {
  let inFlight = false;
  let queued: T | undefined;
  let chain: Promise<void> = Promise.resolve();

  const flush = async () => {
    while (queued !== undefined) {
      const snapshot = queued;
      queued = undefined;
      inFlight = true;
      try {
        await persist(snapshot);
      } finally {
        inFlight = false;
      }
    }
  };

  return {
    submit(snapshot: T): Promise<void> {
      queued = snapshot;
      chain = chain.then(flush, flush);
      return chain;
    },
    get pending(): boolean {
      return inFlight || queued !== undefined;
    },
  };
}
