-- =====================================================================
-- Pós-venda — localização física do item (scooter ou peça em garantia)
-- =====================================================================
-- Registra ONDE está o item de um caso de pós-venda ao longo do ciclo
-- de garantia. Quando 'na_loja', o caso aparece TAMBÉM na aba "Oficina"
-- do painel (item fisicamente na loja em manutenção), sem virar uma OS.
--
-- Substitui a coluna booleana na_oficina (que era só "está na loja: sim/não").
--
-- localizacao = text, valores usados pela UI:
--   com_cliente        Com o cliente
--   na_loja            Na loja (em manutenção)   <- aparece na aba Oficina
--   enviada_fornecedor Enviada ao fornecedor
--   voltou_fornecedor  Voltou do fornecedor
--   entregue_cliente   Entregue ao cliente
-- Idempotente. O dono roda no Supabase (já aplicado via MCP em jun/2026).
-- =====================================================================


-- (1) remove a coluna booleana antiga, se existir
ALTER TABLE public.sac_casos DROP COLUMN IF EXISTS na_oficina;


-- (2) adiciona a localização (default = com o cliente)
ALTER TABLE public.sac_casos
  ADD COLUMN IF NOT EXISTS localizacao text NOT NULL DEFAULT 'com_cliente';


-- (3) conferir (esperado: 1 linha, localizacao text default 'com_cliente')
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'sac_casos'
  AND column_name = 'localizacao';
