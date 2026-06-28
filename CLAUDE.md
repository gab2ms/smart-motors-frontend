# CLAUDE.md

Instruções e contexto do projeto para o Claude Code.

## Comunicação

- **Responda SEMPRE em português do Brasil** — incluindo raciocínio, comentários de investigação, mensagens de status, resumos e qualquer texto exibido ao usuário. Nunca use inglês na comunicação comigo.

## Documentação de mudanças (IMPORTANTE)

- **Toda mudança relevante feita no sistema deve ser registrada neste arquivo**, na seção "Histórico de mudanças", para que o contexto não se perca entre sessões — sem precisar reexplicar manualmente o que já foi feito.
- Registrar: o que mudou, em quais arquivos, por quê, e o que ficou pendente. Converter datas relativas em absolutas.
- Validar no `localhost:8000` **antes** de cada push; push direto na `main` (GitHub Pages serve da `main`).

## Visão geral da arquitetura

- **Front-end:** `index.html` monolítico (~26k linhas, JS/CSS inline, sem build step) + `portal.html` (portal público do afiliado). Servidos via **GitHub Pages** no domínio `smartmotorsapp.com.br` (repo `gab2ms/smart-motors-frontend`, branch `main`).
- **Backend:** **Supabase** (Postgres + Edge Functions), projeto ref `sxmeuqlotjuchslevofv`. Edge Functions: `portal-afiliado` (token HMAC próprio), `gerar-resumo-os` (verify_jwt), rotas de NF-e. Há também um backend Node no **Railway** (`smartmotorsestoque-production.up.railway.app`) para estoque/NF-e.
- **Auth atual:** login caseiro client-side (lê a tabela `usuarios` via anon key; sessão em `localStorage` `sm_user`). **Sem Supabase Auth ainda** (migração prevista — ver Segurança / Frente 2).

## Segurança

Auditoria completa feita em **28/06/2026** (5 agentes de varredura + 3 arquitetos cruzando estratégia de RLS). Plano: `~/.claude/plans/quero-atacar-aquela-pendencia-serene-fox.md`. **Nota inicial: 2/10.**

### Estado das frentes
- **Frente 1 — quick wins (em validação local, 28/06/2026):** ver Histórico abaixo. Não fecha o risco crítico.
- **Frente 2 — RLS + Auth (pendente, frente dedicada):** **risco nº 1 ainda aberto** — ~37 tabelas com policy `acesso_total USING(true)` deixam a anon key (pública no front) **ler/escrever/deletar quase todo o banco** (CPF de clientes, financeiro, senhas). **Estratégia decidida (cruzamento 3/3 arquitetos): Híbrido** = migrar para **Supabase Auth + RLS `to authenticated`** no app interno (os ~226 `sb.from()` continuam idênticos, muda só a camada de login) + manter Edge Functions com service_role nas superfícies públicas (portal-afiliado, NF-e). A opção "tudo via Edge Functions" foi descartada (reescreveria 235 call sites). Começar pelo **diagrama Excalidraw**. Itens ligados: fechar leitura anon de `usuarios` (hoje vaza hashes), `excluir_produto` SECURITY DEFINER executável por anon, trocar `hashSenha`/btoa por bcrypt do Supabase Auth.

### Pendências de infra (ação manual do dono)
- **"Site não seguro":** o GitHub Pages nunca provisionou o cert do domínio (apresenta `CN=*.github.io`). DNS já está correto. Corrigir em **Settings → Pages**: remover e re-adicionar `smartmotorsapp.com.br` (força reprovisionar o cert Let's Encrypt) e marcar **Enforce HTTPS**.
- **Headers HTTP** (HSTS, X-Frame-Options, CSP completa) só com proxy/CDN (ex.: Cloudflare) na frente — GitHub Pages não envia headers. Hoje há só CSP parcial via `<meta>`.
- **WhatsApp/CallMeBot key** (`WA_APIKEY` no `index.html`): mover para Edge Function `wa-notify` + rotacionar a key (pendente; impacto real baixo — só envia msg pro número da loja).

## Histórico de mudanças

### 2026-06-28 — Auditoria de segurança, Frente 1 (quick wins)
Arquivos: `index.html`, `portal.html`, `.gitignore`, migração Supabase. **Em validação local antes do push.**
- **Senhas hardcoded removidas do fonte** (`index.html`): removido o bypass de login com senha em texto puro `Ma49721106`; senha de reset fixa `smartmotors123` trocada por aleatória (`_senhaAleatoria()`); `garantirAdmin` gera senha aleatória em vez de fixa. *(A senha do admin no banco não muda só com isso, e segue extraível enquanto `usuarios` for legível pela anon — fechamento real na Frente 2.)*
- **Logs com PII silenciados** (`index.html`): não loga mais `sm_user` completo, email do usuário nem lista de emails (`aplicarPermissoes`, `initLogin`, `renderAdmin`, `criarConta`).
- **Libs CDN fixadas + SRI** (`index.html`): `@supabase/supabase-js` fixado em `2.108.2` (era `@2` flutuante) e `xlsx-js-style@1.2.0`, ambos com `integrity` (SRI) + `crossorigin`.
- **CSP via `<meta>`** adicionada em `index.html` e `portal.html` (allowlist de origens; `'unsafe-inline'` necessário pois o JS é inline — valor parcial).
- **`.gitignore`** reforçado: `*.bak`, `sim_*.js`, `dre_baseline_*.json`, `supabase/.temp/`, `*.local.json`, `.env*`.
- **Hardening SQL** (migração `harden_function_search_path`, **aplicada em produção**): `SET search_path = public` em `apagar_movimento`, `fn_conta_to_parcela`, `fn_parcela_to_conta`, `registrar_movimento`, `vendas_por_produto` (neutro; advisor `function_search_path_mutable` zerado).
