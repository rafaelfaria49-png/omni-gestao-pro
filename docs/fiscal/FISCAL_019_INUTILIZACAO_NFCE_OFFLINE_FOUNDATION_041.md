# FISCAL-019 — Inutilização NFC-e OFFLINE foundation

**GOAL:** `FISCAL-019-INUTILIZACAO-NFCE-OFFLINE-FOUNDATION-041`
**Classificação:** A
**Data:** 2026-08-16
**Base:** `origin/main` @ `b5e655aa8c24476107801f33746df05e26586591`
**Branch:** `cursor/fiscal-019-inutilizacao-nfce-offline-foundation-493f`

Fundação offline do GOAL 019. Não mergear antes do fechamento do trilho H-9/H-10 ativo.

---

## 1. origin/main usada

`b5e655aa8c24476107801f33746df05e26586591` — sincronizado com `origin/main` no início. PRs #61 e #62 **não** foram usadas como base.

## 2. branch / worktree

`cursor/fiscal-019-inutilizacao-nfce-offline-foundation-493f` criada a partir de `origin/main`. Worktree única.

## 3. Fontes / XSD oficiais

| Pacote | SHA-256 | Bytes | Origem |
|---|---|---|---|
| `PL_010d_v1.03.zip` | `45ceefe4dfbbfec93958283b650a2f1e1734784f4770d070b9907754de081d9b` | 67813 | Portal Nacional NF-e · `exibirArquivo.aspx?conteudo=%20pBOYTXBtbk=` · 10/07/2026 |
| `PL_009j_NT2022_003_v100b.zip` | `91081b656d64fe365ef3e33030821cc7231f8a5d56104ad73110cd98f16054fe` | 51432 | Portal Nacional NF-e · `exibirArquivo.aspx?conteudo=P3TfrfqQ38U=` · 05/01/2023 |
| MOC 7.0 PDF | `f664dcf94b77cabb32311620d85a7eb02cdf86adb2d4632ce178af2572dd2ad1` | 4304647 | Portal Nacional · manuais |
| Anexo I PDF | `5eb4cf2010b10b0b62f78197c4eb64025f24535d4c6e61158bc7806dd008f55d` | 4106196 | Portal Nacional · manuais |

Processo: `FISCAL_XSD_REGULATORY_UPDATE_PROCESS_001.md`. Zero Web Service SEFAZ.

`PL_010e_v1.02` (já no repo) **não** contém inutilização — só documento NFC-e. Permanece intacto (`npm run fiscal:xsd:verify-hashes` OK).

## 4. Grafo utilizado

**Pacote em uso:** `PL_010d_v1.03` (leiaute + tipos).
**Wrappers:** `inutNFe_v4.00.xsd` / `retInutNFe_v4.00.xsd` de `PL_009j` (include + element; leiaute vem de 010d).

Grafo fechado:

```
inutNFe_v4.00.xsd
  └ include leiauteInutNFe_v4.00.xsd
      ├ include tiposBasico_v4.00.xsd
      └ import xmldsig-core-schema_v1.01.xsd
retInutNFe_v4.00.xsd → mesmo leiaute
procInutNFe_v4.00.xsd → mesmo leiaute
```

`tiposBasico_v4.00.xsd` de 010d é **byte-idêntico** ao de `PL_010e_v1.02` (`772619c85723e598840667ca66e7298a250442df47eeb94b397d2a333ce62047`).

Manifest SHA-256: `d067b57958049c942c092c7d781c8f1f387337c6cae6a1c03c2949e1ed1b0026`.

## 5. Contrato de inutilização

Pedido: `TInutNFe` / `infInut` (`versao="4.00"`).

Campos: `tpAmb`, `xServ=INUTILIZAR`, `cUF`, `ano` (2 dígitos), `CNPJ` (`TCnpj`), `mod` (55\|65 — **este GOAL restringe a 65**), `serie` (`TSerie`), `nNFIni`/`nNFFin` (`TNF`), `xJust` (`TJust`, 15–255).

Id: `ID[0-9]{4}[0-9A-Z]{12}[0-9]{25}` = `ID` + cUF(2) + ano(2) + CNPJ(14) + mod(2) + série(3) + nIni(9) + nFin(9).

Sucesso: `cStat=102`. Processo **síncrono**. Sem 103/104/105 neste contrato.

Faixa máxima: 10.000 (MOC I04). `nIni > nFin` → rejeição 224.

## 6. Identificadores modernos

Derivado **somente** do grafo de inutilização (não do evento 110111):

- CNPJ: `TCnpj` = `[0-9A-Z]{12}[0-9]{2}` (NT 2025.001 / NT 2026.004 no pacote 010d). Sem DV clássico automático.
- Id: padrão 010d (não o `ID[0-9]{41}` de 009j).
- `nProt`: `TProt` = `[0-9]{15}|[0-9]{17}` — **o mesmo** `tiposBasico` do pedido. Grafo fecha. Sem classificação B.

