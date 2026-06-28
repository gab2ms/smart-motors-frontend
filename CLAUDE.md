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

**⚠️ PROBLEMA ATIVO (confirmado 28/06):** o textmebot retorna `recipient disconnected` para o número do Gabriel (+5521997507738) — **confirmado com envio único** (não é rate limit). O sender/bot é **+5521965107705**. Como Railway e app usam o MESMO número/key, **os dois pararam de entregar** (o dono não recebeu o resumo de hoje). **Ação necessária (no textmebot, não no código):** reconectar o número do Gabriel — abrir o WhatsApp dele, mandar a mensagem de ativação pro bot **+5521965107705** (mesmo procedimento da configuração inicial), ou checar o painel via `status.php?apikey=<a key do cadastro do destinatário>`. Depois disso os automáticos voltam.

## Segurança

Auditoria completa feita em **28/06/2026** (5 agentes de varredura + 3 arquitetos cruzando estratégia de RLS). Plano: `~/.claude/plans/quero-atacar-aquela-pendencia-serene-fox.md`. **Nota inicial: 2/10.**

### Estado das frentes
- **Frente 1 — quick wins (em validação local, 28/06/2026):** ver Histórico abaixo. Não fecha o risco crítico.
- **Frente 2 — RLS + Auth (pendente, frente dedicada):** **risco nº 1 ainda aberto** — ~37 tabelas com policy `acesso_total USING(true)` deixam a anon key (pública no front) **ler/escrever/deletar quase todo o banco** (CPF de clientes, financeiro, senhas). **Estratégia decidida (cruzamento 3/3 arquitetos): Híbrido** = migrar para **Supabase Auth + RLS `to authenticated`** no app interno (os ~226 `sb.from()` continuam idênticos, muda só a camada de login) + manter Edge Functions com service_role nas superfícies públicas (portal-afiliado, NF-e). A opção "tudo via Edge Functions" foi descartada (reescreveria 235 call sites). Começar pelo **diagrama Excalidraw**. Itens ligados: fechar leitura anon de `usuarios` (hoje vaza hashes), `excluir_produto` SECURITY DEFINER executável por anon, trocar `hashSenha`/btoa por bcrypt do Supabase Auth.

### Pendências de infra (ação manual do dono)
- **"Site não seguro":** o GitHub Pages nunca provisionou o cert do domínio (apresenta `CN=*.github.io`). DNS já está correto. Corrigir em **Settings → Pages**: remover e re-adicionar `smartmotorsapp.com.br` (força reprovisionar o cert Let's Encrypt) e marcar **Enforce HTTPS**.
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
