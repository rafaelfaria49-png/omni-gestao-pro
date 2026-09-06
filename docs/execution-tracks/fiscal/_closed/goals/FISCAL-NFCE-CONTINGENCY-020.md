<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "FISCAL-NFCE-CONTINGENCY-020",
  "track": "fiscal",
  "title": "Contingência offline manual da NFC-e com transmissão posterior imutável",
  "status": "READY",
  "class": "C3",
  "risk_tier": "ALTO",
  "branch": "goal/fiscal-020-contingency-offline-nfce",
  "worktree": "C:/Projetos/omni-gestao-fiscal-020-contingency-offline-nfce",
  "test_command": "npx vitest run lib/fiscal/contingencia app/api/fiscal/contingencia",
  "allowlist": [
    "lib/fiscal/**",
    "app/api/fiscal/**",
    "docs/fiscal/**",
    "docs/architecture/**",
    "docs/decisions/**",
    "docs/ai/CURRENT_STATUS.md",
    "docs/ai-execution/_evidence/**"
  ],
  "gates_liberados": [],
  "read_budget": 120,
  "plan_ref": "FISCAL-FABLE5-CONTINUATION-MASTERPLAN-001",
  "plan_rev": 1,
  "familia_executor": "codex",
  "revisao_independente": true,
  "reversibilidade": "documento fiscal e bytes assinados são append-only; correções usam nova tentativa e nunca reescrevem o snapshot persistido",
  "gates_extra": [
    {
      "id": "sefaz_homologacao",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "production",
      "status": "requer_aprovacao",
      "dependencias": []
    }
  ],
  "gate_humano": {
    "requerido": true,
    "pendente": false,
    "aprovacao": {
      "aprovado": true,
      "autorizacao": "Autorizo iniciar o GOAL 020 — FISCAL-NFCE-CONTINGENCY-020. Esta autorização substitui expressamente a restrição anterior de não iniciar o GOAL 020. Produção, GOAL 021 e DANFCE/QR final permanecem proibidos.",
      "registrado_por": "usuário nesta sessão",
      "em": "2026-08-28T00:00:00Z"
    }
  }
}
-->

# FISCAL-NFCE-CONTINGENCY-020 — Contingência offline manual da NFC-e com transmissão posterior imutável

- trilha: `fiscal`
- classe: C3 · status: READY
- plano: `FISCAL-FABLE5-CONTINUATION-MASTERPLAN-001` (plan_rev 1)
- branch: `goal/fiscal-020-contingency-offline-nfce`
- teste: `npx vitest run lib/fiscal/contingencia app/api/fiscal/contingencia`

## Fontes (documentos de origem — o importador NÃO reimplementa nada)

- `danfe_nfce_qrcode_v6`: `https://hom.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=i0rK6ogxnx8%3D`
- `especificacao_do_goal`: `pasted-text-1.txt (anexo do usuário)`
- `manual_contingencia_offline_nfce_v2`: `https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=fMhAfsQfE%2BM%3D`
- `masterplan`: `docs/fiscal/FISCAL_FABLE5_CONTINUATION_MASTERPLAN_001.md`
- `moc_anexo_i`: `https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=J%2BIv4eN00E%3D`
- `nt_2025_001_qrcode_v3`: `https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=NvuzQGYd6E8%3D`
- `portaria_sre_40_2024`: `https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-40-de-2024.aspx`
- `rc_31961_2025`: `https://legislacao.fazenda.sp.gov.br/Paginas/RC31961_2025.aspx`

## Allowlist

- `lib/fiscal/**`
- `app/api/fiscal/**`
- `docs/fiscal/**`
- `docs/architecture/**`
- `docs/decisions/**`
- `docs/ai/CURRENT_STATUS.md`
- `docs/ai-execution/_evidence/**`

## Critério de pronto

- <PREENCHER>
