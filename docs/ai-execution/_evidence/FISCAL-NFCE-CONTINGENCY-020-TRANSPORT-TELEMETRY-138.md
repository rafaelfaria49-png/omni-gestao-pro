# FISCAL-NFCE-CONTINGENCY-020 — Telemetria sanitizada de transporte WSDL (138)

Trilha `fiscal` · GOAL 020 (continuação) · FISCAL-020-H9H10-TRANSPORT-TELEMETRY-138.
Data: 2026-08-30 · **ZERO rede externa durante todo o GOAL** · Janela `null/null/null` do início ao fim.

## Entrega

Telemetria sanitizada e tipada no transporte WSDL para que a futura execução autorizada
distinga a **classe técnica** da falha que a 2ª execução (evidência 137) reportou apenas como
`wsdl_rede_incerta` 6/6, sem expor dado sensível.

- `wsdl-acquisition.ts` (commit `6c0164c` → PR **#134** → merge `71e1ca4` em `main`):
  - `transportPhase` (fase **observada**, nunca inferida): `REQUEST_CREATE` ·
    `BEFORE_SECURE_CONNECT` · `SECURE_CONNECT` · `RESPONSE_STREAM` · `REQUEST_LIFECYCLE`.
    Ausência de `secureConnect` NÃO vira "TLS"; DNS/TCP distinguem-se pelo código.
  - `transportClass` (enum fechado): `DNS` · `TCP_CONNECT` · `TLS_CERTIFICATE` ·
    `TLS_HANDSHAKE` · `CONNECTION_RESET` · `TIMEOUT` · `RESPONSE_STREAM` · `UNKNOWN_NETWORK`,
    derivado **exclusivamente** da allow-list fechada `WSDL_NODE_TRANSPORT_ERROR_CLASSES`
    (21 códigos Node que o caminho `GET ?wsdl` realmente produz).
  - `transportCode`: só código allowlisted; caso contrário `WSDL_TRANSPORT_UNKNOWN_CODE`
    (`"UNKNOWN"`). `classifyWsdlTransportError` é pura e lê **somente** `error.code`.
  - Timeouts preservados: `wsdl_timeout_conexao` / `wsdl_deadline_total` continuam existindo
    (não colapsam em `wsdl_rede_incerta`) e carregam classe `TIMEOUT` com a fase observada.
- `wsdl-ephemeral-batch.ts`: cada um dos 6 resultados carrega a SUA telemetria
  (`transportPhase/transportClass/transportCode` por serviço; `null` onde não há falha de
  rede). Ordem dos 6 alvos, máximo, destinos, GET, one-shot e ausência de retry intocados.
- Rota administrativa **inalterada** (telemetria viaja no resultado do batch; nenhuma exceção
  Node crua é publicada).
- Nunca derivado/lido: `message`, `stack`, `cause`, `syscall`, `address`, `hostname`, IP,
  certificado peer, fingerprint, subject/issuer, PFX, senha, blobRef, senhaRef, cookie, token.

## Testes (runtime/seams falsos — ZERO socket externo; loopback `127.0.0.1` apenas)

- Classificador puro: `ENOTFOUND`/`EAI_AGAIN`→DNS; `ECONNREFUSED`/`EHOSTUNREACH`/
  `ENETUNREACH`→TCP_CONNECT; `ECONNRESET`/`EPIPE`→CONNECTION_RESET; `ETIMEDOUT`→TIMEOUT;
  6 códigos de cadeia/identidade→TLS_CERTIFICATE; `EPROTO` + 5 TLS→TLS_HANDSHAKE;
  desconhecido/ausente→`UNKNOWN_NETWORK`/`UNKNOWN`.
- Integrações **reais** em loopback: ECONNREFUSED (porta fechada), reset pré-TLS,
  cadeia CA divergente (TLS_CERTIFICATE real, fase `SECURE_CONNECT`), handshake contra
  bytes não-TLS (TLS_HANDSHAKE real), corte pós-resposta (`RESPONSE_STREAM` com
  `ECONNRESET` em `transportCode`).
- Sanitização: erros **envenenados** com hostname, IP, caminho local, blobRef, senha e stack
  falsos — nenhum valor aparece no outcome serializado; `scanForSecrets` verde; o outcome
  real de `ECONNREFUSED` não contém IP/porta/mensagem crua.
- `externalTransmissionAttempted` com a semântica honesta anterior em todos os desfechos
  (`REQUEST_CREATE` → `false`; demais pontos de rede → `true`), verificado caso a caso
  contra a versão base.

## Validações

- wsdl acquisition + ephemeral batch + rota administrativa + authority/one-shot +
  superfície canônica + certificado/A1 + contingência 020: **386 pass / 3 skip** (suíte
  Postgres env-gated, por desenho).
- typecheck OK · ESLint focado OK · build OK · `git diff --check` OK.
- `track check fiscal`: PASSOU (close NÃO executado, por ordem). GOAL 021 não iniciado.
- Revisão independente read-only (outra família): **APROVADO — P0=0, P1=0**, 7/7 focos
  (mensagem/stack crua; allowlist; TLS; destino; retry; emissão; janela OFF) + verificação
  caso a caso de `externalTransmissionAttempted` e dos gatilhos de timeout. P3s informativos
  (fase pós-handshake mapeada a `RESPONSE_STREAM` por decisão conservadora documentada;
  `transportCode` tipado `string` com invariante garantido por construção/testes).
- Checks do PR #134: 6/6 verdes (unit/contract ubuntu+windows, container/offline/supply
  chain, Vercel preview ×2).
