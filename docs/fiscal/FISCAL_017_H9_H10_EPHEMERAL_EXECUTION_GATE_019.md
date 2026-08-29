# FISCAL-017 — Gate efêmero de execução H-9/H-10

**Data:** 2026-08-13 · **Base:** `52b75dbb4ad478b2799a45a1b759f083828fc1cd`

> **ATUALIZAÇÃO (2026-08-29 · GOAL 020 · refresh do gate):** a janela foi RESTAURADA ao estado
> dormente `null/null/null` — a ativação `wsdl-h9h10-20260824-1800z-*` (24/08) expirou sem
> consumo e permanece somente como evidência histórica, não como configuração executável. O
> literal de loja-piloto (`WSDL_EXECUTION_PILOT_STORE_ID = "loja-1"`) foi REMOVIDO: a piloto é
> resolvida DINAMICAMENTE de `ConfiguracaoFiscalLoja` (`wsdl-pilot-store-resolver.ts`, ADR-0016),
> fail-closed — zero candidatas, múltiplas candidatas (exige decisão humana) ou falha de leitura
> bloqueiam; a request autenticada deve pertencer exatamente à candidata resolvida. Critérios de
> candidatura: `ambiente=HOMOLOGACAO`, `modeloFiscal=NFCE`, `provider=SEFAZ_DIRETO`,
> `certificadoAtivoId` válido. O one-shot GLOBAL foi reforçado sem schema/migration: a transação
> de consumo toma `pg_advisory_xact_lock` escopado à `dedupeKey` (serializa entre lojas,
> instâncias e cold starts) e recusa consumo prévio de QUALQUER loja; a unique
> `(storeId, dedupeKey)` permanece como retaguarda. Regra `fiscalEnabled`: o antigo
> `fiscalEnabled=false` era proxy de "loja não emite" de uma fase sem pipeline fiscal; com o
> pipeline de homologação operacional do GOAL 020, o preflight exige `fiscalEnabled=true` da
> candidata resolvida — sem habilitar emissão, pois a superfície é GET de metadados (sem corpo,
> sem SOAP, alvos fechados do catálogo) e a emissão segue retida pelos guards do pipeline.
> Guard 5 da seção 3 deve ser lido como "Store exatamente a piloto RESOLVIDA" e o guard 7 como
> "`HOMOLOGACAO`, `NFCE`, `provider=SEFAZ_DIRETO`, `fiscalEnabled=true`".

**Estado entregue:** **DORMENTE** — `activationId`, `notBeforeUtc` e `expiresAtUtc` são `null`.

**Rede SEFAZ neste GOAL:** **zero**. Nenhum WSDL, DNS, TLS, `.asmx`, `statusServico`, SOAP ou
emissão foi executado.

## 1. Resultado arquitetural

A superfície futura é um único `POST /api/fiscal/wsdl/ephemeral-execution`. Ela não recebe lista
de serviços nem qualquer opção de transporte. O batch vem exclusivamente de
`SEFAZ_WSDL_ACQUISITION_TARGETS`: exatamente seis entradas canônicas `SP/HOMOLOGACAO/4.00`, com
uma authority e no máximo um `GET` por entrada.

A habilitação não usa Environment Variable. A janela é esta configuração versionada:

```ts
{
  activationId: null,
  notBeforeUtc: null,
  expiresAtUtc: null,
}
```

Ativar futuramente exige commit revisado que preencha os três valores. A validação exige UTC
estrito, `notBefore < expiresAt` e duração máxima de 15 minutos. Antes de `notBefore`, a partir de
`expiresAt`, com configuração parcial/inválida ou com os três valores `null`, o endpoint responde
como indisponível antes de ACL, Prisma, cofre, A1, SecureContext ou socket. O request não fornece
relógio.

## 2. Consumo global one-shot persistente

Não se usa memória de processo para afirmar consumo global. O primitive existente reutilizado é:

- `FiscalEmissaoJob.@@unique([storeId, dedupeKey])` como compare-and-set imposto pelo banco;
- transação Prisma que cria o registro e o `FiscalLog` de consumo juntos;
- job técnico `tipo=CONSULTA`, criado diretamente em `status=CONCLUIDO`, `tentativas=1`,
  `maxTentativas=1`, sem nota e sem retry;
- `dedupeKey` derivada por SHA-256 do `activationId`, sem persistir o identificador em claro;
- qualquer conflito de unicidade **ou** falha de persistência é colapsado e bloqueia antes do A1
  e da rede.

O worker só seleciona `PENDENTE`, `AGUARDANDO_RETRY` elegível ou `PROCESSANDO` vencido;
`CONCLUIDO` é terminal e não entra na fila. Um cold start encontra a mesma restrição única no
banco e não recupera a capacidade.

Depois do commit durável nasce uma capability opaca limitada às seis chaves canônicas. O
`WeakMap` dessa capability é apenas a defesa one-shot por alvo já usada pela fundação do PR #53;
ele não substitui o ledger global. O prazo é revalidado antes de emitir cada authority: se a
janela expirar no meio do batch, nenhum GET adicional começa. O runtime revalida novamente na
última barreira anterior a `node:https.request`, depois de vault/A1/SecureContext; portanto a
latência dessa preparação também não permite abrir socket após `expiresAt`.

