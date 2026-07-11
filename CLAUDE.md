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
- **Edge Functions:** `crm-meta-webhook` (verify_jwt=false; auth = HMAC `X-Hub-Signature-256`; GET hub.challenge; **200 imediato + processa em background**; idempotência; status callbacks nunca regridem; **opt-out SAIR/STOP** marca `opt_in=false`; baixa mídia pro bucket `crm-midia`; ramifica por `object` — WA/IG/Messenger no MESMO endpoint) e `crm-send` (verify_jwt=true; valida **no servidor**: kill switch, opt-out, **janela 24h** → fora dela só template aprovado; fila `crm_saida` com retry; mídia via signed URL). Secrets pendentes (dono): `CRM_META_APP_SECRET`, `CRM_WA_VERIFY_TOKEN`, `CRM_WA_TOKEN`, `CRM_WA_PHONE_NUMBER_ID`.
- **App (crm/):** Login (email OU nome — mesma RPC `resolver_email_login`), Inbox (filas Aguardando/Meus/Em andamento/IA/Finalizadas, Realtime + **refetch na reconexão**, botão Pegar, quem está online), Conversa (thread, status ✓✓, mídia via signed URL, **nota interna** 📝, pausar SLA, transferir, lembrete, finalizar), painel **Negociação** (funil, modelo c/ disponibilidade prometível ao vivo, entrada/forma, **simulador de parcela** PMT c/ histórico, crédito, desconto auditado em `crm_eventos`), aba **Mensagens rápidas** (preço/estoque AO VIVO do banco + biblioteca por categoria). Tema dark/dourado `#f5c518`/Inter.
- **Pendências do DONO (F0 — destravam o WhatsApp real):** verificação de negócio na Meta · **número novo dedicado** ao CRM (decisão: manter `+5521965107705` só nos avisos `wa-notify`) · criar app Meta/WABA e gerar `PHONE_NUMBER_ID` + token System User + App Secret · cadastrar webhook (`https://sxmeuqlotjuchslevofv.supabase.co/functions/v1/crm-meta-webhook`, verify token à escolha = secret `CRM_WA_VERIFY_TOKEN`) · submeter 3-4 templates HSM · iniciar App Review do Instagram messaging (`instagram_manage_messages` — token de posts NÃO serve) · billing Meta. Depois: setar os 4 secrets nas Edge Functions.
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
  **retenção % editável (padrão 20%)** + saída no caixa + motos voltam ao estoque.
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
  (`cprog_pct_liberacao_padrao=80`, `cprog_taxa_retencao_cancelamento=20`). 2 categorias de
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
  Supabase. Falta só o dono validar no ar com uma venda real. O % de retenção de cancelamento (20%)
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
- **Escopo/limite:** a comissão da **consignação recebida** (piloto, ver `_memoria/tarefa-atual.md`) NÃO
  passa por `pdv_pedidos`, então fica numa conta à parte (lançada à mão) — quando a tela de consignação
  recebida for construída, ela deve gerar a comissão no mesmo esquema. **CRM e Compra Programada já são
  cobertos** (geram `pdv_pedidos`).

## Histórico de mudanças

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
