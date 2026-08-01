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
- **Perfis:** `admin` (vê tudo), `operacional` (lista fixa, inclui financeiro/custos), **`vendedor` (lista fixa — perfil padrão, ver abaixo)**, `customizado` (usa `modulos_permitidos`). Os "vendedores" (**Henrique, Rafael, Samuel, Michelle**) são **`vendedor`** (perfil padrão, todos idênticos). Michelle também é vendedora (correção do dono 08/07) — antes era `customizado` + `contas-receber`; virou `vendedor` padrão e **perdeu o `contas-receber`** por decisão do dono (todos exatamente iguais). Não há mais nenhum vendedor em `customizado`.
- **Perfil padrão `vendedor` (08/07/2026):** lista fixa de 12 módulos = `dashboard, vendas, estoque, localizacao, pedidos, oficina-sac, calendario, montagens, clientes, contratos, pdv, crm` — **sem financeiro/custos/preços/afiliados** (não vê comissão/custo/margem/lucro). É um perfil de verdade, com **fonte única em DOIS lugares que precisam ficar em sincronia**: front `PERFIS_DEFAULT_MODULOS.vendedor` (index.html ~11381) **e** o ramo `when u.perfil='vendedor'` da função `tem_modulo` no banco (migração `tem_modulo_perfil_vendedor`) — igual ao `operacional`. Mudar o perfil = editar os dois. Para usuários `vendedor`, `modulos_permitidos` é ignorado (fica `[]`). Antes os vendedores eram `customizado` (workaround) porque faltava o ramo `vendedor` no `tem_modulo` — agora completo.
- **1º acesso:** senha provisória com `must_change=true` → o app força criar senha nova (modal `abrirTrocarSenha`).
- **Gestão de usuários (criar/aprovar/bloquear/resetar senha):** Edge Function `admin-usuarios` (service_role). Ações exigem **admin logado**; o `seed` inicial (já usado) exige token em `_admin_setup` e só roda com Auth vazio. `criarConta`/`resetSenha` da TELA DE LOGIN só orientam procurar o admin (cadastro centralizado).
- **Reset de senha pelo painel admin (Editar acesso → Nova senha) — corrigido 07/07/2026:** o login usa Supabase Auth (`signInWithPassword`), mas `salvarAcesso` gravava a "nova senha" na coluna **morta** `usuarios.senha` → a senha nunca valia (o front não tem service_role p/ trocar senha de outro usuário). **Fix:** `salvarAcesso` (modo edit) agora chama `admin-usuarios` `acao=reset` passando a `senha` digitada; a Edge Function aceita **senha custom** (≥6, vale direto, `must_change=false`) ou gera provisória (força troca). Ver Histórico 07/07.
- **CRUD de acessos pelo painel — corrigido 07/07/2026 (create + delete):** o front não tem service_role p/ mexer no `auth.users`, então **toda operação de conta passa pela Edge Function `admin-usuarios`** (service_role, exige admin logado). Antes só `reset` estava roteado; agora **create e delete também**.
  - **Create** (`salvarAcesso` modo create): inseria só em `usuarios` (sem `auth.users`) → usuário novo **não logava**. Agora chama `acao=criar` (cria `auth.users` + insere em `usuarios` numa tacada, sem o `saveUser` duplicado). A ação foi estendida: aceita **senha custom** do admin (modal exige ≥6 → vale direto, `must_change=false`; senão provisória c/ troca no 1º acesso) e grava **`modulos_permitidos`** (perfil customizado); **rollback** do `auth.users` se o insert falhar.
  - **Delete** (`deletarUser`, botão "Remover"): apagava só a linha em `usuarios` → deixava a conta **órfã no `auth.users`** (e travava recriar o mesmo e-mail). Agora chama `acao=deletar` (apaga a conta no Auth + a linha).
  - Edge Function em **deploy v4** (`verify_jwt=false` inalterado). Smoke test: `criar`/`deletar` respondem **401** sem admin logado (guarda OK). Saúde do banco: os 7 usuários têm `auth_uid` + conta no Auth (nenhum órfão); senha antiga do Moisés na coluna morta `usuarios.senha` normalizada p/ `"auth"`. Ver Histórico 07/07.
- **Permissão por perfil:** vale na **tela** (menus, via `modulosPermitidos`) **e no banco** (RLS por perfil — ver "Segurança"). Mudar os módulos de alguém ajusta os dois automaticamente.
- **Ocultação de KPIs por perfil (granular, 28/06):** princípio = esconder o KPI/campo específico, não a tela toda. Helpers no front `_temModulo(mod)` / `_podeVerCusto()` (= tem `custos`/`custos-produtos`/`precos`/`financeiro`) + classe CSS `.js-custo` escondida via `body.sem-kpi-custo` (setada em `_aplicarSessao`). Esconde **custo/margem/lucro** de quem não tem o módulo, DENTRO de telas que ele acessa: **Estoque** (lista de Cadastros: colunas Custo/MC R$/MC % + Modal Produto: bloco Custos), **aba Vendas** (Lucro/MC%/Custo Fixo), **Oficina/SAC** (custo mão de obra/peças + Custo/Lucro do resumo), **Montagens** (coluna Preço + total do modal). Receita/preço de venda/ticket continuam visíveis. Validado: vendedor `body.sem-kpi-custo` ativo, operacional/admin não. **Em validação local (não commitado).**

## Contas a Pagar — dossiê do boleto (arquivo, código de barras, Pix, comprovante, histórico)
- **O que é:** cada conta a pagar guarda o boleto completo, não só o lembrete. Modal **"Detalhes da conta"** (botão 📄 na linha da lista) com: arquivo do boleto (anexar/ver/baixar), **linha digitável** e **código de barras** (com botão Copiar), **Pix** (chave + copia-e-cola, quando houver), identificação (beneficiário/nosso número/documento), **comprovante de pagamento** (anexar) e **histórico de alterações**. Ícone 📎 na linha quando há boleto anexado.
- **Linha digitável × código de barras:** a **linha digitável** (47 díg.) é a que se copia/cola no banco pra pagar (botão Copiar). O **código de barras** é renderizado como **figura escaneável** (SVG, padrão boleto **Interleaved 2 of 5/ITF**, `_cpBarrasSVG`) — não o número — pra ler com a câmera; tem botão "Copiar números" e "Atualizar da linha digitável" de reserva. Decisão do dono (04/07): mostrar as barras desenhadas, não o número.
- **Código (`index.html`):** bloco "BOLETO / ANEXOS" logo após `salvarContaPagar` (~14907). Funções: `abrirCpDetalhe`/`closeCpDetalhe`/`_cpRenderDetalhe` (modal `#cp-detalhe-modal`), `_cpAnexar`/`_cpAbrirArquivo`/`_cpUploadArquivo` (Storage), `_cpSalvarDadosBoleto`, `_cpLogHistorico`, `_cpCopiar`, `_cpDerivarBarras`, `_cpLinhaParaBarras` (deriva os 44 díg. dos 47 da linha — Febraban), `_cpBarrasSVG` (desenha ITF). Botão 📄 e ícone 📎 em `renderContasPagar` (~14710). Persistência: `update().eq('id',...)` direto (não passa pelo `_syncTable`).
- **Banco:** colunas novas em `contas_pagar` (migração `contas_pagar_boleto_anexos`): `linha_digitavel, codigo_barras, chave_pix, qr_pix, boleto_path, boleto_nome, comprovante_path, beneficiario, nosso_numero, documento, historico jsonb`. Mapeamento snake↔camel é automático (`toSnake`/`toCamel` do `TABLE_MAP`) — não precisou tocar no `fromDb`/`toDb`. RLS herda a policy `acesso_total` (`tem_modulo('contas-pagar')`).
- **Storage:** bucket **privado** `boletos` (migração `storage_bucket_boletos`), path `<conta_id>/<boleto|comprovante>-<ts>.<ext>`, servido por **signed URL** (1h). Policies em `storage.objects` = `authenticated` + `public.tem_modulo('contas-pagar')` (select/insert/update/delete). **É o 1º uso de Supabase Storage no app.**
- **QR Pix visual:** por ora só copia-e-cola (sem lib de QR). Este boleto Bradesco/OMETZ não tem Pix.
- **Estado:** ✅ **em produção** (commit `5ce22a6`, pushed/deployado no GitHub Pages 04/07/2026). Validado com sessão real (boot limpo, modal, deriva barras, upload/download/remove no bucket, RLS). Anexo de PDF funcionando (feito via sessão logada por script no navegador; usuário também pode anexar pela UI em 2 cliques).
- **Boletos já processados (04/07):** NF 2302 (OMETZ, 4 parc.), NF 305 (Atlas/IALA, 3 a-vencer enriquecidas + 1 paga intocada), NF 2082 (Grupo Veloster/IALA/Algarve: 2082-002 e 2082-004 enriquecidas; 001/003 pagas intocadas). Todas com linha digitável, código de barras e PDF anexado. **2082-002 é parcela renegociada** (atraso na entrega → venc. 29/05 substituído por 28/08); a versão antiga do PDF ficou guardada no Storage (`<id>/versao-anterior-*.pdf`) e a nota está na `observacao`/`historico` da conta.
- **Regra de enriquecimento (dono):** ao reprocessar boletos, **nunca duplicar**, **nunca alterar pagas** nem mexer em status/valor/vencimento — só **complementar** dados que faltam (linha, barras, PDF, etc.). Toda alteração usa guarda `status <> 'pago'`. Ver skill `/cadastrar-boleto`.

## CRM Omnichannel (atendimento comercial / leads) — F1 no ar
- **O que é:** central de comunicação p/ leads de anúncio (WhatsApp oficial; Instagram/Messenger na F2; TikTok só via Lead Gen — **não existe API de DM do TikTok**). App **dedicado** em React+Vite na **Vercel**: `https://smart-motors-crm.vercel.app` (projeto `smart-motors-crm`; pasta local `~/projetos/Smart Motors/crm/`, repo git próprio). Entrada pelo sistema: item **"CRM / Atendimento"** na sidebar → `abrirCRM()` (gated `_temModulo('crm')`) abre o app **já logado** (SSO: sessão no fragment `#sso=`, consumida e limpa via `history.replaceState`). Plano completo: `~/.claude/plans/preciso-desenvolver-um-crm-jiggly-sutherland.md` (v2, revisado por 5 agentes).
- **Módulo/permissão:** `crm` (novo). `tem_modulo` atualizado (migração `crm_modulo_permissoes`): admin=tudo, operacional inclui `crm`, vendedores customizado ganharam `"crm"` no `modulos_permitidos`. Front espelhado (`TODOS_MODULOS`, `PERFIS_DEFAULT_MODULOS.operacional`, `NAV_TREE`, intercept no `showPage`). `crm-admin` reservado p/ dashboard/config (admin).
- **Banco (migrações `crm_*`, 04/07/2026):** tabelas `crm_canais` (regras por canal: janela, template, outbound frio), `crm_contatos` (**unique(canal, canal_user_id)**; N contatos→1 `clientes`; lead≠cliente — só vincula por telefone `crm_casar_cliente_por_telefone`, nunca cria), `crm_conversas` (status aguardando|em_atendimento|ia|finalizada; **dono do lead** = atendente_id; `sla_pausado`; `janela_expira_em`), `crm_mensagens` (append-only, idempotente por unique(canal,canal_message_id), notas internas = remetente `nota_interna`), `crm_saida` (fila durável de envio c/ retry), `crm_negociacoes` (**dossiê da venda**: entrada+forma, `simulacoes jsonb`, status_credito, `estagio_funil` novo→…→fechado|perdido, motivo_perda, FK `pdv_pedido_id` p/ F2), `crm_lembretes`, `crm_conteudo_categorias/itens` (biblioteca, 10 categorias seed), `crm_conhecimento` (pg_trgm, SEM pgvector), `crm_templates` (HSM), `crm_eventos` (auditoria), `crm_presenca` (heartbeat 60s do app), `crm_config` (singleton: SLA, teto_desconto, **kill switches** `envio_ativo`/`ia_*`/budget). RLS `tem_modulo('crm')` em tudo. Realtime em conversas/mensagens/presenca. Extensões novas: pg_trgm, unaccent.
- **Views de segurança:** `crm_catalogo` e `crm_disponibilidade` (security_invoker) — únicas portas do CRM/IA pro catálogo: só modelo/`venda`/estoque/cores/garantia. **Custo/margem/comissão inacessíveis por arquitetura.** Estoque real = `produtos.estoque` (**gerido nativamente pelo sistema Smart Motors — ver seção "Estoque"**; NÃO vem do Tiny); `estoque_unidades` está VAZIA (não usar). **Hold leve:** `disponivel_prometivel` = estoque − negociações abertas por produto (testado: Skylo 18→17).
- **Roteamento (RPCs security definer):** `crm_atribuir_conversa` (service_role; **dono do lead primeiro** — cliente que volta cai com quem já atendia; senão online c/ menor carga, `FOR UPDATE SKIP LOCKED`), `crm_pegar_conversa` (claim atômico — 2 cliques, 1 ganha), `crm_transferir_conversa` (manual + nota vira nota interna), `crm_msg_recebida` (atualiza conversa + reabre janela + rearma SLA). Testado E2E via SQL (atribuição, dono do lead, idempotência de wamid, hold). SLA/redistribuição automática por pg_cron = **F2 (pendente)**.
- **Edge Functions:** `crm-meta-webhook` (verify_jwt=false; auth = HMAC `X-Hub-Signature-256`; GET hub.challenge; **200 imediato + processa em background**; idempotência; status callbacks nunca regridem; **opt-out SAIR/STOP** marca `opt_in=false`; baixa mídia pro bucket `crm-midia`; ramifica por `object` — WA/IG/Messenger no MESMO endpoint) e `crm-send` (verify_jwt=true; valida **no servidor**: kill switch, opt-out, **janela 24h** → fora dela só template aprovado; fila `crm_saida` com retry; mídia via signed URL). **Adaptadas p/ BI-PROVIDER (12/07/2026):** `CRM_WA_PROVIDER` = `meta` (default, caminho antigo intacto) | `360dialog` (coexistência) — envio via `waba-v2.360dialog.io`+`D360-API-KEY`, webhook por HTTP Basic, echo de coexistência (`message_echoes`→saída), mídia via `D360-API-KEY`. Ver sub-seção **"WhatsApp via coexistência (360dialog)"**. Secrets Meta: `CRM_META_APP_SECRET`/`CRM_WA_VERIFY_TOKEN`/`CRM_WA_TOKEN`/`CRM_WA_PHONE_NUMBER_ID`; secrets 360dialog: `CRM_D360_API_KEY`/`CRM_D360_WEBHOOK_USER`/`CRM_D360_WEBHOOK_PASS`.
- **App (crm/):** Login (email OU nome — mesma RPC `resolver_email_login`), Inbox (filas Aguardando/Meus/Em andamento/IA/Finalizadas, Realtime + **refetch na reconexão**, botão Pegar, quem está online), Conversa (thread, status ✓✓, mídia via signed URL, **nota interna** 📝, pausar SLA, transferir, lembrete, finalizar), painel **Negociação** (funil, modelo c/ disponibilidade prometível ao vivo, entrada/forma, **simulador de parcela** PMT c/ histórico, crédito, desconto auditado em `crm_eventos`), aba **Mensagens rápidas** (preço/estoque AO VIVO do banco + biblioteca por categoria). Tema dark/dourado `#f5c518`/Inter.
- **Pendências do DONO (F0 — destravam o WhatsApp real) — REVISADO 12/07/2026:** a estratégia mudou de "Cloud API Meta direta + número novo dedicado" para **coexistência via 360dialog mantendo o número ATUAL** da loja (o código aceita os dois via `CRM_WA_PROVIDER`; o caminho Meta direto fica de reserva). Ver sub-seção **"WhatsApp via coexistência (360dialog)"** + `_memoria/tarefa-atual.md`. Continua valendo: **verificação de negócio na Meta** · **templates HSM** · (F2, futuro) App Review do Instagram messaging (`instagram_manage_messages`).
- **F2 — ✅ PRONTA (05/07/2026):**
  - **SLA automático:** migração `crm_sla_pg_cron` — job `crm_sla` (1/min) roda `crm_verificar_sla()`: redistribui SLA estourado p/ online c/ menor carga (respeita `sla_pausado`), devolve pra fila se ninguém disponível, marca presença stale offline, dead-man-switch em `crm_cron_status` (dashboard alerta se parar). **Validado em produção** (evento `redistribuida` Henrique→Rafael pelo cron real).
  - **Dashboard admin** (`/dashboard`, perfil admin): KPIs on-the-fly (aguardando+pior espera, em andamento, TMR do dia, finalizadas, redistribuídas), equipe online c/ carga, funil de negociações, motivos de perda, por canal; edita SLA (min) e **kill switches** (`envio_ativo`, `ia_*`); alerta de cron parado.
  - **Modo simulador** (canal `webchat`, `origem='simulador'`): admin cria lead fictício no dashboard; na conversa, botão "💬 Simular cliente" injeta respostas — equipe treina sem canal real. `enviarNoCanal`: WhatsApp→Edge Function; canais internos gravam direto (sem janela).
  - **Loop PDV:** botão **"Gerar pedido no PDV"** no painel de negociação (`ModalGerarPedido`). Replica o formato EXATO do `_pdvFinalizarVenda`: `pdv_pedidos` sem `numero_smart` (identity), `venda_local=true`, `sincronizado_tiny=false`, `cliente_dados`/`forma_pagamento {desconto, metodos:[{tipo,valor,parcelas?}]}`, item com `produto_id` (é o que baixa estoque), `pdv_auditoria_log`, baixa best-effort no Railway (`/pdv/pedido-baixar-estoque`, idempotente), sem Tiny. **Comissão = `pdv_vendedores.login_usuario` do atendente logado** (sem cadastro → erro claro). Negociação recebe `pdv_pedido_id` + `estagio='fechado'` + evento `pedido_gerado`. `pdv_pedidos.origem` = origem do contato (rastreio de campanha).
- **F3 — IA copiloto ✅ (05/07/2026, aguarda `ANTHROPIC_API_KEY`):** Edge Function **`crm-ia-sugerir`** (verify_jwt; Claude **Sonnet 5** via fetch, tool-use forçado `sugerir`). Contexto: últimas 30 msgs (notas internas EXCLUÍDAS), `crm_disponibilidade` (preço tabela + estoque prometível + cores), `crm_buscar_conhecimento` (RPC pg_trgm, migração `crm_buscar_conhecimento`), negociação atual. Guard-rails: kill switch `ia_copiloto_ativa`, teto `ia_max_msgs_conversa`/dia (conta eventos `ia_sugeriu`), prompt anti-injeção, **nunca desconto/brinde** (e a IA só escreve modelo+preço de tabela na negociação, `detectado_por_ia=true`). UI (app CRM): botão **✨ IA** no composer → painel com Enviar/Editar/Descartar; **💾** nas mensagens enviadas salva par pergunta→resposta em `crm_conhecimento` (feedback loop). Auditoria+custos em `crm_eventos.detalhe.tokens`. **Passo pendente do dono:** setar `ANTHROPIC_API_KEY` nos secrets das Edge Functions (mesma key do Railway) e ligar o toggle no Dashboard.
- **Regra de negócio na IA (05/07):** formas de pagamento = SÓ dinheiro, transferência, Pix, cartão até 21x. **Sem financiamento/crediário** — proibido a IA mencionar (travado no system prompt do `crm-ia-sugerir`, regra 3). Corrigido também na biblioteca (categoria "Formas de pagamento (Pix/cartão)").
- **F4 — PRÓXIMA (decidida 05/07): IA autônoma de pré-atendimento fora do horário.** Dono escolheu construir já, agindo só fora do `horario_comercial`/ninguém online, "vende não negocia", escala humano no sensível, kill switch `ia_autonoma_ativa`. Spec completa em `~/projetos/Smart Motors/_memoria/tarefa-atual.md`. Construir `crm-ia-responder` (reusa contexto/guard-rails do `crm-ia-sugerir`, mas ENVIA via `crm-send` com `x-crm-remetente: ia`); gatilho por trigger em `crm_mensagens` + `pg_net`; testar no simulador.
- **F5+ (não construído):** Instagram/Messenger (App Review) · proposta PDF · gestão da biblioteca no app (upload de mídia) · avisos internos de lead parado via `wa-notify`.
- **Continuidade de tarefas:** estado vivo em `~/projetos/Smart Motors/_memoria/tarefa-atual.md` (regra no CLAUDE.md raiz — retomada automática após queda de sessão).
- **Contexto de produto (dono, 05/07/2026):** o sistema (`smartmotorsapp.com.br`) e o CRM são **exclusivamente internos** — usuários são SÓ funcionários; nunca propor recurso de cliente final nesses ambientes. **Site público/catálogo = projeto futuro fora do escopo**; quando existir, o contato do cliente será direcionado ao **WhatsApp** (decisão do dono — não haverá webchat). O canal `webchat` do CRM fica reservado ao **modo simulador** (treino da equipe).

