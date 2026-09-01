# FISCAL-018 — Adjudicação nProt / chNFe / CNPJ do evento 110111 · GOAL 040

| Campo | Valor |
|---|---|
| GOAL nomeado | `FISCAL-018-CANCELAMENTO-NPROT-IDENTIFIERS-ADJUDICATION-040` |
| Data UTC | 2026-08-16 |
| Continua | GOAL 039 · PR **#62** Draft |
| Parent / head esperado | `5307c4d73a7749660c926169a878a2b6b6f6db20` |
| `origin/main` | `b5e655aa8c24476107801f33746df05e26586591` |
| Classificação | **B — falta republicação oficial de `e110111` com os tipos vigentes** |
| Rede SEFAZ (WS / SOAP / mTLS / homologação) | **zero** |
| H-9 / H-10 | **intocados** |
| `PL_010e_v1.02` | **intacto** |
| Artefatos 039 | **não substituídos** |
| Implementação de cancelamento | **não iniciada** |

> Dependência regulatória do GOAL 018. Não mergear. Não marcar Ready. Não executar H-9/H-10.

Este GOAL **adjudica documentalmente** os identificadores do evento 110111. **Não** implementa builder, parser, classificador nem rota Fiscal.

---

## 1. Resultado

Classificação **B**.

Os contratos vigentes de **`nProt` (15 ou 17)**, **`chNFe`** e **CNPJ alfanumérico** estão publicados em Nota Técnica e materializados em XSD do pacote **010d_v1.03 (em uso)**. O schema **clássico 110111** (`Evento_Canc_PL_v1.01`) continua com `TProt` de 15 dígitos e chave/CNPJ numéricos. **Não existe ZIP oficial que republica `e110111` importando os tipos 2025/2026.**

O critério A exige que o próximo GOAL implemente sem decisão humana arbitrária também **schema/evento** e **validação**. Validar um XML 110111 com `nProt` de 17 ou chave alfanumérica contra o grafo clássico **rejeitaria** o documento. Compor `e110111` clássico + `tiposBasico` 010d **não** é republicação oficial. Essa composição é a ambiguidade residual.

PR #62 permanece Draft. Um único commit complementar nesta trilha.

---

## 2. Fontes adicionais (este GOAL)

Somente Portal Nacional (`nfe.fazenda.gov.br`) e página pública estática da SEFAZ-SP. Proveniência em `lib/fiscal/xsd/evento-cancelamento/adjudication-040.json`.

| Fonte | Papel | SHA-256 | Bytes |
|---|---|---|---:|
| `PL_010d_v1.03.zip` | Pacote 010d **em uso** (10/07/2026) | `45ceefe4dfbbfec93958283b650a2f1e1734784f4770d070b9907754de081d9b` | 67813 |
| `NT_2025.002_v1.51_RTC.pdf` | NT 2025.002 **vigente** (04/08/2026) — nProt 15,17 | `a4aaaa181522b43cd90b502f8ccb9e4bdabea30fed838e2d0790be5ba77254a4` | 2182361 |
| `NT_2025.002_v1.10_RTC_NF-e_IBS_CBS_IS.pdf` | Prova cronológica (09/06/2025): 15\|17 **antes** do aviso SVRS | `bdc8a10e5f0eb3f598b14dcc5bd8039cdb964aea69dfb56bfdabc25749faa255` | 1540779 |
| `portal-nfe-informe-page3-2026-08-16.html` | Aviso 04/07/2025 name=1372 | `8f649565be24cb67a2d55e69bcd8e07a0e08e7d941b2c171eb4481bd68475c74` | 38486 |
| `portal-fazenda-sp-servicos-nfce-2026-08-16.html` | Anúncio SP 11/03/2026 (testes) | `139863da43ca9435ca7156cc6f273c46f9019a513bf73beb6eb43f0a0a2003bf` | 103890 |

Já versionados no GOAL 039 (não rebaixados, não substituídos): Evento Cancelamento 2018, `PL_Evento` NT 2026.004 v1.01, MOC 7.0, Anexo I, NT 2018.004, NT 2026.004 v1.01.

Não acessados: `homologacao.nfce.fazenda.sp.gov.br`, Web Services SEFAZ, SOAP, mTLS, A1.

---

