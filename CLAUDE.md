# CLAUDE.md

Instruções e contexto do projeto Smart Motors para o Claude Code.
Organizado **por assunto** — cada seção traz o **estado atual** daquele tema, pra puxar o contexto rápido quando a gente entrar nele. Mudanças novas: atualizar a seção do assunto + 1 linha no Histórico (no fim).

## Comunicação
- **Responda SEMPRE em português do Brasil** — raciocínio, comentários, status, resumos, tudo. Nunca inglês.

## Como trabalhar neste projeto (processo)
- **Documentar toda mudança importante AQUI**, na seção do **assunto** correspondente (e 1 linha no Histórico). O objetivo é não reexplicar contexto: ao entrar num tema, leio a seção dele.
- **Validar no `localhost:8000` antes de push.** Push direto na `main` (GitHub Pages serve da `main`). Servidor local: `python3 -m http.server 8000`.
- Converter datas relativas em absolutas. Mudanças de banco = migração nomeada (Supabase).

## Arquitetura (visão geral)
- **Front-end:** `index.html` monolítico (~26k linhas, JS/CSS inline, sem build) + `portal.html` (portal público do afiliado). **GitHub Pages**, domínio `smartmotorsapp.com.br`, repo `gab2ms/smart-motors-frontend`, branch `main`.
- **Backend:** **Supabase** (Postgres + Edge Functions), ref `sxmeuqlotjuchslevofv`. + backend Node no **Railway** (`smartmotorsestoque-production.up.railway.app`) p/ estoque, NF-e e resumos de WhatsApp.
- **Auth:** **Supabase Auth** (migrado em 28/06/2026). Detalhes em "Autenticação & Permissões".
- **Organização local das pastas (reorg 29/06/2026):** tudo do projeto vive em `~/projetos/Smart Motors/` (junto dos outros projetos do dono — `finapp`, `vida-pratika`): `frontend/` (este repo) · `backend/` (repo `smartmotorsestoque`, Railway) · `documentos/` (docs de negócio) · `arquivo/` (prints de auditoria antiga + protótipo velho do backend, descartáveis). São **2 repos git independentes** — `frontend` e `backend` — só agrupados na mesma pasta-mãe. Caminhos antigos (`~/smart-motors-app`, `~/smartmotorsestoque`) não existem mais.

---

## Autenticação & Permissões
- **Login:** Supabase Auth (`signInWithPassword`). Aceita **e-mail OU nome** — login por nome usa a RPC `resolver_email_login(p_ident)` (resolve nome→email mesmo sem estar logado). Sessão gerenciada pelo supabase-js (`getSession`/`onAuthStateChange`). Código: `index.html` `initLogin`/`fazerLogin`/`fazerLogout` + helpers `_carregarPerfilLogado`/`_aplicarSessao`.
- **Usuários:** tabela `public.usuarios` (perfil/role/status/`modulos_permitidos`) vinculada ao `auth.users` pela coluna `auth_uid`. Vários têm **e-mail sintético** (`@smartmotors.internal`) → logam **só por nome**. Gabriel e Marcos Moisés têm e-mail real.
- **Perfis:** `admin` (vê tudo), `operacional` (lista fixa, inclui financeiro/custos), `customizado` (usa `modulos_permitidos`). Os "vendedores" (Henrique, Rafael, Samuel) são `customizado` SEM financeiro/custos. Michelle é `customizado` + `contas-receber`.
- **1º acesso:** senha provisória com `must_change=true` → o app força criar senha nova (modal `abrirTrocarSenha`).
- **Gestão de usuários (criar/aprovar/bloquear/resetar senha):** Edge Function `admin-usuarios` (service_role). Ações exigem **admin logado**; o `seed` inicial (já usado) exige token em `_admin_setup` e só roda com Auth vazio. `criarConta`/`resetSenha` no app agora orientam procurar o admin (cadastro centralizado).
- **Permissão por perfil:** vale na **tela** (menus, via `modulosPermitidos`) **e no banco** (RLS por perfil — ver "Segurança"). Mudar os módulos de alguém ajusta os dois automaticamente.
- **Ocultação de KPIs por perfil (granular, 28/06):** princípio = esconder o KPI/campo específico, não a tela toda. Helpers no front `_temModulo(mod)` / `_podeVerCusto()` (= tem `custos`/`custos-produtos`/`precos`/`financeiro`) + classe CSS `.js-custo` escondida via `body.sem-kpi-custo` (setada em `_aplicarSessao`). Esconde **custo/margem/lucro** de quem não tem o módulo, DENTRO de telas que ele acessa: **Estoque** (lista de Cadastros: colunas Custo/MC R$/MC % + Modal Produto: bloco Custos), **aba Vendas** (Lucro/MC%/Custo Fixo), **Oficina/SAC** (custo mão de obra/peças + Custo/Lucro do resumo), **Montagens** (coluna Preço + total do modal). Receita/preço de venda/ticket continuam visíveis. Validado: vendedor `body.sem-kpi-custo` ativo, operacional/admin não. **Em validação local (não commitado).**

