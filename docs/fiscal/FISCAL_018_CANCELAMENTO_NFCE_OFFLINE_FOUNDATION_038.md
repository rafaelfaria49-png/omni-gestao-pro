# FISCAL-018 — Cancelamento NFC-e · fundação OFFLINE · GOAL 038

| Campo | Valor |
|---|---|
| GOAL nomeado | `FISCAL-018-CANCELAMENTO-NFCE-OFFLINE-FOUNDATION-038` |
| Data | 2026-08-16 |
| `origin/main` usada | `b5e655aa8c24476107801f33746df05e26586591` |
| Branch / worktree | `cursor/fiscal-018-cancelamento-offline-foundation-39c6` |
| Classificação | **B — dependência oficial ausente** |
| Rede SEFAZ | **zero** |
| H-9 / H-10 | **intocados**; janela materializada na `main` preservada |
| Schema / migration / Prisma | **não alterados** |
| Implementação de cancelamento | **não iniciada** |
| Merge em `main` | **proibido** até o fechamento do trilho H-9/H-10 ativo |

> **Não mergear antes do fechamento do trilho H-9/H-10 ativo.**

Este GOAL parou **antes** de qualquer módulo de cancelamento. A parada é o resultado
obrigatório da auditoria: o XSD oficial de evento/cancelamento **não está** no repositório,
e as fontes internas já versionadas **divergem** no `cStat` de sucesso. Inventar `tpEvento`,
leiaute, namespace de evento, sequência, `descEvento` ou matriz de retorno seria violar o
critério de aceite.

---

## 1. Resultado

Classificação **B**. A fundação offline de cancelamento NFC-e **não** pode ser implementada
com segurança a partir dos contratos oficiais já incorporados.

Nenhum arquivo de `lib/fiscal/cancelamento/**` foi criado. Nenhum arquivo compartilhado foi
alterado. O único artefato desta branch é este relatório.

---

## 2. `origin/main` e isolamento

| Item | Valor |
|---|---|
| `git fetch origin main` | executado |
| SHA de `origin/main` | `b5e655aa8c24476107801f33746df05e26586591` |
| Mensagem | `feat(operacoes-v4): conectar recebimento transversal da os` |
| Ancestral H-9/H-10 na `main` | PR **#60** · `2f90f83` · `fiscal/h9-h10-window-20260817-1200z` |
| Commit da janela | `fadcf58` · `feat(fiscal): fill ephemeral WSDL window 20260817-1200z` |
| Worktree | isolada; working tree limpa na abertura |
| Outros terminais | nenhum trabalho local não commitado nesta worktree |

A `main` fiscal **já contém** a janela H-9/H-10 materializada
(`activationId` / `notBeforeUtc` / `expiresAtUtc` preenchidos para 2026-08-17).
Por isso esta branch **não** pode ser mergeada em `main` enquanto o trilho estiver ativo.

---

## 3. Fontes oficiais / XSD encontradas

### 3.1 Pacote oficial incorporado — somente leiaute da NFC-e

Autoridade e pacote versionados em `lib/fiscal/xsd/manifest.json` e
`docs/fiscal/FISCAL_XSD_MANIFEST_001.md`:

| Campo | Valor |
|---|---|
| Pacote | `PL_010e_v1.02` |
| Rótulo | Schemas XML NF-e 010e v1.02 — NT 2025.002 v1.40, NT 2026.002 v1.0 e NT 2026.003 v1.0 |
| Leiaute / modelo | 4.00 / NFC-e 65 |
| Entrypoint | `nfe_v4.00.xsd` → elemento `NFe` (`TNFe`) |
| Namespace | `http://www.portalfiscal.inf.br/nfe` |

Arquivos presentes em `lib/fiscal/xsd/schemas/PL_010e_v1.02/NFe/`:

| Arquivo | Papel |
|---|---|
| `nfe_v4.00.xsd` | entrypoint do **documento** NFC-e |
| `leiauteNFe_v4.00.xsd` | leiaute `infNFe` 4.00 |
| `tiposBasico_v4.00.xsd` | tipos básicos (`TChNFe`, `TProt`, `TJust`, `TStat`, …) |
| `DFeTiposBasicos_v1.00.xsd` | tipos DF-e compartilhados |
| `xmldsig-core-schema_v1.01.xsd` | XMLDSig |