## 3. Pacote 010d_v1.03 (em uso)

| Campo | Valor |
|---|---|
| Título no Portal | Schemas XML NF-e - 010d_v.1.03 CNPJ Alfanumérico- NT 2026.004.v.1.01- (Publicado em **10/07/2026**) |
| URL | `https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=%20pBOYTXBtbk=` |
| Nome original | `PL_010d_v1.03.zip` |
| SHA-256 | `45ceefe4dfbbfec93958283b650a2f1e1734784f4770d070b9907754de081d9b` |
| Bytes | 67813 |
| MIME | `application/zip` |
| `unzip -t` | sem erros |
| Diretório versionado | `lib/fiscal/xsd/schemas/PL_010d_v1.03/` |
| `e110111` / `eventoCancNFe` | **ausentes** |

Pastas do ZIP: `Evento/`, `NFe/`, `CadConsultaCadastro/` (26 entradas). Datas internas do ZIP: 23/06/2026–08/07/2026.

Envelope `Evento/` é o mesmo grafo genérico do GOAL 039 (`envEvento_v1.00.xsd`, `detEvento` = `xs:any processContents="skip"`). **Não contém 110111.**

`NFe/tiposBasico_v4.00.xsd` é **byte-idêntico** ao `PL_010e_v1.02` já no repositório (`772619c85723e598840667ca66e7298a250442df47eeb94b397d2a333ce62047`). `PL_010e_v1.02` **não foi alterado**.

### 3.1 Comparação com 010d_v1.01 (já estudado no GOAL 039)

O título `010d_v1.01` (Publicado em 08/06/2026) aponta para o ZIP `CNPJ Alfanumérico - NT2026.004.v.1.01 PL Eventos e Cad Consulta Cadastro CCC.zip`.

SHA-256 **idêntico** ao arquivo já versionado no GOAL 039:

`cc50170b276c23bdab88650e1c68a46fdc707c8e810664452bba974cf744e7db` (65203 bytes).

Não foi regravado. Diferença 1.03 × 1.01 no envelope: `Evento/tiposBasico_v1.03.xsd` **não** é byte-idêntico (1.03 = 33686 / `d89d4fe1…`; 1.01/PL_Evento = 34589 / `eccea073…`) — comentários históricos e annotation de `TCnpjVar`. **Patterns de `TProt`, `TChNFe`, `TCnpj` e `TCnpjOpc` são os mesmos.** Demais XSD do envelope Evento são idênticos.

---

## 4. Cronologia de `nProt` no cancelamento 110111

Não se assume que aviso operacional altere XSD.

| # | Fonte | Data exibida | Contrato de `nProt` / `TProt` | Camada | Altera o XSD clássico 110111? |
|---|---|---|---|---|---|
| **A** | Schema clássico `Evento_Canc_PL_v1.01` `tiposBasico_v1.03` | 21/12/2018 | `[0-9]{15}` **somente** | XSD do `nProt` em `detEvento` 110111 **e** do protocolo do evento no retorno | — (estado original) |
| **B** | MOC 7.0 Tabela 4-8 / P23 | nov/2020 (sem data na listagem) | Tam **15** (1+2+2+10) | Manual | Não |
| **C** | NT 2018.004 | 21/12/2018 | Tam **15**; 110111 **sem mudança** (objeto da NT é 110112) | NT + mesmo ZIP clássico | Não |
| **D** | NT 2025.002 **v1.10** | **09/06/2025** | §5.1: protocolo **15 ou 17**; PR09 Tam **15,17**; R51 Tam **15,17**; nota: *atualmente somente a SEFAZ-SP irá adotar 17 para a NFC-e* | NT de autorização / retorno de evento (`retEnvEvento_v1.00.xsd`) | **Não republica `e110111`** |
| **E** | Aviso Portal name=1372 | **04/07/2025** | Operacional SVRS: 17 emitido por erro 13h39–14h45; consulta corrigida para 15; *cancelamento aceitaria 15 ou 17 nas próximas horas* | Aviso de UF (SVRS), não XSD nacional | **Não.** O aviso **não** republica o pacote Evento Cancelamento |
| **F** | Tipos/eventos posteriores (`PL_Evento` NT 2026.004 08/06/2026; `PL_010e` tiposBasico) | 08/06/2026 e 10/07/2026 | XSD `[0-9]{15}\|[0-9]{17}` | Envelope genérico / documento NFC-e | Não contém `e110111` |
| **G** | **010d_v1.03 em uso** + NT 2025.002 **v1.51 vigente** | 10/07/2026 / 04/08/2026 | XSD Evento **e** NFe: `[0-9]{15}\|[0-9]{17}`; NT v1.51 §5.1 / PR09 / R51 **inalterados** em 15,17 | Tipos básicos vigentes + NT vigente | **Ainda sem `e110111`** |

