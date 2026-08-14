import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(DIR, "..", "..");
const read = (...parts: string[]) => readFileSync(join(...parts), "utf8");

describe("Operações V4 — arquitetura do workspace focado", () => {
  const hook = read(DIR, "use-v4-preview.ts");
  const preview = read(DIR, "OperacoesV4Preview.tsx");
  const workspace = read(DIR, "parts", "stages", "EntradaWorkspace.tsx");
  const sections = read(DIR, "parts", "stages", "EntradaSections.tsx");
  const context = read(DIR, "parts", "ContextColumn.tsx");
  const iconRail = read(DIR, "parts", "IconRail.tsx");
  const entranceCss = read(DIR, "parts", "stages", "entrada-workspace.module.css");
  const shell = read(ROOT, "components", "painel-inicial", "AppShell.tsx");
  const sidebar = read(ROOT, "components", "painel-inicial", "Sidebar.tsx");
  const hoverRail = read(ROOT, "components", "ui", "collapsible-hover-rail.tsx");

  it("ativa foco e recolhe os painéis quando uma OS real é selecionada", () => {
    const select = hook.slice(hook.indexOf("const selectOS"), hook.indexOf("const openOSFromRail"));
    expect(select).toContain("focus: true");
    expect(select).toContain("left: false");
    expect(select).toContain("right: false");
  });

  it("sai do foco ao trocar ou limpar a OS", () => {
    expect(hook).toMatch(/selectedOsId: null, focus: false/);
    expect(hook).toMatch(/clearSelection:[\s\S]*focus: false/);
  });

  it("mantém o estado normal quando nenhuma OS está selecionada", () => {
    expect(hook).toContain("focusActive: st.focus && !!st.selectedOsId");
  });

  it("propaga o foco da V4 para o AppShell e mantém a rail interna montada", () => {
    expect(preview).toContain("setFocusMode(v.focusActive)");
    expect(preview).toContain("<IconRail v={v} />");
    expect(shell).toContain("<Sidebar focusMode={focusMode} />");
  });

  it("abre rails por hover com atraso e por foco de teclado sem atraso", () => {
    expect(hoverRail).toContain("openDelay = 170");
    expect(hoverRail).toContain("setFocused(true)");
    expect(hoverRail).toContain('event.pointerType === "touch"');
  });

  it("renderiza somente a seção ativa por switch", () => {
    expect(sections).toContain("switch (props.section)");
    expect(sections.match(/case "/g)).toHaveLength(7);
  });

  it("inicia a Entrada em Dados básicos", () => {
    expect(workspace).toContain('useState<EntradaSectionId>("dados-basicos")');
  });

  it("seleciona explicitamente a tela de Identificação", () => {
    expect(sections).toContain('case "identificacao": return <IdentificacaoSection');
  });

  it("seleciona explicitamente a tela de Checklist", () => {
    expect(sections).toContain('case "checklist": return <ChecklistSection');
  });

  it("mantém os drafts no pai do conteúdo alternado", () => {
    expect(workspace).toContain("const [ed, setEd]");
    expect(workspace).toContain("const [db, setDb]");
    expect(workspace).toContain("<EntradaSections section={active}");
  });

  it("só avança depois que o save retorna sucesso", () => {
    expect(workspace).toMatch(/const saved = await saveSection\(active\);[\s\S]*if \(saved && next\) setActive\(next\)/);
  });

  it("mantém a seção atual quando a persistência falha", () => {
    const saveSection = workspace.slice(workspace.indexOf("const saveSection"), workspace.indexOf("const saveAndContinue"));
    expect(saveSection).toMatch(/if \(!saved\)[\s\S]*return false/);
    expect(saveSection).not.toContain("setActive(");
  });

  it("reusa os cinco handlers e mapeadores reais da Entrada", () => {
    for (const contract of [
      "v.salvarDadosBasicos(toDadosBasicosInput(db))",
      "v.salvarIdentificacao(toIdentificacaoInput(ed))",
      "v.salvarProvaEntrada(toProvaEntradaInput(ed))",
      "v.salvarChecklist(toChecklistInput(ed))",
      "v.salvarAcessorios(toAcessoriosInput(ed))",
    ]) expect(workspace).toContain(contract);
  });

  it("abre Contexto da OS em overlay por foco, clique ou pin", () => {
    expect(context).toContain('ariaLabel="Contexto da OS"');
    expect(context).toContain("expandedWidth={320}");
    expect(context).toContain("onClick={togglePinned}");
  });

  it("preserva navegação por clique nas rails global e V4", () => {
    expect(sidebar).toContain("<Link");
    expect(sidebar).toContain("onClick={togglePinned}");
    expect(iconRail).toContain("onClick={r.onClick}");
  });

  it("não implementa autosave", () => {
    expect(workspace).not.toMatch(/useEffect\([\s\S]*saveSection/);
    expect(workspace).toContain("Sem salvamento automático");
  });

  it("contém o overflow horizontal no rail mobile sem alargar o canvas", () => {
    expect(entranceCss).toContain("grid-template-columns: 224px minmax(0, 1fr)");
    expect(entranceCss).toMatch(/\.canvas \{[\s\S]*min-width: 0/);
    expect(entranceCss).toMatch(/@media \(max-width: 760px\)[\s\S]*overflow-x: auto/);
  });

  it("respeita prefers-reduced-motion nas animações novas", () => {
    expect(entranceCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(hoverRail).toContain("motion-reduce:transition-none");
  });

  it("mantém Fotos sem ação falsa de upload", () => {
    const photos = sections.slice(sections.indexOf("function FotosSection"));
    expect(photos).toContain("upload por esta tela estará disponível em breve");
    expect(photos).not.toContain("type=\"file\"");
    expect(photos).not.toContain("onClick");
  });
});
