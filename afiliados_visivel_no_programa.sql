-- Programa de afiliados: seleção de quais produtos aparecem no portal.
-- Aplicado no Supabase via migration "afiliados_visivel_no_programa" (08/07/2026).
--
-- Antes: o portal mostrava TODO produto de categoria scooter/motoneta/triciclo com estoque.
-- Agora: o admin escolhe explicitamente quais produtos entram no programa (aba
-- "Produtos & materiais" do módulo Afiliados). Só produtos com visivel_afiliado = true
-- aparecem na vitrine do portal — independente da categoria (permite liberar acessórios).
-- Default = false → tudo começa oculto; o preenchimento (preço mínimo, ficha técnica,
-- formas de pagamento, imagens) só é cobrado dos produtos selecionados.

alter table public.produtos_precos
  add column if not exists visivel_afiliado boolean not null default false;

comment on column public.produtos_precos.visivel_afiliado is
  'Produto participa do programa de afiliados. true = aparece na vitrine do portal do afiliado (qualquer categoria, inclusive acessorio); false (default) = fora do programa. Seleção manual pelo admin na aba Produtos & materiais.';
