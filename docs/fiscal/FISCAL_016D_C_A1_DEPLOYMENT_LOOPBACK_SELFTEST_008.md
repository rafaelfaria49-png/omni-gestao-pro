# FISCAL-016D-C — self-test A1/mTLS loopback no deployment

## Finalidade

O endpoint `POST /api/fiscal/certificado/selftest` fecha exclusivamente o gap de prova do A1 real
dentro do deployment: resolve o certificado ativo da loja, constrói um `SecureContext` Node e
negocia mTLS contra um peer efêmero preso a `127.0.0.1`. Ele não é transporte SEFAZ, não interpreta
SOAP e não habilita emissão.

## Gate operacional

- `FISCAL_A1_OFFLINE_SELFTEST_ENABLED=true` deve ser habilitada explicitamente e apenas durante a
  janela one-shot aprovada. Ausente ou diferente de `true`, a rota responde `404` antes de ACL,
  banco, provider ou secrets.
- Somente `POST` autenticado como ADMIN fiscal, com loja resolvida pelo mecanismo multi-loja
  canônico.
- A loja precisa existir e estar em `HOMOLOGACAO`, `NFCE`, `fiscalEnabled=false`, com certificado
  ativo/vigente da mesma loja e refs completas.
- O request aceita apenas a seleção canônica `storeId`/`lojaId`; o body deve estar ausente. URL,
  host, IP, porta, PFX, senha, refs, PEM e opções de transporte são recusados.

## Contenção

- Listener: sempre `127.0.0.1`, porta efêmera alocada internamente, `exclusive=true`.
- Cliente: sempre `127.0.0.1`; nenhuma resolução DNS, redirect, forwarding ou retargeting.
- O peer usa PKI sintética gerada somente em memória. O certificado cliente é o A1 resolvido pelo
  `loadA1MtlsMaterial`; o DER observado no servidor precisa coincidir com o certificado apresentado
  pelo cliente na mesma conexão, correlacionada pela porta efêmera local.
- O loader de material possui deadline antes da abertura do listener; material que resolver tarde é
  descartado. O listener, sockets e cápsula A1 são encerrados/descartados em `finally`, com deadline
  de cleanup e destruição de conexões tardias.
- Falhas de material, senha, certificado ou TLS são colapsadas em `selftest_falhou` na rota, evitando
  transformar o endpoint em oracle. Nenhum erro nativo ou segredo é retornado/logado.

Se o runtime não permitir listener local, a resposta é
`listener_loopback_indisponivel`; nenhum destino alternativo é tentado.

## Fronteiras preservadas

- `createOfflineLoopbackTestAuthority`, seu guard `NODE_ENV=test` e
  `nodeSefazHttpsRuntimePorts` permanecem inalterados.
- `SEFAZ_DIRETO` continua fora do REGISTRY P1.
- H-9/H-10 continuam abertos.
- A feature flag não deve ser ativada nem o endpoint executado em Production antes do merge e da
  autorização humana específica.
