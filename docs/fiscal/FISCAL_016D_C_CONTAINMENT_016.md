# FISCAL-016D-C-CONTAINMENT-016 — Contenção da capability residual da flag A1 self-test

**Data:** 2026-08-12 · **Escopo:** exclusivamente Vercel (deployments). Zero mudança de código,
banco, migrations, domínio ou configuração fiscal. Zero contato com SEFAZ.

Projeto canônico: `omni-gestao-pro` (`prj_wjkHKw2jFQfY8regMYtkYXwgavuz`,
team `team_IInBSQbKO8P5XpAsvz16Kc3g`).

---

## 1. Por que a flag sobrevive à remoção da env

`vercel env rm FISCAL_A1_OFFLINE_SELFTEST_ENABLED production` + redeploy fecha **apenas o alias**.
Cada deployment carrega o snapshot de env do momento do build; as URLs diretas
(`https://omni-gestao-<hash>-rafaelfaria49-4373s-projects.vercel.app`) seguem `Ready` e
publicamente alcançáveis com a flag **ON** embutida.

### Sonda usada (não destrutiva, sem execução criptográfica)

`app/api/fiscal/certificado/selftest/route.ts` testa a flag na **primeira instrução**, antes de
ACL, Prisma, vault e TLS:

- flag ausente/≠`true` → `404 {"codigo":"selftest_indisponivel"}`
- flag `true` → segue para ACL → sem sessão: `401 {"codigo":"acesso_negado"}`

Logo um `POST` **não autenticado e sem corpo** distingue ON de OFF sem tocar em material A1.
Nenhuma chamada autenticada foi feita neste GOAL. Nenhuma prova A1 foi repetida.

---

## 2. FASE 1 — Inventário read-only (todos os deployments que contêm a rota)

Deployments anteriores a 2026-08-11 14:00 respondem `405` (rota inexistente no build) e portanto
não têm a capability — o inventário abaixo cobre a janela completa de existência da rota.

| # | Criado (-03) | Deployment ID | Hash da URL | Target | Status | Commit | Sonda | Flag |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-08-11 14:00:19 | `dpl_FVokRi3YNBRYa6Dy3bhwweYzTNcD` | `esyj5ypqj` | preview | Ready | branch PR #50 | 404 `selftest_indisponivel` | OFF |
| 2 | 2026-08-11 15:55:14 | `dpl_9gztWCUVLovV5UMizNBnMeSznw7E` | `a1880jwdy` | production | Ready | (não coletado — OFF) | 404 `selftest_indisponivel` | OFF |
| 3 | 2026-08-11 16:15:07 | `dpl_Du6nivj5wZg69T73qv69jz7yMQ62` | `ej3q10x43` | production | Ready | `19dc401` (main) | **401 `acesso_negado`** | **ON** |
| 4 | 2026-08-11 16:20:14 | `dpl_9LDFnUTfVwNkQeT4YoZQZJ82kZ4S` | `64wubxjel` | production | Ready | `19dc401` (main) | 404 `selftest_indisponivel` | OFF |
| 5 | 2026-08-11 18:38:04 | `dpl_GJrtgvAVhxcZw3TXFr55Kubfzj4H` | `ix8fdp0k6` | production | Ready | `19dc401` (main) | **401 `acesso_negado`** | **ON** |
| 6 | 2026-08-11 19:20:16 | `dpl_7k7RmuepvNq6yHSkbnQDh4PJCL4F` | `lmy2j8eu6` | production | Ready | `19dc401` (main) | 404 `selftest_indisponivel` | OFF |
| 7 | 2026-08-11 23:47:58 | `dpl_4H2wVPBuWyskoURg64FBTt7oStiv` | `6q9q12wcb` | preview | Ready | branch PR #51 | 404 `selftest_indisponivel` | OFF |
| 8 | 2026-08-11 23:57:54 | `dpl_7qM4imzjiptx58SKwJygrxm78qhs` | `ji4pbjlw5` | production | **Error** | main | página de plataforma `Deployment has failed` | INERTE |
| 9 | 2026-08-12 07:19:30 | `dpl_ErYxAtAgoCg4YfdyDFUZUxcCVZRD` | `49c6aenyi` | production | Ready | `8a50546` (main) | **401 `acesso_negado`** | **ON** ← prova A1 |
| 10 | 2026-08-12 10:04:20 | `dpl_Eaj3hhaFoUKn83gbJRBPrQwPC4ET` | `5gwtmvwde` | production | Ready | `ee3b26f` (main) | **401 `acesso_negado`** | **ON** |
| 11 | 2026-08-12 10:07:43 | `dpl_HKjFynvJNoyNDvbfZ9TEfPFwTfFq` | `luuh8ivfl` | production | Ready | `8a50546` (main) | 404 `selftest_indisponivel` | OFF ← **serve o alias** |

