"use client";

import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Camera, ShieldCheck, Trash2 } from "lucide-react";
import { SignaturePadV3 } from "@/components/operacoes-v3/components/SignaturePadV3";
import { CATEGORIAS_FOTO_V3, FOTO_MAX_V3, lerProvaEntradaV3, type CategoriaFotoV3 } from "@/lib/operacoes-v3/prova-entrada-model";
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
import type { EntradaGroupId } from "@/lib/operacoes-v4/entrada-workspace";
import { lerAberturaRecepcionV4, resolverIdentidadeAparelhoV4 } from "@/lib/operacoes-v4/identidade-aparelho";
import { rotuloChecklistExibidoV4 } from "@/lib/operacoes-v4/checklist-aplicabilidade";
import { NI } from "../../os-adapter";
import { cn } from "@/lib/utils";
import styles from "./entrada-workspace.module.css";

type Props = {
  group: EntradaGroupId;
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
  switch (props.group) {
    case "recepcao":
      return (
        <>
          <ConferenciaSnapshot v={props.v} />
          <DadosBasicosSection {...props} />
          <IdentificacaoSection {...props} />
        </>
      );
    case "seguranca-custodia":
      return (
        <>
          <SegurancaSection {...props} />
          <AcessoriosSection {...props} />
        </>
      );
    case "inspecao":
      return (
        <>
          <EstadoFisicoSection {...props} />
          <ChecklistSection {...props} />
        </>
      );
    case "evidencias":
      return (
        <>
          <FotosSection {...props} />
          <AssinaturaEntradaSection {...props} />
        </>
      );
  }
}

function ConferenciaSnapshot({ v }: { v: V4Vals }) {
  const identidade = resolverIdentidadeAparelhoV4(v.realOS);
  const abertura = lerAberturaRecepcionV4(v.realOS);
  const aparelho = [identidade.marca.value, identidade.modelo.value].filter(Boolean).join(" ") || v.os.aparelho;
  const rows = [
    ["Cliente", v.os.cliente],
    ["Tipo", identidade.tipo.value],
    ["Aparelho", aparelho],
    ["IMEI", identidade.imei.value || v.os.imei],
    ["Série", identidade.serial.value],
    ["Defeito", abertura.defeitoRelatado || v.os.defeito],
    ["Origem", v.os.origem !== NI ? v.os.origem : abertura.origem],
    ["Recebido por", abertura.recebidoPor],
  ].filter(([, value]) => value && value !== NI);

  if (rows.length === 0) return null;

  return (
    <Group title="Informado na abertura" hint="Estes dados vieram da criação da OS. Abaixo só o que a bancada ainda precisa conferir ou completar.">
      <dl className={styles.snapshotGrid}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.snapshotRow}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Group>
  );
}

