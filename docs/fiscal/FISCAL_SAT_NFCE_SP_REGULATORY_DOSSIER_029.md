# FISCAL-029 — Dossiê regulatório SAT/CF-e-SAT × NFC-e modelo 65 (São Paulo)

| Campo | Valor |
|---|---|
| **GOAL** | `FISCAL-029-SAT-SP-REGULATORY-DECISION-070` |
| **Tipo** | **Exclusivamente documental.** Zero código, zero schema, zero homologação, zero SEFAZ, zero H-9/H-10, zero #73 |
| **Base observada** | `origin/main` = `789c791327decd031fcbf2b185199762ea8b5489` |
| **Data da pesquisa / acesso às fontes** | **2026-08-19** |
| **UF / piloto** | SP · Matriz RafaCell Assistec, Taguaí/SP (ADR-0016) |
| **ADR correspondente** | **ADR-0022** (próximo número livre em `docs/decisions/`; **não** é o ADR-P14 histórico de ativação/G-F7) |
| **Decisão** | **A** — NFC-e como trilha principal; SAT fora do roadmap ativo |
| **Classificação `SAT_LOCAL`** | **reservado / descartável** — enum permanece no schema; **sem implementação** |
| **Classificação deste GOAL** | proposta **A** (evidência oficial suficiente) — ADR em `proposta` até aceite humano |

> **Regra:** nenhuma afirmação regulatória por memória de modelo, blog, ERP concorrente ou fórum.
> Cada fonte abaixo registra órgão, título, URL, data de publicação quando disponível, data de
> acesso e a conclusão objetiva que a fonte sustenta.

**Relações com documentos anteriores (não reescritos):**

- Q-10 do GOAL-015 (`FISCAL_SEFAZ_DOSSIE_UF_001.md` §5, pesquisa **2026-07-23**) já apontava a
  vedação do CF-e-SAT em 01/01/2026. Este dossiê **revalida** essa leitura em 2026-08-19 com atos
  posteriores (avisos do portal SAT em jan–mar/2026 e RC 33856/2026) e **corrige** a base da
  contingência NFC-e: a Portaria CAT 12/2015 foi **revogada** pela Portaria SRE 40/2024.
- O rótulo histórico **ADR-P14** em `FISCAL_CONTINUATION_ADRS_PROPOSTOS_001.md` trata de
**ativação controlada por loja / G-F7**, não desta decisão. As linhas históricas **ADR-Pxx**
desse mapa **não** reservam número canônico em `docs/decisions/`. O número real desta decisão
é **ADR-0022**.

---

## 0. Inventário ADR (numeração real)

Consultado em `origin/main` = `789c791…` em 2026-08-19:

| # | Situação |
|---|---|
| 0001 (legado) … **0021** | versionados em `docs/decisions/` |
| **0005** | draft CoWork — **não** ocupa 0022 |
| **0022 / 0023** | **não existem** como arquivo ADR |
| ADR-P13 → “0022” / ADR-P14 → “0023” (tabela de 2026-07) | **propostas do pacote de continuação**; essa tabela **não** reserva número canônico em `docs/decisions/` |

**Número escolhido:** ADR-0022.

---

## 1. Fontes oficiais (catálogo datado)

Data de acesso de todas as linhas: **2026-08-19**, salvo indicação.

### 1.1 SAT / CF-e-SAT

