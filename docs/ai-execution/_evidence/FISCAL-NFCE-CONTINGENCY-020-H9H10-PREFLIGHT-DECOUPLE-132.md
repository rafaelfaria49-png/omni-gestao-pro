# FISCAL-NFCE-CONTINGENCY-020 — H-9/H-10 decouple pilot rule (132)

Trilha `fiscal` · GOAL 020 (continuação) · FISCAL-020-H9H10-PREFLIGHT-DECOUPLE-132.
Data: 2026-08-30 · Zero rede externa · Zero escrita de banco (DATABASE_WRITE_COUNT=0).

## Evidência humana aceita (DB produção `omnigestao_prod`, leitura sanitizada pelo humano)

`loja-1`: `HOMOLOGACAO` · `NFCE` · `STUB_HOMOLOGACAO` · `fiscalEnabled=false` ·
certificado configurado/encontrado · status `ATIVO` · `ativo=true` · vigente · refs presentes.
⇒ A1/cadeia apta. O blocker do pre-flight 131 vinha somente da regra do refresh 129
(`SEFAZ_DIRETO` + `fiscalEnabled=true`), que exigia estado de emissão que a produção não tem —
e não deve ter durante a aquisição.

## Auditoria pré-edição (8/8 verdadeira — superfície WSDL sem caminho de emissão)

1. não chama `provider.emitir` — nenhum import de provider/emissão na rota/batch/aquisição ✓
2. não chama transmissão SOAP POST — método fixo `GET`, `end()` sem corpo, authority recusa
   qualquer opção divergente (método/path/host/porta) ✓
3. não reserva numeração — nenhum import de `numbering` ✓
4. não cria `NotaFiscal` — únicas escritas: job técnico `CONSULTA/CONCLUIDO` + `FiscalLog` de
   consumo (one-shot) ✓
5. não altera `Venda` — apenas campo técnico `vendaId` no job (string `wsdl-h9-h10:<hash>`) ✓
6. não usa provider-factory para emissão ✓
7. somente GET mTLS para os 6 alvos fechados do catálogo (HOMOLOGACAO/SP) ✓
8. A1 exclusivamente para autenticação TLS (material descartado após SecureContext) ✓

Único grep de "emitir" na superfície: mensagem de erro "emitir a authority" (token, não documento).
`c14n` na extração: apenas parser/estrutura XML offline.

## Mudanças (diff restrito ao H-9/H-10)

- `wsdl-pilot-store-resolver.ts`: critérios da piloto de aquisição passam a ser
  `HOMOLOGACAO` + `NFCE` + **`fiscalEnabled=false` (obrigatório)** + **`provider` em
  {`STUB_HOMOLOGACAO`, `SEFAZ_DIRETO`}** + `certificadoAtivoId` presente. Novo predicado
  canônico exportado `candidataAquisicaoWsdl` — fonte única compartilhada por resolver e rota
  (fecha o P2(4) da revisão 129). Exactly-UMA-candidata preservado (0 → `no_candidate`;
  >1 → `ambiguous`; erro → `unavailable`).
- `route.ts` preflight: passa a usar o mesmo predicado (nunca diverge do resolver). Comentário
  de rota documenta a inversão e que a habilitação `SEFAZ_DIRETO+fiscalEnabled=true` pertence
  ao gate do live drill. A prova REAL do certificado continua em execução via
  `resolveActiveCertificate` (mesma store, ATIVO, vigente, refs, cofre) antes do one-shot.
- Semântica global de `fiscalEnabled` (snapshot/emissão, `venda-fiscal-*`, wiring de
  homologação da emissão) **inalterada**.
- Preservado integralmente: one-shot global (advisory lock + dedupe cross-store), superfície
  canônica Production-only, ADMIN, ≤6 alvos, HOMOLOGACAO/SP, GET-only, caller sem controle de
  destino, A1 por refs opacas, TLS/timeout/body limits, containment por deployment.
- Janela: **inalterada** — `activationId=null, notBeforeUtc=null, expiresAtUtc=null`. Nenhuma
  activation nova neste GOAL.
- Doc gate 019: atualização 132 registrada (regra invertida; leitura dos guards 5/7 atualizada).

## Matriz de testes (provas novas/ajustadas)

- STUB_HOMOLOGACAO + fiscalEnabled=false + cert referenciado ⇒ candidata válida (resolver + rota 200)
- SEFAZ_DIRETO + fiscalEnabled=false + cert referenciado ⇒ candidata válida (resolver + rota 200)
- fiscalEnabled=true ⇒ recusada (resolver `no_candidate` + rota 409), mesmo com A1 válido
- fiscalEnabled ausente/null ⇒ recusada (fail-closed)
- provider fora do par (ex.: GATEWAY_FOCUS) ou ausente ⇒ recusada
- certificado ausente/vazio ⇒ recusado antes de one-shot/rede (resolver + rota preflight)
- certificado inativo/vencido/sem refs ⇒ recusado antes do consumo (resolveActiveCertificate —
  provas existentes da rota mantidas: 409 antes de `loadSecureContext`/`consumeActivation`)
- duas candidatas ⇒ `ambiguous` (fail-closed)
- gate null ⇒ 404 antes de ACL/Prisma/A1/batch (provas existentes mantidas)
- ausência de caminho de emissão/numeração/NotaFiscal/Venda: novo teste de rota prova que as
  únicas interações de banco são as duas leituras do preflight + ledger técnico one-shot, e que
  o batch recebe apenas {activation, certificate refs, preparedSecureContext} — nenhum cliente
  de banco.

## Validações

- vitest `lib/fiscal/provider/sefaz/wsdl` + `app/api/fiscal/wsdl`: **175/175**
- vitest `lib/fiscal/homologation` + `resolve-active-certificate` + `contingencia` + rota de
  contingência: **111/111**
- typecheck (`tsc --noEmit`): OK
- ESLint focado (resolver/rota + testes): OK
- `npm run build`: OK
- `git diff --check`: OK
- WSDL_EXTERNAL_GET_COUNT=0 · SEFAZ_REQUEST_COUNT=0 · DATABASE_WRITE_COUNT=0

## Revisão independente (read-only, outra família)

Status: PENDENTE no momento do commit — será executada sobre `origin/main..HEAD` antes do
push/PR e este registro será preenchido com o veredito real. Focos obrigatórios: aceitar
`STUB_HOMOLOGACAO` não cria caminho de emissão; predicado único resolver×rota; preservação de
one-shot/superfície/GET-only/6 alvos/janela nula; diff restrito; zero escrita de banco; zero
segredo no diff.

## Classificação

A (para este GOAL de desacoplamento): regra desacoplada, provas verdes, revisão limpa,
janela dormente, zero rede. Segue o fluxo: PR → merge → reancoragem AEP → repetição do
pre-flight do 131 → HUMAN GATE.
