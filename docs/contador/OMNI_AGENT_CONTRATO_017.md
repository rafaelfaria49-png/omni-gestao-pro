# Contrato Omni Agent — Contador HUB (GOAL 017)

Canal: **classificação B**. Infraestrutura Omni/WhatsApp existe no produto, mas **não** é o canal do Contador.

`EXTERNAL_SEND_ALLOWED=false`

`mensagem_enviada` é tipo **reservado** e **não é emitido** neste GOAL.

O Omni Core (`lib/omni-agent/**`) permanece intocado. Integração futura consome este contrato; não o inverso.

---

## 1. Tipos de alerta

| `regra` | Fonte real | Dispara quando | Silencia |
|---|---|---|---|
| `documento_pendente` | `ContadorDocumento` (GOAL 010) | `status === PENDENTE` | `ENVIADO` / `CONFERIDO` / `RESOLVIDO`; competência inexistente |
| `fechamento_proximo` | `ContadorCompetencia` (GOAL 012) | status ≠ `FECHADA` e faltam ≤ 7 dias civis SP para o último dia da competência (ou o mês já passou) | competência `FECHADA`; folga > 7 dias |
| `guia_vencendo` | Agenda (GOAL 016) | `estaVencendo` (janela canônica de **7 dias**) | paga (`pagaEm`); fora da janela |
| `guia_vencida` | Agenda (GOAL 016) | `estaVencido` (dia UTC do vencimento < hoje SP) | paga |
| `pacote_com_pendencias` | `manifesto.pendencias` da versão efetiva do `ContadorPacote` (GOAL 012). Não usa `snapshot.checklist`. | pacote existe e há pendência operacional após filtrar ids stale | sem pacote; só stale; manifesto sem pendência operacional |
| `alteracao_pos_fechamento` | `ContadorEvento` persistido (POST 012) | existe evento `alteracao_pos_fechamento` | ausência de evento (GET vivo de divergência **não** inventa alerta) |

Itens stale **nunca** usados como fonte: `documentos`, `fechamento_oficial`.

Limiares **ratificados** (sem número extra, sem preferência persistente):

- `DOCUMENTO_PENDENTE_THRESHOLD=STATE_ONLY` — dispara só com `status === PENDENTE`.
- `FECHAMENTO_PROXIMO_DAYS=7` — últimos 7 dias civis até o fim da competência (`JANELA_OPERACIONAL_DIAS`).
- `THRESHOLD_HUMAN_DECISION_REQUIRED=false`

---

## 2. DTO

```ts
{
  id: string            // SHA-256 hex da chave de dedupe (não UUID de tabela)
  regra: RegraId
  origem: string        // documento | competencia | agenda | pacote | fechamento
  severidade: "baixa" | "media" | "alta"
  competencia: "AAAA-MM"
  alvo: string          // id técnico curto
  titulo: string
  prazo: string | null  // AAAA-MM-DD quando aplicável
  janela: string
  tratado: boolean
  materializado: boolean
}
```

Proibido no DTO e no rascunho: valor de guia, imposto/cálculo, `storageRef`, URL assinada, token, e-mail/telefone/CPF/IMEI, snapshot bruto, PII de cliente.

---

## 3. Dedupe

Chave: `regra + alvo + storeId + competenciaId + janela`

Persistência: `ContadorEvento`

- `alerta_emitido` — `POST /avaliar` (materialização explícita) **e** `POST /[id]/tratar` quando o candidato ainda não tinha evento
- `alerta_tratado` — `POST /[id]/tratar` (idempotente). Trilha obrigatória: `alerta_emitido` → `alerta_tratado` na **mesma** transação (1+1). Não exige clique prévio em «Atualizar avisos».
- `alerta_suprimido` — reconhecido na leitura; o 017 não o emite
- `mensagem_enviada` — **reservado, não emitido**

Lock: `SELECT id FROM contador_competencias WHERE id = $1 AND "storeId" = $2 FOR UPDATE` (padrão GOAL 012). Duas avaliações concorrentes → um evento.

Tratado/suprimido silencia a **mesma** chave até nova janela válida (novo dia civil SP, novo `diffHash`, nova versão de pacote).

Falha da transação: zero evento parcial / órfão.

`GET /api/contador/notificacoes` é **somente leitura** (avalia + lista + consulta histórico; zero INSERT/UPDATE).

Fonte do pacote: `PacoteAlerta.pendencias` = `manifesto.pendencias` da maior versão. A regra não lê `snapshot.checklist`. O JSON do manifesto não vive na linha `ContadorPacote` (schema fora); o adapter Prisma reutiliza `montarPendencias` (GOAL 008) sobre o checklist congelado da versão efetiva, sem copiar a regra.

---

## 4. Rascunho

```
marca:  RASCUNHO
idioma: pt-BR
ação:   copiar
envio:  proibido
```

Agenda mantém a microcopy **«informado pelo responsável»** só para vencimentos/dados da guia. A janela de 7 dias é canônica do sistema — não é informada pelo responsável.

`GET /[id]/rascunho` representa somente alerta **atualmente ativo**. Chave já `alerta_tratado` ou `alerta_suprimido` → 404 (não gera rascunho novo). Sem persistência de rascunho.

Não existe `POST /enviar`.

---

## 5. APIs

| Método | Rota | Efeito |
|---|---|---|
| GET | `/api/contador/notificacoes?c=AAAA-MM` | lista (read-only) |
| POST | `/api/contador/notificacoes/avaliar` | reavalia e persiste `alerta_emitido` novos |
| POST | `/api/contador/notificacoes/[id]/tratar` | garante `alerta_emitido` (se ausente) + `alerta_tratado` atomicamente |
| GET | `/api/contador/notificacoes/[id]/rascunho?c=AAAA-MM` | rascunho só de alerta ativo |

Escopo: sessão + loja ativa. `storeId` / `competenciaId` / metadata de alerta no cliente → 400. Cross-store → 404 fail-closed.

`alertId` é recalculado no servidor a partir da avaliação atual.

---

## 6. Integração futura (fora deste GOAL)

Um GOAL de canal poderá:

1. Ler avisos materializados (`alerta_emitido` não tratado).
2. Mostrar o rascunho no Omni Inbox.
3. Exigir confirmação humana auditada.
4. Só então emitir `mensagem_enviada` **se** houver destinatário Contador e canal aprovado.

Até lá: `EXTERNAL_SEND_ALLOWED=false`. Não chamar `sendCloudApi*`, `sendWhatsAppMessage` nem Graph.
