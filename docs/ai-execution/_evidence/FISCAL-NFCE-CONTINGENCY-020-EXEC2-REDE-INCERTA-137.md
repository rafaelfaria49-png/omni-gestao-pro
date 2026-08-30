# FISCAL-NFCE-CONTINGENCY-020 — 2ª execução H-9/H-10: one-shot OK, 6× rede incerta (137)

Trilha `fiscal` · GOAL 020 (continuação) · FISCAL-020-H9H10-ACQUIRE-CONTAIN-131 (2ª janela).
Data: 2026-08-30 · Autorização textual humana recebida verbatim nesta sessão (nova janela).

## Linha do tempo (UTC)

| Instante | Evento |
|---|---|
| 19:35 | FASE 3: janela calculada no runtime — `wsdl-h9h10-20260830-2005z-513540884b814ac1`, `20:05:00.000Z → 20:15:00.000Z` |
| 19:37 | Commit ON `f613a65` (3 constantes + teste de materialização); revisão independente **APROVADO P0=0 P1=0** (4/4 focos) |
| 19:40–19:48 | PR #132: 118 checks verdes → merge → `main = 89840e3` |
| 19:55 | FASE 4: deployment Production ON `dpl_EXhe7AAh…` (`kgrebn210`) READY, alias canônico promovido; **primitive corrigido (135) no runtime** |
| 19:55:59 | Login ADMIN pré-janela (mecanismo existente; cookie em jar temporário, nunca impresso) |
| **20:05:17** | **FASE 5: a ÚNICA chamada administrativa** → **HTTP 200** — consumo one-shot FUNCIONOU (fix P2010 validado em produção) e o batch executou os 6 alvos |
| 20:07–20:17 | FASE 6: commit OFF `ffec59e` → PR #133 → 112 checks → merge `97ae815` (janela expirada por clock às 20:15Z) |
| 20:21 | Deploy Production OFF `dpl_CPuLtyFd…` (`5re3ot85f`) READY; alias promovido ao OFF |
| 20:21–20:23 | Inventário por meta `githubCommitSha`: ON production `kgrebn210` e ON preview `5nvmii0dv` **REMOVIDOS**; 0 deployments ON restantes |

## Resultado da execução (resposta sanitizada íntegra, HTTP 200)

`ok:false` · `code:"completed"` · **6 serviços**, todos com:

- `httpStatus: null`, `byteLength: null`, `sha256: null`, `contentTypeEvidence: null`
- `h9: false`, `h10: false`
- `failureClass: "acquisition:wsdl_rede_incerta"` — falha de rede/TLS **antes de qualquer
  resposta HTTP** (sem corpo recebido; nenhum documento persistido/visto; `RAW_WSDL_PERSISTED=false`)

Serviços: NFeAutorizacao4, NFeRetAutorizacao4, NFeConsultaProtocolo4, NFeStatusServico4,
NFeInutilizacao4, NFeRecepcaoEvento4 (exatamente os 6 alvos fechados HOMOLOGACAO/SP).

- WSDL_ADMIN_CALL_COUNT = 1 · **WSDL_EXTERNAL_GET_COUNT ≤ 6** (uma tentativa por alvo; classe
  sanitizada não distingue se o socket chegou a abrir — `externalTransmissionAttempted` não
  sai na resposta pública, por desenho)
- SEFAZ_SOAP_POST_COUNT = 0 · SEFAZ_PRODUCTION_REQUEST_COUNT = 0
- Nenhum cookie/token/senha/PFX/ref extraído ou impresso; jar temporário apagado.

## O que funcionou (provas desta execução)

1. **Fix P2010 validado em produção**: o consumo one-shot transacional completou (job técnico
   `CONSULTA/CONCLUIDO` + `FiscalLog` persistidos; advisory lock com cast `::text`).
2. Pipeline completo de guards até a rede: janela ativa, superfície canônica, ADMIN, piloto
   `loja-1`, config 132, A1 (resolveActiveCertificate + SecureContext), one-shot, batch fechado
   de 6 alvos com authority one-shot por alvo.
3. Containment por deployment executado com sucesso (remoção via `vercel rm` + alias OFF).

## Bloqueio externo: `wsdl_rede_incerta` nos 6 alvos

Falha idêntica nos 6 alvos (mesmo host), pré-resposta HTTP. Região do runtime: **gru1**
(São Paulo — egress brasileiro, ver builds Vercel). Hipóteses rankadas (diagnóstico offline —
os logs do deployment ON foram removidos com o containment):

1. **Cadeia TLS do servidor não confiável para o Node do runtime** (`rejectUnauthorized:true`)
   — certificados de homologação SEFAZ-SP podem não ancorar nas roots do Node ⇒ handshake
   falha antes da resposta HTTP (coerente com httpStatus null em todos).
2. **Bloqueio de faixa de IP datacenter pelo firewall SEFAZ-SP** (reset/handshake recusado) —
   conhecido em endpoints SEFAZ mesmo em homologação.
3. **DNS do host homologação indisponível/resolvido com falha no sandbox** (ENOTFOUND/EAI_AGAIN
   → error event → mesma classe sanitizada).

Próximo passo sugerido (NOVO GOAL + gate humano específico): telemetria sanitizada de
transporte no `wsdl-acquisition` (código de erro Node classificado — ex. `ENOTFOUND`,
`ECONNRESET`, `CERT_HAS_EXPIRED`/`UNABLE_TO_VERIFY_VERIFY_SIGNATURE` — sem corpo, sem segredo)
e/ou sonda de diagnóstico controlada, antes de nova janela. **Nenhuma repetição de GET foi
feita e nenhuma deve ser feita sem novo gate.**

## Classificação (GOAL 131, 2ª execução)

**B-EXTERNAL-EVIDENCE** — evidência externa parcial (0/6 serviços com documento válido; o
one-shot foi consumido por esta janela e a activation `513540884b814ac1` está encerrada e
proibida). H-9/H-10 permanecem **ABERTOS**. Não-D: 1 chamada, ≤6 GETs, sem SOAP/emissão,
sem produção, sem segredo exposto, deployments ON removidos (não abandonados), 020 RUNNING,
021 não iniciado.
