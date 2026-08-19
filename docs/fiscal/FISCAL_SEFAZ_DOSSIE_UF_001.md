# FISCAL_SEFAZ_DOSSIE_UF_001 — Dossiê oficial SEFAZ-SP (NFC-e modelo 65)

| Campo | Valor |
|---|---|
| **GOAL** | `FISCAL-SEFAZ-OFFICIAL-RESEARCH-015` |
| **Tipo** | **Exclusivamente documental.** Zero código, zero credenciamento, zero CSC real, zero certificado, zero produção |
| **Base** | `origin/main` = `c87cbc8` (merge do PR #30, que trouxe o GOAL-014) |
| **Branch / worktree** | `fiscal/goal-015-sefaz-research` · `C:\Projetos\wt-fiscal-015` |
| **Data da pesquisa** | **2026-07-23** (toda consulta desta página foi feita nesta data) |
| **UF** | **SP** — confirmada na ADR-0016 |
| **Piloto** | Matriz RafaCell Assistec, Taguaí/SP · NFC-e modelo 65 · homologação · `tpAmb=2` |
| **Decisão-mãe** | ADR-0015 (ratificada no GOAL-014) — integração direta com a SEFAZ |
| **Consumidores** | GOALs 016–022 |
| **Status** | ✅ **Aprovado por Rafael Faria em 2026-07-23** — **G-C8 criado e declarado FECHÁVEL** (§13) |

> **Regra deste documento:** nenhuma afirmação regulatória por memória de modelo. Cada regra abaixo
> tem **URL oficial + data de consulta**. Onde a fonte não pôde ser lida, isso está declarado como
> lacuna — **não** preenchido por inferência.

**Legenda de natureza da informação** (exigida pelo GOAL):
🟦 regra regulatória · 🟩 decisão de arquitetura · 🟨 procedimento de homologação ·
🟪 insumo contábil/jurídico · 🟥 ação humana necessária

---

## 0. Pré-flight

| Item | Resultado |
|---|---|
| `origin/main` | `c87cbc8` |
| Merge do PR #30 | ✅ confirmado — `Merge pull request #30 from rafaelfaria49-png/fiscal/goal-014-provider-strategy` |
| **UF da loja-piloto** | ✅ **SP** (ADR-0016 §"Escopo": município Taguaí, UF SP). Sem UF confirmada o GOAL pararia — não foi o caso |
| **CNPJ** | 🟥 **NÃO consta nos documentos.** A ADR-0016 §"O que não inclui" diz textualmente que não preenche CNPJ, IE, endereço, IBGE, CRT, série, CSC ou certificado. **Insumo humano pendente (H-1)** |
| **CRT / regime** | 🟥 **NÃO consta.** Mesma origem. O projeto assume Simples Nacional em outros pontos (CSOSN 102/500, ADR-0012), mas **o CRT do piloto não está registrado em lugar nenhum**. **Insumo humano pendente (H-2)** |
| CNPJ completo publicado? | ❌ Não — e este dossiê **não** o publicará; identificação por `storeId`, nunca por CNPJ literal |

### 0.1 ⚠️ Rótulos citados pelo comando que **não existem** no repositório

Varredura de `docs/` inteiro em 2026-07-23:

| Rótulo | Situação real |
|---|---|
| **Q-03, Q-04, Q-05, Q-06, Q-10** | ❌ **não existem.** A única questão numerada em todo o repositório é **Q-09** (pesquisa de ST/CSOSN 500 do GOAL-006, em `FISCAL_TAX_ST_EVIDENCIAS_001.md` §3 e ADR-0012) |
| **Registro/tabela de Q-xx** | ❌ **não existe.** Não há "registro Q-xx" em nenhum relatório de reconciliação para atualizar |
| **G-C7, G-C8** | ❌ **não existem.** A numeração de gates de construção é G-C1, G-C2, G-C3, G-C4, G-C6 (G-C5 foi criado pelo GOAL-014) |

**Como este dossiê trata isso** — mesmo critério adotado para o G-C5 no GOAL-014: os rótulos são
**criados agora**, com o registro explícito de que **nascem neste GOAL** e **nenhum histórico
anterior lhes é atribuído**. **Nada é retroagido.**

**Rótulos Q-xx criados por este GOAL** (autorizados no checkpoint de 2026-07-23):

| Rótulo | Título |
|---|---|
| **Q-03** | Endpoints e serviços NFC-e da SEFAZ-SP |
| **Q-04** | CSC e QR Code |
| **Q-05** | Cancelamento e inutilização |
| **Q-06** | Carta de Correção para NFC-e |
| **Q-08** | Contingência |
| **Q-10** | SAT/MFE versus NFC-e em São Paulo |

**Q-07 e Q-11 NÃO foram criados** — decisão expressa do checkpoint. Uma versão preliminar deste
dossiê havia proposto ambos; a proposta foi **recusada** por não haver definição expressa e
rastreável em fonte autoritativa. Varredura em 2026-07-23 do `MASTER_FISCAL_EXECUTION_PLAN.md`, dos
`FISCAL_CONTINUATION_*` e do `FISCAL_RECONCILE_REPORT_001.md`: **nenhuma ocorrência** de `Q-07`,
`Q-11` ou de qualquer definição de numeração Q-xx além da Q-09.

O **conteúdo** pesquisado sob aqueles rótulos permanece no dossiê — ambiente de homologação (§6) e
o resíduo "SEM GTIN" (§9) foram itens expressamente pedidos na pesquisa —, apenas **sem número de
questão**. `Q-07` e `Q-11` permanecem **inexistentes** e não devem ser citados por GOALs futuros.

### 0.2 Resíduos regulatórios herdados

| Resíduo | Situação |
|---|---|
| **"SEM GTIN"** | 🟦 Buscado em `docs/` e `lib/fiscal/`: **não há tratamento de `cEAN`/`cEANTrib` com o literal `SEM GTIN`** no código fiscal. Item real para o GOAL-016, hoje **descoberto e não implementado** — detalhe em §9. **Sem rótulo Q-xx** (ver §0.1) |
| Q-09 (ST/CSOSN 500) | ✅ fechado no GOAL-006 / ADR-0012 |

---

## 1. Q-03 · Autorizador e Web Services da NFC-e em SP

🟦 **Fonte:** SEFAZ-SP — WebServices NFC-e ·
<https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/WebServices.aspx> · consultado **2026-07-23**

**Autorizador:** a própria **SEFAZ-SP** (não é SVRS/SVAN). A NFC-e usa **host próprio**,
`nfce.fazenda.sp.gov.br`, **distinto** do host da NF-e (`nfe.fazenda.sp.gov.br`) — confundir os dois
é um erro de configuração provável e deve ser barrado pelo resolver.

**Versão publicada:** **4.00 (NT2016.002)**.

### 1.1 Homologação (`tpAmb=2`) — os endpoints do piloto

| Serviço | URL |
|---|---|
| NFeAutorizacao4 | `https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx` |
| NFeRetAutorizacao4 | `https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx` |
| NFeInutilizacao4 | `https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx` |
| NFeConsultaProtocolo4 | `https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx` |
| NFeRecepcaoEvento4 | `https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx` |
| NFeStatusServico4 | `https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx` |
| RecepcaoEPEC (contingência) | `https://homologacao.nfce.epec.fazenda.sp.gov.br/EPECws/RecepcaoEPEC.asm` ⚠️ |
| EPECStatusServico (contingência) | `https://homologacao.nfce.epec.fazenda.sp.gov.br/EPECws/EPECStatusServico.asmx` |

### 1.2 Produção (`tpAmb=1`) — **fora do escopo, registrado só para allow-list negativa**

| Serviço | URL |
|---|---|
| NFeAutorizacao4 | `https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx` |
| NFeRetAutorizacao4 | `https://nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx` |
| NFeInutilizacao4 | `https://nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx` |
| NFeConsultaProtocolo4 | `https://nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx` |
| NFeRecepcaoEvento4 | `https://nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx` |
| NFeStatusServico4 | `https://nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx` |
| RecepcaoEPEC | `https://nfce.epec.fazenda.sp.gov.br/EPECws/RecepcaoEPEC.asm` ⚠️ |
| EPECStatusServico | `https://nfce.epec.fazenda.sp.gov.br/EPECws/EPECStatusServico.asm` ⚠️ |

🟩 **Estes endereços de produção existem no catálogo para serem NEGADOS** pelo resolver enquanto o
G-F12 não for aberto — não para serem usados.

### 1.3 ⚠️ Conflitos e observações de fidelidade

1. **Sufixo `.asm` vs `.asmx`** — três URLs de EPEC aparecem na página oficial terminando em `.asm`
   (sem o `x`) enquanto todas as demais usam `.asmx`. É **muito provavelmente erro de digitação da
   página**, mas **não foi corrigido aqui por conta própria**: o catálogo do GOAL-016 deve validar
   os dois e registrar qual responde. 🟥 **H-6**.
2. **Serviço ausente na NFC-e:** não há `NfeConsultaCadastro` para NFC-e (existe para NF-e). Se o
   preflight precisar consultar cadastro, terá de usar o serviço da NF-e — decisão do GOAL-016.
3. **Distribuição DF-e** não aparece no catálogo NFC-e de SP.

---

## 2. Q-04 · CSC e QR Code

### 2.1 CSC — Código de Segurança do Contribuinte

🟦 **Fonte:** SEFAZ-SP — Sobre a NFC-e · <https://portal.fazenda.sp.gov.br/servicos/nfce> ·
consultado **2026-07-23**

- 🟦 **Credenciamento é pré-requisito.** Verbatim: *"Após o credenciamento, para que o contribuinte
  possa emitir NFC-e, é necessário obter o código de segurança"*.
- 🟨 **Obtenção:** menu **"Gerenciar Cód Segurança"** no portal da SEFAZ-SP, após o credenciamento.
- 🟦 **Homologação e produção têm CSC próprios** — o CSC de teste não vale em produção e vice-versa.
- 🟦 O CSC é **conhecido apenas pela SEFAZ e pelo contribuinte** vinculado ao CNPJ.
- 🟩 **Guarda:** o CSC é segredo fiscal e entra no cofre sob as regras da **ADR-0014** (envelope
  encryption, DEK por segredo, bucket exclusivo, server-only). **Nunca** em log, bundle, doc ou
  fixture — mesma disciplina do A1.
- 🟩 **`idCSC` (`CSCid`)** é o identificador **não-secreto** do CSC e vai **em claro** no QR Code; o
  **CSC em si nunca** trafega no QR Code — só participa do cálculo do hash.

> ⚠️ **Conflito de fonte sobre a quantidade de CSC.** A página "Sobre a NFC-e" indica **um** código
> por contribuinte; outra página do mesmo portal indica que o contribuinte *"pode solicitar até 2
> CSCs para toda a empresa no estado"*. **Registrado sem escolher vencedor** — a diferença importa
> para rotação de CSC (ter 2 permite trocar sem parar a emissão). 🟥 **H-3** confirma no
> credenciamento.

**Este dossiê não contém e nunca conterá CSC real.**

### 2.2 QR Code

🟦 **Base normativa (SP):** Portaria CAT 12/2015, **art. 9º, III** — o DANFE-NFC-e *"deverá conter um
código bidimensional contendo mecanismo de autenticação digital"*, conforme manual técnico ·
<https://legislacao.fazenda.sp.gov.br/Paginas/pcat122015.aspx> · consultado **2026-07-23**

🟦 **Versão vigente do leiaute:** **QR Code versão 3**, definida pela **NT 2025.001** (v1.00
publicada em **25/03/2025**). A NT estabelece que *"o controle sobre a autenticidade do conteúdo do
QR-Code impresso no DANFE NFC-e será feito pela assinatura de campos específicos do QR-Code"*.
Fonte: <https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=trSXReoZPuY%3D> ·
consultado **2026-07-23**

O que está **confirmado** sobre a v3:

- o **CSC participa da geração do hash** do QR Code (e da imagem), não do conteúdo em claro;
- existe **parâmetro de versão** no QR Code — obrigatório informá-lo quando a versão é "2 ou 3";
- **online e offline têm layouts distintos** (contagem de parâmetros diferente entre NFC-e ONLINE e
  NFC-e OFFLINE).

> ⚠️ **LACUNA DECLARADA — não preenchida por inferência.** A **ordem exata e os nomes completos dos
> parâmetros** do QR Code v3 (online e offline) e a **especificação literal do algoritmo de hash**
> exigem a leitura do **Manual de Padrões DANFE NFC-e / QR Code v6.0 (março/2025)**. As tentativas
> de leitura direta desse PDF no portal nacional falharam nesta sessão (loop de redirecionamento) e
> o PDF que SP publica é a **versão 4.1, de dezembro/2016** — anterior ao QR Code v3. **Não escrevi
> a lista de parâmetros de memória.** 🟥 **H-4**: obter o manual v6.0 e anexar antes do GOAL que
> gerar QR Code.

> ⚠️ **Conflito documental relevante:** SP ainda distribui o *Manual de Especificações Técnicas do
> DANFE NFC-e QR Code — Versão 4.1 (dez/2016)* em
> <https://portal.fazenda.sp.gov.br/servicos/nfce/Downloads/> enquanto o padrão nacional está em
> **v6.0 (mar/2025)** e o QR Code em **v3**. **O nacional/NT prevalece**; o manual de SP está
> desatualizado no ponto do QR Code. Não seguir o v4.1.

🟩 **Impacto no que já foi construído:** o GOAL-013 persistiu `qrCodeData` e `urlConsulta` como
colunas. A mudança para QR Code v3 **valida** essa decisão (o dado é persistido, não recalculado),
mas o **gerador** ainda não existe — é trabalho do GOAL de DANFCE/QR (021).

---

## 3. Q-05 · Cancelamento e Inutilização

### 3.1 Cancelamento

🟦 **Fonte:** Portaria CAT 12/2015, **art. 14** (redação da Portaria CAT-83/18) ·
<https://legislacao.fazenda.sp.gov.br/Paginas/pcat122015.aspx> · consultado **2026-07-23**

Verbatim: *"Em prazo não superior a 30 (trinta) minutos contados do momento em que foi concedida a
Autorização de Uso"*, e desde que *"não tenha havido a saída da mercadoria"*.

| Regra | Valor |
|---|---|
| Prazo | **30 minutos** da Autorização de Uso |
| Condição material | **não pode ter havido saída da mercadoria** |
| Instrumento | **evento** de cancelamento, via `NFeRecepcaoEvento4` |
| cStat de sucesso | **101** — *Cancelamento de NF-e homologado* |

> ⚠️ **Atenção — o prazo de 30 min da NFC-e é MUITO mais curto que os 24h da NF-e.** Confundir os
> dois é um erro provável de implementação. No PDV isso significa que o cancelamento é praticamente
> uma operação de "à beira do caixa", não um fluxo administrativo posterior.

🟨 **Cancelamento extemporâneo (após 30 min) — existe em SP, mas é outro caminho.**
Fonte: <https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/Guia-Cancel-Extemp-NFCe.aspx> ·
consultado **2026-07-23**. Aplica-se a *"NFC-e emitida para operação inexistente, por motivo de erro
no sistema do contribuinte e/ou duplicidade, passados mais de 30 minutos da emissão"*, e é feito
**pelo SIPET** (`sipet.fazenda.sp.gov.br`), **sem custo**. **Não é uma chamada de web service** — é
processo administrativo humano. 🟩 O sistema **não deve** oferecer botão de "cancelar" após 30 min
como se fosse automático; deve orientar ao SIPET.

### 3.2 Inutilização

🟦 **Fonte:** Portaria CAT 12/2015, **art. 15** · mesma URL · consultado **2026-07-23**

Verbatim: *"deverá solicitar a inutilização do número da NFC-e … até o 10º (décimo) dia do mês
subsequente"*.

| Regra | Valor |
|---|---|
| Quando | **quebra de sequência** na numeração (número não usado e que não será usado) |
| Prazo | **até o 10º dia do mês subsequente** |
| Serviço | `NFeInutilizacao4` |
| cStat de sucesso | **102** — *Inutilização de número homologado* |

🟩 **Ligação com o GOAL-010 (numeração):** a alocação atômica de numeração já existe. A inutilização
é o contraponto — todo número alocado e não autorizado vira candidato a inutilização. O GOAL-016+
precisa de um relatório de "buracos de numeração" por série/mês para cumprir o prazo do dia 10.

---

## 4. Q-06 · Carta de Correção — **VEDADA para NFC-e**

🟦 **Fonte:** Portaria CAT 12/2015, **art. 8º, § 1º** ·
<https://legislacao.fazenda.sp.gov.br/Paginas/pcat122015.aspx> · consultado **2026-07-23**

Verbatim: *"vedada a emissão de carta de correção, em papel ou de forma eletrônica"*.

> ## ❌ Carta de Correção **NÃO é aplicável** à NFC-e modelo 65 em SP. A vedação é **expressa**.

🟩 **Consequência obrigatória para o código — confirmada no checkpoint de 2026-07-23.**
O schema já antecipa o evento de CC-e e o GOAL determinou que ele **não podia ser exposto antes da
confirmação regulatória**. A confirmação veio e é **negativa**. Fica decidido:

| Regra | Estado |
|---|---|
| **Fail-closed por modelo** | Modelo 65 → recusa **antes** de qualquer rede, em qualquer caminho |
| **UI** | ❌ nenhuma |
| **Rota** | ❌ nenhuma |
| **Ação no provider** | ❌ nenhuma |
| **Enum compartilhado** | Só poderá servir a **modelo fiscal que legalmente aceite o evento**; nunca ao 65 |

- a correção de erro em NFC-e se dá por **cancelamento** (30 min) ou, fora do prazo, pelo
  **procedimento extemporâneo no SIPET** (§3.1);
- manter o valor no enum **não é** autorização de uso — a fronteira por modelo é que decide.

---

## 5. Q-10 · SAT/CF-e × NFC-e em São Paulo — **conclusão decisiva**

> **Adendo 2026-08-19 (FISCAL-029):** esta Q-10 (pesquisa 2026-07-23) permanece como evidência
> histórica do GOAL-015. A decisão arquitetural vigente está no dossiê
> [`FISCAL_SAT_NFCE_SP_REGULATORY_DOSSIER_029.md`](./FISCAL_SAT_NFCE_SP_REGULATORY_DOSSIER_029.md)
> e na [`ADR-0022`](../decisions/ADR-0022-sat-fora-do-roadmap-nfce-principal-sp.md) (**proposta**):
> NFC-e principal; SAT fora do roadmap ativo; `SAT_LOCAL` reservado/descartável. A revalidação
> confirma a vedação de 01/01/2026 e **corrige** a base da contingência: a Portaria CAT 12/2015
> foi revogada pela Portaria SRE 40/2024 (Ajuste SINIEF 19/16, cláusula 11).
> **Nenhum código neste adendo.**

Esta era a questão potencialmente bloqueante. **Não há impedimento — há o oposto.**

🟦 **Fonte 1:** SEFAZ-SP — Sobre a NFC-e · <https://portal.fazenda.sp.gov.br/servicos/nfce> ·
consultado **2026-07-23**. Verbatim:

> *"A emissão de NFC-e passa a ser obrigatória a partir de 01/01/2026 para todo o varejo paulista,
> em substituição ao CF-e-SAT (mod 59), Nota Fiscal de Venda ao Consumidor (mod 02) e Nota Fiscal de
> Venda a Consumidor online (mod 56)."*

🟦 **Fonte 2:** Resposta à Consulta **RC 32089/2025** ·
<https://legislacao.fazenda.sp.gov.br/Paginas/RC32089_2025.aspx> · consultado **2026-07-23**:

> *"A emissão do CF-e-SAT fica vedada a partir de 1º de janeiro de 2026"*, devendo o contribuinte
> emitir *"a Nota Fiscal de Consumidor Eletrônica - NFC-e (modelo 65) ou a Nota Fiscal Eletrônica -
> NF-e (modelo 55)"*.

🟦 **Base normativa:** **Portaria SRE 79/2024** (vigente desde 01/11/2024) incluiu os **arts. 34-C e
34-D** na **Portaria CAT 147/2012**. O **art. 34-C foi revogado** pela **Portaria SRE 92/2024**
(publicada em 20/12/2024); **o art. 34-D permanece** como o dispositivo que rege a vedação. A RC não
registra exceção nem regra de transição.

### 5.1 Conclusão

| Pergunta do GOAL | Resposta |
|---|---|
| Existe impedimento para aderir à NFC-e? | ❌ **Não.** |
| Há impedimento material que obrigue a parar a trilha do adapter? | ❌ **Não. A trilha do GOAL-016 está liberada.** |
| Transição / obrigatoriedade | 🟦 NFC-e **obrigatória** para o varejo paulista desde **01/01/2026**; CF-e-SAT **vedado** desde a mesma data |
| Credenciamento | 🟦 exigido (art. 2º da Portaria CAT 12/2015) + CSC |
| Restrições | nenhuma específica ao perfil; o piloto é um estabelecimento varejista em SP |

### 5.2 🟥 H-5 — método atual de emissão da RafaCell

**Fato de calendário:** a obrigatoriedade começou em **2026-01-01**; a data desta pesquisa é
**2026-07-23**.

**Não há evidência documental suficiente para afirmar como a RafaCell emite atualmente.** O
repositório não registra isso e o módulo fiscal do OmniGestão está dormente (0 callers produtivos).

> 🟥 **H-5 — registro oficial:** *"Pendente de declaração direta de Rafael — não inferir uso de
> NFC-e, NF-e 55, sistema terceiro ou ausência de emissão."*

🟪 Esta é matéria **contábil/jurídica**, não conclusão de engenharia. **H-5 não bloqueia o
fechamento documental do GOAL-015**, mas **deve ser resolvido antes de avaliar urgência operacional
e exposição de conformidade**. Nenhum GOAL futuro deve presumir um cenário: a resposta vem de
declaração direta, não de dedução.

---

## 6. Ambiente de homologação

> **Sem rótulo Q-xx** — conteúdo de pesquisa expressamente pedido pelo GOAL, mas sem numeração de
> questão autorizada (ver §0.1).

🟨 **Fonte:** SEFAZ-SP — Sobre a NFC-e · <https://portal.fazenda.sp.gov.br/servicos/nfce> ·
consultado **2026-07-23**

- 🟦 O ambiente de teste opera **"sem validade jurídica"**; documentos ali **não são** documentos
  fiscais.
- 🟨 **Credenciamento só em homologação existe:** a SEFAZ-SP oferece a opção **"Credenciar só em
  Homologação"**, permitindo testar sem credenciar em produção
  (<https://www.fazenda.sp.gov.br/nfe/credenciamento.asp> · consultado 2026-07-23). **É exatamente o
  que o piloto precisa** e mantém `tpAmb=1` inacessível por construção.
- 🟨 Testes em homologação são **recomendados, não obrigatórios**, antes do credenciamento em
  produção.

### 6.1 Regra do destinatário em homologação

🟦 **Fonte:** MOC / regra de validação nacional, confirmada via Portal NF-e ·
<https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=Ll7tbBdZPyE%3D> ·
consultado **2026-07-23**

Em `tpAmb=2`, a razão social do destinatário deve ser exatamente:

```
NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL
```

Divergência → **rejeição**. 🟩 O builder do GOAL-016 deve **forçar** esse literal quando
`tpAmb=2`, jamais deixá-lo a cargo de cadastro.

> ⚠️ Em NFC-e o destinatário é frequentemente **ausente** (venda ao consumidor sem identificação).
> A interação entre "destinatário opcional na NFC-e" e "razão social obrigatória em homologação"
> **não foi confirmada em fonte oficial nesta sessão** e é candidata a rejeição na primeira
> tentativa. 🟥 **H-7** — validar no primeiro teste real e registrar o comportamento observado.

### 6.2 ⚠️ Defasagem de versão do ambiente de teste de SP

🟦 A página de SP declara (em **23/10/2025**) que o ambiente de teste *"está atualizado com as
implementações determinadas pela versão **1.30** da NT2025.002"*.

Mas a **NT 2025.002 já está na v1.50 (03/06/2026)** — conforme levantado no GOAL-014. Ou seja: o
ambiente de homologação de SP pode estar **até 4 versões atrás** do leiaute nacional publicado.

🟩 **Consequência prática:** o piloto deve validar contra o que **o ambiente de SP aceita**, não
contra a última NT publicada. Divergência aqui é **esperada**, não bug — e é exatamente o tipo de
atrito que o gatilho **T1** do GOAL-014 previu.

---

## 7. Q-08 · Contingência offline

🟦 **Fonte:** Portaria CAT 12/2015, **art. 10** ·
<https://legislacao.fazenda.sp.gov.br/Paginas/pcat122015.aspx> · consultado **2026-07-23**

**Duas modalidades admitidas:**

| Modalidade | Base | Descrição |
|---|---|---|
| **Formulário de segurança** | art. 10, II, "a" | DANFE-NFC-e impresso em formulário de segurança |
| **EPEC** | art. 10, II, "b" | Evento Prévio de Emissão em Contingência, via `RecepcaoEPEC` |

🟦 **Prazo de transmissão posterior:** *"até o prazo limite de cento e sessenta e oito horas contado
a partir de sua emissão"* (art. 10, § 1º, item 2) — **168 horas = 7 dias**.

🟩 **Responsabilidades do emitente:** o documento é emitido **antes** da autorização; a
responsabilidade pela transmissão dentro das 168h e pela guarda é integralmente do emitente
(coerente com a política de retenção do GOAL-013, `FISCAL_XML_RETENTION_POLICY_001.md`).

> ⚠️ **QR Code em contingência tem layout próprio** — a NT 2025.001 distingue "NFC-e ONLINE" de
> "NFC-e OFFLINE" na contagem de parâmetros. O detalhe exato depende da mesma lacuna **H-4**.

🟩 **Escopo decidido no checkpoint de 2026-07-23: contingência permanece FORA do GOAL-016.**
O primeiro adapter deverá operar:

| Regra | Valor |
|---|---|
| Modo | **somente online** |
| Ambiente | **somente homologação** |
| Falha | **explícita** — erro visível, nunca silencioso |
| Fallback automático para **EPEC** | ❌ proibido |
| Fallback automático para **formulário de segurança** | ❌ proibido |

Isso estende à *modalidade de emissão* o mesmo princípio que a ADR-0015 §2.6 já impõe à troca de
provider: **nenhum fallback automático**. Entrar em contingência é decisão humana, com gate próprio.

---

## 8. Q-09 · ST / CSOSN 500

✅ **Já fechado** no GOAL-006 (ADR-0012). Ver `FISCAL_TAX_ST_EVIDENCIAS_001.md` §3. Mantido aqui só
para continuidade da numeração — **não reaberto**.

---

## 9. Resíduo regulatório · "SEM GTIN"

> **Sem rótulo Q-xx** — resíduo expressamente pedido pelo GOAL, mas sem numeração de questão
> autorizada (ver §0.1).

🟦 O leiaute NF-e/NFC-e 4.00 exige o literal **`SEM GTIN`** nos campos `cEAN` e `cEANTrib` quando o
produto **não possui** GTIN válido.

**Estado no repositório (verificado em 2026-07-23):** a busca por `gtin` em `lib/fiscal/` **não
encontra nenhum tratamento** desse literal. O snapshot fiscal
(`FISCAL_SNAPSHOT_RUNTIME_INTEGRATION_005.md`) carrega um campo `gtin`, mas **sem regra de
fallback documentada**.

🟩 **Isto é uma lacuna real para o GOAL-016**, não uma pendência regulatória: um produto de
assistência técnica (peça avulsa, serviço, item `__avulso__` do PDV) frequentemente **não tem GTIN**,
e enviar vazio causa rejeição. Registrado como item de implementação, com a ressalva de que a
**regra exata de validação do `cEAN`** deve ser lida do MOC vigente antes de codificar (mesma
disciplina de H-4) — **não codificar o literal a partir deste parágrafo**.

---

## 10. Matriz mínima de `cStat` para o GOAL-016

> **Somente códigos verificados em fonte oficial nesta sessão.** A tabela completa vive no Anexo de
> códigos do MOC vigente; **não reproduzi de memória** os que não consegui confirmar.

| cStat | Significado | Categoria | Tratamento sugerido 🟩 |
|---|---|---|---|
| **100** | Autorizado o uso da NF-e | ✅ autorização | Desfecho **AUTORIZADA**; persistir protocolo + XML (GOAL-013) |
| **101** | Cancelamento de NF-e homologado | ✅ cancelamento | Evento aceito; propagar status |
| **102** | Inutilização de número homologado | ✅ inutilização | Fechar a lacuna de numeração |
| **103** | Lote recebido com sucesso | ⏳ lote | Guardar recibo; consultar em `NFeRetAutorizacao4` |
| **104** | Lote processado | ⏳ lote | Ler o `protNFe` de cada documento |
| **105** | Lote em processamento | ⏳ lote | **Reconsultar** com backoff — não retransmitir |
| **106** | Lote não localizado | ⚠️ lote | **Estado incerto** → consulta por chave (GOAL-012) |
| **108** | Serviço paralisado momentaneamente (curto prazo) | 🔌 indisponível | Retry com backoff; **jamais** duplicar documento |
| **109** | Serviço paralisado sem previsão | 🔌 indisponível | Parar de tentar; alerta humano; contingência é decisão à parte |
| **110** | Uso denegado | ⛔ denegação | **Terminal.** Não retransmitir, não cancelar; numeração consumida |
| **128** | Lote de evento processado | ⏳ evento | Ler o resultado do evento |
| **141** | Lote de evento processado (retorno) | ⏳ evento | Idem |
| **204** | Rejeição: duplicidade de NF-e | 🔁 duplicidade | **Não é erro** — a chave já foi autorizada. Consultar por chave e **convergir** (idempotência do GOAL-012/013) |
| **217** | NF-e não consta na base de dados da SEFAZ | 🔍 não localizado | Documento **não** foi autorizado → seguro retransmitir os **mesmos bytes** |
| **656** | Rejeição: consumo indevido pelo aplicativo da empresa | 🚫 consumo indevido | **Parar imediatamente.** Loop/excesso de consultas; CNPJ pode ser bloqueado por 1 hora |

🟩 **O par (204, 217) é o coração da reconciliação** e já está implementado no GOAL-012: `204` =
"já existe, converge"; `217` = "não existe, pode retransmitir". A matriz confirma que a lógica
construída está alinhada ao protocolo real.

🟩 **Sobre o 656** — fonte oficial: *"requisições enviadas em 'looping' e/ou com erros poderão ser
rejeitadas"*, e há limite de **20 consultas por hora** por chave/NSU, com **bloqueio do CNPJ por 1
hora** ao exceder. O worker do GOAL-011 (outbox) precisa de **rate limit próprio** — retry agressivo
é caminho direto para o 656.

> ⚠️ **Matriz declaradamente PARCIAL.** Faltam, entre outros, os códigos de rejeição por regra de
> validação de conteúdo (grupo 2xx–7xx), que são centenas. 🟥 **H-8** — extrair o anexo completo de
> `cStat` do MOC vigente antes do GOAL-016 tratar rejeições genéricas.

---

## 11. Conflitos e incertezas registrados (não ocultados)

| # | Conflito / incerteza | Situação |
|---|---|---|
| C-1 | Quantidade de CSC: "um" × "até 2 por empresa no estado" | Duas páginas do mesmo portal divergem — **H-3** |
| C-2 | URLs EPEC terminando em `.asm` × `.asmx` | Provável erro de digitação na página oficial — **H-6** |
| C-3 | Manual de QR Code: SP publica v4.1 (2016) × nacional v6.0 (2025) + QR Code v3 | **Nacional prevalece**; SP desatualizado — **H-4** |
| C-4 | Ambiente de teste SP em NT2025.002 **v1.30** × NT publicada em **v1.50** | Defasagem de até 4 versões; validar contra o que SP aceita |
| C-5 | Destinatário obrigatório em homologação × destinatário opcional na NFC-e | Não confirmado em fonte oficial — **H-7** |
| C-6 | Rótulos Q-03…Q-06, Q-10, G-C8 citados como existentes | **Não existiam**; criados agora, sem histórico retroativo (§0.1) |

---

## 12. 🟥 Insumos humanos pendentes

**Permanecem abertas** por decisão do checkpoint de 2026-07-23: **H-1, H-2, H-3 e H-5**.

> ⛔ **Estes dados não podem ser inventados nem inseridos em fixtures ou documentação pública.**
> Vale para CNPJ, IE, CRT, CSC, `idCSC`, certificado e qualquer credencial. Um valor ausente
> permanece ausente até declaração humana — nunca é preenchido por exemplo, placeholder plausível
> ou inferência.

| # | Pendência | Responsável | Bloqueia o GOAL-016? |
|---|---|---|---|
| **H-1** | **CNPJ** da loja-piloto — **sem publicar o número integral** em doc, log ou fixture | Rafael | Sim, para o preflight — não para o desenho do adapter |
| **H-2** | **CRT / regime tributário** do piloto | Rafael / contador | Sim, para o cálculo — o motor já suporta CSOSN 102/500 |
| **H-3** | **Credenciamento e CSC de homologação** — ver §12.1 | **Rafael (ação humana)** | **Sim** — sem credenciamento não há teste real |
| **H-5** | **Método atual de emissão da RafaCell** — §5.2 | Rafael (declaração direta) | Não bloqueia o fechamento documental; **precede** a avaliação de urgência e exposição |
| H-4 | **Manual de Padrões DANFE NFC-e/QR Code v6.0** (parâmetros exatos do QR v3) | leitura documental | Não bloqueia o adapter; **obrigatório antes do DANFCE/GOAL-021** |
| H-6 | Confirmar sufixo real das URLs EPEC (`.asm` × `.asmx`) | leitura documental | Não — contingência está fora do GOAL-016 |
| H-7 | Comportamento do destinatário em homologação para NFC-e | observação no 1º teste | Não |
| H-8 | Anexo completo de `cStat` do MOC vigente | leitura documental | Não — a matriz parcial cobre o caminho feliz e a reconciliação |

### 12.1 🟥 H-3 — o que Rafael deve providenciar humanamente

| Item | Detalhe |
|---|---|
| **Credenciamento** | **somente em homologação** (a SEFAZ-SP oferece a opção "Credenciar só em Homologação") |
| **CSC** | **exclusivo de homologação** — jamais o de produção |
| **`idCSC`** | o identificador correspondente ao CSC de homologação |
| **Quantidade de CSC** | confirmar no portal quantos são efetivamente permitidos (resolve o conflito **C-1**) |

> ⛔ **Este GOAL não executa nada disso.** Não faz credenciamento, não acessa o portal da SEFAZ, não
> cria CSC, não armazena token e não altera nenhuma configuração real. O registro acima é a
> descrição da ação humana — não a sua execução.

Quando o CSC de homologação existir, ele entra no cofre sob as regras da **ADR-0014** (envelope
encryption, DEK por segredo, bucket exclusivo, acesso server-only) — **nunca** em documento, log,
fixture ou variável versionada.

---

## 13. G-C8 — criado e declarado FECHÁVEL

> **Decisor:** Rafael Faria · **Data:** 2026-07-23 · **Instrumento:** checkpoint humano do GOAL-015.

### 13.1 Criação formal

**`G-C8 — Parâmetros oficiais da SEFAZ-SP para o piloto NFC-e`**

| Registro | Valor |
|---|---|
| Rótulo criado em | **este GOAL (GOAL-015)**, 2026-07-23 |
| Histórico retroativo | ⚠️ **nenhum.** O rótulo não existia antes; não houve período em que estivesse "aberto" e nenhum documento anterior o menciona |
| Estado | ✅ **FECHÁVEL**, com base neste dossiê oficial |

### 13.2 ⛔ O que o fechamento do G-C8 **NÃO** autoriza

Fechar o G-C8 significa **"parâmetros levantados com fonte oficial"** — e **nada além disso**:

| Não autoriza | |
|---|---|
| ❌ Transmissão | nenhuma chamada a Web Service, nem em homologação |
| ❌ Produção | `tpAmb=1` segue bloqueado pelo G-F12 |
| ❌ Credenciamento | é ação humana de Rafael (H-3) |
| ❌ Criação de CSC | idem |
| ❌ Ativação de `fiscalEnabled` | permanece default-off |

### 13.3 Pré-requisitos que permanecem

- 🟥 **H-3 permanece pré-requisito humano para execução real** — sem credenciamento e CSC de
  homologação não há teste, por mais completo que esteja o adapter.
- 🟥 **H-4 permanece obrigatório antes do DANFCE / GOAL-021** — os parâmetros exatos do QR Code v3
  não podem ser inferidos deste dossiê (§2.2).

### 13.4 Fundamento do "fechável"

**Por que fechável:**

- os **endpoints oficiais** de homologação estão levantados na fonte primária (§1);
- **CSC e QR Code** têm regra e origem normativa definidas, com as lacunas **declaradas** (§2);
- **cancelamento (30 min), inutilização (dia 10) e Carta de Correção (vedada)** estão resolvidos com
  citação verbatim da Portaria CAT 12/2015 (§3, §4);
- **contingência** está mapeada com prazo de 168h (§7);
- **Q-10 está conclusivamente respondida**: não há impedimento — NFC-e é obrigatória em SP (§5);
- há **matriz de `cStat`** suficiente para o caminho feliz e para a reconciliação (§10).

**Por que "fechável" e não "fechado sem ressalva"** — mesma disciplina do G-C4: o gate mede
*parâmetros levantados com fonte oficial*, e isso está feito. Mas **H-3 (credenciamento) permanece
aberto e é pré-requisito de execução**, e **H-4 (QR Code v3)** precisa ser fechado antes do GOAL de
DANFCE. Fechar o G-C8 **não** significa que o piloto pode transmitir.

---

## 14. Referências

**SEFAZ-SP** (todas consultadas em 2026-07-23)
- WebServices NFC-e: <https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/WebServices.aspx>
- Sobre a NFC-e (credenciamento, CSC, obrigatoriedade): <https://portal.fazenda.sp.gov.br/servicos/nfce>
- Cancelamento extemporâneo (SIPET): <https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/Guia-Cancel-Extemp-NFCe.aspx>
- Credenciamento (opção "só homologação"): <https://www.fazenda.sp.gov.br/nfe/credenciamento.asp>
- **Portaria CAT 12/2015** (norma-mãe da NFC-e em SP): <https://legislacao.fazenda.sp.gov.br/Paginas/pcat122015.aspx>
- **RC 32089/2025** (vedação do CF-e-SAT): <https://legislacao.fazenda.sp.gov.br/Paginas/RC32089_2025.aspx>

**Portal NF-e nacional** (consultadas em 2026-07-23)
- NT 2025.001 (QR Code v3): <https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=trSXReoZPuY%3D>
- NT 2025.002 (RTC/IBS-CBS): <https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=04BIflQt1aY%3D>
- Manual de Padrões DANFE NFC-e v6.0 (mar/2025) — **não lido nesta sessão (H-4)**: <https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=k/IuuaW4YiY%3D>

**Internas**
- [`ADR-0015`](../decisions/ADR-0015-sefaz-direta-homologacao-inicial.md) · [`ADR-0016`](../decisions/ADR-0016-piloto-homologacao-sp-matriz-rafacell.md) · [`ADR-0014`](../decisions/ADR-0014-supabase-vault-backend-kms-fiscal.md) · [`ADR-0018`](../decisions/ADR-0018-persistencia-legal-xml-e-protocolo.md)
- [`FISCAL_PROVIDER_DOSSIE_001.md`](./FISCAL_PROVIDER_DOSSIE_001.md) (GOAL-014) · [`FISCAL_XML_RETENTION_POLICY_001.md`](./FISCAL_XML_RETENTION_POLICY_001.md) (GOAL-013) · [`FISCAL_TAX_ST_EVIDENCIAS_001.md`](./FISCAL_TAX_ST_EVIDENCIAS_001.md) (Q-09)
- [`MASTER_FISCAL_EXECUTION_PLAN.md`](../governance/MASTER_FISCAL_EXECUTION_PLAN.md)