Grafo de dependência (manifesto): `nfe_v4.00.xsd` → `leiauteNFe_v4.00.xsd` →
(`xmldsig-core-schema_v1.01.xsd`, `tiposBasico_v4.00.xsd`, `DFeTiposBasicos_v1.00.xsd`).

**Nenhum** desses arquivos define evento, cancelamento, `tpEvento`, `envEvento`,
`retEnvEvento`, `infEvento`, `detEvento`, `nSeqEvento`, `verEvento` ou `descEvento`.

Busca no pacote XSD (`evento`, `cancel`, `tpEvento`, `110111`, `envEvento`,
`NFeRecepcaoEvento`): **zero ocorrências**.

Busca em `lib/fiscal/**` por `110111`, `descEvento`, `nSeqEvento`, `verEvento`,
`retEnvEvento`, `envEvento`, `infEvento`: **zero ocorrências**.

### 3.2 Tipos básicos reutilizáveis — insuficientes para o evento

Em `tiposBasico_v4.00.xsd` existem tipos **genéricos** que um futuro GOAL de
cancelamento **poderá** reusar **depois** de o XSD de evento comprovar o uso:

| Tipo | Restrição oficial no pacote PL_010e | Observação |
|---|---|---|
| `TChNFe` | 44 caracteres; padrão `[0-9]{6}[0-9A-Z]{12}[0-9]{26}` | chave de acesso |
| `TProt` | 15 **ou** 17 dígitos (`[0-9]{15}\|[0-9]{17}`) | protocolo |
| `TJust` | 15–255 (`TString`) | justificativa **genérica** |
| `TStat` | 3 ou 4 dígitos | `cStat` |
| `TMotivo` | 1–255 | `xMotivo` |

O `xJust` de `leiauteNFe_v4.00.xsd` (15–**256**) pertence à **entrada em contingência**
(`tpEmis` ≠ 1), **não** ao cancelamento. Usá-lo como contrato de cancelamento seria
desvio de schema.

`TJust` **não prova** que o evento de cancelamento usa 15–255. O XSD de evento pode
restringir de outro modo. Sem esse XSD, a validação da justificativa **não** pode ser
declarada como derivada de contrato oficial de cancelamento.

### 3.3 Documentação interna — não é XSD oficial

| Fonte | O que diz sobre cancelamento | Status como contrato de implementação |
|---|---|---|
| `docs/architecture/FISCAL_EVENTS.md` | justificativa 15–255; sucesso **cStat 135** (“evento registrado”) | arquitetura-alvo; **não** é schema |
| `docs/fiscal/FISCAL_SEFAZ_DOSSIE_UF_001.md` §3.1 | instrumento `NFeRecepcaoEvento4`; sucesso **cStat 101** | dossiê interno; **não** é XSD |
| `docs/fiscal/FISCAL_SEFAZ_DOSSIE_UF_001.md` §10 | também lista **128** / **141** (lote de evento) e **101** | matriz **parcial**; H-8 aberto |
| `lib/fiscal/provider/stub-homologacao.ts` | simula cancelamento com **cStat 135** e 15–255 | stub simulado; **não** é fonte oficial |
| `lib/fiscal/provider/types.ts` | `FiscalProviderCancelamentoParams` (`chaveAcesso`, `protocolo`, `justificativa`) | interface dormente do provider |
| Catálogo `sefaz-endpoint-catalog.ts` | serviço `NFeRecepcaoEvento4` catalogado | URL/serviço; **sem** leiaute do payload |

Essas fontes **não** substituem o pacote XSD de eventos. O próprio GOAL exige constantes
(`tpEvento`, versão, namespace de evento, sequência, identificação) **somente** a partir
de contratos oficiais já presentes.

### 3.4 Dependência bloqueante (exata)

Falta incorporar, pelo processo já vigente em
`docs/fiscal/FISCAL_XSD_REGULATORY_UPDATE_PROCESS_001.md`, o **pacote XSD oficial de
eventos da NF-e/NFC-e** publicado pelo Portal Nacional da NF-e, contendo no mínimo:

1. leiaute de envio do evento (`envEvento` / equivalente oficial);
2. leiaute do evento propriamente dito (`infEvento` / `detEvento` de cancelamento);
3. leiaute de retorno (`retEnvEvento` / equivalente oficial);
4. manifesto com URL oficial, data de captura, bytes, SHA-256 e grafo `xs:include`/`xs:import`;
5. hashes conferíveis no mesmo padrão de `lib/fiscal/xsd/manifest.json`.

Sem esse pacote **não** há como derivar, sem invenção:

- `tpEvento` do cancelamento;
- `descEvento`;
- `verEvento` / `versao` do evento;
- formato de `Id` de `infEvento`;
- faixa e tipo de `nSeqEvento`;
- filhos obrigatórios de `detEvento` (ordem, cardinalidade, tipos);
- wrapper SOAP/`nfeDadosMsg` específico de `NFeRecepcaoEvento4`;
- caminhos estruturais do parser de retorno;
- `cStat` de sucesso/rejeição **do serviço de evento** (distintos da autorização).

Este GOAL **não** baixou o pacote. Rede ao Portal Nacional / SEFAZ é vedada aqui.
A captura oficial é GOAL próprio, no processo XSD já existente — não improvisação.

---

## 4. Arquitetura reutilizável (quando o XSD de evento existir)

Nada disto foi ligado a cancelamento neste GOAL. É o mapa para o GOAL desbloqueado.

| Primitive já existente | Caminho | Uso futuro legítimo |
|---|---|---|
| Validação estrutural de chave | `lib/fiscal/xml/nfce-chave-acesso.ts` + tipo `TChNFe` | validar 44 dígitos / DV **depois** de o XSD de evento confirmar `chNFe` |
| Serialização XML determinística + escape | `lib/fiscal/xml/xml-writer.ts` (`escapeXmlText` / `escapeXmlAttr`) | builder do evento, sem serializer paralelo |
| Namespace NFC-e (documento) | `NFCE_XMLNS` em `lib/fiscal/xml/nfce-xml.types.ts` | só reusar se o XSD de evento confirmar o mesmo `targetNamespace` |
| C14N 1.0 + XMLDSig | `lib/fiscal/signing/*` (`signNfceXml`, `c14n.ts`) | boundary de assinatura do `infEvento`; certificado de teste; sem A1 real |
| Parser fail-closed / UNKNOWN | `lib/fiscal/provider/sefaz/sefaz-response-parser.ts` | **padrão** de caminho estrutural, não o parser de `retEnviNFe` |
| Matriz `cStat` versionada | `lib/fiscal/provider/sefaz/sefaz-cstat-matrix.ts` | **não reusar as entradas de autorização**; nova matriz de **evento**, default UNKNOWN |
| UNKNOWN ≠ retry | matriz + `lib/fiscal/queue/queue-policy.ts` / worker | UNKNOWN/malformed **não** autorizam reenvio automático |
| Provider `cancelar` dormente | `FiscalProvider.cancelar` · stub simulado · SEFAZ direto inerte | adapter futuro; este GOAL não o preenche |
| Serviço catalogado | `NFeRecepcaoEvento4` | transporte futuro; **fora** deste GOAL |

O parser atual está amarrado a `NFeAutorizacao4` / `NFeRetAutorizacao4` /
`NFeConsultaProtocolo4`. Caminhos `retEnviNFe` / `protNFe` **não** são o retorno de
evento. Reusar o parser de autorização para cancelamento seria classificação falsa.

A matriz `016D-B.1` **não** contém `101`, `128`, `135`, `141` nem códigos típicos de
rejeição de evento. Qualquer um desses, hoje, cai em `UNKNOWN` — comportamento correto
para autorização, **inútil** como contrato de cancelamento.

---

## 5. Arquivos criados / alterados / removidos

| Ação | Caminho |
|---|---|
| Criado | `docs/fiscal/FISCAL_018_CANCELAMENTO_NFCE_OFFLINE_FOUNDATION_038.md` |
| Alterado | nenhum |
| Removido | nenhum |

**Não tocados (confirmado):**

