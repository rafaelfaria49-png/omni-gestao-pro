# FISCAL_020_CONTINGENCIA_NFCE_AUDIT_PLAN_042 — Auditoria e plano da contingência NFC-e (modelo 65 · SP)

| Campo | Valor |
|---|---|
| **GOAL** | `FISCAL-020-CONTINGENCIA-NFCE-OFFLINE-AUDIT-PLAN-042` |
| **Tipo** | **Auditoria e planejamento.** Zero implementação de emissão em contingência. Zero worker. Zero `lib/fiscal/contingencia`. |
| **Base** | `origin/main` = `b5e655aa8c24476107801f33746df05e26586591` |
| **Branch** | `cursor/fiscal-020-contingencia-nfce-audit-plan-4646` |
| **Data da auditoria** | **2026-08-16** (todas as consultas oficiais desta página foram feitas nesta data) |
| **Escopo do piloto** | Matriz RafaCell Assistec · Taguaí/SP · SEFAZ-SP · NFC-e modelo 65 · `HOMOLOGACAO` · `tpAmb=2` · ADR-0016 |
| **Decisões-mãe** | ADR-0008 · ADR-0015 · ADR-0016 · ADR-0017 · ADR-0018 · ADR-0020 |
| **PRs irmãs (intocadas, não-base)** | Draft **#61** (GOAL 018 · B) · Draft **#62** (pacote 110111) · Draft **#63** (GOAL 019 · A) |
| **Trilho congelado** | **H-9/H-10** — diff vazio neste GOAL |
| **Classificação** | **A** — contrato suficiente para iniciar o primeiro slice offline (`020A`) |
| **Estado** | 🟡 **PLANEJADO — NÃO IMPLEMENTADO.** Nenhum slice de código iniciado |

> **Regra deste documento.** Nenhuma afirmação regulatória por memória de modelo. Cada regra em
> §4–§10 tem **fonte oficial + data**. Onde a fonte não pôde ser lida, está declarada como
> **pendência** — não preenchida por inferência, exemplo de NF-e modelo 55 ou fornecedor privado.
>
> **Não mergear este PR antes do fechamento do trilho H-9/H-10 ativo.**

**Legenda:** 🟦 regra regulatória · 🟩 decisão de arquitetura · 🟨 procedimento · 🟥 ação humana · ⚠️ conflito/incerteza

---

## 0. O que este GOAL é — e o que **não** é

| Faz | Não faz |
|---|---|
| Audita a modalidade de contingência válida para NFC-e 65 no piloto SP | Não implementa emissão em contingência |
| Determina impacto de `tpEmis` na chave, XML e assinatura | Não altera o numerador (`lib/fiscal/numbering/**`) |
| Desenha máquina de estados mínima e reconciliação | Não cria `lib/fiscal/contingencia` |
| Mapeia contrato de QR Code / DANFC-e em contingência | Não implementa GOAL 021 (DANFC-e/QR) |
| Define slices seguintes com fronteiras reais | Não chama Web Service SEFAZ, SOAP, mTLS ou A1 |
| Corrige o dossiê GOAL-015 no ponto Q-08 (fonte revogada) | Não mergeia #61, #62, #63; não toca H-9/H-10 |

**Diff deste GOAL: somente este documento.**

---

## 1. Pré-flight

```
git fetch origin main --prune
git rev-parse origin/main   → b5e655aa8c24476107801f33746df05e26586591
git checkout -b cursor/fiscal-020-contingencia-nfce-audit-plan-4646 origin/main
git status --short          → limpo
```

PRs Draft **#61 / #62 / #63** conferidas via `gh pr view`: `OPEN` + `isDraft=true` + `baseRefName=main`. Este GOAL **não** as usa como base e **não** as altera.

H-9/H-10: `git diff origin/main -- lib/fiscal/provider/sefaz/wsdl/` → **0 bytes**. Catálogo de endpoints permanece com os **seis** serviços NFC-e 4.00; **sem** EPEC, **sem** SVC.

PL_010e intacto: SHA-256 de `leiauteNFe_v4.00.xsd` =
`598c71780cbc6b54f170464bd6d5538c2d01a99d987a1666b662d4e166b84bf7` — idêntico a
`docs/fiscal/FISCAL_XSD_MANIFEST_001.md`.

Rede SEFAZ (WS): **zero**. Nenhuma URL `*.asmx`, `?wsdl`, SOAP, mTLS ou certificado foi aberta.
A página estática de catálogo
<https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/WebServices.aspx> foi **lida como HTML**
(igual ao GOAL-015/016D) e **não** foi seguida até o serviço.

---

## 2. Auditoria do código Fiscal já existente (mapa real, `b5e655a`)

### 2.1 Identidade do documento

| Peça | Onde | Estado hoje |
|---|---|---|
| Chave 44 dígitos | `lib/fiscal/xml/nfce-chave-acesso.ts` | `cUF+AAMM+CNPJ+mod+serie+nNF+**tpEmis**+cNF+cDV`. `tpEmis` default **1** |
| XML 4.00 | `lib/fiscal/xml/nfce-xml-builder.ts` | `buildIdeNode` emite `tpEmis`; **não** emite `dhCont`/`xJust`; **não** emite `infNFeSupl` |
| `infNFe/@Id` | builder + XSD | `NFe{chave44}` — muda se `tpEmis` muda |
| Assinatura | `lib/fiscal/signing/**` | XMLDSig enveloped sobre `infNFe` (C14N 1.0 + RSA-SHA1). Qualquer mudança em `ide` invalida digest e SignatureValue |
| Numerador | `lib/fiscal/numbering/**` | Aloca **antes** do XML. Número **nunca** volta ao contador. `@@unique(storeId, modelo, serie, numero, ambiente)` |
| Persistência legal | ADR-0018 · `NotaFiscal.xmlAssinado` | Bytes exatos + SHA-256. Sem reconstrução |

Prova estrutural no teste vigente (`nfce-chave-acesso.test.ts`):

```
tpEmis=1 → 43 primeiros = 3526061122233300018165001000000123 1 00000001
                                         serie nNF-------- ^ tpEmis
```

Mudar `tpEmis` de `1` para `9` **altera os 43 dígitos e o cDV**. A chave antiga deixa de existir.

### 2.2 Schema já preparado (não usado)