| ID | Órgão | Título | URL | Publicação | Conclusão objetiva sustentada |
|---|---|---|---|---|---|
| S1 | SRE / SEFAZ-SP | Portaria SRE 79/2024 | https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-79-de-2024.aspx | Ato 31/10/2024 · DOE 01/11/2024 · atualização da página 02/11/2024 | Inclui na Portaria CAT 147/2012 o **art. 34-C** (vedação de ativação de **novos** SAT, com ressalva a quem já usava, inclusive filiais do mesmo CNPJ-base) e o **art. 34-D** (**emissão** do CF-e-SAT **vedada a partir de 1º de janeiro de 2026**). |
| S2 | SRE / SEFAZ-SP | Portaria SRE 92/2024 | https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-92-de-2024.aspx | Ato 19/12/2024 · DOE 20/12/2024 · atualização 24/12/2024 | **Revoga o art. 34-C.** O art. **34-D permanece**. A vedação de **novos** equipamentos SAT deixou de existir como regra autônoma; a vedação de **emissão** a partir de 01/01/2026 não foi revogada. |
| S3 | SRE / SEFAZ-SP | Comunicado SRE 06/2025 | https://legislacao.fazenda.sp.gov.br/Paginas/Comunicado-SRE-6-de-2025.aspx | Ato 22/05/2025 · DOE 23/05/2025 · atualização 24/05/2025 | Confirma a vedação do art. 34-D a partir de 01/01/2026. Em substituição, o contribuinte deve emitir **NF-e modelo 55** ou **NFC-e modelo 65**. Venda sem documento fiscal é infração (Lei 6.374/1989, art. 85). Recomenda a troca com antecedência. |
| S4 | SRE / SEFAZ-SP | RC 32089/2025 | https://legislacao.fazenda.sp.gov.br/Paginas/RC32089_2025.aspx | Ato 24/07/2025 · DOE 28/07/2025 · atualização 29/07/2025 | Equipamento SAT **já existente não pode ser usado até o fim da vida útil**. A partir de 01/01/2026 **cessa o uso** do SAT; substitui-se por NFC-e 65 ou NF-e 55. Relata a revogação do 34-C pela SRE 92/2024. |
| S5 | SRE / SEFAZ-SP | RC 32314/2025 | https://legislacao.fazenda.sp.gov.br/Paginas/RC32314_2025.aspx | Ato 15/09/2025 · DOE 16/09/2025 | Reafirma 34-D + Comunicado SRE 06/2025. A consulta tributária **não** resolve o rito operacional de desativação; rito vai ao SIFALE / Fale Conosco SAT. |
| S6 | SRE / SEFAZ-SP | RC 33856/2026 | https://legislacao.fazenda.sp.gov.br/Paginas/RC33856_2026.aspx | Ato 02/07/2026 · DOE 03/07/2026 | CF-e-SAT emitido em **janeiro/2026** é documento **inábil**; a operação considera-se **desacompanhada** de documento fiscal (RICMS art. 184, II e IV) e pode ensejar penalidade (art. 527). **Não** cabe NF complementar. Caminho: denúncia espontânea no SIPET. |
| S7 | SEFAZ-SP | Portal SAT — Sobre o SAT | https://portal.fazenda.sp.gov.br/servicos/sat/ | Avisos 08/01/2026, 02/03/2026, 23/03/2026 (página vigente em 19/08/2026) | CF-e-SAT emitido a partir de 01/01/2026 é processado com **erro 1001 — Cupom inválido**. Quem emitiu após 31/12/2025 deve escriturar/recolher e fazer denúncia espontânea (SN: PGDAS-D; RPA: EFD). **Não é necessária** desativação/cessação de equipamentos ainda vinculados. |

### 1.2 NFC-e modelo 65

