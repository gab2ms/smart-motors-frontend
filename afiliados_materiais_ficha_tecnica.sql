-- ═══════════════════════════════════════════════════════════
-- Painel de Afiliados — ficha técnica, preço sugerido e banco de materiais
-- Aplicado no Supabase via migration "afiliados_materiais_ficha_tecnica" (08/07/2026).
-- Tudo aditivo (não altera nada do que já roda).
-- ═══════════════════════════════════════════════════════════

-- 1) Conteúdo comercial por modelo (texto livre, copiado literalmente no portal)
alter table public.produtos_precos add column if not exists preco_sugerido_afiliado numeric;
alter table public.produtos_precos add column if not exists ficha_tecnica text;
alter table public.produtos_precos add column if not exists condicoes_pagamento text;
comment on column public.produtos_precos.preco_sugerido_afiliado is 'Preço sugerido de anúncio do afiliado. NULL = automático (preço mínimo + delta derivado do teto de comissão).';
comment on column public.produtos_precos.ficha_tecnica is 'Bloco de texto da ficha técnica exibido/copiado no portal do afiliado (formato livre).';
comment on column public.produtos_precos.condicoes_pagamento is 'Bloco de texto das formas de pagamento exibido/copiado no portal do afiliado.';

-- 2) Materiais comerciais (imagens oficiais e arquivos) por modelo
create table if not exists public.afiliados_materiais (
  id uuid primary key default gen_random_uuid(),
  produto_precos_id uuid references public.produtos_precos(id),
  tipo text not null check (tipo in ('imagem','arquivo')),
  titulo text,
  arquivo_path text not null,
  arquivo_nome text,
  mime text,
  tamanho bigint,
  ordem integer not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
comment on table public.afiliados_materiais is 'Materiais comerciais do portal do afiliado (imagens oficiais e arquivos por modelo). produto_precos_id NULL = material geral da loja.';
create index if not exists idx_afiliados_materiais_modelo on public.afiliados_materiais(produto_precos_id);

alter table public.afiliados_materiais enable row level security;
drop policy if exists acesso_por_modulo on public.afiliados_materiais;
create policy acesso_por_modulo on public.afiliados_materiais
  for all to authenticated
  using (public.tem_modulo('afiliados'))
  with check (public.tem_modulo('afiliados'));

-- 3) Bucket privado (portal só recebe signed URL via Edge Function service_role)
insert into storage.buckets (id, name, public, file_size_limit)
values ('afiliados-materiais', 'afiliados-materiais', false, 52428800)
on conflict (id) do nothing;

drop policy if exists afiliados_materiais_select on storage.objects;
create policy afiliados_materiais_select on storage.objects for select to authenticated
  using (bucket_id = 'afiliados-materiais' and public.tem_modulo('afiliados'));
drop policy if exists afiliados_materiais_insert on storage.objects;
create policy afiliados_materiais_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'afiliados-materiais' and public.tem_modulo('afiliados'));
drop policy if exists afiliados_materiais_update on storage.objects;
create policy afiliados_materiais_update on storage.objects for update to authenticated
  using (bucket_id = 'afiliados-materiais' and public.tem_modulo('afiliados'))
  with check (bucket_id = 'afiliados-materiais' and public.tem_modulo('afiliados'));
drop policy if exists afiliados_materiais_delete on storage.objects;
create policy afiliados_materiais_delete on storage.objects for delete to authenticated
  using (bucket_id = 'afiliados-materiais' and public.tem_modulo('afiliados'));

-- 4) Teto de comissão do afiliado (R$ 500 decidido em 07/07/2026).
--    Delta do preço sugerido automático = (teto − base) / incremento × passo.
insert into public.config_custos (chave, valor, descricao)
values ('afiliado_comissao_teto', 500, 'Teto da comissão escalonada do afiliado (R$). Vazio/NULL = sem teto.')
on conflict (chave) do nothing;
