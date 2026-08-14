"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Camera, LockKeyhole, ShieldCheck, Trash2 } from "lucide-react";
import type { V4Vals } from "../../use-v4-preview";
import { PatternPadV4 } from "../PatternPadV4";
import {
  CHECKLIST_ESTADO_META_V3,
  ESTADO_FISICO_STATUS_META_V3,
  TIPOS_AVARIA_V3,
  acessorioEntradaLabelV3,
  componenteFisicoLabelV3,
  addAvaria,
  cycleChecklistEstado,
  removeAvaria,
  setAvaria,
  setEstadoFisicoStatus,
  toggleAcessorio,
  type EntradaEditorV4,
  type EstadoFisicoStatusV3,
} from "@/lib/operacoes-v4/entrada-form";
import {
  LOCAL_FISICO_V3,
  ORIGEM_V3,
  PRIORIDADE_V3,
  setDadosBasicos,
  type DadosBasicosEditorV4,
} from "@/lib/operacoes-v4/dados-basicos-form";
import type { EntradaSectionId } from "@/lib/operacoes-v4/entrada-workspace";
import { cn } from "@/lib/utils";
import styles from "./entrada-workspace.module.css";

type Props = {
  section: EntradaSectionId;
  v: V4Vals;
  ed: EntradaEditorV4;
  setEd: Dispatch<SetStateAction<EntradaEditorV4>>;
  db: DadosBasicosEditorV4;
  setDb: Dispatch<SetStateAction<DadosBasicosEditorV4>>;
};

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <label className={cn(styles.field, className)}><span className={styles.label}>{label}</span>{children}</label>;
}

function Group({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      {title ? <h3 className={styles.groupTitle}>{title}</h3> : null}
      {hint ? <p className={styles.groupHint}>{hint}</p> : null}
      {children}
    </section>
  );
}

export function EntradaSections(props: Props) {
  switch (props.section) {
    case "dados-basicos": return <DadosBasicosSection {...props} />;
    case "identificacao": return <IdentificacaoSection {...props} />;
    case "seguranca": return <SegurancaSection {...props} />;
    case "estado-fisico": return <EstadoFisicoSection {...props} />;
    case "checklist": return <ChecklistSection {...props} />;
    case "acessorios": return <AcessoriosSection {...props} />;
    case "fotos": return <FotosSection {...props} />;
  }
}

