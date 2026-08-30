# FISCAL-NFCE-CONTINGENCY-020 — Pre-flight pós-fix (136) · PRONTO PARA NOVO HUMAN GATE

Trilha `fiscal` · GOAL 020 (continuação) · pós FISCAL-020-H9H10-ADVISORY-LOCK-FIX-135.
Data: 2026-08-30 · Zero rede externa · Zero escrita em banco.

- **BASE/FINAL_MAIN**: `origin/main = 0e6a966` (940b4be + PR #131: evidência 134 + fix P2010 +
  prova PostgreSQL real). Branch oficial fast-forward.
- **AEP**: RUNNING · GOAL 020 aberto (tentativa 1/3) · `open` re-executado · `check` PASSOU
  (apto a ratificar — `close` NÃO executado, por ordem). GOAL 021 não iniciado.

## PRE_FLIGHT_SCORE = 10/10

1. **Primitive corrigido presente no deployment Production**: `dpl_3cGcnDA…` (URL `df3rh9vn4`,
   commit `0e6a966`) READY; alias canônico `omni-gestao-pro.vercel.app` promovido a ele. O fix
   `wsdlActivationAdvisoryLock` (`::text AS lock`) está no runtime canônico.
2. **Gate H-9/H-10 DORMENTE** — `WSDL_EPHEMERAL_EXECUTION_WINDOW = {null, null, null}` em
   `origin/main` (verificado por leitura no commit atual); nenhum activationId novo criado
   neste GOAL; nenhum timestamp calculado.
3. **Activation 30/08 proibida e não reutilizável** — `wsdl-h9h10-20260830-1440z-fed207ff67bc1c6d`
   na lista de proibidas do teste de dormência; além disso, a janela dela (14:40–14:50Z) é
   passado permanente.
4. **Pilot store única** — evidência humana válida do `omnigestao_prod` REUTILIZADA (GOAL 135 o
   autoriza): `loja-1` · HOMOLOGACAO · NFCE · STUB_HOMOLOGACAO · fiscalEnabled=false ·
   certificado configurado/encontrado/ATIVO/vigente · refs presentes. Nenhuma configuração
   fiscal produtiva foi alterada desde a leitura: este GOAL (e o 131 inteiro) executou ZERO
   escritas em banco (diagnóstico com rollback; chamada 409 falhou antes de qualquer write).
5. **Prova runtime do A1** — na execução 134, `resolveActiveCertificate` + SecureContext
   passaram em produção (guard anterior ao 409); envs `FISCAL_A1_*_LOJA_1` seguem
   provisionadas; nada foi alterado desde então.
6. **Prova do primitive corrigido contra PostgreSQL real** — 3/3 (P2010 isolado; cast limpo;
   transacional + serialização mesma-chave + isolamento chave-diferente + liberação pós-rollback).
7. **One-shot global intacto** — dedupeKey/advisory lock/findFirst cross-store/unique
   inalterados (revisão independente 135, focos 1-2); 0 consumos de qualquer activation WSDL
   no banco acessível; a futura activation (ainda inexistente) nascerá com hash inédito.
8. **Nenhum deployment ON** — produção atual: `0e6a966` (df3rh9vn4) e `940b4be` (i7htjryis),
   ambos dormentes; os 2 deployments ON de 30/08 seguem removidos (0 ocorrências no inventário).
9. **Superfície/contrato inalterados** — 6 alvos fechados HOMOLOGACAO/SP, GET-only, caller sem
   controle de destino, ADMIN, Production-only, regra 132 (fiscalEnabled=false + providers
   {STUB_HOMOLOGACAO, SEFAZ_DIRETO}) preservados.
10. **Validações do 135** — wsdl+rota+contingência+homologation+postgres-real: 250 pass / 3
    skip (suíte DB env-gated, por desenho); typecheck OK; ESLint OK; build OK; diff-check OK;
    revisão independente APROVADO P0=0 P1=0; WSDL_EXTERNAL_GET_COUNT=0 · SEFAZ_REQUEST_COUNT=0.

## Classificação

**A** (para o GOAL 135): bug P2010 corrigido e provado contra PostgreSQL real, fix integrado na
main e deployado, janela OFF, zero rede, pre-flight 10/10.

**READY_FOR_HUMAN_GATE = true** · READY_FOR_LIVE_EXECUTION = false (depende do novo gate).

Parado no HUMAN GATE: a autorização anterior valeu exclusivamente para a janela encerrada de
30/08 e NÃO pode ser reutilizada. Nenhum activationId gerado, nenhum timestamp calculado,
nenhum PR ON aberto — aguardando autorização humana ESPECÍFICA para uma NOVA execução H-9/H-10.