- `WSDL_EXTERNAL_GET_COUNT=0` · `SEFAZ_REQUEST_COUNT=0` · `SEFAZ_SOAP_POST_COUNT=0`.

## GIT

- BASE: `origin/main = 97ae815` · HEAD_INITIAL da branch: `1285dcd` (evidência 137) ·
  commit de implementação: `6c0164c` · PR **#134** (merge normal, sem squash/rebase/force) ·
  **FINAL_MAIN: `71e1ca4`**.

## PRE_FLIGHT_SCORE = 10/10 (pós-merge)

1. **Telemetria nova presente no deployment Production OFF**: auto-deploy pós-merge
   `dpl_7Er9hEXWHFSWZifYW4qvyYprxqjh` (`omni-gestao-7remef8db…`) · target `production` ·
   **READY** 3m · builds em `gru1`; alias canônico `omni-gestao-pro.vercel.app` apontado a
   ele (criado 19:35:07-03:00 de 30/08, único deploy de `main` desde `5re3ot85f`=`97ae815`,
   logo contém `71e1ca4`).
2. **Janela DORMENTE** — `WSDL_EPHEMERAL_EXECUTION_WINDOW = {null, null, null}` verificado
   por leitura no worktree `71e1ca4`; nenhum activationId criado; nenhum timestamp calculado.
3. **Deployments ON seguem removidos** — `kgrebn210` e `5nvmii0dv`: "Can't find the
   deployment" no inventário atual; nenhum deployment ON executável restante.
4. **Config piloto compatível** — ZERO escritas em banco neste GOAL; última leitura humana
   válida reutilizada (136): `loja-1` · HOMOLOGACAO · NFCE · fiscalEnabled=false ·
   certificado ativo; prova runtime adicional: o preflight completo (incl. piloto + A1)
   passou em produção na execução 137 (20:05Z) e nada foi alterado desde então.
5. **A1 preflight válido** — envs `FISCAL_A1_*` inalteradas (nenhuma escrita); prova runtime
   da execução 137 (`resolveActiveCertificate` + SecureContext em produção).
6. **One-shot/global ledger íntegro** — nenhuma chamada administrativa neste GOAL → 0
   consumos; código do ledger/advisory lock/dedupe intocado (revisão foco 7 + suíte verde).
7. **Guards preservados** — HOMOLOGACAO/SP, 6 alvos, GET one-shot, sem retry, redirect zero,
   `rejectUnauthorized=true`, TLS ≥ 1.2, ADMIN, Production-only, piloto dinâmica,
   `fiscalEnabled=false`, tetos de timeout/body, caller sem URL/host/path/porta (revisão
   independente 7/7).
8. **Zero rede neste GOAL** — todos os testes exclusivamente loopback `127.0.0.1`
   (verificado pela revisão); nenhuma chamada externa a SEFAZ ou qualquer outro host;
   nenhum GET WSDL, nenhum SOAP.
9. **Evidência 137 incluída no PR** — commit `1285dcd` é ancestral direto do merge `71e1ca4`.
10. **Incidente operacional menor, contido e documentado**: o comando `vercel aliases
    omni-gestao-pro` (esperado: listar) foi interpretado pela CLI v57 como atribuição e
    apontou o alias canônico ao deployment do projeto `omni-gestao` (`rlnfk7pbs`) por ~60s.
    Restaurado com `vercel alias set` ao alvo exato anterior (`7remef8db`, confirmado pelo
    inspect anterior à atribuição). Impacto no gate: NENHUM (janela OFF em todos os
    deployments envolvidos → rota 404 em qualquer alvo; nenhuma chamada foi feita).

## Classificação

**A** — telemetria sanitizada integrada na `main` e em Production, zero rede, janela OFF,
P0=P1=0, pre-flight 10/10, **pronto para novo human gate diagnóstico**.

**READY_FOR_DIAGNOSTIC_HUMAN_GATE = true** · READY_FOR_LIVE_EXECUTION = false (depende do
gate). A autorização anterior NÃO é reutilizável. PARADO — aguardando autorização textual
específica para a execução de diagnóstico H-9/H-10.