| ID | Órgão | Título | URL | Publicação | Conclusão objetiva sustentada |
|---|---|---|---|---|---|
| N1 | SEFAZ-SP | Portal NFC-e — Sobre a NFC-e | https://portal.fazenda.sp.gov.br/servicos/nfce | Banner vigente em 19/08/2026 (avisos 11/03/2026 e 02/03/2026 na mesma página) | **NFC-e obrigatória a partir de 01/01/2026 para todo o varejo paulista**, em substituição ao CF-e-SAT (mod 59), NF venda a consumidor (mod 02) e NFVC online (mod 56). Credenciamento prévio + CSC. Ambiente de testes sem validade jurídica. |
| N2 | SRE / SEFAZ-SP | Portaria SRE 40/2024 | https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-40-de-2024.aspx | Ato 05/07/2024 · DOE 10/07/2024; alterações SRE-81/25 (DOE 17/11/2025) | Norma-mãe **vigente** da NFC-e em SP. Emissão do modelo 65 + DANFE-NFC-e segundo o **Ajuste SINIEF 19/16**. Credenciamento por estabelecimento. **Art. 6º:** contingência nos termos da **cláusula 11** do Ajuste 19/16. **Art. 12: revoga a Portaria CAT 12/2015.** |
| N3 | SEFAZ-SP | Portaria CAT 12/2015 (revogada) | https://legislacao.fazenda.sp.gov.br/Paginas/pcat122015.aspx | Publicada 05/02/2015 · **revogada** pela SRE 40/2024 (DOE 10/07/2024) · página atualizada 10/07/2024 | Histórico. O art. 10, I, admitia SAT como contingência da NFC-e. **Não está mais em vigor.** Não pode fundamentar implementação SAT_LOCAL. |
| N4 | CONFAZ | Ajuste SINIEF 19/16 | https://www.confaz.fazenda.gov.br/legislacao/ajustes/2016/AJ_019_16 | 09/12/2016, com alterações posteriores | Cláusula 11: em problemas técnicos, a UF escolhe entre (I) geração prévia + autorização posterior (offline/MOC); (II) ECF ou SAT; (III) EPEC. Prazos: inciso I = **1º dia útil** seguinte; inciso III = **168 horas**. |
| N5 | SEFAZ-SP | RICMS/2000, art. 212-O | https://legislacao.fazenda.sp.gov.br/Paginas/art212o.aspx | Decreto 61.084/2015 e alterações; página atualizada 17/05/2026 | NFC-e é DFE modelo 65 (inciso III). CF-e-SAT permanece no rol (inciso II), mas a nota de cabeçalho aponta o Comunicado SRE 06/2025. § 7º, item 9: CF-e-SAT **pode ser substituído** por NF-e 55 ou NFC-e 65. § 8º: NFC-e nas vendas a não contribuinte (balcão / entrega em SP / fora do estabelecimento). |

### 1.3 Fontes deliberadamente não usadas como autoridade

Blogs de ERP, manuais de concorrentes, fóruns e páginas comerciais (mesmo quando descrevem a
SRE 40/2024) **não** entram no dossiê. Onde apareceram em busca, serviram só para localizar a
URL oficial, que foi relida na fonte primária.

---

## 2. Respostas às dez questões

### 2.1 Situação atual do SAT/CF-e-SAT em SP

**A emissão do CF-e-SAT (modelo 59) está vedada desde 1º de janeiro de 2026.**

Fundamento: art. 34-D da Portaria CAT 147/2012, incluído pela Portaria SRE 79/2024 (S1),
confirmado pelo Comunicado SRE 06/2025 (S3), pelas RC 32089/2025, 32314/2025 e 33856/2026
(S4–S6) e pelo processamento SEFAZ com **erro 1001 — Cupom inválido** (S7).

O SAT continua existindo como **equipamento e como verbete no RICMS**, mas **não é documento
hábil** para acobertar operação de varejo paulista após 31/12/2025.

### 2.2 Novos contribuintes ainda podem/devem ativar SAT?

**Não devem. Ativar SAT em 2026 não produz documento fiscal hábil.**

- De 01/11/2024 a 19/12/2024 o art. 34-C vedava ativação de **novos** SAT, com ressalva a quem
  já usava (S1).
- A SRE 92/2024 **revogou o 34-C** (S2). Isso **não** reabre a emissão: o 34-D permanece.
- Páginas procedimentais de ativação ainda existem no portal SAT; são **resíduo operacional**,
  não reautorização de emissão. O próprio portal (S7) classifica CF-e-SAT pós-01/01/2026 como
  cupom inválido.

Para um contribuinte novo (ou para o OmniGestão, que nunca emitiu SAT): **não há obrigação nem
utilidade regulatória em ativar SAT.**

### 2.3 Equipamentos SAT já existentes

| Tema | Conclusão | Fonte |
|---|---|---|
| Continuar emitindo até o fim da vida útil | **Não.** Cessa o uso em 01/01/2026 | S4 |
| Desativação/cessação obrigatória no sistema | **Não é necessária** para equipamentos ainda vinculados | S7 (23/03/2026) |
| Emissão após 31/12/2025 | Cupom **inválido** (erro 1001); documento **inábil** | S6, S7 |
| Regularização se alguém emitiu em 2026 | Escrituração/recolhimento + denúncia espontânea SIPET | S6, S7 |