**Documento que altera/supera a limitação de 15:** NT 2025.002, **já na v1.10 (09/06/2025)** — anterior ao aviso SVRS. A v1.51 vigente (04/08/2026) **reafirma** a mesma regra. O aviso de 04/07/2025 é evidência operacional (SVRS) e **não** é a fonte normativa da mudança.

**XSD efetivamente publicado que materializa 15\|17:** sim — `tiposBasico` de `PL_010d_v1.03/Evento`, `PL_010d_v1.03/NFe`, `PL_Evento` NT 2026.004 e `PL_010e_v1.02`. **Não** o `tiposBasico` do pacote `Evento_Canc_PL_v1.01`.

Diferença de camadas (obrigatória):

- **Runtime / NT / tipos vigentes:** 15 **OU** 17.
- **XSD clássico 110111:** 15 **somente**.
- Um `nProt` de 17 dígitos **passa** no XSD 010d/PL_010e e **falha** no XSD `Evento_Canc`.

NT 2025.002 v1.51 R51 descreve o sequencial do protocolo de evento ainda como “10 posições” no texto, enquanto a coluna Tam é `15,17`. Não se “corrige” o texto da NT. A coluna Tam e o §5.1 (sequencial 10 **ou** 12) são a regra de tamanho.

---

## 5. Conclusão 15 / 17

| Pergunta | Resposta |
|---|---|
| 15 somente? | **No XSD clássico 110111, sim.** Nas camadas NT 2025.002 e tipos 010d/PL_010e, **não**. |
| 15 OU 17? | **Sim**, para protocolo de **autorização** da NFC-e (PR09) e protocolo do **evento** no retorno (R51), desde NT 2025.002 v1.10 (09/06/2025), reafirmado na v1.51. |
| Em qual camada? | NT + `tiposBasico` vigentes. **Não** no grafo `e110111` publicado em 2018. |
| Desde quando? | Norma: **09/06/2025** (NT 2025.002 v1.10). XSD envelope/documento: pacotes 2025/2026 listados em uso. Aviso SVRS: 04/07/2025 (operacional). |
| Qual documento altera a limitação de 15? | **NT 2025.002** (§5.1, PR09, R51). Não o aviso. Não a NT 2026.004 (esta muda CNPJ/chave, não o tamanho de `nProt`). |
| Existe XSD publicado que materializa 15\|17? | **Sim** (010d_v1.03 / PL_Evento / PL_010e). **Não** no pacote Evento Cancelamento 110111. |

Para o **pedido** 110111, o `nProt` em `detEvento` é o protocolo de **autorização da NFC-e** (não o protocolo do evento). A NT 2025.002 altera esse tamanho na autorização (PR09) e no retorno de evento (R51). **Não** republica a tabela de `detEvento` 110111. O aviso SVRS afirma que o **autorizador** passaria a aceitar cancelamento com 15 ou 17 — comportamento operacional, sem XSD 110111 novo.

---

## 6. Evidência específica SP

Fontes consultadas (somente documentação pública estática):

| URL | Resultado |
|---|---|
| `https://portal.fazenda.sp.gov.br/servicos/nfce` | **Há** anúncio datado **11/03/2026**: o **ambiente de testes** passou a adotar protocolo de **17 posições**, previsto pela NT 2025.002. *“Após período de validação, essa mudança será aplicada ao ambiente de produção, em data a ser definida e divulgada neste site.”* |
| `https://portal.fazenda.sp.gov.br/servicos/nfe` | Sem texto sobre protocolo de 17 caracteres. |
| NT 2025.002 v1.10 e v1.51 | Nota nacional: *“atualmente, somente a SEFAZ-SP irá adotar o protocolo com 17 posições para a NFC-e.”* Sem data de go-live de produção. |
| Aviso nacional 04/07/2025 | SP adotará 17 *“futuramente (ainda sem previsão)”*. |

