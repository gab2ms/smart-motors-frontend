-- =====================================================================
-- Tipo de atendimento — Pós-venda/Garantia · Serviço pago · Produto da loja
-- =====================================================================
-- Antes, a classificação era implícita pela tabela (oficina_ordens = "pago",
-- sac_casos = "pós-venda"). Como quase tudo foi cadastrado como OS, garantias
-- ficaram rotuladas como serviço pago. Agora cada atendimento carrega um TIPO
-- explícito e as telas roteiam por ele.
--
-- Regra de negócio: TER CUSTO não torna "serviço pago" — a loja pode bancar o
-- conserto de uma garantia. servico_pago = o CLIENTE paga.
--
-- tipo_atendimento      text: pos_venda | servico_pago | produto_loja
-- classificacao_revisar boolean: true = "a classificar" (funcionário confirma)
-- Idempotente. Aplicado em produção via MCP em jun/2026.
-- =====================================================================

-- (1) Colunas
ALTER TABLE public.oficina_ordens
  ADD COLUMN IF NOT EXISTS tipo_atendimento text NOT NULL DEFAULT 'pos_venda',
  ADD COLUMN IF NOT EXISTS classificacao_revisar boolean NOT NULL DEFAULT false;

ALTER TABLE public.sac_casos
  ADD COLUMN IF NOT EXISTS tipo_atendimento text NOT NULL DEFAULT 'pos_venda',
  ADD COLUMN IF NOT EXISTS classificacao_revisar boolean NOT NULL DEFAULT false;

-- (2) Reclassificação dos existentes (decisão do dono):
--   só #50 (Eliene) e #32 (Pietro) = serviço pago; resto da oficina = pós-venda;
--   todas as OS não-transferidas marcadas "a classificar" p/ o funcionário revisar.
UPDATE public.oficina_ordens
  SET tipo_atendimento = 'servico_pago'
  WHERE numero IN (50, 32) AND status <> 'transferido';

UPDATE public.oficina_ordens
  SET classificacao_revisar = true
  WHERE status <> 'transferido';

-- sac_casos já ficam pos_venda / revisar=false pelo default (já estão corretos).

-- (3) Conferir
SELECT 'oficina_ordens' AS tabela, tipo_atendimento, classificacao_revisar, count(*)
FROM public.oficina_ordens WHERE status <> 'transferido'
GROUP BY 1,2,3
UNION ALL
SELECT 'sac_casos', tipo_atendimento, classificacao_revisar, count(*)
FROM public.sac_casos WHERE status <> 'transferido'
GROUP BY 1,2,3
ORDER BY 1,2;