Hardware SAT legado pode permanecer vinculado; **não autoriza** trilha de software SAT_LOCAL.

### 2.4 Papel atual da NFC-e modelo 65 no varejo paulista

A NFC-e modelo 65 é o **documento de varejo a consumidor** vigente em SP, obrigatória a partir
de 01/01/2026 para **todo o varejo paulista**, em substituição ao SAT/mod 59, à NF modelo 02 e
à NFVC online/mod 56 (N1).

Base legal estadual vigente: **Portaria SRE 40/2024** + **Ajuste SINIEF 19/16** (N2, N4), no
quadro do RICMS art. 212-O, III e § 8º (N5). Alternativa de substituição do SAT também admite
**NF-e modelo 55** (S3, N5 § 7º item 9) — típica de B2B / operações em que a legislação exige
modelo 55, não de PDV de assistência técnica a consumidor.

Credenciamento é pré-requisito; CSC é obtido após o credenciamento (N1, N2 art. 2º). Homologação
(`tpAmb=2`) não tem validade jurídica — coerente com ADR-0016.

### 2.5 Datas de transição, encerramento e obrigatoriedade

| Data | Evento | Fonte |
|---|---|---|
| 01/11/2024 | SRE 79/2024 vigora; nascem 34-C e 34-D | S1 |
| 10/07/2024 | SRE 40/2024 publica a disciplina vigente da NFC-e; revoga CAT 12/2015 | N2, N3 |
| 20/12/2024 | SRE 92/2024 revoga 34-C | S2 |
| 23/05/2025 | Comunicado SRE 06/2025 (esclarecimento pré-corte) | S3 |
| **01/01/2026** | **Corte:** vedação de emissão CF-e-SAT; NFC-e obrigatória no varejo paulista | S1, S3, N1 |
| 08/01/2026 | Portal SAT: erro 1001 para cupons a partir de 01/01/2026 | S7 |
| 02/03/2026 | Portal SAT: rito para quem emitiu após 31/12/2025 | S7 |
| 23/03/2026 | Portal SAT: desativação de equipamento **não** é necessária | S7 |
| 03/07/2026 | RC 33856/2026: SAT de jan/2026 = documento inábil | S6 |

**Não há prorrogação oficial do corte 01/01/2026** nas fontes lidas em 19/08/2026. Portarias SRE
37/2026 e 41/2026 (ago/2026) aparecem no portal de legislação como atos recentes **sem relação
com SAT/NFC-e** (não usadas como fundamento desta decisão).

### 2.6 Exceções relevantes

| Exceção | Aplica-se ao piloto RafaCell / OmniGestão PDV? | Fonte e limite |
|---|---|---|
| Substituir SAT por **NF-e 55** em vez de NFC-e 65 | Só se a operação exigir modelo 55 (B2B, veículos, Administração Pública, etc.). **Não** é a trilha de PDV a consumidor | S3, N5 § 7º itens 4–5 e 9 |
| Produtor rural (modelo 4 → NF-e/NFC-e; Ajuste SINIEF 10/22, SRE 40/2024 art. 1º § 2º) | **Não.** O piloto é varejo de assistência técnica, não produtor rural | N2 |
| MEI — Portaria SRE 80/2025 art. 5º dispensa obrigatoriedade de **NF-e** | **Não aplicável ao piloto** (não é MEI). Não foi lida aqui como dispensa geral de NFC-e de varejo; o portal (N1) fala em “todo o varejo paulista” | citada só para não misturar trilhas |
| SAT como contingência NFC-e (Ajuste 19/16, cl. 11, II) | A cláusula nacional ainda lista SAT “a critério da UF”. Em SP, após 01/01/2026, o art. **34-D** torna a emissão inutilizável. **Não** se implementa o inciso II | N4 + S1 |
| SAT como contingência na CAT 12/2015 art. 10, I | **Revogada** | N3 |
| Manter equipamento vinculado sem emitir | Sim, como fato administrativo (S7). **Não** é permissão de software SAT_LOCAL | S7 |

**Nenhuma exceção encontrada autoriza SAT_LOCAL para loja física de varejo paulista em 2026.**

### 2.7 Impacto para lojas físicas como a loja-piloto