## Segurança
**Estado: ~8–9/10** (era 2/10 antes da auditoria de 28/06/2026). Plano original: `~/.claude/plans/quero-atacar-aquela-pendencia-serene-fox.md`.

**Fechado:**
- **HTTPS/cert** do domínio (cadeado ok) · **segredos fora do front** (senhas, WhatsApp key) · **SRI** nas libs CDN · **CSP** parcial via `<meta>` · `search_path` nas funções.
- **Banco fechado pra anon:** as ~38 policies `acesso_total` foram de `{public/anon}` → `{authenticated}`. A chave pública (anon) **não lê mais nada** (validado: anon=0, logado=normal). `excluir_produto` revogado de anon/public.
- **Login real:** Supabase Auth (senhas em bcrypt, não mais base64); hashes antigos apagados de `usuarios`; **Leaked Password Protection** ligado no painel.
- **RLS por perfil:** função `tem_modulo(modulo)` espelha `modulosPermitidos`. Tabelas financeiras (`contas_bancarias`, `lancamentos`, `emprestimo`, `emprestimo_parcelas`, `categorias_lancamento`, `montagens_pagamentos`) exigem `financeiro`; `custos_fixos`→`custos`; `contas_pagar`→`contas-pagar`; `contas_receber`→`contas-receber`. `config_custos` e `produtos_precos` ficam liberados p/ quem tem `vendas` (cálculo de lucro). Vendedor não acessa financeiro nem pelo console.
- **Reverter RLS** se algo quebrar: `alter policy acesso_total on <tabela> using (true) with check (true);` (volta ao aberto-pra-logado).

**Pendências (opcionais, não-críticas):** rate-limit no login do `portal-afiliado` (anti-força-bruta) · rotacionar a anon key (baixo risco agora) · **Cloudflare** na frente p/ headers HTTP fortes (HSTS, X-Frame-Options, CSP completa — GitHub Pages não envia headers) · revisar XSS (`innerHTML` sem `escHtml` em alguns pontos).

## WhatsApp / Notificações
- **Provedor:** textmebot (premium). A key boa fica na tabela `whatsapp_destinatarios` (`numero` + `api_key`). O **remetente** é o WhatsApp `+5521965107705` (vinculado via QR, tipo WhatsApp Web).
- **Dois disparadores, mesma fonte:**
  1. **Railway `resumoWhatsapp.js`** (cron 8h/20h) — resumos automáticos; espera 8s entre envios.
  2. **App** (avisos de evento: conta vencendo, OS pronta, SAC; prévia; teste) — via Edge Function **`wa-notify`** (key resolvida no servidor; nunca no front).
- **Dedup no servidor:** `wa-notify` grava `wa_dedup(chave = numero|dia|mensagem)` e recusa repetição — a mesma msg/numero/dia sai 1x só (não importa quantos navegadores disparem). `__ping__` = healthcheck (não envia/dedup).
- **Se parar de chegar (remetente desconectado):** abrir `https://api.textmebot.com/status.php?apikey=<api_key do cadastro>` → escanear o QR no WhatsApp do `+5521965107705` (Config → Dispositivos conectados → Conectar aparelho). O link tem a key — não compartilhar. Vale ativar "Add Notification" lá pra avisar quando cair.

