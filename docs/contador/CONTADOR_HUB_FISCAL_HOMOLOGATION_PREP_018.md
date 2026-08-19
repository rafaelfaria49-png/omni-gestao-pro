# CONTADOR-018 — Preparação de homologação fiscal isolada

| Campo | Valor |
|---|---|
| Status | Preparação **documental** — GOAL 018 **não aberto** |
| Data | 2026-08-19 |
| ADR | ADR-CONTADOR-007 **Accepted** (mesmo dia) |
| Auditoria Passo 0 | [`CONTADOR_HUB_FISCAL_PASSO0_AUDIT_018.md`](./CONTADOR_HUB_FISCAL_PASSO0_AUDIT_018.md) · PR #88 merge `fac38130` |
| `origin/main` na preparação | inclui PR #87 (PIX legado fail-closed) **depois** da base auditada `edbf724b`; **não** invalida o Passo 0 (status/XML/reader/flag) |

Este documento **prepara** o ambiente de prova para um futuro GOAL 018. Não implementa reader, flag, pacote `05-XML`, UI nem AEP import/open.

---

## 1. Isolamento (inegociável)

| Proibido nesta preparação | Motivo |
|---|---|
| Production / `AmbienteFiscal.PRODUCAO` / `tpAmb=1` | DECISION_5; notas de teste não saem de homologação |
| Ligar `ConfiguracaoFiscalLoja.fiscalEnabled` para “destravar o Contador” | Kill-switch de **emissão**; DECISION_4 |
| Chamar `fiscalXmlReader.readAuthorizedDocument` no Contador | DECISION_6 — grava `FiscalLog` |
| Reconstruir XML com `nfce-xml-builder` / signer | ADR-0018; empacotar só `xmlAutorizado` persistido |
| Fallback de data (`dataAutorizacao`, `createdAt`, snapshot) | DECISION_3 — só `dhEmi` |
| Abrir/implementar GOAL 018 | Autorização humana ainda **negada** |
| Usar loja de produção como fixture | Mesmo que `fiscalEnabled=false` |

Isolado = provas em **teste/fixture** e, se no futuro existir loja-piloto, somente `HOMOLOGACAO`. Sem socket SEFAZ de produção.

---

## 2. O que a homologação precisa representar

Quando o 018 for autorizado, a bateria mínima (auditoria §8/§13 + DECISION_5):

| Caso | Persistência mínima | Entra em `05-XML`? | Checklist |
|---|---|---|---|
| Autorizado entregável | `status=AUTORIZADA`, `vigente=true`, protocolo, `chaveAcesso`, `xmlAutorizado` com `ide/dhEmi` válido no período | **sim** (predicado A) | conta como entregável |
| Autorizado sem `dhEmi` (ou `dhEmi` ilegível) | igual, XML sem `dhEmi` | **não** (fail-closed DECISION_3) | honesto: não entregável |
| Autorizado fora da competência | `dhEmi` em outro mês SP | **não** na competência sob teste | não inflar zero |
| Rejeitado (incl. cStat 110 persistido como `REJEITADA`) | `status=REJEITADA`, sem `xmlAutorizado` | **não** | `atencao` quando flag on |
| Cancelado | se existir `CANCELADA` + XML histórico | **não** (política A) | pode listar |
| Outra loja | mesma nota, `storeId` distinto | **não** | zero vazamento |
| Flag off / reader down | — | placeholder `05-XML/LEIA-ME.md` | `nao_disponivel` |

Cancelamento **ainda não tem writer de produção**. A homologação isolada **não** fabrica `EventoFiscal` em banco real. O caso “cancelado” no 018 será teste com linha sintético/`status=CANCELADA` — não emissão SEFAZ.

---

## 3. `dhEmi` — contrato da competência (DECISION_3)

Fonte **única:** texto de `NotaFiscal.xmlAutorizado`.

Caminho XML (NFC-e): `NFe` ou `nfeProc/NFe` → `infNFe` → `ide` → `dhEmi`.

Formato esperado (builder fiscal): `YYYY-MM-DDThh:mm:ss-03:00` (Brasília), ver `formatDhEmi` em `lib/fiscal/xml/nfce-chave-acesso.ts`. Aceitar offset explícito do elemento; **não** completar com `-03:00` se o elemento vier sem offset.

