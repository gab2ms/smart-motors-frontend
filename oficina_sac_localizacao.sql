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


-- (2) adiciona a localização no pós-venda/SAC (default = com o cliente)
ALTER TABLE public.sac_casos
  ADD COLUMN IF NOT EXISTS localizacao text NOT NULL DEFAULT 'com_cliente';


-- (3) adiciona a localização também na Oficina (default = na loja, pois a OS
--     normalmente está sendo trabalhada na loja; o usuário ajusta por OS).
ALTER TABLE public.oficina_ordens
  ADD COLUMN IF NOT EXISTS localizacao text NOT NULL DEFAULT 'na_loja';


-- (4) conferir (esperado: 2 linhas)
SELECT table_name, column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('sac_casos', 'oficina_ordens')
  AND column_name = 'localizacao'
ORDER BY table_name;