function DadosBasicosSection({ db, setDb }: Props) {
  const [corrigirAbertura, setCorrigirAbertura] = useState(false);
  const setBasico = <K extends keyof DadosBasicosEditorV4>(key: K, value: DadosBasicosEditorV4[K]) =>
    setDb((current) => setDadosBasicos(current, key, value));
  const aberturaJaInformada = Boolean(db.defeitoRelatado.trim() || db.recebidoPor.trim());

  return (
    <>
      <Group title="Ajustes da recepção" hint="Prioridade, localização e previsão. Cliente, aparelho e defeito já estão no resumo acima.">
        <div className={styles.fields}>
          {(!aberturaJaInformada || corrigirAbertura) ? (
            <>
              <Field label="Defeito relatado" className={styles.span2}>
                <textarea className={styles.textarea} value={db.defeitoRelatado} onChange={(event) => setBasico("defeitoRelatado", event.target.value)} maxLength={600} placeholder="Descreva o problema informado pelo cliente…" />
              </Field>
              <Field label="Origem">
                <select className={styles.select} value={db.origem} onChange={(event) => setBasico("origem", event.target.value as DadosBasicosEditorV4["origem"])}>
                  {ORIGEM_V3.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </Field>
              <Field label="Recebido por">
                <input className={styles.input} value={db.recebidoPor} onChange={(event) => setBasico("recebidoPor", event.target.value)} maxLength={80} placeholder="Nome do atendente" />
              </Field>
            </>
          ) : null}
          <Field label="Prioridade">
            <select className={styles.select} value={db.prioridade} onChange={(event) => setBasico("prioridade", event.target.value as DadosBasicosEditorV4["prioridade"])}>
              {PRIORIDADE_V3.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Localização física">
            <select className={styles.select} value={db.localFisico} onChange={(event) => setBasico("localFisico", event.target.value as DadosBasicosEditorV4["localFisico"])}>
              {LOCAL_FISICO_V3.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Previsão de entrega / SLA" className={styles.span2}>
            <input className={styles.input} type="datetime-local" value={db.previsaoLocal} onChange={(event) => setBasico("previsaoLocal", event.target.value)} />
          </Field>
        </div>
        {aberturaJaInformada ? (
          <button type="button" className={styles.linkButton} onClick={() => setCorrigirAbertura((open) => !open)}>
            {corrigirAbertura ? "Ocultar correção da abertura" : "Corrigir dados da abertura"}
          </button>
        ) : null}
      </Group>
      <Group title="Uso interno" hint="Não é impresso para o cliente.">
        <Field label="Observações internas">
          <textarea className={styles.textarea} value={db.observacoes} onChange={(event) => setBasico("observacoes", event.target.value)} maxLength={800} placeholder="Notas úteis para a equipe técnica…" />
        </Field>
      </Group>
    </>
  );
}

function IdentificacaoSection({ ed, setEd, v }: Props) {
  const identidade = resolverIdentidadeAparelhoV4(v.realOS);
  const [unlock, setUnlock] = useState<Record<string, boolean>>({});
  const patch = (values: Partial<EntradaEditorV4["identificacao"]>) => setEd((current) => ({ ...current, identificacao: { ...current.identificacao, ...values } }));

  const field = (
    key: "imei" | "serial" | "modelo" | "cor" | "operadora",
    label: string,
    value: string,
    informed: boolean,
    extra?: { className?: string; mono?: boolean; placeholder?: string; inputMode?: "numeric" },
  ) => {
    if (informed && !unlock[key]) {
      return (
        <div key={key} className={cn(styles.confirmedField, extra?.className)}>
          <span className={styles.label}>{label}</span>
          <div className={styles.confirmedValue}>
            <span className={extra?.mono ? styles.mono : undefined}>{value}</span>
            <button type="button" className={styles.linkButton} onClick={() => setUnlock((current) => ({ ...current, [key]: true }))}>Alterar</button>
          </div>
        </div>
      );
    }
    return (
      <Field key={key} label={label} className={extra?.className}>
        <input
          className={cn(styles.input, extra?.mono && styles.mono)}
          value={value}
          onChange={(event) => patch({ [key]: event.target.value })}
          maxLength={key === "modelo" ? 60 : 40}
          inputMode={extra?.inputMode}
          placeholder={extra?.placeholder}
        />
      </Field>
    );
  };

  return (
    <Group title="Completar identificação" hint="Preencha só o que faltou na abertura — IMEI, série, cor ou operadora.">
      <div className={styles.fields}>
        {field("imei", "IMEI", ed.identificacao.imei, identidade.imei.informedAtOpening, { mono: true, inputMode: "numeric" })}
        {field("serial", "Número de série", ed.identificacao.serial, Boolean(identidade.serial.value), { mono: true })}
        {field("modelo", "Modelo", ed.identificacao.modelo, identidade.modelo.informedAtOpening, { className: styles.span2, placeholder: "Ex.: iPhone 13 Pro" })}
        {field("cor", "Cor", ed.identificacao.cor, Boolean(identidade.cor.value))}
        {field("operadora", "Operadora", ed.identificacao.operadora, Boolean(identidade.operadora.value), { placeholder: "Ex.: Vivo, Claro" })}
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
      <Group title="Condição física" hint="Revise cada componente com o cliente presente sempre que possível.">
        <div className={styles.inspectionList}>
          {ed.estadoFisico.map((item) => (
            <label key={item.componente} className={styles.inspectionRow}>
              <span className={styles.inspectionLabel}>{componenteFisicoLabelV3(item.componente)}</span>
              <select className={styles.select} value={item.status} onChange={(event) => setEd((current) => setEstadoFisicoStatus(current, item.componente, event.target.value as EstadoFisicoStatusV3))}>
                {(Object.keys(ESTADO_FISICO_STATUS_META_V3) as EstadoFisicoStatusV3[]).map((status) => (
                  <option key={status} value={status}>{status === "ok" ? "Íntegro" : ESTADO_FISICO_STATUS_META_V3[status].label}</option>
                ))}
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
  const credenciais = { faceId: ed.credenciais.faceId, biometria: ed.credenciais.biometria };
  return (
    <Group title="Testes funcionais" hint="Clique em cada item para alternar entre OK, ruim e não testado. Recursos inexistentes ficam N/A.">
      <div className={styles.choiceGrid}>
        {ed.checklist.map((item) => {
          const shown = rotuloChecklistExibidoV4(item.id, item.estado, credenciais);
          if (shown.naoAplicavel) {
            return (
              <div key={item.id} className={cn(styles.choice, styles.choiceNA)} aria-label={`${item.label}: N/A`}>
                <span>{item.label}</span>
                <span className={styles.stateBadge}>N/A</span>
              </div>
            );
          }
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
    <Group title="Itens recebidos com o aparelho" hint="Marque apenas o que permaneceu na assistência junto com o aparelho.">
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

async function comprimirFotoEntrada(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Falha ao ler a imagem."));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Imagem inválida."));
    image.src = dataUrl;
  });
  const scale = Math.min(1, 1024 / Math.max(img.width || 1, img.height || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((img.width || 1) * scale));
  canvas.height = Math.max(1, Math.round((img.height || 1) * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.6);
}

function FotosSection({ v }: Props) {
  const [categoria, setCategoria] = useState<CategoriaFotoV3>("frontal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remaining = Math.max(0, FOTO_MAX_V3 - v.entradaFotos.length);

  const onUpload = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const dataUrl = await comprimirFotoEntrada(file);
      const ok = await v.adicionarFotoEntrada({ categoria, nome: file.name, dataUrl });
      if (!ok) setError("Não foi possível adicionar a foto.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível adicionar a foto.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title="Fotos da entrada" hint={`${v.entradaFotos.length} de ${FOTO_MAX_V3} fotos. Frontal, traseira, lateral ou defeito.`}>
      <div className={styles.fields}>
        <Field label="Categoria">
          <select className={styles.select} value={categoria} onChange={(event) => setCategoria(event.target.value as CategoriaFotoV3)}>
            {CATEGORIAS_FOTO_V3.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </Field>
        <Field label="Adicionar foto">
          <input
            className={styles.input}
            type="file"
            accept="image/*"
            disabled={busy || remaining <= 0}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void onUpload(file);
            }}
          />
        </Field>
      </div>
      {v.entradaFotos.length ? (
        <div className={styles.photoGrid} style={{ marginTop: 14 }}>
          {v.entradaFotos.map((foto) => (
            <figure key={foto.id} className={styles.photo} title={foto.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={foto.dataUrl} alt={foto.name} />
              <figcaption className={styles.photoTag}>{foto.tag}</figcaption>
              <button type="button" className={styles.iconButton} style={{ position: "absolute", top: 6, right: 6, width: 28, height: 28 }} onClick={() => void v.removerFotoEntrada(foto.id)} aria-label="Remover foto">
                <Trash2 size={13} />
              </button>
            </figure>
          ))}
        </div>
      ) : (
        <p className={styles.groupHint} style={{ marginTop: 14 }}><Camera size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />Nenhuma foto registrada nesta prova de entrada.</p>
      )}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
    </Group>
  );
}

function AssinaturaEntradaSection({ v }: Props) {
  const prova = lerProvaEntradaV3(v.realOS);
  const assinatura = prova.assinaturaCliente;
  const quando = assinatura?.criadoEm
    ? new Date(assinatura.criadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : "";

  return (
    <Group title="Assinatura do cliente" hint="Vinculada à prova de entrada — não é a assinatura de entrega.">
      {assinatura?.dataUrl ? (
        <div className={styles.snapshotGrid}>
          <div className={styles.snapshotRow}>
            <dt>Estado</dt>
            <dd>Assinada em {quando}</dd>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assinatura.dataUrl} alt="Assinatura do cliente na entrada" style={{ maxHeight: 72, objectFit: "contain", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: 6 }} />
        </div>
      ) : (
        <p className={styles.groupHint}>Não coletada</p>
      )}
      <div style={{ marginTop: 12 }}>
        <SignaturePadV3
          onSave={(dataUrl) => void v.salvarAssinaturaCliente(dataUrl)}
          label={assinatura?.dataUrl ? "Substituir assinatura" : "Salvar assinatura"}
          hint="O cliente assina confirmando a entrada e as condições do aparelho."
        />
      </div>
    </Group>
  );
}