Pertence à competência `C` se e somente se o instante de `dhEmi` está em `resolvePeriodoUtc(C)` (`America/Sao_Paulo`, intervalo UTC semiaberto).

```
competencia_ok(xmlAutorizado, C) =
  dhEmi = texto de infNFe/ide/dhEmi
  AND dhEmi parseável como instante
  AND PeriodoUtc(C).inicio <= dhEmi < PeriodoUtc(C).fimExclusivo
```

Ausente, duplicado, vazio, não-parseável ⇒ **não entregável**. Sem fallback.

O parser DANFC-e (`parse-persisted.ts` lê `firstText(ide, "dhEmi")`) é **referência de caminho**, não porta do Contador: o 018 deve extrair `dhEmi` num helper **puro** (sem `FiscalLog`, sem Prisma). Não copiar `loadDanfceForReprint`.

---

## 4. Fixtures já existentes (reuso futuro, sem código agora)

Não duplicar XML nesta preparação. Pontos de partida **quando** o 018 existir:

| Artefato | Uso previsto |
|---|---|
| `lib/fiscal/danfce/__fixtures__/persisted-nfce.ts` | XML NFC-e 4.00 de teste com `dhEmi`; kinds `autorizado_simples`, `homologacao`, `contingencia_*` |
| `lib/fiscal/xsd/__fixtures__/nfce-xsd-fixtures.ts` | `dhEmi` literal `2026-07-14T12:00:00-03:00` |
| `lib/fiscal/storage/xml-protocol-storage.test.ts` | fakes Prisma `AUTORIZADA` + XML coluna; **cross-store** |
| Stub/mock providers | `REJEITADA` / `CANCELADA` simulados — só status, não XML SEFAZ real |

Massa mínima a montar no 018 (injeção, sem banco de produção):

1. Loja A, competência `2026-07`, `xmlAutorizado` com `dhEmi` em julho/2026 SP → entra.
2. Mesma nota, `dhEmi` em junho/2026 → não entra na competência julho.
3. XML sem `<dhEmi>` → não entra.
4. Loja B com a mesma chave → reader da loja A não vê.
5. `REJEITADA` → fora de `05-XML`.
6. `CANCELADA` com `xmlAutorizado` preenchido → fora de `05-XML` (política A).

`FISCAL_RUNTIME_VALIDATABLE` permanece `false` até existir loja-piloto `HOMOLOGACAO` com pelo menos um `xmlAutorizado` persistido **sem** Production. Esta preparação **não** cria essa loja nem liga emissão.

---

## 5. Flag e loja-piloto (ainda não ligar)

Contrato aprovado (DECISION_4/5), **não provisionado**:

```
CONTADOR_FISCAL_READER=off          # default; só "on" liga
# allowlist futura de storeId (sem schema) — só HOMOLOGACAO nesta fase
```

Não editar `.env` / `.env.example` nesta preparação (isso é GOAL 018).

---

## 6. Limites do pacote a respeitar na homologação futura

Herdados de `lib/contador/pacote/seguranca.ts`:

- `MAX_ARQUIVOS_PACOTE = 15` hoje — XML reais vão estourar; o 018 deve tratar teto **antes** de homologar massa.
- 25 MiB descompactado / 10 MiB ZIP → 413 honesto, nunca truncar.

Homologação isolada de predicado/flag/cross-store **cabe** em poucas notas. Homologação de volume **não** faz parte desta preparação.

---

## 7. Critério de “preparado” (esta entrega)

| Item | Estado |
|---|---|
| Decisões 1–6 registradas na ADR-007 | sim (Accepted 2026-08-19) |
| Predicado e `dhEmi` sem fallback escritos | sim |
| Política de cancelado A escrita | sim |
| Matriz de casos de prova listada | sim |
| Fixtures de código apontadas | sim (reuso futuro) |
| Loja viva HOMOLOGACAO com XML persistido | **não** — bloqueio residual do 018 |
| GOAL 018 aberto / implementado | **não** |

```
HOMOLOGATION_PREP_COMPLETE=true
FISCAL_RUNTIME_VALIDATABLE=false
GOAL_018_OPENED=false
```
