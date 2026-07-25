# FISCAL-CERTIFICATE-DRIVEN-ONBOARDING-016B — Onboarding fiscal pelo certificado A1

> **Escopo:** o cliente insere o certificado A1; o sistema valida, extrai o que o X.509 realmente
> carrega, identifica o CNPJ, reconcilia com a loja, pré-preenche a identidade fiscal e pede
> confirmação **apenas** do que está ausente ou divergente. **Dormente:** `fiscalEnabled` continua
> `false`, provider intocado, zero CSC criado, **zero transmissão à SEFAZ**.

| Item | Valor |
|---|---|
| Base | `origin/main` = `15e5f667275dfb5526473c08268f43dea5df75df` (PR #31 mergeado) |
| Branch | `fiscal/goal-016b-certificate-onboarding` |
| Worktree | `C:/Projetos/wt-fiscal-016b` (isolada) |
| Loja-piloto | `loja-1` — HOMOLOGACAO · NFCE · série 1 · `fiscalEnabled=false` · `STUB_HOMOLOGACAO` |
| Certificado real | **não necessário** — implementação e testes usam fixtures descartáveis |

## 1. Fluxo de upload (duas etapas, nada persistido na primeira)

```
[UI] arquivo .pfx/.p12 + senha
      │  multipart/form-data (HTTPS)
      ▼
POST /api/fiscal/onboarding/certificado        ← NÃO PERSISTE NADA
      │ requireFiscalAdmin (ADMIN/SUPER_ADMIN) + x-assistec-loja-id
      │ content-length → tamanho → extensão/content-type   (antes de qualquer parse)
      │ Buffer em memória → loadPkcs12 → extração → zeroBuffer
      │ reconciliação com Store/ConfiguracaoFiscalLoja/certificados
      ▼
   OnboardingPreview (campos com ORIGEM, bloqueios, pendências, custódia)
      │  usuário revisa, preenche pendências e confirma
      ▼
POST /api/fiscal/onboarding/confirmar          ← ÚNICO PONTO DE GRAVAÇÃO
      │ reconcilia DE NOVO no servidor (veredito não vem do cliente)
      ├─ ConfiguracaoFiscalLoja.upsert  (sem fiscalEnabled, sem provider, sem CSC)
      ├─ CertificadoDigital: PENDENTE_VALIDACAO, ativo=false, sem blobRef/senhaRef
      └─ FiscalLog (auditoria)
```

**Limites do upload:** `512 KB` (`PFX_TAMANHO_MAXIMO_BYTES`), extensões `.pfx`/`.p12`,
content-types `application/x-pkcs12`, `application/pkcs12`, `application/x-pkcs12-certificate`,
`application/octet-stream` ou vazio. Fora disso: `413`/`415`, sem parse.

**Higiene do segredo:** o `.pfx` existe apenas como `Buffer` em memória e é zerado em `finally`
(inclusive nos caminhos de erro); a senha só transita como string do request até `loadPkcs12`.
Nenhum arquivo temporário, nenhuma OpenSSL CLI, nenhum `child_process`. Limitação honesta já
registrada no GOAL-008: strings JS (senha/PEM) são imutáveis — ficam a cargo do GC.

## 2. O que é extraído do certificado — e o que **não** é

| Extraído do A1 | Campo |
|---|---|
| CNPJ do titular | `cnpj` (SAN `2.16.76.1.3.3` ou CN no padrão `RAZAO:CNPJ`) |
| Nome empresarial / titular | `titularCn`, `nomeEmpresarial` (CN sem o sufixo `:CNPJ`) |
| E-mail | `email` (subject `emailAddress`/`E=` ou SAN `email:`) — frequentemente ausente em PJ |
| Validade | `validoDe` / `validoAte` + `vigente` |
| Autoridade certificadora | `autoridadeCertificadora` (CN do issuer) |
| Número de série | `serialNumber` |
| Fingerprint | `fingerprintSha1` |
| Situação da cadeia | `cadeiaDisponivel` |
| Força da chave | `chavePublicaRsaBits` |

**Nunca atribuído ao certificado:** endereço, IE, IM, CNAE, regime/CRT e CSC — **não existem** num
A1 ICP-Brasil. O tipo `CertificadoExtraido` sequer possui esses campos, e há teste provando isso.

## 3. Reconciliação por CNPJ e `storeId`

`cnpjConhecido = ConfiguracaoFiscalLoja.cnpj ?? Store.cnpj`.

| Situação | Resultado |
|---|---|
| CNPJ do certificado == CNPJ conhecido | `confere = true`, segue |
| CNPJ do certificado != CNPJ conhecido | **bloqueio** `cnpj_divergente` |
| Loja sem CNPJ cadastrado | adota o do certificado (sem bloqueio) |
| CNPJ não identificável no X.509 | **bloqueio** `cnpj_certificado_ausente` |
| Mesma fingerprint vinculada a **outra** unidade | **bloqueio** `certificado_de_outra_loja` |
| Certificado vencido / fora de vigência | **bloqueio** `certificado_vencido` / `certificado_ainda_nao_valido` |
| Cadeia ausente | **bloqueio** `cadeia_invalida` |
| Arquivo ou senha inválidos | **bloqueio** `arquivo_invalido` / `senha_incorreta` |
| Chave RSA < 2048 | **bloqueio** `chave_fraca` |

Qualquer bloqueio ⇒ `podeConfirmar = false` e a rota de confirmação devolve `422` sem gravar.

**Exceção consciente ao escopo de loja:** a checagem `fingerprintVinculadaAOutraLoja` consulta
`CertificadoDigital` fora da loja ativa — mas devolve **apenas um booleano**, nunca dados da outra
unidade. Existe exclusivamente para cumprir "bloquear quando o certificado pertencer a outra loja".
Todo o resto é estritamente escopado por `storeId`.

## 4. Origem de cada campo

Precedência aplicada em `certificate-reconcile.ts` (o primeiro não-vazio vence):

| Campo | Precedência |
|---|---|
| `cnpj` | certificado → identidade fiscal → cadastro da loja *(não sobrescrevível manualmente)* |
| `razaoSocial` | manual → **certificado** → fonte cadastral → identidade fiscal |
| `nomeFantasia` (nome comercial interno) | manual → identidade fiscal → cadastro da loja *(nunca do certificado)* |
| `email` | manual → **certificado** → fonte cadastral → identidade fiscal |
| `fone` | manual → fonte cadastral → identidade fiscal → cadastro da loja |
| endereço (`logradouro`…`cep`) | manual → fonte cadastral → identidade fiscal → cadastro da loja |
| `inscricaoEstadual`, `cnae`, `regimeTributario` | manual → fonte cadastral → identidade fiscal |
| `inscricaoMunicipal` | manual → identidade fiscal |

Regras de marcação:
- `manual` vence sem alarde — o usuário acabou de decidir, então não vira `divergente`.
- Duas fontes não-manuais discordando ⇒ `divergente`, com `valorAlternativo`/`fonteAlternativa`.
- Nenhuma fonte ⇒ `pendente` (entra em `preview.pendencias`).
- Herança do cadastro operacional tem confiança `baixa` ⇒ `requerConfirmacao = true`.
- `Store.name` é apelido da unidade: alimenta o nome comercial, **nunca** a razão social.

## 5. Enriquecimento cadastral — estado atual

Contrato `FiscalIdentityLookupProvider` (`lib/fiscal/certificate/lookup-provider.ts`):
entrada `{ cnpj, uf }`; saída com **origem, data e nível de confiança por campo**.

**Não existe fonte automatizada aprovada para uso fiscal neste projeto.** O único consumo de API
cadastral hoje é *client-side*, no cadastro de CLIENTES do CRM
(`components/dashboard/clientes/cadastro-clientes.tsx` → BrasilAPI), sem ADR, sem contrato de
confiança/auditoria e fora do escopo fiscal. Adotá-lo como fonte fiscal exige ADR próprio —
**não foi feito aqui** e nenhum scraping foi improvisado.

Portanto o provider default é `NaoConfiguradoLookupProvider`, que responde
`status: "nao_configurado"` **sem tocar a rede**. Consequência prática: os campos caem no
pré-preenchimento pelo cadastro já existente da `Store`, marcados como `origem: "loja"` e
`requerConfirmacao: true`.

## 6. Tela de confirmação

`components/configuracoes-v3/features/settings/sections/FiscalOnboardingCertificado.tsx`, renderada
dentro da `FiscalSection`. Mostra, separadamente:

1. **Extraído do certificado** — titular, CNPJ, AC, série, validade, fingerprint, cadeia, e-mail,
   com aviso explícito de que endereço/IE/CRT/CSC não vêm do certificado.
2. **Estado da fonte cadastral** — "consulta externa ainda não configurada" quando for o caso.
3. **Campos com badge de origem** — *Do certificado · Fonte cadastral · Herdado da loja ·
   Informado agora · Divergente · Pendente* — editáveis, exceto o CNPJ.
4. **Bloqueios** — lista fail-closed; o botão de confirmar fica desabilitado.
5. **Custódia pendente** — nomes canônicos das referências do cofre desta loja.

O usuário preenche tipicamente: **nome comercial interno**, telefone/e-mail opcionais e os campos
não confirmados. **CSC/idCSC continua em fluxo separado** — o onboarding não o toca.

A senha existe apenas no estado local do componente até o envio e é limpa logo após a resposta
(sucesso ou erro). Nenhum parse acontece no navegador.

## 7. Persistência (somente após confirmação)

- **Identidade fiscal** — mesmo serviço da rota oficial (`normalizeFiscalConfigForUpsert` +
  `configuracaoFiscalLoja.upsert`). `fiscalEnabled` **não entra no upsert**: permanece `false` no
  create e intocado no update. `ambiente`, `modeloFiscal`, `provider`, `cscId` e `cscTokenRef` são
  relidos do estado atual e reescritos iguais — o onboarding não altera nenhum deles.
- **Certificado** — `CertificadoDigital` com `status = PENDENTE_VALIDACAO`, `ativo = false`,
  `blobRef = null`, `senhaRef = null`, `uploadedBy` = usuário da sessão. Se a mesma fingerprint já
  existir na loja, os metadados são atualizados (confirmação idempotente, sem duplicar).
- **Auditoria** — `FiscalLog` com `certificado.onboarding.inspecionar` e
  `certificado.onboarding.confirmar`, registrando fingerprint, série, CNPJ, veredito, bloqueios,
  origens por campo, pendências e estado do lookup. **Nunca** senha, bytes, PEM ou chave.

### Por que `blobRef`/`senhaRef` ficam nulos

O `EnvVault` do piloto (ADR-0009) **não persiste segredo em runtime** — o provisionamento é manual
na plataforma. Preencher as referências aqui faria a UI exibir "blob ✓ / senha-ref ✓" sem que
material algum existisse: seria um mock enganoso. O fluxo devolve as referências **esperadas**
(`FISCAL_A1_PFX_B64_<LOJA>` e `FISCAL_A1_SENHA_<LOJA>`) e declara a custódia como pendente.

### Continuação — validate-then-activate (inalterado, GOAL-008)

1. Provisionar as duas envs no cofre da plataforma.
2. `PATCH /api/fiscal/certificado/{id}` com `{ blobRef, senhaRef, validar: true }` → valida o `.pfx`
   **real** contra o CNPJ da loja.
3. `PATCH … { ativo: true }` → só ativa se a validação passar (fail-closed) e sobrescreve os
   metadados a partir do certificado real — que é a fonte autoritativa, não o que a UI declarou.

## 8. Modo sem certificado (item 7)

A `FiscalSection` exibe **"Certificado digital ainda não configurado."** sempre que não houver
certificado **ativo** na unidade, explicitando que o cadastro fiscal segue dormente, a emissão fica
bloqueada e PDV/Operações/Financeiro/Estoque continuam normais. Nada no fluxo liga a emissão.

## 9. Testes

`lib/fiscal/certificate/*.test.ts` — **48 testes**, todos verdes:

| Cenário exigido | Onde |
|---|---|
| PFX válido de teste | `certificate-inspection.test.ts` (extração completa) |
| Senha incorreta / ausente | idem (`senha_incorreta`, `senha_ausente`) |
| Certificado vencido / não vigente | idem (`certificado_vencido`, `certificado_ainda_nao_valido`) |
| Cadeia inválida | idem, via `avaliarMaterialCertificado({ cadeiaDisponivel: false })` |
| Arquivo ilegível / limites de upload | idem (`arquivo_invalido`, `arquivo_muito_grande`, `tipo_arquivo_invalido`) |
| CNPJ divergente | `certificate-reconcile.test.ts` |
| Troca entre lojas | idem (mesmo certificado passa na loja dona, bloqueia na outra) |
| Dados parciais | idem (viram `pendencias`) |
| Ausência de provider de consulta | idem + `lookup-provider.test.ts` |
| Nome comercial ≠ razão social | `certificate-reconcile.test.ts` |
| Nenhum segredo em logs/respostas | `certificate-inspection.test.ts` via `scanForSecrets` |
| `fiscalEnabled` permanece false | `certificate-reconcile.test.ts` (payload sem a chave) |
| Confirmação não confia no cliente | `bloqueiosDoCertificadoDeclarado` re-deriva vencimento/cadeia/chave/CNPJ |
| Zero transmissão | espião em `globalThis.fetch` nos três arquivos |

**Nota honesta sobre "cadeia inválida":** `loadPkcs12` rejeita antes um container sem certificado do
titular (`sem_certificado` → `certificado_sem_titular`), de modo que `cadeia_invalida` não é
alcançável por um `.pfx` sintético. O cenário é provado no avaliador puro
`avaliarMaterialCertificado`, que é exatamente o ponto onde a regra decide.

## 10. Bloqueio de escopo respeitado

Não foram implementados: transmissão SEFAZ, produção, `tpAmb=1`, cancelamento, inutilização,
contingência, DANFCE, CSC automático ou ativação de `fiscalEnabled`. Nenhum push para `main`,
nenhum merge, rebase ou force push. `prisma/schema.prisma` **não** foi alterado.
