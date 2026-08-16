# FISCAL-018 — Pacote regulatório de cancelamento NFC-e · GOAL 039

| Campo | Valor |
|---|---|
| GOAL nomeado | `FISCAL-018-CANCELAMENTO-REGULATORY-PACKAGE-039` |
| Data UTC | 2026-08-16 |
| `origin/main` usada | `b5e655aa8c24476107801f33746df05e26586591` |
| Branch | `cursor/fiscal-018-cancelamento-regulatory-package-39c6` |
| Classificação | **B — nProt/TProt oficialmente inconsistente; não arbitrar** |
| Rede SEFAZ | **zero** (somente Portal Nacional `nfe.fazenda.gov.br`) |
| H-9 / H-10 | **intocados** |
| `PL_010e_v1.02` | **intacto** (snapshot de hash no manifesto) |
| PR #61 | **não alterada** (evidência histórica do B do GOAL 038) |
| Implementação de cancelamento | **não iniciada** |
| Merge em `main` | **proibido** até o fechamento do trilho H-9/H-10 ativo |

> Dependência regulatória do GOAL 018. Não mergear antes do fechamento do trilho H-9/H-10 ativo.

Este GOAL captura e versiona as fontes oficiais necessárias à fundação offline de cancelamento NFC-e. **Não** implementa builder, parser, classificador nem rota Fiscal.

---

## 1. Resultado

Classificação **B**.

O pacote clássico de evento 110111 foi localizado, baixado e versionado. O contrato XML do evento (estrutura, `tpEvento`, `descEvento`, `xJust`, assinatura, retorno em camadas) está extraível das fontes oficiais. O **tamanho de `nProt`/`TProt` não é unívoco** entre o schema dedicado de 110111 (2018) e os tipos básicos vigentes do envelope/documento (2026 / `PL_010e`). O critério A exige esse contrato sem invenção. Não se mistura pacotes para “corrigir” o grafo.

PR #61 permanece Draft histórico. Esta entrega é uma **nova** branch a partir de `origin/main`.

---

## 2. Fontes oficiais

Índices do Portal Nacional da NF-e (`https://www.nfe.fazenda.gov.br/portal/`):

| Índice | URL |
|---|---|
| Esquemas XML | `listaConteudo.aspx?tipoConteudo=BMPFMBoln3w%3D` |
| Manuais / MOC | `listaConteudo.aspx?tipoConteudo=ndIjl%2BiEFdE%3D` |
| Notas Técnicas | `listaConteudo.aspx?tipoConteudo=04BIflQt1aY%3D` |

Downloads via `exibirArquivo.aspx?conteudo=…` referenciados por esses índices. MIME dos ZIPs: `application/zip`. MIME dos PDFs: `application/pdf`. Proveniência completa (título, URL, data exibida, UTC de aquisição, nome original, bytes, SHA-256, MIME) está em `lib/fiscal/xsd/evento-cancelamento/manifest.json`.

Não acessados: `homologacao.nfce.fazenda.sp.gov.br`, Web Services SEFAZ, SOAP, mTLS, A1.

---

## 3. Pacotes ZIP

| Pacote | Papel | SHA-256 | Bytes |
|---|---|---|---:|
| `Evento_Canc_PL_v1.01_NT_2018_004.zip` | **Adotado para 110111** | `71ccd5fcc48f9604a2a8965146df45e3b73e96e87942ab3391be0d55cc0df718` | 10695 |
| `CNPJ_Alfanumerico_NT2026.004.v1.01_PL_Eventos_e_Cad_Consulta_CCC.zip` | Envelope genérico + CCC (08/06/2026) | `cc50170b276c23bdab88650e1c68a46fdc707c8e810664452bba974cf744e7db` | 65203 |
| `PL_Evento.zip` | ZIP aninhado extraído do anterior | `7995ad7865cf3710655ee5e3162ff10bd9725358e3f67523256667e9cca6cb1a` | 12482 |
| `Eventos_RTC.zip` | **Prova negativa** (não incorporado ao grafo 110111) | `a4c57ce95b225cd8852f90bd6c39ca28ae551636ff3f67eb2602b9fa847129b2` | 24056 |

