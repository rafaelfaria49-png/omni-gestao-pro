"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  ReceiptText,
  ShieldAlert,
  Lock,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  FileBadge,
} from "lucide-react";
import { SectionHeader } from "../components/SectionHeader";
import { SettingsCard } from "../components/SettingsCard";
import { SettingsCardSkeleton } from "../components/SettingsCardSkeleton";
import { Input } from "@/components/configuracoes-v3/components/ui/input";
import { Label } from "@/components/configuracoes-v3/components/ui/label";
import { Button } from "@/components/configuracoes-v3/components/ui/button";
import { Badge } from "@/components/configuracoes-v3/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/configuracoes-v3/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/configuracoes-v3/components/ui/dialog";
import { useToast } from "@/components/configuracoes-v3/hooks/use-toast";
import { useLojaAtiva } from "@/lib/loja-ativa";
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers";
import { FiscalOnboardingCertificado } from "./FiscalOnboardingCertificado";
// Imports diretos dos módulos PUROS (evitam puxar node-forge/node:crypto dos barrels para o client).
import { calcularAlertaVencimento } from "@/lib/fiscal/vault/certificado-alerta";
import { algumCertificadoInstalado, certificadoTemCustodia } from "@/lib/fiscal/certificate/certificate-custody";

const REGIME_OPTIONS: Array<{ value: string; label: string; crt: number }> = [
  { value: "SIMPLES_NACIONAL", label: "Simples Nacional", crt: 1 },
  { value: "SIMPLES_NACIONAL_EXCESSO", label: "Simples Nacional — excesso de sublimite", crt: 2 },
  { value: "REGIME_NORMAL", label: "Regime Normal", crt: 3 },
  { value: "MEI", label: "MEI", crt: 4 },
];

const AMBIENTE_OPTIONS = [
  { value: "HOMOLOGACAO", label: "Homologação (testes)" },
  { value: "PRODUCAO", label: "Produção" },
];

const MODELO_OPTIONS = [
  { value: "NFCE", label: "NFC-e (modelo 65)" },
  { value: "SAT", label: "SAT-CF-e (regional SP)" },
  { value: "NFE", label: "NF-e (modelo 55)" },
];

function crtFor(regime: string): number {
  return REGIME_OPTIONS.find((r) => r.value === regime)?.crt ?? 1;
}

type FiscalConfig = {
  fiscalEnabled: boolean;
  ambiente: string;
  modeloFiscal: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  inscricaoEstadual: string;
  inscricaoMunicipal: string;
  cnae: string;
  regimeTributario: string;
  crt: number;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  codigoMunicipioIbge: string;
  municipio: string;
  uf: string;
  cep: string;
  fone: string;
  email: string;
  cscId: string;
  cscConfigured: boolean;
  certificadoAtivoId: string | null;
};

type CertRow = {
  id: string;
  apelido: string;
  tipo: string;
  titularCn: string;
  cnpjTitular: string;
  serialNumber: string;
  fingerprint: string;
  validoDe: string | null;
  validoAte: string | null;
  status: string;
  ativo: boolean;
  blobConfigured: boolean;
  senhaConfigured: boolean;
  createdAt: string;
  /** Última alteração da linha (validação, ativação, rotação, revogação) — GOAL-016C. */
  atualizadoEm?: string;
};

/** Bloco `cofre` da API (GOAL-016C): provider do Secret Provider e capacidades do ambiente. */
type CofreInfo = {
  provider: string;
  disponivel: boolean;
  capacidades: { leitura: boolean; escrita: boolean; rotacao: boolean; revogacao: boolean };
  mensagem: string;
};

type SerieRow = { id: string; modelo: string; ambiente: string; serie: number; proximoNumero: number; ativo: boolean };

function emptyForm(): FiscalConfig {
  return {
    fiscalEnabled: false,
    ambiente: "HOMOLOGACAO",
    modeloFiscal: "NFCE",
    razaoSocial: "",
    nomeFantasia: "",
    cnpj: "",
    inscricaoEstadual: "",
    inscricaoMunicipal: "",
    cnae: "",
    regimeTributario: "SIMPLES_NACIONAL",
    crt: 1,
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    codigoMunicipioIbge: "",
    municipio: "",
    uf: "",
    cep: "",
    fone: "",
    email: "",
    cscId: "",
    cscConfigured: false,
    certificadoAtivoId: null,
  };
}

