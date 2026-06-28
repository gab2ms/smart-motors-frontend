-- ═══════════════════════════════════════════════════════════
-- Afiliados — Comissão escalonada por preço mínimo (por modelo)
-- Substitui a comissão "R$ fixo por produto" pela regra:
--   vendendo no preço mínimo do modelo → comissão base (R$ 100);
--   a cada R$ 100 vendidos acima do mínimo → +R$ 50.
-- Aplicado no Supabase via migration "afiliados_comissao_escalonada".
-- Tudo aditivo (não remove a coluna antiga produtos.comissao_afiliado,
-- que segue como fallback de transição enquanto os preços mínimos não
-- estão todos cadastrados).
-- ═══════════════════════════════════════════════════════════

-- 1) Preço mínimo por MODELO (a tabela produtos_precos é por modelo).
--    NULL = ainda não cadastrado → cálculo cai no fallback antigo.
alter table public.produtos_precos
  add column if not exists preco_minimo_afiliado numeric;
comment on column public.produtos_precos.preco_minimo_afiliado is
  'Melhor preço (mínimo) do modelo para o cliente. Base da comissão escalonada do afiliado.';

-- 2) Escala global da comissão (chave/valor em config_custos, editável no app).
--    base = comissão ao vender no mínimo; a cada "passo" acima do mínimo, soma "incremento".
insert into public.config_custos (chave, valor) values
  ('afiliado_comissao_base', 100),
  ('afiliado_comissao_incremento', 50),
  ('afiliado_comissao_passo', 100)
on conflict (chave) do nothing;