### Correção material ao closeout 015

O closeout anterior registrou **2** snapshots ON e uma única janela (07:19 → 10:07 de 12/08).
A sonda comportamental mostra **4** snapshots ON e **três** janelas distintas:

| Janela | Abertura (ON) | Fechamento (OFF) | Commit | Interpretação |
|---|---|---|---|---|
| A | `ej3q10x43` 11/08 16:15 | `64wubxjel` 11/08 16:20 | `19dc401` | tentativa anterior de prova (~5 min) |
| B | `ix8fdp0k6` 11/08 18:38 | `lmy2j8eu6` 11/08 19:20 | `19dc401` | tentativa anterior de prova (~42 min) |
| C | `49c6aenyi` 12/08 07:19 · `5gwtmvwde` 12/08 10:04 | `luuh8ivfl` 12/08 10:07 | `8a50546` · `ee3b26f` | janela da prova bem-sucedida |

As janelas A e B são coerentes com as tentativas em `19dc401` que falhavam no contrato de corpo
vazio — exatamente o defeito corrigido por PR #51 (`fix fiscal selftest empty body contract`,
`219cc6c`), mergeada em `8a50546`, que habilitou a prova da janela C.

`ji4pbjlw5` (#8) teve build `Error`: nenhuma função foi publicada, a resposta vem da plataforma
Vercel (`<title>Deployment has failed</title>`) e não do app. Sem capability.

### Estado da env (todos os escopos)

- `FISCAL_A1_OFFLINE_SELFTEST_ENABLED` — **ausente** em Production, Preview e Development
  (0 ocorrências em `vercel env ls`).
- `FISCAL_A1_PFX_B64_LOJA_1` — presente, Production, Encrypted, criada 1d atrás. **Intocada.**
- `FISCAL_A1_SENHA_LOJA_1` — presente, Production, Encrypted, criada 1d atrás. **Intocada.**

Nenhum valor Sensitive foi lido em nenhum momento.

---

## 3. FASE 2 — Evidência sanitizada da prova A1 (preservada antes de qualquer remoção)

**Deployment da prova:** `dpl_ErYxAtAgoCg4YfdyDFUZUxcCVZRD`
(`omni-gestao-49c6aenyi-rafaelfaria49-4373s-projects.vercel.app`)

| Campo | Valor |
|---|---|
| Source | branch `main`, commit `8a50546` (merge da PR #51; fix `219cc6c`) |
| Criado | 2026-08-12 07:19:30 -03 (clone em 10:19:31 UTC) |
| Target / Status | production / `Ready` |
| Resultado da execução | **HTTP 200**, `ok=true` |
| `materialResolvido` | `true` |
| `secureContextOk` | `true` |
| `clientCertificatePresented` | `true` |
| `mtlsLoopbackOk` | `true` |
| `destination` | `loopback` |
| `externalNetworkAttempted` | `false` |
| Nº de execuções autenticadas | exatamente **1** |
| Comunicação com SEFAZ | **nenhuma** |

Sem secret, sem cookie, sem header, sem PFX, sem senha. A prova permanece válida
independentemente da existência do deployment: o commit `8a50546` está em `git` e o
build OFF equivalente (`luuh8ivfl`) segue servindo o alias.

---

## 4. FASE 3 — Revisão independente

| Verificação | Resultado |
|---|---|
| Inventário ON completo | ✅ 4 ON. Cobertura = 100% dos deployments que contêm a rota (anteriores respondem `405`). Sonda comportamental, não inferência de janela. |
| Nenhum deployment OFF incluído | ✅ Candidatos = exatamente os que responderam `401 acesso_negado`. Os 5 OFF (`esyj5ypqj`, `a1880jwdy`, `64wubxjel`, `lmy2j8eu6`, `6q9q12wcb`) e o `Error` (`ji4pbjlw5`) ficam fora. |
| Candidatos não sustentam o alias | ✅ `vercel inspect https://omni-gestao-pro.vercel.app` resolve para `dpl_HKjFynvJNoyNDvbfZ9TEfPFwTfFq` (`luuh8ivfl`), que **não** é candidato. Nenhum candidato aparece em `vercel alias ls`. |
| Remoção não afeta banco/migrations/domínio | ✅ `vercel remove` atua só no artefato de build. Não toca Neon/Supabase, `_prisma_migrations`, envs nem domínios. |
| Evidência A1 preservada | ✅ Seção 3 acima. |
| Candidatos não necessários para rollback | ✅ ver abaixo. |

### Análise de rollback por candidato

| Candidato | Commit | O commit sobrevive em build OFF? |
|---|---|---|
| `ej3q10x43` | `19dc401` | ✅ `64wubxjel` e `lmy2j8eu6` (ambos OFF, `19dc401`) |
| `ix8fdp0k6` | `19dc401` | ✅ idem |
| `49c6aenyi` | `8a50546` | ✅ `luuh8ivfl` (OFF, `8a50546`) — é o próprio Production atual |
| `5gwtmvwde` | `ee3b26f` | ⚠️ é o **único** build de `ee3b26f`. Não é necessário para o estado atual (este GOAL proíbe promover `ee3b26f`); o commit está em `origin/main` e um build novo é reproduzível a qualquer momento. |

Nenhum candidato é alvo do estado atual de Production. Remover `5gwtmvwde` custa apenas um
rebuild caso a reconciliação futura escolha `ee3b26f` — nada é perdido em `git`.

---

## 5. Production pin (apenas registro — não reconciliar neste GOAL)

| Item | Valor |
|---|---|
| Commit servido pelo alias `omni-gestao-pro.vercel.app` | `8a50546` (via `dpl_HKjFynvJNoyNDvbfZ9TEfPFwTfFq`) |
| `origin/main` atual | `ee3b26f` (`style(shell): compactar temas e créditos no header`, 12/08 10:03:48) |
| Divergência | **1 commit.** `8a50546` é ancestral de `origin/main`. |

`ee3b26f` **não** foi promovido. Reconciliação fica fora deste GOAL.

---

## 6. FASE 4 — Contenção executada (após autorização humana explícita)

Autorização recebida na sessão, enumerando nominalmente os 4 IDs. Removidos um por vez, com
verificação do alias entre cada remoção.

| Deployment removido | Hash | Commit | Resultado | Alias após remoção |
|---|---|---|---|---|
| `dpl_Du6nivj5wZg69T73qv69jz7yMQ62` | `ej3q10x43` | `19dc401` | Removed | `dpl_HKjFynvJNoyNDvbfZ9TEfPFwTfFq` Ready |
| `dpl_GJrtgvAVhxcZw3TXFr55Kubfzj4H` | `ix8fdp0k6` | `19dc401` | Removed | `dpl_HKjFynvJNoyNDvbfZ9TEfPFwTfFq` Ready |
| `dpl_ErYxAtAgoCg4YfdyDFUZUxcCVZRD` | `49c6aenyi` | `8a50546` | Removed | `dpl_HKjFynvJNoyNDvbfZ9TEfPFwTfFq` Ready |
| `dpl_Eaj3hhaFoUKn83gbJRBPrQwPC4ET` | `5gwtmvwde` | `ee3b26f` | Removed | `dpl_HKjFynvJNoyNDvbfZ9TEfPFwTfFq` Ready |

### Validação

| Critério | Resultado |
|---|---|
| URLs removidas não servem mais a aplicação | ✅ as 4 respondem `404 DEPLOYMENT_NOT_FOUND` (plataforma, não app) |
| Re-sweep: nenhum snapshot ON remanescente | ✅ todo deployment restante com a rota responde `404 selftest_indisponivel`; os anteriores, `405` |
| Alias `omni-gestao-pro.vercel.app` saudável | ✅ `GET /` → 200; resolve para `dpl_HKjFynvJNoyNDvbfZ9TEfPFwTfFq` (`Ready`, `8a50546`) |
| Self-test no alias | ✅ `404 {"codigo":"selftest_indisponivel"}` |
| Flag ausente em todos os escopos | ✅ 0 ocorrências |
| A1 / PFX / senha intocados | ✅ `FISCAL_A1_PFX_B64_LOJA_1` e `FISCAL_A1_SENHA_LOJA_1` presentes, Production, Encrypted, 1d |
| Execuções criptográficas neste GOAL | ✅ **zero** — apenas sondas anônimas que param no guard de flag |
| Deployments restantes no projeto | 20 (nenhum ON) |

`ji4pbjlw5` (build `Error`) segue no projeto: não publica função, responde com a página da
plataforma, sem capability. Preservados: deployment OFF atual, domínio/alias, projeto Vercel,
PFX e senha A1, banco, e todos os demais deployments. Deployment Protection global inalterado.

**Capability residual da flag: eliminada.**

---

## 7. Fora de escopo (confirmado não iniciado)

Zero WSDL · zero `.asmx` · zero DNS/TLS SEFAZ · zero `statusServico` · zero SOAP · zero emissão.
H-9/H-10 não iniciados. Deployment Protection global não alterado.
