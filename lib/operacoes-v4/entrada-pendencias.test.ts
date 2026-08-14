// Testes PUROS de derivarPendenciasEntradaV4 (GOAL OPS-V4-ORC-COMPLETAR-ENTRADA-027).
// Ambiente node: só reaproveita readers puros da V3 (lerDadosBasicosV3,
// lerProvaEntradaV3, provaEntradaCriadaV3) — sem I/O, sem React.
import { describe, expect, it } from "vitest";
import { derivarPendenciasEntradaV4, progressoPendenciasEntradaV4 } from "./entrada-pendencias";
import type { OrdemServico } from "@/types/os";

const osVazia = {} as OrdemServico;

function porChave(pendencias: ReturnType<typeof derivarPendenciasEntradaV4>, chave: string) {
  const item = pendencias.find((p) => p.chave === chave);
  if (!item) throw new Error(`pendência "${chave}" não encontrada`);
  return item;
}

describe("derivarPendenciasEntradaV4", () => {
  it("os nula/undefined → lista vazia (nunca fabrica pendência sem OS real)", () => {
    expect(derivarPendenciasEntradaV4(null)).toEqual([]);
    expect(derivarPendenciasEntradaV4(undefined)).toEqual([]);
  });

  it("OS vazia → todos os itens com contrato ficam pendentes", () => {
    const pendencias = derivarPendenciasEntradaV4(osVazia);
    expect(pendencias).toHaveLength(6);

    const acionaveis = pendencias.filter((p) => p.temContrato);
    expect(acionaveis).toHaveLength(6);
    expect(acionaveis.every((p) => p.preenchido === false)).toBe(true);

    const fotos = porChave(pendencias, "fotos");
    expect(fotos.temContrato).toBe(true);
    expect(fotos.preenchido).toBe(false);
  });

  it("OS parcial (só recebidoPor + checklist salvo) → só esses dois ficam preenchidos", () => {
    const os = {
      aberturaV3: { recepcao: { recebidoPor: "João" } },
      checklist: [{ id: "tela", label: "Tela", estado: "ok" }],
    } as unknown as OrdemServico;
    const pendencias = derivarPendenciasEntradaV4(os);

    expect(porChave(pendencias, "dados-basicos").preenchido).toBe(true);
    expect(porChave(pendencias, "checklist").preenchido).toBe(true);
    expect(porChave(pendencias, "identificacao").preenchido).toBe(false);
    expect(porChave(pendencias, "estado-avarias-acesso").preenchido).toBe(false);
    expect(porChave(pendencias, "acessorios").preenchido).toBe(false);
  });

  it("checklist: lista padrão (nunca salva) NÃO conta como preenchido — só o campo bruto da OS", () => {
    // lerChecklistEntradaV3 devolveria a lista padrão N/T mesmo sem save algum;
    // a pendência tem que olhar o campo bruto, não o reader com fallback.
    const pendencias = derivarPendenciasEntradaV4(osVazia);
    expect(porChave(pendencias, "checklist").preenchido).toBe(false);
  });

  it("estadoFisico com valor padrão 'ok' não fabrica pendência preenchida — exige provaEntradaV3 real", () => {
    // estadoFisicoPadraoV3() já nasce com todo componente "ok"; usar isso como
    // sinal daria falso positivo. O sinal honesto é provaEntradaCriadaV3.
    const pendencias = derivarPendenciasEntradaV4(osVazia);
    expect(porChave(pendencias, "estado-avarias-acesso").preenchido).toBe(false);
  });

  it("acessórios e identificação semeados de campos legados contam como preenchidos (dado real, não fabricado)", () => {
    const os = {
      equipamento: { numeroSerie: "IMEI-123", modelo: "iPhone 13", acessorios: ["Chip"] },
    } as unknown as OrdemServico;
    const pendencias = derivarPendenciasEntradaV4(os);
    expect(porChave(pendencias, "identificacao").preenchido).toBe(true);
    expect(porChave(pendencias, "acessorios").preenchido).toBe(true);
  });

  it("OS completa (todos os contratos já salvos) → nenhuma pendência acionável restante", () => {
    const os = {
      aberturaV3: { recepcao: { recebidoPor: "Maria" } },
      checklist: [{ id: "tela", label: "Tela", estado: "ok" }],
      provaEntradaV3: {
        versao: 1,
        criadoEm: "2026-01-01T12:00:00.000Z",
        identificacao: { imei: "I-1" },
        estadoFisico: [{ componente: "tela", status: "ok" }],
        avarias: [],
        fotos: [{ id: "f1", categoria: "frontal", dataUrl: "data:image/png;base64,x", criadoEm: "2026-01-01T12:00:00.000Z" }],
        credenciais: {},
        acessorios: [{ id: "chip", presente: true }],
      },
    } as unknown as OrdemServico;
    const pendencias = derivarPendenciasEntradaV4(os);
    const acionaveis = pendencias.filter((p) => p.temContrato);
    expect(acionaveis.every((p) => p.preenchido === true)).toBe(true);
    expect(porChave(pendencias, "fotos").temContrato).toBe(true);
  });

  it("fotos reais preenchem o contrato de evidências", () => {
    const os = {
      provaEntradaV3: {
        versao: 1,
        criadoEm: "2026-01-01T12:00:00.000Z",
        identificacao: {},
        estadoFisico: [],
        avarias: [],
        fotos: [{ id: "f1", categoria: "frontal", dataUrl: "data:image/png;base64,x", criadoEm: "2026-01-01T12:00:00.000Z" }],
        credenciais: {},
        acessorios: [],
      },
    } as unknown as OrdemServico;
    const pendencias = derivarPendenciasEntradaV4(os);
    const fotos = porChave(pendencias, "fotos");
    expect(fotos.preenchido).toBe(true);
    expect(fotos.temContrato).toBe(true);
  });
});

describe("progressoPendenciasEntradaV4", () => {
  it("conta os seis contratos reais, inclusive evidências", () => {
    const pendencias = derivarPendenciasEntradaV4(osVazia);
    const progresso = progressoPendenciasEntradaV4(pendencias);
    expect(progresso.total).toBe(6);
    expect(progresso.preenchidos).toBe(0);
  });

  it("progresso honesto reflete exatamente quantos itens acionáveis estão preenchidos", () => {
    const os = {
      aberturaV3: { recepcao: { recebidoPor: "João" } },
      checklist: [{ id: "tela", label: "Tela", estado: "ok" }],
    } as unknown as OrdemServico;
    const pendencias = derivarPendenciasEntradaV4(os);
    const progresso = progressoPendenciasEntradaV4(pendencias);
    expect(progresso.total).toBe(6);
    expect(progresso.preenchidos).toBe(2);
  });
});
