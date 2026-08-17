# FISCAL_021_DANFCE_QR_REGULATORY_AUDIT_047 — Auditoria regulatória DANFC-e / QR Code NFC-e

| Campo | Valor |
|---|---|
| **GOAL** | `FISCAL-021-DANFCE-QR-OFFLINE-REGULATORY-AUDIT-047` |
| **Tipo** | **Auditoria regulatória.** Zero implementação de QR, DANFC-e, encoder, render ou print. |
| **Base** | `origin/main` = `46e451f183c37d22e10866102448b38bee5daf0a` |
| **Branch** | `cursor/fiscal-021-danfce-qr-regulatory-audit-b491` |
| **Data da auditoria** | **2026-08-17** (todas as consultas oficiais desta página foram feitas nesta data, UTC) |
| **Escopo do piloto** | Matriz RafaCell Assistec · Taguaí/SP · SEFAZ-SP · NFC-e modelo **65** · `HOMOLOGACAO` · `tpAmb=2` · ADR-0016 |
| **PR irmã (intocada, não-base)** | Draft **#65** (GOALs 020A–020D · contingência offline) — permanece Draft, **sem** 020E |
| **Trilho congelado** | **H-9/H-10** — diff vazio neste GOAL; janela `2026-08-17T12:00:00Z`–`12:10:00Z` **não executada** |
| **Classificação** | **A** — contrato suficiente para iniciar a implementação offline do QR (slice 021A/021C) |
| **Estado** | 🟡 **AUDITADO — NÃO IMPLEMENTADO.** Nenhum encoder, nenhum DANFC-e, nenhum 020E |

> **Não mergear este PR antes do fechamento do trilho H-9/H-10 ativo.**
>
> **GOAL 021 — auditoria regulatória DANFC-e/QR.
> Não mergear antes do fechamento do trilho H-9/H-10 ativo.**

> **Regra deste documento.** Nenhuma afirmação regulatória por memória de modelo. Cada regra em
> §4–§11 tem **fonte oficial + data**. Onde a fonte não pôde ser lida na rede permitida, está
> declarada como **pendência** — não preenchida por inferência, exemplo de NF-e modelo 55 ou
> fornecedor privado. Versões **não** são misturadas.

**Legenda:** 🟦 regra regulatória · 🟩 decisão de arquitetura · 🟨 procedimento · 🟥 ação humana · ⚠️ conflito/incerteza

---

## 0. O que este GOAL é — e o que **não** é

| Faz | Não faz |
|---|---|
| Fecha H-4 (parâmetros exatos do QR v3 online/offline) com PDF oficial hashado | Não implementa gerador de QR |
| Determina o manual/NT/XSD canônicos vigentes em 17/08/2026 | Não implementa DANFC-e, render ou print |
| Contrata QR online, QR offline `tpEmis=9`, CSC e DANFC-e | Não cria CSC, não exibe CSC, não usa valores fictícios de CSC |
| Relaciona conceitualmente com `exactBytes` do 020B (via `git show`) | Não altera 020A–020D; não usa PR #65 como base |
| Define slices 021A–021E | Não implementa nenhum slice; não inicia 020E |
| Captura PDFs oficiais + hashes/manifest | Não acessa Web Service SEFAZ, SOAP, mTLS ou A1 |

**Diff deste GOAL:** o relatório, o manifesto e três PDFs oficiais. Zero TypeScript de aplicação.

---

## 1. Pré-flight

```
git fetch origin main
git rev-parse origin/main   → 46e451f183c37d22e10866102448b38bee5daf0a
git checkout -b cursor/fiscal-021-danfce-qr-regulatory-audit-b491 origin/main
git status --short          → limpo
```

PR Draft **#65** conferida via `gh pr view 65`: `OPEN` + `isDraft=true` + `baseRefName=main` +
`headRefOid=9efd676f9f6f11b7d46d597585fea814de7ee195`. Este GOAL **não** a usa como base e
**não** a altera. Contratos 020A–020D foram lidos **somente** com `git show` /
`origin/cursor/fiscal-020a-contingencia-nfce-policy-contracts-5be7`.

H-9/H-10: `git diff origin/main -- lib/fiscal/provider/sefaz/wsdl/` → **0 bytes**.
`WSDL_EPHEMERAL_EXECUTION_WINDOW` permanece
`activationId=wsdl-h9h10-20260817-1200z-aacb10409a3a805b`,
`notBeforeUtc=2026-08-17T12:00:00Z`, `expiresAtUtc=2026-08-17T12:10:00Z`.
SHA-256 do arquivo versionado =
`634db73692f7806f8d27fa65549c347e761fddf119610f01687cd9c00aad249d`.
**Nenhuma** autoridade WSDL foi emitida; **nenhum** GET `?wsdl` foi aberto.

PL_010e intacto: SHA-256 de `leiauteNFe_v4.00.xsd` =
`598c71780cbc6b54f170464bd6d5538c2d01a99d987a1666b662d4e166b84bf7` — idêntico a
`docs/fiscal/FISCAL_XSD_MANIFEST_001.md`.

Rede SEFAZ (WS): **zero**. Nenhuma URL `*.asmx`, `?wsdl`, SOAP, mTLS ou certificado foi aberta.
A página estática
<https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/WebServices.aspx> foi **lida como HTML**
(igual ao GOAL-015/016D/020) e **não** foi seguida até o serviço.

Worktree `lib/fiscal/contingencia*` : **0 arquivos** — 020A–020D não estão nesta branch.

---

## 2. Fontes e versões (canônicas × legadas × não misturar)

### 2.1 O que está vigente em 17/08/2026

Consultado o índice **Manuais** do Portal Nacional da NF-e
(`listaConteudo.aspx?tipoConteudo=ndIjl+iEFdE=`) e o índice **Notas Técnicas**
(`tipoConteudo=04BIflQt1aY=`).