Integridade `unzip -t`: sem erros. `Eventos_RTC.zip` **não** contém `e110111` nem `CancNFe`.

Títulos no Portal (não inventar nomes ausentes):

- Evento Cancelamento: **não** traz `envEvento_v1.00.xsd` / `retEnvEvento_v1.00.xsd`. Traz `envEventoCancNFe_v1.00.xsd` e `retEnvEventoCancNFe_v1.00.xsd`.
- `envEvento_v1.00.xsd` / `retEnvEvento_v1.00.xsd` existem no envelope genérico `PL_Evento` (NT 2026.004). `detEvento` = `xs:any processContents="skip"`. **Não contém 110111.**
- Índice também lista `010d_v.1.03` (10/07/2026) sem citar Evento Cancelamento — **não incorporado**. Pacote 110112 (substituição) — **não incorporado**.

---

## 4. Diretórios versionados (isolados de `PL_010e_v1.02`)

```text
lib/fiscal/xsd/schemas/Evento_Canc_PL_v1.01/          ← 110111 clássico
lib/fiscal/xsd/schemas/PL_Evento_NT2026.004_v1.01/    ← envelope NFeRecepcaoEvento (parte geral)
lib/fiscal/xsd/evento-cancelamento/                   ← manifesto, ZIPs brutos, PDFs
```

Nenhum XSD de evento foi colocado dentro de `PL_010e_v1.02/`.

### 4.1 Árvore XSD — `Evento_Canc_PL_v1.01` (grafo 110111, fecha offline)

```text
e110111_v1.00.xsd
└── tiposBasico_v1.03.xsd

envEventoCancNFe_v1.00.xsd
eventoCancNFe_v1.00.xsd
retEnvEventoCancNFe_v1.00.xsd
procEventoCancNFe_v1.00.xsd
└── leiauteEventoCancNFe_v1.00.xsd
    ├── tiposBasico_v1.03.xsd
    └── xmldsig-core-schema_v1.01.xsd
```

`schemaLocation` somente nomes locais. Sem `http`/`file`/`..`.

### 4.2 Árvore XSD — `PL_Evento_NT2026.004_v1.01` (parte geral)

```text
envEvento_v1.00.xsd
retEnvEvento_v1.00.xsd
procEventoNFe_v1.00.xsd
└── leiauteEvento_v1.00.xsd
    ├── tiposBasico_v1.03.xsd     ← TProt = [0-9]{15}|[0-9]{17}
    └── xmldsig-core-schema_v1.01.xsd

tiposBasico_v4.00.xsd             ← presente no ZIP oficial; não referenciado pelo envelope
```

Misturar `tiposBasico` de 2026 no grafo 2018 **não** é republicação oficial. Não feito.

---

## 5. Contrato do evento 110111

Fonte primária: `leiauteEventoCancNFe_v1.00.xsd` + `e110111_v1.00.xsd` + `tiposBasico_v1.03.xsd` do pacote `Evento_Canc_PL_v1.01`. Complemento: MOC 7.0 §5.8 / §5.9 e NT 2018.004 (esta última afirma que 110111 **não teve mudança**; o objeto da NT é 110112).

