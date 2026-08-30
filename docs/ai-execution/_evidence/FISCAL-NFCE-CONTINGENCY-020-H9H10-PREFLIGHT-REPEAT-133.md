# FISCAL-NFCE-CONTINGENCY-020 — H-9/H-10 pre-flight REPEAT pós-decouple (133)

Trilha `fiscal` · GOAL 020 (continuação) · repetição do pre-flight do 131 após o merge do 132.
Data: 2026-08-30 · Zero rede externa · Zero escrita de banco.

- **FINAL_MAIN**: `origin/main = 59454e95dea0694beb1bbe4525d17dc51168af2e`
  (c19e220 + merge autorizado do PR #127/132). Nova base oficial desta sessão; zero drift
  adicional. Branch `goal/fiscal-020-contingency-offline-nfce` reancorada por fast-forward.
- **AEP**: `track open fiscal` re-executado sobre a nova base (tentativa 1/3); `track verify`
  sem divergências. `track close` NÃO executado. GOAL 020 permanece RUNNING.

## PRE_FLIGHT = 10/10 (verde)

1. **Gate H-9/H-10 DORMENTE** — `WSDL_EPHEMERAL_EXECUTION_WINDOW = {null, null, null}`
   (inalterado pelo 132), presente nos dois deployments Production Ready atuais
   (`c19e220` = `dpl_BVbTH4C…` e `59454e9` = `dpl_FEhjeCZ…`).
2. **Alias canônico** — `omni-gestao-pro.vercel.app` aponta para o deployment Production READY
   do `59454e9` (pós-decouple). Superfície canônica Production-only intacta.
3. **Pilot store única** — evidência humana sanitizada do DB produção `omnigestao_prod`
   (aceita; nenhum acesso do agente, nenhuma credencial solicitada): exatamente UMA
   configuração fiscal; `loja-1`; `HOMOLOGACAO`; `NFCE`; `STUB_HOMOLOGACAO`;
   `fiscalEnabled=false`; certificado configurado/encontrado/ATIVO/ativo/vigente; refs
   presentes. Estado de produção === critérios do predicado `candidataAquisicaoWsdl` (132).
4. **A1 apto** — prova REAL em execução pela rota (`resolveActiveCertificate`: mesma store,
   ATIVO, vigente, refs, cofre) ANTES do consumo one-shot; material provisionado no runtime
   Production (`FISCAL_A1_PFX_B64_LOJA_1` / `FISCAL_A1_SENHA_LOJA_1`, env names via metadata).
5. **6 alvos fechados, GET-only** — projeção do catálogo HOMOLOGACAO/SP; caller não controla
   URL/host/path/porta/serviço/quantidade/retry.
6. **One-shot global** — advisory lock + dedupe cross-store + unique retaguarda; preservado
   (revisão independente 132, foco 5).
7. **Ledger** — 0 jobs `fiscal:wsdl:h9-h10:v1:*` no banco acessível; a activation futura ainda
   não existe (hash inédito ⇒ 0 consumos por construção). `activationId` novo só nascerá na
   FASE 3 do 131, após o gate humano.
8. **Nenhum deployment ON executável** — ambos os deployments atuais são dormentes; os únicos
   commits ON históricos (janela 24/08) expiraram em 2026-08-24T18:10Z (inertes por clock).
9. **Testes/validações (pós-merge, no código de produção)** — wsdl+rota 175/175;
   homologation+cert+contingência 111/111; typecheck OK; ESLint focado OK; build OK;
   `git diff --check` OK.
10. **Semântica de emissão intacta** — a piloto aceita para aquisição
    (`STUB_HOMOLOGACAO` + `fiscalEnabled=false`) permanece incapaz de emitir: queue-producer
    recusa com 423 `loja_fiscal_desabilitada`; contingência offline e snapshot seguem regidos
    pelos gates próprios (revisão independente 132, focos 1 e 9).

## Evidência de não-rede

- WSDL_EXTERNAL_GET_COUNT=0 · SEFAZ_REQUEST_COUNT=0 · SEFAZ_SOAP_POST_COUNT=0 ·
  SEFAZ_PRODUCTION_REQUEST_COUNT=0 · DATABASE_WRITE_COUNT=0
- Nenhuma função da aplicação foi invocada; nenhum segredo solicitado ou exposto.

## Classificação

**PRE_FLIGHT_SCORE = 10/10** · **READY_FOR_HUMAN_GATE = true** · Parado no HUMAN GATE do 131,
aguardando a autorização textual EXATA (nenhum GET antes dela). Janela proposta: 10 minutos
(dentro do teto de 15 min validado no runtime).