- `lib/fiscal/provider/sefaz/wsdl/wsdl-ephemeral-execution-window.ts`
  (SHA `e2c03393a594da7e6cac003b5a7dc3abc9151443` na abertura; intocado)
- demais arquivos H-9/H-10 (`wsdl-acquisition*.ts`, `wsdl-ephemeral-batch.ts`, …)
- `prisma/schema.prisma` e migrations
- `auth.ts`, `proxy.ts`, PDV, Financeiro, Operações
- qualquer módulo sob `lib/fiscal/cancelamento/` (inexistente; não criado)

---

## 6. Comportamento implementado

**Nenhum.** Não há input tipado, validador, builder, parser nem classificador de
cancelamento. Implementá-los sem o XSD de evento exigiria inventar campos fiscais.

O que **existia antes** e permanece inalterado:

- stub de homologação simula `cancelar` (cStat `135`, justificativa 15–255);
- provider SEFAZ direto devolve `operacao_nao_suportada` em `cancelar`;
- mock de UI/provider simula cancelamento.

Nada disso é fundação oficial de evento.

---

## 7. Matriz de classificação de retorno — não publicada

Publicar matriz de sucesso/rejeição/malformed/UNKNOWN de **evento** sem o XSD/MOC de
evento seria invenção. As fontes internas **já divergem**:

| Fonte | `cStat` citado para sucesso de cancelamento |
|---|---|
| `FISCAL_EVENTS.md` | **135** |
| Stub `stub-homologacao.ts` | **135** (`Evento registrado e vinculado a NF-e`) |
| Dossiê UF §3.1 | **101** (`Cancelamento de NF-e homologado`) |
| Dossiê UF §10 | **101**, mais **128** / **141** como lote de evento |
| Matriz `sefaz-cstat-matrix.ts` | **ausentes** `101` / `128` / `135` / `141` |

Essa divergência é **não arbitrável in-repo** e, para o classificador fail-closed, equivale a
ambiguidade incompatível com implementação segura — segundo critério de parada B do GOAL,
independente da ausência do XSD. Nenhuma das fontes é eleita aqui.

Doutrina que **permanece** (já no parser/matriz de autorização, a reaplicar no futuro
parser de evento, sem copiar códigos):

- sucesso confirmado só com prova estrutural + código **explícito** na matriz do serviço;
- rejeição definitiva só com código **explícito** na matriz do serviço de evento;
- resposta inválida / SOAP fault / ambiguidade → estado incerto, nunca sucesso;
- código ausente da matriz → `UNKNOWN`;
- `UNKNOWN`, timeout, malformed **não** autorizam retry automático de envio.

Não há política de retry neste GOAL (nenhum código novo).

---

## 8. Testes e números

Não há módulo novo. Testes de cancelamento da fundação **não** foram escritos — seriam
teste de contrato inventado.

Não se executou suíte fiscal completa: nenhum `.ts`/`.tsx` de produto foi alterado.
Typecheck / ESLint / mutation probe de classificador **não se aplicam** (isenção:
somente documentação de parada).

`git diff --check` no artefato documental: ver seção 11 após o commit.

---

## 9. Mutation probe

**Não aplicável.** Não há validador/classificador novo. Mutar código inexistente não
prova nada. O probe fica para o GOAL desbloqueado, depois do XSD de evento.

---

## 10. Revisão independente

Solicitada a **outro modelo/família** (Claude Opus) após a redação deste relatório.
Revisão **somente leitura**: não editou, não commitou, não fez push.

| Campo | Valor |
|---|---|
| Veredito | **CONCORDA-B** (ressalvas menores, nenhuma bloqueante) |
| Classificação recomendada | **B** |
| Aprovação commit documental + PR Draft | **sim** |
| H-9/H-10 | blob `e2c03393a594da7e6cac003b5a7dc3abc9151443` idêntico em disco, `HEAD` e `origin/main` |
| Código de cancelamento | **zero** (diff de produto vazio) |
| Rede | **zero** |
| Prisma / schema / migration | **zero** |
| Campo fiscal inventado | **zero** (`tpEvento`/`110111` só como termos de busca neste markdown) |