**Produção SP com protocolo de 17 caracteres: não comprovado.** Não se infere que produção já emita 17. Não se chamou endpoint de homologação nem de produção para “confirmar”.

---

## 7. Contrato CNPJ (fontes 2026)

Distinção obrigatória — não misturar.

### 7.1 CNPJ do autor do evento (`infEvento/CNPJ`)

| | Clássico 110111 | Vigente 2026 |
|---|---|---|
| Tipo XSD | `TCnpjOpc` | `TCnpjOpc` (mesmo nome, outro pattern) |
| Pattern | `[0-9]{0}\|[0-9]{14}` | `[0-9]{0}\|[0-9A-Z]{12}[0-9]{2}` |
| Tamanho | 0 ou 14 | 0 ou 14 (`maxLength` 14) |
| Alfanumérico? | Não | **Sim** — 12 `[0-9A-Z]` + 2 dígitos (DV) |
| NT | — | NT 2026.004 v1.01 §4 P10: CNPJ do autor, Tam **14**, tipo **C** (char) |

CPF do autor permanece `[0-9]{11}` nos dois pacotes.

### 7.2 CNPJ embutido / representado na chave

A chave vigente reserva **12 posições** ao CNPJ do emitente, com charset `[0-9A-Z]`, seguidas do restante numérico. Não é um campo `CNPJ` separado no evento; é fatia da `chNFe`.

Clássico `TChNFe` usava `[\d]{14}` nessa fatia (somente dígitos) dentro de um pattern estruturado por UF/AAMM/modelo/série/número/código/DV.

### 7.3 CNPJDest no retorno (específico 110111)

NT 2026.004 §4 R23: `CNPJDest`, Tam 14, tipo C, *“Específico para evento 110111 – Cancelamento”*. Mesmo tamanho; tipo char.

---

## 8. Contrato `chNFe` (fontes 2026)

`chNFe` é o identificador do **documento** (NFC-e) ao qual o evento se vincula — não o CNPJ do autor.

| | Clássico 110111 | Vigente 2026 |
|---|---|---|
| Tipo XSD | `TChNFe` (pattern estruturado numérico) | `TChNFe` (pattern posicional) |
| Tamanho | 44 | 44 |
| Pattern | `(1[1-7]\|2[1-9]\|3[1,2,3,5]\|4[1-3]\|5[0-3])(0[6-9]\|[1-9][\d])(0[1-9]\|1[0-2])([\d]{14})([\d]{5})([\d]{9})([\d]{10})` | `[0-9]{6}[0-9A-Z]{12}[0-9]{26}` |
| Charset | somente dígitos | 6 dígitos + **12 `[0-9A-Z]`** + 26 dígitos |
| NT | — | NT 2026.004: chave de numérico para alfanumérico (char), Tam 44; §4 P12 `chNFe` Tam 44 tipo C |

**Não** se usa o `TChNFe` legado para validar chave 2026, nem o `TChNFe` 010d para afirmar que o XSD 2018 já aceita alfanumérico.

### 8.1 Impacto no `Id` de `infEvento`

Formação documental (ambos os leiautes): `ID` + `tpEvento` + chave + `nSeqEvento`.

| Pacote | Pattern do `Id` de envio |
|---|---|
| `Evento_Canc` 2018 | `ID[0-9]{52}` |
| 010d_v1.03 / `PL_Evento` 2026 | `ID[0-9]{12}[0-9A-Z]{12}[0-9]{28}` |

Uma chave alfanumérica **não cabe** no `Id` clássico. O envelope 010d **já** admite. O pacote 110111 clássico **não**.

NT 2026.004 §8 (Cancelamento / Cancelamento por Substituição) **só** republica `P31 chNFeRef` (exclusivo **110112**). Não republica `detEvento` 110111 nem `nProt`.

---

## 9. Tabela normativa clássico × vigente

Prioridade: NT vigente > XSD do pacote **em uso** da mesma camada > XSD clássico da mesma camada > MOC 7.0 (não atualizado para 15\|17) > aviso operacional.