`NotaFiscal` já tem `tipoEmissao` (`NORMAL` \| `CONTINGENCIA_OFFLINE`), `dataContingencia`,
`justContingencia`, `status=CONTINGENCIA`. `FiscalJobTipo` já tem `CONTINGENCIA_TRANSMISSAO`.
`FiscalStatusVenda` já tem `EM_CONTINGENCIA`. `TipoEventoFiscal` já tem `CONTINGENCIA_ENVIO`.

🟩 **Não há migration neste GOAL.** O schema comporta o primeiro slice offline. EPEC (`tpEmis=4`)
**não** tem valor de enum — e não entra no primeiro slice.

### 2.3 Doutrina online vigente (não reabrir)

ADR-0017 (aceita): depois que os bytes assinados existem e a transmissão **começou**, resultado
não conclusivo → `TRANSMITINDO` / `UNKNOWN` → só `CONSULTA` por chave. `UNKNOWN` **nunca** autoriza
retransmissão automática. `EMISSÃO` não se repete salvo `CONSULTA=NOT_FOUND` **e** os **mesmos
bytes**. Builder/signer/numerador são proibidos na retomada.

### 2.4 Tensão arquitetural herdada (não é D)

O pipeline dormente `lib/fiscal/emission/emission-pipeline.ts` ainda mapeia `resultado=erro` →
`EM_CONTINGENCIA`. `docs/architecture/NFCE_ARCHITECTURE.md` §7.4 ainda descreve
“timeout → contingência”. Isso **colide** com a ADR-0017 e com a regra regulatória
“não reutilizar, em contingência, número transmitido como Normal”
(Ajuste SINIEF 19/16, cl. 11 § 2º I).

🟩 **Resolução de plano (não de código):** o mapeamento stub **não é doutrina**. Caminho online =
ADR-0017. Caminho offline = identidade **nova**, decidida **antes** de gerar XML. Conversão
NORMAL→CONTINGÊNCIA de XML já persistido/transmitido é **proibida**. O stub será corrigido num
slice futuro (`020E`), não aqui.

### 2.5 O que o GOAL-015 errou no Q-08 (correção obrigatória)

O dossiê `FISCAL_SEFAZ_DOSSIE_UF_001.md` §7 citou **Portaria CAT 12/2015 art. 10** (consultado
2026-07-23) e listou FS-DA + EPEC, com prazo único de **168 h**.

Nesta auditoria, a própria página da CAT 12/2015 declara:

> **Revogado pela Portaria SRE-40/24, de 05-07-2024 (DOE 10-07-2024).**

A fonte Q-08 do GOAL-015 **não está vigente**. Este documento substitui essa leitura para o
piloto SP. O dossiê 015 **não é editado** neste GOAL (escopo fechado).

---

## 3. Fontes oficiais consultadas em 2026-08-16

### 3.1 Permitidas pelo GOAL (Portal Nacional + SEFAZ-SP estático)

| # | Fonte | URL | Resultado | SHA-256 (corpo HTTP) |
|---|---|---|---|---|
| S1 | Portaria **SRE 40/2024** (vigente; **alterada pela** SRE-81/25) | <https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-40-de-2024.aspx> | lida | `4b6cdc1c545e689ce2b21e5594c19aa581c1a52cf78add1e423cc9688ead39e0` |
| S2 | RC **31961/2025** (03/07/2025) | <https://legislacao.fazenda.sp.gov.br/Paginas/RC31961_2025.aspx> | lida | `b214793a3e27631bd5aa8cf626f781ed362a18140ecbd31a1f5dec64d426ef42` |
| S3 | RC **30563/2024** (26/11/2024) | <https://legislacao.fazenda.sp.gov.br/Paginas/RC30563_2024.aspx> | lida | (mesmo sítio S1/S2; texto conferido) |
| S4 | SEFAZ-SP · Contingência NFC-e | <https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/Conting%C3%AAncia.aspx> | lida | `31ec1e42e3b010437dcdb8cb620e3bfeb8bd62d8a7ac55c4d6b5934ab2fbb825` |
| S5 | SEFAZ-SP · Sobre a NFC-e | <https://portal.fazenda.sp.gov.br/servicos/nfce> | lida | — |
| S6 | SEFAZ-SP · WebServices (catálogo HTML) | <https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/WebServices.aspx> | lida; **WS não chamado** | — |
| S7 | Portaria CAT 12/2015 | <https://legislacao.fazenda.sp.gov.br/Paginas/pcat122015.aspx> | lida **só para provar revogação** | `4d1062b569dc6c9589f16c608bf9b0df390bb841114fc5d09cfd58d88a0a1ba0` |
| S8 | Pacote XSD **PL_010e_v1.02** (já no repo) | manifesto GOAL-002 | hashes conferidos | ver `FISCAL_XSD_MANIFEST_001.md` |

### 3.2 Portal Nacional — loop de cookie (mesmo incidente 015/016D)

`https://www.nfe.fazenda.gov.br/portal/principal.aspx` e
`exibirArquivo.aspx?conteudo=…` (NT 2025.001, Manual DANFE v6.0, MOC, ZIP XSD) responderam
**302 → `AspxAutoDetectCookieSupport=1` em loop** (8 redirecionamentos). Cookie explícito não
quebrou o loop nesta sessão.

🟩 **Não foi usado SVRS** (fora da allowlist deste GOAL). O XSD vigente **já está** no repositório
com hash. O MOC Anexo IV (padrões off-line) **não foi baixado**; o trecho operacional necessário
foi lido **verbatim** na RC 31961/2025 (S2), que o cita.

### 3.3 Ajuste SINIEF 19/16 — ato nacional incorporado por SP

SRE 40/2024 **art. 1º** e **art. 6º** mandam obedecer ao **Ajuste SINIEF 19/16**. O Portal Nacional
não serviu o texto (loop). O ato nacional está em
<https://www.confaz.fazenda.gov.br/legislacao/ajustes/2016/AJ_019_16>
(consulta 2026-08-16; SHA-256 do HTML capturado
`1912516146c135d84397d6d784afa6aad8f8ea5f94f923a6368e0166515b1f20`).

Justificativa de uso: **não é Web Service SEFAZ**; é o ato que a portaria paulista vigente
incorpora por referência. O GOAL-013 já usou a mesma URL para a cláusula nona (guarda do XML).
As cláusulas 11, 12, 15 e 15-A **não** estavam no relatório 013 e foram relidas agora.

⚠️ Normas comerciais (NormasBrasil, Lefisc) **não** são autoridade.

### 3.4 O que **não** foi acessado

- `*.asmx`, `EPECws`, `?wsdl`, homologação ou produção SOAP
- mTLS, certificado A1, CSC real
- PRs #61/#62/#63 como base de código
- `hom.nfe.fazenda.gov.br` (área restrita / homologação)

