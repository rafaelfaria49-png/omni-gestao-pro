# FISCAL-020 — LIVE READINESS INTERNAL (127)

GOAL: FISCAL-NFCE-CONTINGENCY-020 (continuação) · branch `goal/fiscal-020-contingency-offline-nfce`
Base auditada: `75a2f24d1fe1e636be9b323061a15f612a4ccb52` · `origin/main` esperado e confirmado: `3973cf540ca60cb0330eeaec3c204fae5ef37771`
Restrições: nenhuma chamada SEFAZ/WSDL neste GOAL; janela `CONTINGENCY_HOMOLOGATION_WINDOW` permanece literalmente nula (dormente).

## 1. Auditoria inicial obrigatória (HEAD 75a2f24, por leitura)

| # | Ponto | Estado encontrado |
|---|---|---|
| 1 | `readXsdAttestation` do drill defaulta `null` | ✅ Confirmado — `contingency-drill-wiring.ts` (portas D4; default fail-closed, guard 8 bloqueia) |
| 2 | One-shot consumido antes dos guards D4 do provider | ✅ Confirmado — passo 6 do `execute` consome; guards D4 só rodam dentro do provider (passo 8). Não existia pre-flight XSD pré-one-shot: falha de XSD no guard 8 queimaria a ativação |
| 3 | Freio GOAL-011 converte sucesso real de `CONTINGENCIA_TRANSMISSAO` em terminal | ✅ Confirmado — `queue-worker.ts` converte toda execução `simulado=false` não isenta em `terminal/provider_real_bloqueado`; não existia prova tipada de autorização |
| 4 | `transmit` termina em `resposta_sem_parser_neste_slice` | ✅ Confirmado — `sefaz-direto-provider.ts` descartava resposta HTTP recebida |
| 5 | `consult` termina em `consulta_sem_payload_neste_slice` | ✅ Confirmado — não existia construtor `consSitNFe` |
| 6 | `parseSefazSoapResponse` existe e suporta contratos aplicáveis | ✅ Confirmado — `NFeAutorizacao4`, `NFeRetAutorizacao4`, `NFeConsultaProtocolo4`; desconectado do P2; `AUTHORIZED` exige `nfeProc` verbatim que as respostas reais não trazem (só `protNFe`) |
| 7 | Estado real de H-9/H-10 | ✅ **EXTERNAL_BLOCKER** — janela WSDL `wsdl-h9h10-20260824-1800z` expirada (2026-08-24T18:10Z); nenhum artefato WSDL/SOAPAction persistido no repositório; nenhum modelo/registro de aquisição. Sem `SOAPAction`, o transporte real permanece indevido |

## 2. Blockers internos adicionais descobertos (antes de alterar código)

| ID | Blocker | Efeito se não fechado |
|---|---|---|
| B-1 | **Wire de `NFeAutorizacao4` sem `enviNFe`** — o leiaute oficial (PL_010e_v1.02, `TEnviNFe` no XSD versionado) exige corpo `<enviNFe><idLote/><indSinc/><NFe/></enviNFe>`; o repositório transmitia a NFe assinada nua dentro de `nfeDadosMsg` | Requisito mal-formado na SEFAZ; drill real falharia de forma atribuível a erro nosso |
| B-2 | **Modalidade não declarada/audited** — `indSinc` não existia em nenhum construtor. Decisão: **síncrona (`indSinc=1`)**, a única modalidade de NFC-e no piloto SP; consequência: `103/105` não ocorre no modo efetivamente usado, mas o parser continua cobrindo `103/105`/`nRec` (`NFeRetAutorizacao4`) para defesa em profundidade | Impossível auditar síncrona vs assíncrona; resposta síncrona com `protNFe` ficaria sem tratamento |
| B-3 | **`AUTHORIZED` inalcançável por respostas reais** — o parser exige `nfeProc` verbatim na resposta; os serviços do piloto devolvem apenas `protNFe` ⇒ todo `100` virava `INCOMPLETE_AUTHORIZATION/UNCERTAIN` para sempre | Reconciliação jamais resolveria um documento autorizado |
| B-4 | **Consulta não executável** — jobs `CONSULTA` do documento do drill eram drenados pelo wiring genérico do piloto, cujo transporte é offline e cuja capability é negada ⇒ reconciliação pós-drill (timeout/incerteza) sem autoridade executável | Documento em `TRANSMITINDO` sem caminho de resolução |
| B-5 | **Freio GOAL-011 sem prova tipada** — mesmo um sucesso real autorizado do drill virava `FALHA` reprocessável | Drill nunca conclui; pior, `FALHA` convidaria reprocesso sem ativação |