| Campo | Contrato clássico (110111 / 2018) | Contrato vigente (2025–2026) | Fonte vigente | Prioridade normativa | Comportamento futuro OmniGestão |
|---|---|---|---|---|---|
| `nProt` em `detEvento` 110111 (protocolo da NFC-e) | 15 dígitos (`TProt`) | 15 **ou** 17 dígitos (`[0-9]{15}\|[0-9]{17}`) na NT e nos tipos 010d; XSD 110111 **ainda 15** | NT 2025.002 v1.51 §5.1 + PR09; 010d Evento `TProt`; Evento_Canc `TProt` | NT + tipos em uso **superam** MOC/XSD 2018 **na camada de identificador**; não apagam o XSD 110111 | **Implementável como aceitar 15\|17** (não inventar tamanho). **Não implementável** como validação XSD contra `Evento_Canc` |
| `nProt` no `retEvento` (protocolo do evento) | 15 (`TProt` opcional) | Tam 15,17 (R51); XSD 010d `TProt` 15\|17 | NT 2025.002 v1.51 R51; 010d `TProt` | Idem | **Implementável** aceitar 15\|17 no parser de retorno |
| `chNFe` | 44 numérico estruturado | 44; charset `[0-9]{6}[0-9A-Z]{12}[0-9]{26}` | NT 2026.004 §4 P12; 010d `TChNFe` | NT 2026.004 + 010d | **Implementável** (pattern 010d). Não usar `TChNFe` 2018 |
| CNPJ autor | 14 dígitos ou vazio | 14; `[0-9A-Z]{12}[0-9]{2}` ou vazio | NT 2026.004 §4 P10; 010d `TCnpjOpc` | NT 2026.004 + 010d | **Implementável** |
| CNPJ na chave | 14 dígitos na fatia da chave | 12 `[0-9A-Z]` + 2 DV numéricos, via `TChNFe` vigente | NT 2026.004; 010d `TChNFe` | NT 2026.004 + 010d | **Implementável** como parte da chave (não como campo solto) |
| `Id` `infEvento` | `ID[0-9]{52}` | `ID[0-9]{12}[0-9A-Z]{12}[0-9]{28}` | 010d / PL_Evento `leiauteEvento` | Envelope em uso | **Implementável** só com o pattern 2026. Clássico **rejeita** chave alfa |
| Estrutura `detEvento` 110111 (`descEvento`, `nProt`, `xJust`) | enumeração `Cancelamento`; `nProt` 1-1; `xJust` 15–255 | **Não republicada** em NT 2026.004 §8 nem em 010d | Evento_Canc `e110111` + MOC §5.9 | Único leiaute 110111 publicado | **Implementável** como estrutura. Tipos dos identificadores: ver linhas acima |
| Schema/grafo de validação 110111 | fecha em `Evento_Canc_PL_v1.01` | 010d fecha o envelope **genérico**, não o 110111 | dois ZIPs **em uso** no Portal | Falta republicação | **Não implementável** (grafo único oficial) |
| `cStat` lote / evento / consulta | 128 / 135 / 101 por camadas | **sem evidência conflitante** | GOAL 039; NT 2025.002 v1.51 R07 ainda cita 128 | Preservar | **Implementável** (não reabrir) |
| Protocolo 17 em **produção** SP | — | testes desde 11/03/2026; produção **sem data** | página NFC-e SEFAZ-SP | Anúncio SP < NT nacional (intenção) | **Não implementável** como “SP produção = 17”. Aceitar 15\|17 **não** depende de inferir go-live SP |

---

## 10. Regra proposta para futura implementação (sem código neste GOAL)

1. **Identificadores** (aceitar / emitir): governados por NT 2025.002 v1.51 + NT 2026.004 v1.01 + `PL_010d_v1.03` `tiposBasico` — `nProt` 15 ou 17; `chNFe` e CNPJ alfanuméricos nos patterns acima.
2. **Payload 110111** (`tpEvento`, `descEvento`, cardinalidade `nProt`/`xJust`, assinatura sobre `infEvento`): governado por `Evento_Canc_PL_v1.01` / MOC §5.9 / NT 2018.004 (110111 sem mudança estrutural).
3. **Não** validar o XML 110111 resultante contra o `tiposBasico` de 2018 se o documento usar 17 dígitos ou chave alfanumérica — o XSD clássico é a camada errada para esses identificadores.
4. **Não** inventar um grafo misto versionado como se fosse ZIP oficial. A republicação de `Evento_Canc` / `e110111` continua **faltando**.
5. **Retorno:** 128 = lote processado; 135 = evento registrado e vinculado; 101 = situação do documento na consulta — não sucesso de `retEvento` 110111.
6. **SP produção 17:** tratar como **não comprovado**. Homologação/testes SP anunciaram 17 em 11/03/2026; isso não autoriza chamar o WS nem afirmar produção.

