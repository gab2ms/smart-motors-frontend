-- =====================================================================
-- Custo real de serviço — Oficina + SAC (backlog #2)
-- =====================================================================
-- Adiciona custo de mão de obra + peças (avulsas) para calcular o
-- LUCRO real por serviço (Oficina) e o CUSTO da garantia (SAC).
-- MVP: NÃO mexe em estoque, caixa ou DRE — só registra e exibe.
--
-- pecas = jsonb array de { "descricao": text, "custo": number }
-- custo_mao_obra = numeric (um valor por OS/caso)
-- Idempotente (IF NOT EXISTS). O dono roda no Supabase.
-- =====================================================================


-- (1) ANTES — confirmar que as colunas ainda não existem (esperado: 0 linhas)
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('oficina_ordens', 'sac_casos')
  AND column_name IN ('custo_mao_obra', 'pecas');


-- (2) OFICINA — custo de mão de obra + peças
ALTER TABLE public.oficina_ordens
  ADD COLUMN IF NOT EXISTS custo_mao_obra numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pecas jsonb NOT NULL DEFAULT '[]'::jsonb;


-- (3) SAC — mesmo modelo (custo da garantia; SAC não tem receita)
ALTER TABLE public.sac_casos
  ADD COLUMN IF NOT EXISTS custo_mao_obra numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pecas jsonb NOT NULL DEFAULT '[]'::jsonb;


-- (4) DEPOIS — conferir (esperado: 4 linhas, 2 por tabela)
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('oficina_ordens', 'sac_casos')
  AND column_name IN ('custo_mao_obra', 'pecas')
ORDER BY table_name, column_name;