---

## 4. Auditoria regulatória (nove questões)

### 4.1 Qual modalidade é válida para NFC-e modelo 65?

🟦 **Ajuste SINIEF 19/16, cláusula décima primeira** (vigente; S2 a reproduz). Três alternativas,
**a critério da UF**:

| # | Modalidade | Instrumento técnico | `tpEmis` (XSD PL_010e) |
|---|---|---|---|
| I | Geração prévia do DF-e em contingência e **autorização posterior** (off-line) | XML NFC-e completo, depois `NFeAutorizacao4` | **9** — “Contingência off-line da NFC-e…” |
| II | ECF ou SAT | fora do trilho NFC-e deste produto | n/a |
| III | **EPEC** + DANFE com texto próprio | evento prévio + XML posterior | **4** — “Contingência DPEC” no XSD |

🟦 **Não transportar NF-e 55.** SVC-AN (`tpEmis=6`) e SVC-RS (`tpEmis=7`) existem no XSD do
**leiaute compartilhado**, mas o Ajuste 19/16 **não** as lista para NFC-e. O catálogo NFC-e de SP
**não** publica SVC. FS-DA (`tpEmis=2/5`) constava da CAT 12/2015 **revogada** e **não** consta da
cl. 11 vigente.

🟩 **Modalidade canônica do piloto OmniGestão / SP:** **I — off-line, `tpEmis=9`.**
SAT/ECF ficam fora. EPEC fica **fora do primeiro slice** (ver 4.2).

### 4.2 Há diferença específica para SP?

Sim.

1. 🟦 **SRE 40/2024 art. 6º:** o contribuinte **deverá** operar em contingência nos termos da
   cl. 11 do Ajuste 19/16 quando não puder transmitir ou obter resposta. Não reescreve as
   alternativas — **incorpora** o Ajuste.
2. 🟦 **Página Contingência NFC-e de SP (S4):** “Portaria SRE 40, de 05/07/2024 autoriza a
   utilização da contigência offline no Estado de São Paulo.”
3. 🟦 **RC 31961/2025 item 6** (cita o FAQ oficial): a contingência **off-line pode ser utilizada
   em SP desde 10/07/2024**; a contingência **EPEC-NFC-e só é ativada pela SFP/SP** quando o
   ambiente normal estiver fora do ar (problema técnico ou parada). Em **homologação**, o EPEC
   “estará sempre em operação” (S4).
4. 🟦 **SRE 40/2024 art. 1º § 1º:** estabelecimento obrigado a SAT **e** credenciado NFC-e **não**
   emite modelo 2 / ECF / modelo 1; problemas técnicos → art. 6º (contingência do Ajuste), **não**
   talão modelo 2. Isso **não** é a vedação geral do CF-e-SAT a partir de 01/01/2026 (Portaria
   CAT 147 art. 34-D / RC 32089/2025) — regra distinta, fora deste GOAL.

🟩 **Consequência:** perda de conectividade **da loja** (internet do PDV) usa **off-line `tpEmis=9`**,
sem esperar ativação de EPEC. EPEC é caminho **distinto**, acionado quando a **SEFAZ** cai, e exige
evento + `tpEmis=4` + texto de DANFE próprio. Não misturar no 020A–020E.

### 4.3 Valor e semântica de `tpEmis`

🟦 XSD `leiauteNFe_v4.00.xsd` (`tpEmis`, enumeração):

| Valor | Documentação XSD | Uso NFC-e 65 / SP piloto |
|---|---|---|
| 1 | Normal | caminho online ADR-0017 |
| 2 | Contingência FS | **não** usar (NF-e/FS; CAT 12/2015 revogada) |
| 3 | Regime Especial NFF | fora de escopo |
| 4 | Contingência DPEC | EPEC NFC-e — slice futuro, não 020 |
| 5 | Contingência FSDA | **não** usar |
| 6 | SVC-AN | **NF-e 55 — não transportar** |
| 7 | SVC-RS | **NF-e 55 — não transportar** |
| 9 | Contingência **off-line da NFC-e** (e NF-e DANFE Simplificado Tipo 2) | **canônico 020** |

Para `tpEmis ≠ 1`, `dhCont` e `xJust` são obrigatórios pela **regra de contingência** (Ajuste
cl. 11 § 1º I; documentação XSD: *“Informar apenas para tpEmis diferente de 1”*). No schema, a
sequência tem `minOccurs="0"` (`leiauteNFe_v4.00.xsd` ≈ L290): o XSD **sozinho** não rejeita a
omissão; só limita `xJust` a 15–256 quando o grupo existe.

O builder atual **defaulta 1** e **omite** `dhCont`/`xJust`. A emissão em contingência ficaria
**incompleta** e deve ser bloqueada por **validação explícita da aplicação** (slice 020B), não
só pelo worker XSD.

### 4.4 Campos obrigatórios adicionais (XML)

Além do leiaute normal da NFC-e 4.00:

| Campo | Obrigatório em off-line | Fonte |
|---|---|---|
| `ide/tpEmis=9` | sim | XSD |
| `ide/dhCont` | sim (`tpEmis≠1`) — **aplicação**, não minOccurs XSD | documentação XSD + Ajuste cl. 11 § 1º I |
| `ide/xJust` | sim (15–256) — **aplicação**, não minOccurs XSD | idem |
| `infNFe/@Id = NFe{chave com tpEmis=9}` | sim | XSD padrão `NFe[0-9]{6}[0-9A-Z]{12}[0-9]{26}` |
| `infNFeSupl/qrCode` + `urlChave` | exigidos para DANFC-e/consulta; **GOAL 021** | XSD `infNFeSupl` |
| Protocolo (`nProt`) | **ausente** até autorização posterior | Ajuste cl. 11 § 1º IV |

Não há campo EPEC no XML da NFC-e off-line. Não copiar leiaute de evento 110111 (GOAL 018).

### 4.5 Prazo / regra de transmissão posterior

⚠️ **Não usar 168 h como prazo do off-line.** Esse número, no Ajuste vigente, é do **EPEC** e do
**cancelamento especial** cl. 15-A — não do inciso I.

🟦 Ajuste 19/16 cl. 11 § 1º II:

- **Inciso I (off-line):** transmitir *imediatamente após a cessação dos problemas técnicos*, no
  prazo limite de **até o primeiro dia útil subsequente** contado da emissão.
- **Inciso III (EPEC):** até **cento e sessenta e oito horas** da emissão.

