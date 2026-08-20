# Evidência — CONTADOR-HUB-PRODUCTION-HARDENING-019

Trilha `contador` · GOAL 019 · plano `CONTADOR-HUB-FABLE5-MASTERPLAN-001` (plan_rev 1).
Base: `origin/main` em `6aa470a7b855ef036f78daef3dde0b2481a599d1`.
Branch de implementação: `goal/contador-019-production-hardening`
(worktree `C:/Projetos/omni-gestao-contador-019`).

Nenhuma operação destrutiva foi executada em Production nesta entrega.
`CONTADOR_RETENCAO_APPLY` **não foi definida em nenhum ambiente**.

---

## 1. Carga sintética da geração do pacote

Comando (sem banco, sem Production — cliente injetado em memória):

```
npx tsx scripts/contador/carga-sintetica-pacote.mjs --vendas=20000 --json
```

Resultado observado (exit 0):

```json
{
  "vendasSinteticas": 20000,
  "itensSinteticos": 40091,
  "devolucoes": 400,
  "movimentacoes": 6667,
  "contasReceber": 1429,
  "contasPagar": 1429,
  "sessoes": 120,
  "queriesLogicas": 65,
  "msGeracaoMassa": 41,
  "msCargaFontes": 121,
  "msMontagemConteudo": 145,
  "msZip": 366,
  "msTotalGeracao": 635,
  "arquivos": 14,
  "bytesDescompactados": 5764793,
  "bytesZip": 1210900,
  "memoria": { "heapUsedMb": 62.3, "rssMb": 231.7 },
  "timeoutLogicoMs": 30000,
  "dentroDoTimeoutLogico": true,
  "slaCanonico": null,
  "falhas": []
}
```

Leitura: 20 000 vendas / 40 091 itens geram o pacote completo em **635 ms**, com
ZIP de **1,21 MB** e pico de heap de **62,3 MB**. Fica em 2,1 % do único teto que
existe no código (`TIMEOUT_LOGICO_MS = 30 000 ms`) e bem abaixo de
`MAX_BYTES_ZIP` (10 MB) e `MAX_BYTES_DESCOMPACTADO` (25 MB).

**Não existe SLA numérico canônico** para a geração do pacote no masterplan nem no
roadmap 014–019. O resultado é registrado como observação; nenhum threshold de
aprovação foi inventado.

---

## 2. Dry-run do job de retenção (massa sintética, sem banco)

Comando:

```
npx tsx scripts/contador/retencao-dry-run.ts --sintetico
```

Saída (exit 0), incluindo as métricas emitidas no log estruturado:

```
{"evento":"metrica","metrica":"retention_dry_run_total","valor":1,"labels":{"modo":"dry-run"}}
{"evento":"metrica","metrica":"retention_candidates_total","valor":2,"labels":{"alvo":"documentos","modo":"dry-run"}}
{"evento":"metrica","metrica":"retention_bytes_candidate","valor":3200000,"labels":{"alvo":"documentos","modo":"dry-run"}}
{"evento":"metrica","metrica":"retention_candidates_total","valor":1,"labels":{"alvo":"blobs_soft_deletados","modo":"dry-run"}}
{"evento":"metrica","metrica":"retention_bytes_candidate","valor":1200000,"labels":{"alvo":"blobs_soft_deletados","modo":"dry-run"}}
{"evento":"metrica","metrica":"retention_candidates_total","valor":1,"labels":{"alvo":"pacotes","modo":"dry-run"}}
{"evento":"metrica","metrica":"retention_bytes_candidate","valor":3500000,"labels":{"alvo":"pacotes","modo":"dry-run"}}

Contador HUB · retencao · modo DRY-RUN
lojas varridas: 1 (loja-sintetica)

cortes vigentes:
  documentos FISCAL      PURGE_DISABLED (sem purga automatica)
  documentos FINANCEIRO  2021-08-20T...
  documentos FOLHA       PURGE_DISABLED (sem purga automatica)
  documentos JURIDICO    PURGE_DISABLED (sem purga automatica)
  documentos OUTRO       2021-08-20T...
  pacotes (12 meses)      2025-08-20T...
  blob soft-del (90 dias) 2026-05-22T...

alvo                  candidatos    bytes  protegidos  descartados  ja_ausentes  falhas
  documentos                  2  3200000          21            0            0       0
  blobs_soft_deletados        1  1200000           2            0            0       0
  pacotes                     1  3500000          11            0            0       0

bytes estimados para liberacao: 7900000
itens protegidos pela politica: 34
candidatos por categoria: FINANCEIRO=1 OUTRO=1
erros/indisponibilidades: 0

DRY-RUN: nada foi alterado em banco nem em storage.
```

Pontos que a saída prova:

- `FISCAL`, `JURIDICO` e `FOLHA` aparecem como `PURGE_DISABLED` — sem data de corte;
- só `FINANCEIRO` e `OUTRO` produzem candidatos por idade;
- `descartados = 0` em todos os alvos (é dry-run);
- nenhuma label de métrica carrega `storageRef`, URL, e-mail, CPF/CNPJ ou nome.

---

## 3. Provas por teste

- `lib/contador/retencao/politica.test.ts` — matriz de janelas (FISCAL/JURIDICO/FOLHA
  nunca elegíveis; FINANCEIRO/OUTRO `<5a` protegido e `>5a` candidato; pacote `<12m`
  protegido e `>12m` candidato; soft-delete `<90d` protegido e `>=90d` candidato) e
  aritmética de calendário civil (29/02, 31/03, virada de ano, anos bissextos).
- `lib/contador/retencao/job.test.ts` — dry-run com porta de escrita SENTINELA que
  lança em qualquer uso (prova de zero escrita); apply sem a flag bloqueado; valor
  ambíguo não destrava; idempotência (2ª execução: 0 descartes, 0 eventos novos);
  blob ausente tratado sem erro fatal; registro e evento preservados; falha isolada
  não vaza URL assinada.
- `lib/contador/observabilidade.test.ts` — nomes canônicos; emissão em uma linha JSON;
  e tentativa de vazamento com storageRef, URL assinada, e-mail, CPF com e sem
  máscara, CNPJ com e sem máscara, telefone, nome e conteúdo de documento — nenhum
  sobrevive, nem truncado.
- `lib/contador/legado/rota-legada.test.ts` — `/contador**` e `/login-contador**`
  redirecionam; `/contador-externo**` nunca é capturado (anti-laço); vizinhas
  (`/dashboard/contador`, `/api/**`, `/portal`, `/contadores`, `/contador-teste`)
  intactas.
- `lib/contador/retencao/limites.test.ts` — cada limite com valor é idêntico à fonte
  original (nenhum número alterado pelo 019); `categoria` e `competencia` declarados
  como sem número canônico.

## 4. Achado corrigido durante a execução

O primeiro desenho do saneador de labels aceitava `[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}`.
O teste de vazamento reprovou: **CPF formatado (`123.456.789-00`) passava**, porque
`.` e `-` estavam no alfabeto. A regra foi endurecida para exigir **letra inicial** e
alfabeto `[A-Za-z0-9_-]`, o que elimina de uma vez CPF, CNPJ e telefone — com e sem
máscara — porque todos começam por dígito. Consequência assumida e documentada: valor
puramente numérico nunca vira label (número é dado, e dado vai em `valor`).
