# FISCAL-017 — Aquisição autenticada de WSDL (H-9 / H-10)

**Data:** 2026-08-12 · **Base:** `origin/main` = `8166162` · **Estado:** capacidade preparada,
testada e revisada. **Nenhuma chamada externa foi feita neste GOAL.**

**H-9** (`SOAPAction` exata por serviço) e **H-10** (WSDL oficial dos 6 serviços NFC-e 4.00 de SP)
permanecem **ABERTAS**. Este documento descreve a ferramenta que poderá fechá-las e o
procedimento do gate humano que o próximo GOAL deve seguir.

> **ATUALIZAÇÃO (2026-08-29 · GOAL 020):** o gate segue DORMENTE (`null/null/null`) — a janela
> de 24/08 é evidência histórica apenas. A loja-piloto não é mais o literal `"loja-1"`: é
> resolvida dinamicamente de `ConfiguracaoFiscalLoja` (HOMOLOGACAO + NFCE + SEFAZ_DIRETO +
> certificado ativo, exatamente uma candidata; zero ou múltiplas bloqueiam). O preflight exige
> `fiscalEnabled=true` da piloto resolvida. O one-shot global é garantido por advisory lock +
> verificação cross-store dentro da transação de consumo (sem schema novo). Detalhe no doc do
> gate 019.

---

## 1. Por que uma ferramenta, e não um `curl`

As tentativas anteriores de ler o WSDL sem certificado retornaram **HTTP 403** — o endpoint exige
mTLS. Qualquer caminho manual para reproduzir isso implica manusear o `.pfx` e a senha do A1 fora
da custódia, que é exatamente o que `ADR-0020` e `FISCAL_SECURITY §4` proíbem.

A ferramenta reusa a resolução de A1 **por referências opacas** já existente
(`loadA1MtlsMaterial` sobre `blobRef`/`senhaRef`). Nenhuma nova forma de armazenar PFX ou senha
foi criada.

---

## 2. Arquitetura

Quatro módulos em `lib/fiscal/provider/sefaz/wsdl/`, deliberadamente **fora** do `index.ts` do
adapter — não há ponto de import agregado que os torne alcançáveis por acidente.

| Módulo | Papel | Rede? | Segredo? |
|---|---|---|---|
| `wsdl-acquisition-target.ts` | projeta a allow-list `<endpoint>?wsdl` a partir do catálogo | não | não |
| `wsdl-execution-authority.ts` | token opaco one-shot que autoriza (ou não) UMA tentativa | não | não |
| `wsdl-acquisition.ts` | o `GET` mTLS propriamente dito | sim, **só com autoridade** | refs opacas |
| `wsdl-extraction.ts` | extração estrutural offline do contrato SOAP | não | não |

### 2.1 Os seis endpoints canônicos

⛔ **Este documento não lista URLs.** Os alvos são a **projeção** de
`SEFAZ_ENDPOINT_CATALOG` (`lib/fiscal/provider/sefaz/sefaz-endpoint-catalog.ts`) — as entradas
`HOMOLOGACAO`/`SP` com `permitido: true`, exatamente seis, acrescidas do literal `?wsdl`.

Não existe segunda fonte de verdade. Se o catálogo mudar, os alvos mudam junto; se alguém
adicionar uma UF ou um host, o teste de projeção quebra.

### 2.2 Autoridade de execução — e por que ela ainda não existe para a rede real

A aquisição é **inerte por construção**. Sem uma autoridade íntegra ela recusa antes de resolver
o A1, antes do contexto TLS e antes do socket.

**A única fábrica de autoridade exportada hoje exige `NODE_ENV === "test"` e devolve um runtime
cravado em `127.0.0.1`.** Consequência intencional: **em produção não existe caminho para
autorizar um GET externo** — nem por env, nem por flag, nem por wiring acidental. Habilitar a
execução real exige alterar código, sob o gate humano do próximo GOAL.

Isso é uma decisão, não uma omissão. Uma flag de ambiente seria a escolha errada: a contenção
[`FISCAL_016D_C_CONTAINMENT_016`](./FISCAL_016D_C_CONTAINMENT_016.md) provou que `vercel env rm`
fecha apenas o alias — cada deployment antigo carrega o snapshot da env e permanece com a
capacidade ligada. Foram **4** snapshots ON em **3** janelas. Uma capacidade que só existe se o
código for alterado não deixa esse resíduo.

A autoridade é **presa à tupla do alvo**: emitida para `NFeStatusServico4`, ela não autoriza
`NFeAutorizacao4`. É isso que torna mecânica a regra "no máximo um GET por endpoint canônico".

### 2.3 Limites fail-closed do `GET`

| Limite | Valor | Onde |
|---|---|---|
| ambiente | só `HOMOLOGACAO` — barreira é a **primeira instrução** | `acquire()` |
| destino | tupla fechada; URL/host/path/porta **não são parâmetros** | `selectSefazWsdlTarget` |
| método | `GET` fixo; **não existe parâmetro de corpo** | `SEFAZ_WSDL_METHOD` |
| TLS | `minVersion` TLSv1.2, `rejectUnauthorized: true`, certificado cliente A1 | `acquire()` |
| redirect | `0` — 3xx é recusa terminal | `wsdl_redirect_recusado` |
| timeout conexão | ≤ 10 s | `WSDL_MAX_CONNECTION_TIMEOUT_MS` |
| deadline total | ≤ 20 s | `WSDL_MAX_TOTAL_DEADLINE_MS` |
| corpo | ≤ 256 KiB, cortado **durante o streaming** | `WSDL_MAX_RESPONSE_BYTES` |
| retry | **nenhum** — autoridade one-shot | `consumeWsdlExecutionAuthority` |
| `Content-Type` | **evidência** sanitizada; nunca decide aceitação | `contentTypeEvidencia` |
| log | o módulo não escreve em disco, banco ou log | — |

