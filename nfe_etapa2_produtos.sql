-- =====================================================================
-- NF-e · ETAPA 2 — Dados fiscais nas SCOOTERS
-- =====================================================================
-- Preenche os campos fiscais (iguais para todas as scooters).
-- NÃO toca acessórios (categoria='acessorio' tem NCM próprio) nem serviços.
-- Rodar os 3 passos em ordem; conferir o ANTES e o DEPOIS.
-- =====================================================================


-- (1) ANTES — quantas/quais scooters serão afetadas
SELECT id, codigo, nome, categoria, ncm, cfop, cst_csosn, origem_mercadoria, unidade
FROM produtos
WHERE categoria = 'scooter'
ORDER BY nome;


-- Excluídos do preenchimento (NÃO são mercadoria da loja):
--   1e21f98a-26d6-4555-a5e6-4cf1b4f00ec9  "Scooter  MC20 2000W"  -> moto CONSIGNADA de cliente
--   da60eca3-0cb7-45c5-8cac-e76610c631a5  "Pagamento Faltante Scooter" -> ajuste de pagamento, não é produto


-- (2) UPDATE — aplica os valores fiscais confirmados pelo contador
UPDATE produtos
SET ncm               = '87116000',
    cfop              = '5102',   -- padrão intra-RJ; sistema troca p/ 6102 por UF na emissão
    cst_csosn         = '102',
    origem_mercadoria = 2,
    unidade           = 'UN'
WHERE categoria = 'scooter'
  AND id NOT IN (
    '1e21f98a-26d6-4555-a5e6-4cf1b4f00ec9',  -- consignada de cliente
    'da60eca3-0cb7-45c5-8cac-e76610c631a5'   -- ajuste de pagamento
  );


-- (3) DEPOIS — conferir o preenchimento
--     Esperado: total_scooters=78, preenchidas_corretas=76,
--               excluidos_null=2 (os dois ids continuam NULL)
SELECT
  count(*)                                                              AS total_scooters,
  count(*) FILTER (
    WHERE ncm = '87116000' AND cfop = '5102' AND cst_csosn = '102'
      AND origem_mercadoria = 2 AND unidade = 'UN'
  )                                                                     AS preenchidas_corretas,
  count(*) FILTER (
    WHERE id IN ('1e21f98a-26d6-4555-a5e6-4cf1b4f00ec9',
                 'da60eca3-0cb7-45c5-8cac-e76610c631a5')
      AND ncm IS NULL AND cfop IS NULL AND cst_csosn IS NULL
  )                                                                     AS excluidos_null
FROM produtos
WHERE categoria = 'scooter';

-- (3b) Sanidade — garante que nenhum ACESSÓRIO foi tocado por engano
--      Esperado: 0 linhas
SELECT id, codigo, nome, categoria, ncm, cfop, cst_csosn
FROM produtos
WHERE categoria <> 'scooter'
  AND (ncm IS NOT NULL OR cfop IS NOT NULL OR cst_csosn IS NOT NULL);