## 7. Arquivos criados / alterados

**Criados**

- `lib/fiscal/inutilizacao/**` (contrato, validação, Id, XML, boundary de assinatura, parser, classificador, testes, fixtures)
- `lib/fiscal/xsd/inutilizacao/**` (manifesto, ZIPs oficiais, PDFs MOC/Anexo I)
- `lib/fiscal/xsd/schemas/PL_010d_v1.03/NFe/**` (grafo XSD fechado)
- `scripts/fiscal/verify-inutilizacao-xsd.mjs`
- `docs/fiscal/FISCAL_019_INUTILIZACAO_NFCE_OFFLINE_FOUNDATION_041.md`

**Alterados**

- `lib/fiscal/signing/xmldsig-builder.ts` — `insertSignatureAsLastChild`; `insertSignatureIntoNFe` continua exigindo raiz `NFe`
- `package.json` — script `fiscal:xsd:verify-inutilizacao`

**Não alterados:** `prisma/schema.prisma`, migrations, auth, proxy, PDV, Financeiro, H-9/H-10, `docs/ai/CURRENT_STATUS.md`.

## 8. Comportamento implementado

1. Input tipado (`InutilizacaoPedidoInput`).
2–5. Validação schema + intervalo + série/modelo/ano/UF/CNPJ + justificativa.
6–7. XML determinístico + Id oficial (reusa `serializeXmlEmbeddable`).
8. Boundary `signInutilizacaoXml` (C14N/XMLDSig existente; enveloped no `inutNFe`).
9–10. Parser SOAP 1.2 `nfeResultMsg` / `retInutNFe` + classificador fail-closed. SOAP 1.1 → malformed.

Não há HTTP operacional, Server Action, UI, worker, SOAP de rede, Prisma, retry.

## 9. Matriz de retorno

| Classe | cStat / condição | retryAutomatico |
|---|---|---|
| SUCCESS | 102 + `nProt` TProt | sempre `false` |
| REJECTED | 201, 203, 224, 240, 241, 250, 252, 256, 266, 453, 454, 502, 563 | sempre `false` |
| MALFORMED | XML/SOAP inválido, raiz errada, SOAP 1.1 | sempre `false` |
| UNKNOWN | cStat ausente/não catalogado (incl. 103/104/105); 102 sem nProt | sempre `false` |

UNKNOWN **nunca** autoriza retry automático. Nenhuma política de retransmissão neste GOAL.

## 10. Validação XSD

`npm run fiscal:xsd:verify-inutilizacao` — hashes + grafo + PDFs oficiais.
Testes: `xmllint --nonet` no pedido assinado e no retorno sintético 102.

## 11. Testes

`npm test -- lib/fiscal/inutilizacao` — **25 passed**.
`npm test -- lib/fiscal/signing` — **46 passed** (16 skipped, pré-existentes).
`npm test -- lib/fiscal/xml` — **63 passed**.
`npm run typecheck` — **passou** (heap 4 GB).
`npx eslint --max-warnings=0` nos `.ts` do GOAL — **passou**.
`git diff --check` — limpo em código autoral (`.ts`/`.mjs`/`package.json`/relatório). Os XSD oficiais de `PL_010d` conservam CRLF de origem; normalizar quebraria os hashes.

Cobertura: intervalo, limites 10.000, série, modelo, ano/UF, CNPJ numérico/alfa, justificativa, escaping, XML determinístico, Id, XSD, sucesso, rejeição, malformed, SOAP 1.1/1.2, UNKNOWN, 103/104/105 não intermediários, prova `retryAutomatico === false`.

## 12. Mutation probe

Regra crítica: `nIni > nFin` em `validation.ts`.

1. Removida a checagem `nIni > nFin`.
2. `npm test -- lib/fiscal/inutilizacao` **falhou**: `1 failed | 24 passed` no caso «rejeita início maior que fim».
3. Checagem restaurada **antes do commit**; testes voltaram a 25/25.
4. Probe **não** permanece no commit.

## 13. Revisão independente

Modelo/família distinta (GPT-5.6). Veredito: **A-compatible**. 9/9 critérios PASS. Sem ambiguidade regulatória material. Sem blockers.

## 14–15. Commit / PR Draft

Um commit. PR Draft contra `main`. Não Ready. Não mergear.

## 16. PRs #61 / #62

Intactas — esta branch parte de `main`, não daquelas PRs.

## 17. H-9 / H-10

`git diff origin/main -- lib/fiscal/provider/sefaz/wsdl app/api/fiscal/wsdl` → **vazio**. Janela Production-only intocada. H-9/H-10 **não** executado.

## 18. Zero rede SEFAZ

Somente Portal Nacional (download XSD/MOC). Runtime: `--nonet`. Sem SOAP operacional.

## 19. Classificação

**A** — contrato oficial suficiente; XML valida contra XSD; parser/classificador cobertos; UNKNOWN fail-closed; testes e mutation probe; zero SEFAZ; H-9/H-10 intocado.
