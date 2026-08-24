import { describe, expect, it } from "vitest";
import {
  createChecklistBurstSaver,
  toggleChecklistTecnicoItem,
} from "./checklist-tecnico-burst";

type Item = { id: string; label: string; ok: boolean };

const base: Item[] = [
  { id: "liga", label: "Aparelho liga", ok: false },
  { id: "touch_ok", label: "Touch OK", ok: false },
  { id: "camera_ok", label: "Câmera OK", ok: false },
];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("checklist técnico — cliques em rajada", () => {
  it("toggle aplica a marca no item clicado sem alterar os demais", () => {
    const a = toggleChecklistTecnicoItem(base, "liga");
    const b = toggleChecklistTecnicoItem(a, "touch_ok");
    expect(b.filter((it) => it.ok).map((it) => it.id)).toEqual(["liga", "touch_ok"]);
    expect(base.every((it) => !it.ok)).toBe(true);
  });

  it("rajada não perde marcas: o snapshot final persiste mesmo com write lento", async () => {
    const persisted: Item[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const saver = createChecklistBurstSaver<Item[]>(async (snapshot) => {
      persisted.push(snapshot.map((it) => ({ ...it })));
      if (persisted.length === 1) await gate;
    });

    let local = base;
    const click = (id: string) => {
      local = toggleChecklistTecnicoItem(local, id);
      void saver.submit(local);
    };

    click("liga");
    click("touch_ok");
    click("camera_ok");

    expect(local.filter((it) => it.ok).map((it) => it.id)).toEqual([
      "liga",
      "touch_ok",
      "camera_ok",
    ]);

    release();
    await saver.submit(local);
    await delay(0);

    expect(persisted.length).toBeGreaterThanOrEqual(1);
    const last = persisted.at(-1)!;
    expect(last.filter((it) => it.ok).map((it) => it.id)).toEqual([
      "liga",
      "touch_ok",
      "camera_ok",
    ]);
  });

  it("cliques durante write em voo substituem a fila e gravam o snapshot final", async () => {
    const persisted: Item[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const saver = createChecklistBurstSaver<Item[]>(async (snapshot) => {
      persisted.push(snapshot.map((it) => ({ ...it })));
      if (persisted.length === 1) await gate;
    });

    let local = base;
    local = toggleChecklistTecnicoItem(local, "liga");
    void saver.submit(local);
    await delay(0);
    expect(persisted).toHaveLength(1);

    local = toggleChecklistTecnicoItem(local, "touch_ok");
    void saver.submit(local);
    local = toggleChecklistTecnicoItem(local, "camera_ok");
    void saver.submit(local);

    release();
    await saver.submit(local);

    const last = persisted.at(-1)!;
    expect(last.filter((it) => it.ok).map((it) => it.id)).toEqual([
      "liga",
      "touch_ok",
      "camera_ok",
    ]);
  });

  it("o comportamento antigo (descartar clique enquanto busy) perderia marcas", async () => {
    const persisted: Item[][] = [];
    let busy = false;
    let local = base;

    const gravarBusy = async (next: Item[]) => {
      if (busy) return;
      busy = true;
      local = next;
      await delay(20);
      persisted.push(next.map((it) => ({ ...it })));
      busy = false;
    };

    const clickBusy = (id: string) => {
      if (busy) return;
      void gravarBusy(toggleChecklistTecnicoItem(local, id));
    };

    clickBusy("liga");
    clickBusy("touch_ok");
    clickBusy("camera_ok");
    await delay(40);

    expect(persisted).toHaveLength(1);
    expect(persisted[0].filter((it) => it.ok).map((it) => it.id)).toEqual(["liga"]);
  });

  it("ExecucaoStage usa o saver e não desabilita o item por busy", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "components/operacoes-v4-preview/parts/stages/ExecucaoStage.tsx"),
      "utf8",
    );
    const card = src.slice(src.indexOf("function ChecklistTecnicoCard"), src.indexOf("export function ExecucaoStage"));
    expect(card).toContain("createChecklistBurstSaver");
    expect(card).toContain("toggleChecklistTecnicoItem");
    expect(card).toContain("disabled={!osId}");
    expect(card).not.toMatch(/if \(!osId \|\| busy\) return/);
    expect(card).not.toContain("disabled={!osId || busy}");
  });
});
