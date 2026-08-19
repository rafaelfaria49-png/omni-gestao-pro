import { describe, expect, it } from "vitest";
import type { OrdemServico } from "@/types/os";
import {
  aplicarAuditoriaFilhaAutoCloseV3,
  aplicarAutoCloseOriginalV3,
  resolverRetornoParaAutoCloseV3,
  timelineTemAutoCloseFilhaV3,
  timelineTemAutoCloseOriginalV3,
} from "./retorno-auto-close";

const AGORA = "2026-08-19T15:00:00.000Z";

function filha(extra: Record<string, unknown> = {}): OrdemServico {
  return {
    id: "os-filha",
    codigo: "OS-2001",
    vinculoRetornoV3: {
      osOrigemId: "os-orig",
      osOrigemCodigo: "OS-1042",
      retornoId: "ret-1",
    },
    timeline: [],
    ...extra,
  } as unknown as OrdemServico;
}

function original(extra: Record<string, unknown> = {}): OrdemServico {
  return {
    id: "os-orig",
    codigo: "OS-1042",
    retornosV3: [
      {
        id: "ret-1",
        osOriginalId: "os-orig",
        osOriginalCodigo: "OS-1042",
        motivo: "Touch falhou",
        criadoEm: "2026-08-18T12:00:00.000Z",
        status: "aberto",
        osRetornoId: "os-filha",
        osRetornoCodigo: "OS-2001",
      },
    ],
    timeline: [],
    ...extra,
  } as unknown as OrdemServico;
}

describe("resolverRetornoParaAutoCloseV3", () => {
  it("aceita só o vínculo inequívoco nos dois lados", () => {
    const r = resolverRetornoParaAutoCloseV3(filha(), original());
    expect(r).toMatchObject({ ok: true, jaFinalizado: false, retorno: { id: "ret-1" } });
  });

  it("recusa sem vínculo, incompleto, auto-referência ou divergência", () => {
    const skip = (filho: OrdemServico, origem: OrdemServico) => {
      const r = resolverRetornoParaAutoCloseV3(filho, origem);
      return r.ok ? null : r.motivo;
    };
    expect(skip({ id: "x" } as OrdemServico, original())).toBe("sem_vinculo");
    expect(skip(filha({ vinculoRetornoV3: { osOrigemId: "os-orig" } }), original())).toBe("vinculo_incompleto");
    expect(skip(filha({ id: "os-orig" }), original())).toBe("auto_referencia");
    expect(skip(filha(), original({ id: "outra" }))).toBe("vinculo_divergente");
    expect(skip(filha(), original({ retornosV3: [] }))).toBe("retorno_ausente");
    expect(
      skip(
        filha(),
        original({
          retornosV3: [{ id: "ret-1", osOriginalId: "os-orig", motivo: "x", criadoEm: "t", status: "aberto", osRetornoId: "outra-os" }],
        }),
      ),
    ).toBe("vinculo_divergente");
  });

  it("não fecha se o código da filha diverge do gravado no retorno", () => {
    const r = resolverRetornoParaAutoCloseV3(filha({ codigo: "OS-9999" }), original());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("vinculo_divergente");
  });

  it("marca já finalizado sem reabrir o caso", () => {
    const r = resolverRetornoParaAutoCloseV3(
      filha(),
      original({
        retornosV3: [{
          id: "ret-1",
          osOriginalId: "os-orig",
          motivo: "Touch",
          criadoEm: "t",
          status: "finalizado",
          osRetornoId: "os-filha",
          osRetornoCodigo: "OS-2001",
          finalizadoEm: AGORA,
        }],
      }),
    );
    expect(r).toMatchObject({ ok: true, jaFinalizado: true });
  });
});

describe("aplicarAutoCloseOriginalV3", () => {
  it("finaliza uma vez e grava evento determinístico", () => {
    const first = aplicarAutoCloseOriginalV3(original(), filha(), { operador: "Ana", agora: AGORA });
    expect(first.changed).toBe(true);
    expect((first.next as unknown as { retornosV3: Array<{ status: string; observacaoFinal?: string }> }).retornosV3[0]).toMatchObject({
      status: "finalizado",
      observacaoFinal: "Finalizado automaticamente na entrega do atendimento OS-2001.",
    });
    expect(first.evento?.metadata).toMatchObject({
      evento: "retorno_finalizado",
      origem: "entrega_vinculada",
      retornoId: "ret-1",
      osRetornoId: "os-filha",
    });
    expect(timelineTemAutoCloseOriginalV3(first.next.timeline, "ret-1", "os-filha")).toBe(true);

    const replay = aplicarAutoCloseOriginalV3(first.next, filha(), { operador: "Ana", agora: "2026-08-19T16:00:00.000Z" });
    expect(replay.changed).toBe(false);
    expect(replay.next.timeline).toHaveLength(first.next.timeline!.length);
  });

  it("não adiciona evento se o retorno já foi finalizado manualmente", () => {
    const manual = original({
      retornosV3: [{
        id: "ret-1",
        osOriginalId: "os-orig",
        motivo: "Touch",
        criadoEm: "t",
        status: "finalizado",
        osRetornoId: "os-filha",
        osRetornoCodigo: "OS-2001",
        observacaoFinal: "Fechado no balcão",
      }],
    });
    const out = aplicarAutoCloseOriginalV3(manual, filha(), { operador: "Ana", agora: AGORA });
    expect(out.changed).toBe(false);
    expect(out.next.timeline).toEqual([]);
  });
});

describe("aplicarAuditoriaFilhaAutoCloseV3", () => {
  it("grava um único evento e o selo no vínculo", () => {
    const first = aplicarAuditoriaFilhaAutoCloseV3(filha(), {
      osOrigemId: "os-orig",
      osOrigemCodigo: "OS-1042",
      retornoId: "ret-1",
      operador: "Ana",
      agora: AGORA,
    });
    expect(first.changed).toBe(true);
    expect((first.next as unknown as { vinculoRetornoV3: { finalizadoPorEntrega?: boolean } }).vinculoRetornoV3.finalizadoPorEntrega).toBe(true);
    expect(timelineTemAutoCloseFilhaV3(first.next.timeline, "os-orig", "ret-1")).toBe(true);

    const replay = aplicarAuditoriaFilhaAutoCloseV3(first.next, {
      osOrigemId: "os-orig",
      osOrigemCodigo: "OS-1042",
      retornoId: "ret-1",
      operador: "Ana",
      agora: "2026-08-19T16:00:00.000Z",
    });
    expect(replay.changed).toBe(false);
    expect(replay.next.timeline).toHaveLength(1);
  });
});