function FiscalSectionContent() {
  const { toast } = useToast();
  const { data: session, status } = useSession();
  const { lojaAtivaId } = useLojaAtiva();

  const isAdmin = useMemo(() => {
    if (status !== "authenticated" || !session?.user) return false;
    // "apenas ADMIN": espelha o gate do servidor (papel canônico admin).
    const role = String(session.user.role || "").toUpperCase();
    return role === "SUPER_ADMIN" || role === "ADMIN";
  }, [session, status]);

  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FiscalConfig>(() => emptyForm());
  const [serieFiscalPadrao, setSerieFiscalPadrao] = useState<number>(1);
  const [certs, setCerts] = useState<CertRow[]>([]);
  const [cofre, setCofre] = useState<CofreInfo | null>(null);
  const [series, setSeries] = useState<SerieRow[]>([]);

  const [certModal, setCertModal] = useState(false);
  const [certSaving, setCertSaving] = useState(false);
  const [certApelido, setCertApelido] = useState("");
  const [certTipo, setCertTipo] = useState("A1");
  const [certTitular, setCertTitular] = useState("");
  const [certCnpj, setCertCnpj] = useState("");
  const [certSerial, setCertSerial] = useState("");
  const [certFingerprint, setCertFingerprint] = useState("");
  const [certValidoDe, setCertValidoDe] = useState("");
  const [certValidoAte, setCertValidoAte] = useState("");
  const [certBlobRef, setCertBlobRef] = useState("");
  const [certSenhaRef, setCertSenhaRef] = useState("");

  const set = useCallback(<K extends keyof FiscalConfig>(k: K, v: FiscalConfig[K]) => {
    setForm((prev) => ({ ...prev, [k]: v }));
  }, []);

  const load = useCallback(async () => {
    if (!lojaAtivaId || !isAdmin) {
      setLoadState("idle");
      return;
    }
    const header = lojaAtivaId.trim();
    setLoadState("loading");
    try {
      const res = await fetch("/api/fiscal/config", {
        credentials: "include",
        cache: "no-store",
        headers: { [ASSISTEC_LOJA_HEADER]: header },
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        config?: FiscalConfig | null;
        certificados?: CertRow[];
        series?: SerieRow[];
        cofre?: CofreInfo;
        error?: string;
      };
      if (!res.ok) {
        setLoadState("error");
        toast({ title: "Não foi possível carregar", description: j.error || "Tente novamente.", variant: "destructive" });
        return;
      }
      setForm(j.config ? { ...emptyForm(), ...j.config } : emptyForm());
      setCerts(Array.isArray(j.certificados) ? j.certificados : []);
      setCofre(j.cofre ?? null);
      const ser = Array.isArray(j.series) ? j.series : [];
      setSeries(ser);
      const def = ser.find((s) => s.modelo === (j.config?.modeloFiscal ?? "NFCE") && s.ambiente === (j.config?.ambiente ?? "HOMOLOGACAO"));
      setSerieFiscalPadrao(def?.serie ?? 1);
      setLoadState("idle");
    } catch {
      setLoadState("error");
      toast({ title: "Falha de rede", description: "Não foi possível carregar a identidade fiscal.", variant: "destructive" });
    }
  }, [lojaAtivaId, isAdmin, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!lojaAtivaId) {
      toast({ title: "Nenhuma unidade ativa", description: "Selecione a unidade na seção Lojas.", variant: "destructive" });
      return;
    }
    const header = lojaAtivaId.trim();
    setSaving(true);
    try {
      const res = await fetch("/api/fiscal/config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: header },
        body: JSON.stringify({
          razaoSocial: form.razaoSocial,
          nomeFantasia: form.nomeFantasia,
          cnpj: form.cnpj,
          inscricaoEstadual: form.inscricaoEstadual,
          inscricaoMunicipal: form.inscricaoMunicipal,
          cnae: form.cnae,
          regimeTributario: form.regimeTributario,
          logradouro: form.logradouro,
          numero: form.numero,
          complemento: form.complemento,
          bairro: form.bairro,
          codigoMunicipioIbge: form.codigoMunicipioIbge,
          municipio: form.municipio,
          uf: form.uf,
          cep: form.cep,
          fone: form.fone,
          email: form.email,
          cscId: form.cscId,
          ambiente: form.ambiente,
          modeloFiscal: form.modeloFiscal,
          serieFiscalPadrao: Number.isFinite(serieFiscalPadrao) ? serieFiscalPadrao : 1,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; config?: FiscalConfig; error?: string };
      if (!res.ok) {
        toast({ title: "Falha ao salvar", description: j.error || `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      if (j.config) setForm((prev) => ({ ...prev, ...j.config }));
      toast({ title: "Identidade fiscal salva", description: "Dados gravados para a unidade ativa." });
      void load();
    } catch (e) {
      toast({ title: "Falha ao salvar", description: e instanceof Error ? e.message : "Erro inesperado", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const openCertModal = () => {
    setCertApelido("");
    setCertTipo("A1");
    setCertTitular("");
    setCertCnpj("");
    setCertSerial("");
    setCertFingerprint("");
    setCertValidoDe("");
    setCertValidoAte("");
    setCertBlobRef("");
    setCertSenhaRef("");
    setCertModal(true);
  };

  const submitCert = async () => {
    if (!lojaAtivaId) return;
    const header = lojaAtivaId.trim();
    setCertSaving(true);
    try {
      const res = await fetch("/api/fiscal/certificado", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: header },
        body: JSON.stringify({
          apelido: certApelido,
          tipo: certTipo,
          titularCn: certTitular,
          cnpjTitular: certCnpj,
          serialNumber: certSerial,
          fingerprint: certFingerprint,
          validoDe: certValidoDe || undefined,
          validoAte: certValidoAte || undefined,
          blobRef: certBlobRef || undefined,
          senhaRef: certSenhaRef || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(j.error || "Falha ao registrar certificado");
      toast({ title: "Certificado registrado", description: "Metadados gravados. Ative-o quando desejar usá-lo." });
      setCertModal(false);
      void load();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha ao registrar", variant: "destructive" });
    } finally {
      setCertSaving(false);
    }
  };

  const toggleCert = async (cert: CertRow) => {
    if (!lojaAtivaId) return;
    const header = lojaAtivaId.trim();
    try {
      const res = await fetch(`/api/fiscal/certificado/${encodeURIComponent(cert.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: header },
        body: JSON.stringify({ ativo: !cert.ativo }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(j.error || "Falha ao atualizar");
      toast({ title: cert.ativo ? "Certificado desativado" : "Certificado ativado" });
      void load();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha", variant: "destructive" });
    }
  };

  // ─── Estados de acesso ──────────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <div className="space-y-6">
        <SectionHeader icon={<ReceiptText className="h-5 w-5" />} title="Identidade Fiscal" description="A carregar…" />
        <SettingsCardSkeleton rows={4} />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <SectionHeader
          icon={<ReceiptText className="h-5 w-5" />}
          title="Identidade Fiscal"
          description="Configuração fiscal por loja (CNPJ, certificado, CSC). Disponível apenas para administradores."
        />
        <SettingsCard title="Acesso restrito" description="Apenas administradores podem gerir a identidade fiscal.">
          <div className="flex gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 shrink-0 text-amber-500" />
            <p>A sua sessão não tem permissão de administrador. Contacte um administrador para configurar os dados fiscais.</p>
          </div>
        </SettingsCard>
      </div>
    );
  }

  const noLoja = !lojaAtivaId;
  const crtAtual = crtFor(form.regimeTributario);

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<ReceiptText className="h-5 w-5" />}
        title="Identidade Fiscal"
        description="Cadastro fiscal por loja: dados da empresa, endereço fiscal, regime, certificado digital e CSC. Cada unidade tem identidade própria — nada é compartilhado entre lojas."
        actions={
          <Button type="button" onClick={() => void handleSave()} disabled={saving || noLoja || loadState === "loading"}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving ? "Salvando…" : "Salvar identidade fiscal"}
          </Button>
        }
      />

      {/* Banner dormente — fiscal não habilitado nesta fase */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Fiscal ainda não habilitado.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Esta tela apenas <span className="font-medium text-foreground">cadastra</span> a identidade fiscal da loja. A
            emissão de documentos fiscais (NFC-e) permanece <span className="font-medium text-foreground">desligada</span> e
            será habilitada numa fase futura, após homologação. Nenhum documento é emitido aqui.
          </p>
        </div>
      </div>

      {noLoja ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Nenhuma unidade ativa. Selecione uma unidade na seção <span className="font-medium text-foreground">Lojas</span>.
        </p>
      ) : null}

      {loadState === "loading" ? (
        <>
          <SettingsCardSkeleton rows={4} />
          <SettingsCardSkeleton rows={3} />
        </>
      ) : loadState === "error" ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Não foi possível carregar a identidade fiscal. Recarregue a página ou troque a unidade ativa.
        </p>
      ) : noLoja ? null : (
        <>
          {/* Onboarding pelo certificado A1 — preenche a identidade a partir do próprio certificado */}
          <FiscalOnboardingCertificado storeId={lojaAtivaId!.trim()} onConfirmado={() => void load()} />

          {/* Dados da empresa */}
          <SettingsCard title="Dados da empresa" description="Identificação fiscal do emitente (por loja).">
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Razão social" value={form.razaoSocial} onChange={(e) => set("razaoSocial", e.target.value)} disabled={saving} />
              <Field label="Nome fantasia" value={form.nomeFantasia} onChange={(e) => set("nomeFantasia", e.target.value)} disabled={saving} />
              <Field label="CNPJ" value={form.cnpj} onChange={(e) => set("cnpj", e.target.value)} placeholder="00.000.000/0001-00" disabled={saving} />
              <Field label="Inscrição estadual (IE)" value={form.inscricaoEstadual} onChange={(e) => set("inscricaoEstadual", e.target.value)} placeholder="ISENTO ou nº" disabled={saving} />
              <Field label="Inscrição municipal (IM)" value={form.inscricaoMunicipal} onChange={(e) => set("inscricaoMunicipal", e.target.value)} disabled={saving} />
              <Field label="CNAE principal" value={form.cnae} onChange={(e) => set("cnae", e.target.value)} placeholder="7 dígitos" disabled={saving} />
            </div>
          </SettingsCard>

          {/* Regime tributário */}
          <SettingsCard title="Regime tributário" description="Define o CRT usado na emissão (Simples × Normal). O CRT é derivado do regime.">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Regime</Label>
                <Select value={form.regimeTributario} onValueChange={(v) => set("regimeTributario", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REGIME_OPTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>CRT (derivado)</Label>
                <div className="flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
                  CRT {crtAtual}
                </div>
              </div>
            </div>
          </SettingsCard>

          {/* Endereço fiscal */}
          <SettingsCard title="Endereço fiscal" description="Endereço do emitente — exigido no documento fiscal.">
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Logradouro" value={form.logradouro} onChange={(e) => set("logradouro", e.target.value)} disabled={saving} />
              <Field label="Número" value={form.numero} onChange={(e) => set("numero", e.target.value)} disabled={saving} />
              <Field label="Complemento" value={form.complemento} onChange={(e) => set("complemento", e.target.value)} disabled={saving} />
              <Field label="Bairro" value={form.bairro} onChange={(e) => set("bairro", e.target.value)} disabled={saving} />
              <Field label="Município" value={form.municipio} onChange={(e) => set("municipio", e.target.value)} disabled={saving} />
              <Field label="Código IBGE do município" value={form.codigoMunicipioIbge} onChange={(e) => set("codigoMunicipioIbge", e.target.value)} placeholder="7 dígitos" disabled={saving} />
              <Field label="UF" value={form.uf} onChange={(e) => set("uf", e.target.value.toUpperCase())} placeholder="SP" disabled={saving} />
              <Field label="CEP" value={form.cep} onChange={(e) => set("cep", e.target.value)} placeholder="00000-000" disabled={saving} />
              <Field label="Telefone" value={form.fone} onChange={(e) => set("fone", e.target.value)} disabled={saving} />
              <Field label="E-mail fiscal" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} disabled={saving} />
            </div>
          </SettingsCard>

          {/* Emissão (ambiente / modelo / série) — dormente */}
          <SettingsCard title="Parâmetros de emissão" description="Ambiente, modelo e série. Configuração apenas — a emissão permanece desligada.">
            <div className="grid gap-6 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Ambiente</Label>
                <Select value={form.ambiente} onValueChange={(v) => set("ambiente", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AMBIENTE_OPTIONS.map((a) => (<SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Modelo fiscal</Label>
                <Select value={form.modeloFiscal} onValueChange={(v) => set("modeloFiscal", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODELO_OPTIONS.map((m) => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Série padrão</Label>
                <Input
                  type="number"
                  min={1}
                  max={999}
                  value={serieFiscalPadrao}
                  onChange={(e) => setSerieFiscalPadrao(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
                  disabled={saving}
                />
              </div>
            </div>
            {series.length > 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">
                Séries registradas: {series.map((s) => `${s.modelo}/${s.ambiente} série ${s.serie} (próx. ${s.proximoNumero})`).join(" · ")}
              </p>
            ) : null}
          </SettingsCard>

          {/* CSC */}
          <SettingsCard
            title="CSC (Código de Segurança do Contribuinte)"
            description="Usado no QR Code da NFC-e. O token é segredo: informe apenas a REFERÊNCIA segura (chave de cofre/env), nunca o valor."
          >
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="ID do CSC (idToken)" value={form.cscId} onChange={(e) => set("cscId", e.target.value)} placeholder="000001" disabled={saving} />
              <div className="space-y-1.5">
                <Label>Status do token CSC</Label>
                <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 text-sm">
                  {form.cscConfigured ? (
                    <><CheckCircle2 className="h-4 w-4 text-success" /><span className="text-muted-foreground">Referência configurada</span></>
                  ) : (
                    <><CircleDashed className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Não configurado</span></>
                  )}
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              A referência do token CSC é gravada via cofre seguro na fase de emissão. Nenhum segredo é digitado ou exibido nesta tela.
            </p>
          </SettingsCard>

          {/* Certificado Digital */}
          <SettingsCard
            title="Certificado Digital (A1)"
            description="Metadados e referências seguras do certificado da loja. O arquivo .pfx e a senha não são gravados: no onboarding eles são apenas lidos no servidor, e a custódia do material fica no cofre de segredos."
            headerExtra={
              <Button type="button" variant="outline" size="sm" onClick={openCertModal} disabled={noLoja}>
                <Plus className="mr-2 h-4 w-4" />
                Registrar certificado
              </Button>
            }
          >
            {/*
              Modo sem certificado: a plataforma segue utilizável, com o fiscal dormente.
              "Configurado" exige TUDO junto — blobRef + senhaRef + status ATIVO + ativo=true.
              Metadados sem custódia NÃO contam como certificado instalado.
            */}
            {cofre ? (
              <p className="mb-4 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                Cofre de segredos: <span className="font-mono">{cofre.provider}</span>
                {" · "}
                {cofre.disponivel ? "disponível" : "indisponível (fail-closed)"}
                {" · "}
                {cofre.capacidades.escrita ? "custódia automática ativa" : "custódia por provisionamento manual"}
                {cofre.mensagem ? ` — ${cofre.mensagem}` : ""}
              </p>
            ) : null}
            {!algumCertificadoInstalado(certs) ? (
              <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Certificado digital ainda não configurado.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    O cadastro fiscal permanece dormente e a emissão de documentos fiscais fica bloqueada. Todos os demais
                    módulos (PDV, Operações, Financeiro, Estoque) continuam funcionando normalmente.
                  </p>
                </div>
              </div>
            ) : null}

            {certs.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                  <FileBadge className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-semibold text-foreground">Nenhum certificado registrado</p>
                <p className="max-w-md text-xs text-muted-foreground">
                  Registre os metadados do certificado A1 da loja. A senha e o arquivo permanecem no cofre seguro.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {certs.map((c) => (
                  <div key={c.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card-muted p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{c.apelido || c.titularCn || "Certificado"}</p>
                        {c.status === "REVOGADO" ? (
                          <Badge variant="destructive">Revogado</Badge>
                        ) : (
                          <Badge variant={c.ativo ? "default" : "outline"}>{c.ativo ? "Ativo" : "Inativo"}</Badge>
                        )}
                        <Badge variant="secondary">{c.tipo}</Badge>
                        {!certificadoTemCustodia(c) ? <Badge variant="outline">Não armazenado</Badge> : null}
                        {(() => {
                          const alerta = calcularAlertaVencimento(c.validoAte);
                          if (alerta.nivel === "vencido") return <Badge variant="destructive">Vencido</Badge>;
                          if (alerta.nivel === "critico") return <Badge variant="destructive">Vence em {alerta.diasRestantes}d</Badge>;
                          if (alerta.nivel === "aviso") return <Badge variant="secondary">Vence em {alerta.diasRestantes}d</Badge>;
                          return null;
                        })()}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.cnpjTitular ? `CNPJ ${c.cnpjTitular} · ` : ""}
                        {c.validoAte ? `Válido até ${new Date(c.validoAte).toLocaleDateString("pt-BR")}` : "Validade não informada"}
                        {" · "}
                        {c.blobConfigured ? "blob ✓" : "blob —"} / {c.senhaConfigured ? "senha-ref ✓" : "senha-ref —"}
                        {c.atualizadoEm ? ` · Atualizado em ${new Date(c.atualizadoEm).toLocaleDateString("pt-BR")}` : ""}
                      </p>
                      {!certificadoTemCustodia(c) ? (
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                          Apenas metadados: o arquivo A1 não está no cofre. Reenvie o certificado quando o cofre estiver
                          configurado para concluir a instalação.
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0">
                      {/* Sem custódia a ativação falharia em `blobRef_ausente` — não oferecer o botão.
                          Revogado é terminal: não reativa — registre um novo certificado. */}
                      {c.status === "REVOGADO" ? null : (
                        <Button
                          type="button"
                          variant={c.ativo ? "ghost" : "outline"}
                          size="sm"
                          disabled={!c.ativo && !certificadoTemCustodia(c)}
                          onClick={() => void toggleCert(c)}
                        >
                          {c.ativo ? "Desativar" : "Ativar"}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SettingsCard>

          {/* Status da configuração */}
          <SettingsCard title="Status da configuração" description="Resumo do que já está preenchido. Não habilita emissão.">
            <div className="grid gap-3 sm:grid-cols-2">
              <StatusRow ok={Boolean(form.cnpj && form.razaoSocial)} label="Dados da empresa (CNPJ + razão social)" />
              <StatusRow ok={Boolean(form.uf && form.municipio && form.codigoMunicipioIbge)} label="Endereço fiscal (UF, município, IBGE)" />
              <StatusRow ok={Boolean(form.cscId && form.cscConfigured)} label="CSC (ID + referência do token)" />
              <StatusRow
                ok={algumCertificadoInstalado(certs)}
                label="Certificado digital instalado e ativo"
                hint="Exige arquivo no cofre (blob + senha), validação e ativação"
              />
              <StatusRow ok={false} label="Emissão habilitada" hint="Permanece desligada nesta fase" neutral />
            </div>
          </SettingsCard>
        </>
      )}

      {/* Modal de registro de certificado */}
      <Dialog open={certModal} onOpenChange={setCertModal}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-background">
          <DialogHeader>
            <DialogTitle>Registrar certificado digital</DialogTitle>
            <DialogDescription>
              Informe os metadados e as referências seguras. <span className="font-medium text-foreground">Não digite a senha nem envie o arquivo .pfx aqui</span> —
              apenas a referência ao cofre (ex.: nome da chave de segredo / env).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <ModalField label="Apelido" value={certApelido} onChange={setCertApelido} placeholder="Certificado loja matriz" />
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={certTipo} onValueChange={setCertTipo}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A1">A1 (arquivo)</SelectItem>
                    <SelectItem value="A3">A3 (token/cartão)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ModalField label="Titular (CN)" value={certTitular} onChange={setCertTitular} placeholder="EMPRESA LTDA:00000000000100" />
              <ModalField label="CNPJ do titular" value={certCnpj} onChange={setCertCnpj} placeholder="00.000.000/0001-00" />
              <ModalField label="Número de série" value={certSerial} onChange={setCertSerial} />
              <ModalField label="Fingerprint (SHA-256)" value={certFingerprint} onChange={setCertFingerprint} />
              <div className="space-y-1.5">
                <Label>Válido de</Label>
                <Input type="date" value={certValidoDe} onChange={(e) => setCertValidoDe(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Válido até</Label>
                <Input type="date" value={certValidoAte} onChange={(e) => setCertValidoAte(e.target.value)} />
              </div>
            </div>
            <ModalField label="Referência do blob (.pfx no cofre)" value={certBlobRef} onChange={setCertBlobRef} placeholder="ex.: bucket-privado/loja-2/cert.pfx" />
            <ModalField label="Referência da senha (chave no cofre/env)" value={certSenhaRef} onChange={setCertSenhaRef} placeholder="ex.: FISCAL_CERT_SENHA_LOJA2" />
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>As referências apontam para o cofre seguro. O conteúdo do certificado e a senha nunca trafegam por esta tela nem são gravados em texto.</span>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => setCertModal(false)} disabled={certSaving}>Cancelar</Button>
            <Button type="button" onClick={() => void submitCert()} disabled={certSaving}>
              {certSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusRow({ ok, label, hint, neutral }: { ok: boolean; label: string; hint?: string; neutral?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card-muted px-3 py-2.5">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
      ) : (
        <CircleDashed className={`h-4 w-4 shrink-0 ${neutral ? "text-muted-foreground" : "text-amber-500"}`} />
      )}
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

function Field({ label, ...rest }: { label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input {...rest} />
    </div>
  );
}

function ModalField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function FiscalSection() {
  return <FiscalSectionContent />;
}