| Artefato | Versão vigente no índice | Papel neste GOAL |
|---|---|---|
| Manual de especificações técnicas do DANFE NFC-e e QR Code | **6.0 — março/2025** | **Manual canônico** |
| NT 2025.001 (QR-Code NFC-e v3) | **v1.03 — 29/09/2025** | **NT canônica do QR v3** |
| MOC Anexo IV — Contingência Off-line NFC-e | **7.00 — novembro/2020** | **Anexo IV vigente** |
| Schema XML NFC-e 4.00 no repo | **PL_010e_v1.02** (publicado 10/07/2026) | **XSD canônico já versionado** |
| MOC visão geral | **7.0** | contexto; PDF completo hashado, não armazenado |

O Manual v6.0 documenta **duas** versões de QR Code: **2.00 e 3.00**. A NT 2025.001 introduz a
**3**. O XSD `infNFeSupl/qrCode` reconhece **cinco** padrões (v1, v2 online, v2 offline, v3
online, v3 offline).

### 2.2 Qual contrato o OmniGestão deve implementar

🟩 **Contrato canônico do OmniGestão: QR Code versão 3 (nVersao = `3`).**

Fundamento:

- NT 2025.001 v1.03 §02.1: no leiaute v3 *“não será mais necessário o controle do CSC”*; a
  autenticidade do QR em contingência passa a ser a **assinatura de campos específicos**.
- NT 2025.001 v1.01 **removeu** a RV ZX02-220 (*“UF não aceita versão 3”*) *“considerando que
  todas as UF irão disponibilizar o layout do qrCode v3”*.
- Cronograma da v1.00: implantação em produção **até 01/09/2025**. Esta auditoria é de
  **17/08/2026** — a v3 já está no período de produção nacional.
- Para emitente **Pessoa Jurídica**, a NT §02.1 ainda diz que *“é opção da empresa adotar esse
  novo leiaute, ou não”*. 🟩 O OmniGestão **escolhe v3** para o piloto SP / modelo 65, para
  **não** depender de CSC/H-3 na implementação do QR.

Não misturar: o encoder futuro emite **somente** v3. v2 e v1 entram na tabela de
**reconhecimento** (XSD / documentos antigos), **não** na geração.

### 2.3 Versões reconhecidas (não gerar)

| Versão QR | Status | Onde vive | Gerar no OmniGestão? |
|---|---|---|---|
| **3** | vigente; contrato a implementar | Manual v6.0 §4.4 · NT 2025.001 v1.03 §04 · XSD v3 | **Sim** |
| **2** | legado ainda aceito pelo schema e pelo Manual §4.3; **depende de CSC** | Manual v6.0 §4.3 · XSD v2 | **Não** (só reconhecer) |
| **1** | concomitância encerrada em **01/10/2018** (Manual v6.0 §1) | XSD “QRCODE V1” | **Não** |

### 2.4 Captura oficial (hashes)

Captura em `docs/fiscal/official-captures/FISCAL-021-047/` · manifesto
`MANIFEST.json`. Bytes **não** alterados após o download. O estado do **índice** do Portal
Nacional em 17/08/2026 (títulos + hrefs relevantes + SHA-256 do HTML completo, sem o HTML
bruto) está em `LISTING_EVIDENCE.json`. Nesse índice, o único Manual DANFE NFC-e / QR Code
listado é a **Versão 6.0**; a NT 2025.001 mais recente listada é a **v.1.03**.

| Arquivo | Bytes | SHA-256 |
|---|---:|---|
| `Manual_Padroes_DANFE_NFCe_QRCode_v6.0_202503.pdf` | 1.887.904 | `bf906cc212f1edd19b1df7d1cdf4fbf5e73c3fec77567b6e69fa74453c95db5e` |
| `NT_2025.001_v1.03_202509.pdf` | 1.028.544 | `333b69f71debe5040585b677b574bb13b39362aa7934b904edc59cdf83cded02` |
| `MOC_7.00_Anexo_IV_Contingencia_NFCe_202011.pdf` | 811.631 | `0b5ae1e88ae60b57d4f1d752316289ff55f7e10c7e1d405905325e9de2666b0e` |

NTs históricas 2025.001 v1.00/v1.01/v1.02 e o Manual de Contingência Offline v2.0 (2016) foram
baixados, hashados e **não** versionados (predecessor / substituídos). Ver `MANIFEST.json`
`hashedNotStored`.

A página de Downloads da SEFAZ-SP
(`https://portal.fazenda.sp.gov.br/servicos/nfce/Downloads/`) respondeu **401** nesta sessão.
O dossiê GOAL-015 já registrou que SP ainda publicava o Manual **v4.1 (dez/2016)** — anterior
ao QR v3. 🟦 **Prevalece o nacional (Manual v6.0 + NT 2025.001 v1.03).** Não seguir v4.1.

---

## 3. XSD oficial já no repositório (`infNFeSupl/qrCode`)

Fonte: `leiauteNFe_v4.00.xsd` (PL_010e_v1.02), grupo `infNFeSupl`, consultado **2026-08-17**.
Os cinco `<xs:pattern>` são a **restrição de schema** — qualquer URL gerada tem de casar com
**um** deles.

Comentários do próprio XSD:

```
QRCODE V1          — query string chNFe=&nVersao=100&…&cIdToken=&cHashQRCode=
QRCODE V2 ONLINE   — ?p=CHAVE(tpEmis 1|3|4)|2|tpAmb|idCSC|hash40
QRCODE V2 OFFLINE  — ?p=CHAVE(tpEmis 9)|2|tpAmb|dia|vNF|digVal56|idCSC|hash40
QRCODE V3 ONLINE   — ?p=CHAVE(tpEmis 1|3|4)|3|tpAmb
QRCODE V3 OFFLINE  — ?p=CHAVE(tpEmis 9)|3|tpAmb|dia|vNF|tpId?|idDest?|assinatura_b64
```

`urlChave` (ZX03): 21–85 caracteres, URL da consulta **por chave** (não a URL do QR).

NT 2025.001 v1.03 §03.1: `infNFeSupl` **não afeta a assinatura digital** (NT 2015.002). A
Reference XMLDSig continua sobre `infNFe/@Id`. O QR mora **fora** do digest do XML.

