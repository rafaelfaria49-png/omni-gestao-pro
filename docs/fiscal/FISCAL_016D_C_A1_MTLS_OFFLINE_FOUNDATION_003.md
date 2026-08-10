# FISCAL-016D-C-A1-MTLS-OFFLINE-FOUNDATION-003

## Resultado

| Campo | Resultado |
|---|---|
| Baseline remoto | `origin/main` em `92a2b40559e3ec493a3b06e6f9e844561a3db630` |
| Classificação de prontidão | **A — pronto para revisão e merge** |
| Rede SEFAZ | **zero**; nenhum WSDL, serviço ou endpoint SEFAZ foi chamado |
| Certificado usado | somente PKI sintética criada em memória nos testes locais |
| A1 real / senha real | **não usados** |
| Produção | bloqueada antes de cofre, PFX, senha, `SecureContext` e socket |
| H-9 / H-10 | **ABERTOS**; nenhum `SOAPAction`, wrapper ou binding foi inferido |
| Banco | `MIGRATION_SKIPPED`; sem schema, migration, baseline ou `db push` |

Este GOAL prepara apenas a fundação HTTPS/mTLS offline. Ele não implementa o envelope SOAP,
não chama `NFeStatusServico4`, não interpreta `cStat` e não inicia o 016D-D.

## Fronteiras implementadas

### Material A1

- O caller fornece somente referências opacas `{ storeId, blobRef, senhaRef }`.
- PFX e senha são resolvidos server-side pelo provider de segredos já existente.
- O material permanece encapsulado em memória, não é serializável e o `Buffer` do PFX é zerado
  no descarte e também nos caminhos de falha parcial.
- O callback de uso do material retorna `void`; portanto não existe canal de retorno para reter
  PFX ou senha depois do descarte.
- Erros são sanitizados e não contêm material secreto nem identificadores fornecidos pelo cofre.

### Transporte HTTPS/mTLS

- Usa somente módulos nativos do Node, com HTTPS obrigatório, `rejectUnauthorized` e
  `minVersion: TLSv1.2`.
- Aceita exclusivamente a tupla canônica do catálogo fechado; URL livre, host alternativo,
  redirect, cookie, autenticação e `SOAPAction` não são produzidos.
- Limita conexão/TLS a 15 s, ciclo total a 60 s e resposta a 2 MiB durante streaming.
- Não segue `301`, `302`, `307` ou `308`, não repete após falha e destrói request/resposta ao
  exceder o limite.
- Falhas de rede, TLS, relógio, HTTP e tamanho são `UNKNOWN_UNCERTAIN`, nunca rejeição fiscal.

### Barreira de execução externa

`SefazSoapTransport` recebe por padrão uma porta one-shot que sempre recusa e declara
`permiteRede = false`. A única porta capaz de autorizar uma tentativa pertence ao fixture de teste,
exige `NODE_ENV=test`, é consumida uma única vez e não é exportada pelo barrel de produção. Assim,
instanciar diretamente o transporte server-side não concede capacidade externa.

## Provas locais

Toda negociação de rede dos testes foi confinada fisicamente a `127.0.0.1` em porta efêmera. A PKI
é gerada em memória e cobre:

- cliente válido;
- cliente ausente e cliente assinado por CA não confiável;
- servidor não confiável;
- servidor limitado a TLS 1.1;
- resposta abaixo e acima de 2 MiB;
- redirects `301`, `302`, `307` e `308`;
- timeout de conexão e deadline durante body lento;
- exatamente uma tentativa, inclusive após HTTP 503.

Spies confirmam que o bloqueio de produção ocorre antes de carregar material, resolver senha,
criar o contexto TLS ou iniciar request. Outro teste prova que a construção padrão, sem capability,
também para antes dessas fronteiras.

## Segurança e escopo

- Nenhum PFX, senha, chave privada, token, cookie ou header `Authorization` foi versionado ou
  enviado a logs.
- O fixture contém apenas geração programática de chaves/certificados sintéticos; não há PEM de
  chave privada literal.
- Nenhum cliente HTTP externo foi adicionado.
- Nenhum parser, builder SOAP, wrapper WSDL, `SOAPAction` ou constante fiscal foi criado.
- Não houve mudança em Prisma, fila, numeração, emissão, venda, PDV ou caixa.

## Validações

| Gate | Resultado |
|---|---|
| `npx vitest run lib/fiscal/provider/sefaz --testTimeout=30000` | **10 arquivos / 290 testes verdes** |
| `npx vitest run lib/fiscal/certificate --testTimeout=30000` | **6 arquivos / 105 testes verdes** |
| `npm run typecheck` | **exit 0** |
| `npx eslint lib/fiscal/certificate lib/fiscal/provider/sefaz` | **exit 0** |
| `npm run build` | **exit 0**, 103 páginas geradas, `MIGRATION_SKIPPED` |
| `git diff --check` | **limpo** |

O build foi concluído offline com engines Prisma locais compatíveis e resposta local controlada para
`next/font`; isso não altera nem integra qualquer arquivo versionado.

## Revisão independente

A revisão foi executada por agente de outra família de modelo diretamente contra o diff e os testes.
Ela identificou duas falhas antes do fechamento:

1. o transporte genérico tinha runtime Node ativo sem capability externa obrigatória;
2. o callback do material A1 podia retornar o próprio segredo ao caller.

As duas falhas foram corrigidas. A reavaliação confirmou a porta one-shot fail-closed por padrão, a
capability exclusivamente local de teste, o callback sem retorno, ausência de constantes inferidas e
classificação técnica conservadora. Resultado final da revisão: **APROVADO**.

## Gates documentais

- **H-9: ABERTO.** Este GOAL não captura nem consulta WSDL e não define `SOAPAction`.
- **H-10: ABERTO.** Os seis bindings/wrappers oficiais não são parte desta fundação offline.

Qualquer contato externo futuro continua condicionado aos gates humanos específicos, a uma
capability de execução emitida fora deste slice e às evidências oficiais que encerrem H-9/H-10.