### WhatsApp via coexistência (360dialog) — decisão + adaptação técnica (12/07/2026)
**Decisão do dono (12/07/2026):** ligar o WhatsApp do CRM por **coexistência via 360dialog** (BSP),
mantendo o **número atual da loja** ativo no app do celular **E** no CRM ao mesmo tempo. Reverte a decisão
antiga ("Cloud API Meta direta + número novo"): coexistência SÓ existe via BSP (regra da Meta). **Custo:** a
Meta não cobra mensalidade (só mensagem — atendimento na janela 24h grátis até out/2026, depois ~R$0,035;
disparo por template R$0,035 utilidade/auth, ~R$0,32 marketing) **+ fee 360dialog ~49€/59US$/mês (~R$300)**,
sem markup nas mensagens. Decisão/custos detalhados: memória `crm-omnichannel` + `_memoria/tarefa-atual.md`.
- **Código adaptado p/ bi-provider (`crm-send` + `crm-meta-webhook`):** env `CRM_WA_PROVIDER` = `meta`
  (default — caminho antigo 100% intacto) | `360dialog`. Com o default `meta`, **nada muda** até setar os
  secrets → reversível. **AINDA NÃO deployado** (aguarda a conta/API key do 360dialog + autorização de push).
  - **Envio (`crm-send`):** modo 360dialog → `POST https://waba-v2.360dialog.io/messages` com header
    `D360-API-KEY` (SEM `phone_number_id` na URL); corpo idêntico à Cloud API. Modo meta → inalterado.
  - **Webhook (`crm-meta-webhook`) — 3 mudanças:** (1) **auth por HTTP Basic** no modo 360dialog
    (`CRM_D360_WEBHOOK_USER`/`PASS`, definidos ao registrar o webhook no client hub) — o 360dialog NÃO manda
    o HMAC da Meta; (2) **echo de coexistência**: o que a loja responde **pelo app do celular** chega em
    `value.message_echoes[]` → registrado como SAÍDA (`remetente:'atendente'`, idempotente por wamid, zera
    SLA/não-lidas) pra thread do CRM ficar sincronizada; (3) **roteamento por conteúdo do `value`** (não só
    `field==='messages'`) porque os echoes vêm em `field` diferente (ex. `smb_message_echoes`).
  - **Mídia:** `baixarMidia` usa `waba-v2.360dialog.io/{id}` + `D360-API-KEY` no modo 360dialog.
- **Secrets a setar quando a conta existir (provider 360dialog):** `CRM_WA_PROVIDER=360dialog` ·
  `CRM_D360_API_KEY` (do canal) · `CRM_D360_WEBHOOK_USER` + `CRM_D360_WEBHOOK_PASS` (Basic Auth do webhook).
  Os secrets Meta antigos podem permanecer (são ignorados no modo 360dialog).
- **Pré-reqs OK:** número já no WhatsApp **Business** há 7+ dias · CNPJ + docs em mãos.
- **Passos do dono (destravam o go-live):** criar conta no 360dialog → Embedded Signup de **coexistência**
  (escaneia QR com o app da loja) → verificação de negócio na Meta (3–10 dias úteis) → cartão no client hub
  → registrar o webhook do canal apontando pra `.../functions/v1/crm-meta-webhook` com Basic Auth → aprovar
  os templates que eu criar. Guia passo a passo: `documentos/whatsapp-360dialog-onboarding.md`.
- **Depois (eu):** deploy das 2 functions (`--project-ref sxmeuqlotjuchslevofv`), setar secrets, testar E2E
  (cliente manda → cai no CRM → responder pelo CRM → responder pelo app → echo aparece no CRM) e validar no
  front que o echo renderiza. **Limitações da coexistência:** WhatsApp Web/Desktop desconectam (atende no
  celular OU no CRM), abrir o app 1x/13 dias, sem selo azul/troca de foto/API de chamada. **A confirmar no
  painel real:** formato exato do `smb_message_echoes` e se o webhook usa Basic Auth ou header custom
  (implementei Basic conforme a doc do 360dialog; ajusto rápido se divergir no teste).

## Estoque — fonte da verdade = sistema Smart Motors (NÃO o Tiny)
**Verificado em 05/07/2026** (dados + código): o estoque é gerido **100% pelo próprio sistema**, não sincroniza do Tiny.
- **Fonte da verdade:** `produtos.estoque`, movido SÓ pela função `registrar_movimento` (RPC), com trilha em `estoque_movimentos` (`tipo/origem/quantidade/saldo_apos/ref_id`).
- **Origens reais das movimentações:** `pdv` (saída/entrada, via `/pdv/pedido-baixar-estoque`/estorno), `manual` (ajuste/entrada), `envio_parceiro`/`devolucao_parceiro`/`estorno_envio`. Contínuas.
- **Tiny = seed único:** a origem `snapshot`/`inicial` (98 movimentos) rodou **só em 04/06/2026** pra copiar o saldo inicial do Tiny 1 vez. Depois disso, **nunca mais**. **Nenhum cron** puxa do Tiny (o único cron no backend é o resumo de WhatsApp 9h/19h). Os endpoints `/tiny/snapshot-estoque` e `/tiny/importar-produtos` são manuais/backfill ("1x"), não agendados.
- **`tiny_id` nos produtos** = só mapeamento p/ emissão de NF-e (Focus/Tiny) e p/ o import inicial — **não** é sync de estoque.
- **Regra p/ features novas (decisão do dono, 05/07):** qualquer coisa de estoque/movimentação/pedido/disponibilidade usa **exclusivamente** a estrutura Smart Motors (`produtos.estoque` + `registrar_movimento` + `estoque_movimentos`). Nunca depender do Tiny para estoque.
- **Correção de registro:** eu havia dito por engano que "estoque vem do Tiny" — errado; era suposição não verificada. Estoque negativo NÃO é reflexo do Tiny (é venda sem entrada prévia no próprio ledger); pra zerar/corrigir, registrar um **movimento de ajuste** via `registrar_movimento`, não `UPDATE produtos.estoque` cru.
- **`registrar_movimento(p_produto_id uuid, p_tipo text, p_quantidade numeric, p_motivo, p_origem, p_ref_id)`:** `tipo` ∈ `inicial|ajuste` (define saldo ABSOLUTO = `p_quantidade`), `entrada` (+abs), `saida` (−abs). Faz o `UPDATE produtos.estoque` + insere em `estoque_movimentos` com `saldo_apos` e o delta. Ex.: zerar negativo = `registrar_movimento(id,'ajuste',0,'motivo','manual',null)`.

## Catálogo de produtos — limpeza 05/07/2026 (X11/X14/Baú/negativos)
Fonte do preço do CRM/IA = `produtos_precos.venda` (via VIEW `crm_catalogo`), lida ao vivo — editar lá (módulo Preços & Margens) reflete na hora. Modelo = 1 linha em `produtos_precos`; variações (cores) = linhas em `produtos` com `produto_precos_id` apontando pro modelo. Correções feitas:
- **X11 unificada:** era "X11" (venda 7300) + "SCOOTER X11 CARBONO" (venda 8000, órfã). Agora **1 modelo "X11", venda R$8.000** (corrigido a pedido do dono), com 6 cores (incl. Carbono como variação). A linha `produtos_precos` duplicada foi **desativada** (`ativo=false`, reversível).
- **X14 unificada:** eram 4 `produtos_precos` (1 por cor, venda 8500). Padrão de unificação: renomear 1 linha p/ "X14", repontar os `produtos` das outras cores pro `produto_precos_id` dela (vendas ficam intactas — `pdv_itens_pedido` referencia `produto_id`, não o preço), desativar as 3 linhas extras. Agora 1 "X14" com 4 cores.
- **Baú + Suporte Bashi** (`efc4d9c2`): categoria `scooter`→`acessorio`. **Atenção — já tinha sido corrigido em 29/06 e reverteu** (provável re-import manual do Tiny mexe em `produtos_precos.categoria`; NÃO é o sync de estoque). Se recorrer, vale um guard.
- **Estoques negativos zerados:** 12 produtos, via `registrar_movimento(...,'ajuste',0,...)` (ledger consistente). Negativos eram venda sem entrada prévia no ledger nativo.

## Venda "na caixa" (sem montagem) — modalidade de custo por modelo (14/07/2026)
Pedido do dono: marcar por modelo se ele é vendido **na caixa** (entregue desmontado — a loja não paga
montagem) ou **montada** (padrão). Marcado "na caixa", o **custo de montagem sai do custo real** → margem/
lucro reais maiores. **Decisão do dono:** o marcador fica no **cadastro geral do produto** (vale pro sistema
todo) e o efeito vale **em todo lugar, inclusive a DRE/lucro** (não é só um número informativo).
- **Banco:** coluna `produtos_precos.venda_na_caixa boolean not null default false` (migração
  `produtos_precos_venda_na_caixa`). Default `false` = montada = **comportamento anterior intacto** (nada muda
  até o dono marcar um modelo). Mapeamento snake↔camel automático (`TABLE_MAP.produtos_precos`) → `vendaNaCaixa`
  no front, persiste/carrega sozinho.
- **Cálculo (regra num lugar só):** helper `_montagemCusto(p) = p.vendaNaCaixa ? 0 : (p.montagem||0)` (index.html
  ~4285, logo antes de `ctReal`). Usado nos **3** pontos que compõem o custo real: `ctReal` (margem/estoque),
  o CPV de `buscarLinhasVenda` (~5648) e o CPV de `calcularDRE` (~8215). Acessório **não** é afetado (nunca
  teve montagem no custo). A NF por pedido (`nf_pedido`) e a comissão continuam entrando normalmente.
- **UI:** toggle **"📦 Vendida na caixa (sem montagem)"** no modal **"Editar custo"** (Custos de Produtos,
  `#cp-edit-venda-na-caixa`); o CtReal/MC% do modal recalculam ao vivo (`cpUpdateComputed`→`cpGetModalP`→
  `ctReal`). Persistência via `cpSave` (push + update). Na **lista** de custos, a coluna Montagem mostra o valor
  **riscado + selo dourado "📦 na caixa"** quando marcado.
- **NÃO mexe** em preço mínimo/comissão de afiliado (decisão do dono — só custo/margem). A comissão do afiliado
  já não usava custo (é escalonada sobre preço vs preço mínimo).
- **Validado (14/07/2026):** sintaxe (2 blocos `<script>` OK via new Function), lógica isolada (montada 3590 /
  na caixa 3480, acessório intacto), e **no navegador real** (localhost, sem erro de console): funções carregadas,
  toggle no DOM, e fluxo do modal — marcar o toggle levou CtReal 3.590→3.480 e MC% 44,76→46,45 ao vivo; Konek 800
  usado de exemplo (custo puro 3350 + montagem 110 + comissão 100 + NF 30).
- **Escolha POR VENDA no PDV (14/07/2026):** o dono refinou — "por padrão montada, mas na hora de montar o pedido
  quero a opção de vender na caixa". Virou uma escolha **por item do pedido** (o flag do modelo `venda_na_caixa`
  passa a ser só o **default sugerido** no PDV). Implementado:
  - **Banco:** `pdv_itens_pedido.na_caixa boolean not null default false` (migração `pdv_itens_na_caixa`).
  - **PDV:** cada item **scooter** (SCOOTER_RE) ganha, junto do chassi, o checkbox **"📦 Vender na caixa (sem
    montagem)"** (`_pdvRenderItensTabela` + `_pdvSetItem` trata o booleano; não mexe em subtotal/total). O item
    novo (`_pdvAddItemFromIdx`) herda `naCaixa` do padrão do modelo (`_matchProdutoPorNome(nome).vendaNaCaixa`);
    acessório nunca tem. Persiste em `na_caixa` nos itensRows de `_pdvFinalizarVenda` **e** da edição; ao carregar
    um pedido p/ editar, `naCaixa` é repopulado. Selo "📦 na caixa" no detalhe/comprovante do pedido.
  - **Custo/DRE por venda:** helper **`_montagemCustoVenda(prod, it)`** (o **item** manda: `it.naCaixa`; venda
    antiga sem a flag cai no padrão do modelo `prod.vendaNaCaixa`) substitui `_montagemCusto` nos **2 CPVs**
    (`buscarLinhasVenda` ~5648 e `calcularDRE` ~8215). O select/map de `buscarVendasMescladas` (~5515/5525) passou
    a trazer `na_caixa`→`naCaixa`. Reconciliação DRE×Relatórios preservada (mesma fonte/fórmula).
  - **`ctReal` (margem do cadastro/estoque) segue usando o padrão do MODELO** (`_montagemCusto`/`vendaNaCaixa`) —
    é a estimativa do modelo; o custo REAL de cada venda usa o flag do item.
  - **Validado (navegador real, localhost, console limpo):** checkbox só no scooter (1×, não no acessório),
    `_pdvSetItem` marca/desmarca, subtotal intacto; `_montagemCustoVenda` correto (item na caixa→0, montada→110,
    venda antiga→padrão do modelo). **✅ NO AR** (commit a seguir). **Follow-up:** venda real logada pelo dono.