## 3. Correções deste GOAL (todas offline, zero SEFAZ)

1. **XSD pre-flight antes do one-shot** (drill): carregar bytes persistidos → SHA-256 → validar os MESMOS bytes pelo worker XSD canônico (`validarXsd` → `xsd-worker/client`) → exigir `VALIDACAO_APROVADA`, `xmlSha256` idêntico, pacote/manifest esperados → produzir `SefazXsdAttestation` vinculada aos mesmos bytes e REUSÁ-LA no guard 8 da mesma execução. Worker ausente/timeout/resposta divergente/XML inválido ⇒ fail-closed SEM consumir o one-shot. Sem segundo validador.
2. **Pre-flight determinístico pré-one-shot ampliado**: endpoint do catálogo (NFeAutorizacao4/HOMOLOGACAO/SP) e certificado ativo por referência também provados antes do consumo; guards D4 re-run completos imediatamente antes do transporte (anti-TOCTOU, inalterado).
3. **Compositor `enviNFe` mínimo** (`sefaz-lote-envinfe.ts`): concatenação pura de bytes — NFe assinada permanece byte-idêntica no interior (prova por teste); `idLote` fixo `1` e `indSinc` fixo `1` (constantes declaradas; idLote é controle de requisição, não numeração de documento — NUMBER_REUSE=0).
4. **Builder `consSitNFe` mínimo** (`sefaz-consulta-payload.ts`): contrato oficial `NFeConsultaProtocolo4`, apenas chave + `tpAmb=2` + `xServ=CONSULTAR`; sem reconstrução de documento, sem numeração.
5. **Compositor `nfeProc` mínimo** (dentro do parser): preserva integralmente a NFe assinada (recorte verbatim), incorpora somente o `protNFe` recebido (recorte verbatim, único), valida mesma chave/cStat/protocolo e `infNFe/@Id`; jamais reconstrói a NFe. Teste prova trecho NFe byte-idêntico.
6. **`transmit` classifica a resposta** com `parseSefazSoapResponse` (serviço explícito, chave esperada, resposta bounded, matriz cStat existente) → `toFiscalTransmissionResult`. `resposta_sem_parser_neste_slice` eliminado do caminho de sucesso HTTP.
7. **`consult` executável** → guards (modo consulta) → `consSitNFe` → envelope → transporte → parser `NFeConsultaProtocolo4` → `toFiscalConsultationResult` (`217` ⇒ `NOT_FOUND`; nunca retry de transmissão).
8. **Prova tipada no freio GOAL-011**: o executor produz `contingencyExternalAuthorization` APENAS quando (a) capability desta execução tem `allowExternalProviderExecution=true`, (b) proveniência diz `providerInvoked`, (c) desfecho é autorização com evidência fiscal completa persistida (`markAuthorized`). O freio só atravessa com a prova COERENTE com o job (id/store/notaFiscal). Evidência forjada (sem capability ou com vínculo divergente) não passa. Generic drain: sem capability ⇒ sem prova ⇒ freio intacto.
9. **Consulta escopada do drill**: `acquireNextJob` do drill também adquire jobs `CONSULTA` do MESMO documento/loja (fallback quando o job de transmissão já não é elegível), com capability de consulta nascida da janela vigente por execução — leitura only, sem one-shot.
10. **JOB FALHA (P3)**: falha pré-one-shot (XSD rejeitado, worker ausente, guard/cert/endpoint) NÃO consome a ativação e NÃO destrói o drill — provado por teste (ativação consumível depois). Falha pós-one-shot/pré-rede deixa o job em `FALHA` fail-closed (sem retransmissão); recuperação de drill exige NOVA ativação (novo `activationId` ⇒ nova `dedupeKey`), provado por teste.
11. **H-9/H-10**: classificados honestamente como EXTERNAL_BLOCKER (sem SOAPAction/WSDL oficial). `READY_FOR_LIVE_EXECUTION=false`; `READY_FOR_EXTERNAL_GATE` avaliado no ponto de parada.
12. **Produção**: inalterada — catálogo nega `PRODUCAO`; gate `CONTINGENCY_HOMOLOGATION_WINDOW` permanece `{null,null,null}`; todos os testes usam janela injetada/sintética.

## 4. Validações executadas (worktree GOAL 020, janela dormente, zero rede)