A CAT 12/2015 aplicava 168 h de forma genérica; está **revogada**. O dossiê 015 **não deve** ser
seguido neste ponto.

🟩 SLA do job `CONTINGENCIA_TRANSMISSAO` (futuro): teto = **primeiro dia útil subsequente
contado da emissão (`dhEmi`)**, **não** de `dataContingencia` e **não** 7 dias. O cálculo deverá
fixar fuso (`America/Sao_Paulo`) e calendário de dias úteis em 020A — sem inventar feriados
federais neste plano. Alarme humano se o teto se aproximar. Não implementar o worker neste GOAL.

### 4.6 Impressão / entrega ao consumidor

🟦 Ajuste cl. 11 § 1º IV a: considera-se **emitida** a NFC-e off-line **no momento da impressão do
DANFE-NFC-e em contingência**, com **condição resolutória** da autorização de uso posterior.

🟦 Ajuste cl. 11 § 3º: **uma via** do DANFE off-line permanece à disposição do Fisco no
estabelecimento **até** transmitir e autorizar.

🟦 RC 31961/2025 item 7.1 (cita MOC Anexo IV v7.00): **alternativamente** à segunda via impressa,
guarda eletrônica segura do **XML** da NFC-e, com capacidade de imprimir o DANFE quando o Fisco
pedir.

🟦 A impressão off-line decorre do Ajuste cl. 11 § 1º IV a (emitida no momento da impressão do
DANFE, condição resolutória da autorização) e do § 3º (uma via à disposição do Fisco). A
RC 31961/2025 item 7.1 permite substituir **apenas a segunda via** pela guarda segura do XML,
com capacidade de imprimir o DANFE quando solicitado.

🟦 SRE 40/2024 art. 5º § 2º: a restrição “a NFC-e não seja emitida em contingência” aplica-se
especificamente à **alínea “b”** do § 1º item 1 (consulta na Nota Fiscal Paulista), **não** à
alínea “a” (envio eletrônico / chave). **Não** afirmar, com base nesse artigo, que toda
substituição da impressão esteja proibida em contingência.

🟩 No PDV do piloto: a **emissão** off-line, para os efeitos da cl. 11 § 1º IV a, ocorre na
**impressão do DANFE**. Guardar `xmlAssinado` (RC 31961 7.1) cobre a segunda via, não substitui
o momento de emissão. Detalhe de leiaute/aviso = GOAL 021.

### 4.7 Efeitos sobre QR Code e DANFC-e

Contrato **somente** — implementação = GOAL 021.

🟦 XSD `infNFeSupl/qrCode` distingue padrões **ONLINE** e **OFFLINE**, v2 e v3. O dígito de
`tpEmis` **dentro da chave** no parâmetro `p=` é `9` no off-line e `1|3|4` no online.

QR Code **v3 OFFLINE** (regex XSD, NT 2025.001 no pacote PL_010e):

```
p=<chave44 com tpEmis=9>|<versao=3>|<tpAmb>|<dia 01–31>|<vNF>|<opcional tipo dest>|<opcional CPF/CNPJ>|<assinatura base64>
```

QR Code **v3 ONLINE**:

```
p=<chave44 com tpEmis 1|3|4>|<versao=3>|<tpAmb>
```

v2 OFFLINE ainda descreve `cIdToken` + `cHashQRCode` (CSC). v3 OFFLINE usa **assinatura/hash
aplicável em base64**, não o hash hex de 40 do v2. O GOAL-015 (H-4) já declarou que a **ordem
literal e o algoritmo** exigem o Manual DANFE NFC-e v6.0, que **não baixou** (e esta sessão
também não — loop do portal). **Não inventar a lista de campos.**

🟦 Sem protocolo no DANFE em contingência (ressalva histórica da CAT 12 art. 9º VI, coerente com
cl. 11). Aviso / texto de contingência: o Ajuste **obriga impressão de dhCont no DANFE para EPEC**
(cl. 11 § 1º I b, “na hipótese do inciso III”). Para off-line, o MOC Anexo IV / Manual DANFE
definem o aviso; **não reproduzido aqui por ausência do PDF**. Pendência **P-QR-1** → GOAL 021.

CSC: o XSD confirma `cIdToken` + `cHashQRCode` no QR **v2**. O regex **v3** não contém esses
campos e termina em valor **base64**; sem o Manual DANFE NFC-e v6.0, **não afirmar** se ou como
o CSC participa da v3. Pendência **P-QR-1** → GOAL 021. Contingência **não** dispensa o
`infNFeSupl` quando houver DANFE — mas o gerador não é deste GOAL.

### 4.8 Cancelamento após contingência

Dois regimes, **não misturar** com NF-e 24 h:

| Situação | Prazo | Fonte |
|---|---|---|
| Cancelamento **ordinário** após Autorização de Uso | **≤ 30 minutos** (Ajuste cl. 15, redação SINIEF 7/18). SP (CAT 83/18, na portaria **revogada**) já era 30 min; SRE 40/2024 **não** republica o prazo — prevalece o Ajuste, salvo redução estadual futura | Ajuste 19/16 cl. 15 · GOAL 018 (B, sem XSD de evento) |
| Normal **autorizada** cuja operação foi acobertada por NFC-e **em contingência** | cancelar a Normal em **≤ 168 h** da autorização (cl. 15-A); UF pode reduzir | Ajuste cl. 12 I + cl. 15-A |
| Contingência **ainda não autorizada** | não há “cancelamento de uso” via 110111; o documento ainda não tem protocolo. Política: não transmitir / intervenção manual | — |

GOAL **018** permanece **B** (sem XSD `envEvento`). Este GOAL **não** implementa cancelamento.

### 4.9 Inutilização / numeração relacionadas

🟦 Ajuste cl. 11 § 2º:

- **I — vedada** a reutilização, em contingência, de número de NFC-e **transmitida** com tipo de
  emissão “Normal”;
- **II — vedada** a inutilização de numeração de NFC-e **emitida em contingência**.

