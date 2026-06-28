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

## Integrações de WhatsApp (mapa — investigado 2026-06-28)

Há **dois disparadores** que usam a **mesma API (textmebot)** e a **mesma tabela** `whatsapp_destinatarios` (cada destinatário tem `numero` + `api_key`). NÃO são integrações concorrentes com keys diferentes — bebem da mesma fonte:

1. **Railway `resumoWhatsapp.js`** (cron 8h/20h) — manda os **resumos automáticos**. Lê `whatsapp_destinatarios` e envia com `d.api_key` (`resumoWhatsapp.js:615,627`), respeitando `TEXTMEBOT_DELAY_MS = 8000` (8s entre envios, pra não bater no rate limit). **É a que FUNCIONA** (o dono recebe manhã/noite).
2. **App `index.html`** (disparo manual + notificações de evento: conta vencida, OS pronta, SAC, prévia, teste) — desde 2026-06-28 envia via Edge Function `wa-notify`, que resolve a key na **mesma tabela**. Antes usava a key `6372158` **hardcoded** no front, que é **INVÁLIDA** ("Invalid Premium APIkey" — CallMeBot/era antiga). Essa key morta foi removida; é a "integração desativada cujo registro continuava" mencionada pelo dono.

**Conclusão:** key boa = a de `whatsapp_destinatarios` (textmebot premium, usada pelo Railway). Key `6372158` = lixo legado (removida). O app agora usa a key certa.

**Incidente resolvido (28/06):** envio falhou (status 411) porque o **WhatsApp REMETENTE +5521965107705** (vinculado ao textmebot premium via QR, como um WhatsApp Web) estava **"DB Status: Disconnected"**. Não era o destinatário nem rate limit. Como Railway e app usam o mesmo remetente, os dois pararam juntos. **Resolvido revinculando via QR** e confirmado com envio real (`Result: Success!`).

**Como religar se cair de novo (no celular do remetente +5521965107705):** abrir `https://api.textmebot.com/status.php?apikey=<API_KEY_DO_CADASTRO_em_whatsapp_destinatarios>` no navegador → aparece um QR code → no WhatsApp do +5521965107705: Configurações → Dispositivos conectados → Conectar um aparelho → escanear o QR (some quando "DB Status: Connected"). O link de status contém a apikey da conta — não compartilhar. **Recomendado:** ativar "Add Notification" nessa página pra avisar quando cair.

## Segurança

Auditoria completa feita em **28/06/2026** (5 agentes de varredura + 3 arquitetos cruzando estratégia de RLS). Plano: `~/.claude/plans/quero-atacar-aquela-pendencia-serene-fox.md`. **Nota inicial: 2/10.**