🟦 **Ordem de elementos no XSD (`TNfe`):** `infNFe` → `infNFeSupl` (0–1) → `ds:Signature`.
O QR v3 offline **pode ser calculado depois** de assinar `infNFe` (usa a chave e o mesmo A1,
não o `DigestValue`). Na serialização, `infNFeSupl` **não** pode ficar depois de `Signature`.
🟩 Inserir o grupo suplementar **entre** `infNFe` e `Signature` e só então congelar
`exactBytes`. Isso não é patch de `infNFe` assinado.

Para o piloto SP / NFC-e 65: emissão online = **`tpEmis=1`**; contingência desta capability =
**`tpEmis=9`**.

⚠️ **EPEC não é regra transportada da NF-e 55.** O Anexo IV MOC 7.00 §3 lista, para NFC-e,
`tpEmis=1` (normal), **`tpEmis=4` (EPEC)** e `tpEmis=9` (off-line). EPEC é modalidade **NFC-e**
legítima e permanece **fora deste piloto** (020A: `capability_fora_do_escopo`) — não porque
seja modelo 55, mas porque a capability 020/021 é só off-line `tpEmis=9`.

O padrão XSD v3 **online** aceita chave com `tpEmis` ∈ {1,3,4}. `tpEmis=3` (SCAN) e SVC
(`tpEmis=6/7`, ausentes do pattern v3) **não** entram no encoder do piloto. 🟩 Não copiar
para o encoder 65 as RVs de NF-e 55 da mesma NT (lote síncrono modelo 55, `indIEDest`,
cobrança Y09, cStat 150 fora de prazo da 55, etc.).

---

## 4. Contrato QR Code **online** (versão 3)

🟦 Fontes: Manual v6.0 §4.4.1 (Tabela 6) · NT 2025.001 v1.03 §04 (versão QRCode = `3`) ·
XSD `QRCODE V3 ONLINE` · consultados **2026-08-17**.

### 4.1 URL

```
https://<endereco-consulta-QRCode-UF>?p=<chave_acesso>|<versao>|<tpAmb>
```

Exemplo de forma (domínio ilustrativo do Manual, **não** é URL de SP):

```
http://www.sefazexemplo.gov.br/nfce/qrcode?p=<chave44>|3|<tpAmb>
```

### 4.2 Parâmetros obrigatórios (ordem fixa, separador `|`)

| Posição | Parâmetro | Bytes | Origem | Observação |
|---|---|---|---|---|
| 1 | Chave de acesso | 44* | `infNFe/@Id` sem prefixo `NFe` | tem de ser a chave da NFC-e; dígito 35 (1-based) = `tpEmis` ∈ {1,3,4} no XSD online |
| 2 | Versão do QR | 1* | literal | **`3`** |
| 3 | Ambiente | 1* | ide/B24 `tpAmb` | `1` produção · `2` homologação |

`*` = tamanho exato.

**Ausentes na v3 online (em relação à v2):** `idCSC` / `cIdToken`, `cHashQRCode`, `cDest`,
`dhEmi`, `vNF`, `vICMS`, `digVal`, assinatura.

### 4.3 Codificação / escaping

- Query string: um único parâmetro `p=` cujo valor é a concatenação com `|`.
- NT 2025.001 §04 Nota 4: **não** é necessário CDATA na tag `qrCode` (v2 e v3).
- XSD: pipes **literais** (`\|`) e Base64 com `+` `/` `=` no padrão offline. 🟩 **Não**
  percent-encodar `|` nem o payload de `p=`. Tratar `p=` como string opaca, **não** como
  `application/x-www-form-urlencoded` (um `+` de Base64 viraria espaço).
- Caracteres da imagem QR: Manual §4.5.3 — **UTF-8**. Correção de erro: **nível M** (§4.5.2).
- Protocolo: `http` ou `https` (XSD `(HTTPS?|https?)`).
- Homologação × produção: **somente** `tpAmb` e, quando a UF publicar hosts distintos, a
  **URL base**. A estrutura dos três parâmetros **não muda**.

### 4.4 Algoritmo / hash / CSC

🟦 **Não há hash e não há CSC na v3 online.** A autenticidade é a consulta posterior da chave
autorizada na SEFAZ (NT 2025.001 §02.1: o controle por assinatura *“será feito unicamente para
as NFC-e emitidas em Contingência”*).

### 4.5 URL base e `urlChave` (SP)

O Manual §4.4 e a NT §03.1 apontam a tabela por UF em `http://nfce.encat.org/desenvolvedor/qrcode/`
e a consulta por chave em `http://nfce.encat.org/consumidor/consultenota/`.

⚠️ **P-URL-SP (não bloqueia o encoder).** Esses hosts **não** estão na rede documental permitida
deste GOAL (Portal Nacional NF-e + páginas estáticas SEFAZ-SP). A página
`https://portal.fazenda.sp.gov.br/servicos/nfce` **não** publica as URLs de QR/`urlChave`.
Downloads SP = 401.

🟩 O encoder (021A) recebe `qrBaseUrl` e `urlChave` como **input injetado**, não como literal
no código. A fixture de teste já existente
(`https://homologacao.nfce.fazenda.sp.gov.br/qrcode?p=…|2|2|1|HASH` e
`…/consulta`) é **v2 de teste**, **não** fonte oficial, **não** autoriza copiar o host.

🟥 Fechar P-URL-SP num slice de configuração (021B) a partir de página estática SEFAZ-SP ou do
Portal Nacional, **sem** chamar o host de consulta.

### 4.6 Homologação × produção (resumo)

| Item | Homologação (`tpAmb=2`) | Produção (`tpAmb=1`) |
|---|---|---|
| Parâmetros v3 online | `chave\|3\|2` | `chave\|3\|1` |
| DANFC-e | texto obrigatório *“EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL”* (Manual §3.1.8) | sem esse texto |
| CSC | N/A na v3 | N/A na v3 |
| URL base | host de teste da UF (P-URL-SP) | host de produção da UF (fora do piloto até G-F12) |