| Validação | Resultado |
|---|---|
| Contingência/drill (`lib/fiscal/contingencia`) | ✅ 25 testes (wiring) + gate + offline — verde |
| Fila / GOAL-011 / GOAL-012 (`lib/fiscal/queue`) | ✅ verde (incl. 8 testes novos do freio com prova tipada) |
| Provider / guards / parser (`lib/fiscal/provider`) | ✅ 603 testes — verde (1 flake pré-existente de timeout no backstop de importadores, passa isolado) |
| XSD worker client (`lib/fiscal/xsd-worker`) | ✅ verde |
| Emissão / reconciliação (`lib/fiscal/emission`) | ✅ verde |
| Regressão 018 (eventos/cancelamento) | ✅ verde |
| Regressão 019 (inutilização) | ✅ verde |
| Typecheck (`npm run typecheck`) | ✅ 0 erros |
| ESLint focado (arquivos alterados) | ✅ limpo |
| Build (`npm run build`) | ✅ concluído |
| `git diff --check` | ✅ limpo |
| SEFAZ_REQUEST_COUNT | **0** — nenhum teste/route abre rede; todos os transportes são injetados; nenhuma chamada SEFAZ/WSDL nesta execução |

## 5. Ponto de parada (preenchimento do template do GOAL)

- **XSD_PREFLIGHT_BEFORE_ONESHOT**: `true` — bytes persistidos validados pelo worker canônico (`validarXsd`), `VALIDACAO_APROVADA`, pacote/manifest conferidos, atestação vinculada ao mesmo SHA-256 e reusada no guard 8.
- **ONESHOT_BURN_ON_PREFLIGHT_FAILURE**: `false` — XSD rejeitado, worker ausente, endpoint/cert indisponíveis ⇒ fail-closed SEM consumir (provado por teste: ativação consumível depois).
- **GOAL011_REAL_CONTINGENCY_AUTH**: `true` — prova tipada produzida no executor (capability + providerInvoked + autorização persistida) e conferida contra o job.
- **GENERIC_DRAIN_EXTERNAL**: `false` — drain genérico sem capability ⇒ sem prova ⇒ freio intacto.
- **TRANSMIT_RESPONSE_PARSER**: conectado — resposta classificada por `parseSefazSoapResponse` (serviço explícito, chave esperada, corpo bounded, matriz cStat); `resposta_sem_parser_neste_slice` eliminado.
- **AUTHORIZED_XML_STRATEGY**: composição canônica mínima de `nfeProc` (NFe assinada verbatim + `protNFe` recebido verbatim, vínculos conferidos); nunca reconstrói a NFe.
- **CONSULT_PAYLOAD_READY**: `true` — `consSitNFe` canônico (chave + tpAmb 2 + xServ); `217` ⇒ `NOT_FOUND`, nunca retry.
- **PROCESSING_103_105_READY**: `true` — modalidade efetiva é SÍNCRONA (`indSinc=1`), logo `103/105` não ocorre no modo usado; mesmo assim `103/105`+`nRec` ⇒ `PROCESSING` com reconsulta do mesmo recibo (parser + fila, provado por teste).
- **H9_STATUS**: EXTERNAL_BLOCKER — janela WSDL expirada (2026-08-24T18:10Z), sem WSDL/SOAPAction no repositório.
- **H10_STATUS**: EXTERNAL_BLOCKER — idem; nenhum artefato oficial de contrato no repo.
- **FAILED_JOB_RECOVERY_STATUS**: falha pré-one-shot não destrói o drill (testado); falha pós-one-shot/pré-rede é fail-closed (sem retransmissão; replay recusado na mesma e em nova ativação com documento já promovido — testado); reconciliação pós-drill executável pela consulta escopada.
- **SAME_XML_BYTES**: `true` — bytes persistidos imutáveis; NFe assinada byte-idêntica dentro do `enviNFe` e do `nfeProc` (provas por teste).
- **NUMBER_REUSE_COUNT**: `0` — `idLote` é controle de requisição fixo; nenhuma numeração criada/reusada.
- **PRODUCTION_ALLOWED**: `false` — catálogo nega produção; gate dormente `{null,null,null}` preservado.
- **READY_FOR_EXTERNAL_GATE**: `true` — bloqueios internos fechados; pendências são apenas as externas H-9/H-10.
- **READY_FOR_LIVE_EXECUTION**: `false` — depende de H-9/H-10 (SOAPAction/WSDL oficial) e da ativação humana da janela.
- **GOAL_021_STARTED**: `false`.
