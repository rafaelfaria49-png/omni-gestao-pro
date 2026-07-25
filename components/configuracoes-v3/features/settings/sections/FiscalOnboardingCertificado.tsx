"use client";

/**
 * Onboarding fiscal orientado pelo certificado A1 (GOAL-016B · itens 1, 5 e 7).
 *
 * O usuário envia o `.pfx`/`.p12` + senha; o SERVIDOR lê, extrai, reconcilia com a loja e devolve
 * uma prévia com a ORIGEM de cada campo. Só depois da confirmação humana algo é gravado.
 *
 * Regras respeitadas nesta tela:
 *  - A senha existe apenas no estado local até o envio e é limpa logo após a resposta.
 *  - Nada do certificado é processado no navegador — nem parse, nem leitura de chave.
 *  - Endereço, IE, CRT e CSC nunca são apresentados como vindos do certificado.
 *  - O nome comercial interno é campo próprio e nunca substitui a razão social.
 *  - Emissão continua desligada; este fluxo não transmite nada à SEFAZ.
 */

import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileKey, Loader2, ShieldCheck, Upload } from "lucide-react";
import { SettingsCard } from "../components/SettingsCard";
import { Input } from "@/components/configuracoes-v3/components/ui/input";
import { Label } from "@/components/configuracoes-v3/components/ui/label";
import { Button } from "@/components/configuracoes-v3/components/ui/button";
import { Badge } from "@/components/configuracoes-v3/components/ui/badge";
import { useToast } from "@/components/configuracoes-v3/hooks/use-toast";
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers";
// Tipos puros — não arrastam node-forge/node:crypto para o bundle do cliente.
import type {
  CampoIdentidadeFiscal,
  CampoOnboarding,
  OnboardingPreview,
  OrigemCampo,
} from "@/lib/fiscal/certificate/onboarding-types";

const ORIGEM_LABEL: Record<OrigemCampo, string> = {
  certificado: "Do certificado",
  fonte_cadastral: "Fonte cadastral",
  loja: "Herdado da loja",
  manual: "Informado agora",
  divergente: "Divergente",
  pendente: "Pendente",
};

function OrigemBadge({ origem }: { origem: OrigemCampo }) {
  if (origem === "divergente") return <Badge variant="destructive">{ORIGEM_LABEL.divergente}</Badge>;
  if (origem === "certificado") return <Badge variant="default">{ORIGEM_LABEL.certificado}</Badge>;
  if (origem === "pendente") return <Badge variant="outline">{ORIGEM_LABEL.pendente}</Badge>;
  return <Badge variant="secondary">{ORIGEM_LABEL[origem]}</Badge>;
}