Enquanto o item 4 não for publicado, o GOAL de implementação **não** atinge A só com estes contratos: a **validação XSD do evento 110111** continua sem pacote único.

---

## 11. `cStat` (não reaberto)

Sem evidência conflitante nas fontes 040. Preservar GOAL 039:

- **128** — lote processado (`retEnvEvento/cStat`); NT 2025.002 v1.51 R07 ainda descreve “128-Lote de Evento Processado”.
- **135** — evento registrado e vinculado (`retEvento/infEvento/cStat`).
- **101** — cancelamento homologado na **consulta** da situação do documento (`retConsSitNFe`), não sucesso do `retEvento` 110111.

---

## 12. Qual XSD/conjunto deve governar a futura implementação

| Papel | Conjunto | Motivo |
|---|---|---|
| Leiaute específico 110111 | `Evento_Canc_PL_v1.01` (`e110111_v1.00.xsd`) | Único ZIP oficial que publica `detEvento` 110111 |
| Identificadores vigentes | `PL_010d_v1.03` `Evento/tiposBasico_v1.03.xsd` (e NFe `tiposBasico_v4.00`, idêntico a `PL_010e`) | Pacote **em uso**; materializa NT 2025.002 + NT 2026.004 |
| Envelope genérico (sem 110111) | `PL_010d_v1.03/Evento` = `PL_Evento` NT 2026.004 (patterns iguais) | `detEvento` skip; não substitui `e110111` |
| Documento NFC-e | `PL_010e_v1.02` (intacto) | Já adotado; tipos de chave/CNPJ/`TProt` alinhados a 010d NFe |
| Eventos RTC (`Eventos_RTC` / schema NT 2025.002 RTC) | **fora** do grafo 110111 | 110001 ≠ 110111 (prova negativa 039; 110111 só aparece na NT 2025.002 como tipo **não** cancelável por 110001) |

---

## 13. Gap residual (por que não A)

Publicação oficial **faltante**: ZIP “Evento Cancelamento” / `e110111` alinhado a NT 2025.002 (`TProt` 15\|17) **e** NT 2026.004 (`TChNFe` / `TCnpj` / `Id` alfanuméricos), listado no Portal como em uso.

Sem isso, validação XSD do 110111 vigente exige composição de dois pacotes **em uso** — decisão humana, não extração de um grafo oficial.

SP produção 17 é **não comprovado**, mas **não** é o bloqueio principal: a NT nacional já manda aceitar 15 ou 17 conforme UF/modelo.

---

## 14. Validações

Reprodução: `npm run fiscal:xsd:verify-evento-cancelamento` **e** `npm run fiscal:xsd:verify-nprot-identifiers-040`.

O verifier de `PL_010e` **não** foi alterado. O manifesto 039 **não** foi alterado.

Revisão independente (outra família de modelo): **CONCORDA-B** — `docs/fiscal/FISCAL_018_CANCELAMENTO_NPROT_IDENTIFIERS_040_REVIEW.md`. Confirmou 15 vs 17 por camadas, precedência NT 2025.002 v1.10 anterior ao aviso, schema ≠ operacional, SP produção não comprovada, chNFe/CNPJ modernos sem mistura, zero inferência de grafo, zero rede SEFAZ.

---

## 15. O que este GOAL não fez

- Não implementou cancelamento, SOAP, mTLS, A1, H-9/H-10.
- Não misturou `tiposBasico` 010d dentro de `Evento_Canc_PL_v1.01`.
- Não substituiu ZIPs/XSD/PDF do GOAL 039.
- Não chamou Web Service SEFAZ.
- Não atualizou `docs/ai/CURRENT_STATUS.md` (nenhuma capability operacional nova).
- Não criou PR nova; não marcou #62 Ready; não mergeou.