A Matriz RafaCell Assistec em Taguaí/SP (ADR-0016) é estabelecimento **varejista paulista**.
Desde 01/01/2026 o documento de PDV a consumidor é **NFC-e modelo 65** (ou NF-e 55 quando a
operação o exigir). SAT **não** acoberta a venda.

O método **atual** de emissão da RafaCell continua sendo o insumo humano **H-5** do GOAL-015
(declaração direta; não inferir). Isso **não** muda a obrigação de direito: se a loja ainda
emitiu SAT em 2026, o documento é inábil (S6/S7) e a regularização é contábil/SIPET — fora do
escopo de software deste GOAL.

Para o OmniGestão: a trilha já escolhida (SEFAZ-SP, NFC-e 65, `tpAmb=2`, ADR-0015/0016) é a
**trilha principal do piloto** para PDV a consumidor. A legislação de substituição do SAT
admite também **NF-e modelo 55** quando a operação o exigir (S3, N5) — isso **não** reabre
SAT e **não** é um segundo caminho SAT “para o dia em que faltar internet”.

### 2.8 Contingência aplicável à NFC-e em SP

**Norma vigente:** Portaria SRE 40/2024, art. 6º → Ajuste SINIEF 19/16, cláusula 11 (N2, N4).

| Alternativa nacional (cl. 11) | Status em SP em 2026 | Prazo de transmissão posterior |
|---|---|---|
| I — geração prévia + autorização posterior (offline / MOC) | **Caminho nacional vigente** (cl. 11, I). A SRE 40/2024, art. 6º, remete à **cláusula 11 inteira**; o inciso I permanece utilizável em SP | até o **1º dia útil** seguinte |
| II — ECF ou SAT | A cláusula nacional **ainda menciona** SAT/ECF “a critério da UF”. Em SP, o **art. 34-D** torna a emissão de CF-e-SAT **inutilizável** após 01/01/2026 — não porque a SRE 40/2024 tenha riscado o inciso II, e sim porque a vedação de emissão prevalece | — |
| III — EPEC | Alternativa nacional ainda prevista; endpoints EPEC existem no catálogo NFC-e de SP (GOAL-015). **Não** reabre SAT | **168 horas** |

A Q-08 do GOAL-015 citou Portaria CAT 12/2015 (formulário de segurança + EPEC, 168h). Essa
portaria está **revogada**. A leitura atualizada é: contingência NFC-e em SP = **cláusula 11
do Ajuste 19/16**, incorporada pela SRE 40/2024 art. 6º; o **inciso II (SAT)** da cláusula
nacional **não é utilizável** após 01/01/2026 por força do art. 34-D, não por omissão na SRE 40.

Este GOAL **não** implementa contingência (F10 / GOAL-020 permanecem a trilha NFC-e). Apenas
fecha que contingência **não** justifica SAT_LOCAL.

### 2.9 Necessidade real de implementar `SAT_LOCAL` no OmniGestão Pro

**Não há necessidade regulatória de implementar SAT_LOCAL.**

Implementar SAT em 2026, para o piloto SP, produziria cupom inválido (erro 1001) e operação
desacompanhada de documento hábil (S6, S7). Custo de hardware, AC, certificado SAT e fila
paralela **não** cumpre obrigação acessória vigente.

### 2.10 Riscos de manter o enum `SAT_LOCAL` sem implementação

O valor já existe em `FiscalProviderTipo` (migration 0013 / schema). Este GOAL **não** altera
Prisma.

| Risco | Severidade | Mitigação documental (sem código) |
|---|---|---|
| Operador selecionar `SAT_LOCAL` na config e esperar emissão | Média | Classificar como **reservado/descartável**; resolver já devolve `provider_nao_implementado` (estado atual) |
| Roadmap listar “SAT (SP)” como feature futura e alguém iniciar GOAL de implementação | Alta | ADR-0022 + item 5 do ROADMAP_FISCAL: SAT **fora** do roadmap ativo |
| Confundir “enum no schema” com autorização de uso | Média | Mesma disciplina da CC-e no modelo 65 (GOAL-015): valor no enum **não** autoriza o caminho |
| Limpeza prematura do enum (schema) | Baixa neste GOAL | Schema é área protegida; remoção só com ADR + autorização humana futura |
| Importação futura de XML SAT legado de terceiro | Baixa | Seria leitor histórico, **não** `SAT_LOCAL` emissor — exigiria ADR nova |

