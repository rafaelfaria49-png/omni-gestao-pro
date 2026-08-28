# Q-04 — Contingência offline NFC-e — evidência regulatória

Status: pesquisa read-only registrada para o GOAL `FISCAL-NFCE-CONTINGENCY-020`.
Data da consulta: 2026-08-28.

## Fontes oficiais consultadas

- [Portal Nacional — histórico de manuais](https://www.nfe.fazenda.gov.br/pOrtaL/listaHistorico.aspx?tipoConteudo=GKxb5ZZeQIM%3D), incluindo o Manual de Especificações da Contingência Offline para NFC-e v2.0.
- [MOC — Anexo IV](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=fMhAfsQfE%2BM%3D), regras operacionais da contingência offline NFC-e.
- [MOC — Anexo I](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=J%2BIv4eN00E%3D), leiaute e regras de validação de emissão.
- [Manual/NT do QR Code](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=NvuzQGYd6E8%3D), versão corrente consultada para QR Code v3.
- [Portaria SRE 40/2024 — SEFAZ-SP](https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-40-de-2024.aspx), texto vigente consultado, inclusive alterações posteriores indicadas na própria página.
- [Resposta à Consulta SEFAZ-SP 31961/2025](https://legislacao.fazenda.sp.gov.br/Paginas/RC31961_2025.aspx), consultada para confirmar a alternativa de armazenamento seguro e a obrigação de manter o DANFE NFC-e imprimível.

## Fatos aplicados

1. A modalidade adotada para NFC-e é o modelo 65 com `tpEmis=9` (contingência offline). O MOC Anexo I trata a emissão offline como a modalidade própria do modelo 65; EPEC (`tpEmis=4`) não é assumido neste GOAL.
2. O XML de contingência deve registrar `dhCont` como o instante em que a contingência foi acionada e `xJust` como justificativa. Esses valores integram o documento que será assinado.
3. A transmissão posterior deve ocorrer até o final do primeiro dia útil seguinte à emissão. O prazo será calculado com calendário injetável e persistido junto ao job; não será substituído por uma janela fixa de 24 horas.
4. O QR Code de contingência precisa ser derivado dos dados oficiais do documento e conter a assinatura/parâmetros exigidos pela versão vigente do manual de QR. A implementação prepara os dados e preserva o vínculo com o XML; o leiaute/renderização final do DANFCE permanece fora do GOAL 020 e será tratado pelo GOAL 021.
5. A Portaria SRE 40/2024 remete a operação sem transmissão ou sem resposta ao procedimento de contingência previsto no Ajuste SINIEF 19/2016, disciplina leiaute/DANFE/QR e exige a guarda do documento digital pelo prazo fiscal aplicável. A página consultada registra que a antiga CAT 12/2015 foi revogada; regras antigas não são usadas como fonte normativa.
6. A resposta à consulta SEFAZ-SP 31961/2025 confirma a possibilidade de armazenamento seguro do XML como alternativa operacional à segunda via impressa, sem eliminar a necessidade de o DANFE NFC-e ser imprimível.

## Decisões de escopo

- Entrada manual e explícita por loja, protegida por autorização administrativa e kill-switch; fallback automático fica desabilitado.
- Ambiente permitido no piloto: `HOMOLOGACAO`. Produção, SAT, EPEC e emissão automática ficam fora do escopo.
- O XML assinado e seus bytes são persistidos uma única vez. A transmissão posterior reutiliza exatamente esses bytes; retry não recria XML nem renumera.
- Timeout/estado incerto reutiliza as coordenadas existentes de consulta e reconciliação; rejeição definitiva que consome a numeração encaminha a inutilização existente, sem duplicar a lógica de 019.
- O GOAL prepara os dados necessários à integração do DANFCE/QR, mas não implementa renderização, impressão ou layout final.

## Gate externo

Não há gate válido de homologação SEFAZ/A1 liberado nesta execução. O resultado implementável será acompanhado de `EXTERNAL_HOMOLOGATION_PENDING`; não será declarado teste N6 nem homologação real, e o GOAL não será ratificado como concluído se a governança exigir autorização externa para isso.
