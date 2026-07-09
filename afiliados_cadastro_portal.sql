-- Auto-cadastro de afiliados pelo portal (campanha de captação) + fluxo de aprovação.
-- Aplicado no Supabase via migration "afiliados_cadastro_portal" (08/07/2026).
--
-- Fluxo: a pessoa acessa portal.html → "Quero ser afiliado" → preenche dados + aceita
-- o termo de uso → a Edge Function portal-afiliado (?acao=cadastro, service_role) insere
-- um afiliado com status='pendente', ativo=false, criado_via='portal'. Na aba "Afiliados"
-- do sistema, o admin Aprova (status='aprovado', ativo=true) ou Rejeita. Só afiliado
-- aprovado + ativo consegue logar no portal (login continua sem senha: nome/e-mail + telefone).
--
-- CPF reusa a coluna existente `documento`; chave PIX reusa `chave_pix`; e-mail reusa `email`.

alter table public.afiliados
  add column if not exists status text not null default 'aprovado',
  add column if not exists cidade text,
  add column if not exists uf text,
  add column if not exists instagram text,
  add column if not exists termo_aceito boolean not null default false,
  add column if not exists termo_aceito_em timestamptz,
  add column if not exists termo_versao text,
  add column if not exists criado_via text not null default 'admin';

do $$ begin
  alter table public.afiliados
    add constraint afiliados_status_chk check (status in ('pendente','aprovado','rejeitado'));
exception when duplicate_object then null; end $$;

comment on column public.afiliados.status is 'pendente = auto-cadastro do portal aguardando aprovação; aprovado = liberado pra logar; rejeitado. Login exige aprovado + ativo.';
comment on column public.afiliados.criado_via is 'admin = cadastrado no painel; portal = auto-cadastro pela campanha (aguarda aprovação).';
comment on column public.afiliados.documento is 'CPF/documento do afiliado (coletado no auto-cadastro do portal).';
