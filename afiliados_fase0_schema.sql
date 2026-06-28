-- ═══════════════════════════════════════════════════════════
-- Módulo de Afiliados — Fase 0 (schema)
-- Afiliados externos que vendem produtos e ganham comissão por venda.
-- Aplicado no Supabase via migration "afiliados_modulo_fase0".
-- Tudo aditivo (não altera nada do que já roda).
-- ═══════════════════════════════════════════════════════════

-- 1) Tabela de afiliados (espelha montadores/parceiros)
create table if not exists public.afiliados (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  documento text,        -- CPF/CNPJ (opcional, p/ pagamento)
  chave_pix text,        -- facilita o pagamento
  ativo boolean not null default true,
  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table public.afiliados is 'Afiliados externos que vendem produtos e recebem comissão por venda.';

-- RLS no mesmo padrão aberto das demais tabelas públicas (anon key, sem Supabase Auth).
-- (Pendência de segurança rastreada à parte — iguala o padrão existente, não é regressão.)
alter table public.afiliados enable row level security;
drop policy if exists acesso_total on public.afiliados;
create policy acesso_total on public.afiliados for all using (true) with check (true);

-- 2) Comissão de afiliado por produto (R$ por unidade, global p/ todos, editável)
alter table public.produtos add column if not exists comissao_afiliado numeric;
comment on column public.produtos.comissao_afiliado is 'Comissão de afiliado em R$ por unidade vendida deste produto.';

-- 3) Atribuição da venda ao afiliado
alter table public.pdv_pedidos add column if not exists afiliado_id uuid references public.afiliados(id);
comment on column public.pdv_pedidos.afiliado_id is 'Afiliado que originou a venda (quando local de venda = Afiliado).';

-- 4) Pagamento mensal via Contas a Pagar (tag p/ idempotência e leitura de status)
alter table public.contas_pagar add column if not exists afiliado_id uuid references public.afiliados(id);
alter table public.contas_pagar add column if not exists comissao_competencia text;
comment on column public.contas_pagar.comissao_competencia is 'Competência (YYYY-MM) quando a conta é o fechamento mensal de comissão de um afiliado.';

create index if not exists idx_pdv_pedidos_afiliado_id on public.pdv_pedidos(afiliado_id);
create index if not exists idx_contas_pagar_afiliado on public.contas_pagar(afiliado_id, comissao_competencia);