O chamador não amplia teto algum: `boundWsdlDeadlines` satura em vez de aceitar.

### 2.4 Extração — estrutural, nunca heurística

A cadeia exigida é `service → port(soap12:address) → binding → operation → message → part`,
com **unicidade em cada passo**:

1. `targetNamespace` precisa ser **exatamente** `sefazServiceNamespace(servico)` — valor já
   versionado no catálogo, não inferido do documento;
2. exatamente um `wsdl:service`, exatamente um port com `soap12:address`;
3. `soap12:address/@location` conferido contra host e path canônicos do alvo;
4. binding SOAP 1.2 (`.../wsdl/soap12/`) sobre `soap/http`, style `document`;
5. exatamente uma `wsdl:operation` no binding;
6. **`soapAction` lida VERBATIM** de `soap12:operation/@soapAction`;
7. `portType` → `message` → única `part` com `@element` ⇒ wrapper e namespace.

⛔ **Nada é inferido pelo nome.** A convenção `<targetNamespace>/<operação>` é plausível o
bastante para passar despercebida e errada o bastante para produzir `SOAPAction` inválida na
SEFAZ. Um valor inventado que "parece certo" é pior que a pendência declarada: fecha H-9 no papel
e falha em produção.

**Qualquer** ambiguidade (dois services, dois ports SOAP 1.2, bindings homônimos, duas operações)
é recusa — não existe "o primeiro vence" nem "o que casa com o nome do serviço vence".

### 2.5 Quando H-9/H-10 **não** fecham

WSDL ausente, mal-formado, com DTD, acima do limite, apenas SOAP 1.1, com `targetNamespace`
divergente, com endereço em outro host, ambíguo em qualquer passo, ou **sem `soapAction`
publicada** ⇒ `ok: false`, `fechaH9: false`, `fechaH10: false`. As pendências continuam abertas e
o roadmap não muda.

---

## 3. Fixtures são sintéticas — e não são a resposta de H-9

`__fixtures__/wsdl-fixtures.ts` gera WSDLs **inventados**. A `soapAction` das fixtures carrega o
marcador `SYNTHETIC-NAO-OFICIAL` justamente para que nenhum valor delas seja confundido com o
oficial nem copiado para produção.

As fixtures provam o **caminho** (a cadeia fecha, e cada ruptura dela recusa), nunca o
**conteúdo**. O teste positivo verifica explicitamente que a ação extraída contém o marcador —
se o extrator passasse a derivar a ação por convenção, o marcador sumiria e o teste quebraria.

---

## 4. Procedimento do gate humano (próximo GOAL)

Nada abaixo foi executado.

1. **G-H1 · origem autorizada.** Declarar de qual infraestrutura o GET sairá.
2. **Habilitar a execução real.** Adicionar a fábrica de autoridade não-loopback, sob revisão,
   com escopo por endpoint. Não usar env/flag de plataforma (§2.2).
3. **Teto explícito.** No máximo **um** GET por endpoint canônico, seis no total, em janela
   declarada. Cada endpoint exige emissão de autoridade própria.
4. **Executar** com as refs opacas do A1 já provado em Production (`8166162`).
5. **Extrair offline** com `extractSefazWsdlContract`, um serviço por vez.
6. **Registrar evidência sanitizada**: `sha256`, `byteLength`, `httpStatus`,
   `contentTypeEvidencia`, `soapAction`, `operationName`, `bindingName`, wrapper e namespace.
   ⛔ Nunca o `.pfx`, a senha, nem o corpo bruto em log.
7. **Reverter a habilitação** imediatamente após a janela e reconferir que nenhum deployment
   ficou com a capacidade — sonda por deployment, como em `CONTAINMENT_016`, não apenas o alias.
8. Só então marcar H-9/H-10 como fechadas em `ROADMAP_FISCAL.md` (BL-FISCAL-5) e no plano 016D.

### 4.1 Observação técnica sobre SOAP 1.2

Em SOAP 1.2 a ação viaja como parâmetro `action=` do `Content-Type`, não no header `SOAPAction`
do SOAP 1.1. O extrator captura o **valor** publicado no WSDL; **como** transportá-lo é decisão
do slice que fizer a chamada SOAP real (016D-C/016D-D) e está fora deste GOAL.

---

## 5. O que esta ferramenta é incapaz de fazer

Verificado por teste, não por convenção:

- executar `statusServico` — não há `POST`, envelope SOAP nem `Content-Type` SOAP;
- transmitir XML fiscal — não existe parâmetro de corpo; o servidor de teste observa corpo vazio;
- alcançar produção, outra UF ou o host NF-e — não há entrada de catálogo nem parâmetro de
  destino; campos de destino injetados no request são ignorados e o SNI efetivo continua sendo o
  host canônico de homologação;
- abrir socket sem autoridade — sem autoridade íntegra e no escopo, recusa antes do A1;
- repetir a tentativa — autoridade one-shot, sem retry;
- vazar A1 — `scanForSecrets` sobre sucesso e sobre cinco caminhos de falha.

`REGISTRY` produtivo, `provider-factory`, `resolver` e `index.ts` do adapter permanecem
**inalterados**. `SEFAZ_DIRETO` continua fora do `REGISTRY` (ADR-0020 §2.2).
