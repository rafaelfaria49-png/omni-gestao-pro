/**
 * OPS-V4-STATUS-AUTHORITY-FIX-003 — autoridade ÚNICA de status da OS na V4.
 *
 * F-02: a Fila exibia status operacional incorreto porque a V4 lia `os.status`
 *       (projeção V2, que alguns write-paths deixam stale) enquanto a V3 decide
 *       por `payload.operacaoStatusV3`.
 * F-03: status desconhecido era convertido silenciosamente para "aberta",
 *       liberando CTA operacional ("Iniciar diagnóstico") sobre estado ignorado.
 *
 * Estes testes fixam o contrato do resolver e o efeito nas superfícies (Fila +
 * stage + ação primária). Nenhum acesso a banco: o resolver é puro.
 */
import { describe, it, expect } from "vitest";
import type { OrdemServico } from "@/types/os";
import { resolverStatusV4, realStatusToV4, stageForStatus } from "./os-adapter";
import { buildFilaItens, buildDashboardResumo } from "./rails-adapter";
import { PRIMARY, STATUS_LABEL, TONE } from "./mock-data";

function mkOS(p: Record<string, unknown> & { id: string }): OrdemServico {
  return p as unknown as OrdemServico;
}

describe("resolverStatusV4 — precedência da autoridade", () => {
  it("1. operacaoStatus stale + operacaoStatusV3 CANCELADA → cancelada", () => {
    // Regressão OS-2026-00002: atendimento rápido cancelado grava
    // `operacaoStatusV3`/`status` mas NÃO `operacaoStatus`, que fica em "aberta".
    expect(
      resolverStatusV4({ operacaoStatus: "aberta", status: "cancelada", operacaoStatusV3: "cancelada" }),
    ).toBe("cancelada");
  });

  it("2. operacaoStatus stale + operacaoStatusV3 ENTREGUE → entregue", () => {
    // Regressão OS-2026-00003: OS entregue que a V4 exibia como "Aprovada".
    expect(
      resolverStatusV4({ operacaoStatus: "aprovado", status: "aprovado", operacaoStatusV3: "entregue" }),
    ).toBe("entregue");
  });

  it("3. status legado válido (sem operacaoStatusV3) é respeitado", () => {
    expect(resolverStatusV4({ status: "em_execucao" })).toBe("em_execucao");
    expect(resolverStatusV4({ operacaoStatus: "pronta", status: "aberta" })).toBe("pronta");
  });

  it("3b. apelidos legados mapeiam sem passar por 'aberta'", () => {
    expect(resolverStatusV4({ status: "pronto" })).toBe("pronta");
    expect(resolverStatusV4({ status: "em_analise" })).toBe("diagnostico");
    expect(resolverStatusV4({ status: "finalizado" })).toBe("entregue");
    // "recebida" (V3, entre pronta e entregue) NUNCA pode virar "aberta".
    expect(resolverStatusV4({ status: "recebida" })).toBe("pronta");
  });

  it("4. status desconhecido → 'desconhecido' (NUNCA 'aberta')", () => {
    expect(resolverStatusV4({ status: "status_que_nao_existe" })).toBe("desconhecido");
    expect(resolverStatusV4({ operacaoStatusV3: "status_que_nao_existe" })).toBe("desconhecido");
    expect(realStatusToV4("qualquer_coisa")).toBe("desconhecido");
  });

  it("4b. autoridade presente e inválida NÃO cai para o legado", () => {
    // Se `operacaoStatusV3` existe mas é lixo, confiar no legado seria adivinhar.
    expect(resolverStatusV4({ operacaoStatusV3: "???", status: "aberta" })).toBe("desconhecido");
  });

  it("5. status ausente → 'desconhecido'", () => {
    expect(resolverStatusV4({})).toBe("desconhecido");
    expect(resolverStatusV4({ status: "" })).toBe("desconhecido");
    expect(resolverStatusV4(null)).toBe("desconhecido");
    expect(resolverStatusV4(undefined)).toBe("desconhecido");
  });

  it("6/7/8/9. casos normais do pipeline", () => {
    expect(resolverStatusV4({ operacaoStatusV3: "aberta" })).toBe("aberta");
    expect(resolverStatusV4({ operacaoStatusV3: "aprovado" })).toBe("aprovado");
    expect(resolverStatusV4({ operacaoStatusV3: "em_execucao" })).toBe("em_execucao");
    expect(resolverStatusV4({ operacaoStatusV3: "aguardando_peca" })).toBe("aguardando_peca");
    expect(resolverStatusV4({ operacaoStatusV3: "pronta" })).toBe("pronta");
    // "recebida" não existe na V4 → projeção oficial da V3.
    expect(resolverStatusV4({ operacaoStatusV3: "recebida" })).toBe("pronta");
  });

  it("12. é puro e determinístico (mesma entrada → mesma saída; não muta)", () => {
    const entrada = { operacaoStatus: "aberta", status: "cancelada", operacaoStatusV3: "cancelada" };
    const copia = { ...entrada };
    expect(resolverStatusV4(entrada)).toBe(resolverStatusV4(entrada));
    expect(resolverStatusV4(entrada)).toBe("cancelada");
    expect(entrada).toEqual(copia);
  });
});