🟦 Ajuste cl. 12 II: NFC-e transmitidas **antes** da contingência e **não autorizadas** →
inutilizar a numeração (GOAL 019, PR #63 — **não misturar**).

🟦 Ajuste cl. 11 § 5º (redação SINIEF 26/19): a partir do **11º dia do mês subsequente**, quebra
de sequência **sem** inutilização é **presumida** como documentos em contingência **não
transmitidos**.

🟦 Série dedicada 890–989 / 501–999: **revogada** (SINIEF 26/19, efeitos 18.12.2019). SRE 40/2024
**não** impõe faixa especial. 🟩 O piloto **reusa a série normal** da loja. Numerador **intocado**
neste GOAL.

---

## 5. Chave e numeração — prova de reconstrução

### 5.1 Impacto de `tpEmis` na chave

Composição canônica já implementada (`nfce-chave-acesso.ts`, alinhada ao teste e ao `Id` XSD):

```
cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + serie(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1)
```

🟦 Ajuste cl. 5ª § 3º II (redação SINIEF 32/24): a Autorização de Uso identifica a NFC-e de forma
única por **CPF/CNPJ + número + série + tipo de emissão**. Tipo de emissão **é** parte da
identidade legal — não é metadado cosmética.

### 5.2 Momento em que a chave deve ser construída

🟩 **Uma única vez**, no instante em que o XML de contingência é montado, **depois** de:

1. decisão explícita de entrar em off-line (gate humano / política — não fallback silencioso);
2. alocação de `nNF`/`série` pelo numerador existente (inalterado);
3. escolha de `cNF` pelo determinismo vigente; se o número Normal **nunca foi transmitido**, o
   `cNF` pode coincidir — `tpEmis` e `cDV` distinguem as chaves (ver §5.3);
4. preenchimento de `dhCont`/`xJust`.

A chave **não** é recalculada na transmissão posterior.

### 5.3 `cDV`, `nNF`, série, `cNF`

| Componente | Regra |
|---|---|
| `nNF` / série | Alocados pelo numerador **antes** do XML. Nunca voltam. Unicidade `(storeId, modelo, serie, numero, ambiente)` |
| `cNF` | 8 dígitos; ≠ `nNF`; hoje determinístico da semente `vendaId:serie:numero`. Se a mesma semente for reusada com `tpEmis` diferente, o `cNF` pode coincidir — a chave **ainda** muda por `tpEmis`. Aceitável. Não randomizar |
| `tpEmis` | **9** no off-line; entra na chave **antes** do `cNF` |
| `cDV` | mod-11 dos 43 dígitos. Muda se `tpEmis` muda |

### 5.4 Reaproveitar numeração?

| Cenário | Permitido? | Fonte |
|---|---|---|
| Número **nunca transmitido** como Normal, ainda sem XML persistido | sim — alocar uma vez e gerar já em `tpEmis=9` | numerador atual |
| Número **já transmitido** como Normal | **não** reusar em contingência | Ajuste cl. 11 § 2º I |
| Número de NFC-e **já emitida em contingência** | **não** inutilizar | Ajuste cl. 11 § 2º II |
| Rejeição da NFC-e **de contingência** já transmitida | Ajuste cl. 11 § 1º III **permite** gerar de novo **mesma** numeração/série, sem mudar base de cálculo, cadastro que mude remetente/destinatário, nem data de emissão/saída | ver §7.2 — **não** no primeiro slice |

### 5.5 NORMAL → CONTINGÊNCIA depois de gerar XML

| Estado do XML Normal | Consequência |
|---|---|
| Ainda **não** persistido / **não** assinado | Descartar o rascunho. Gerar de novo com `tpEmis=9`, `dhCont`, `xJust`. **Mesmo** `nNF` só se **nunca** houve transmissão Normal |
| Assinado e persistido, **sem** tentativa de envio | **Não** “patchar” o XML assinado. Descartar os bytes Normais, **reconstruir** chave/XML com `tpEmis=9`, `dhCont` e `xJust`, e **assinar de novo**. A cl. 11 § 2º I só veda reutilizar o número **após transmissão** Normal; antes dela, o mesmo `nNF` **não** é vedado. Política mais restritiva (queimar o número e alocar outro) exigiria decisão arquitetural explícita no 020A — **não** inferência da ADR-0017 |
| Transmissão **iniciada** / `UNKNOWN` | **Proibido** converter. ADR-0017: consultar. Contingência off-line, se ainda necessária para **outras** vendas, usa **novo** número |

🟩 **Prova:** XML e chave **precisam ser reconstruídos antes da assinatura** sempre que `tpEmis`,
`dhCont`, `xJust` ou qualquer campo de `infNFe` mudarem. Não existe “reassinar o mesmo Id com
outro tpEmis”: o `Id` **é** a chave.

### 5.6 Consequência sobre a assinatura XML

A Reference XMLDSig aponta para `#Id` = `#NFe{chave}`. Digest = SHA-1 C14N de `infNFe`.
Trocar `tpEmis` altera `infNFe` → digest diferente → `SignedInfo` diferente →
`SignatureValue` diferente.

Transmissão posterior usa os **bytes já assinados** (`exactBytes` + SHA-256), envelope SOAP
**sem** re-serializar (ADR-0017 · 016D-C0).

---

## 6. Máquina de estados mínima (contingência off-line)

Estados **do documento de contingência**, distintos da máquina online ADR-0017. Uma nota não
ocupa os dois caminhos.

```text
                    gate humano / política
                            │
                            ▼
                   [PREPARADO]                  snapshot + número alocado
                    tpEmis ainda não congelado  XML contingência NÃO gerado
                            │
                            ▼  build + dhCont/xJust + chave tpEmis=9 + assinar + persistir xmlAssinado
                   [EMITIDO_LOCAL]              DANFE/QR 021; venda EM_CONTINGENCIA
                            │                   condição resolutória: autorização futura
                            ▼
                   [PENDENTE_TX]                job CONTINGENCIA_TRANSMISSAO (outbox)
                            │
                            ▼  worker futuro (não neste GOAL)
                   [TX_ANDAMENTO]               TRANSMITINDO · P2 exactBytes
                            │
              ┌─────────────┼──────────────────────────────┐
              ▼             ▼                              ▼
     [AUTORIZADO_POST]  [REJEITADO_DEF]              [UNKNOWN]
      protocolo+nfeProc  número consumido            CONSULTA pode repetir
      xmlAutorizado      NÃO inutilizar (§2º II)     EMISSÃO NÃO repete
                         intervenção se cl. 11 §1 III
              │
              ▼
     (fim feliz)

Qualquer estado ──incerteza operacional / prazo / hash──► [INTERVENCAO_MANUAL]
```

| Estado | Significado | Retransmite emissão? | Consulta? |
|---|---|---|---|
| PREPARADO | documento preparado; identidade off-line ainda não congelada | n/a | n/a |
| EMITIDO_LOCAL | emitido localmente em contingência (XML assinado `tpEmis=9`, DANFE) | não | não |
| PENDENTE_TX | aguarda conectividade / teto dia útil | ainda não enviou | não |
| TX_ANDAMENTO | lote/SOAP em voo | **não** | se perder resposta → UNKNOWN |
| AUTORIZADO_POST | autorizado posteriormente | não | não |
| REJEITADO_DEF | rejeitado de forma conclusiva | **não** automática | não |
| UNKNOWN | resultado incerto | **nunca** automática (enquanto UNKNOWN) | **sim**, pode repetir |
| INTERVENCAO_MANUAL | humano obrigatório | não | a critério |

🟩 **UNKNOWN nunca autoriza retransmissão automática.** Herança ADR-0017, sem exceção de
contingência.

---

## 7. Transmissão posterior — payload e idempotência

### 7.1 Qual payload enviar?

🟦 Ajuste cl. 11 § 1º II: transmitir “**as NFC-e geradas em contingência**”.

Não é um XML “reconstruído na hora”. É o **arquivo gerado** (assinado) no EMITIDO_LOCAL.

🟩 **Canônico:** exatamente os bytes de `NotaFiscal.xmlAssinado` (SHA-256 conferido), envelopados
como hoje em `NFeAutorizacao4` (`exactBytes`). Sem builder, sem signer, sem novo `cNF`.

O serviço é o **autorizador normal** NFC-e 4.00 (`NFeAutorizacao4`), **não** o EPEC. O catálogo
016D-A já tem essa URL. Contingência off-line **não** precisa de WSDL EPEC. H-9/H-10 continuam
sendo o gate do SOAPAction do autorizador — **congelados**, não reabertos aqui.

### 7.2 Exceção regulatória de regeneração (rejeição)

Ajuste cl. 11 § 1º III: se a NFC-e de contingência for **rejeitada**, o emitente **deverá** gerar
de novo o arquivo com **mesma** numeração e série, sanando irregularidade, **sem** alterar
variáveis de imposto, cadastro que mude remetente/destinatário, nem data de emissão/saída; depois
pedir autorização de novo.

Isso **não** é UNKNOWN. É rejeição conclusiva.

🟩 **Política do primeiro ciclo (020A):** **não** implementar regeneração automática. Rejeição →
`REJEITADO_DEF` + `INTERVENCAO_MANUAL`. A permissão legal existe; a ADR-0017 e o risco de
divergência de bytes pedem gate humano. Slice posterior (`020D`/`020E`) só após 020A escrever a
política.

### 7.3 Outbox / job / timestamps / tentativas

Reusar `FiscalEmissaoJob`:

| Campo | Uso em contingência |
|---|---|
| `tipo` | `CONTINGENCIA_TRANSMISSAO` (enum já existe) |
| `dedupeKey` | `fiscal:contingencia-tx:v1:nota:{notaFiscalId}` (proposta 020C) · `@@unique(storeId, dedupeKey)` |
| payload | `notaFiscalId`, `chaveAcesso`, `xmlBytesSha256`, `tpEmis=9`, `dhCont`, **sem** XML em claro no log |
| `proximaTentativaEm` | backoff existente; **teto absoluto** = fim do próximo dia útil após emissão |
| tentativas | o teto de retry **não** pode ultrapassar o prazo legal; esgotou → INTERVENCAO_MANUAL, não loop |
| protocolo / `cStat` | gravar só no desfecho conclusivo (ADR-0018) |

Não implementar worker neste GOAL. Drenagem futura **não** usa o caminho P1 `emitir` do stub.

### 7.4 Reconciliação

Mesma doutrina ADR-0017, **chave da contingência** (`tpEmis=9`):

- timeout após envio → UNKNOWN → `CONSULTA` (`NFeConsultaProtocolo4`) pela **chave off-line**;
- `AUTHORIZED` → persiste protocolo/`xmlAutorizado`; **não** reenvia;
- `NOT_FOUND` → **uma** autorização consumível para reenviar **os mesmos bytes** (isso **não** é
  nova emissão: é a única retomada permitida da ADR-0017);
- `REJECTED` → REJEITADO_DEF; **não** inutilizar (cl. 11 § 2º II); humano;
- enquanto `UNKNOWN`, emissão **não** se repete; `CONSULTA` **pode** repetir;
- após `NOT_FOUND`, no máximo **uma** transmissão dos bytes persistidos.

Se existir **também** uma chave Normal da mesma venda (transmissão anterior): cl. 12 — consultar
a Normal; se autorizada e a operação foi acobertada pela contingência, cancelar a Normal
(168 h / cl. 15-A) — **GOAL 018**, não 020.

---

## 8. QR Code / DANFC-e — fronteira com o GOAL 021

Este GOAL **não** implementa gerador, impressão nem CSC.

| Tópico | Contrato agora | Dono |
|---|---|---|
| Layout QR offline ≠ online | XSD `infNFeSupl/qrCode` (v2/v3) | 021 |
| Dados exigidos v3 offline | chave(`tpEmis=9`) + versão 3 + `tpAmb` + dia + `vNF` + dest opcional + assinatura b64 | 021 (confirmar no Manual v6.0 — **P-QR-1**) |
| Hash / assinatura | v3: campos assinados (NT 2025.001); v2: CSC + SHA-1 hex | 021 |
| Texto/aviso DANFE | EPEC tem texto legal próprio; off-line: Manual/MOC Anexo IV não lido | 021 |
| CSC | v2: `cIdToken`+hash; v3: **não afirmar** sem Manual v6.0 (P-QR-1) | 021 + ADR-0014 |
| Sem protocolo | DANFE de contingência **sem** `nProt`; `urlChave` ainda aponta consulta pública | 021 |
| Persistência | colunas `qrCodeData` / `urlConsulta` já existem (GOAL-013) | 021 grava; 020 não |

Não misturar 021 nos slices 020A–020E.

---

## 9. Matriz de decisões obrigatória

| Regra | Fonte oficial | Impacto técnico | Componente futuro | Risco | Implementável agora |
|---|---|---|---|---|---|
| Modalidade canônica SP = off-line NFC-e | SRE 40/2024 art. 6º · S4 · RC 31961 · Ajuste cl. 11 I | `TipoEmissao.CONTINGENCIA_OFFLINE` + `tpEmis=9` | 020A policy | Usar EPEC/SVC por analogia 55 | **SIM** (contrato) |
| EPEC só com ativação SEFAZ (prod) | S4 · RC 31961 item 6 | Fora do 020; enum não tem `tpEmis=4` | slice EPEC futuro | Homologação EPEC “sempre on” não autoriza prod | **NÃO** (020) |
| SAT/ECF / modelo 2 vedados se SAT-obrigado **e** credenciado NFC-e | SRE 40 art. 1º § 1º | Sem fallback talão; SAT como cl. 11 II é outro caminho | — | Improvisar modelo 2 | **SIM** (policy) |
| `tpEmis=9` + `dhCont` + `xJust` | Ajuste cl. 11 § 1º I · XSD (grupo `minOccurs=0`; app deve exigir) | Builder hoje omite — validação de aplicação no 020B | 020B | Assinar XML `tpEmis=9` sem o grupo | **NÃO** (código 020B) |
| `tpEmis` entra na chave e no `Id` | XSD Id · `nfce-chave-acesso.ts` · Ajuste cl. 5ª § 3º II | Rebuild+resign obrigatório | 020B | Patch in-place do XML Normal | **SIM** (contrato) / **NÃO** (código) |
| Não reusar nº Normal já transmitido | Ajuste cl. 11 § 2º I | Decisão off-line **antes** do XML ou novo número | 020A · 020E | Fallback do pipeline stub | **SIM** (policy) |
| Não inutilizar nº de contingência | Ajuste cl. 11 § 2º II | GOAL 019 não cobre esses números | 020A · 019 | Job de inutilização cego | **SIM** (policy) |
| Série dedicada 501–999 / 890–989 | **revogada** SINIEF 26/19 | Reusar série normal | — | Inventar série 9xx | **SIM** (não fazer) |
| Prazo TX off-line = 1º dia útil seguinte | Ajuste cl. 11 § 1º II a | SLA do job ≠ 168 h | 020C | Copiar 168 h do dossiê 015 | **SIM** (contrato) |
| Payload posterior = XML gerado (bytes) | Ajuste cl. 11 § 1º II · ADR-0017 | `exactBytes` + SHA-256 | 020C | Rebuild na drenagem | **SIM** (contrato) |
| Regenerar após rejeição (mesma numeração) | Ajuste cl. 11 § 1º III | Gate humano; não auto | 020D posterior | Loop de rebuild | **NÃO** (1º ciclo) |
| UNKNOWN ≠ reemissão | ADR-0017 | CONSULTA pode repetir; emissão não, **salvo** uma retomada dos mesmos bytes após `NOT_FOUND` | 020D | Tratar timeout como contingência | **SIM** (contrato) |
| Emitida na impressão do DANFE (cond. resolutória) | Ajuste cl. 11 § 1º IV a | Estado EMITIDO_LOCAL ≠ AUTORIZADA | 020A · 021 | Liberar venda como autorizada | **SIM** (contrato) |
| 2ª via / XML guardado | RC 31961 · cl. 11 § 3º | `xmlAssinado` imutável | 020C · ADR-0018 | Apagar XML antes da TX | **SIM** (contrato) |
| DANFE: 2ª via pode ser XML; 1ª via / impressão no momento da emissão | Ajuste cl. 11 §1 IV a · §3 · RC 31961 7.1 | Não usar SRE 40 art. 5º §2 como vedação genérica da alínea “a” | 021 | Inventar “só chave” sem fonte | **NÃO** (021) |
| QR offline ≠ online | XSD `qrCode` v3 | Gerador distinto | 021 | Reusar QR online sem protocolo | **NÃO** (021) |
| Cancelamento 30 min (ordinário) / 168 h (cl. 15-A) | Ajuste cl. 15 e 15-A | Não no 020 | 018 | Aplicar 24 h da NF-e 55 | **NÃO** (018) |
| Numerador intocado | GOAL 010 | Sem schema/código numbering | — | Série 9xx paralela | **SIM** (não tocar) |
| Sem `lib/fiscal/contingencia` neste GOAL | comando do GOAL | só este `.md` | 020B+ | Overengineering | **SIM** |
| H-9/H-10 congelado | GOAL 017 | SOAPAction do autorizador continua pendente; EPEC não reabre | 017 | Baixar WSDL EPEC | **SIM** (não executar) |

---

## 10. Slices recomendados

Ajustados à auditoria real. **Não** incluir DANFC-e/QR (021) nem EPEC nem cancelamento (018).

| Slice | Nome | Escopo | Fora | Depende |
|---|---|---|---|---|
| **020A** | Contratos e policy puros | Tipos de estado §6; policy: gate de entrada, proibição de converter XML Normal, prazo dia útil, UNKNOWN, não inutilizar contingência; testes de política **sem** I/O | Builder, fila, schema | este plano |
| **020B** | Chave/XML contingência | `NfceXmlContext.tpEmis=9` + `dhCont`/`xJust`; chave; fixtures XSD off-line; **não** assina com A1 real | QR, SOAP, numerador | 020A · PL_010e |
| **020C** | Persistência / outbox offline | Gravar `xmlAssinado`, `tipoEmissao`, `dataContingencia`; upsert job `CONTINGENCIA_TRANSMISSAO`; **sem** worker de drenagem | Envio SEFAZ | 020B · ADR-0018 |
| **020D** | Reconciliação | Estender ADR-0017 à chave `tpEmis=9`; CONSULTA vs EMISSÃO; teto dia útil → INTERVENCAO_MANUAL | Regeneração cl. 11 §1 III | 020C |
| **020E** | Integração com emissão | Remover mapeamento stub `erro→contingencia`; gate “decidir off-line **antes** do XML”; PDV só consome policy | fiscalEnabled, produção, 021 | 020A–D · G-H humanos |

**Não criar 020-QR.** Se o DANFC-e em contingência precisar de gate próprio, permanece **GOAL 021**.

**Não criar 020-EPEC** enquanto a política for off-line. EPEC exige evento, `tpEmis=4`, WSDL
`RecepcaoEPEC` (H-6 do 015, sufixo `.asm`) e ativação SEFAZ — trilho separado.

Critério de **020A pronto:** testes unitários da policy (transições, prazos, proibições de
numeração) verdes; zero rede; zero alteração de `numbering`.

---

## 11. Pendências declaradas (não inferidas)

| ID | Lacuna | Bloqueia 020A? | Dono |
|---|---|---|---|
| P-MOC-IV | MOC 7.00 Anexo IV (PDF) não baixado — Portal Nacional em loop | **Não** — RC 31961 cita o trecho de guarda XML | 020B/021 se precisar do aviso DANFE |
| P-QR-1 | Ordem literal + algoritmo do QR v3 offline (Manual DANFE v6.0) | **Não** o 020; **sim** o 021 | 021 |
| P-168 | Confirmar se SP reduz o prazo 168 h da cl. 15-A | Não o off-line | 018 |
| P-FAQ | Página “Perguntas frequentes” SP não devolveu o corpo (JS); o texto operacional foi lido na RC 31961 que a cita | Não | — |
| P-DU | Calendário de “dia útil” (feriados) não fixado — só fuso `America/Sao_Paulo` apontado | Não o contrato 020A; sim o SLA 020C | 020A/020C |
| H-9/H-10 | SOAPAction do autorizador | Não o contrato 020; sim qualquer SOAP real | 017 (congelado) |

---

## 12. Revisão independente

| Campo | Valor |
|---|---|
| Revisor | Modelo de **família distinta** (GPT-5.6 Sol High) · read-only · sem assumir o parecer do autor |
| Base revisada | `docs/fiscal/FISCAL_020_CONTINGENCIA_NFCE_AUDIT_PLAN_042.md` sobre `origin/main` = `b5e655a` |
| Modo | Read-only. Checklist §12 (9 itens). Zero edição de código. Zero WS SEFAZ |
| Parecer original | **A-com-ajustes** (cinco MUST-FIX documentais) |
| Parecer após correção | **A** — ajustes F-1…F-8 incorporados neste documento |

Checklist do revisor (resultado **após** os patches):

| # | Tema | Resultado |
|---|---|---|
| 1 | Modalidade NFC-e/SP = off-line `tpEmis=9`; EPEC separado; SVC não transportada | PASS |
| 2 | `tpEmis` na chave 44 e em `infNFe/@Id` | PASS |
| 3 | Numeração: vedação só após **transmissão** Normal; não inutilizar contingência; séries 501–999/890–989 revogadas | PASS (F-2 corrigido) |
| 4 | XML/assinatura: rebuild+resign; sem patch in-place | PASS |
| 5 | Prazo TX off-line = 1º dia útil da **emissão**; 168 h = EPEC | PASS (F-5 corrigido) |
| 6 | QR/DANFC-e só contrato; GOAL 021 separado | PASS (F-4: CSC v3 não afirmado) |
| 7 | UNKNOWN nunca reemite; CONSULTA pode repetir; uma retomada só após `NOT_FOUND` | PASS (F-8 corrigido) |
| 8 | Sem regra NF-e 55 indevida | PASS |
| 9 | Zero WS SEFAZ no branch (único arquivo = este `.md`; H-9/H-10 diff 0) | PASS no diff |

Achados incorporados:

| # | Sev. | Correção |
|---|---|---|
| **F-1** | Alta | XSD `minOccurs=0` no grupo `dhCont`/`xJust`; obrigação é da regra/aplicação, não do XSD sozinho |
| **F-2** | Alta | cl. 11 § 2º I veda reuso após **transmissão** Normal; XML só assinado pode reconstruir o mesmo `nNF` |
| **F-3** | Média | SRE 40 art. 5º § 2º restringe a alínea **b** (NFP), não toda a alínea **a** |
| **F-4** | Média | CSC no QR v3 = P-QR-1; regex v3 não traz `cIdToken`/`cHashQRCode` |
| **F-5** | Média | Prazo contado de `dhEmi`, não de `dataContingencia`; fuso a fixar no 020A |
| **F-6** | Baixa | SRE 40 **alterada pela** SRE-81/25 |
| **F-7** | Baixa | Vedação modelo 2/ECF (art. 1º § 1º) distinta da vedação CF-e-SAT 01/01/2026 |
| **F-8** | Baixa | `NOT_FOUND` permite **uma** retomada dos mesmos bytes; emissão não se repete enquanto UNKNOWN |

---

## 13. Classificação

**A — contrato suficiente para iniciar o primeiro slice offline (`020A`).**

A revisão independente saiu **A-com-ajustes**; os MUST-FIX F-1…F-8 foram incorporados acima.
A classificação **A** vale **depois** desses ajustes documentais.

Não é **B:** as regras que o 020A precisa (modalidade SP, `tpEmis`, chave, numeração, prazo de TX,
UNKNOWN, payload = XML gerado) estão em SRE 40/2024, RC 31961, Ajuste 19/16 cl. 11 e XSD PL_010e
já hashado. O Manual DANFE / MOC Anexo IV faltantes afetam o **021** e detalhes de impressão, não
a policy do 020A.

Não é **D:** a tensão stub `erro→contingencia` × ADR-0017 é **documentada** e resolvida por
fronteira de caminho (online vs off-line), sem exigir rewrite imediato do core. Correção de código
fica no `020E`.

---

## 14. Encerramento

| # | Entrega | Valor |
|---|---|---|
| 1 | `origin/main` usada | `b5e655aa8c24476107801f33746df05e26586591` |
| 2 | Branch | `cursor/fiscal-020-contingencia-nfce-audit-plan-4646` |
| 3 | Fontes oficiais | §3 |
| 4 | Modalidade válida | Off-line NFC-e, `tpEmis=9` |
| 5 | Regra específica SP | Autorizada desde 10/07/2024 (SRE 40); EPEC só com ativação SEFAZ |
| 6 | Impacto `tpEmis`/chave | `tpEmis` é dígito da chave; muda `cDV` e `Id` |
| 7 | Numeração | Sem reuso de Normal transmitido; sem inutilizar contingência; série normal |
| 8 | Campos XML | `tpEmis=9`, `dhCont`, `xJust`; sem `infNFeSupl` neste GOAL |
| 9 | Assinatura | Rebuild+resign **antes** de assinar; TX usa bytes persistidos |
| 10 | TX posterior | XML gerado em contingência (`exactBytes`); prazo = 1º dia útil |
| 11 | Máquina de estados | §6 |
| 12 | Idempotência / reconciliação | ADR-0017 sobre a chave `tpEmis=9` |
| 13 | QR/DANFC-e | Contrato XSD v3; implementação = 021 |
| 14 | Matriz | §9 |
| 15 | Slices | 020A–020E; 021 e EPEC fora |
| 16 | Revisão independente | §12 |
| 17 | Arquivos | somente este |
| 18 | Commit | documental único |
| 19 | PR | Draft contra `main` |
| 20 | PRs #61/#62/#63 | intactas |
| 21 | H-9/H-10 | intocado |
| 22 | Rede SEFAZ WS | zero |
| 23 | Classificação | **A** |

**PARAR.** Não implementar contingência. Não mergear. Não executar H-9/H-10.