| Campo | Contrato extraído | Fonte |
|---|---|---|
| Namespace | `http://www.portalfiscal.inf.br/nfe` | XSD 110111 |
| `tpEvento` | enumeração `110111` | XSD; MOC §5.9 |
| `verEvento` / `detEvento/@versao` | `1.00` | XSD |
| `descEvento` | enumeração `Cancelamento` | XSD; MOC §5.9 |
| `Id` (`infEvento`) | `ID` + `tpEvento` + chave + `nSeqEvento`; pattern `ID[0-9]{52}` | XSD (documentação + pattern) |
| `nSeqEvento` (envio) | pattern `[1-9]\|[1][0-9]{0,1}\|20` (1–20) | XSD |
| `nSeqEvento` (regra de negócio 110111) | deve ser **1** (P15-10) | MOC §5.9.3 |
| `cOrgao` | `TCOrgaoIBGE` (UFs IBGE + `90`/`91`/`92`) | XSD |
| `tpAmb` | `1` produção / `2` homologação | XSD `TAmb` |
| Autor | `CNPJ` (`TCnpjOpc`) **ou** `CPF` (`TCpf`) | XSD choice |
| `chNFe` | `TChNFe` **numérico** deste pacote 2018 | XSD 110111 |
| `nProt` (detEvento, obrigatório) | tipo `TProt` — ver §6 | XSD 110111 |
| `xJust` | `TJust` 15–255 | XSD |
| Assinatura | `ds:Signature` **obrigatória** em `TEvento`, sobre `infEvento` | XSD; NT 2018.004 P91 |
| Lote | `envEvento`: `idLote` + 1–20 `evento` | XSD `TEnvEvento` |
| Retorno lote | `retEnvEvento` + `retEvento` 0–20 | XSD `TRetEnvEvento` |
| `nProt` no retorno do evento | `TProt` opcional (protocolo do **evento**) | XSD `TRetEvento` |
| Cardinalidade detEvento 110111 | `descEvento` 1-1, `nProt` 1-1, `xJust` 1-1 | XSD / MOC Tabela 5-37 |

CNPJ/CPF e `chNFe` do pacote 2018 são **numéricos**. O envelope 2026 e `PL_010e` já aceitam CNPJ/chave alfanuméricos (NT 2026.004). Gap paralelo ao `nProt` — não arbitrado.

---

## 6. Regra atual de `nProt` — inconsistência oficial

Não se assume tamanho fixo 15. Evidência das fontes vigentes capturadas:

| Fonte vigente | `TProt` / Tam `nProt` | Aplica-se a 110111? |
|---|---|---|
| `Evento_Canc_PL_v1.01` `tiposBasico_v1.03` | `[0-9]{15}` | **Sim** — tipo do `nProt` em `detEvento` 110111 |
| MOC 7.0 Tabela 4-8 e P23 (Tam 15; 1+2+2+10) | 15 posições | Texto do MOC 7.0 (nov/2020) |
| NT 2018.004 P23 / R31 | Tam 15 | NT vigente; 110111 sem mudança declarada |
| `PL_Evento` NT 2026.004 `tiposBasico_v1.03` e `v4.00` | `[0-9]{15}\|[0-9]{17}` | Envelope genérico / `nProt` de **retorno** R31; **não** republica `e110111` |
| `PL_010e_v1.02` `tiposBasico_v4.00` (já no repo) | `[0-9]{15}\|[0-9]{17}` | Leiaute do **documento** NFC-e, não do evento 110111 |

**Regra para o próximo GOAL:** não implementar `nProt` até decisão humana ou republicação oficial do schema 110111. Um protocolo vigente de 17 dígitos **rejeitaria** o XSD 110111 de 2018. Aceitar 17 no builder 110111 **sem** XSD oficial correspondente seria invenção de grafo.

---

## 7. Matriz `cStat` 101 / 128 / 135

Fontes: MOC 7.0 Anexo I §4.4.1; MOC 7.0 §5.8.5 / §5.9 / §5.4.2 (Tabela 5-14). **Não** equivalentes.

### A. Lote de eventos — `retEnvEvento/cStat`

| cStat | Camada | Significado oficial | Sucesso de cancelamento 110111? |
|---:|---|---|---|
| **128** | lote (`NFeRecepcaoEvento`) | Lote de Evento Processado | **Não.** Só autoriza descer para `retEvento`. |
| (outros) | lote | rejeição do lote | Não. Eventos do lote não são o resultado individual. |

### B. Evento individual — `retEvento/infEvento/cStat`

