-- ═══════════════════════════════════════════════════════════════════════════
-- PRESTADORES — central de pagamento por QUEM RECEBE (07/08/2026)
-- Migração `prestadores_servico_avulso`, APLICADA em produção.
--
-- A central agrega na TELA: montagem (lote), diária, serviço de oficina/SAC
-- cobrado à parte e — o que esta migração cria — o SERVIÇO AVULSO, aquele que
-- o prestador fez e não nasceu de módulo nenhum (antes ia direto pro caixa e
-- sumia do "a pagar": `manutencao-marcos-2026-08-04` R$ 1.266,20 e
-- `mautencoes realizadas marcos` R$ 208,52 são os casos reais).
--
-- `natureza` decide a categoria do lançamento e o tratamento na DRE:
--   montagem = entra no CPV da moto  → categoria 'Montagem'
--              (está em _DRE_CATEGORIAS_FORA_DESPESA — NÃO é despesa)
--   oficina  = despesa operacional   → categoria 'Oficina - Peças e Serviços'
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.prestador_servicos (
  id           uuid primary key default gen_random_uuid(),
  prestador_id uuid not null references public.montadores(id) on delete cascade,
  data         date not null,
  descricao    text not null,
  valor        numeric not null check (valor > 0),
  natureza     text not null check (natureza in ('montagem','oficina')),
  observacoes  text,
  criado_em    timestamptz not null default now()
);

create index if not exists idx_prestador_servicos_prestador
  on public.prestador_servicos (prestador_id, data desc);

alter table public.prestador_servicos enable row level security;

-- Pagar terceirizado é financeiro. Usar `tem_modulo('financeiro')` (em vez de
-- um módulo novo) evita ter que manter TODOS_MODULOS/PERFIS_DEFAULT_MODULOS no
-- front e o ramo da função tem_modulo no banco em sincronia pra sempre.
drop policy if exists acesso_total on public.prestador_servicos;
create policy acesso_total on public.prestador_servicos
  for all to authenticated
  using (public.tem_modulo('financeiro'))
  with check (public.tem_modulo('financeiro'));

-- A baixa do avulso reusa `oficina_pagamentos` (mesma mecânica de lançamento
-- agregado e de estorno). O CHECK de origem única passa de 3 pra 4 opções — é
-- um SUPERSET: nenhuma linha existente viola (todas têm exatamente uma das três
-- e `servico_avulso_id` nasce NULL). Verificado antes e depois: 0 violações.
alter table public.oficina_pagamentos
  add column if not exists servico_avulso_id uuid
  references public.prestador_servicos(id) on delete cascade;

alter table public.oficina_pagamentos drop constraint if exists oficina_pagamentos_origem_unica;
alter table public.oficina_pagamentos add constraint oficina_pagamentos_origem_unica check (
  ( (case when ordem_id          is not null then 1 else 0 end)
  + (case when sac_caso_id       is not null then 1 else 0 end)
  + (case when diaria_id         is not null then 1 else 0 end)
  + (case when servico_avulso_id is not null then 1 else 0 end) ) = 1
);

-- ⚠️ Consequência no FRONT (já tratada): um lançamento agora pode agregar
-- pagamentos das DUAS tabelas de baixa (um lote em `montagens_pagamentos` e um
-- avulso de natureza 'montagem' em `oficina_pagamentos`). Por isso o estorno
-- conta irmãos nas duas via `_pagIrmaosLancamento()` — nos três pontos:
-- `_prestEstornar`, `_ofEstornarPagamento` e `_montagensCancelarPagamento`.