### Estado das frentes
- **Frente 1 — quick wins (em validação local, 28/06/2026):** ver Histórico abaixo. Não fecha o risco crítico.
- **Frente 2 — RLS + Auth (EM ANDAMENTO, frente dedicada):** **risco nº 1 ainda aberto** — ~37 tabelas com policy `acesso_total USING(true)` deixam a anon key (pública no front) **ler/escrever/deletar quase todo o banco** (CPF de clientes, financeiro, senhas). **Estratégia decidida (cruzamento 3/3 arquitetos): Híbrido** = migrar para **Supabase Auth + RLS `to authenticated`** no app interno (os ~226 `sb.from()` continuam idênticos, muda só a camada de login) + manter Edge Functions com service_role nas superfícies públicas (portal-afiliado, NF-e). Diagrama: excalidraw.com/#json=QzgiC-YiRyduoIBmQm7CZ,w2JwLZlXV3zXlPHQD2eeRA.
  - **Decisões (28/06):** RLS = "qualquer logado acessa" (`to authenticated`), sem granular por perfil agora. Senhas: provisória + troca no 1º login. Reaproveitar a tabela `usuarios` (não criar `profiles`) + coluna `auth_uid` vinculando ao `auth.users`. Os 7 usuários têm email real; `auth.users` estava zerado.
  - **Progresso:** ✅ Fase 0 (search_path) · ✅ Fase 1 (coluna `usuarios.auth_uid`, migração `frente2_usuarios_auth_uid`) · ✅ Fase 2 (Edge Function `admin-usuarios` deployada, verify_jwt=false, inerte/protegida — seed exige token em `_admin_setup` (migração `frente2_admin_setup_control`) e só roda com Auth vazio; demais ações exigem admin logado). Arquivo: `supabase/functions/admin-usuarios/index.ts` (ainda NÃO commitado). Próximas: login no front (Fase 3, = início do cutover), flip RLS (Fase 5).
  - ✅ **Fase 3 ESCRITA (login no front) — NO WORKING TREE, NÃO COMMITADA, NÃO EM PRODUÇÃO.** `index.html` local: `initLogin`/`fazerLogin`/`fazerLogout` agora usam Supabase Auth (`getSession`/`signInWithPassword`/`signOut`); helpers `_carregarPerfilLogado`/`_aplicarSessao`/`_mostrarLogin`; modal `abrirTrocarSenha`/`confirmarTrocarSenha` (força troca no 1º acesso via `user_metadata.must_change`); `criarConta`/`resetSenha` agora orientam procurar o admin (cadastro centralizado); RPC `resolver_email_login` permite login por nome. Validado no localhost: boot ok, tela de login aparece, RPC resolve nome→email, login inválido rejeitado. **Falta o teste e2e (login real), que só roda com auth.users = é o cutover.**
  - ✅ **Seed rodado (28/06): os 7 `auth.users` JÁ existem e estão vinculados (`usuarios.auth_uid`).** Vários têm email SINTÉTICO (`@smartmotors.internal` — michelle/Eduardo/Henrique/Samuel/Rafael), então login DELES é só por NOME (a RPC `resolver_email_login` resolve). Gabriel e Marcos Moisés têm email real. Senhas provisórias entregues ao dono pra teste local; `must_change=true` força troca no 1º acesso. **Como já existem, NÃO rodar o seed de novo no cutover** (vai bloquear por Auth não-vazio) — usar `admin-usuarios {acao:reset}` (admin logado) se precisar regenerar senha.
  - ✅ **Login novo validado pelo dono no localhost (28/06): login + modal de troca de senha + navegação OK.** Falta só o cutover (push + flip RLS).
  - **⛔ NÃO DAR PUSH do `index.html` antes do cutover** — em produção não há `auth.users` ainda, então o login novo deixaria todos pra fora. A produção atual (commit f42bfbd) tem o login caseiro e está intacta; as mudanças de banco (coluna, RPC, função, `_admin_setup`) são inertes.
  - **No dia do cutover, ordem:** (1) `insert into _admin_setup(id,token) values(1,'<token>') on conflict ...`; (2) chamar `admin-usuarios {acao:seed, token}` → cria os 7 auth.users + devolve senhas provisórias; (3) avisar dono → mensagem no grupo + senhas; (4) push do `index.html` com login novo; (5) flip RLS `to authenticated`; (6) `excluir_produto` revoke + vitrine pública; (7) testar todos logando + troca de senha.
  - **⚠️ PROTOCOLO DO CUTOVER (login novo):** NÃO virar a chave de surpresa. Antes do push do login novo: (1) avisar o dono pra mandar a mensagem de pré-aviso no grupo do WhatsApp (texto pronto: pré-aviso de troca de senha, "é normal/previsto, mando a provisória antes"); (2) gerar e entregar as senhas provisórias dos 7; (3) escolher horário tranquilo (NÃO no pico da manhã). Enquanto o cutover não acontece, login segue 100% igual pros funcionários.
  - Itens ligados: fechar leitura anon de `usuarios` (hoje vaza hashes), `excluir_produto` SECURITY DEFINER executável por anon, trocar `hashSenha`/btoa por bcrypt do Supabase Auth.