Ressalvas aceitas (não alteram B):

1. A divergência `101` × `135` é **não arbitrável in-repo** (camadas evento × homologação × lote
   podem coexistir). O ponto inatacável continua sendo a ausência de XSD/MOC de evento para
   escolher. Este relatório **não** elege um lado.
2. `git diff --check` do artefato: limpo (confirmado antes do commit).
3. `FiscalProviderCancelamentoParams` é `type` alias, não `interface`.
4. Docstring obsoleto em `wsdl-ephemeral-execution-window.ts` (diz que as três constantes
   permanecem `null`, mas a `main` já as preencheu em `fadcf58`) — defeito **pré-existente**
   do trilho H-9/H-10; **não corrigido aqui**.

---

## 11. Commit / PR

- Um único commit documental nesta branch.
- Push sem force.
- PR **Draft** contra `main`.
- **Não** marcar Ready.
- **Não** mergear.
- Corpo do PR deve repetir: *Não mergear antes do fechamento do trilho H-9/H-10 ativo.*

---

## 12. Confirmações obrigatórias

| Critério | Estado |
|---|---|
| Fundação 100% offline | **N/A — não implementada** (parada B) |
| Contratos derivados de fonte oficial já presente | **impossível** para evento/cancelamento |
| Testes verdes do módulo novo | **N/A** |
| Mutation probe efetivo e revertido | **N/A** |
| UNKNOWN/rejeição não autorizam retry automático | **nenhum retry criado** |
| Nenhum arquivo H-9/H-10 alterado | **confirmado** |
| Zero acesso SEFAZ | **confirmado** (nenhuma URL SEFAZ/Portal chamada) |
| Nenhuma mutation real / Prisma / status NFC-e | **confirmado** |
| PR Draft apenas | exigido na entrega |
| Endpoint / Server Action / UI / worker / SOAP / A1 / Vercel | **não criados** |

---

## 13. O que desbloqueia um GOAL A

1. Capturar o pacote XSD oficial de **eventos** pelo processo
   `FISCAL_XSD_REGULATORY_UPDATE_PROCESS_001.md` (URL, ZIP, SHA-256, diretório versionado,
   manifesto, hashes, grafo). **Não** misturar com `PL_010e_v1.02`.
2. Resolver a divergência `101` × `135` (e o papel de `128`/`141`) **a partir do XSD/MOC
   de evento incorporado**, não a partir do dossiê ou do stub.
3. Só então implementar, offline, os 10 itens do GOAL 018 (input, chave, protocolo,
   justificativa conforme **esse** XSD, normalização, builder determinístico, constantes
   oficiais, boundary XMLDSig existente, parser/classificador de `retEnvEvento`, estados
   sucesso / rejeição / inválido / UNKNOWN sem retry).
4. Continuar em branch isolada até o trilho H-9/H-10 fechar; **não** mergear por cima da
   janela efêmera.

---

## 14. Classificação

**B.**

Motivo único e suficiente: o XSD oficial de evento/cancelamento **não existe** no
repositório. Motivo independente e suficiente: ambiguidade `cStat` 101 × 135 nas fontes
já versionadas, incompatível com classificador fail-closed.

Não é D (não houve violação de governança nem implementação indevida). Não é A (critérios
de aceite da fundação não foram — e não podiam ser — cumpridos).

---

## Apêndice A — evidência negativa (comandos)

Reproduzível sem rede. Executados nesta worktree em 2026-08-16 sobre
`origin/main` @ `b5e655aa8c24476107801f33746df05e26586591`:

```text
git ls-files '*.xsd'
# 5 arquivos, todos em lib/fiscal/xsd/schemas/PL_010e_v1.02/NFe/

rg -n 'envEvento|leiauteEvento|retEnvEvento|infEvento|detEvento|tpEvento|nSeqEvento|verEvento|110111' lib/fiscal
# zero (antes deste markdown)

rg -n 'evento|cancel|tpEvento|110111|envEvento' lib/fiscal/xsd
# zero

git hash-object lib/fiscal/provider/sefaz/wsdl/wsdl-ephemeral-execution-window.ts
# e2c03393a594da7e6cac003b5a7dc3abc9151443
```