## Contrato de venda — atalho no PDV/Pedidos + trava na finalização (16/07/2026)
**O que é:** facilita imprimir o contrato (o MESMO documento que a aba **Contratos** já gera — "CONTRATO DE
CIÊNCIA, GARANTIA E RESPONSABILIDADE", `_contratoMontarHtmlContrato`) sem o vendedor ter que ir na aba caçar o
pedido, e **força uma decisão consciente** sobre o contrato antes de fechar a venda no PDV. Pedido do dono:
evitar que o vendedor esqueça de entregar o contrato.
- **Descoberta que definiu o gatilho:** "Montagens" e "Pedidos" são **módulos desacoplados** — a aba Montagens é
  de **lotes de motos pro montador (estoque)**, sem `pedido_id`/`cliente_id`. Então o "avise ao finalizar a
  montagem" não tem como sair da aba Montagens (ela não conhece o cliente). O ponto que conhece o cliente é a
  **finalização da venda no PDV** (e o pedido salvo). Por isso a trava vive no PDV, não em Montagens.
- **Trava no PDV (passo 2, finalização):** bloco **"📄 Contrato de venda"** acima do botão "Finalizar venda",
  com (a) botão **Imprimir contrato de venda** e (b) checkbox **"ciente de que o contrato NÃO será impresso"**.
  O "Finalizar venda" fica **`disabled` até uma das duas ações** (imprimir OU marcar ciência). Dupla trava:
  além do `disabled`, um guard em `_pdvFinalizarVenda` barra a finalização. **Gate só em venda NOVA com item**
  (não trava edição de pedido; some se o carrinho está vazio).
- **Botão em Pedidos:** `_pedidoImprimirContrato(pedidoId)` na **lista** (`renderPedidosUnif`, ao lado de 2ª
  via/contabilidade) e no **modal de detalhe** (`_pdvAbrirDetalhe`, ao lado de "Imprimir comprovante") — só p/
  `origem='pdv'`, qualquer status. Serve pra imprimir depois, caso o vendedor tenha pulado no PDV.
- **Código (`index.html`):** bloco novo após `_contratoGerarPdf` (~28062). `_contratoFormRapido(cliente, itens,
  dataCompraISO)` monta o `form` (mesmo shape de `_contratoColetarFormData`) aceitando cliente **camelCase (PDV
  `_pdvVenda.cliente`) OU snake (`clienteDados`)** e escolhe a **moto de maior valor** (`_contratoExtrairProdutoPrincipal`),
  deduz cor (`_contratoExtrairCor`) e chassi; endereço = consolidado ou concatenado dos campos; cidade default
  **Itaguaí**; NF = emissor padrão Smart Motors. `_contratoImprimirForm(form)` = `window.open`+write (reusa o
  template do contrato, que já tem auto-print). Gate PDV: `_pdvGateContratoAtivo`/`_pdvContratoResolvido`/
  `_pdvContratoGateHtml`/`_pdvRenderContratoGate`/`_pdvImprimirContratoVenda`/`_pdvSetContratoDispensa`. Flags
  `_contratoImpresso`/`_contratoDispensado` vivem no `_pdvVenda` (`_pdvVendaNova`). O `disabled` do botão é
  recalculado em `_pdvRenderFinalizacao` (render) e em `_pdvAtualizaRestante` (ao vivo, quando muda pagamento).
- **Só imprime, NÃO grava histórico** — a aba Contratos (`INSERT em contratos` com snapshot) segue o registro
  oficial. Consciente, pra manter o escopo enxuto. **Limitação herdada:** contrato sai com **1 produto** (o de
  maior valor), igual à aba Contratos.
- **Layout compacto = 2 páginas (16/07/2026, pedido do dono — economia de papel):** o template
  `_contratoMontarHtmlContrato` gastava **3 páginas** (a 3ª só com a assinatura = desperdício). Reformado o
  `<style>`: margem da página 18mm→**11/14mm**, fonte 10.5→**10.3pt**, `line-height` 1.45→**1.4**, e cortados os
  espaços verticais grandes (assinaturas `margin-top` 60→40px, local-data 26→20px, título de cláusula 14→11px,
  blocos/parágrafos mais justos) + regras de quebra: `.bloco`/`.assinaturas` com `break-inside:avoid`,
  `.clausula-tit` com `break-after:avoid` (não deixa título nem a assinatura órfãos). **Medido no navegador
  (iframe na largura útil A4):** ~**1,7 página** de conteúdo (típico e pior caso com nome/endereço longos), folga
  de ~80mm na 2ª página → cabe folgado em 2 páginas, sem estourar. **Vale pra TODO contrato** (mesmo gerador da
  aba Contratos, não só o atalho). Visual conferido por screenshot (legível, assinaturas na pág. 2 junto às
  cláusulas finais).
- **Só a assinatura do CLIENTE (16/07/2026, decisão do dono):** removida a linha "ASSINATURA DA SMART MOTORS" —
  fica **1 linha de assinatura centralizada** ("ASSINATURA DO CLIENTE"). Motivo: o documento é uma *declaração
  do cliente* (ele declara ter recebido e estar ciente), então a assinatura essencial é a dele; a da loja é
  dispensável pra validade (liberdade de forma; não é título de dívida). CSS `.assinaturas` virou `flex` centrado
  (col 62%, max 340px). **Dono vai validar com advogado** — se ele quiser a contra-assinatura de volta, é trivial
  (restaurar a 2ª `.col` + grid 1fr 1fr).
- **Validado (navegador, localhost:8791, console 0 erro):** `_contratoFormRapido` (camel+snake), HTML gera
  preenchido (nome/modelo/chassi/cor), gate ativo/resolvido/toggle/edição-inativa, render travando/liberando o
  botão certo (pagamento exato + gate pendente = travado; resolve = libera; pagamento errado = trava de novo),
  visual conferido por screenshot. **Follow-ups:** dono validar logado (1 venda real imprimindo o contrato +
  imprimir da tela de Pedidos); **commit + push** (deploy GitHub Pages, passo do dono). NÃO commitado ainda.

## Calculadora de Parcelamento (simulador pro vendedor) — no ar 18/07/2026
**O que é:** ferramenta simples pro vendedor simular o preço no cartão e mandar as condições pro cliente no
WhatsApp. **Item de menu próprio** (`ic-calculator`, solo logo abaixo do PDV na `NAV_TREE`), página
`#page-calculadora`. Pedido do dono: "calculadora logo abaixo do módulo do PDV pros funcionários fazerem
simulações". **100% client-side** — não lê nem grava nada no Supabase (é só cálculo).
- **Regra comercial (definida pelo dono, NÃO é a taxa da adquirente):** `taxa% = nº de parcelas + 2` (1x=3%…
  21x=23%). `base = valor à vista − entrada` (a **entrada** é paga à vista, Pix/dinheiro, SEM taxa). `total no
  cartão = base × (1+taxa/100)`; `parcela = round2(total/n)`; **total exibido = parcela × n** (não o total
  matemático — pra o texto comercial nunca divergir: parcela×n bate com o total). `total geral = entrada +
  total no cartão` (o desembolso do cliente). Arredondamento robusto `round2 = Math.round((x+EPSILON)*100)/100`.
- **Entrada (opcional):** abate do saldo antes de aplicar a taxa. Trava se `entrada ≥ vista` (não sobra o que
  parcelar). Default vazio = comportamento sem entrada.
- **Copiar formas de pagamento (o recurso central):** o botão gera UMA mensagem com **à vista + 12x + 18x + 21x
  + a parcela simulada** (sem repetir se a simulada já for uma das principais; ordem decrescente). Se houver
  entrada, cada opção mostra o Total já com a entrada + uma linha "Entrada de R$ X no Pix ou dinheiro". Formato
  pronto pro WhatsApp (nome 👇, "FORMAS DE PAGAMENTO:", cada Nx + Total, "Valor à vista:"). Um aviso no card
  mostra ao vivo quais condições vão na cópia.
- **Permissão:** const nova **`MODULOS_LIVRES = new Set(['calculadora'])`** (index.html, antes do `showPage`) =
  módulos liberados a QUALQUER logado, sem passar pelo controle de perfil (não entra em `TODOS_MODULOS`/
  `PERFIS_DEFAULT_MODULOS`/tela de acessos). `showPage` pula a checagem de permissão pra esses ids;
  `renderSidebar` (`podeVer`) sempre mostra. Como a calculadora não faz query, **não precisou tocar no banco**
  (`tem_modulo`). Serve pra futuras ferramentas inofensivas.
- **Código (`index.html`):** símbolo `ic-calculator` (Lucide) no sprite; markup + `<style>` `.calc-*` logo
  após `#page-pdv`; `pageMeta`/`BREADCRUMB_MAP` `calculadora`; dispatch `initCalculadora` no `showPage`. Bloco JS
  `calc*/_calc*` logo após o roteamento (`showPage`/popstate): `_calcParseValor` (aceita `10.999,00`/`10999,00`/
  `10999.00`/`R$ …`), `_calcCondicao(base,n)`, `_calcMontarTextoFormas`, `_calcParcelasCopia` (principais+simulada),
  render do resultado (hero verde + linhas) e da tabela 1x–21x (12/18/21 em destaque). Rascunho no localStorage
  `sm_calc_parcelamento` (nome/valor/entrada/parcelas). Tema do sistema (dourado + valores em verde), responsivo.
- **Fora de escopo (decisão consciente):** o prompt-base pedia React/TS/Tailwind/PWA — ignorado, o sistema é
  `index.html` vanilla single-file; reusa `.card`/`.btn-pro`/`.input-pro`/`.table-pro`. Sem PWA (é config do
  sistema todo, não de um módulo).
- **Validado (localhost, navegador real, console 0 erro):** cálculo isolado (Node) bate com os casos do dono
  (12x=1.044,91/12.538,92 · 18x=733,27/13.198,86 · 21x=644,23/13.528,83) e com entrada (18x c/ R$2.000 =
  599,93); parser em 9 formatos; textos de cópia (com/sem entrada, simulada 15x/6x incluída sem duplicar 18x/21x);
  visual desktop+mobile (grid empilha ≤520px). **✅ commit `56f2a1e` pushed → GitHub Pages.**

## Galeria de fotos (várias por item) — produto + moto consignada (18/07/2026)
**Evolução do "1 foto" pra GALERIA (até 6 fotos por item), pedido do dono** (mais de um ângulo/detalhe;
tira na hora com o celular). Vale no **cadastro de produto** (por cor) e na **moto consignada** (moto de
cliente). A 1ª foto é a **capa** (aparece na listagem/card/vitrine); todas entram na galeria de divulgação.
- **Banco (migração `fotos_multiplas_produtos_consignacoes`):** `produtos.imagens jsonb` (array de URLs
  públicas) + `consignacoes.fotos jsonb` (array de paths). As colunas singulares viram a **capa**
  (retrocompat total): `produtos.imagem_url` = `imagens[0]` · `consignacoes.foto_path` = `fotos[0]`. Tudo
  que já lia a capa (lista, portal, vitrine) continua funcionando sem mudança.
- **Componente reutilizável (`index.html`):** `_gal*` (estado `_galState` por contexto `'prod'`/`'consigr'`,
  `_GAL_MAX=6`). `_galAdd` (aceita `multiple` + adicionar em várias vezes — 1 captura por vez no celular),
  `_galRemove`, `_galCapa` (★ move pra 1ª), `_galRender` (grid de miniaturas 84px com selo CAPA/★/×),
  `_galReset` (carrega as fotos existentes ao editar; revoga object-URLs), `_galFieldHtml` (markup pra modais
  gerados por JS), **`_galUpload(ctx,bucket,prefixo,urlMode)`** (sobe só os `file` novos, reaproveita os
  existentes, devolve o array na ordem — `urlMode=true`→URL pública/produtos, `false`→path/consignação).
- **Produto:** modal usa `#gal-prod-grid`; `prodOpenNovo`/`prodOpenEdit` chamam `_galReset('prod', …)`
  (edição carrega `item.imagens` com fallback pra `imagemUrl`); `prodSave`/`prodSaveNovo` sobem via
  `_galUpload` e gravam `imagens` + `imagem_url`(capa); `imagens` entrou no select/map de
  `carregarProdutosCatalogo`.
- **Consignação:** modal usa `_galFieldHtml('consigr','📸 Fotos da moto')`; `abrirReceberConsignacaoModal`
  faz `_galReset('consigr', …)` (fallback `fotoPath`); `_consigrSalvar` grava `fotos` + `foto_path`(capa).
  `consignacoes` mapeia por `toCamelArr` → `fotos` vem sozinho.
- **Portal (Edge Function):** `dados` conta TODAS as fotos por modelo (`fotosDoProduto`) e usa `imagens[0]`
  como capa; `materiais` **expande cada cor em vários itens** (uma por foto da galeria, rotulado "Cor (2)"…).
  `matsHTML`/`dlUrl` do portal já renderizam N imagens — sem mudança no `portal.html`.
- **Validado no localhost (18/07, 0 erro de JS):** helpers, add/capa/remover, **limite de 6**, modo edição
  (fotos existentes), `_galUpload` nos 2 modos (URL/path), campo da consignação, e o grid no modal por
  screenshot (CAPA/★/× corretos). **Fluxo real de upload → banco:** valida o dono ao vivo.

## Foto da scooter no cadastro + galeria de divulgação pro afiliado (18/07/2026)
**O que é:** o cadastro de produto ganhou **upload de foto** (por cor). A foto fica salva no cadastro e
é **reaproveitada no portal do afiliado**, agregada por modelo, como um **conjunto de imagens de
divulgação** (o afiliado vê/baixa). **Decisão do dono:** no CADASTRO a foto é **por cor** (cada linha de
`produtos`); no AFILIADO é **por modelo** (junta as cores do mesmo `produto_precos_id`).
- **Onde grava:** coluna **`produtos.imagem_url`** (já existia no schema, nunca tinha sido usada — 0/51
  preenchidas; herança do Tiny). Guarda a **URL pública completa** (não o path). Uma foto por produto/cor.
- **Storage:** bucket **público** `produtos` (migração `storage_bucket_produtos`) — leitura pública
  (URL estável, sem expiração, via `getPublicUrl`), escrita = `authenticated` + `tem_modulo('estoque')`.
  Espelha o bucket `consignacoes`. Path `<produto_id>/foto-<ts>.<ext>`.
- **Cadastro (`index.html`):** campo **"📸 Foto da scooter"** no modal do produto (`#prod-foto` +
  `#prod-foto-preview`, `accept="image/*"` → câmera/galeria no celular), logo após a Descrição. Helpers
  `_prodPreviewFoto` (preview do arquivo escolhido), `_prodFotoAtualHtml` (mostra a foto atual ao editar)
  e **`_prodUploadFoto(id,file)`** (sobe pro bucket + grava `imagem_url`; best-effort — se falhar, o
  produto ainda salva e avisa via toast). Integrado em `prodSave` (passo 2.5) e `prodSaveNovo`. `imagem_url`
  entrou no `select`/`map` de `carregarProdutosCatalogo` (campo `imagemUrl`). **Thumbnail** (34px) na célula
  do nome em `renderCatalogoProdutos`. `prodOpenNovo` limpa o campo; `prodOpenEdit` mostra a foto atual.
- **Portal do afiliado (Edge Function `portal-afiliado` + `portal.html`):** a foto do cadastro entra na
  **mesma galeria "Imagens & materiais"** que já existia (não criou UI nova). `?acao=dados`: `qtdImagens`
  por modelo passou a **somar as fotos do cadastro** (`fotosCadPorModelo`) — é o que faz a seção aparecer no
  card. `?acao=materiais&modelo=<id>`: devolve **primeiro** as fotos do cadastro (`produtos.imagem_url` das
  cores, URL pública direta — bucket é público) e **depois** os materiais do módulo Afiliados (signed URL 1h).
  `portal.html`: `matsHTML` inalterado (já renderiza thumbnails + download); **fix `dlUrl(u)`** — o botão
  Baixar montava `${url}&download=`, que quebra pra URL pública sem query string → agora usa `?` se a URL
  não tem query, `&` se já tem (signed). Vale pros dois tipos.
- **Validado no localhost (18/07, navegador real, 0 erro de console):** sintaxe dos 2 `<script>` (new
  Function); boot do sistema e do portal limpos; funções novas carregadas; modal abre com o campo, preview
  renderiza ao escolher imagem, foto atual aparece na edição; template do thumbnail gera `<img>` só quando
  há foto e escapa a URL; portal `matsHTML` + `dlUrl` corretos pra URL pública e signed. **NÃO** validado o
  fluxo real end-to-end (subir foto→banco→portal) — exige sessão logada + produção (fica pro dono).
- **Miniatura nas listagens (18/07/2026):** helper **`_thumbProdutoHtml(url,size)`** (foto ou placeholder
  🛵 pra manter o alinhamento) na **lista de Produtos** (thumb 40px à esquerda do nome) e na **gestão de
  Afiliados** (thumb 38px na linha, via **`_aflFotoModelo(ppId)`** = 1ª cor com foto do modelo em
  `produtosCatalogo`). No **portal**, a Edge Function `dados` devolve **`fotoCapa`** por modelo (=`capaPorModelo`,
  1ª cor com foto por nome) e o `cardHTML` mostra a **capa 52px** no card recolhido (`.vcapa`/`.vleft`;
  placeholder 🛵 quando o modelo ainda não tem foto). Layout: foto à esquerda, título à direita, infos abaixo —
  identifica a scooter sem abrir. Validado no localhost (helpers, thumbnails, card do portal por screenshot).
- **✅ NO AR (18/07/2026):** Edge Function `portal-afiliado` **v8** (verify_jwt=false, smoke test 401 sem
  token OK) + frontend commits `5c381e2` (base) + `28e7d69` (miniaturas) pushed → GitHub Pages. Bucket
  `produtos` criado via MCP.
- **PENDÊNCIAS (dono, não bloqueiam):** **(1)** validar logado — editar um produto, subir 1 foto, ver o
  thumbnail, abrir o portal de um afiliado visível e ver a galeria + baixar; **(2)** as fotos só aparecem
  pro afiliado nos modelos **`visivel_afiliado=true`** (hoje só o Skylo) — o dono escolhe quais. **Follow-up
  opcional:** exibir as fotos do modelo também na GESTÃO de afiliados (`abrirAflMateriaisModal`) — hoje o
  admin vê a foto só no cadastro de produto.

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
- **Provedor:** textmebot (premium, CustID 30592). A key boa fica na tabela `whatsapp_destinatarios` (`numero` + `api_key`). O **remetente** passou a ser o número principal do Gabriel **`+5521997507738`** (o mesmo que já é o **destinatário** ativo — envia e recebe no mesmo número, decisão do dono 07/07/2026). Vinculado via QR (tipo WhatsApp Web). A `api_key` é da conta (CustID 30592), não muda ao trocar o número logado. **Antes** o remetente era `+5521965107705`, que tomou **ban temporário do WhatsApp por erro operacional** (funcionário fez disparo em massa pra base fria de clientes) — não foi a ferramenta. Trocar o remetente na conta textmebot = **Logout** do número antigo em `status.php` e escanear o QR novo com o número desejado; só efetivou quando o campo "Sender's Phone number" mostra o número novo.
- **Dois disparadores, mesma fonte:**
  1. **Railway `resumoWhatsapp.js`** (cron 8h/20h) — resumos automáticos; espera 8s entre envios.
  2. **App** (avisos de evento: conta vencendo, OS pronta, SAC; prévia; teste) — via Edge Function **`wa-notify`** (key resolvida no servidor; nunca no front).
- **Avisos automáticos de afiliado/venda (08/07/2026) — ✅ no ar:**
  (a) **Nova venda registrada** → aviso no WhatsApp da loja (`5521997507738`) no `_pdvFinalizarVenda`
  (helper `_notificarVendaWhatsApp`, usa o snapshot `_pdvUltimoComprovante`: nº, cliente, vendedor,
  itens, total, entrega; fire-and-forget, nunca quebra a venda). Cobre o **PDV**; venda gerada pelo
  **CRM** (app à parte) precisaria do mesmo chamado — pendência. (b) **Novo auto-cadastro de afiliado**
  → aviso no WhatsApp da loja a partir da Edge Function `portal-afiliado` (`?acao=cadastro` chama a
  `wa-notify` com `Authorization: Bearer <service_role>`; nome/telefone/cidade/instagram). O **dedup**
  do `wa-notify` é por número|dia|mensagem, então as mensagens incluem nº do pedido / nome do afiliado
  pra não colapsar eventos diferentes. **Verificado ao vivo:** cadastro de teste disparou o aviso e a
  chave ficou no `wa_dedup` (que só permanece quando o envio dá certo) → WhatsApp entregue. O aviso de
  venda foi validado só na montagem da mensagem (dispara na próxima venda real do PDV).
- **Dedup no servidor:** `wa-notify` grava `wa_dedup(chave = numero|dia|mensagem)` e recusa repetição — a mesma msg/numero/dia sai 1x só (não importa quantos navegadores disparem). `__ping__` = healthcheck (não envia/dedup).
- **Se parar de chegar (remetente desconectado):** abrir `https://api.textmebot.com/status.php?apikey=<api_key do cadastro>` → escanear o QR no WhatsApp do remetente atual `+5521997507738` (Config → Dispositivos conectados → Conectar aparelho). Pra **trocar** o número remetente: **Logout** primeiro, depois escanear o QR novo com o número desejado e conferir o campo "Sender's Phone number". O link tem a key — não compartilhar. Vale ativar "Add Notification" lá pra avisar quando cair.
- **"Enviar pra si mesmo" — validado (07/07/2026):** remetente = destinatário = `+5521997507738`; teste real via `send.php` retornou "Sender: +5521997507738 / Result: Success!". Funciona (cai no chat "Você" do WhatsApp). Re-testar após qualquer novo re-vínculo.

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
- **Migrações aplicadas (04/07 — via Supabase MCP):** `contas_pagar_boleto_anexos` (colunas de boleto/anexo em `contas_pagar`), `storage_bucket_boletos` (bucket privado `boletos` + policies `tem_modulo('contas-pagar')`). Ver seção **"Contas a Pagar — dossiê do boleto"**.
- **Supabase MCP:** conectado à pasta do projeto (escopo local, HTTP+OAuth, `project_ref=sxmeuqlotjuchslevofv`) → Claude aplica migração/roda SQL/insere direto (reduz trabalho manual). Auth é OAuth do Gabriel.
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

## Painel de Afiliados — seleção de produtos, materiais e auto-cadastro (08/07/2026)
**Estado atual: ✅ NO AR.** Aba única "Produtos & materiais" (seleção-primeiro + visibilidade) e
**auto-cadastro pela campanha** publicados (GitHub Pages) e Edge Function `portal-afiliado` **deployada
v5** (`verify_jwt=false`). Migrações `afiliados_materiais_ficha_tecnica`, `afiliados_visivel_no_programa`
e `afiliados_cadastro_portal` aplicadas em produção. Smoke test da função ao vivo OK (cadastro cria
pendente · dedup 409 · sem-termo 400 · login de pendente avisa "em análise"; testes apagados).
**⚠️ Ação pendente do DONO (a vitrine do portal está VAZIA até isso):** entrar no admin (Afiliados →
Produtos & materiais) e **marcar quais produtos entram no programa** + preencher (preço mínimo, foto,
ficha, formas) — como a vitrine agora filtra por `visivel_afiliado` e há 0 marcados, o portal não
mostra nenhum produto até o dono selecionar. Só então mandar o link da campanha.
- **Preço sugerido (decisão do dono):** automático = **preço mínimo + delta do teto** (delta =
  `(teto − base)/incremento × passo` = R$ 800 com a escala atual), com **override manual** em
  `produtos_precos.preco_sugerido_afiliado` (preenchido vence o automático; vazio = auto). Teto da
  comissão em `config_custos.afiliado_comissao_teto` (**seed = 500**; 0/NULL = sem teto). O teto agora
  **capa a comissão** em `_aflComissaoEscalonadaUnit` (index.html) e `comissaoUnit` (Edge Function) —
  manter as DUAS em sincronia. Sem efeito retroativo (nenhum modelo tinha preço mínimo gravado).
- **Conteúdo comercial por modelo (texto livre, copiado literalmente no portal):**
  `produtos_precos.ficha_tecnica` e `.condicoes_pagamento` (formato do exemplo Cytron do dono:
  título + bullets de specs; parcelamentos com totais + valor à vista). NUNCA mencionar
  financiamento/crediário nesses textos.
- **Banco de materiais:** tabela `afiliados_materiais` (tipo imagem|arquivo, `produto_precos_id`
  NULL = material geral da loja, ordem, ativo) + bucket privado `afiliados-materiais` (50MB,
  policies `tem_modulo('afiliados')`). Portal só recebe **signed URL 1h** via Edge Function.
- **Admin (`index.html`) — aba única "Produtos & materiais" (reforma 08/07/2026):** as duas abas
  antigas ("Preço mínimo & comissão" + "Materiais de venda") foram **fundidas numa só**
  (`renderAfiliadosCatalogo`/`_aflRenderCatalogoInner`). Fluxo **seleção-primeiro**: cada modelo tem
  toggle **"No programa"** (`_aflSalvarVisivel` → `produtos_precos.visivel_afiliado`); **só os
  incluídos** mostram o checklist do que falta (`_aflItemFalta`: preço mín · foto · ficha · formas) —
  produto fora do programa não cobra preenchimento. Tabela por modelo: toggle · situação · preço de
  venda · **preço mínimo/sugerido inline** · comissão no sugerido · resumo de materiais · botão
  Preencher/Editar (abre o modal). Modal (`abrirAflMateriaisModal`) virou **editor do produto**:
  cabeçalho com toggle + "o que falta" (`_aflmRenderCabecalho`/`_aflmSetVisivel`), campos de preço
  mínimo/sugerido, ficha/descrição, formas de pagamento e upload de fotos/arquivos. Filtro de
  categoria **Scooters (padrão) / Acessórios / Todos** (`_aflCatalogoFiltrados`; scooter sempre
  inclui os já-visíveis pra acessório liberado não sumir). Escala global vira `<details>` recolhido.
  Helpers antigos mantidos (`_aflDeltaSugerido`/`_aflPrecoSugerido`/`_aflSalvarPrecoMinimo`/etc.).
- **Portal (`portal.html`):** vitrine virou **cards expansíveis** (preço mínimo→comissão base,
  ⭐ preço sugerido→comissão com "(máx)"), ficha/condições com **📋 Copiar** (clipboard + fallback),
  imagens/arquivos com download por signed URL (`?acao=materiais`, lazy), **indisponíveis
  recolhidos** por padrão (backlog UX item 2 ✅), seção "Materiais da loja" (materiais gerais).
- **Edge Function `portal-afiliado` (deployada v4 = versão com materiais/precoSugerido — a nota
  antiga de "deploy pendente" estava DESATUALIZADA):** `?acao=dados` retorna vitrine com id,
  precoSugerido, comissaoMinimo/Sugerido, fichaTecnica, condicoesPagamento, qtdImagens/qtdArquivos +
  `gerais` + `escala`; `?acao=materiais` (signed URLs 1h). Allowlist mantida (nada de custo/lucro).
- **Seleção de produtos visíveis (visivel_afiliado) — 08/07/2026:** coluna
  `produtos_precos.visivel_afiliado boolean default false` (migração `afiliados_visivel_no_programa`;
  espelho `.sql`). A vitrine do portal passou a filtrar por **`visivel_afiliado = true`** em vez do
  gate fixo "é scooter" → **permite liberar acessórios** também. Default false = **tudo começa
  oculto**; o admin escolhe. **No ar (Edge Function v5).** Como há 0 marcados, a vitrine começa vazia
  até o dono selecionar os produtos.
- **Auto-cadastro de afiliados pelo portal (campanha) — 08/07/2026:** a tela de login do
  `portal.html` ganhou **"Quero me cadastrar"** → formulário (nome, WhatsApp, e-mail, CPF=`documento`,
  cidade/uf, chave PIX, Instagram/como divulga) + **aceite de termo de uso** (rascunho `TERMO_TEXTO`
  no portal — dono pode ajustar). Envia pra Edge Function **`?acao=cadastro`** (nova) que insere um
  afiliado **`status='pendente'`, `ativo=false`, `criado_via='portal'`** (dedup por telefone/e-mail).
  Login continua **sem senha** (nome/e-mail + telefone); pendente/rejeitado não loga (login agora dá
  mensagem "cadastro em análise"). **Aprovação no painel:** aba "Afiliados" ganhou seção **"⏳
  Cadastros pendentes"** (`_aflRenderPendentes`/`_aflAprovarCadastro`/`_aflRejeitarCadastro`) — Aprovar
  = `status='aprovado'`+`ativo=true`. Migração `afiliados_cadastro_portal` (colunas status/cidade/uf/
  instagram/termo_*/criado_via + check de status; CPF reusa `documento`, PIX `chave_pix`, e-mail
  `email`). **✅ No ar** (portal.html publicado + Edge Function v5).
- **Correção da comissão "a receber" no portal (08/07/2026):** o portal mostrava "Comissão a receber" =
  `liberada + pendente`, **sem descontar o que já foi pago** → afiliado com comissão já paga ainda
  via "a receber R$X" (caso do Pedro: venda entregue e comissão paga, mas mostrava R$100 a receber). **Fix na
  Edge Function `dados`:** soma a comissão **já paga** das contas a pagar dele (categoria "Comissão
  Afiliados": lançamentos de saída OU `status='pago'` do "só marcar como paga") e retorna
  `comissaoPaga` + `comissaoAReceber = max(0, liberada − paga)`. **Portal:** KPIs viraram **Total
  vendido · Comissão já recebida · A receber · Aguardando entrega** (era liberada/pendente/a-receber
  confuso). **✅ No ar (Edge Function v6 + front pushed).** Verificado ao vivo com login real do Pedro:
  `comissaoPaga=100, comissaoAReceber=0` (portal mostra "A receber R$ 0").
- **Acesso rápido ao portal na tela de Afiliados (08/07/2026, ✅ no ar):** bloco fixo no topo do
  módulo Afiliados (`index.html`, dentro de `#page-afiliados`, **antes** das `.fin-tabs` → visível
  em todas as 4 abas) com o link `https://smartmotorsapp.com.br/portal.html`, botão **Abrir** (nova
  aba) e **Copiar link** (reusa `_cpCopiar`, mesmo padrão dos boletos). Objetivo: a loja copiar e
  mandar pros afiliados vinculados no WhatsApp. **O link é único/genérico** (login do portal é por
  nome-ou-e-mail + telefone cadastrados; não há URL por afiliado/token na mão do vendedor).
- **Validação (08/07):** banco conferido via MCP (colunas/tabela/bucket/4 policies/seed);
  portal com dados mock (cards/copiar/indisponíveis, 0 erro de console); admin ao vivo com a sessão
  do dono (salvar textos → upload PNG → signed URL HTTP 200 → remover → tudo revertido); advisors
  sem alerta novo.

### Backlog restante (pedido do dono 07/07/2026)
1. **Precificação dos afiliados** — política definida (ver `_memoria/empresa.md`), aguardando
   reunião dono+sócio pra gravar `preco_minimo_afiliado` (hoje 0 de 36 modelos) — o portal/admin
   novos já estão prontos pra receber os valores.
2. ✅ ~~UX esconder indisponíveis~~ (entregue 08/07 no portal novo).

## Compra Programada (cliente junta crédito até retirar a scooter) — no ar 10/07/2026
**O que é:** módulo novo (item próprio na sidebar, `ic-trending-up`) pro cliente que compra a
scooter **aos poucos** — paga o valor que quiser, quando quiser (sem parcela/vencimento/juros —
NÃO é financiamento), acumula crédito e retira quando o dono autoriza. **Regra de ouro:** enquanto
acumula, **NÃO existe pedido no PDV** (o faturamento lê `pdv_pedidos` e conta `aguardando_entrega`
também — `backend/resumoWhatsapp.js:93` —, então um pedido cedo inflaria a receita). A venda só
nasce na **entrega**, no mês da entrega.
- **Fluxo:** (1) cria o plano pro cliente (meta editável: modelo do catálogo OU valor livre; %
  liberação padrão 80% ajustável por plano); (2) registra pagamentos (cada um entra no **caixa na
  hora**, categoria "Adiantamento — Compra Programada" — fora da receita do DRE, que lê pedidos);
  (3) reserva a moto (modelo+cor+**chassi**) → **segura a unidade** (baixa 1 do estoque via
  `registrar_movimento` origem `reserva_compra_programada`, sem virar venda); (4) **entrega** →
  gera o `pdv_pedidos` (`origem='compra_programada'`, status entregue, no mês da entrega) **sem
  re-baixar estoque** (já baixou na reserva — igual à consignação); (5) cancelar → devolve com
  **retenção % editável (padrão 25%)** + saída no caixa + motos voltam ao estoque.
- **Duas datas (migração `compra_programada_entrega_data_venda`, 10/07/2026):** o dono pediu separar
  (1) **data de início** = `compra_programada.criado_em` (quando o cliente começou a juntar; mostrada
  no detalhe "iniciada em") e (2) **data da venda** = quando quitou e levou a moto (a data que conta
  como venda no faturamento). A entrega ganhou o campo **Data da venda** (default hoje, editável) →
  `cprog_entregar_moto(...,p_data_venda date)` grava essa data no `criado_em`/`data_entrega_real` do
  pdv_pedido e no `motos.data_entrega` (usa **meio-dia de Brasília** p/ não deslocar o dia por fuso);
  a **observação do pedido** registra a data de início. Assinatura da RPC mudou (drop+create;
  agora 6 args, execute revogado de public). Validado: venda em 15/06 caiu em 15/06 no fuso BR.
- **Vendedor & comissão (migração `compra_programada_vendedor`, 10/07/2026):** o plano tem
  `vendedor_id → pdv_vendedores` (NULL = **venda direta da loja**, sem comissão = registro interno
  "Smart Motors" comissão 0). Escolhido na criação do plano (editável). Na entrega, esse vendedor
  vai pro `pdv_pedidos.vendedor_id` → a **comissão (R$/moto de `pdv_vendedores.comissao_moto`)
  entra no CPV e é reconhecida no mês da entrega**, indo pra quem fez a venda (não pra quem entrega).
  Front: select "Vendedor" no modal novo/editar plano, mostrado no card e no detalhe, e
  pré-selecionado na entrega. Validado ao vivo (plano c/ Henrique → pedido saiu com vendedor_id dele).
- **Banco (migrações `compra_programada_*`, 10/07/2026):** tabelas `compra_programada` (cabeçalho,
  **1 plano ativo por cliente** via índice único parcial; meta_valor/meta_produto_precos_id/
  meta_descricao/pct_liberacao/status ativo|concluido|cancelado + `vendedor_id` + campos de cancelamento),
  `compra_programada_pagamentos` (aporte → `lancamento_id`), `compra_programada_motos` (produto_id/
  cor/chassi/preco travado/status reservada|entregue|cancelada/pedido_id). RLS `acesso_total` =
  `tem_modulo('compra-programada')`; módulo adicionado aos ramos **operacional + vendedor** de
  `tem_modulo` (espelhado em `PERFIS_DEFAULT_MODULOS` no front). Config em `config_custos`
  (`cprog_pct_liberacao_padrao=80`, `cprog_taxa_retencao_cancelamento=25` — subiu de 20 p/ 25 em
  12/07/2026 p/ bater com o contrato). 2 categorias de
  lançamento próprias (adiantamento=entrada s/ natureza; devolução=saida `nao_recorrente`).
- **RPCs SECURITY DEFINER** (deixam o **vendedor** operar sem ter o módulo financeiro; cada uma
  checa `tem_modulo('compra-programada')`, execute revogado de public/anon): `cprog_registrar_pagamento`
  (insere aporte + lançamento de entrada + ajusta saldo da conta), `cprog_reservar_moto` (cria +
  baixa estoque), `cprog_cancelar_moto` (estorna estoque), `cprog_cancelar_plano` (devolução c/
  retenção + estorna motos), `cprog_entregar_moto` (gera pdv_pedido+item+auditoria, marca entregue,
  **não** baixa estoque), `cprog_contas` (lista id+nome das contas p/ vendedor sem módulo financeiro).
- **Front (`index.html`):** registrado nos pontos-padrão (page `#page-compra-programada` com
  `#cprog-root`, `NAV_TREE` solo destaque, `TODOS_MODULOS`, `PERFIS_DEFAULT_MODULOS` operacional+
  vendedor, `pageMeta`, `BREADCRUMB_MAP`, dispatch `initCompraProgramada` no `showPage`). Bloco JS
  `cprog*` junto de Clientes (reusa `initClienteSearch`/`openCliQuickModal`, `enviarWhatsApp`,
  `_fmtBRMoney`/`_fmtBR`, `_cpCopiar`, `smAlert/smConfirm/smToast`). **Assinatura visual:** barra de
  progresso do acúmulo (com marca do ponto de liberação) + trilha vertical dos aportes (estilos
  `#page-compra-programada .cprog-*` num `<style>` antes da página). Lista (KPIs+cards) ↔ detalhe
  (barra + pagamentos + motos + ações). **Avisos WhatsApp** (`wa-notify`, best-effort): a cada
  pagamento + ao cruzar a liberação. **Recibo** = texto pra copiar (botão 📋 em cada aporte).
- **Validado (10/07/2026):** boot sem erro (console limpo, funções definidas); **teste E2E real**
  com a sessão do dono (criar plano → 2 pagamentos → reserva → entrega): estoque baixou na reserva
  (6→5) e **NÃO** re-baixou na entrega, saldo da conta subiu +R$1.500, 2 lançamentos na categoria
  certa, pdv_pedido gerado com chassi. **Dados de teste 100% apagados e estoque/saldo restaurados.**
  Advisors: só os avisos genéricos de função SECURITY DEFINER (mitigados com revoke de public).
- **✅ Publicado 10/07/2026** (commit + push na `main` → GitHub Pages); migração já em produção no
  Supabase. Falta só o dono validar no ar com uma venda real. O % de retenção de cancelamento (25%)
  fica editável (dono confirma com advogado).
- **Etiqueta + saldo a receber (migração `compra_programada_entrega_saldo_a_receber`, 10/07/2026):**
  (1) a relação de Pedidos (`renderPedidosUnif` ~9253) mostra o selo **"COMPRA PROGRAMADA"** quando
  `pdv_pedidos.origem='compra_programada'`. (2) Na entrega, se o crédito acumulado não cobre o preço
  da moto, `cprog_entregar_moto` **cria automaticamente uma conta a receber** do cliente com o saldo
  (categoria "Compra Programada", vencimento = data da venda). Crédito consumido pelas motos já
  entregues (ordem de entrega) → fecha certo com várias motos. Validado: pagou R$3k de moto R$10k →
  conta a receber R$7k criada. Quando o cliente pagar o saldo, marca recebido no Contas a Receber
  (entra no caixa) — sem dupla contagem (DRE reconheceu a venda na entrega; caixa recebe ao longo).
- **Follow-ups (menores, anotados):** a retenção de cancelamento fica no caixa sem reconhecimento
  contábil de receita (ajuste fino contábil, se o dono quiser). Reserva permite estoque negativo
  (só avisa), igual ao PDV.
- **Gerar contrato jurídico da compra programada (12/07/2026):** botão **"📄 Gerar contrato"** no
  detalhe do plano (sempre visível, dá pra reimprimir). Abre uma aba com o **contrato preenchido**
  (formato A4, botão Imprimir/Salvar PDF que some na impressão). Funções `cprog` no `index.html`:
  `_cprogGerarContrato` (valida dados via `_cprogFaltaContrato`; se faltar, abre
  `_cprogModalDadosContrato`), `_cprogModalDadosContrato` (form dos dados do comprador → **update em
  `clientes`** → gera), `_cprogEscreverContrato`/`_cprogAbrirContrato` (abre `window.open` no gesto do
  clique p/ não cair no popup-blocker; abre a janela ANTES do await do update), `_cprogHtmlContrato`
  (template do documento). **Migração `clientes_campos_contrato_compra_programada`:** add em `clientes`
  → `rg`, `estado_civil`, `profissao`, `nacionalidade` (def 'Brasileira'); o resto do endereço já
  existia (rua/numero/complemento/bairro/cidade/uf/cep). A query de carga dos planos (~26562) foi
  ampliada p/ trazer esses campos do cliente no join. **Dados do contrato:** empresa fixa (SMART
  MOTORS LTDA, CNPJ 64.020.071/0001-39, sede Itaguaí/RJ, assina Beatriz Rodrigues Polita — sócia adm.,
  pode isolada pela Cláusula 6ª do contrato social); comprador do cadastro. **Dois cenários (decisão
  do dono 12/07):** (1) há UNIDADE reservada → contrato trava modelo/cor/chassi e preço; (2) sem
  unidade reservada (o caso COMUM — cliente junta esperando modelos novos) → contrato **por valor/
  crédito** (valor de referência = meta, NÃO trava modelo nem preço; preço = tabela vigente na
  retirada). **Entrega só com 100% integralizado** — o ponto de liberação do sistema (80%) **NÃO vai
  pro contrato** (não expor liberação antecipada; se o dono quiser antecipar, é caso a caso, fora do
  papel). **Retenção 25%** puxada do config (contrato e sistema batendo). Base jurídica e cláusulas: repo raiz
  `juridico/contrato-compra-programada.md` (CDC art. 53 = veda perda total; retenção 25% = teto da
  faixa segura; arrependimento 7 dias art. 49; foro do consumidor; título executivo c/ 2 testemunhas).

## Custos Operacionais (sub-aba do Financeiro) — classificação de custos
**Estado (08/07/2026):** a aba classifica cada categoria de despesa por **natureza MANUAL**, não mais por variância estatística (que rotulava quase tudo como "variável" — 0 categorias fixas). Fonte da verdade = coluna **`categorias_lancamento.natureza`** (`fixo|semifixo|variavel|nao_recorrente`, nullable; NULL = "a classificar"). Editável no **modal de cadastro de categorias** (seletor "Natureza do custo").
- **Código (`index.html`):** `_naturezaDaCategoria(nome)` (lookup por nome) · `calcularCustosOperacionais(periodo)` (agrupa por categoria, classifica pela natureza; baldes `fixos/semifixos/variaveis/naoRecorrentes/semNatureza`; `total` = **recorrente**, EXCLUI não-recorrente; `item.alerta` = anomalia) · `renderCustos()` (4 baldes + "a classificar" + não-recorrentes à parte + inativos; variância virou **alarme ⚠️**) · `_custoFixoMensalMedio()` + `renderPontoEquilibrio()` (painel **⚖️ ponto de equilíbrio**: CF mensal médio fixos+semifixos ÷ margem de contribuição do DRE → vendas/mês de equilíbrio).
- **NÃO altera o lucro/resultado do DRE:** o resultado do mês usa a despesa REAL (`despReal`), intacta; a lista `_DRE_CATEGORIAS_FORA_DESPESA` idem. `renderPontoEquilibrio` só **LÊ** `calcularDRE`. **Ajuste 08/07:** `_despPlanejadoHistorico` (a linha de **referência** "Custo Fixo Planejado", que NÃO entra no resultado) passou a excluir não-recorrentes (natureza) + o mês de início parcial (1º lançamento depois do dia 5) → caiu de ~R$ 39,2k p/ ~R$ 33,6k, mais realista. Propaga pros outros consumidores da função (fôlego, análise IA, aba Vendas).
- **Classificação atual (16 categorias operacionais):** **Fixo** = Aluguel e Condomínio, Sócios (pró-labore), Marketing, Segurança, Sistemas/Ferramenta Gestão, Seguro · **Semifixo** = Funcionários, Veículos/transportes, Serviços Terceirizados, Água/Luz/Internet · **Variável** = Oficina-Peças, Compras Gerais, Taxas, Comissão Indicação · **Não-recorrente** = Obra Loja Nova, Eventos Comerciais. (Marketing=fixo e Eventos=não-recorrente foram pontos de julgamento — ajustáveis no cadastro.)
- **Pendências conhecidas:** (1) **Export Excel** (aba 4 do Fechamento, ~7036) ainda usa o shape antigo (`fixos/variaveis/indefinidos`) — roda, mas não mostra semifixo/não-recorrente. (2) aluguel do quiosque some nos meses de compensação/escambo (custo fixo invisível) — ver `empresa.md`. *(Resolvido 08/07: "Custo Fixo Planejado" do DRE deixou de somar não-recorrentes + mês parcial — ver acima. Resolvido 10/07: `Comissão Afiliados` saiu do "a classificar" — a categoria era gerada só nos lançamentos pelo fechamento de comissões (`~21092`), sem linha no cadastro; criada a categoria `Comissão Afiliados` em `categorias_lancamento` como Saída/**Variável** (via MCP) → o lançamento casa por nome e os fechamentos futuros já entram classificados. Não virou `Comissão Indicação` de propósito: o sistema recriaria "Comissão Afiliados" todo mês.)*
- **Auditoria original (3 agentes):** `~/projetos/Smart Motors/documentos/auditoria-custos-fixo-variavel-2026-07.md`. Contexto de negócio (obra = prejuízo esporádico; quiosque = escambo por venda de moto) em `~/projetos/Smart Motors/_memoria/empresa.md`.

## DRE + Raio-X Financeiro (Fluxo de Caixa) — análise de risco/alavancagem (09/07/2026)
Origem: sócio alegou "DRE toda errada". Auditoria (3 agentes) achou base sólida (receita competência + CPV
real por item) com 2 erros conceituais; reforma feita + módulo novo de risco de caixa. **Tudo em `index.html`.**

### DRE — `calcularDRE(iniISO,fimISO)` (~7980) e os 4 renders (aba DRE `_finDreRenderResumo` ~7257, widget Dashboard `renderDashDreMes`, Excel `gerarFechamentoMes`, conciliação DRE×Caixa `fcCarregarFechamento`)
- **Empréstimo só JUROS** (correção contábil): `_empDecomporPeriodo(ini,fim)` decompõe cada parcela paga em
  juros vs principal pela fração `(totalComJuros−valorOriginal)/totalComJuros`. Só os juros entram no
  resultado; o **principal é amortização de dívida** (sai no Fluxo de Caixa, não na DRE). Vale retroativo.
- **Extraordinários separados:** despesa dividida em `despRecorrente` vs `despNaoRecorrente` (pela coluna
  `categorias_lancamento.natureza='nao_recorrente'`, via `_naturezaDaCategoria`). Estrutura: Receita→CPV→
  Margem→Despesas(operação normal)→Juros→**RESULTADO DA OPERAÇÃO**→[Extraordinários]→**RESULTADO DO MÊS**.
  Campos novos no retorno: `despRecorrente`,`despNaoRecorrente`,`naoRecorrentes`,`empJuros`,`empPrincipal`,
  `resultadoOperacao`,`pctOperacao`,`mesParcial`,`mesParcialDesde`.
- **Aviso de mês parcial:** `_mesInicioParcial()` — se o 1º lançamento caiu depois do dia 5 (abril: 19/04),
  o mês tem despesa incompleta mas receita/CPV completos → resultado inflado; faixa de aviso na DRE.
- Ex. junho: operação **+14.544 (7,5%)**; mês (com extraordinários Eventos+Obra −20.735) **−6.191**. Antes
  o sistema mostrava −15.484 (a diferença era o principal do empréstimo).

### Raio-X de VIABILIDADE (card `#fin-fluxo-alavancagem`) — reforma 09/07/2026 (commit `e85fe68`)
Virou análise de analista financeiro: "posso assumir nova dívida (empréstimo/compra de estoque)?".
**CORREÇÃO CENTRAL:** a projeção antiga somava a receita quase inteira como sobra (não descontava a
reposição das motos vendidas) → "cabe assumir R$ 109k/mês" (irreal). Agora: geração = vendas −
**reposição** − variáveis (proporcionais à venda) − fixo. Sustentável ≈ **+R$ 18k/mês no ritmo 100%**
(consistente com DRE jun +14,5k).
- **`_fcGiroInfo(medias)`** — ratio de reposição (custo por R$ vendido) = vendasMes×custoUnit/entradasOp
  ≈ 0,693 (fallback `FC_CUSTO_RATIO_FALLBACK=0.68` se async não carregou) + pool em R$ = custo do estoque
  já comprado. **Sem dupla contagem:** o estoque atual é consumido do pool SEM desembolso novo (os boletos
  de fornecedor em aberto são o pagamento dele, contados nas datas); esgotado o pool (~2 meses), cada venda
  paga reposição à vista. Fallback conservador: sem dado, pool=0 → repõe desde o mês 1.
- **`fcGeraSustentavel(pct)`** — geração de regime. Alimenta KPI e o semáforo de crédito (que antes dividia
  por caixaOp bruto → 2,6% falso; agora serviço/geração no PICO futuro da parcela ≈ **54% 🔴**).
- **`fcRaioXObrigacoes(opts)`** — 12 meses (`FC_RAIOX_MESES=12`); mês corrente afinado (`fcMesCorrenteParcial`);
  opts.sim = `{tipo:'emprestimo'|'compra', valorTotal, entrada, parcela, nParcelas, inicioIdx, unidades}` —
  empréstimo ENTRA no caixa no m0; compra soma valorTotal ao pool (entra no giro). Legado `simMensal`/
  `simAVista`/`simParcelas` mantido (usado pelo `fcEspacoObrigacaoMensal`). Retorna também `custoRatio`,
  `coberturaMeses`, `geraSust(100)`, `estoqueUn0`, linhas com `vendas/custos/repor/forn/empr/saldo`.
- **Painel:** bloco **🩺 Saúde financeira** (caixa, estoque un+custo — loader async `fcCarregarEstoque` →
  `_fcEstoque`, com estado `.erro` sinalizado —, a receber, fornecedor, dívida, capital de giro líquido,
  liquidez seca, geração líquida, serviço da dívida pico) + cobertura de estoque + tabela 12m + simulador.
- **Simulador `_fcSimularViabilidade()`** — tipo (compra/empréstimo), valor total, entrada, nº parcelas,
  **mês da 1ª parcela** (`input type=month`; parser tolerante `_fcParseMesIdx` aceita AAAA-MM e MM/AAAA —
  Safari não tem month nativo, NUNCA ignora parcela silenciosamente), parcela (auto p/ compra = (total−
  entrada)/n; empréstimo exige a do banco), motos (informativo). Números via `_fcNumBR` (BR/US sem
  ambiguidade destrutiva). Compara com/sem, % da geração, avisos (mês inválido/passado/além da janela,
  parcelas fora do horizonte).
- **Coerência:** os vales do card Crédito (semáforo) vêm do motor novo; a projeção legada `fcProjecao`
  (sem reposição) ganhou nota de encaminhamento. **Auditoria por 2 agentes (matemática + dados)**: 0
  críticos; dados conferidos ao centavo; fixes aplicados (parsers, semáforo, loader erro, avisos).
  **Follow-ups anotados (menores):** UTC vs local na virada do mês (janela 21h-0h), matching case-sensitive
  de categoria no fixo vs normalizado nas variáveis, `_ym12` conta 13 meses (conservador), pico inclui
  parcelas vencidas, comentários defasados no legado.
- **`fcEspacoObrigacaoMensal(reserva)`** — busca binária: quanto de obrigação mensal nova ainda cabe
  (na expectativa de vendas ativa, com o motor novo).
- **KPI "💰 Espaço para nova dívida" (10/07/2026, pedido do dono):** card destacado (dourado) no
  `fin-fluxo-alavancagem`, logo após o veredito — `_espacoBloco` (~13140), usa `_espaco`
  (=`fcEspacoObrigacaoMensal`). Mostra a **parcela mensal** que cabe + a **equivalência total** (parcela×12
  e ×24, com nota de que juros reduzem o principal) + o cenário de vendas atual. `_espaco=0` (ex.: cenário
  pessimista padrão) → "não há espaço". Reflete o cenário selecionado (re-renderiza com `_fcSetVendas`).
- **Correção 12 meses do capital de giro (10/07/2026):** `_parc12m` (~13236) usava `ym <= _ym12` (mês+12) →
  contava **13** meses (o corrente entrava nas duas pontas), inflando o passivo de giro em ~1 parcela
  (R$ 9.898). Trocado p/ `ym < _ym12` = **12 meses cravados** (corrente + 11). Impacto: **Capital de giro
  líquido +61.580 → +71.478**; liquidez seca segue 0,19; **serviço da dívida, veredito 🟢🟡🔴 e "espaço p/
  dívida" NÃO mudam** (usam projeção por datas reais / pico, não a janela). Parcelas 12m: 111.471 → 101.573.
- **Expectativa de vendas ajustável:** global `_fcVendasPct` (default pessimista 50%); presets ½/−30%/−20%/
  Normal/+20% (`_fcSetVendas`); input em **% OU nº de vendas** (`_fcVendasPorPct`/`_fcVendasPorQtd`, onchange).
  Média-base visível (ritmo maio+junho ≈ 23 vendas ≈ R$ 218k = 100%); `fcCarregarVendasMedia()` conta os
  pedidos via `calcularDRE().pedidos.length` (async, 1× ao abrir; global `_fcVendasMedia`).
- **Base de vendas:** `fcMediasOperacao()` passou a EXCLUIR o mês de início parcial (`_mesInicioParcial`) —
  usa maio+junho, não abril (que puxava a média pra baixo). Propaga p/ projeção 12m, fôlego, semáforo, Raio-X.
- **Mês corrente afinado pelo ritmo real (`fcMesCorrenteParcial(medias)`, 09/07/2026):** o mês em curso
  projetava o resto SEMPRE pela média (resto = média × dias restantes), cego ao que o mês já fez. Agora a
  função nova calcula o **realizado** do mês (entradas de operação já no caixa = `medias.fluxo[ym].operacao.ent`),
  o **run-rate** (no ritmo de hoje o mês fecha em `realizado/diasDecorridos × diasMes`) e projeta o **resto**
  por um **blend** entre run-rate e média, com **trava de ruído**: peso do run-rate = 0 até `FC_MC_DIAS_MIN`
  (=10) dias de amostra, depois cresce com a fração do mês decorrida (`min(1, diasDecorridos/diasMes)`). Com
  peso 0 (começo do mês) **reproduz EXATAMENTE o comportamento antigo** (`entradasRestoMes == entradasOp ×
  fracaoRestante`) — nada muda antes do dia 10. `fcRaioXObrigacoes` usa `mc.entradasRestoMes` no mês corrente
  (i=0) e a média cheia nos futuros; retorna `mesCorrente: mc`. O card ganhou o **bloco "📅 mês (parcial ·
  dia X de N)"** (antes do controle de vendas): quanto já entrou (+ % do proporcional aos dias), o fecho no
  ritmo atual (+ % de um mês normal, cor verde/amarelo/vermelho ≥90/≥70/<70) e o status da trava (ritmo real
  vs média). Propaga automático p/ `fcEspacoObrigacaoMensal` e o simulador (chamam `fcRaioXObrigacoes`). A
  **projeção semanal** (`fcProjecaoSemanal`) NÃO foi tocada (curto prazo já usa datas reais dos boletos).
  Validado 09/07: sintaxe (new Function por bloco), lógica do blend (dia<10 idêntico ao antigo; dia≥10 afina
  forte/fraco; neutro no ritmo), browser real (função exposta, retorno certo com data de hoje dia 9/31, render
  sem erro, 0 erro de console).

### Projeção de curto prazo por DATA (card `#fin-fluxo-curtoprazo`) — timing intra-mês
- **`fcProjecaoSemanal(opts)`** — 8 semanas calculadas DIA A DIA: rotina (vendas−fixo−variáveis)/30 espalhada,
  mas boletos de fornecedor (`contas_pagar` balde estoque/inv/dívida) e parcelas de empréstimo caem na DATA
  REAL de vencimento (vencido→hoje). Retorna `semanas` (saldo ao fim) + `vale`/`valeData` (menor saldo diário).
  Captura o risco do boleto grande vencer antes das vendas entrarem (que a visão mensal esconde).

### Semáforo de crédito preexistente (mantido, régua 30/40) — `renderFinFluxo`, `fcSemaforo`, `fcServicoDividaMes`
Serviço da dívida ÷ caixa op médio (🟢≤30% 🟡≤40% 🔴>40%), fôlego, projeção 12m. A parcela inteira já entrava
certa no caixa (fontes independentes da DRE). Dono confirmou manter conservador (30/40).

### Premissas / limites conhecidos
- Custos fixos entram pela MÉDIA (não soma cada boleto de funcionário/aluguel — evita dupla contagem com os
  boletos operacionais, que viram `overlap`). Fornecedor/investimento/dívida entram individualizados.
- **Boletos SEM categoria no Contas a Pagar ficam FORA** da projeção principal (avisado). Regra: categorizar
  todo boleto. Base de vendas de só 2 meses (maio+junho) — folga depende de manter o ritmo.
- Contexto de negócio (fornecedor 50%+50% em 4 meses; discórdia dono×sócio sobre alavancagem) em `_memoria/empresa.md`.

## Comissão automática de vendedor interno (Contas a Pagar) — no ar 11/07/2026
**O que é:** a cada venda registrada, o banco gera/atualiza SOZINHO uma **conta a pagar de comissão por
vendedor/mês** (pedido do dono: acumular ao longo do mês e pagar todo mundo no **dia 5**). Espelha o
fechamento de AFILIADOS, mas pros vendedores internos. **100% no banco (trigger)** — o front NÃO mudou;
as contas aparecem no módulo Contas a Pagar normalmente.
- **Regra do cálculo:** `pdv_vendedores.comissao_moto` (hoje **R$100** p/ os 4 vendedores; Smart Motors=0)
  × nº de **scooters** (SCOOTER_RE = `/MOTONETA|TRICICLO|SCOOTER/i` no `produto_nome_tiny`). **Acessório NÃO
  conta.** Competência = **data da venda** (`criado_em`, fuso America/Sao_Paulo). Só pedidos **não
  cancelados** e **sem afiliado** (afiliado tem o fluxo dele). Vencimento **dia 5 do mês seguinte**.
- **Conta gerada:** `contas_pagar` id **`comvend-<YYYY-MM>-<vendedor_id>`**, categoria **"Comissão de
  Vendas"**, status pendente, `beneficiario`=nome, `comissao_competencia`. **Idempotente** (recalcula o
  total do mês do zero a cada evento) e **trava se `status='pago'`** (mês fechado não muda mais). Se o mês
  zera (sem scooter), a conta pendente é **removida**.
- **Não duplica no DRE:** a comissão já entra no **CPV** de cada venda; a categoria "Comissão de Vendas"
  está em `_DRE_CATEGORIAS_FORA_DESPESA` → pagar a conta **não conta 2×**. A conta a pagar é só o controle
  de quanto pagar a cada um.
- **Banco (migrações `comissao_vendedor_automatica` + `comissao_vendedor_revoke_execute`):**
  `fn_recalc_comissao_vendedor(uuid,text)` (SECURITY DEFINER, `search_path=public`) + trigger functions
  `trg_comissao_vend_pedidos()` (AFTER I/U/D em `pdv_pedidos` — nova venda, troca de vendedor, mudança de
  data, **cancelamento/exclusão** recalculam) e `trg_comissao_vend_itens()` (AFTER I/U/D em
  `pdv_itens_pedido` — os itens entram DEPOIS do pedido, é aqui que o valor ganha o nº de scooters).
  EXECUTE revogado de public/anon/authenticated (triggers rodam pelo sistema; fecha o aviso do linter).
- **Backfill julho/2026 aplicado:** **Michelle R$300** (3 scooters) · **Rafael R$200** (2 scooters), venc
  05/08. Meses anteriores NÃO foram tocados (o dono fecha como sempre fez).
- **Validado E2E via MCP (11/07):** venda nova 200→300 · cancelar 300→200 · reativar 200→300 · acessório
  não soma (fica 300) · excluir 300→200. Dados de teste apagados. Advisor: só os 3 avisos genéricos de
  SECURITY DEFINER, mitigados com revoke.
- **Escopo/limite:** **CRM e Compra Programada** são cobertos por gerarem `pdv_pedidos`. A **consignação
  recebida** também: vendida **pelo PDV** conta como scooter (tem pedido_id); vendida **pelo atalho**
  (sem pdv_pedido) entra pela extensão de `fn_recalc_comissao_vendedor` + gatilho
  `trg_comissao_vend_consignacoes` (migração `comissao_vendedor_inclui_consignada`, 13/07/2026) — ver
  seção "Consignação". Não há mais conta de comissão à parte pra consignada.

## Consignação — Enviada e Recebida (módulo, no ar 11/07/2026)
Aba **"Consignação"** no menu (item solo logo após Vendas; ordem: Vendas · Consignação · Afiliados · Compra
Programada · Produtos · Operação · Financeiro · Relatórios · CRM). Página `#page-localizacao` com **3 sub-abas**
(`switchConsigTab`, lembra em localStorage `sm_consig_tab`): **📊 Dashboard** · **📤 Consignação Enviada** · **🤝
Consignação Recebida**. `pageMeta`/`BREADCRUMB_MAP` = "Consignação".

### 📤 Consignação Enviada (= a tela `localizacao` antiga)
Motos que a loja DÁ a parceiros/quiosque + estoque da Matriz. `renderLocalizacao`, tabela `estoque_unidades`,
botão "+ Enviar moto". Inalterada (só migrou pra dentro da sub-aba). Funções `_loc*`.

#### 📈 Desempenho por parceiro — quem gira melhor o estoque (01/08/2026)
Pedido do dono: *"saber se o parceiro vende bem ou não, tempo médio pra vender/pagar… pra sabermos se
deixamos mais ou menos scooters lá"*. Card no **Dashboard** da aba Consignação (`renderConsigDashboard` →
`_consigDesempenhoHtml`), uma linha por **parceiro OU local próprio** (quiosque entra também), ordenado por
motos lá agora. Duas leituras por linha: **(a) situação** — quantas estão lá, `custo parado` (`.js-custo`) e
**há quantos dias está a mais antiga** (laranja acima de `LOC_DIAS_ALERTA`=30; é o indicador que diz se o
parceiro já está abarrotado); **(b) histórico** — chips de vendidas/permutas/devolvidas/sem pagar, dias médios
**até vender** (envio→venda) e **até pagar** (venda→dinheiro), e margem já gerada (`.js-custo`).
- **PERMUTA NÃO É VENDA** — coluna nova **`estoque_unidades.tipo_saida`** (`'venda'` default | `'permuta'`,
  migração `estoque_unidades_tipo_saida` + CHECK). Sem isso a troca do Leandro (ficou com a Savage e entregou
  a Tank) contava como venda e o painel dizia *"100% de conversão em 4,5 dias"* pra quem tinha vendido **1**
  moto em 8 dias. A unidade da permuta de 25/07 foi marcada. **Toda permuta registrada por SQL (ver seção
  acima) tem que gravar `tipo_saida='permuta'`.**
- **DEVOLVIDA conta contra** — `initLocalizacao` passou a carregar também `status='devolvida'` (antes só
  `no_parceiro`+`vendida`, então a taxa de venda seria sempre 100%). As listas da tela filtram por status, então
  nada de devolvida aparece em "Na posse"/"A receber".
- **Honestidade estatística (o ponto do card):** média vem sempre com **n e faixa** (`14 dias (4 vendas · de 5
  a 20)`) e, com menos de `CONSIG_MIN_AMOSTRA`=3 desfechos, sai o aviso *"Base pequena — serve de indício,
  ainda não de média"*. Com 8 motos e 1 venda real, ler o painel cru levaria à decisão errada (tirar do JR e do
  Caio, que receberam moto há 1–2 dias, e concentrar no Leandro).
- **Validado (localhost:8791, navegador real, 0 erro de JS):** cálculo com os dados reais de hoje (JR 4/R$
  22.440/0d · Caio 2/R$ 15.460/2d · Leandro 1 venda 8d + 1 permuta separada, margem 770) e com cenário maduro
  sintético (4 vendas 5–20 → média 14; 3 pagamentos 2–10 → média 5; 2 devolvidas; 1 sem pagar; mais antiga 47d
  em laranja; quiosque como local próprio). Gate `.js-custo` conferido com `body.sem-kpi-custo`: custo parado e
  margem **não** renderizam pro vendedor; giro e prazos continuam visíveis. Visual por screenshot.

#### "Marcar como pago" (moto que o parceiro vendeu) — estava QUEBRADO desde sempre (01/08/2026)
Sintoma do dono: *"Erro ao registrar pagamento: falha ao gerar pedido"*. **Causa:** `_locConfirmarPagar` gera um
`pdv_pedidos` (é o que faz a venda no parceiro entrar em faturamento/DRE) e mandava **`local_venda_id: null`** —
coluna **NOT NULL**. O insert era rejeitado sempre, então **esse botão nunca criou um pedido desde que foi
escrito** (conferido: 0 pedidos com `origem='consignacao'` vindos desse fluxo; o único é o #58, da consignação
RECEBIDA). Era o único insert do arquivo com `local_venda_id` nulo — todos os outros já passavam um id. Nada
ficava sujo: o código grava o pagamento **depois** do pedido, então a moto continuava em "A receber".
- **Decisão do dono (01/08/2026):** venda feita pelo parceiro entra num local próprio — criado
  **`pdv_locais_venda` "Parceiros"** (`codigo='parceiros'`, ordem 7, id `f4b91c55…`), pra não misturar com a
  Loja Matriz no relatório por local. Aparece também no select do PDV.
- **Fix:** helper **`_locIdLocalVenda()`** resolve o local **pelo código** (`parceiros`), não por UUID cravado:
  tenta `_consigrLocais` (memória, já carregado quando a tela de Consignação abre) → query no banco → fallback
  **Loja Matriz** se alguém apagar/inativar o "Parceiros" → `null` só se não houver local nenhum, e aí o erro é
  explícito ("Cadastre um em PDV › Locais de venda") sem gravar nada. O select de `_consigrLocais` passou a
  trazer `codigo`.
- **Numeração:** as tentativas que falharam **consumiram número** (`numero_smart` é identity — `nextval` não
  volta atrás): a sequence estava em 62 com o maior pedido real 60. Corrigida com `setval(...,60,true)` pra não
  abrir buraco na numeração. Vale a mesma conferência depois de qualquer insert que falhe em `pdv_pedidos`.
- **Validado (localhost:8791, navegador real, 0 erro de JS):** 6 cenários do `_locIdLocalVenda` (memória ·
  banco · fallback matriz · Parceiros inativo · offline · nenhum local) + E2E com o `sb` interceptado usando a
  moto real do Leandro — pedido sai com `local_venda_id` preenchido, item com produto/chassi, unidade marcada
  paga com `pedido_id`, **estoque NÃO baixa de novo** (já baixou no envio) e o lançamento de caixa abre;
  sem local cadastrado, erro claro e **zero** gravação.

#### Erro de chassi duplicado agora diz ONDE a moto está (01/08/2026)
O índice único **`uq_eu_chassi_ativo`** (`chassi` WHERE `status='no_parceiro'`) impede o mesmo chassi em duas
unidades ativas. A mensagem antiga do 23505 era *"Chassi X já está numa moto no parceiro."* — **não dizia onde**,
e quem cadastrava entendia que a moto estava na posse de terceiro. **Caso que motivou (01/08/2026):** o dono
enviou 4 motos ao **JR Scooter**; a 4ª (Savage Preta chassi **0488**) foi salva com destino **Quiosque** por
engano e a 2ª tentativa, agora pro JR, bateu no índice → ele parou e veio perguntar. **Fix:** helper
**`_locMsgChassiDuplicado(chassi, exceptId)`** (+ `_locDestinoNome(u)`), logo antes de `_salvarRegistroMoto`:
no 23505 busca a unidade dona do chassi (`status='no_parceiro'`, ignorando o próprio id na edição) e monta
*"Chassi 0488 já está registrado: MOTONETA SAVAGE 1000W - PRETA · PRETA está em Quiosque (enviada em
01/08/2026). Se for a MESMA moto, edite o registro que já existe…"*. Query só roda **no caminho de erro**
(custo zero no fluxo normal); se ela falhar (rede/RLS), cai pro `estoqueUnidades` já carregado na tela; sem
achar nada, texto genérico mandando buscar o chassi na lista. Usado nos **dois** pontos de 23505 (envio novo e
edição). `smAlert` renderiza `\n` (CSS `.sm-modal-msg` é `white-space:pre-wrap`).
**Validado (localhost:8791, navegador real, 0 erro de JS):** 5 cenários do helper (parceiro · quiosque · só a
própria linha na edição · fallback de memória com o `sb` offline · não-encontrado) + E2E com `sb` interceptado —
envio que estoura o índice mostra a mensagem certa, faz **1 insert**, **não** baixa estoque e devolve o botão pra
"Enviar"; edição aponta a OUTRA unidade (não a própria); **caminho feliz intacto** (payload + `registrar_movimento`
+ modal fecha). ⚠️ Ao stubar globais nesse arquivo, atribuir **sem `window.`** — `sb`/`estoqueUnidades`/
`_locParceiros` são `let` de escopo de script e não viram propriedade de `window`.

#### PERMUTA com o parceiro (moto por moto) — padrão criado 28/07/2026
Acontece quando o parceiro, em vez de vender a nossa moto consignada, **fica com ela e entrega outra moto
no lugar**. Não existe botão pra isso na tela (a tela só tem Vender / Devolver) — se registra **por SQL**.
**Não é venda:** o estoque troca de item, o caixa não se mexe e o patrimônio fica igual. Registrar como venda
criaria receita e lucro sem caixa e faria a moto recebida nascer com custo inflado (prejuízo artificial na
revenda). **Modelo = permuta pura, sem faturamento**, pelo **custo** dos dois lados:
1. **Moto recebida** → cadastro novo se o modelo não existe (`produtos_precos` + `produtos` da cor) com
   `custo_puro` = custo da moto entregue, e entrada no ledger via
   `registrar_movimento(prod,'entrada',1,'Troca com <parceiro> — permuta pela <moto>','troca',<unidade_id>)`.
2. **Moto entregue** (`estoque_unidades`) → `status='vendida'` + `pago=true` + `preco_venda`/`valor_pago` = **custo**
   (não o preço B2B) + `pedido_id` NULL + a explicação em `observacao`. O status `vendida`+`pago` some da tela
   (fica no histórico) e **não** entra no "A receber" do parceiro (`renderLocalizacao` filtra `vendida && !pago`);
   `devolvida` seria mentira (a moto não voltou) e o CHECK da tabela só aceita esses 3 status.
3. **Estoque NÃO volta** pra moto entregue (ela já baixou no envio ao parceiro e não retornou) e **nenhum**
   lançamento/pedido/conta é criado. O ganho da troca aparece inteiro na margem quando a moto recebida vender.
**Caso-base:** 25/07/2026 — Savage 1000W **Preta** (custo 7.590) ficou com a **Top Scooter Leandro**; entrou
**MOTONETA TANK 1000W - VERDE MILITAR** (60V 32Ah, 0km montada), modelo novo `Tank 1000W` no catálogo com os
mesmos custos/preço da Savage (custo real 7.830 · venda 11.499). Troca seca, sem dinheiro dos dois lados.
Diferente do **trade-in com cliente** (seção "Troca de veículo"), que é venda nova + permuta e gera pedido —
lá entra um consumidor final pagando; aqui é estoque por estoque entre lojistas.

### 🤝 Consignação Recebida (moto de TERCEIRO que a loja recebe pra vender)
- **Tabela `consignacoes`** (migração `consignacoes_recebidas_base`, RLS `tem_modulo('localizacao')`):
  consignante_cliente_id, produto_precos_id, produto_nome/cor/motor/fabricante/ano/estado/km, `itens_acompanham`
  jsonb (checklist do que veio junto), valor_repasse, preco_venda, comissao_vendedor, vendedor_id, `foto_path`,
  status (disponivel|vendida|devolvida), comprador_cliente_id, valor_venda, pedido_id, conta_pagar_repasse_id.
- **Registro** (`abrirReceberConsignacaoModal`/`_consigrSalvar`): dono via `initClienteSearch`, modelo do catálogo,
  dados da moto, **checklist de itens** (`_CONSIGR_ITENS_PADRAO`: Carregador/Chave reserva/Manual/Capa de chuva/
  Kit ferramentas + livre), valores com **margem ao vivo**, **foto** (upload/câmera → bucket público `consignacoes`,
  `consignacoes_bucket_fotos`; `_consigrPreviewFoto`/`_consigrFotoUrl`).
- **Lista** (`renderConsignacaoRecebida`/`_consigrCard`): cards com thumbnail, dono, chassi, itens, valores; ações
  Vender/Devolver/Editar/Excluir. **Dashboard** (`renderConsigDashboard`): resume as 2 pontas.
- **MARGEM escondida dos vendedores** via `.js-custo` (repasse e preço de venda ficam visíveis).
- **Venda — 2 caminhos, ambos geram PEDIDO + repasse a pagar + comissão do vendedor, sem duplicar
  (unificado 27/07/2026 — ver "Atalho passou a gerar pedido" abaixo):**
  1. **Atalho "Vender"** (`_consigrVender`/`_consigrConfirmarVenda`), p/ admin: gera **pdv_pedido**
     (`origem='consignacao'`, status entregue, `criado_em` = data escolhida no modal) + item com
     `custo_consignacao` + o recebimento escolhido (a receber / caixa / por fora) + repasse a pagar.
     Comissão vem pelo **gatilho do pedido**.
  2. **Pelo PDV** (fluxo dos vendedores): a consignada disponível aparece na busca do PDV ("SCOOTER modelo cor ·
     consignada (dono)"), `produto_id=null` (NÃO baixa estoque), item único, chassi pré-preenchido. Ao finalizar →
     pedido `origem='consignacao'` + `pdv_itens_pedido.custo_consignacao`=repasse+comissão; `_pdvProcessarConsignadas`
     marca vendida (WHERE disponivel) + gera repasse; a comissão vem pelo **trigger** do pdv_pedido. **DRE:**
     `calcularDRE` usa `custoConsig` (repasse) no lugar do custo do modelo → margem certa (ex. 8.000−7.000−100=900).
     Migração `pdv_itens_consignacao_vinculo`. **Venda normal do PDV 100% intacta** (validado).
- **Atalho passou a gerar pedido (27/07/2026) — o atalho era um BURACO de faturamento.** O dono estranhou que
  o Alessandro (comprador da Harley 16 consignada) não aparecia na tela de Pedidos. Causa: o atalho era
  "modelo passagem" **por decisão de projeto** — não criava `pdv_pedido`. Efeito colateral que não tinha sido
  percebido: como a **receita da DRE vem dos PEDIDOS** (`buscarVendasMescladas`), a venda ficava fora de
  Pedidos, faturamento, DRE, Relatórios, ranking do vendedor e `/meta-do-mes` — e a assimetria era pior que
  a omissão: o **custo** aparecia (repasse a pagar + comissão da Michelle no consolidado do mês) e a receita
  não. Julho estava em 14 vendas/R$ 134.956 em vez de **15 / R$ 142.886,50** (~R$ 830 de margem invisível).
  **Correção:** o atalho virou irmão do PDV — passo 0 de `_consigrConfirmarVenda` cria pedido + item
  (`produto_id` NULL, `custo_consignacao` = repasse + comissão, nome no padrão `SCOOTER … · consignada (dono)`
  pro SCOOTER_RE da comissão), grava `consignacoes.pedido_id` e **`criado_em` = data escolhida no modal**
  (competência da receita sai daí, não de `now()` — venda lançada dias depois cai no mês certo). Detalhes:
  (a) o modal ganhou **Vendedor** (default = o do cadastro; "Venda direta" = vendedor interno "Smart Motors",
  comissão 0) e **Local da venda** (default Loja Matriz) — `pdv_pedidos` exige os dois (NOT NULL) e o atalho
  não pedia nenhum; `initConsignacaoRecebida` passou a carregar `_consigrLocais` (a global `pdvLocais` só é
  populada na tela do Admin); (b) **formas de pagamento alinhadas ao PDV** (`dinheiro|pix|cartao_credito|
  cartao_debito`) — os códigos antigos `cartao`/`transferencia` viraram só rótulos de legado
  (`_CONSIGR_FORMAS_LEGADO`), senão o relatório de forma de pagamento ganharia linha fantasma; **transferência
  saiu** da lista (não existe no PDV); (c) **rollback** do pedido+item se qualquer passo seguinte falhar (senão
  sobra pedido órfão inflando faturamento/comissão); (d) o update final ganhou `.eq('status','disponivel')` —
  mesma guarda anti-venda-dupla do PDV (dá erro claro em vez de sobrescrever). **Comissão NÃO duplica** por
  construção: `fn_recalc_comissao_vendedor` só soma `consignacoes.comissao_vendedor` quando `pedido_id IS NULL`
  → com pedido, a comissão vem pelo item (comissao_moto × scooters). **Atenção:** com pedido, quem manda na
  comissão paga é `pdv_vendedores.comissao_moto` (R$ 100), não o campo `comissao_vendedor` da consignação —
  esse campo segue valendo só pro CPV (`custo_consignacao`); se algum dia forem valores diferentes, a comissão
  paga e o CPV divergem (mesmo comportamento do caminho PDV, que já era assim).
- **CPV da consignada nos Relatórios (`buscarLinhasVenda`) — follow-up ANTIGO resolvido em 27/07/2026:** a
  função não conhecia `custoConsig`, então a consignada caía no CPV **estimado** pela MC média do catálogo e a
  margem divergia da DRE (a reconciliação `reconciliarLinhasVendaDRE` acusaria delta). Como agora TODA venda de
  consignada gera pedido, isso passou a valer pra todas: ramo novo antes do `if (prod)` usa
  `cpvProduto = custoConsig × qtd` (`cpvEstimado=false`, categoria `scooter`, `comissao` 0 porque vem embutida
  no CPV, modelo sem o sufixo "· consignada (dono)" pra agrupar bonito). **Validado no navegador:** receita/CPV/
  lucro de Relatórios × DRE batem **ao centavo** (7.930,50 · CPV 7.100 + NF rateada · lucro 800,87).
- **Pagamento/adiantamento ao dono (12/07/2026):** a dívida com o dono só nasce na VENDA — antes disso o
  KPI do dashboard mostrava o repasse das disponíveis como se já fosse dívida. Agora: (1) tabela
  `consignacoes_pagamentos` (migração `consignacoes_pagamentos_ao_dono`: consignacao_id FK cascade, valor,
  data, forma, `no_caixa`, conta_id/conta_nome, `lancamento_id` FK→lancamentos, observacao; RLS
  `tem_modulo('localizacao')`) guarda quanto já foi pago/adiantado ao dono. (2) Botão **"💵 Pagar ao dono"**
  no card das **disponíveis** (`_consigrPagarDono`/`_consigrSalvarPagamentoDono`/`_consigrExcluirPagamentoDono`,
  modal com histórico) — duas opções: **sai do caixa** (escolhe a conta → gera lançamento de saída categoria
  'Consignação' + baixa saldo, padrão espelhado do pagamento de montagem) OU **só registrar** (pagou por
  fora, não mexe no caixa). (3) Card mostra `Repasse · Já paguei · Falta`; `initConsignacaoRecebida` anexa
  `c.adiantado` (soma) + `c.pagamentosDono` a cada consignação. (4) **Na venda (atalho E PDV), a conta a
  pagar do repasse nasce só com o SALDO** (repasse − adiantado); se já quitou nos adiantamentos, não gera
  conta. (5) Dashboard: **"A repassar aos donos"** passou a contar só as **vendidas** com saldo em aberto
  (dívida real) + KPI novo **"Adiantado aos donos"** (pago por motos ainda não vendidas). (6) **DRE:**
  `'Consignação'` entrou em `_DRE_CATEGORIAS_FORA_DESPESA` — o adiantamento/repasse sai do caixa (fluxo) mas
  NÃO vira despesa (o custo já entra no CPV via `custo_consignacao` na venda pelo PDV), sem dupla contagem.
  Validado E2E ao vivo (sessão do dono): adiantamento só-registro (não lança no caixa) e modo-caixa (lança +
  baixa saldo + exclusão restaura ao centavo) na Harley piloto, card/dashboard/venda conferidos, **dados de
  teste 100% revertidos** (saldo e adiantado voltaram ao original). O botão fica só nas disponíveis (depois
  de vendida, o repasse já é conta a pagar — paga-se pelo Contas a Pagar).
- **Vitrine pública** (link WhatsApp): Edge Function `consignados-publicos` (verify_jwt=false, service_role, expõe
  SÓ modelo/cor/specs/preço/foto — **NUNCA repasse/margem/dono/comprador**) + página `frontend/consignados.html`
  (dark/dourada, mobile-first, wa.me/5521997507738). Botão "🔗 Link da vitrine" (`_consigrCopiarLinkVitrine`) copia
  `smartmotorsapp.com.br/consignados.html`. Atualiza sozinha (só disponíveis).
- **Código:** bloco `consig*/consigr*` em `index.html` logo após `_locAbrirLancamentoConsignacao` + edições no PDV
  (`_pdvGarantirProdutos`, `_pdvAddItemFromIdx`, `_pdvFinalizarVenda`, `_pdvProcessarConsignadas`) + DRE
  (`buscarVendasMescladas`, `calcularDRE`).
- **Piloto → venda real fechada (Harley 16 Preta, `0a997642…`):** Andrisa (dona, `bfbae8e8…`) → **Alessandro de
  Melo Felisbino** (`efa327fc…`), **R$ 7.930,50 no cartão em 11/07/2026**, vendedora Michelle, recebimento
  lançado por fora (as entradas já estavam no caixa). Repasse de R$ 7.000 **pendente de propósito**: virou
  **crédito da Andrisa** na compra de outra scooter (decisão do dono 21/07) — abate no acerto quando ela comprar.
  **Regularização 27/07/2026:** a venda tinha sido registrada pelo atalho antigo (sem pedido) → criado o
  **pedido #58** retroativo (competência 11/07, `custo_consignacao` 7.100, `produto_id` NULL) e amarrado em
  `consignacoes.pedido_id`; a comissão da Michelle de julho **não mudou** (R$ 1.100 — a parcela "de consignada"
  virou "11ª scooter"). Também unificado o **cadastro duplicado** do Alessandro (o do cadastro rápido de 12/07
  foi apagado; ficou o completo `efa327fc…` com CPF/CEP/endereço/garantia).
- **⚠️ Sequence do `numero_smart` pode ficar atrasada depois de registro retroativo:** o pedido #57 (trade-in)
  foi inserido com `numero_smart` explícito, o que **não avança** a identity → o insert seguinte tentou 57 e
  bateu no unique. Corrigido com `setval('pdv_pedidos_numero_smart_seq', max(numero_smart), true)` (27/07).
  **Isso quebraria a próxima venda real no PDV** — depois de qualquer insert manual em `pdv_pedidos`, conferir
  `pg_sequences.last_value` vs `max(numero_smart)`. Melhor ainda: **não** passar `numero_smart` no insert.
- **Registro RETROATIVO de consignada (venda anterior ao módulo) — 21/07/2026:** a MC20 2000W da
  **Rosângela de Sá** (que comprou a Pixxel Vermelha, pedido Tiny #226 de 28/05) foi vendida ao **Renato de
  Assis Couto** por **R$ 8.100** em 30/05 (pedido Tiny **#231**, Michelle) e o repasse de **R$ 7.000** só foi
  pago em **21/07/2026** (Cora). Como a venda é do **Tiny** (sem `pdv_pedido`), foi registrada direto na
  tabela: `consignacoes` status `vendida` (`pedido_id` NULL, `produto_precos_id` NULL — a MC20 não está no
  catálogo) + `consignacoes_pagamentos` amarrando o `lancamento_id` da saída (categoria `Consignação`).
  **⚠️ Armadilha:** gravar `comissao_vendedor` > 0 nesse caso faz `trg_comissao_vend_consignacoes` **criar
  conta a pagar de comissão retroativa** (competência = `data_venda`) — comissão que já foi paga por fora no
  fechamento do mês. Registro retroativo vai com **`comissao_vendedor = 0`** e nota na observação. **Limite
  conhecido:** o **CPV dessa venda na DRE de maio continua estimado** pela margem média do catálogo (~30%),
  não pelos R$ 7.000 reais — `custo_consignacao` só existe em `pdv_itens_pedido`, e venda do arquivo Tiny não
  tem item de PDV. Sem correção retroativa possível; evita-se registrando a moto no módulo **antes** de vender.
- **Follow-ups:** ~~espelhar `custoConsig` em `buscarLinhasVenda`~~ ✅ feito 27/07/2026 (ver acima).
  `produtosTiny` do PDV cacheia na sessão — proteção contra vender 2x = update WHERE status='disponivel' (agora
  nos DOIS caminhos). **Aberto:** venda de consignada não imprime contrato pelo atalho (o gate do contrato vive
  no PDV); e o CPV de consignada vendida no arquivo **Tiny** (venda anterior ao módulo) segue estimado.

## Mural de Novidades (changelog da equipe) — tabela `novidades`
Changelog que a equipe vê num **pop-up 1×/dia no login** ("📣 Novidades") e é gerenciado no Admin ("Mural de
Novidades"). **100% dado no banco** (tabela `public.novidades`) — **não precisa commit/deploy**, a tela lê ao vivo
do Supabase e a mudança vale na hora.
- **Colunas:** `titulo` (obrigatório), `descricao` (texto simples; `\n\n` = parágrafo, renderiza `white-space:pre-line`),
  `data_publicacao` (date, ordena o pop-up — recentes no topo), `importante` (bool → ⭐/borda dourada; reservar pras
  principais), `ativo` (bool → some do pop-up se false). `id`/`created_at` têm default.
- **Código (`index.html`):** `initNovidades`/`renderNovidades`/`abrirNovidadeModal` (CRUD no Admin) + `_mostrarNovidadesDoDia`
  (pop-up; chave localStorage `sm_novidades_vistas_<data>` por dia/navegador → a nova leva aparece sozinha no próximo login).
- **Como atualizar:** skill **`/atualizar-novidades`** (`.claude/skills/atualizar-novidades/`) — levanta o que entrou de
  novo (via este CLAUDE.md), escreve em linguagem simples e grava via Supabase MCP (limpa e refaz, ou acrescenta).
- **Manter atualizado (regra por-evento — MECANISMO ATIVO):** sempre que uma feature relevante pra equipe vai **ao ar**
  numa sessão, **já atualizar o mural na hora** com a skill (acrescentar, sem esvaziar). É o jeito mais robusto — as
  novidades nascem nas sessões (onde o Supabase MCP funciona), então o mural fica fresco em tempo real; quando não há
  novidade, o pop-up repete as últimas sozinho. Avisar o dono na conversa.
- **Automação semanal no Mac — NÃO montada (limitação técnica, 13/07/2026):** a ideia era um LaunchAgent rodando
  `claude -p /atualizar-novidades auto`, mas o **Supabase MCP não carrega no `claude` headless** (é OAuth interativo →
  some no cron; confirmado por smoke test). Escrever no mural pelo cron exigiria a **service_role key** num arquivo local
  (acesso total ao banco) — trade-off de segurança que o dono precisa aprovar. Alternativa sem chave: o cron só **detecta
  e avisa no WhatsApp** "tem novidade pra publicar", e eu publico na sessão. **Decisão do dono (13/07/2026): ficar com a
  regra por-evento — sem cron/LaunchAgent** (não expor a service_role key no Mac; segurança > conveniência). O **modo
  `auto`** da skill (nunca esvazia · rotação ~6 · aviso textmebot) fica escrito caso o dono mude de ideia no futuro.
- **Estado atual (12/07/2026):** mural **limpo** (removidas as 5 novidades antigas de 14/06) e recadastrado com 5 itens
  recentes — **3 em destaque:** ⭐ Compra Programada (10/07), ⭐ Compra e Venda Consignada (11/07), ⭐ Sistema de Afiliados
  (08/07); + Comissão de venda automática (11/07) e Raio-X do caixa/DRE nova (09/07). CRM/WhatsApp ficou **de fora** de
  propósito (equipe ainda não usa — aguarda 360dialog).

## Troca de veículo (trade-in) — padrão de registro (25/07/2026)

**O caso que virou padrão:** Gabriel de Almeida Arruda comprou uma X-Buddy cinza em 17/04 (Tiny #194, R$ 8.500),
teve **módulo** (OS #13 → SAC #31, resolvido 26/05) e depois **autonomia** (resolvido, mas nunca aberto como caso —
registrado retroativo na timeline do SAC #31). Em **23/07** veio à loja, não quis mais a moto e trocou por uma
**Pixxel amarela**: crédito **integral de R$ 8.500** pela usada + **R$ 1.000** de diferença.

**Modelagem escolhida (e por quê):** é **venda nova + permuta**, NÃO devolução. Estornar a venda de abril mexeria
numa competência fechada (arquivo `tiny_pedidos`, DRE de abril) e não houve devolução de dinheiro. Registrar só a
diferença de R$ 1.000 como venda destruiria margem e faria a usada voltar "de graça".

**Regra de ouro:** `preço da venda nova = dinheiro recebido + valor de ENTRADA do usado + desconto`. O valor de
entrada é quanto se espera revender **menos** preparo/custos de vender. Crédito concedido acima disso é **desconto
comercial da venda nova**, não custo do usado — senão o estoque nasce superavaliado e a revenda nasce com prejuízo
artificial. *Neste caso* crédito (8.500) e revenda esperada (8.000) ficaram a R$ 500 → entrou pelo crédito cheio,
sem dividir (decisão do dono; a diferença aparece como o custo real da troca na revenda).

**Os 6 passos (repetir em toda troca):**
1. **SKU próprio por UNIDADE usada** — nunca reusar o SKU do modelo novo (o CPV vem do cadastro!). Par
   `produtos_precos` + `produtos` com **nome IDÊNTICO** (garante o match exato em `_matchProdutoPorNome`), nome
   contendo `MOTONETA` (SCOOTER_RE: rankings/comissão/chassi no PDV) e `SEMINOVA` (ver guard abaixo), sufixo com os
   4 últimos do chassi. Categoria segue `scooter` (senão some dos KPIs de estoque). `custo_puro` = valor de entrada.
2. **Entrada no ledger:** `registrar_movimento(produto, 'entrada', 1, 'Trade-in pedido #NN — chassi …', 'troca', pedido_id)`.
3. **Venda nova no PDV** com forma de pagamento **`troca_veiculo`** ("Veículo na troca") pelo valor do crédito + o
   que entrar em dinheiro. Baixa da moto nova é a normal.
4. **Caixa:** só o dinheiro real. A permuta vira **par casado** (entrada+saída, mesmo valor/data) na categoria
   **`Troca de Veículo`** — líquido zero, **neutro** nos baldes e **fora** da despesa da DRE (explica a receita sem
   caixa na conciliação sem inflar geração de caixa).
5. **Preparo:** peça comprada entra no custo de entrada da usada (vira CPV da revenda); mão de obra interna não.
6. **Histórico:** timeline no caso de SAC e observação no pedido amarrando venda antiga ↔ troca. **A venda antiga
   NUNCA é cancelada/editada.**

**Código (commit desta data):**
- `PDV_PAGTO_TIPOS` ganhou `troca_veiculo` — sem isso o vendedor registraria a permuta como dinheiro/pix e quebraria
  a conciliação de caixa e o relatório de forma de pagamento.
- **`_ehSeminovo(p)` + guard em `_matchProdutoPorNome`:** seminova só casa por nome **EXATO**; fica fora de TODOS os
  fallbacks fuzzy. **Motivo (bug evitado):** o fallback do "buddy" pega o **1º** cadastro que casa `/buddy/i` e a
  ordem de `products` é por `id` (arbitrária) — sem o guard, cadastrar a X-Buddy seminova mudaria o **CPV retroativo
  de abril/maio** das X-Buddy novas. Validado no navegador com a seminova em 1º na lista: venda antiga segue
  custoPuro 6.100, seminova casa 8.500.
- `Troca de Veículo` em `_DRE_CATEGORIAS_FORA_DESPESA` + `FC_BALDES` (neutro nos 2 lados).

**Registro do caso (produção, 25/07/2026):** SKU `MOTONETA X-BUDDY SEMINOVA - CINZA #1052` (`produtos_precos`
`6b90b8df…` custo_puro 8.500 / venda-alvo 8.000; `produtos` `25f0b8ea…`, estoque 1) · **pedido PDV #57**
(`88546f79…`, competência **23/07**, total 9.500 = troca 8.500 + pix 1.000, vendedor **Smart Motors** = venda direta,
**sem comissão** — o CPV da Pixxel fica 6.980 e a margem **+2.520**) · Pixxel baixada (estoque 0) · conta a receber
R$ 1.000 venc. **27/07** · par casado 8.500 na Cora · 2 eventos na timeline do SAC #31.
**Resultado econômico da troca:** +2.520 na Pixxel − ~630 na revenda da usada a 8.000 (8.000 − 8.500 − NF − comissão)
≈ **+1.890**. **Riscos anotados:** (a) 8.000 numa seminova com histórico de defeito é otimista — se sair por 7.000 o
resultado cai pra ~900; (b) crédito integral só se sustenta quando o modelo novo tem margem gorda — régua pra próxima:
**crédito ≤ preço de revenda − custo de vender**; (c) a seminova entra com MC% negativa no cadastro e puxa levemente
pra baixo o `avgMCpct` (fallback de CPV estimado de item sem cadastro).
**Follow-ups não feitos (não bloqueiam):** coluna `condicao` novo/seminovo p/ relatório separado · campo de vínculo
`troca_origem` no pedido · assistente "Registrar troca" que faz os 6 passos · a forma de pagamento do R$ 1.000 está
como `pix` (chute) — trocar se ele pagar em dinheiro/cartão.

## Oficina / Pós-venda (SAC) — custo do serviço liberado + trava anti-duplicata (28/07/2026)

Painel unificado (`renderOficinaSac`) com as duas visões; modais `abrirOfModal` (OS, tabela
`oficina_ordens`) e `abrirSacModal` (garantia, `sac_casos`). Dois ajustes pedidos pelo dono depois que o
**Henrique** relatou os problemas na loja:

- **Custo do serviço agora aparece pra TODOS os perfis.** Os campos `Mão de obra (custo R$)` (= o que a
  loja paga ao técnico terceirizado) e `Peças usadas (custo)` existiam desde 22/06/2026 (`oficina_sac_custo.sql`),
  mas estavam com a classe **`js-custo`** → escondidos de quem não tem módulo financeiro/custos. O vendedor
  (perfil `vendedor`, caso do Henrique) só via "Valor do serviço" e não tinha onde lançar o custo. **Decisão
  do dono (28/07):** liberar **campos + resumo Receita/Custo/Lucro** dentro da OS, e também a linha
  `Lucro`/`Custo` de cada card na lista — quem atende precisa registrar o combinado com o técnico, e o
  resultado do serviço é derivável do que ele mesmo digitou. Mesma liberação no **SAC** (custo da garantia).
  **NÃO muda** custo/margem de PRODUTO (moto), que segue escondido pelos gates de sempre; os 2 KPIs
  agregados do mês ("Lucro de serviços" / "Custo de garantias", `renderOficinaSacKpis`) **continuam** com
  `_podeVerCusto()` — são visão de gestão. Pontos tocados: `abrirOfModal`/`abrirSacModal` (classes),
  `ofRecalcResumo`/`sacRecalcResumo` (gate removido), `renderOficinaSac` (sublinhas Lucro/Custo).
- **OS duplicada — corrigido.** Sintoma do Henrique: "de vez em quando salva duas OS iguais e eu excluo uma
  na mão". **Causa:** `_ofSalvarReal` não travava o botão durante o `await` do insert (o PDV e as Montagens
  já travavam) — dois cliques (ou toque duplo no celular, ou clicar de novo achando que travou) disparavam
  dois inserts. **Evidência:** OS **#75 e #76** (Ana Romina, PIT, "pneu furado", R$ 450) idênticas, criadas
  com **6 microssegundos** de diferença — os dois requests saíram juntos, típico de rede lenta segurando o
  1º envio. **Fix:** flag síncrona `_ofSalvando` + `btn.disabled`/"Salvando..." (id novo `of-btn-salvar`),
  com o corpo antigo extraído pra `_ofSalvarExec` e `try/finally` restaurando o botão em caso de erro. A
  flag é o que realmente segura (pega os dois cliques no mesmo tick); o disabled é o aviso visual. **Mesma
  trava no SAC** (`_sacSalvando`, `sac-btn-salvar`, `_sacSalvarExec`) — tinha o mesmo furo.
- **Validado (localhost:8791, navegador real, 0 erro de console novo):** com sessão simulada de `vendedor`
  e `body.sem-kpi-custo` ativo, os campos de custo aparecem e o resumo mostra "Receita 450 · Custo 250 ·
  Lucro 200"; dry-run interceptando o `sb`: **3 cliques → 1 insert** na OS e no SAC, botão volta ao normal
  quando o insert dá erro e a 2ª tentativa passa (flag não fica presa).
- **Limite conhecido:** a trava vive no front — navegador com o `index.html` antigo em cache segue
  vulnerável até recarregar. Se voltar a acontecer, a rede de segurança seria um guard no banco (rejeitar OS
  igual criada em < 2 min); não foi feito pra não arriscar falso positivo.

## Histórico de mudanças

### 2026-08-01 (tarde) — Desempenho por parceiro no Dashboard da Consignação
Pedido do dono, pra decidir quantas scooters deixar em cada parceiro. Card novo com motos lá agora + custo
parado + dias da mais antiga, e histórico de vendidas/permutas/devolvidas com tempo médio pra vender e pra
pagar. Duas correções de fundo pra métrica não mentir: coluna `estoque_unidades.tipo_saida` separando
**permuta de venda** (a troca com o Leandro inflava a conversão dele pra 100%) e carregamento das
**devolvidas** (sem elas, taxa de venda seria sempre 100%). Média sempre com n + faixa e aviso de base
pequena abaixo de 3 desfechos. Validado no navegador com dados reais e cenário maduro; gate `.js-custo`
conferido. Seção "Desempenho por parceiro". **Ressalva dita ao dono:** com 1 venda real na base, o painel
ainda não sustenta decisão de alocação — ele passa a valer conforme acumula.

### 2026-08-01 (tarde) — "Marcar como pago" da consignação enviada consertado (nunca tinha funcionado)
Leandro (Top Scooter) vendeu a Savage Vermelha 0347 e pagou; ao registrar, o dono tomou *"Erro ao registrar
pagamento: falha ao gerar pedido"*. Causa: o insert de `pdv_pedidos` mandava `local_venda_id: null` numa coluna
NOT NULL — **o botão nunca gerou pedido desde que foi escrito** (0 pedidos por esse fluxo no banco). Criado o
local de venda **"Parceiros"** (decisão do dono: separar venda de parceiro da Loja Matriz no relatório) e o
insert passou a resolvê-lo pelo código via `_locIdLocalVenda()`, com fallback pra matriz e erro claro se não
houver local. Sequence do `numero_smart` (adiantada em 2 pelas tentativas que falharam) reajustada pra 60.
Validado no navegador (6 cenários do helper + E2E com `sb` interceptado; estoque não baixa 2×). Seção
"Consignação Enviada". **Falta o dono clicar em Confirmar pagamento na moto do Leandro** (R$ 8.500).

### 2026-08-01 — Chassi duplicado: erro passou a dizer onde a moto está (+ correção de dado no JR Scooter)
Dono enviou 4 motos ao **JR Scooter - Junior** e travou na 4ª ("fala que já está na posse de alguém").
Diagnóstico: a Savage Preta chassi **0488** tinha sido salva com destino **Quiosque** por engano (12:45:55,
logo depois das outras 3) e a 2ª tentativa bateu no índice único `uq_eu_chassi_ativo`. **Dado corrigido no
banco:** unidade `b3fe221d…` movida pra JR Scooter (estoque não mudou — a baixa de 1 já tinha ocorrido no
envio; o motivo do movimento `5e80824d…` ganhou nota da correção). JR Scooter fica com 4 motos ativas:
Savage Vermelha B0017 + Savage Preta 0488 (8.600 cada) e Konek 800 Preta 6203 + Cinza 6164 (5.300 cada) =
**R$ 27.800 a receber**. **Causa raiz atacada:** a mensagem do 23505 não dizia ONDE o chassi estava — agora diz
modelo, destino e data (`_locMsgChassiDuplicado`), ver seção "Consignação Enviada". ⚠️ **Aberto:** o Konek
saiu a R$ 5.300 pro parceiro, R$ 200 abaixo da política de atacado de 01/08 (R$ 5.500) — confirmar com o dono
se foi negociação por volume ou digitação.

### 2026-07-28 — Oficina: custo do serviço visível pro vendedor + fim da OS duplicada
Dois relatos do Henrique pelo dono. (1) Só aparecia "Valor do serviço" ao registrar OS — os campos de custo
(mão de obra do técnico terceirizado + peças) existiam mas estavam atrás da classe `js-custo`, que esconde
margem de quem não tem módulo financeiro; **dono decidiu liberar campos + Custo/Lucro do serviço pra todos**
(na OS, no SAC e nas sublinhas da lista; custo/margem de moto e os KPIs do mês seguem restritos). (2) OS
duplicando "de vez em quando" — confirmado no banco: **#75/#76 idênticas com 6µs de diferença**, duplo envio
sem trava no botão. Adicionada trava anti-duplo-clique na OS e no SAC (flag + `disabled`, padrão do PDV).
Validado no navegador (3 cliques → 1 insert; campos visíveis como vendedor). Seção **"Oficina / Pós-venda (SAC)"**.

### 2026-07-27 — Consignada vendida pelo atalho agora GERA PEDIDO (buraco de faturamento fechado)
O dono estranhou que o comprador da Harley consignada (**Alessandro**) não aparecia na tela de Pedidos.
Diagnóstico: o atalho "Vender" da tela de Consignação era **modelo passagem** por decisão de projeto (não
criava `pdv_pedido`) e, como a **receita da DRE vem dos pedidos**, a venda ficava fora de Pedidos/faturamento/
DRE/Relatórios/ranking — **mas o custo aparecia** (repasse + comissão). Julho estava 14 vendas/R$ 134.956 em
vez de 15/R$ 142.886,50. **Feito:** (1) **retroativo** — pedido **#58** criado no banco pra venda de 11/07
(R$ 7.930,50, Michelle, `custo_consignacao` 7.100, `produto_id` NULL, amarrado em `consignacoes.pedido_id`);
comissão da Michelle intacta (R$ 1.100) porque `fn_recalc_comissao_vendedor` ignora consignação com pedido;
(2) **causa** — `_consigrConfirmarVenda` passou a criar pedido+item igual ao PDV (com Vendedor e Local novos no
modal, formas alinhadas ao vocabulário do PDV, `criado_em` = data da venda, rollback do pedido e guarda
`status='disponivel'`); (3) **`buscarLinhasVenda`** ganhou o ramo de `custoConsig` (follow-up antigo) →
Relatórios × DRE batem ao centavo; (4) cadastro duplicado do Alessandro unificado; (5) **sequence do
`numero_smart` corrigida** (`setval`) — estava atrasada desde o registro retroativo do trade-in e **quebraria a
próxima venda do PDV**. Validado: sintaxe, dry-run interceptando o `sb` nos 3 modos de recebimento (payload de
pedido/item/consignação/caixa/a receber/repasse conferidos), rollback com falha simulada, guarda de moto já
vendida, e reconciliação Relatórios×DRE no navegador. Detalhe na seção **"Consignação — Enviada e Recebida"**.

### 2026-07-18 — Galeria de fotos (várias por item): produto + moto consignada
Evolução do "1 foto" pra **até 6 fotos por item** (ângulos/detalhes; tira na hora no celular), pedido do dono.
Vale no cadastro de produto (por cor) e na consignação (moto de cliente). 1ª foto = capa. Banco: `produtos.imagens`
+ `consignacoes.fotos` (jsonb; migração `fotos_multiplas_produtos_consignacoes`), com os campos singulares virando
a capa (retrocompat). Componente `_gal*` reutilizável (add/remover/definir capa/upload, máx 6). Portal: Edge Function
`materiais` expande cada cor em vários itens (galeria completa). Validado no localhost (0 erro; grid por screenshot).
Seção **"Galeria de fotos (várias por item)"**. **✅ NO AR:** migração + Edge Function **v9** + commit `b1fd6d5` → GitHub Pages.

### 2026-07-18 — Foto da scooter no cadastro + galeria de divulgação pro afiliado (NO AR)
Pedido do dono: subir foto no cadastro de produto e reaproveitar na tela do afiliado. Decisão: foto **por
cor** no cadastro (`produtos.imagem_url`, coluna que já existia e nunca fora usada), **por modelo** no
afiliado (junta as cores → conjunto de imagens de divulgação). Feito: bucket público `produtos` (migração
`storage_bucket_produtos`); campo de upload+preview no modal do produto + thumbnail na lista (index.html);
Edge Function `portal-afiliado` passou a devolver as fotos do cadastro por modelo (dados+materiais),
reusando a galeria existente do portal + fix `dlUrl` (download de URL pública). **Refino (mesma data):**
miniatura já na **listagem** (não só ao abrir) — lista de Produtos (thumb 40px + placeholder 🛵), gestão de
Afiliados (thumb do modelo) e **capa 52px no card do portal** (`fotoCapa` da Edge Function v8). Layout foto à
esquerda / título à direita / infos abaixo. Validado no localhost (0 erro; card do portal por screenshot).
**✅ NO AR:** Edge Function v8 + commits `5c381e2`+`28e7d69` → GitHub Pages; bucket `produtos` via MCP.
Seção **"Foto da scooter no cadastro..."**. Pendência do dono: validar logado + marcar modelos visíveis.

### 2026-07-18 — Calculadora de Parcelamento no ar (simulador pro vendedor)
Módulo novo (item de menu solo logo abaixo do PDV) pro vendedor simular o preço no cartão e mandar as condições
pro cliente no WhatsApp. Taxa = nº de parcelas + 2%; total = parcela×n; **entrada opcional** (Pix/dinheiro) abate
do saldo antes da taxa; botão **Copiar** gera uma mensagem única com à vista + 12x/18x/21x **+ a parcela
simulada** (sem duplicar). 100% client-side (sem banco); liberado a todos via `MODULOS_LIVRES` (não precisou
tocar em `tem_modulo`). Vanilla, no tema do sistema. Detalhe na seção **"Calculadora de Parcelamento"**. Validado
no navegador (cálculos batem com os casos do dono, parser, textos de cópia, desktop+mobile). **✅ commit `56f2a1e`
pushed → GitHub Pages.** Refinado em 3 rodadas de feedback do dono (entrada, cópia das principais, cópia inclui a
simulada) — tudo aprovado.

### 2026-07-13 — Consignação: múltiplas formas + recebimento + comissão na automática; CEP no cadastro rápido
Pedidos do dono na sequência (a venda real da Harley destravou tudo). **(1) Venda pelo atalho** (`_consigrVender`/
`_consigrConfirmarVenda`): forma única → **lista de formas** (cartão+pix+transferência, cada uma com valor, total soma
sozinho; helpers `_consigrAddForma`/`_consigrRemoveForma`/`_consigrLerFormas`/`_consigrRecalcFormas`) + seletor de
**Recebimento** (`_consigrRecebChg`): *a receber* (conta a receber, como antes) · *lançar no caixa agora* (entrada em
`lancamentos` na conta escolhida, categoria 'Consignação', +saldo, com rollback) · *já lancei por fora* (não mexe no
caixa nem cria a receber). `forma_pagamento` jsonb virou `{metodos:[{tipo,valor}], recebimento}`. **(2) Comissão da
consignada integrada na automática:** a venda pelo atalho **não cria mais** a conta `consigr-<id>-comissao` separada;
`fn_recalc_comissao_vendedor` **estendida** (migração `comissao_vendedor_inclui_consignada`) soma as consignadas
vendidas pelo atalho (`status='vendida'`, `pedido_id IS NULL`, competência=data_venda) × `comissao_vendedor`, e o
**gatilho novo `trg_comissao_vend_consignacoes`** (AFTER I/U/D em consignacoes) recalcula sozinho → cai na conta mensal
`comvend-<mês>-<vendedor>`, junto com as scooters do PDV (paga no dia 5). Consignada vendida pelo PDV tem pedido_id e já
conta como scooter → filtro evita dobra. **(3) CEP no cadastro rápido** (`#cli-quick-modal` +
`openCliQuickModal`/`salvarCliQuick`, usado na consignada E na compra programada): campo "Endereço" único → **CEP com
auto-preenchimento ViaCEP** + rua/número/complemento/bairro/cidade/uf (espelho do PDV; `_cliqAgendaCep`/`_cliqBuscaCep`),
grava nos campos separados de `clientes` + `endereco` consolidado. **Harley real** (Andrisa→Alessandro) ajustada no
banco: valor 8.000→**7.930,50** (líquido; margem 830,50), conta a receber automática (8.000) **removida** (lançada por
fora), comissão (100) **integrada** na da Michelle de julho (300→**400**), repasse 7.000 **mantido** (paga pelo Contas a
Pagar). Validado: localhost (sintaxe, UI formas/recebimento, CEP real, **dry-run interceptando o `sb`** confirmou o que
cada modo grava) + banco (recálculo, advisors sem alerta novo). **✅ commit `c16b8f1` pushed → GitHub Pages.**

### 2026-07-12 (tarde) — Mural de Novidades refeito + skill `/atualizar-novidades`
Dono pediu pra refazer a tela de Novidades mostrando só as implementações recentes. Mural limpo (5 antigas de 14/06
apagadas) e recadastrado com 5 itens (3 em destaque: Compra Programada, Consignada, Afiliados; + comissão automática e
Raio-X financeiro), em linguagem simples. É dado na tabela `novidades` (sem deploy). Criada a skill local
**`/atualizar-novidades`** pra automatizar as próximas levas. Ver seção **"Mural de Novidades"**.

### 2026-07-12 (tarde) — CRM WhatsApp: decisão de coexistência (360dialog) + código adaptado (bi-provider)
Dono retomou o CRM pra ligar o WhatsApp e decidiu por **coexistência via 360dialog** (mantém o número atual
da loja ativo no app + CRM ao mesmo tempo; ~R$300/mês de fee, mensagens iguais à Meta). Descartou a migração
direta (tiraria o número do app) e o "número novo dedicado" do plano original — coexistência só existe via
BSP. `crm-send` e `crm-meta-webhook` adaptados p/ **bi-provider** (`CRM_WA_PROVIDER=meta|360dialog`, default
`meta` = intacto/reversível): envio via `waba-v2.360dialog.io`+`D360-API-KEY`, webhook por HTTP Basic, **echo
de coexistência** (`message_echoes`→saída no CRM, pra sincronizar o que a equipe responde pelo celular) e
roteamento por conteúdo do `value`. **Ainda NÃO deployado** (aguarda conta/API key do 360dialog + push).
Guia do dono: `documentos/whatsapp-360dialog-onboarding.md`. Detalhe: seção **"WhatsApp via coexistência
(360dialog)"**. Pré-reqs do dono OK (número já no WhatsApp Business 7+ dias, CNPJ+docs).
Sintoma do dono: o dashboard mostrava "R$ 7.000 a repassar" com a moto ainda **disponível** (não vendida) —
a dívida com o dono só existe na venda. E ele precisava registrar quando **adianta parte do repasse antes de
vender** (e, na venda, pagar só a diferença). Feito: tabela `consignacoes_pagamentos` (migração
`consignacoes_pagamentos_ao_dono`), botão "💵 Pagar ao dono" nas disponíveis (sai do caixa OU só registro),
card com `Repasse · Já paguei · Falta`, **venda cobra só o saldo** (repasse − adiantado, nos 2 caminhos),
dashboard "A repassar" só das vendidas + KPI "Adiantado aos donos", e `'Consignação'` em
`_DRE_CATEGORIAS_FORA_DESPESA` (sem dupla contagem). Detalhe na seção **"Consignação — Enviada e Recebida"** →
"Pagamento/adiantamento ao dono". Validado E2E ao vivo (dados de teste revertidos ao centavo). **✅ Commit
`6ed711b` pushed → GitHub Pages, produção confirmada.**

### 2026-07-11 (tarde) — Consignação: venda pelo PDV + foto + vitrine pública (MÓDULO COMPLETO)
Fechou os 3 pedidos do dono. **Venda pelo PDV:** a consignada disponível aparece na busca do PDV ("SCOOTER X ·
consignada (dono)"), `produto_id=null` (não baixa estoque próprio), item único; ao finalizar → pedido
`origem=consignacao` + `custo_consignacao` (repasse+comissão) + marca vendida + gera repasse; a comissão do
vendedor vem pelo trigger normal. **DRE:** CPV usa o custo pela consignação (`custoConsig`), não o do modelo →
margem certa (R$ 900). Migração `pdv_itens_consignacao_vinculo` (`pdv_itens_pedido.consignacao_id` +
`custo_consignacao`). Venda normal 100% intacta. **Foto:** bucket público `consignacoes`
(`consignacoes_bucket_fotos`) + campo upload/câmera (`accept=image/*`) no modal + preview + thumbnail no card +
`consignacoes.foto_path`. **Vitrine pública:** Edge Function `consignados-publicos` (verify_jwt=false,
service_role, expõe SÓ modelo/cor/specs/preço/foto — NUNCA repasse/margem/dono) + página
`frontend/consignados.html` (dark/dourada, mobile-first, wa.me/5521997507738); botão "🔗 Link da vitrine"
(`_consigrCopiarLinkVitrine`) copia `smartmotorsapp.com.br/consignados.html`. Validado (sintaxe + chrome-devtools:
PDV normal intacto, item consignado não baixa estoque, DRE margem R$900, vitrine renderiza sem vazar dado
sensível). Detalhe vivo em `_memoria/tarefa-atual.md`. **✅ commit + push → GitHub Pages.**

### 2026-07-11 — Módulo Consignação (recebida + reorg do menu) — parcial no ar
Nova aba **"Consignação"** (menu: item solo **logo após Vendas**; saiu do grupo Produtos) com **3 sub-abas**:
📊 Dashboard · 📤 Consignação Enviada (a antiga tela `localizacao` — Matriz/Quiosque/parceiros) · 🤝 Consignação
Recebida (**NOVA** — moto de terceiro que a loja recebe pra vender). Tabela `consignacoes` (migração
`consignacoes_recebidas_base`, RLS `tem_modulo('localizacao')`). Fluxo: registrar (dono via `initClienteSearch` +
moto + **itens que vieram junto** `_CONSIGR_ITENS_PADRAO` + valores) → lista de cards → atalho **"Vender"**
(`_consigrVender`/`_consigrConfirmarVenda`: gera **conta a receber** do comprador + **repasse a pagar** ao dono +
**comissão** do vendedor — modelo PASSAGEM, sem `pdv_pedido`/DRE) → **Devolver**. **Margem escondida pros
vendedores** (`.js-custo`; repasse e preço de venda ficam visíveis). Dashboard (`renderConsigDashboard`) resume as
duas pontas. Funções no bloco após `_locAbrirLancamentoConsignacao`. Piloto Andrisa/Alessandro migrado pra tabela
nova (Harley 16 Preta disponível). Ordem do menu: Vendas · Consignação · Afiliados · Compra Programada · Produtos ·
Operação · Financeiro · Relatórios · CRM. **PENDENTES (pedidos do dono):** 📸 foto (upload/câmera no registro) · 🛒
**venda pelo PDV** (fluxo que os vendedores usam) · 🔗 vitrine pública (link WhatsApp com as consignadas + foto/
preço, sem margem/repasse/dono). Detalhe vivo em `_memoria/tarefa-atual.md`. Validado no localhost (sintaxe +
chrome-devtools: menu, sub-abas, dashboard, modais, bloqueio de margem). **✅ commit + push → GitHub Pages.**

### 2026-07-11 — Comissão automática de vendedor (Contas a Pagar por gatilho)
Pedido do dono: a cada venda, acumular R$100 de comissão por vendedor no Contas a Pagar, vencendo dia 5 do
mês seguinte, pra pagar todos de uma vez. Feito **100% no banco** (trigger em `pdv_pedidos` +
`pdv_itens_pedido` → `fn_recalc_comissao_vendedor`, idempotente, trava se pago). R$100 × nº de scooters
(acessório não conta), por data da venda, sem afiliado/cancelado. Backfill julho: Michelle 300, Rafael 200
(venc 05/08). Validado E2E (venda/cancelamento/reativação/exclusão/acessório) via MCP, dados de teste
apagados. O front não mudou (as contas aparecem no Contas a Pagar). Ver seção **"Comissão automática de
vendedor interno"**. Migrações `comissao_vendedor_automatica` + `comissao_vendedor_revoke_execute`.

### 2026-07-10 — Módulo Compra Programada no ar
Módulo novo (item próprio na sidebar) pro cliente juntar crédito aos poucos até retirar a scooter,
sem virar faturamento até a entrega. 3 tabelas + 6 RPCs SECURITY DEFINER (vendedor opera sem módulo
financeiro) + config (80% liberação / 20% retenção) + 2 categorias de lançamento. Front: lista+detalhe
com barra de progresso (assinatura), pagamentos→caixa, reserva→segura unidade no estoque, entrega→gera
pdv_pedido sem re-baixar, cancelamento→devolução com retenção. Validado E2E ao vivo com a sessão do dono
(estoque/saldo/lançamento/pedido conferidos, dados de teste apagados). Seção completa: **"Compra
Programada"**. **✅ commit + push → GitHub Pages.**

### 2026-07-10 — KPI "Espaço para nova dívida" + correção 12m + KPIs gerenciais em Produtos > Cadastro
Três pedidos do dono. **(1) PDF explicativo do Raio-X** (`documentos/Raio-X-Viabilidade-Guia-Smart-Motors.pdf`,
7 págs, fonte `.html` ao lado — pasta `documentos/` é local/gitignore): guia pra leigo/sócio de cada indicador
(caixa/estoque/a receber/fornecedor/dívida/capital de giro/liquidez seca/geração líquida/serviço da dívida),
com números reais batendo com a tela. **(2) KPI "💰 Espaço para nova dívida"** no Raio-X + **correção da janela
de 12 meses** do capital de giro (`ym < _ym12`) — ver seção "DRE + Raio-X Financeiro" → Raio-X de VIABILIDADE.
**(3) Tela Produtos > Cadastro (`renderCatalogoProdutos` ~10159): KPIs trocados por leitura gerencial** —
**Prontas p/ venda · Em montagem · Scooters em estoque · Modelos disponíveis · Acessórios em estoque · Valor
em estoque** (valor só admin). "Em montagem" = `montagensItens` status fila+montando (mesmo critério do módulo
Montagens; o dono confirmou que a moto em montagem JÁ entra no `produtos.estoque` → **prontas = scooters −
em montagem**). Montagem×estoque são módulos **desacoplados** (montagem liga a produto só por texto; receber
não dá entrada no estoque) — o desconto assume a regra operacional do dono. Os antigos Com saldo/Zerados/
Negativos viraram **chips discretos** (`#estoque-kpi-chips`, reusam `catKpiFiltrar`); botão "ver mais" removido.
**Validado no localhost logado** (sessão do dono): Produtos = 37 prontas/1 montagem/38/10 modelos/27 acess.;
Raio-X = capital giro +71.478/liquidez 0,19/espaço R$0 no pessimista, R$22.714/mês no Normal; 0 erro de console.
**Commit `a83c98c` pushed → GitHub Pages.**

### 2026-07-09 (noite) — Raio-X de VIABILIDADE: motor com reposição de estoque + saúde/capital de giro + simulador de dívida
Pedido urgente do dono (precisava analisar um pedido de compra à noite). Reforma completa — ver seção
**"Raio-X de VIABILIDADE"**. Bug de fundo corrigido (projeção não descontava reposição → "cabe R$ 109k/mês"
irreal; sustentável real ≈ +18k/mês), painel de saúde financeira (capital de giro, liquidez seca, serviço da
dívida honesto ~54% no pico 🔴), projeção 12m, simulador tipo/valor/entrada/parcelas/mês. **Inventário físico
aplicado no banco via MCP** (38 motos; ajustes com trilha via `registrar_movimento`; Cytron Preta/Vermelha
criadas; 66 cadastros zerados inativados; Baú re-categorizado acessorio na tabela produtos). Validação: modelo
de referência independente (node) × motor real = 100% idêntico; 18/18 parsers; auditoria por 2 agentes (0
críticos, fixes aplicados). **Commit `e85fe68` pushed → GitHub Pages, produção confirmada.**

### 2026-07-09 — Raio-X: mês corrente afinado pelo ritmo real (com trava de ruído)
Fecha o último item do backlog do Raio-X. O mês em curso projetava o resto SEMPRE pela média (cego ao
desempenho parcial). Nova função `fcMesCorrenteParcial(medias)`: mostra quanto o mês **já vendeu** (entradas
de operação no caixa) + o **run-rate** (no ritmo de hoje o mês fecha em X), e projeta o **resto** por um blend
run-rate×média com **trava** — peso 0 até o dia 10 (poucos dias enganam), depois cresce com a fração do mês.
Com peso 0 **reproduz exatamente o número antigo** (hoje, dia 9, nada muda nos valores — só aparece o bloco
informativo; a partir do dia 10 o afinamento entra). `fcRaioXObrigacoes` usa o resto afinado no mês corrente
(propaga p/ "quanto cabe" e simulador); card ganhou o bloco "📅 mês (parcial · dia X/N)". Projeção semanal
intacta. Detalhe na seção **"DRE + Raio-X Financeiro" → Raio-X de Obrigações**. Validado (sintaxe, lógica do
blend, browser real 0 erro). **Aguarda validação do dono no ar + push.**

### 2026-07-09 — DRE corrigida + Raio-X Financeiro (análise de risco/alavancagem)
Sócio alegou "DRE toda errada"; auditoria (3 agentes) mostrou base sólida com 2 erros. **DRE:** empréstimo
passou a entrar só pelos JUROS (principal é amortização, vai pro caixa); despesa separada em operação normal
vs gastos extraordinários (não-recorrentes); aviso de mês parcial (abril). **Raio-X de Obrigações** (card novo
no Fluxo de Caixa): consolida caixa de hoje + tudo que já vence (fornecedor pelas datas, empréstimo, custo
fixo pela média) contra vendas projetadas → veredito "posso assumir mais dívida/estoque?" com reserva de
segurança (1 mês de fixo). Simulador de 3 campos (entrada+parcela+nº). Expectativa de vendas ajustável (% ou
nº de vendas, média-base visível). **Projeção por data** (card novo): 8 semanas dia-a-dia, boletos nas datas
reais, mostra o vale intra-mês. Base de vendas passou a excluir abril parcial (usa maio+junho). Ver seção
**"DRE + Raio-X Financeiro"**. Validado: sintaxe, lógica com dados reais (junho: operação +14.544 / mês −6.191),
boot sem erro, render por screenshot. **✅ Commit pushed → GitHub Pages.**

### 2026-07-08 — Afiliados: aba única "Produtos & materiais" + auto-cadastro pela campanha
Dois pedidos do dono na sequência, mesma frente. **(1) Unificação + seleção-primeiro:** as abas
"Preço mínimo & comissão" e "Materiais de venda" viraram **uma só** ("Produtos & materiais"), com a
lógica invertida — **primeiro escolher quais produtos entram no programa** (toggle "No programa" =
`produtos_precos.visivel_afiliado`, default false), e **só dos escolhidos** o sistema cobra o
preenchimento (preço mínimo, foto, ficha técnica, formas de pagamento). O portal passou a mostrar o
que estiver marcado visível (qualquer categoria → dá pra liberar acessório, não só scooter). **(2)
Auto-cadastro:** `portal.html` ganhou tela "Quero me cadastrar" (dados pessoais + aceite de termo) →
Edge Function `?acao=cadastro` cria afiliado **pendente**; aprovação na aba "Afiliados" (seção
"Cadastros pendentes"); login segue sem senha, só aprovado entra. Migrações
`afiliados_visivel_no_programa` + `afiliados_cadastro_portal` aplicadas via MCP (ver seção "Painel de
Afiliados"). **Validado no localhost** (DevTools, 0 erro de console): aba nova renderiza, round-trip
real de gravar/reverter visível+preço no banco (RLS ok), editor do produto, seção de pendentes com
Aprovar/Rejeitar (testado com afiliado-teste inserido e depois apagado via MCP), formulário do portal
(validações + payload + card de sucesso com fetch mockado). **✅ Publicado** (commits `41caec1`+
`19021a0`+sync pushed → GitHub Pages) e **Edge Function deployada v5** (smoke test ao vivo OK:
cadastro/dedup/termo/login-pendente). **Pendente do DONO:** marcar no admin quais produtos entram no
programa — a vitrine do portal fica vazia até isso (filtra por `visivel_afiliado`, 0 marcados).

### 2026-07-08 — Afiliados: botão de acesso rápido ao portal na própria tela
A pedido do dono, a tela **Afiliados** ganhou um bloco de **acesso rápido ao portal** no topo (acima das abas, visível em todas): link `https://smartmotorsapp.com.br/portal.html` + botão **Abrir** (nova aba) e **Copiar link** (reusa `_cpCopiar`). Objetivo: a loja copiar e mandar pros afiliados vinculados no WhatsApp sem sair do sistema. Só front (12 linhas em `index.html`, dentro de `#page-afiliados`), sem banco/Edge Function. Validado no localhost via DevTools (bloco renderiza, href/target/rel/onclick corretos, ícones `ic-link`/`ic-clipboard` no sprite, 0 erro de console; screenshot na sessão logada do dono). **✅ Commit `bf4371f` pushed → GitHub Pages (no ar).** Ver seção **"Painel de Afiliados"**.

### 2026-07-08 — "Vendedor" vira perfil padrão de verdade (era `customizado` por workaround)
O dono personalizou o acesso do **Henrique** (perfil `customizado`) e pediu pra isso virar o **perfil padrão de Vendedor** aplicado a todos os vendedores. **Causa de estarem em `customizado`:** a função de RLS `tem_modulo` só tinha ramos `admin`/`operacional`/`customizado` — perfil `vendedor` caía no `else false` (RLS negava tudo), então usar o perfil literal quebrava o banco; a UI de acesso já tinha a opção "Vendedor", só faltava o banco reconhecer. **Fix (completa a arquitetura):** (1) migração **`tem_modulo_perfil_vendedor`** adiciona o ramo `when u.perfil='vendedor' then p_modulo = any(array[...12 módulos...])` (demais ramos intactos); (2) **`PERFIS_DEFAULT_MODULOS.vendedor`** (index.html ~11381) atualizado pros mesmos 12 módulos (**adicionou `localizacao` e `crm`, removeu `afiliados`** — o default antigo tinha afiliados, risco latente de expor comissão que o QA de 28/06 apontou → resolvido) + rótulo do selector corrigido; (3) **Henrique, Rafael, Samuel e Michelle** → `perfil='vendedor'`, `role='usuario'`, `modulos_permitidos='[]'` (via MCP). **Rafael e Samuel GANHARAM o módulo `localizacao`** (o Henrique tinha, eles não) — intencional, "todos idênticos". **Michelle** (o dono corrigiu logo depois: ela também é vendedora — antes `customizado` + `contas-receber`, email `operacional_michelle@`) virou `vendedor` padrão e **PERDEU o `contas-receber`** (decisão do dono: todos exatamente iguais). Eduardo (operacional/rejeitado) **não foi tocado**. **Fonte única:** mudar o perfil de vendedor agora = editar `PERFIS_DEFAULT_MODULOS.vendedor` + o array do `tem_modulo` (manter os dois iguais). **Validado:** RLS testado com o contexto de auth real do Henrique (libera dashboard/vendas/estoque/localizacao/oficina-sac/crm/pdv; **bloqueia** financeiro/afiliados/contas-receber/custos/precos); front no localhost (`modulosPermitidos` do vendedor == banco, `_podeVerCusto()=false`, 0 erro de console). **✅ Banco em produção (MCP) + front commit pushed → GitHub Pages.**

### 2026-07-08 — Impressão volta no painel unificado Oficina/Pós-venda (+ doc de garantia novo)
Sintoma do dono: "sumiram os botões de impressão da Oficina e Pós-venda pros vendedores". **Causa (não era gate de perfil):** quando Oficina e Pós-venda viraram um **painel unificado** (`renderOficinaSac`, commit `59b3ef9` de 23/06) o botão 🖨️ que existia no painel antigo da oficina (`renderOficina`/`ofImprimir`) **não foi levado junto** — a tela nova nasceu só com Abrir/Excluir, então a impressão sumiu pra **todos** ali (não só vendedores). Ficou mascarado porque a correção da OS de montagem (30/06) veio depois e deu a impressão de "voltou". **Auditoria:** conferido que TODOS os outros botões de impressão (PDV reimprimir 2ª via + comprovante da venda, folha de contagem do inventário, OS de montagem) estão liberados a todos os perfis — o único furo era o painel Oficina/Pós-venda. **Fix (`index.html`, `renderOficinaSac` ~23716):** botão 🖨️ restaurado, **sem gate de perfil** — OS de oficina → `ofImprimir` (mostra só preço, nunca custo/lucro; mesma decisão da OS de montagem); caso de garantia/SAC → **`sacImprimir` novo** (doc A4 de pós-venda/garantia espelhado no `ofImprimir`: cliente, scooter, fornecedor, tipo de problema, localização, problema relatado, itens, resumo IA + linha de assinatura; **sem custo** — só a frase "atendimento sem custo pro cliente"). Casos de SAC nunca tinham impressão — é recurso novo, a pedido do dono. **Validado no localhost** via DevTools: 0 erro de console, botão certo em cada visão (Oficina→`ofImprimir`, Pós-venda→`sacImprimir`), doc de garantia gera sem erro e **não vaza custo/margem/lucro** (testado com custoMaoObra/peça preenchidos → valores não aparecem). **✅ Commit pushed → GitHub Pages.**

### 2026-07-08 — Painel de Afiliados: preço sugerido + ficha técnica + banco de materiais
Portal (`portal.html`) e admin (módulo Afiliados do `index.html`) reformados — ver seção **"Painel de
Afiliados"**. Migração `afiliados_materiais_ficha_tecnica` aplicada via Supabase MCP (3 colunas em
`produtos_precos`, tabela `afiliados_materiais`, bucket privado `afiliados-materiais` + policies,
seed `afiliado_comissao_teto=500`; espelho em `afiliados_materiais_ficha_tecnica.sql`). Edge Function
`portal-afiliado` v2 escrita (cap do teto, campos novos no `dados`, ação `materiais` com signed URLs)
— **deploy pendente de aprovação do dono**. Validado no localhost com sessão real (fluxo completo de
upload/signed URL/remoção) e portal com mock (0 erro de console).

### 2026-07-08 — Custos Operacionais: heurística → classificação manual + ponto de equilíbrio (reforma pós-auditoria)
Após auditoria com 3 agentes independentes, a aba deixou de classificar fixo/variável por variância estatística (rotulava ~tudo como variável) e passou a usar **classificação manual por categoria**. Ver seção **"Custos Operacionais (sub-aba do Financeiro)"**. Banco: coluna `categorias_lancamento.natureza` (migração `categorias_natureza_custo`) + 16 categorias pré-classificadas + **higiene de dados** via MCP (pró-labore unificado em `Sócios`, antes fragmentado em `SÓCIOS`/`Outros`; Verisure→`Segurança`; seguro PagBank→`Seguro`, tirado de `Rendimento Conta` — reagrupamentos neutros p/ total/DRE). `index.html`: aba lê a natureza (4 baldes + alarme ⚠️ + não-recorrente FORA do total), seletor de natureza no cadastro, e **painel ⚖️ ponto de equilíbrio** (`_custoFixoMensalMedio`/`renderPontoEquilibrio`, lê o DRE sem alterá-lo). **NÃO** mexe no DRE/lucro. Validado no localhost (classificação com dados reais + testes de lógica do PE). **✅ Commit `c671564` pushed → GitHub Pages.** **Follow-up (mesmo dia, aprovado pelo dono):** `_despPlanejadoHistorico` (o "Custo Fixo Planejado" de referência do DRE) passou a excluir não-recorrentes + mês de início parcial (~R$ 39,2k → ~R$ 33,6k). NÃO altera o resultado/lucro (que usa `despReal`). Validado no localhost (função retorna média certa; console limpo).

### 2026-07-07 — Custos Operacionais virou sub-aba do Financeiro (entre Empréstimos e Análise IA)
A pedido do dono, a tela **Custos Operacionais** deixou de ser página própria (`#page-custos`) e passou a ser a 5ª **sub-aba** do módulo Financeiro, posicionada **entre Empréstimos e Análise IA** — a barra vira `Caixa Atual · DRE · Fluxo de Caixa · Empréstimos · Custos Operacionais · Análise IA`. **O que mudou no `index.html`:** (1) botão `data-fintab="custos"` (`#fin-tab-btn-custos`, ícone `ic-receipt`, `display:none` por padrão) na `.fin-tabs`; (2) o HTML da tela migrou intacto pra `.fin-tab-content#fin-tab-custos` (mesmos IDs `custos-banner/periodos/secoes`, `co-card-*`, `vendas-mes-input` — sem duplicação); (3) `switchFinTab` ganhou `'custos'` no array + guard `_temModulo('custos')` + render lazy `renderCustos()`; (4) `FIN_SUBTAB_META.custos` (título/subtítulo/breadcrumb); (5) `initFinanceiro` revela o botão só pra quem tem o módulo `custos` e trata a aba salva; (6) `showPage('custos')` **redireciona** pra `financeiro` já na aba custos, preservando a checagem do módulo **`custos`** (não regride permissão). **(7) O item "Custos Operacionais" foi REMOVIDO do menu lateral** (grupo Financeiro no `NAV_TREE`) a pedido do dono — pra não duplicar a referência; fica só a sub-aba. O redirect segue servindo o **KPI do dashboard** (`showPage('custos')`, linha ~5149). **Validado no localhost** via DevTools: boot sem erro, ordem das abas correta, troca mostra/esconde certo, título/breadcrumb OK, e **gating** confirmado (admin vê; vendedor sem `custos` não vê o botão e não força a aba — cai pra Caixa). Também validado com **dados reais** da sessão do dono (Total Operacional R$ 12.453,40 no mês). **✅ Commit `b056ded` pushed → GitHub Pages, confirmado NO AR em `smartmotorsapp.com.br` (07/07/2026).**

### 2026-07-07 — CRUD de acessos pelo painel consertado (create + delete pelo Auth)
Fechada a pendência aberta no reset de 07/07 — e mais um furo irmão achado no caminho. O front não tem service_role p/ o `auth.users`, então create/delete agora passam pela Edge Function `admin-usuarios` (como o reset já fazia). **(1) Create:** `salvarAcesso` modo create inseria só em `usuarios`, sem `auth.users` → usuário novo não logava. Agora chama `acao=criar` (estendida: aceita **senha custom** ≥6 → `must_change=false`, senão provisória; grava **`modulos_permitidos`**; **rollback** do Auth se o insert falhar), sem o `saveUser` duplicado. **(2) Delete:** `deletarUser` apagava só a linha → conta órfã no Auth (travava recriar mesmo e-mail). Agora chama `acao=deletar` (apaga Auth + linha). **Deploy v4** (`verify_jwt=false` inalterado, via Supabase MCP); smoke test 401 sem admin (guarda OK, não cria/apaga nada). **Saúde de acessos no banco:** 7 usuários, todos c/ `auth_uid` + conta no Auth (nenhum órfão); senha velha do Moisés na coluna morta `usuarios.senha` (base64) **normalizada p/ `"auth"`** (higiene — os outros já apagados em 28/06). **✅ Validado ao vivo pelo dono no localhost** (criou `teste_login` perfil customizado → logou com ele → viu só os módulos marcados → removeu; usuário de teste depois excluído por completo do banco). **Commits `a209b29` (create) + `8956ed6` (delete) pushed** → GitHub Pages (produção). Ver seção "Autenticação & Permissões".

### 2026-07-07 — Reset de senha do painel admin voltou a funcionar (estava quebrado desde a migração pro Auth)
Sintoma: dono redefinia a senha do **Marcos Moisés** pelo "Editar acesso → Nova senha", passava pra ele, e o login dava erro (pra ele e pro dono testando). **Causa:** desde a migração pro Supabase Auth (28/06), o login valida no `auth.users`, mas `salvarAcesso` gravava a nova senha na coluna morta `usuarios.senha` — que o login não lê mais; e o front não tem service_role p/ trocar a senha real. **Fix (2 partes):** (1) Edge Function `admin-usuarios` `acao=reset` passou a aceitar `senha` custom do admin (≥6; vale direto com `must_change=false`) além da provisória aleatória, + trata erro do `updateUserById` (deploy **v2**, `verify_jwt=false` inalterado, via Supabase MCP); (2) `salvarAcesso` (modo edit) agora chama essa função em vez de gravar na coluna morta. **Desbloqueio imediato do Moisés:** senha resetada direto no `auth.users` via SQL (pgcrypto `crypt(...,gen_salt('bf',10))`, `must_change` removido) — hash conferido (`senha_confere=true`), conta confirmada/não-banida. Validado: boot limpo no localhost, função responde 401 sem admin. Commit `80782dc`. **Fica pendente:** o **create** de usuário pelo painel tem o mesmo tipo de bug (não cria `auth.users`) — ver seção "Autenticação & Permissões".

### 2026-07-07 — WhatsApp: remetente migrado pro número principal (envia + recebe no mesmo número)
O número comercial dedicado só a envios (`+5521965107705`) tomou **ban temporário do WhatsApp** por **erro operacional** (funcionário disparou em massa pra base fria) — não foi o textmebot. Decisão do dono: consolidar tudo no número principal **`+5521997507738`** (que já era o **destinatário** ativo em `whatsapp_destinatarios` e o `WA_NUMBER` do app) — passa a ser **remetente E destinatário**. Revisão completa da config de envio: recebimento já apontava pro número certo, o 2º destinatário (Moisés `5521991180751`) já estava inativo, a `api_key` (CustID 30592) não muda. **Sem alteração de código/banco** — a troca é operacional: Logout do número antigo em `status.php` + re-vínculo do QR com o `+5521997507738`. **Concluído e testado (07/07/2026):** campo "Sender's Phone number" = `+5521997507738` e teste real via `send.php` retornou **Success** (self-send OK). Ver seção **"WhatsApp / Notificações"**.

### 2026-07-05 — CRM F2 (SLA automático + dashboard + simulador) e loop com o PDV
Ver seção **"CRM Omnichannel"** → F2. SLA por pg_cron validado em produção; dashboard admin em tempo real; modo simulador pra treinar a equipe sem canal real (Meta ainda não contratada pelo dono — decisão: seguir desenvolvendo, integrar depois, arquitetura já plugável). Loop ERP: negociação ganha vira pedido REAL no PDV com comissão do atendente. Registrado contexto permanente: sistema é só interno; site público = projeto futuro com contato via WhatsApp. Criado mecanismo de continuidade automática de tarefas (`_memoria/tarefa-atual.md`).

### 2026-07-04 — CRM Omnichannel F1 no ar (app dedicado + WhatsApp oficial + negociação)
MVP da Fase 1 construído e deployado — ver seção **"CRM Omnichannel"**. 9 migrações `crm_*` via Supabase MCP, 2 Edge Functions (`crm-meta-webhook`/`crm-send`), app React+Vite na Vercel (`smart-motors-crm.vercel.app`), item na sidebar com SSO. Plano v2 debatido por 5 agentes (corte de escopo, comercial, engenharia, ERP, omnichannel) — decisões do dono: WhatsApp Cloud API oficial c/ número novo, app dedicado, roteamento auto c/ dono do lead, IA "vende mas não negocia" (F4), TikTok só Lead Gen. Falta o setup Meta do dono (F0) pra ligar o canal real.

### 2026-07-04 — Contas a Pagar vira dossiê do boleto (arquivo + código de barras + Pix + comprovante + histórico)
Novo módulo de detalhes no Contas a Pagar — ver seção **"Contas a Pagar — dossiê do boleto"**. Migrações aplicadas em produção via **Supabase MCP** (não à mão): `contas_pagar_boleto_anexos` (11 colunas aditivas + `historico jsonb`) e `storage_bucket_boletos` (1º bucket de Storage do app, privado, + 4 policies). Cadastradas as **4 parcelas da OMETZ Cobranças (NF 2302**, R$ 4.296,25, venc. 17/08·17/09·19/10·17/11/2026, categoria Fornecedores) com linha digitável/código de barras/nosso número/beneficiário. UI de Detalhes (modal 📄) no `index.html`. **Commit `5ce22a6` pushed/deployado** (GitHub Pages). Depois: enriquecidos e anexados os boletos NF 305, NF 2082 e NF 2302 (ver seção do assunto). **Setup novo:** Supabase MCP conectado à pasta `~/projetos/Smart Motors` (escopo local, HTTP+OAuth) — deixa o Claude aplicar migração/consultar/inserir direto no banco. Skill `/cadastrar-boleto` criada (`.claude/skills/`) pra automatizar próximos boletos.

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
