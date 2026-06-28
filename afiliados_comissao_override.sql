-- Afiliados — override de comissão por pedido
-- Permite fixar manualmente a comissão de UM pedido específico (sobrepõe o
-- cálculo por produto). Útil quando o preço de venda saiu do padrão.
-- Aplicado via migration "afiliados_comissao_override_por_pedido". Aditivo.

alter table public.pdv_pedidos add column if not exists comissao_afiliado_override numeric;
comment on column public.pdv_pedidos.comissao_afiliado_override is
  'Comissão de afiliado fixada manualmente para ESTE pedido (sobrepõe o cálculo por produto). NULL = usa a soma de produtos.comissao_afiliado × qtd.';
