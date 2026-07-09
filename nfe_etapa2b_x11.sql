-- =====================================================================
-- NF-e · ETAPA 2B — Dados fiscais na SCOOTER X11 CARBONO
-- =====================================================================
-- Scooter cadastrada DEPOIS da Etapa 2, ficou sem dados fiscais.
-- Mesmos valores das demais scooters (confirmados pelo contador).
-- id: 90ceb8d8-61ab-44da-9256-b92853b089c6  ·  codigo: x11
-- =====================================================================


-- (1) ANTES — confirmar que está sem dados fiscais (esperado: tudo NULL)
SELECT id, nome, ncm, cfop, cst_csosn, origem_mercadoria, unidade
FROM produtos
WHERE id = '90ceb8d8-61ab-44da-9256-b92853b089c6';


-- (2) UPDATE — aplica os valores fiscais padrão das scooters
UPDATE produtos
SET ncm               = '87116000',
    cfop              = '5102',   -- intra-RJ; sistema troca p/ 6102 por UF na emissão
    cst_csosn         = '102',
    origem_mercadoria = 2,
    unidade           = 'UN'
WHERE id = '90ceb8d8-61ab-44da-9256-b92853b089c6'
  AND ncm IS NULL;   -- idempotente: não sobrescreve se já preenchido


-- (3) DEPOIS — conferir (esperado: 1 linha preenchida)
SELECT id, nome, ncm, cfop, cst_csosn, origem_mercadoria, unidade
FROM produtos
WHERE id = '90ceb8d8-61ab-44da-9256-b92853b089c6';

-- (3b) Sanidade geral — scooters ainda SEM ncm (esperado: só os 2 excluídos:
--      "Pagamento Faltante Scooter" e "Scooter MC20 2000W" consignada)
SELECT id, nome FROM produtos
WHERE categoria = 'scooter' AND ncm IS NULL
ORDER BY nome;
