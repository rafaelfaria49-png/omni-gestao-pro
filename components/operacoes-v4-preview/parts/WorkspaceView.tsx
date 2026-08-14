/** Operações V4 Preview — workspace (cockpit): contexto + superfície central + atividade. */
import type { V4Vals } from "../use-v4-preview";
import { ContextColumn } from "./ContextColumn";
import { CommandHeader } from "./CommandHeader";
import { PipelineSpine } from "./PipelineSpine";
import { StagePanel } from "./StagePanel";
import { ActivityColumn } from "./ActivityColumn";
import { OSPicker } from "./OSPicker";

export function WorkspaceView({ v }: { v: V4Vals }) {
  if (!v.osSelected) {
    return <OSPicker v={v} />;
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", position: "relative" }}>
      {!v.focusActive ? <ContextColumn v={v} /> : null}
      <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--background)" }}>
        <CommandHeader v={v} />
        <PipelineSpine v={v} />
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: "relative", display: "flex" }}>
          <StagePanel v={v} />
          {v.focusActive ? <ContextColumn v={v} /> : null}
        </div>
      </section>
      <ActivityColumn v={v} />
    </div>
  );
}