Piloto: **somente homologação**. Produção permanece na allow-list negativa.

---

## 5. Contrato QR Code **offline** `tpEmis=9` (versão 3)

🟦 Fontes: Manual v6.0 §4.4.2 (Tabela 7) · NT 2025.001 v1.03 §04 e RVs ZX02-260…338 ·
XSD `QRCODE V3 OFFLINE` · Anexo IV MOC 7.00 §3 · consultados **2026-08-17**.

### 5.1 URL

```
https://<endereco-consulta-QRCode-UF>?p=<chave>|<3>|<tpAmb>|<dia>|<vNF>|<tp_idDest>|<idDest>|<assinatura>
```

A chave **tem** de ter `tpEmis=9` (XSD: `[0-9]{6}[0-9A-Z]{12}[0-9]{16}(9)[0-9]{9}`).

### 5.2 Parâmetros (ordem fixa)

| Posição | Parâmetro | Bytes | Origem XML | Online? |
|---|---|---|---|---|
| 1 | Chave de acesso | 44* | `infNFe/@Id` / chave com `tpEmis=9` | sim (sem o 9) |
| 2 | Versão | 1* | literal `3` | sim |
| 3 | `tpAmb` | 1* | B24 | sim |
| 4 | Dia da data de emissão | 2* | **B09 `dhEmi`**, exatamente dois dígitos (`01`–`31`) | **não existe online** |
| 5 | Valor total | ≤15 | **W16 `vNF`**: ponto decimal, sem milhar, sem sinal | **não existe online** |
| 6 | Tipo id. destinatário | 0–1 | `1`=CNPJ · `2`=CPF · `3`=idEstrangeiro; se não identificado, **só o separador `\|`** | não existe online |
| 7 | Identificação do destinatário | 0 ou 3–14 | CPF/CNPJ da NFC-e; estrangeiro ou não identificado → **só `\|`** | não existe online |
| 8 | Assinatura | Base64 | RSA-SHA-1 da concatenação **1–7 com os `|`**, **mesmo certificado** que assina a NFC-e | **proibida online** (RV ZX02-330 → cStat 445) |

RVs NT 2025.001 (NFC-e 65, v3, `tpEmis=9`):

| RV | Checagem | cStat |
|---|---|---|
| ZX02-260 / 268 | dia presente e igual ao dia de `dhEmi` | 396 / 397 |
| ZX02-272 / 276 | `vNF` presente e igual a W16 | 396 / 397 |
| ZX02-324 / 326 / 328 | tpId + idDest coerentes com o XML; se a NFC-e não identifica destinatário, o QR também não | 396 / 397 |
| ZX02-334 | assinatura **obrigatória** em contingência | 474 |
| ZX02-330 | assinatura **vedada** se `tpEmis<>9` | 445 |
| ZX02-338 | valor da assinatura = valor calculado | 583 |

### 5.3 O que **não** entra no QR v3 offline

| Campo | v2 offline | v3 offline |
|---|---|---|
| `idCSC` / CSC | sim (7º + hash) | **não** |
| `cHashQRCode` SHA-1 hex 40 | sim | **não** |
| `digVal` (DigestValue XML em hex 56) | sim | **não** |
| `dhCont` / `xJust` | não | **não** (obrigatórios no XML, **não** no QR) |
| Protocolo `nProt` | não | **não** — emissão local ainda **não autorizada** |

Anexo IV §3 fala em “data e hora de emissão” no QR para a consulta informar contingência.
O parâmetro técnico vigente (Manual Tabela 7 + NT) é o **dia** de `dhEmi` (2 dígitos), não
`dhCont` e não a hora. 🟦 Implementar o **dia de `dhEmi`**.

### 5.4 Assinatura do QR (não é XMLDSig)

Manual §4.4.2, parâmetro 8, verbatim:

> Assinatura digital da concatenação dos parâmetros de 1 a 7, mantendo os separadores (“|”).
> Assinatura no padrão RSA SHA-1 (Base64), com o mesmo certificado digital que assina a NFC-e.

🟩 Passos do encoder offline (contrato, **não** código):

1. Montar a string UTF-8 `chave|3|tpAmb|dia|vNF|tpId|idDest` (campos 6–7 vazios se
   consumidor não identificado, **preservando** os `|`).