### Pendências de infra (ação manual do dono)
- **"Site não seguro":** ✅ RESOLVIDO 28/06. O GitHub Pages não tinha provisionado o cert do domínio (servia `CN=*.github.io`). Corrigido em **Settings → Pages**: Remove + re-add de `smartmotorsapp.com.br` forçou a emissão do cert Let's Encrypt (`CN=smartmotorsapp.com.br`, válido até 26/set) e **Enforce HTTPS** foi ligado. Confirmado: handshake `ssl_verify=0` e HTTP→HTTPS `301`. Se cair de novo no futuro, repetir o Remove+re-add.
- **Headers HTTP** (HSTS, X-Frame-Options, CSP completa) só com proxy/CDN (ex.: Cloudflare) na frente — GitHub Pages não envia headers. Hoje há só CSP parcial via `<meta>`.
- **WhatsApp/CallMeBot key:** ✅ movida pra Edge Function `wa-notify` (key fora do front). Pendência opcional: rotacionar a key no CallMeBot e (se quiser fallback) setar os secrets `WA_APIKEY`/`WA_NUMBER` na função.

## Histórico de mudanças

### 2026-06-28 — Auditoria de segurança, Frente 1 (quick wins)
Arquivos: `index.html`, `portal.html`, `.gitignore`, migração Supabase. **Em validação local antes do push.**
- **Senhas hardcoded removidas do fonte** (`index.html`): removido o bypass de login com senha em texto puro `Ma49721106`; senha de reset fixa `smartmotors123` trocada por aleatória (`_senhaAleatoria()`); `garantirAdmin` gera senha aleatória em vez de fixa. *(A senha do admin no banco não muda só com isso, e segue extraível enquanto `usuarios` for legível pela anon — fechamento real na Frente 2.)*
- **Logs com PII silenciados** (`index.html`): não loga mais `sm_user` completo, email do usuário nem lista de emails (`aplicarPermissoes`, `initLogin`, `renderAdmin`, `criarConta`).
- **Libs CDN fixadas + SRI** (`index.html`): `@supabase/supabase-js` fixado em `2.108.2` (era `@2` flutuante) e `xlsx-js-style@1.2.0`, ambos com `integrity` (SRI) + `crossorigin`.
- **CSP via `<meta>`** adicionada em `index.html` e `portal.html` (allowlist de origens; `'unsafe-inline'` necessário pois o JS é inline — valor parcial).
- **`.gitignore`** reforçado: `*.bak`, `sim_*.js`, `dre_baseline_*.json`, `supabase/.temp/`, `*.local.json`, `.env*`.
- **Hardening SQL** (migração `harden_function_search_path`, **aplicada em produção**): `SET search_path = public` em `apagar_movimento`, `fn_conta_to_parcela`, `fn_parcela_to_conta`, `registrar_movimento`, `vendas_por_produto` (neutro; advisor `function_search_path_mutable` zerado).

### 2026-06-28 — WhatsApp: key fora do front (Edge Function `wa-notify`)
Arquivos: `supabase/functions/wa-notify/index.ts` (nova, **deployada**, verify_jwt=true), `index.html`. **Em validação local antes do push.**
- Removidas as constantes `WA_APIKEY`/`WA_API_URL` do `index.html` (a `WA_APIKEY` era a única key hardcoded; `WA_NUMBER` foi mantida — é só telefone).
- `_enviarWhatsAppRaw` agora chama `sb.functions.invoke('wa-notify', { body:{ numero, mensagem, apiKey? } })`; a função resolve a key server-side (body do "teste" → tabela `whatsapp_destinatarios` → secret opcional) e dispara o envio. Passou a retornar o status real do textmebot (antes era `no-cors`, sempre true).
- Healthcheck `__ping__` (não envia zap) testado: sem JWT → 401, com anon key → 200, e via front (`sb.functions.invoke`) → ok.
- **Descoberta (ver "Integrações de WhatsApp"):** a key `6372158` que estava hardcoded no app é INVÁLIDA; a key boa é a de `whatsapp_destinatarios` (mesma do Railway). A migração alinhou o app à key certa. O `no-cors` antigo mascarava tudo (app dizia "enviado" sem entregar). Erro `recipient disconnected` no teste manual = provável rajada sem o delay de 8s.
- **v2 da função:** sanitiza a resposta do textmebot (mascara `apikey=***` e remove HTML) — o HTML de erro do serviço ecoava uma apikey, que não deve voltar ao front.