| cStat | Camada | Significado oficial | Sucesso de cancelamento 110111? |
|---:|---|---|---|
| **135** | evento | Evento registrado e vinculado a NF-e | **Evidência de registro do evento 110111 vinculado à NFC-e.** `xEvento` previsto: “Cancelamento homologado” (MOC §5.9.2). **Não** é o status do documento na consulta. |
| 136 | evento | Evento registrado, mas não vinculado a NF-e | Registro sem vinculação. Não tratar como cancelamento homologado da NFC-e. |
| 573 | evento | Duplicidade de Evento | Rejeição |
| 501 | evento | Prazo de cancelamento superior ao previsto | Rejeição |
| 222 | evento | Protocolo de Autorização de Uso difere do cadastrado | Rejeição |
| 215 | evento/lote | Falha no schema XML | Rejeição |
| 594 | evento | Sequência maior que o permitido (P15-10) | Rejeição |
| 656 | consumo | Consumo indevido | Rejeição / bloqueio de consumo |

### C. Legado — consulta da situação da NF-e (`nfeConsultaProtocolo` / `retConsSitNFe`)

| cStat | Camada | Significado oficial | Sucesso de cancelamento 110111? |
|---:|---|---|---|
| **101** | **documento** (`retConsSitNFe`) | Cancelamento de NF-e homologado | Status da **NFC-e** na base, com `retCancNFe` se localizada cancelada (MOC Tabela 5-14 ER09). **Não** é o `cStat` de `NFeRecepcaoEvento`. |
| 151 | documento | Cancelamento de NF-e homologado fora de prazo | Idem, camada de consulta. |

**Evidência a usar pelo futuro classificador do evento 110111 (não implementado aqui):**

1. `retEnvEvento/cStat = 128` (lote processado);
2. no `retEvento` correspondente, `infEvento/cStat = 135` (evento registrado e vinculado);
3. `101` **não** substitui o passo 2; serve à consulta posterior da situação do documento.

Stub interno (`cStat: "135"`) e dossiês que citam `101` descrevem **camadas diferentes**. Sem prova de equivalência.

---

## 8. Validações (offline)

| Checagem | Resultado |
|---|---|
| SHA-256 ZIP/XSD/PDF × manifesto | conferido |
| XSD versionado × bytes extraídos do ZIP oficial (`unzip -p`) | conferido |
| `unzip -t` dos 4 ZIPs | sem erros |
| Parse `xmllint --nonet --noout` de todos os XSD incorporados | ok |
| Resolução `include`/`import` / grafo do manifesto | fecha no diretório versionado |
| `Eventos_RTC` sem 110111 | ok |
| Snapshot `PL_010e_v1.02` | hashes idênticos à `main` |
| `git diff --check` | arquivos autoriais limpos; XSDs oficiais em CRLF (bytes preservados; stripping invalidaria SHA-256) |
| Rede SEFAZ / SOAP / mTLS | **não executados** |

Reprodução: `node scripts/fiscal/verify-evento-cancelamento-xsd.mjs` (também `npm run fiscal:xsd:verify-evento-cancelamento`).

O verifier de `PL_010e` (`scripts/fiscal/verify-xsd-artifacts.mjs`) **não** foi alterado.

Revisão independente (outro modelo/família): **CONCORDA-B**. Confirmou fontes oficiais, pacote 110111, isolamento de `PL_010e_v1.02`, hashes, grafo, nProt não arbitrado, matriz 101/128/135 por camadas, zero rede SEFAZ, H-9/H-10 intocado, PR #61 não modificada.

---

## 9. Gaps restantes (dependência exata do B)

1. **`nProt`/`TProt`:** 15 (schema 110111 + MOC 7.0 + NT 2018.004) versus 15\|17 (envelope 2026 e documento `PL_010e`). Bloqueia implementação do campo no builder.
2. **`TChNFe` / CNPJ:** numérico no pacote 110111/2018; alfanumérico no envelope/documento 2026.
3. **`Id`:** `ID[0-9]{52}` no 110111/2018 versus padrão alfanumérico no envelope 2026.
4. Sem republicação Portal do ZIP “Evento Cancelamento” após NT 2026.004.
5. Classificador 110111 e builder XML **fora deste GOAL**.

---

## 10. O que este GOAL não fez

- Não implementou cancelamento, SOAP, mTLS, A1.
- Não executou H-9/H-10 e não alterou a janela efêmera.
- Não alterou PR #61.
- Não mergeou.
- Não atualizou `docs/ai/CURRENT_STATUS.md` (nenhuma capability operacional nova).
