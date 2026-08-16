# Revisão independente — GOAL 040 (nProt / chNFe / CNPJ)

| Campo | Valor |
|---|---|
| GOAL | `FISCAL-018-CANCELAMENTO-NPROT-IDENTIFIERS-ADJUDICATION-040` |
| Revisor | família distinta do autor (GPT-5.6) |
| Veredito | **CONCORDA-B** |
| Rede SEFAZ | não acessada (somente artefatos locais) |

## Veredito

**CONCORDA-B.** O bloqueador residual está corretamente identificado: falta republicação oficial de `e110111` com `TProt` 15\|17 e identificadores alfanuméricos vigentes. Sem esse grafo oficial único, A exigiria composição não publicada.

## Pontos obrigatórios

1. **15 vs 17.** Separação correta: XSD clássico `Evento_Canc_PL_v1.01` limita `TProt` a 15; NT 2025.002 e `tiposBasico` 010d admitem 15 ou 17. O aviso de 04/07/2025 foi tratado como evidência operacional, não como alteração do XSD 110111.

2. **Precedência temporal.** NT 2025.002 v1.10 (09/06/2025) já estabelecia 15 ou 17 antes do aviso. A v1.51 vigente preserva §5.1, PR09 e R51.

3. **Schema × comportamento operacional.** Camadas explícitas e corretas. O aviso não é apresentado como XSD novo.

4. **SP.** Somente testes em 11/03/2026 comprovados na página pública. Produção 17 **não inferida**.

5. **chNFe / CNPJ.** Autor do evento, CNPJ na chave e `chNFe` do documento estão separados. Patterns clássico × 010d, inclusive `Id`, diferenciados.

6. **Ausência de inferência.** Não há grafo XSD misto inventado. 010d não contém `e110111`; composição clássico+010d é declarada como não oficial.

7. **Zero rede SEFAZ.** Revisão e adjudicação documentais/offline. Sem WS, homologação, SOAP ou mTLS.

## `cStat` / H-9

128 / 135 / 101 preservados por camada, sem reabertura. H-9/H-10 não apresentados como alterados.

## Erros factuais

Nenhum no escopo revisado.