describe("fail-closed — status desconhecido não vira ação operacional (F-03)", () => {
  it("não tem ação primária", () => {
    expect(PRIMARY.desconhecido).toBeNull();
  });

  it("tem rótulo e tom próprios (não se disfarça de 'Aberta')", () => {
    expect(STATUS_LABEL.desconhecido).toBe("Status não reconhecido");
    expect(STATUS_LABEL.desconhecido).not.toBe(STATUS_LABEL.aberta);
    expect(TONE.desconhecido).toBeDefined();
  });

  it("não abre etapa operacional — cai em 'historico', não em 'entrada'", () => {
    expect(stageForStatus("desconhecido")).toBe("historico");
    expect(stageForStatus(undefined)).toBe("historico");
  });
});

describe("CTAs por status resolvido (F-02 · FASE 4)", () => {
  it("10. CANCELADA não gera CTA de início", () => {
    const status = resolverStatusV4({ operacaoStatus: "aberta", operacaoStatusV3: "cancelada" });
    expect(status).toBe("cancelada");
    expect(PRIMARY[status]).toBeNull();
    expect(stageForStatus(status)).toBe("historico");
  });

  it("11. ENTREGUE não gera CTA de início", () => {
    const status = resolverStatusV4({ operacaoStatus: "aprovado", operacaoStatusV3: "entregue" });
    expect(status).toBe("entregue");
    expect(PRIMARY[status]).toBeNull();
    expect(stageForStatus(status)).toBe("entrega");
  });

  it("CONCLUIDA (pronta) não regride para etapa anterior", () => {
    const status = resolverStatusV4({ operacaoStatus: "diagnostico", operacaoStatusV3: "pronta" });
    expect(status).toBe("pronta");
    expect(stageForStatus(status)).toBe("entrega");
    // A ação de "pronta" leva ao Financeiro/Entrega — nunca a diagnóstico.
    expect(PRIMARY[status]?.stage).toBe("financeiro");
  });
});

describe("regressão de fila — OS-2026-00002 / OS-2026-00003", () => {
  // Payloads no formato observado na auditoria OPS-V4-STAGES-EXPLORATORY-AUDIT-002:
  // `operacaoStatus` stale, `operacaoStatusV3` correto.
  const cancelada = mkOS({
    id: "os-a",
    codigo: "OS-A",
    operacaoStatus: "aberta",
    status: "cancelada",
    operacaoStatusV3: "cancelada",
    criadoEm: "2026-06-01T10:00:00Z",
  });
  const entregue = mkOS({
    id: "os-b",
    codigo: "OS-B",
    operacaoStatus: "aprovado",
    status: "aprovado",
    operacaoStatusV3: "entregue",
    criadoEm: "2026-06-02T10:00:00Z",
  });
  const ativa = mkOS({
    id: "os-c",
    codigo: "OS-C",
    operacaoStatusV3: "em_execucao",
    criadoEm: "2026-06-03T10:00:00Z",
  });

  it("OS cancelada e OS entregue saem da fila de ativos", () => {
    const fila = buildFilaItens([cancelada, entregue, ativa]);
    expect(fila.map((r) => r.id)).toEqual(["os-c"]);
  });

  it("a fila nunca rotula essas OS como 'Aberta'/'Aprovada'", () => {
    const linhas = buildFilaItens([cancelada, entregue, ativa, mkOS({ id: "os-d", operacaoStatusV3: "aberta" })]);
    const rotulos = linhas.map((r) => r.statusLabel);
    expect(rotulos).not.toContain("Aprovada");
    // A única "Aberta" restante é a OS que realmente está aberta.
    expect(linhas.find((r) => r.id === "os-d")?.statusLabel).toBe("Aberta");
  });

  it("dashboard conta pela autoridade, não pelo campo stale", () => {
    const r = buildDashboardResumo([cancelada, entregue, ativa]);
    const byKey = Object.fromEntries(r.buckets.map((b) => [b.key, b.count]));
    expect(byKey.aberta).toBe(0);
    expect(byKey.aprovado).toBe(0);
    expect(byKey.entregue).toBe(1);
    expect(byKey.em_execucao).toBe(1);
    expect(r.ativos).toBe(1);
  });

  it("OS com status inconsistente CONTINUA visível na fila, mas sem CTA", () => {
    const quebrada = mkOS({ id: "os-x", operacaoStatusV3: "vish", criadoEm: "2026-06-04T10:00:00Z" });
    const fila = buildFilaItens([quebrada]);
    expect(fila).toHaveLength(1);
    expect(fila[0]!.status).toBe("desconhecido");
    expect(fila[0]!.statusLabel).toBe("Status não reconhecido");
    expect(PRIMARY[fila[0]!.status]).toBeNull();
  });
});