function dataBr(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

export function FiscalOnboardingCertificado({
  storeId,
  onConfirmado,
}: {
  storeId: string;
  onConfirmado: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [lendo, setLendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [preview, setPreview] = useState<OnboardingPreview | null>(null);
  const [edits, setEdits] = useState<Partial<Record<CampoIdentidadeFiscal, string>>>({});
  const [apelido, setApelido] = useState("");

  const limparEntrada = () => {
    setSenha("");
    setArquivo(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const descartarPrevia = () => {
    setPreview(null);
    setEdits({});
    setApelido("");
    limparEntrada();
  };

  const valorDe = (campo: CampoOnboarding): string =>
    edits[campo.campo] !== undefined ? String(edits[campo.campo]) : campo.valor;

  const lerCertificado = async () => {
    if (!storeId || !arquivo || !senha) return;
    setLendo(true);
    try {
      const fd = new FormData();
      fd.append("certificado", arquivo);
      fd.append("senha", senha);
      const res = await fetch("/api/fiscal/onboarding/certificado", {
        method: "POST",
        credentials: "include",
        headers: { [ASSISTEC_LOJA_HEADER]: storeId },
        body: fd,
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        preview?: OnboardingPreview;
        error?: string;
        bloqueios?: { codigo: string; mensagem: string }[];
      };
      if (!res.ok || !j.preview) {
        toast({
          title: "Certificado não aceito",
          description: j.error || j.bloqueios?.[0]?.mensagem || `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      setPreview(j.preview);
      setEdits({});
      setApelido(j.preview.certificado?.nomeEmpresarial ?? "");
      toast({
        title: j.preview.podeConfirmar ? "Certificado lido" : "Certificado lido com pendências",
        description: j.preview.podeConfirmar
          ? "Revise os dados e confirme para gravar a identidade fiscal."
          : "Há bloqueios que impedem a confirmação.",
      });
    } catch (e) {
      toast({
        title: "Falha ao ler o certificado",
        description: e instanceof Error ? e.message : "Erro inesperado",
        variant: "destructive",
      });
    } finally {
      // A senha nunca permanece no estado após o envio.
      limparEntrada();
      setLendo(false);
    }
  };

  const confirmar = async () => {
    if (!preview?.certificado || !preview.podeConfirmar) return;
    setSalvando(true);
    try {
      const campos: Record<string, string> = {};
      for (const c of preview.campos) {
        const v = valorDe(c).trim();
        if (v) campos[c.campo] = v;
      }
      const res = await fetch("/api/fiscal/onboarding/confirmar", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: storeId },
        body: JSON.stringify({ certificado: preview.certificado, campos, apelido: apelido || undefined }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        bloqueios?: { codigo: string; mensagem: string }[];
      };
      if (!res.ok) {
        toast({
          title: "Não foi possível confirmar",
          description: j.error || j.bloqueios?.[0]?.mensagem || `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Identidade fiscal preenchida",
        description: "Certificado registrado como pendente de validação. A emissão permanece desligada.",
      });
      descartarPrevia();
      onConfirmado();
    } catch (e) {
      toast({
        title: "Falha ao confirmar",
        description: e instanceof Error ? e.message : "Erro inesperado",
        variant: "destructive",
      });
    } finally {
      setSalvando(false);
    }
  };

  const cert = preview?.certificado ?? null;

  return (
    <SettingsCard
      title="Onboarding pelo certificado digital (A1)"
      description="Envie o certificado A1 da loja: o sistema lê no servidor, confere o CNPJ com a unidade e preenche o que puder. Você confirma o restante. O arquivo e a senha não são gravados."
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor="fiscal-a1-arquivo">Arquivo do certificado (.pfx ou .p12)</Label>
          <Input
            id="fiscal-a1-arquivo"
            ref={fileRef}
            type="file"
            accept=".pfx,.p12"
            disabled={lendo || salvando}
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor="fiscal-a1-senha">Senha do certificado</Label>
          <Input
            id="fiscal-a1-senha"
            type="password"
            value={senha}
            autoComplete="off"
            placeholder="Usada apenas para abrir o arquivo no servidor"
            disabled={lendo || salvando}
            onChange={(e) => setSenha(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void lerCertificado()} disabled={!arquivo || !senha || lendo || salvando}>
          {lendo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          {lendo ? "Lendo certificado…" : "Ler certificado"}
        </Button>
        {preview ? (
          <Button type="button" variant="ghost" onClick={descartarPrevia} disabled={salvando}>
            Descartar leitura
          </Button>
        ) : null}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        A senha é usada apenas para abrir o container no servidor e é descartada em seguida. O arquivo, a senha e a chave
        privada não são gravados em banco, log ou disco.
      </p>

      {preview ? (
        <div className="mt-6 space-y-5 border-t border-border pt-5">
          {/* ── Bloqueios ───────────────────────────────────────────────────────── */}
          {preview.bloqueios.length > 0 ? (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Confirmação bloqueada</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
                  {preview.bloqueios.map((b) => (
                    <li key={b.codigo}>{b.mensagem}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              <p className="text-sm text-muted-foreground">
                CNPJ do certificado confere com a unidade ativa. Revise os campos abaixo e confirme.
              </p>
            </div>
          )}

          {/* ── Extraído do certificado ─────────────────────────────────────────── */}
          {cert ? (
            <div className="rounded-lg border border-border bg-card-muted p-4">
              <div className="flex items-center gap-2">
                <FileKey className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">Extraído do certificado</p>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                <Linha rotulo="Titular (CN)" valor={cert.titularCn || "—"} />
                <Linha rotulo="CNPJ do titular" valor={cert.cnpj || "não identificado"} />
                <Linha rotulo="Autoridade certificadora" valor={cert.autoridadeCertificadora || "—"} />
                <Linha rotulo="Número de série" valor={cert.serialNumber || "—"} />
                <Linha rotulo="Validade" valor={`${dataBr(cert.validoDe)} até ${dataBr(cert.validoAte)}`} />
                <Linha rotulo="Fingerprint (SHA-1)" valor={cert.fingerprintSha1 || "—"} />
                <Linha rotulo="Cadeia no arquivo" valor={cert.cadeiaDisponivel ? "presente" : "ausente"} />
                <Linha rotulo="E-mail no certificado" valor={cert.email || "não informado"} />
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                Endereço, inscrição estadual, regime/CRT e CSC não existem no certificado — vêm da loja, da fonte cadastral
                ou do seu preenchimento.
              </p>
            </div>
          ) : null}

          {/* ── Fonte cadastral ─────────────────────────────────────────────────── */}
          {preview.lookup.status !== "ok" ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
              {preview.lookup.mensagem || "Consulta cadastral externa indisponível."} Os campos não confirmados foram
              pré-preenchidos com o cadastro da própria loja.
            </p>
          ) : (
            <p className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
              Fonte cadastral: {preview.lookup.fonte} · consultada em {dataBr(preview.lookup.consultadoEm)}.
            </p>
          )}

          {/* ── Campos com origem ───────────────────────────────────────────────── */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground">Confira os dados antes de gravar</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {preview.campos.map((c) => (
                <div key={c.campo} className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={`onb-${c.campo}`}>{c.rotulo}</Label>
                    <OrigemBadge origem={c.origem} />
                  </div>
                  <Input
                    id={`onb-${c.campo}`}
                    value={valorDe(c)}
                    disabled={salvando || c.campo === "cnpj"}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [c.campo]: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    {c.origem === "divergente"
                      ? `Conflito: "${c.valorAlternativo}" em ${c.fonteAlternativa}. Escolha o valor correto.`
                      : c.origem === "pendente"
                        ? "Nenhuma fonte forneceu este dado — preencha se souber."
                        : c.campo === "nomeFantasia"
                          ? "Nome comercial interno — não substitui a razão social."
                          : `Fonte: ${c.fonte}`}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Apelido do certificado ──────────────────────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="onb-apelido">Apelido do certificado (interno)</Label>
              <Input
                id="onb-apelido"
                value={apelido}
                disabled={salvando}
                placeholder="Certificado da matriz"
                onChange={(e) => setApelido(e.target.value)}
              />
            </div>
          </div>

          {/* ── Custódia do segredo ─────────────────────────────────────────────── */}
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Custódia do certificado pendente</p>
              <p className="mt-1 text-sm text-muted-foreground">{preview.custodia.mensagem}</p>
              <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                {preview.custodia.blobRefEsperada} · {preview.custodia.senhaRefEsperada}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void confirmar()} disabled={!preview.podeConfirmar || salvando}>
              {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              {salvando ? "Gravando…" : "Confirmar e preencher identidade fiscal"}
            </Button>
            <span className="text-xs text-muted-foreground">
              A emissão permanece desligada e nada é transmitido à SEFAZ.
            </span>
          </div>
        </div>
      ) : null}
    </SettingsCard>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="break-all text-foreground">{valor}</dd>
    </div>
  );
}