2. Assinar essa string no padrão oficial **RSA SHA-1 (Base64)** com o **mesmo certificado**
   que assina a NFC-e (Manual Tabela 7). O envelopamento RSA concreto (ex.: PKCS#1) **não**
   está nomeado no Manual — fica para o slice 021C como detalhe de implementação, citando
   o que o signer XMLDSig do projeto já usa, sem promover esse detalhe a texto normativo.
3. Base64 (alfabeto `A–Za–z0–9+/` + padding `=`), conforme o pattern XSD v3 offline.
4. Concatenar `|` + assinatura ao `p=`.
5. Prefixar a URL base. **Não** percent-encodar.

Isto **não** é o `DigestValue` do XMLDSig (esse era o 6º parâmetro da **v2**). A v3 **não**
copia o digest da `Signature` para o QR.

### 5.5 Dependências

| Dependência | v3 offline |
|---|---|
| Protocolo de autorização | **Não.** DANFC-e é entregue **antes** da autorização (Anexo IV §2 e §4). |
| CSC / idCSC | **Não** (NT §02.1 · Manual Observação 1 §4.4). |
| XML assinado (`exactBytes`) | **Sim, conceitualmente:** a chave `tpEmis=9` e os campos 1,3–7 saem do XML reconstruído; o A1 é o mesmo da assinatura. O QR **não** precisa do `DigestValue`. |
| `infNFeSupl` no XML transmitido | **Sim** (NT §4.8 / ZX02-*). Calcular o QR depois de assinar `infNFe`; serializar `infNFeSupl` **entre** `infNFe` e `Signature`; só então congelar `exactBytes`. |

Consumidor não identificado — string a assinar (ilustração de **forma**, sem CSC/chave reais):

```
<chave44>|3|<tpAmb>|<dia>|<vNF>||
```

Depois: `|` + Base64.

---

## 6. CSC / idCSC — auditoria de infraestrutura (metadados sanitizados)

### 6.1 Regra regulatória (v3 × v2)

🟦 NT 2025.001 v1.03 §02.1: *“Neste novo modelo, não será mais necessário o controle do
CSC”*. Manual v6.0 §4.4 Observação 1: *“não é necessária a obtenção de um CSC previamente
combinado com a SEFAZ”*. Futura eliminação do CSC: *“sem data definida”*.

🟦 CSC **ainda existe** para quem gerar QR **v2** (Manual §4.3 / §4.6): 16–36 caracteres
alfanuméricos; até **2** CSC simultâneos por empresa (CNPJ-base 8) na UF; `idCSC` sequencial
até 6 dígitos, **em claro** no QR v2; o CSC em si **nunca** vai no QR — só no SHA-1.
Homologação e produção têm CSC próprios (página SEFAZ-SP “Sobre a NFC-e”, 2026-08-17, e
GOAL-015).

O conflito C-1 do GOAL-015 (“um” × “até 2”) **fecha-se no Manual v6.0 §4.6**: até 2 CSC
válidos simultâneos por empresa na UF.

### 6.2 O que o projeto já tem (`origin/main`)

| Peça | Estado | Segredo? |
|---|---|---|
| `ConfiguracaoFiscalLoja.cscId` | `String @default("")` — identificador **não secreto** | não |
| `ConfiguracaoFiscalLoja.cscTokenRef` | `String?` — referência opaca | a ref não é o token |
| `canonicalEnvRef("csc", storeId)` | `FISCAL_CSC_TOKEN_<STORE_SUFFIX>` | nome da env, não o valor |
| `FiscalSecretVault.getCscToken` / `putCscToken` | port do cofre (ADR-0014) | token só em memória/cofre |
| `sanitizeFiscalConfigForClient` | expõe `cscId` + `cscConfigured: boolean` | **nunca** o token |
| Onboarding 016B | **não** grava `cscId`/`cscTokenRef` | — |

Nenhum arquivo de aplicação gera QR. Não há `lib/fiscal/qrcode/`.

### 6.3 Piloto `loja-1`

- Default de schema: `cscId=""` · `cscTokenRef=null`.
- Onboarding (GOAL-016B): CSC **intocado**.
- H-3 (GOAL-015): credenciamento + CSC de homologação **ainda humano / aberto**.
- Neste runtime: **zero** variáveis de ambiente cujo nome contenha `CSC` (contagem = 0;
  nenhum valor lido).
- 🟩 **Ausência de CSC no piloto: confirmada por metadados.** Nenhum CSC real foi
  exibido, criado ou inventado.

### 6.4 Impacto na implementação

Como o contrato canônico é **v3**, **CSC não é requisito obrigatório** para 021A/021B/021C.
A infra `cscId`/`cscTokenRef` permanece para eventual reconhecimento v2 ou para a eliminação
futura anunciada pela NT — **não** bloqueia esta auditoria e **não** deve ser preenchida com
placeholder.

Se um slice futuro reabrir v2, aí sim H-3 + cofre CSC voltam a ser gate.

---

## 7. DANFC-e — obrigação fiscal × escolha visual

🟦 Fonte: Manual v6.0 §§2–3 e §4 · Anexo IV §§3–4 · consultados **2026-08-17**.
**Não** é desenho de UI. Dimensões e posições abaixo são **mínimos oficiais**, não layout
OmniGestão.

### 7.1 Princípios (Manual §2)

- DANFE NFC-e é **documento auxiliar**, representação gráfica da NFC-e.
- **Não** inserir informação que não esteja no XML, **exceto** dados do XML de **retorno**
  da autorização (`nProt`, `cMsg`, `xMsg`, …).
- Legibilidade ≥ 6 meses; papel largura mínima **56 mm**; margens laterais ≥ **2 mm**.
- QR: mínimo **25 mm × 25 mm** (22 mm de conteúdo + 3 mm quiet zone); acima disso, quiet
  zone = 10%.
- **Proibido** imprimir DANFE NFC-e em ECF.
- Resumido/ecológico (sem divisão II) é **facultativo** se o consumidor concordar e a UF
  autorizar — escolha visual, não obrigação do piloto.

### 7.2 Conteúdo obrigatório (normal, já autorizada)

| Divisão | Obrigação fiscal | Escolha visual |
|---|---|---|
| I Cabeçalho | CNPJ/CPF mascarado; xNome; endereço sem país; texto *“Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica”* | logotipo à esquerda |
| II Itens | se existir: cProd, xProd, qCom, uCom, vUnCom, vProd (mínimo) | posições; DANFE resumido |
| III Totais | qtde de itens distintos; valor total; acréscimos/desconto se houver; valor a pagar se houver acréscimo/desconto; tPag + vPag; vTroco | layout |
| IV Consulta chave | *“Consulte pela Chave de Acesso em”* + URL (`urlChave`) + chave em 11 blocos de 4 | — |
| V QR Code | imagem do QR da URL `qrCode` | lateral **ou** centralizado |
| VI Consumidor | `CONSUMIDOR CNPJ/CPF/Id. Estrangeiro:` **ou** `CONSUMIDOR NÃO IDENTIFICADO`; nome+endereço **obrigatórios** se entrega em domicílio | — |
| VII Identificação | nNF, série, dhEmi **no horário local**; *“Protocolo de autorização:”* + nProt + dhRecbto local | — |
| VIII Mensagem fiscal | infAdFisco e/ou xMsg da UF | — |
| IX Interesse do emitente | infCpl (facultativo) | mensagens extra **depois** da divisão IX |

Valores no papel: vírgula decimal, ponto de milhar (Manual §3.1.2/3.1.3). **Não** confundir
com `vNF` do QR (ponto decimal, sem milhar).

### 7.3 DANFC-e em **contingência** (`tpEmis=9`, ainda sem protocolo)

| Requisito | Fonte | Obrigação? |
|---|---|---|
| Imprimir em destaque a **mesma** mensagem de duas linhas *“EMITIDA EM CONTINGÊNCIA Pendente de autorização”* **repetida em dois locais** (abaixo do cabeçalho **e** abaixo da identificação) | Manual §3.1.8 | fiscal |
| **Suprimir** *“Protocolo de autorização”* | Manual §3.1.7 | fiscal |
| QR no leiaute **offline v3** (não o online) | Manual §4.4.2 · NT §04 | fiscal |
| Segunda via *“Via do Estabelecimento”* **ou** guarda eletrônica do XML em local seguro, com termo no livro modelo 6 / declaração da UF | Manual §3.1.8 · Anexo IV §4 | fiscal (UF pode dispensar a 2ª via) |
| Detalhe da Venda (itens) **obrigatório** na contingência | Anexo IV §4 | fiscal |
| `dhCont` / `xJust` no XML, **não** impressos no DANFE | Anexo IV §3 | XML sim / papel não |
| Homologação: *“EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL”* | Manual §3.1.8 | fiscal (piloto) |

🟩 A guarda eletrônica do XML alinha-se ao `exactBytes` congelado do 020B + retenção
ADR-0018 — **não** exige implementar impressão da 2ª via neste GOAL. 021D deve **modelar**
as duas mensagens de contingência; 021E decide o suporte de impressão.

Consulta pública imediata pode **não** localizar o documento (Anexo IV §2). O QR offline
existe justamente para a UF informar contingência / prazo. Isso **não** autoriza omitir o QR.

---

## 8. Integração conceitual com 020B (`exactBytes`) — sem alterar 020A–020D

Lido **somente** via `git show` de
`origin/cursor/fiscal-020a-contingencia-nfce-policy-contracts-5be7`. Esta branch **não**
contém `lib/fiscal/contingencia*`.

### 8.1 O que o 020B já congela

`rebuildNfceContingenciaXmlOffline` reconstrói XML com `tpEmis=9`, `dhCont`, `xJust`, nova
chave/cDV/`infNFe/@Id`, assina, valida XSD e devolve

`exactBytes` + `sha256` + `chave` + `dhEmi` + `frozen: true` + `rebuildForbidden: true`.

Patch in-place de XML assinado = proibido (`SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN`).
`consumerPresentationDependency()` já aponta `goal: "021"` com
`blocksOfflinePolicy: false`.

O rebuild **atual** (020B) **não** emite `infNFeSupl`. Isso é esperado: QR é 021.

### 8.2 Onde o QR entra no pipeline (conceito)

```
snapshot + nNF/série/cNF + dhCont/xJust
        → rebuild XML (tpEmis=9, nova chave)     [020B]
        → XMLDSig de infNFe                      [020B]
        → encoder QR v3 offline (params 1–7 + RSA-SHA1)  [021C]
        → serializar infNFeSupl { qrCode, urlChave }
           **entre** infNFe e ds:Signature       [XSD TNfe: infNFe, infNFeSupl, Signature]
        → freeze exactBytes do NFe completo      [composição futura; hoje o freeze é só 020B]
        → DANFC-e ao consumidor (sem nProt)      [021D/E]
        → outbox transmite OS MESMOS bytes       [020C]
        → autorização posterior envolve nfeProc  [020D]
```

🟩 **Invariantes após a transmissão posterior** (não reabrir 020B):

| Invariável | Por quê |
|---|---|
| `exactBytes` do `NFe` assinado (com `infNFeSupl` quando 021C existir) | cl. 11 / 020A `transmissionUsesIssuedBytes` |
| Chave 44 com `tpEmis=9` | identidade; cDV |
| URL do QR v3 offline | está **dentro** de `infNFeSupl`; não recalcular |
| `nNF`, série, `cNF`, `dhEmi`, `dhCont`, `xJust` | XML congelado |
| Ausência de `nProt` **dentro** de `infNFe` | protocolo vive em `protNFe` / colunas, não no QR |

O que **pode** mudar na **representação** (DANFC-e) depois da autorização: imprimir
*“Protocolo de autorização”* a partir de `nProt`/`dhRecbto` persistidos (GOAL-013). Isso é
dado de **retorno**, permitido pelo Manual §2. **Não** altera o QR nem os `exactBytes`.

### 8.3 Bytes que 021C precisa do XML 020B

| Dado | Campo | Para o QR v3 offline |
|---|---|---|
| Chave | `infNFe/@Id` / resultado 020B `chave` | parâmetro 1 |
| Ambiente | `tpAmb` | parâmetro 3 |
| Dia | `dhEmi` (não `dhCont`) | parâmetro 4 |
| Total | `vNF` | parâmetro 5 |
| Destinatário | `dest/CNPJ\|CPF\|idEstrangeiro` ou ausência | parâmetros 6–7 |
| Certificado A1 | o **mesmo** da XMLDSig | parâmetro 8 |
| `DigestValue` XMLDSig | Signature | **não usado na v3** |
| `nProt` | — | **não existe** na emissão local |

020A já exige `exactBytes` a partir de `EMITIDO_LOCAL`. 021C tem de correr **antes** desse
freeze (ou o freeze do 020B precisa ser estendido num GOAL posterior **sem** patch in-place).
Isso é **composição**, não implementação agora.

---

## 9. Matriz regulatória

| Regra | Fonte | Online v3 | Offline v3 `tpEmis=9` | Input necessário | Risco |
|---|---|---|---|---|---|
| QR = `?p=` concatenado com `\|` | Manual §4.4 · NT §04 · XSD | `chave\|3\|tpAmb` | + `dia\|vNF\|tpId\|idDest\|ass` | chave, tpAmb, URL base | Alto se misturar v2 |
| Versão canônica = `3` | NT 2025.001 v1.03 · Manual §4.4 | sim | sim | literal | Médio (PJ ainda *pode* v2) |
| Sem CSC na v3 | NT §02.1 · Manual Obs. 1 | sim | sim | — | Baixo se v3 for exclusivo |
| CSC + SHA-1 hex 40 | Manual §4.3 | só v2 | só v2 | CSC + idCSC | Alto se gerar v2 sem H-3 |
| Dia = `dhEmi` 2 dígitos | NT ZX02-260/268 · Tabela 7 | n/a | sim | `dhEmi` do XML 020B | Alto se usar `dhCont` |
| `vNF` com ponto, sem milhar | Tabela 7 · XSD | n/a | sim | W16 | Médio (papel usa vírgula) |
| Dest vazio ⇔ XML sem dest | ZX02-328 | n/a | sim | dest do XML | Médio |
| Assinatura RSA-SHA-1 Base64, mesmo A1 | Tabela 7 · ZX02-334/338 | **proibida** (445) | **obrigatória** (474/583) | A1 + string 1–7 | Alto |
| Sem protocolo no QR / no DANFE local | Manual §3.1.7 · Anexo IV | n/a (autorizada) | sim | — | Alto se inventar nProt |
| `infNFeSupl` fora do digest, **antes** de `Signature` | NT §03.1 · XSD `TNfe` | sim | sim | inserir entre `infNFe` e `Signature`; depois freeze | Alto se serializar depois da `Signature` ou patchar `infNFe` |
| `exactBytes` imutáveis na tx posterior | 020A/020B · Anexo IV §3 (mesma chave/cNF) | n/a | sim | freeze com QR já dentro | Alto se regenerar QR depois |
| Mensagem contingência 2× | Manual §3.1.8 | n/a | sim | modelo 021D | Médio (visual ≠ fiscal) |
| Homologação: SEM VALOR FISCAL | Manual §3.1.8 | sim | sim | `tpAmb=2` | Médio |
| URL base SP | Manual aponta encat.org | input | input | P-URL-SP | Médio (encoder injetável) |
| Não copiar RVs de NF-e **55** da NT 2025.001 (lote síncrono 55, indIEDest, Y09, cStat 150, …) | NT 2025.001 mistura 55/65 | só modelo 65 | só modelo 65 / `tpEmis=9` | filtro de modelo | Alto se copiar a NT inteira |
| EPEC (`tpEmis=4`) é modalidade **NFC-e** (Anexo IV §3), fora deste piloto | Anexo IV §3 · 020A | n/a | n/a | não implementar 021C para EPEC | Médio se rotular EPEC como “regra 55” |

---

## 10. Slices recomendados (nenhum implementado agora)

Ajustados à evidência. **Não** criar slice de CSC. **Não** criar 020E aqui.

| Slice | Objetivo | Entra | Não entra | Depende |
|---|---|---|---|---|
| **021A** | Encoder **puro** QR v3 (online + offline estrutural) | montagem `p=`, validação contra os dois patterns XSD v3, porta `signQrV3Offline(string)→Base64`, URL base injetada | A1 real, persistência, DANFE, v2, CSC, rede | XSD PL_010e · este contrato |
| **021B** | QR **online** no XML homologação | `infNFeSupl.qrCode` + `urlChave`, persistir `qrCodeData`/`urlConsulta` já existentes (GOAL-013) | contingência, print, `tpAmb=1` | 021A · P-URL-SP |
| **021C** | QR **offline** `tpEmis=9` | params 4–8, RSA-SHA-1 com o mesmo A1, composição **antes** do freeze `exactBytes` | patch in-place, regenerar após `EMITIDO_LOCAL`, 020E | 021A · 020B (conceitual; 020 ainda fora de `main`) |
| **021D** | Modelo de conteúdo DANFC-e | divisões I–IX, mensagens de contingência/homologação, o que é fiscal vs visual | CSS, componente React, logo | Manual §3 · Anexo IV |
| **021E** | Render/print | imagem QR ISO/IEC 18004 nível M UTF-8 25 mm, papel 56 mm | ECF, preview “bonito” fora do modelo | 021B/C · 021D |

Ordem: **021A → (021B ∥ 021C) → 021D → 021E**. 021C pode começar assim que 021A existir,
mesmo com 020B ainda em Draft #65, usando o contrato `exactBytes` via tipos — **sem** mergear
#65 e **sem** 020E.

---

## 11. Pendências declaradas (não preenchidas)

| Id | Lacuna | Bloqueia 021A offline? |
|---|---|---|
| **P-URL-SP** | URL base QR e `urlChave` de SP não publicadas nas páginas estáticas permitidas (Downloads 401; encat.org fora da rede) | **Não** — input injetado |
| **H-3** | CSC de homologação do piloto | **Não** para v3; **sim** se alguém reabrir v2 |
| **H-4** | Manual v6.0 — **fechada neste GOAL** (PDF hashado) | — |
| **020 em main** | 020A–020D ainda Draft #65 | **Não** o encoder puro; 021C de composição espera o contrato `exactBytes` |
| **P-URL-encat** | tabela nacional por UF no portal NFC-e (encat) não lida | **Não** neste GOAL |

---

## 12. Revisão independente

Executada por **outro modelo/família** sobre este relatório + PDFs hashados + XSD. Veredito
na §12.1 após a passagem. Critérios obrigatórios:

1. versão do manual / NT canônicos;
2. QR online v3;
3. QR offline `tpEmis=9`;
4. CSC (v3 dispensa; v2 legado);
5. ausência de protocolo na emissão local;
6. DANFC-e em contingência;
7. integração conceitual com `exactBytes`;
8. nenhuma regra NF-e 55 transportada para o encoder 65;
9. zero rede SEFAZ (WS).

### 12.1 Resultado da revisão

| Item | Veredito |
|---|---|
| A Manual / NT canônicos | **QUALIFY** → corrigido: `LISTING_EVIDENCE.json` preserva títulos+hrefs+hash do HTML do índice em 17/08/2026. v3 é escolha PJ (NT §02.2), não imposição; o OmniGestão **escolhe** v3. |
| B QR online v3 | **PASS** |
| C QR offline `tpEmis=9` | **PASS** |
| D CSC | **PASS** |
| E Sem protocolo na emissão local | **PASS** |
| F DANFC-e contingência | **PASS** (nit: uma mensagem de duas linhas **repetida** em dois locais — corrigido em §7.3) |
| G `exactBytes` / `infNFeSupl` | **QUALIFY** → corrigido: ordem XSD `infNFe` → `infNFeSupl` → `Signature`; cálculo do QR pode ser pós-XMLDSig de `infNFe`, serialização **antes** de `Signature` |
| H Regras 55 | **QUALIFY** → corrigido: EPEC é modalidade NFC-e (Anexo IV §3), fora do piloto; RVs 55 da NT não entram no encoder 65 |
| I Zero WS SEFAZ | **QUALIFY** (atestado da sessão; artefatos sem WS) |
| J Classificação A | **QUALIFY** na 1ª passagem; **A mantida** após as correções obrigatórias |

**Revisor:** modelo/família distinta do autor (GPT-5.6). **Overall da 1ª passagem:**
APPROVE-WITH-CORRECTIONS. Correções obrigatórias aplicadas neste documento antes do commit.

Nit opcional (PKCS#1): o Manual só diz “RSA SHA-1 (Base64)”; PKCS#1 foi rebaixado a detalhe
de implementação do slice 021C (§5.4).

---

## 13. Validações desta entrega

| Check | Resultado |
|---|---|
| Fontes oficiais Portal Nacional | sim (Manuais + NTs + PDFs) |
| Versão canônica explícita | Manual **v6.0** · QR **v3** · NT **2025.001 v1.03** · XSD **PL_010e_v1.02** |
| Hashes dos downloads | §2.4 + `MANIFEST.json` |
| Ausência de WS SEFAZ / SOAP / mTLS / A1 | sim |
| Zero CSC exposto / criado / fictício | sim (env CSC count = 0) |
| PR #65 intacta | sim (não-base, não alterada) |
| H-9/H-10 intocado | diff 0 bytes vs `origin/main` |
| `git diff --check` | a correr no commit |
| `npx tsc --noEmit` | **isento** — apenas documentação + PDFs oficiais |

---

## 14. Classificação

**A — contrato suficiente para iniciar a implementação offline do QR.**

O encoder 021A/021C tem: ordem dos parâmetros v3, XSD, algoritmo RSA-SHA-1 Base64,
independência de CSC e de protocolo, mapeamento para `dhEmi`/`vNF`/dest/`exactBytes`, e
proibição de misturar v2. P-URL-SP e H-3 **não** bloqueiam o encoder puro. Não há conflito
material com a arquitetura Fiscal (não é D): 020A já previa a dependência 021 sem bloquear a
policy; `infNFeSupl` não quebra XMLDSig.

**Não** é B: o Manual v6.0 e a NT 2025.001 v1.03 foram lidos e hashados (H-4 fechado).

---

## 15. Relatório de entrega (DELIVERY_CHECKLIST)

1. **Arquivos criados:**
   - `docs/fiscal/FISCAL_021_DANFCE_QR_REGULATORY_AUDIT_047.md`
   - `docs/fiscal/official-captures/FISCAL-021-047/MANIFEST.json`
   - `docs/fiscal/official-captures/FISCAL-021-047/LISTING_EVIDENCE.json`
   - `docs/fiscal/official-captures/FISCAL-021-047/Manual_Padroes_DANFE_NFCe_QRCode_v6.0_202503.pdf`
   - `docs/fiscal/official-captures/FISCAL-021-047/NT_2025.001_v1.03_202509.pdf`
   - `docs/fiscal/official-captures/FISCAL-021-047/MOC_7.00_Anexo_IV_Contingencia_NFCe_202011.pdf`
2. **Alterados / removidos:** nenhum arquivo de aplicação.
3. **`tsc`:** isento (sem `.ts`/`.tsx`).
4. **Escopo:** somente auditoria documental + captura oficial. Sem QR implementado, sem
   DANFC-e, sem 020E, sem transmissão, sem merge, sem H-9/H-10.
5. **Pendências:** P-URL-SP (não bloqueia 021A); H-3 irrelevante para v3; 020 ainda Draft.
6. **`docs/ai/CURRENT_STATUS.md`:** **não** atualizado — não houve mudança de estado de
   módulo (real vs mock); o Fiscal permanece sem gerador de QR/DANFC-e.

---

## 16. Ponto de parada (checklist do GOAL)

| # | Item | Valor |
|---|---|---|
| 1 | `origin/main` | `46e451f183c37d22e10866102448b38bee5daf0a` |
| 2 | branch/worktree | `cursor/fiscal-021-danfce-qr-regulatory-audit-b491` a partir de `origin/main` |
| 3 | fontes e versões | §2 |
| 4 | manual canônico | v6.0 mar/2025 · SHA-256 `bf906cc2…db5e` |
| 5 | contrato QR online | §4 · `chave\|3\|tpAmb` · sem CSC |
| 6 | contrato QR offline | §5 · + dia + vNF + dest + RSA-SHA-1 |
| 7 | CSC/idCSC | §6 · v3 dispensa; piloto sem CSC |
| 8 | homologação/produção | §4.6 · piloto só `tpAmb=2` |
| 9 | DANFC-e normal | §7.2 |
| 10 | DANFC-e contingência | §7.3 |
| 11 | integração 020B | §8 |
| 12 | matriz | §9 |
| 13 | slices | 021A–021E · §10 |
| 14 | revisão independente | §12 |
| 15 | arquivos | §15 |
| 16 | commit | um commit documental (após revisão) |
| 17 | PR Draft | contra `main`, sem Ready |
| 18 | PR #65 intacta | sim |
| 19 | H-9/H-10 intocado | sim |
| 20 | zero rede SEFAZ | sim |
| 21 | classificação | **A** |

**PARAR.** Não implementar QR. Não implementar DANFC-e. Não implementar 020E. Não transmitir.
Não mergear. Não executar H-9/H-10.