## 3. Ordem dos guards

1. configuração versionada completa e dentro do prazo;
2. Store explícita pelo resolver canônico de escrita;
3. ACL fiscal ADMIN;
4. request sem payload e sem query além de `storeId`/`lojaId` coerente;
5. Store exatamente `loja-1`;
6. `ConfiguracaoFiscalLoja` da mesma Store;
7. `HOMOLOGACAO`, `NFCE`, `fiscalEnabled=false`;
8. `certificadoAtivoId` presente;
9. certificado ativo, vigente, da mesma Store e com refs/provider disponíveis;
10. consumo transacional global da ativação;
11. batch fechado dos seis alvos.

URL, host, IP, porta, path, serviço, quantidade, retry, timestamps, PFX, senha e refs são
rejeitados como parâmetros. O runtime externo fixa `https:`, host/SNI canônico, porta 443,
`/ws/<serviço>.asmx?wsdl`, `GET`, TLS ≥ 1.2, validação do servidor e zero redirect. Não há
fallback, descoberta DNS alternativa, proxy, `lookup`, `createConnection` ou destino fornecido
pelo caller.

## 4. Evidência pública sanitizada

O retorno contém, por serviço, somente:

- nome do serviço;
- status HTTP, tamanho, SHA-256 e evidência bounded de `Content-Type` quando disponíveis;
- H-9/H-10;
- operação, binding, `soapAction`, wrappers e namespaces extraídos estruturalmente;
- classe de falha sanitizada.

O documento WSDL bruto é descartado ao projetar o resultado. PFX, senha, refs, headers, cookies,
stack e mensagens de Prisma/vault/OpenSSL não são serializados. Falhas antes do batch usam códigos
públicos colapsados.

## 5. Produção observada somente por metadata

O projeto canônico `omni-gestao-pro` apontava para o deployment READY
`dpl_4f3sYaqT8isZvVWJc7uY3U1HxhjN`, commit
`52b75dbb4ad478b2799a45a1b759f083828fc1cd`. A consulta foi somente de metadata/alias; nenhuma
função da aplicação foi invocada e nenhuma promoção, env change ou rede fiscal ocorreu.

## 6. Procedimento futuro de ativação (não executado)

1. obter gate humano específico para os seis GETs oficiais;
2. criar commit exclusivo preenchendo `activationId`, `notBeforeUtc` e `expiresAtUtc` com janela
   curta e futura;
3. revisar diff, confirmar Store/ADMIN/preflight/A1 e fazer deploy do commit de ativação;
4. esperar READY e executar **uma** chamada administrativa sem body e sem parâmetros extras;
5. registrar apenas a resposta sanitizada e os request IDs da plataforma;
6. independentemente do resultado, fazer imediatamente o containment da seção 7;
7. somente após a evidência oficial válida, avaliar o fechamento de H-9/H-10 em GOAL próprio.

## 7. Containment obrigatório pós-execução

Reverter `main` ou o alias canônico **não basta**: deployments imutáveis do commit ativo podem
continuar acessíveis pela URL própria até o prazo expirar.

1. criar commit de desativação restaurando os três campos para `null`;
2. deployar e confirmar o alias canônico no commit OFF/READY;
3. inventariar **todos** os deployments do projeto que contenham o commit/configuração ativa,
   incluindo previews e deployments sem alias;
4. preservar primeiro a evidência sanitizada necessária;
5. remover todos os deployments ainda ativos da janela, não apenas promover/reverter o alias;
6. repetir o inventário até não restar deployment executável com a ativação;
7. confirmar por inspeção de metadata que o deployment OFF está READY e que o prazo das cópias
   eventualmente imutáveis já venceu;
8. executar varredura final de logs/relatório para segredos e registrar zero mutação de emissão,
   numeração, `NotaFiscal`, `Venda`, `REGISTRY`, `SEFAZ_DIRETO` e `statusServico`.

## 8. Fronteiras preservadas

O PR #53 continua separado do transporte SOAP produtivo. `REGISTRY`, `provider-factory`,
`resolver`, `SEFAZ_DIRETO`, emissão, numeração, `NotaFiscal`, `Venda` e a authority loopback
test-only do PR #49 não foram relaxados. A única alteração no primitive do PR #53 é a fábrica de
authority externa que exige a capability opaca pós-ledger e reconstrói o destino do catálogo.

## 9. Validações e revisão independente

- testes novos: **42/42**;
- PR #53 + certificado/A1 + provider SEFAZ relacionados: **229/229**;
- suíte `lib/fiscal` + `app/api/fiscal`: **1.226 passed**, **16 skipped**, zero falhas;
- TypeScript global (`--noEmit --incremental false`): verde;
- ESLint focado: verde;
- `git diff --check`: verde;
- varredura estática: nenhum PFX/PEM/chave/segredo real no diff.

A primeira revisão independente encontrou dois pontos: revalidar a expiração imediatamente antes
do request Node e recusar datas de calendário normalizadas pelo `Date`. Ambos foram corrigidos e
ganharam testes adversariais (expiração durante `loadA1MtlsMaterial` resulta em
`externalTransmissionAttempted=false`; `2026-02-30` e `24:00` são inválidos). A re-revisão
classificou **A**, sem P0/P1/P2/P3 aberto.
