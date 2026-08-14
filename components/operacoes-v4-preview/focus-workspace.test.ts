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
  const contextDrawer = read(DIR, "parts", "FocusContextDrawer.tsx");
  const commandHeader = read(DIR, "parts", "CommandHeader.tsx");
  const iconRail = read(DIR, "parts", "IconRail.tsx");
  const entranceRail = read(DIR, "parts", "stages", "EntradaSectionRail.tsx");
  const entranceCss = read(DIR, "parts", "stages", "entrada-workspace.module.css");
  const shell = read(ROOT, "components", "painel-inicial", "AppShell.tsx");
  const sidebar = read(ROOT, "components", "painel-inicial", "Sidebar.tsx");
  const hoverRail = read(ROOT, "components", "ui", "collapsible-hover-rail.tsx");
  const overlayContext = read(ROOT, "components", "painel-inicial", "workspace-focus-context.tsx");
  const overlayModel = read(ROOT, "lib", "workspace-overlay-orchestrator.ts");

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
    expect(hoverRail).toContain("keyboardFocus.current = true");
    expect(hoverRail).toContain("requestOpen()");
    expect(hoverRail).toContain('event.pointerType === "touch"');
  });

  it("usa um único overlay ativo por grupo e fecha o último com Escape", () => {
    expect(overlayModel).toContain("activeOverlay");
    expect(overlayModel).toContain("pinnedOverlay");
    expect(overlayContext).toContain('event.key !== "Escape"');
    expect(overlayContext).toContain('type: "close-last"');
  });

  it("declara prioridade Global > V4 > Contexto, sem rail de entrada", () => {
    expect(overlayModel).toContain('"global-nav": 80');
    expect(overlayModel).toContain('"v4-nav": 70');
    expect(overlayModel).toContain('"os-context": 60');
    expect(overlayModel).not.toContain("entrada-nav");
  });

  it("renderiza o grupo ativo por switch", () => {
    expect(sections).toContain("switch (props.group)");
    expect(sections.match(/case "/g)).toHaveLength(4);
  });

  it("inicia a Entrada em Recepção", () => {
    expect(workspace).toContain('useState<EntradaGroupId>("recepcao")');
  });

  it("Recepção mostra o que já veio da abertura e só pede o que falta", () => {
    expect(sections).toContain("<ConferenciaSnapshot");
    expect(sections).toContain("Informado na abertura");
    expect(sections).toContain("resolverIdentidadeAparelhoV4");
    expect(sections).toContain("Corrigir dados da abertura");
    expect(sections).toContain("<DadosBasicosSection");
    expect(sections).toContain("<IdentificacaoSection");
  });

  it("Inspeção marca Face ID/Biometria como N/A quando o recurso não existe", () => {
    expect(sections).toContain("rotuloChecklistExibidoV4");
  });

  it("Inspeção junta estado físico e checklist no mesmo grupo", () => {
    expect(sections).toContain("<EstadoFisicoSection");
    expect(sections).toContain("<ChecklistSection");
  });

  it("mantém os drafts no pai do conteúdo alternado", () => {
    expect(workspace).toContain("const [ed, setEd]");
    expect(workspace).toContain("const [db, setDb]");
    expect(workspace).toContain("<EntradaSections group={active}");
  });

  it("só avança depois que o save do grupo retorna sucesso", () => {
    expect(workspace).toMatch(/const saved = await saveGroup\(active\);[\s\S]*if \(saved && next\) setActive\(next\)/);
  });

  it("mantém o grupo atual quando a persistência falha", () => {
    const saveGroup = workspace.slice(workspace.indexOf("const saveGroup"), workspace.indexOf("const saveAndContinue"));
    expect(saveGroup).toMatch(/if \(!saved\)[\s\S]*return false/);
    expect(saveGroup).not.toContain("setActive(");
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

  it("retira Contexto do fluxo e abre drawer de 320px pelo header", () => {
    expect(context).toContain("if (v.focusActive) return <FocusContextDrawer");
    expect(contextDrawer).toContain('className="absolute inset-y-0 left-0');
    expect(contextDrawer).toContain("w-80");
    expect(commandHeader).toContain('data-overlay-trigger="os-context"');
    expect(commandHeader).toContain('title="Contexto da OS"');
  });

  it("preserva navegação por clique nas rails global e V4", () => {
    expect(sidebar).toContain("<Link");
    expect(sidebar).toContain("onClick={collapse}");
    expect(iconRail).toContain("r.onClick();");
    expect(iconRail).toContain("collapse();");
  });

  it("não implementa autosave", () => {
    expect(workspace).not.toMatch(/useEffect\([\s\S]*saveSection/);
    expect(workspace).toContain("Sem salvamento automático");
  });

  it("a Entrada não compete mais com overlay lateral — grupos ficam no canvas", () => {
    expect(entranceRail).not.toContain("CollapsibleHoverRail");
    expect(entranceRail).not.toContain("entrada-nav");
    expect(entranceRail).toContain("Grupos da entrada");
    expect(entranceCss).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(entranceCss).toContain(".confirmedField");
    expect(entranceCss).toMatch(/\.canvas \{[\s\S]*min-width: 0/);
    expect(entranceCss).toMatch(/@media \(max-width: 1023px\)[\s\S]*overflow-x: auto/);
  });

  it("mantém as larguras compactas no fluxo ao expandir Global e V4", () => {
    expect(sidebar).toContain("compactWidth={56}");
    expect(sidebar).toContain("expandedWidth={224}");
    expect(iconRail).toContain("compactWidth={54}");
    expect(iconRail).toContain("expandedWidth={196}");
    expect(hoverRail).toContain("data-reserved-width={reservedWidth}");
  });

  it("mantém Atividade independente no grupo direito", () => {
    const activity = read(DIR, "parts", "ActivityColumn.tsx");
    expect(activity).toContain('overlayId="activity"');
    expect(activity).toContain('overlayGroup="workspace-right"');
    expect(activity).toContain("compactWidth={40}");
    expect(activity).toContain("expandedWidth={304}");
  });

  it("fecha expansão não fixada por clique fora", () => {
    expect(hoverRail).toContain('document.addEventListener("pointerdown", onPointerDown)');
    expect(contextDrawer).toContain('document.addEventListener("pointerdown", onPointerDown)');
  });

  it("usa ícones semânticos dos quatro grupos e preserva indicador de concluído", () => {
    for (const icon of ["Search", "KeyRound", "ClipboardCheck", "PackageCheck"]) {
      expect(entranceRail).toContain(icon);
    }
    expect(entranceRail).toContain("completeMark");
    expect(entranceRail).toContain("groupChipDirty");
  });

  it("respeita prefers-reduced-motion nas animações novas", () => {
    expect(entranceCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(hoverRail).toContain("motion-reduce:transition-none");
  });

  it("Evidências usa as actions reais de foto e assinatura da entrada", () => {
    const photos = sections.slice(sections.indexOf("function FotosSection"));
    expect(photos).toContain("v.adicionarFotoEntrada");
    expect(photos).toContain("v.removerFotoEntrada");
    expect(photos).toContain("type=\"file\"");
    expect(photos).not.toContain("upload por esta tela estará disponível em breve");
    expect(sections).toContain("v.salvarAssinaturaCliente");
    expect(sections).toContain("Assinatura do cliente");
  });
});

describe("Operações V4 — TopBar, Diagnóstico e Execução do GOAL 002", () => {
  const topBar = read(DIR, "parts", "TopBar.tsx");
  const diagnostico = read(DIR, "parts", "stages", "DiagnosticoStage.tsx");
  const execucao = read(DIR, "parts", "stages", "ExecucaoStage.tsx");

  it("TopBar deixa de competir com a rail V4", () => {
    expect(topBar).not.toContain("v.modeBtns");
    expect(topBar).not.toContain("Recepção");
    expect(topBar).not.toContain("Auditoria de UX");
    expect(topBar).toContain("+ Novo");
    expect(topBar).toContain("onFoco");
    expect(topBar).toContain("goToOSSearch");
  });

  it("Diagnóstico mostra o defeito como contexto e preserva parecer final legado", () => {
    expect(diagnostico).toContain("Cliente relatou");
    expect(diagnostico).not.toContain("Parecer final");
    expect(diagnostico).toContain("final: d.parecerFinal");
    expect(diagnostico).toContain("Criar orçamento");
  });

  it("Execução não mostra o card preview de autorização", () => {
    expect(execucao).not.toContain("Autorização necessária");
    expect(execucao).not.toContain("Ver componentes de segurança");
  });
});