---

## 3. Decisão arquitetural

Alternativas do GOAL, julgadas **somente** pelo dossiê:

| Opção | Veredito | Por quê |
|---|---|---|
| **A. NFC-e principal; SAT fora do roadmap ativo** | **Escolhida** | Vedação de emissão + cupom inválido + NFC-e obrigatória no varejo SP. SAT não é contingência utilizável. |
| B. NFC-e principal; SAT legado só para compatibilidade futura | Rejeitada | Não há legado SAT no OmniGestão (0 documentos, 0 implementação). “Compatibilidade futura” em SP exigiria ato que **reabra** o 34-D — hoje inexistente. |
| C. Implementação SAT necessária | Rejeitada | Contraria S1, S3, S4, S6, S7 e N1. |
| D. Evidência insuficiente | Rejeitada | Fontes oficiais convergentes de 2024, 2025 e **2026** (inclusive RC de jul/2026). |

**`SAT_LOCAL`:** **reservado / descartável**.

- **reservado:** permanece no enum até decisão humana de schema.
- **descartável:** não entra em sprint, não tem adapter, não é selecionável como trilha do piloto.
- **não ativo, não legado implementado.**

Formalização: [`ADR-0022-sat-fora-do-roadmap-nfce-principal-sp.md`](../decisions/ADR-0022-sat-fora-do-roadmap-nfce-principal-sp.md).

---

## 4. O que este GOAL não faz

- Não implementa SAT, NFC-e, contingência, DANFCE, fila, provider.
- Não toca `lib/fiscal/**`, `app/**`, `components/**`, `prisma/**`, H-9/H-10, PR **#73**.
- Não executa SEFAZ, credenciamento, CSC, certificado.
- Não declara o método atual de emissão da RafaCell (H-5 permanece humano).
- Não fecha G-F7 / G-F12 / N6 / N7.

---

## 5. Condições que reabririam a decisão

Somente ato **oficial** posterior a 2026-08-19 que:

1. revogue ou suspenda o art. 34-D da Portaria CAT 147/2012; **ou**
2. torne SAT modalidade de contingência NFC-e **expressamente utilizável em SP** apesar do 34-D; **ou**
3. crie obrigação de SAT para perfil igual ao piloto (varejo paulista de assistência técnica).

Expansão a outra UF (MFE/CE, etc.) é **ADR nova**, não reabertura silenciosa desta.

---

## 6. Verificação de links (2026-08-19)

GET HTTP **200** na sessão para todas as URLs `legislacao.fazenda.sp.gov.br` e
`portal.fazenda.sp.gov.br` da §1. Conteúdo normativo citável foi lido do HTML oficial.

O **Ajuste SINIEF 19/16** (N4) foi lido na página CONFAZ
<https://www.confaz.fazenda.gov.br/legislacao/ajustes/2016/AJ_019_16> (cláusula 11 integral,
incluindo o inciso II SAT/ECF “a critério da UF”). Um GET posterior no mesmo ambiente
retornou falha de conexão (HTTP 000) — a citação permanece a URL oficial CONFAZ; o texto
usado está no corpo deste dossiê (§2.8).

---

## 7. Revisão independente (outra família)

- **Revisor:** modelo GPT (família distinta do autor Grok).
- **Escopo:** fontes, interpretação, datas, SAT × NFC-e, coerência da ADR, ausência de código.
- **Classificação:** **A** — decisão regulatória fechada com evidência suficiente.
- **Opção A mantida.** Correções factuais pedidas (NFC-e não é o único modelo hábil; SRE 40
  remete à cláusula 11 inteira; 34-D é o que inutiliza o inciso II; numeração Pxx; linha
  residual “SAT/NF-e depois” no schema design) foram **incorporadas neste GOAL** antes do
  commit.
- **Não encontrada** obrigação oficial de implementar `SAT_LOCAL` para o piloto RafaCell.