function DadosBasicosSection({ db, setDb }: Props) {
  const setBasico = <K extends keyof DadosBasicosEditorV4>(key: K, value: DadosBasicosEditorV4[K]) =>
    setDb((current) => setDadosBasicos(current, key, value));

  return (
    <>
      <Group title="Registro da recepção" hint="Estas informações orientam a triagem e permanecem vinculadas à OS.">
        <div className={styles.fields}>
          <Field label="Defeito relatado" className={styles.span2}>
            <textarea className={styles.textarea} value={db.defeitoRelatado} onChange={(event) => setBasico("defeitoRelatado", event.target.value)} maxLength={600} placeholder="Descreva o problema informado pelo cliente…" />
          </Field>
          <Field label="Prioridade">
            <select className={styles.select} value={db.prioridade} onChange={(event) => setBasico("prioridade", event.target.value as DadosBasicosEditorV4["prioridade"])}>
              {PRIORIDADE_V3.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Origem">
            <select className={styles.select} value={db.origem} onChange={(event) => setBasico("origem", event.target.value as DadosBasicosEditorV4["origem"])}>
              {ORIGEM_V3.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Localização física">
            <select className={styles.select} value={db.localFisico} onChange={(event) => setBasico("localFisico", event.target.value as DadosBasicosEditorV4["localFisico"])}>
              {LOCAL_FISICO_V3.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Recebido por">
            <input className={styles.input} value={db.recebidoPor} onChange={(event) => setBasico("recebidoPor", event.target.value)} maxLength={80} placeholder="Nome do atendente" />
          </Field>
          <Field label="Previsão de entrega / SLA" className={styles.span2}>
            <input className={styles.input} type="datetime-local" value={db.previsaoLocal} onChange={(event) => setBasico("previsaoLocal", event.target.value)} />
          </Field>
        </div>
      </Group>
      <Group title="Uso interno" hint="Não é impresso para o cliente.">
        <Field label="Observações internas">
          <textarea className={styles.textarea} value={db.observacoes} onChange={(event) => setBasico("observacoes", event.target.value)} maxLength={800} placeholder="Notas úteis para a equipe técnica…" />
        </Field>
      </Group>
    </>
  );
}

function IdentificacaoSection({ ed, setEd }: Props) {
  const patch = (values: Partial<EntradaEditorV4["identificacao"]>) => setEd((current) => ({ ...current, identificacao: { ...current.identificacao, ...values } }));
  return (
    <Group title="Identificadores do aparelho" hint="Informe ao menos um identificador confiável quando ele estiver disponível.">
      <div className={styles.fields}>
        <Field label="IMEI"><input className={cn(styles.input, styles.mono)} value={ed.identificacao.imei} onChange={(event) => patch({ imei: event.target.value })} maxLength={40} inputMode="numeric" /></Field>
        <Field label="Número de série"><input className={cn(styles.input, styles.mono)} value={ed.identificacao.serial} onChange={(event) => patch({ serial: event.target.value })} maxLength={40} /></Field>
        <Field label="Modelo" className={styles.span2}><input className={styles.input} value={ed.identificacao.modelo} onChange={(event) => patch({ modelo: event.target.value })} maxLength={60} placeholder="Ex.: iPhone 13 Pro" /></Field>
        <Field label="Cor"><input className={styles.input} value={ed.identificacao.cor} onChange={(event) => patch({ cor: event.target.value })} maxLength={40} /></Field>
        <Field label="Operadora"><input className={styles.input} value={ed.identificacao.operadora} onChange={(event) => patch({ operadora: event.target.value })} maxLength={40} placeholder="Ex.: Vivo, Claro" /></Field>
      </div>
    </Group>
  );
}

function SegurancaSection({ ed, setEd }: Props) {
  const patch = (values: Partial<EntradaEditorV4["credenciais"]>) => setEd((current) => ({ ...current, credenciais: { ...current.credenciais, ...values } }));
  return (
    <>
      <Group title="Acesso ao aparelho" hint="Registre apenas o necessário para diagnóstico. As credenciais permanecem mascaradas na impressão entregue ao cliente.">
        <div className={styles.fields}>
          <Field label="Tipo de senha">
            <select className={styles.select} value={ed.credenciais.senhaTipo} onChange={(event) => patch({ senhaTipo: event.target.value as EntradaEditorV4["credenciais"]["senhaTipo"] })}>
              <option value="numerica">Numérica (PIN)</option>
              <option value="texto">Texto</option>
              <option value="padrao">Padrão 3×3</option>
            </select>
          </Field>
          {ed.credenciais.senhaTipo === "padrao" ? <div /> : (
            <Field label="Senha / PIN"><input className={cn(styles.input, styles.mono)} value={ed.credenciais.senha} onChange={(event) => patch({ senha: event.target.value })} maxLength={60} autoComplete="off" /></Field>
          )}
          <Field label="Conta Google"><input className={styles.input} value={ed.credenciais.contaGoogle} onChange={(event) => patch({ contaGoogle: event.target.value })} maxLength={120} placeholder="email@gmail.com" autoComplete="off" /></Field>
          <Field label="Conta Apple"><input className={styles.input} value={ed.credenciais.contaApple} onChange={(event) => patch({ contaApple: event.target.value })} maxLength={120} placeholder="email@icloud.com" autoComplete="off" /></Field>
        </div>
      </Group>
      {ed.credenciais.senhaTipo === "padrao" ? (
        <Group title="Padrão 3×3" hint="Toque os pontos na ordem do padrão configurado pelo cliente.">
          <PatternPadV4 value={ed.credenciais.senha} onChange={(value) => patch({ senha: value })} />
        </Group>
      ) : null}
      <Group title="Biometria disponível">
        <div className={styles.checks}>
          <label className={styles.checkLabel}><input type="checkbox" checked={ed.credenciais.faceId} onChange={(event) => patch({ faceId: event.target.checked })} /> Face ID</label>
          <label className={styles.checkLabel}><input type="checkbox" checked={ed.credenciais.biometria} onChange={(event) => patch({ biometria: event.target.checked })} /> Biometria</label>
        </div>
      </Group>
      <div className={styles.error} style={{ borderLeftColor: "var(--border)", color: "var(--muted-foreground)", background: "var(--muted)" }}><ShieldCheck size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />Acesso restrito à equipe autorizada da OS.</div>
    </>
  );
}

function EstadoFisicoSection({ ed, setEd }: Props) {
  return (
    <>
      <Group title="Inspeção externa" hint="Revise cada componente com o cliente presente sempre que possível.">
        <div className={styles.inspectionList}>
          {ed.estadoFisico.map((item) => (
            <label key={item.componente} className={styles.inspectionRow}>
              <span className={styles.inspectionLabel}>{componenteFisicoLabelV3(item.componente)}</span>
              <select className={styles.select} value={item.status} onChange={(event) => setEd((current) => setEstadoFisicoStatus(current, item.componente, event.target.value as EstadoFisicoStatusV3))}>
                {(Object.keys(ESTADO_FISICO_STATUS_META_V3) as EstadoFisicoStatusV3[]).map((status) => <option key={status} value={status}>{ESTADO_FISICO_STATUS_META_V3[status].label}</option>)}
              </select>
            </label>
          ))}
        </div>
      </Group>
      <Group title={`Avarias registradas${ed.avarias.length ? ` · ${ed.avarias.length}` : ""}`} hint="Adicione somente danos visíveis no momento da entrada.">
        <div className={styles.damageTypes}>
          {TIPOS_AVARIA_V3.map((tipo) => <button key={tipo.id} type="button" className={styles.chip} onClick={() => setEd((current) => addAvaria(current, tipo.id))}>+ {tipo.label}</button>)}
        </div>
        {ed.avarias.length ? ed.avarias.map((avaria) => (
          <div className={styles.damageRow} key={avaria.id}>
            <span className={styles.damageType}>{TIPOS_AVARIA_V3.find((tipo) => tipo.id === avaria.tipo)?.label ?? avaria.tipo}</span>
            <input className={styles.input} value={avaria.local} onChange={(event) => setEd((current) => setAvaria(current, avaria.id, { local: event.target.value }))} maxLength={80} placeholder="Local do dano" />
            <button className={styles.iconButton} type="button" onClick={() => setEd((current) => removeAvaria(current, avaria.id))} aria-label="Remover avaria"><Trash2 size={14} /></button>
          </div>
        )) : <p className={styles.groupHint} style={{ marginTop: 14 }}>Nenhuma avaria registrada.</p>}
      </Group>
    </>
  );
}

function ChecklistSection({ ed, setEd }: Props) {
  return (
    <Group title="Testes rápidos" hint="Clique em cada item para alternar entre OK, ruim e não testado.">
      <div className={styles.choiceGrid}>
        {ed.checklist.map((item) => {
          const meta = CHECKLIST_ESTADO_META_V3[item.estado];
          return (
            <button key={item.id} type="button" className={styles.choice} onClick={() => setEd((current) => cycleChecklistEstado(current, item.id))} aria-label={`${item.label}: ${meta.label}`}>
              <span>{item.label}</span>
              <span className={styles.stateBadge}>{meta.label}</span>
            </button>
          );
        })}
      </div>
    </Group>
  );
}

function AcessoriosSection({ ed, setEd }: Props) {
  return (
    <Group title="Itens sob custódia" hint="Marque apenas o que permaneceu na assistência junto com o aparelho.">
      <div className={styles.choiceGrid}>
        {ed.acessorios.map((item) => (
          <button key={item.id} type="button" className={cn(styles.choice, item.presente && styles.choiceOn)} onClick={() => setEd((current) => toggleAcessorio(current, item.id))} aria-pressed={item.presente}>
            <span>{acessorioEntradaLabelV3(item.id)}</span>
            <span className={styles.choiceMark}>{item.presente ? "✓" : ""}</span>
          </button>
        ))}
      </div>
    </Group>
  );
}

function FotosSection({ v }: Props) {
  if (!v.entradaFotos.length) {
    return (
      <div className={styles.photoEmpty}>
        <div>
          <div className={styles.photoEmptyIcon}><LockKeyhole size={20} /></div>
          <h3 className={styles.photoEmptyTitle}>Nenhuma foto registrada</h3>
          <p className={styles.photoEmptyText}>A listagem já exibe evidências reais vinculadas à OS. O upload por esta tela estará disponível em breve; nenhuma ação de envio é simulada aqui.</p>
        </div>
      </div>
    );
  }
  return (
    <Group title={`${v.entradaFotos.length} foto${v.entradaFotos.length === 1 ? "" : "s"} registrada${v.entradaFotos.length === 1 ? "" : "s"}`} hint="Evidências reais já vinculadas à prova de entrada desta OS.">
      <div className={styles.photoGrid}>
        {v.entradaFotos.map((foto) => (
          <figure key={foto.id} className={styles.photo} title={foto.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={foto.dataUrl} alt={foto.name} />
            <figcaption className={styles.photoTag}>{foto.tag}</figcaption>
          </figure>
        ))}
      </div>
      <p className={styles.groupHint} style={{ marginTop: 14 }}><Camera size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />Novos uploads por esta tela chegam em breve.</p>
    </Group>
  );
}