## Infra / Deploy
- **GitHub Pages** serve da `main`. Arquivo `CNAME` = `smartmotorsapp.com.br` (não remover).
- **Cert HTTPS:** resolvido (Let's Encrypt, `CN=smartmotorsapp.com.br`). Se cair, em **Settings → Pages**: Remove + re-add do domínio força reemissão; depois marcar **Enforce HTTPS**.
- **Headers HTTP fortes:** só com proxy/CDN (ex.: Cloudflare) na frente — Pages não envia headers (hoje só CSP via `<meta>`).
- **Supabase CLI** linkado (deploy de Edge Function: `supabase functions deploy <nome> --project-ref sxmeuqlotjuchslevofv`).

## Banco (Supabase — ref `sxmeuqlotjuchslevofv`)
- **Edge Functions:** `admin-usuarios` (gestão de usuários, service_role), `wa-notify` (WhatsApp, verify_jwt), `portal-afiliado` (token HMAC próprio), `gerar-resumo-os` (verify_jwt). NF-e via Railway/service_role.
- **Tabelas de controle:** `_admin_setup` (token do seed), `wa_dedup` (dedup WhatsApp) — ambas trancadas (só service_role).
- **Funções de apoio a RLS:** `tem_modulo(text)`, `resolver_email_login(text)` (SECURITY DEFINER).
- **Migrações aplicadas (28/06):** `harden_function_search_path`, `frente2_usuarios_auth_uid`, `frente2_admin_setup_control`, `frente2_resolver_email_login`, `frente2_flip_rls_to_authenticated`, `frente2_excluir_produto_so_authenticated`, `frente2_func_tem_modulo`, `frente2_rls_por_perfil`, `frente2_config_custos_libera_vendas`, `wa_dedup_servidor`, `rls_afiliados_por_modulo`.
- **Check-up de permissões dos vendedores (28/06):** ver "Autenticação & Permissões" → ocultação de KPIs. Bug corrigido: delete de cliente checava `perfil==='vendedor'` (nunca disparava p/ os vendedores `customizado`) → agora só admin/operacional. `afiliados` fechado no banco (`rls_afiliados_por_modulo`). **Pendente (P2, adiado):** custo via console (`produtos_precos`/`estoque_unidades`), comissão em `pdv_vendedores` (precisa column-level — não dá p/ bloquear a tabela, o PDV usa), e mascarar CPF/LGPD.
- `backup_*` e `notas_fiscais`: RLS ligado sem policy (default-deny); NF-e usa service_role.

---

## Bugs conhecidos / QA (auditoria 4 agentes, 28/06)

### Ocultação de KPIs — ✅ COMPLETADA (2ª passada 28/06, em validação local)
A 2ª passada cobriu todos os pontos abaixo: Montagens (lista: card montador padrão/Enviado, totais por lote/montador/órfãos, coluna Preço, histórico, linha "pago", barra de seleção; botões Pagar/Imprimir; guards em `abrirMontagemPagarModal`/`_montPagarSelecionados`/`imprimirMontagemOS`/`abrirMontadorModal`) + KPIs de Montagens; Oficina/SAC (KPIs lucro/custo, lista, modal SAC + `sacRecalcResumo`); Estoque (botão "Atualizar custo" + guard em `catCustoLote`); `cliExcluir` agora cobre 'customizado'; Dashboard alinhado a `_podeVerCusto()` (operacional volta a ver os widgets financeiros). Validado: vendedor navega sem erro e 0 KPIs sensíveis visíveis; operacional/admin veem tudo. Referência dos pontos originais que estavam abertos:
- **Montagens**: a LISTA de lotes (`renderMontagens` ~17520-17789: preços, "Enviado", "Total a pagar", coluna Preço, histórico de pagamentos, totais por montador), os KPIs (`renderMontagensKpis` ~17852-17853), o modal **Pagar** (`abrirMontagemPagarModal` ~18298-18321), a **impressão** (`imprimirMontagemOS` ~18148/18185, abre em `window.open` — CSS `js-custo` não aplica lá) e `abrirMontadorModal` (~18482 preço padrão) NÃO estão protegidos. (Só o modal de criação de lote foi coberto.)
- **Oficina/SAC**: KPIs do painel (`renderOficinaSacKpis` ~22964/22969 lucro/custo), a lista (`renderOficinaSac` ~23037/23041), e o **modal SAC** (`abrirSacModal` ~23185-23189 mão de obra/peças; `sacRecalcResumo` ~23286 custo) NÃO protegidos. (O modal de OS foi; o de SAC ficou — assimetria.)
- **Estoque**: botão "Atualizar custo" em massa (`catCustoLote` ~10169) revela custo no prompt — sem `js-custo`.
- **Montagens — botão "Pagar lote"** (~17654): aparece p/ vendedor mas a escrita é bloqueada por RLS → erro visível. Esconder por módulo financeiro.
- **`cliExcluir`** (~23743) ainda checa `perfil==='vendedor'` (não cobre 'customizado'); o botão já está ok (`podeDeletar` ~23636), mas a função e o RLS de `clientes` (qual=true) não barram delete via console.
- **Consistência**: Dashboard usa `_isAdminUser()` (~4816/7742) em vez de `_podeVerCusto()` → **super-restringe o OPERACIONAL** (Eduardo tem financeiro/custos mas não é admin → não vê widgets financeiros do dashboard que deveria ver).
- **Latente**: perfil PADRÃO `vendedor` (linha ~11281) inclui `afiliados`, e o módulo Afiliados não tem `js-custo`/`_podeVerCusto` (comissões expostas). Não atinge os atuais (são `customizado` sem afiliados), mas atinge se alguém usar o perfil `vendedor` literal. Decidir: tirar `afiliados` do perfil padrão OU proteger as comissões.

### Bugs de DADOS/LÓGICA — revisados 28/06 (conclusões)
- ✅ **NÃO é bug — "Só marcar como paga"** (`~15157`): é botão proposital ("marca paga SEM lançar no caixa", title no modal). As 12 contas "pagas sem lançamento" foram marcadas com ele. Dono confirmou: **pagas por fora, deixar como está** (caixa segue sem essas saídas, por decisão). Botão mantido como está.
- ✅ **NÃO é bug — baixa de estoque do PDV**: a venda local baixa via backend Railway `/pdv/pedido-baixar-estoque` (idempotente), em `_pdvFinalizarVenda` (~21640). O QA que disse "não baixa" procurou trigger no banco (é no backend). Estoque negativo = caso pontual (vendas antigas/ajustes), não falha do PDV.
- ✅ **CORRIGIDO — alerta de comissão de afiliado zero** (`gerarComissoesAfiliados` ~19193): antes, se houvesse vendas de afiliado mas a comissão calculasse R$0 (falta config), avisava "sem vendas com comissão" (ambíguo). Agora avisa explicitamente que há N vendas mas a comissão deu zero e que faltam cadastrar `preco_minimo_afiliado`/`comissao` dos produtos. **(Os VALORES em si o dono precisa cadastrar — 0 de 23 produtos_precos com preço mínimo / 0 de 103 com comissão.)**
- ⏳ **PENDENTE (dado do dono) — `custo_puro` parece desalinhado** (~13 scooters): `ctReal` (~4169) confia no `custo_puro`, que está menor que custo+nf+financeiro → MC/MC% podem estar inflados. Precisa o dono confirmar os custos certos (não mexido p/ não alterar margens às cegas).
- ✅ **CORRIGIDO (29/06, no banco) — acessório com `categoria='scooter'`**: "Baú + Suporte Bashi" (`produtos_precos.id efc4d9c2-9923-4f9c-822d-8d773f9105bb`) estava `scooter` → somava R$30 de NF indevido e podia contar como "scooter vendida". `UPDATE produtos_precos SET categoria='acessorio'`. Só existia nessa tabela. Reversível.
- ✅ **REMOVIDO (29/06, commit em main) — código morto que exibia custo/lucro sem proteção**: `renderDRE`/`dreRow`/`recalcDRE` e `renderDashVendedoresInline` eram inalcançáveis (0 chamadas, sem ref dinâmica). Montavam DRE/ranking com custo/margem/lucro fora dos gates de permissão. Removidos; boot sem erro no localhost; sem mudança de comportamento.
- ⏳ Menores (observação): Oficina "Lucro" inflado (OS com custo 0 — backlog #2). Divergência preço cadastro×Tiny. 25 produtos sem FK `produto_precos_id`. Arredondamentos de centavos em empréstimo.

## Histórico de mudanças

### 2026-06-30 — Impressão da OS de Montagem liberada pra todos os perfis
Antes, na blindagem de KPIs de 28/06, o botão 🖨️ de imprimir a OS de montagem (`renderMontagens` ~17568) e a função `imprimirMontagemOS` (~18039) estavam atrelados a `_podeVerCusto()` → **vendedor (Henrique/Rafael/Samuel) não via o botão** (a OS impressa mostra "Preço montagem"/Total e o CSS `js-custo` não pega em `window.open`, então esconderam o botão inteiro). O dono notou na loja: o vendedor precisa imprimir a OS pro **montador assinar**. **Decisão (dono):** liberar a OS **completa** (com preço) pra todos os perfis. Removido o gate do botão (17568) e o guard `if (!_podeVerCusto())` da função (18040, agora com comentário). Custo da montagem fica visível na impressão por opção consciente. Botão "Pagar lote" (17571) segue restrito (financeiro + RLS). **Em validação local (não commitado).**

### 2026-06-29 — Reorganização das pastas locais numa pasta-mestre
Tudo do Smart Motors consolidado em `~/projetos/Smart Motors/` (`frontend`/`backend`/`documentos`/`arquivo`) — antes espalhado em `~/smart-motors-app`, `~/smartmotorsestoque`, `~/smart-motors-review` e `~/Documents/Work  /Smart Motors `. Detalhe na seção **Arquitetura**. Produção intacta (Pages/Railway puxam do GitHub). Worktree reparado (`git worktree repair`); histórico+memória do Claude copiados pros novos caminhos-chave (`-Users-moreira-projetos-Smart-Motors-frontend`/`-backend`) — as pastas-chave antigas seguem como backup.

### 2026-06-29 — Afiliados: selo de status de PAGAMENTO da comissão (em validação local)
`index.html` (`renderGrupoAfil` ~18918): cada afiliado na árvore "Vendas & Comissões" passa a mostrar um selo do status de pagamento da comissão, calculado das contas a pagar `afl-*` dele (`_cpTotalPago`): 🟢 comissão paga · 🟡 parcial (falta R$) · 🟠 a pagar (R$) · ⚪ a fechar (comissão liberada mas conta do mês não gerada ainda). Só exibição — não mexe no fluxo de pagamento/Fechamento. `gerarComissoesAfiliados` é idempotente (id `afl-<comp>-<afiliado>`) → clicar "Gerar/atualizar contas do mês" várias vezes NÃO duplica (atualiza; trava se já houve pagamento). Validado: árvore renderiza, selo do Pedro = "a pagar R$100" (conta afl-2026-06 pendente existe).
*(cronológico e enxuto — o detalhe vive na seção do assunto)*

- **2026-06-28 — Auditoria de segurança completa** (nota 2/10 → ~8–9/10):
  - Frente 1 (quick wins): senhas hardcoded e WhatsApp key fora do front, SRI, CSP `<meta>`, `.gitignore`, `search_path`, logs sem PII. → ver **Segurança**.
  - Cert HTTPS do domínio resolvido (sumiu o "site não seguro"). → ver **Infra / Deploy**.
  - WhatsApp: key migrada p/ Edge Function `wa-notify`; remetente reconectado (QR); dedup no servidor (mata spam de avisos repetidos). → ver **WhatsApp / Notificações**.
  - Frente 2: migração p/ Supabase Auth + RLS fechado (anon não acessa) + RLS por perfil; leaked password ligado; senhas antigas apagadas. → ver **Autenticação & Permissões** e **Segurança**.
