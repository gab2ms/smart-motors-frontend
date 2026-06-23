-- =====================================================================
-- Resumo por IA das OS / pós-venda — colunas de cache
-- =====================================================================
-- A lista do painel Oficina/Pós-venda exibe um resumo (problema + situação)
-- gerado por IA. O resumo é gerado pela Edge Function `gerar-resumo-os`
-- (modelo claude-haiku-4-5) quando a OS é salva, e fica em cache nestas
-- colunas — a lista só lê o texto já salvo (sem custo por exibição).
--
-- resumo_ia     = text  (a frase-resumo)
-- resumo_ia_em  = timestamptz (quando foi gerado)
-- Idempotente. Já aplicado em produção via MCP em jun/2026.
-- =====================================================================

ALTER TABLE public.oficina_ordens
  ADD COLUMN IF NOT EXISTS resumo_ia    text,
  ADD COLUMN IF NOT EXISTS resumo_ia_em timestamptz;

ALTER TABLE public.sac_casos
  ADD COLUMN IF NOT EXISTS resumo_ia    text,
  ADD COLUMN IF NOT EXISTS resumo_ia_em timestamptz;

-- A Edge Function precisa do secret ANTHROPIC_API_KEY (Settings -> Edge Functions).
-- Código da função versionado em supabase/functions/gerar-resumo-os/index.ts
