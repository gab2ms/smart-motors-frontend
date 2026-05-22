# Triggers — Smart Motors

Notas e convenções para triggers PL/pgSQL no Supabase deste projeto. Migrations vivem direto no Supabase (sem versionamento em arquivo); este doc serve de memória curta pra evitar repetir armadilhas.

## Triggers ativos

| Trigger | Tabela | Eventos | Função | Propósito |
|---|---|---|---|---|
| `trg_parcela_to_conta` | `emprestimo_parcelas` | INSERT, UPDATE, DELETE | `fn_parcela_to_conta()` | Cria/atualiza/deleta `contas_pagar` espelhada |
| `trg_conta_to_parcela` | `contas_pagar` | UPDATE, DELETE | `fn_conta_to_parcela()` | Propaga status/valor/datas de volta pra `emprestimo_parcelas` |
| `trg_montagens_itens_recalc` | `montagens_itens` | INSERT, UPDATE, DELETE | `tg_montagens_itens_recalc()` → `montagens_recalc_lote()` | Recalcula `valor_total`, `data_ultimo_recebimento`, `status_pagamento` no lote |
| `trg_montagens_pagamentos_recalc` | `montagens_pagamentos` | INSERT, UPDATE, DELETE | `tg_montagens_pagamentos_recalc()` → `montagens_recalc_lote()` | Recalcula `valor_pago` + `status_pagamento` no lote |

Link: `contas_pagar.emprestimo_parcela_id UUID REFERENCES emprestimo_parcelas(id) ON DELETE CASCADE`.

## Migrations recentes

- `lancamentos.transferencia_id UUID NULL` + `idx_lancamentos_transferencia` (parcial, WHERE transferencia_id IS NOT NULL) — vincula par de lançamentos que representam uma transferência entre contas. Convenções na seção "Lançamentos" abaixo.
- `contas_pagar.recorrencia_id UUID NULL` + `idx_contas_pagar_recorrencia` (parcial, WHERE recorrencia_id IS NOT NULL) — vincula todas as ocorrências de uma conta recorrente. Pré-geração de N ocorrências (52 semanais, 12 mensais, etc) no momento da criação.
- `contas_pagar.dia_semana_fixo SMALLINT NULL` — dia da semana fixo (0=dom..6=sáb) pra séries semanais/quinzenais. Sem índice (cardinalidade muito baixa).
- `lancamentos.conta_pagar_id TEXT NULL REFERENCES contas_pagar(id) ON DELETE SET NULL` + `idx_lancamentos_conta_pagar` (parcial) — vincula lançamento de caixa gerado pelo modal de pagamento de Contas a Pagar. `ON DELETE SET NULL` preserva histórico financeiro mesmo se conta_pagar for deletada.
- **`contas_receber`** (nova tabela, 17 colunas) — contas a receber, espelha o desenho de `contas_pagar`. Colunas-chave: `id TEXT PK` (default `gen_random_uuid()::text`), `status ∈ {pendente, recebido}`, `recebido_em DATE`, `periodicidade` com `quinzenal` (8 valores), `recorrencia_id`/`dia_semana_fixo` com a mesma semântica de séries recorrentes de `contas_pagar`. RLS `acesso_total` (`FOR ALL USING (true)`, padrão do app).
  - Indexes: `idx_contas_receber_vencimento`, `idx_contas_receber_status`, `idx_contas_receber_recorrencia_id` (parcial), `idx_contas_receber_cliente_id` (parcial).
  - FKs, todas `ON DELETE SET NULL` (preserva o registro e limpa o ponteiro órfão — nunca CASCADE): `cliente_id → clientes(id)`, `conta_id → contas_bancarias(id)`, `lancamento_id → lancamentos(id)`. `conta_id` e `lancamento_id` ficam sem índice de cobertura por ora (tabela vazia; advisor sinaliza como INFO).
- `lancamentos.conta_receber_id TEXT NULL REFERENCES contas_receber(id) ON DELETE SET NULL` — vincula o lançamento de caixa gerado pelo recebimento de uma conta a receber. Espelha `conta_pagar_id`; `ON DELETE SET NULL` preserva o histórico financeiro mesmo se a `contas_receber` for deletada.
- `sac_casos.cliente_id UUID NULL REFERENCES clientes(id) ON DELETE SET NULL` + `idx_sac_casos_cliente_id` (parcial, WHERE cliente_id IS NOT NULL) — vincula o caso SAC ao cliente cadastrado. Antes o SAC só guardava snapshot (`cliente_nome`/`cliente_telefone`/`cliente_cpf`, sem FK); agora espelha `oficina_ordens` e `contas_receber`. `ON DELETE SET NULL` preserva o caso e zera o ponteiro órfão. Casos antigos ficam com `cliente_id = NULL` (sem backfill — snapshot de nome continua válido). Não há `TABLE_MAP` entry pra `sac_casos`: usa os mappers genéricos `toSnake`/`toCamel`, que já fazem o round-trip `clienteId` ↔ `cliente_id`.
- `produtos_precos.ativo BOOLEAN NOT NULL DEFAULT true` — flag pra separar catálogo vivo de produtos descontinuados. Ver seção "Ativo/Inativo de produtos" abaixo.
- `whatsapp_destinatarios` (tabela) — destinatários dos resumos executivos diários enviados via CallMeBot. Colunas: `nome`, `numero` (só dígitos com DDI), `api_key`, `receber_manha`/`receber_noite`/`ativo` BOOLEAN, `observacoes`, `criado_em`. RLS ativa + policy `acesso_total`. Sem `TABLE_MAP` entry — mappers genéricos `toSnake`/`toCamel` cobrem. Seed do Gabriel feito em JS (`_seedWhatsappDest`) a partir das constantes `WA_NUMBER`/`WA_APIKEY`, não na migration. Sub-commit A da feature de notificações WhatsApp.
- `whatsapp_envios_log` (tabela) — log de cada envio de resumo. Colunas: `destinatario_id` UUID FK `whatsapp_destinatarios` `ON DELETE SET NULL`, `periodo` TEXT CHECK in (`manha`,`noite`,`teste`,`previa`), `conteudo`, `sucesso` BOOLEAN, `erro`, `enviado_em`. Índice `idx_whatsapp_envios_log_enviado_em` (DESC). RLS ativa + policy `acesso_total`. Sub-commit B. Obs: como `_enviarWhatsAppRaw` usa `fetch` `no-cors`, `sucesso` reflete "requisição saiu sem exceção", não entrega confirmada.

## Ativo/Inativo de produtos

A coluna `produtos_precos.ativo` separa o catálogo vivo dos modelos descontinuados (ou sem giro). 13 produtos foram marcados `ativo = false` na introdução da feature (GT1, G7, Valley, Best, Grazie, Sol, Future, Ready, Explore, Felicie duo, Dot, Conquest, Maggie); 17 seguem ativos.

Convenção de leitura — **sempre `ativo !== false`, nunca `=== true`**: registros antigos/seed sem a flag (ou produtos criados por caminhos que não setam `ativo`) contam como ativos.

Consumidores:
- **`calcularDRE`** — o `avgMCpct` (média de MC% que estima o CPV) usa **só ativos**. Inativar produto de margem baixa sobe o `avgMCpct`; inativar de margem alta desce.
- **Aba `#precos`** — toggle "Mostrar inativos" (default oculto). Inativos aparecem com `opacity` reduzida, modelo em strikethrough e badge "inativo". Modal de edição tem checkbox "Ativo".
- **`_matchProdutoPorNome`, widget "Scooters mais vendidas", Excel "Vendas por Produto"** — **continuam enxergando inativos**. Inativo significa "não vende mais", não "não existe": venda histórica de um descontinuado ainda precisa achar o cadastro pra obter custo/MC%.

`ativo` faz round-trip pelos mappers genéricos (`produtos_precos` usa `toSnake`/`toCamel`). Atenção: `saveProduct` reconstrói o objeto do zero a cada edição — por isso o checkbox "Ativo" no modal é obrigatório (sem ele, editar um produto apagaria a flag).

## Matcher Tiny ↔ cadastro — `_matchProdutoPorNome`

Liga o nome de um item vendido no Tiny ao produto em `produtos_precos`. O Tiny escreve nomes verbosos ("MOTONETA ELÉTRICA X11 1000W - VERMELHA") que divergem do `modelo` do cadastro ("X11"). Cascata de tentativas: (1) exato, (2) exato case-insensitive, (3) `startsWith` no nome cru, (4) `startsWith` no nome **normalizado**, (5) X-Buddy, (6) alias map (`_PRODUTO_ALIASES` — Skylo→Eskilo, Pit→Pit+suporte).

`_normalizarNomeTiny` (etapa 4): strip do prefixo Tiny (`_PRODUTO_PREFIXOS_TINY` — motoneta/bicicleta/triciclo/…), hífen → espaço, e remoção dos tokens-ruído (`_PRODUTO_PALAVRAS_RUIDO` = elétrica/eletrica/elétrico/eletrico/fan). Sem isso, "MOTONETA ELÉTRICA X11" deixava "elétrica x11" e o `startsWith('x11')` falhava — era a causa de X11/Vix/Lee/Harley não casarem.

X-Buddy (etapa 5): o Tiny manda "X-BUDDY" sem o ah, mas o cadastro tem 2 entradas (12ah/20ah). Decisão **opção A**: casa com o primeiro cadastro "X Buddy" (determinístico pela ordem da tabela = 12ah). Os 2 são quase idênticos (custo 6.100 vs 6.300, MC 20,4% vs 22,6%) e o matcher só alimenta display (widget "Scooters mais vendidas", Excel "Vendas por Produto") — não toca o `avgMCpct` do DRE. Se um dia os 2 divergirem muito, migrar pra produto sintético com média (backlog).

Acessórios (capacete, retrovisor, suporte) e serviços (frete, manutenção) não têm cadastro em `produtos_precos` — ficam sem match por design.

## DRE — regime de competência

`calcularDRE(iniISO, fimISO)` é o cálculo puro do DRE (não toca DOM). Consumido pelo widget `renderDashDreMes` (mês corrente) e pela aba "Resumo" do Excel em `gerarFechamentoMes` (range do selector). Estrutura de **6 linhas**:

```
   Receita (faturamento Tiny)
(−) CPV real — custo dos produtos vendidos (estrutura Custos de Produtos)
=  Margem bruta
(−) Despesas operacionais
(−) Empréstimos pagos no mês
=  Resultado do mês
```

**Princípio — caixa × competência.** O DRE mistura faturamento Tiny (competência) com lançamentos de caixa. O risco é duplicar: qualquer lançamento que pague algo **já embutido no CPV** conta duas vezes. Por isso o `despReal` exclui a constante `_DRE_CATEGORIAS_FORA_DESPESA`:

- `Fornecedores`, `Motonetas`, `Montagem`, `Nota Fiscal e Imposto` — custo de produto, já no CPV.
- `Empréstimos` — amortização de dívida; entra só na linha própria, vinda de `emprestimo_parcelas` (não dos lançamentos). Antes contava em dobro.
- `Acerto de Caixa`, `Estorno`, `Transferência` — movimentações não-operacionais.
- `Comissão de Vendas` — comissão de venda, já contada no CPV (componente `comissao` do `ctReal`). Categoria criada na reclassificação de `custos_fixos` (2026-05-17) — quando o lançamento de comissão for separado do salário, cai aqui e não duplica.
- `Investimento em Ponto` — caução/abertura de unidade, custo não-recorrente; não é despesa operacional do mês.

**CPV real:** loop nos `pedidos[].itens[]` do Tiny, `_matchProdutoPorNome`. Por item matchado soma `(custoPuro + montagem + comissao) × qtd`; a NF entra **1× por pedido** (`config_custos.nf_pedido`, R$ 30), não por unidade. Em venda direta ("Venda Direta Smart Motors") os sócios não recebem comissão — ela é **excluída direto no CPV**. Não há mais linha "(+) Ajuste comissão venda direta": a estrutura anterior somava `comissao` no `ct()` e a devolvia depois numa linha própria; agora a decisão está dentro do loop e o DRE tem 6 linhas. Item sem cadastro (acessório/serviço) usa fallback estimado `valor × (1 − avgMCpct)`. O `avgMCpct` (média de MC% — fallback e referência) considera só produtos `ativo !== false`.

O CPV **não** chama o helper `ctReal(p)`: `ctReal` é a visão por-unidade simplificada (consumida pela aba Custos de Produtos) e não comporta a comissão condicional por vendedor nem a NF agregada por pedido. O `calcularDRE` calcula os componentes inline.

**Instabilidade do Tiny:** `_tinyStabilityCheck` faz 2 buscas forçadas; se a contagem de pedidos diverge, `tinyEstabilidade.estavel = false` → widget mostra badge "⚠️ Dados Tiny instáveis" e o Excel adiciona linha de aviso. É mitigação visual — o fix de raiz do Tiny é separado.

**Decisão de UI:** o widget DRE é a **fonte única** do resultado. O KPI "Lucro líquido est." foi removido do bloco Faturamento do Dashboard e da página Vendas do Mês pra não haver dois lucros líquidos divergentes; "Custo fixo do mês" virou "Custo Fixo Planejado". Existe ainda um `renderDRE`/`recalcDRE` separado (análise de planilha de vendas importada) que **não** usa `calcularDRE` — é outra ferramenta, fora desta estrutura (atualmente sem ponto de entrada na UI — código legado).

**Custo Fixo Planejado — `_despPlanejadoHistorico()`.** Desde 2026-05-18 o cadastro estático `custos_fixos` deixou de existir (ver "Custos Operacionais" abaixo). O valor "Custo Fixo Planejado" exibido nos KPIs (Dashboard Faturamento, Vendas do Mês) e enviado à Análise IA (`custosFixosMensais`) vem de `_despPlanejadoHistorico()` — **média da despesa operacional dos últimos ≤3 meses-calendário completos** (o mês corrente parcial fica fora, senão subestima; exclui as mesmas categorias do `_DRE_CATEGORIAS_FORA_DESPESA`). Retorna `{ media, nMeses }`; `nMeses < 3` alimenta o badge "⚠️ base: N meses" no widget DRE e o banner "análise em construção" da aba Custos Operacionais. `calcularDRE` expõe `despPlanejado` + `despPlanejadoBaseMeses` pelo mesmo helper.

## Correções de dados

- **2026-05-17 — `produtos_precos.jonosake` zerado em GT1, G7, Valley e Best.** O campo `jonosake` (componente somado no custo total via `ct()`) tinha R$ 1.157,30 nesses 4 produtos. Não era custo real: era um **acordo temporário de evento** — parte do lucro repassada a um parceiro durante um evento específico. O evento foi encerrado, então o valor não corresponde mais a custo nenhum. `UPDATE produtos_precos SET jonosake = 0` nos 4. Impacto: `avgMCpct` global (média de MC% dos produtos, usada no CPV estimado do `calcularDRE`) subiu de **~22,2% → 23,81%**, melhorando a fidelidade do DRE. Nenhum outro produto tinha `jonosake ≠ 0`.
- **2026-05-17 — `produtos_precos.nf` normalizado para 30 em todos os produtos.** O campo `nf` (componente de `ct()`) representa a **taxa do contador para emitir a NF — R$ 30 fixos por nota**. Cinco cadastros antigos tinham valores divergentes que não refletiam custo real: Eskilo R$ 500, BAJAX/KRONOS/Pixel R$ 170, Ralf R$ 150. `UPDATE produtos_precos SET nf = 30 WHERE nf IS NOT NULL AND nf != 30`. Impacto no `ct()` legado: Eskilo −470, BAJAX/KRONOS/Pixel −140, Ralf −120. Não há imposto proporcional ao valor da venda — o DAS mensal é despesa operacional (categoria `Imposto e Tributos`), não custo de produto. O backfill de `custo_puro` (Commit 1 de "Custos de Produtos") **não** inclui `nf` — é agnóstico a esse valor; nenhum rebackfill necessário.
- **2026-05-17 — split + recategorização de lançamentos de Montagem/NF.** As categorias `Montagem / Serviço Técnico` e `Nota Fiscal e Imposto` misturavam custo de produto (já contado no CPV via `ct()`) com despesa operacional pura. Para o DRE reestruturado poder excluir por nome de categoria (ver "DRE — regime de competência" abaixo), separamos: (1) o lançamento misto de R$ 1.250 ("10 montagens + 150 serviços externos") foi **dividido** em R$ 1.100 (`10 montagens`, fica em `Montagem / Serviço Técnico`) + R$ 150 (`150 serviços externos`, nova categoria `Oficina - Peças e Serviços`); (2) 2 lançamentos de reparo de oficina (R$ 35 frete peça + R$ 330 módulo p/ conserto de cliente) movidos para `Oficina - Peças e Serviços`; (3) o DAS de abril (R$ 242,88) movido para a nova categoria `Imposto e Tributos`. Resultado: `Montagem / Serviço Técnico` (R$ 1.790) e `Nota Fiscal e Imposto` (R$ 600) ficam **puros** (custo de produto, no CPV); `Oficina - Peças e Serviços` (R$ 515) e `Imposto e Tributos` (R$ 242,88) ficam **puros** (operacional). Sem isso, o DRE duplicaria ~R$ 2.390 (montagem/NF já no CPV) ou perderia ~R$ 758 de despesa operacional real. Categorias são texto livre em `lancamentos.categoria` — não há tabela de categorias; "Oficina - Peças e Serviços" e "Imposto e Tributos" passam a existir só pelo uso.

- **2026-05-17 — reclassificação do cadastro `custos_fixos` (análise contábil).** O cadastro tinha vocabulário desalinhado das categorias de `lancamentos`, itens duplicados, genéricos e lixo de teste. Ações: **DELETADOS** "Funcionário teste", "Funcionário 2", "Funcionário 3" (genéricos R$ 1.819, substituídos pelos nomes reais), "Insumos" (R$ 300, órfão) e "Terceirizados (média)" (R$ 875 — dupla contagem: era o roll-up da categoria `Serviços Terceirizados`, que já se decompõe em Faxina + Contabilidade). **RENOMEADOS/ATUALIZADOS:** "Aluguel"→"Aluguel - Loja Matriz" (R$ 3.500→3.000, valor real recorrente), "Quiosque"→"Aluguel - Quiosque", "Tráfego Pago"→"Marketing" (R$ 4.416 mantido — orçamento conservador). **CRIADOS:** "Rafael"/"Nicolly"/"Henrique" (CLT fixo R$ 1.819), "Samuel" (jovem aprendiz, R$ 800 fixo), "Oficina - Peças e Serviços" (R$ 500), "Imposto e Tributos (DAS)" (R$ 250), "Compras Gerais" (R$ 200). Cadastro: 21 → 23 linhas. **"Pró-labore Sócios" R$ 4.000 mantido** — são 2 sócios a R$ 2.000: Moisés (ativo) + Gabriel (suspenso temporariamente, decisão estratégica de preservar caixa). O planejado reflete o estado normal da empresa; a linha fica agrupada (não vira 2 linhas). "Saveiro Assinatura" R$ 2.099 mantido (ainda pago, só não caiu na janela auditada).
- **2026-05-17 — comissão de vendas: bug de dupla contagem.** Comissão era lançada junto do salário em `Funcionários` (ex.: "Rafael R$ 2.269" = R$ 1.819 fixo + comissões). Como `comissao` já entra no CPV (componente do `ctReal`), a comissão contava 2× no DRE. Solução (Opção A): comissão passa a ser lançada na categoria nova `Comissão de Vendas`, adicionada ao `_DRE_CATEGORIAS_FORA_DESPESA` → excluída do `despReal`. Vale daqui pra frente; o erro histórico (lançamentos antigos de `Funcionários` com comissão embutida) foi aceito — não é prático separar retroativamente.
- **2026-05-17 — R$ 15.000 "início aluguel calçadão" → categoria `Investimento em Ponto`.** O lançamento (2026-05-12) estava em `Aluguel e Condomínio`, contando como despesa operacional e afundando o resultado de maio. É caução/abertura de unidade nova — investimento não-recorrente. Movido para a categoria nova `Investimento em Ponto`, adicionada ao `_DRE_CATEGORIAS_FORA_DESPESA`. Efeito no DRE de maio: `despReal` caiu R$ 28.049,74 → R$ 13.049,74. A categoria não tem item em `custos_fixos` (nada a planejar mensalmente).
- **2026-05-18 — migração `vendas_mes_config` → `config_custos`.** A meta de vendas/mês morava numa linha especial de `custos_fixos` (`nome = 'vendas_mes_config'`, valor 40), separada do cadastro de custos no carregamento via `VENDAS_MES_CONFIG_NOME`. Como `custos_fixos` ia ser esvaziada (entrada abaixo), o valor foi migrado para `config_custos` (`UPSERT chave='vendas_mes', valor=40`). `carregarDados` passou a ler `CONFIG_CUSTOS.vendas_mes`; `salvarVendasMes` faz upsert nessa chave. Migração feita antes do DELETE para não perder o valor.
- **2026-05-18 — DELETE do cadastro `custos_fixos` (22 linhas).** Com a feature "Custos Operacionais" derivando tudo de `lancamentos`, o cadastro estático ficou redundante e divergente do real. `DELETE FROM custos_fixos WHERE nome != 'vendas_mes_config'` removeu as 22 linhas de custos planejados; a tabela foi **preservada** (não dropada) para rollback. A linha `vendas_mes_config` foi removida depois, já migrada (entrada acima). Regressão tratada no mesmo dia: 4 pontos do código ainda somavam `custosFixos.reduce(...)` e passaram a exibir R$ 0 (KPI "Custo Fixo Planejado" no Dashboard e em Vendas do Mês, contexto da Análise IA, e o `custoFixoMes` legado do `recalcDRE`) — corrigidos para usar `_despPlanejadoHistorico().media`.
- **2026-05-19 — padronização do catálogo `produtos_precos` (8 renames).** Catálogo tinha capitalização misturada (MAIÚSCULA, Title Case, híbridos) e 2 nomes "errados" do ponto de vista do negócio: `Eskilo` (deveria ser `Skylo`, nome real do produto) e `Pit + suporte` (deveria ser `Pit`, sem o sufixo). Renames: `Eskilo→Skylo`, `Pit + suporte→Pit`, `APOLLO→Apollo`, `BAJAX→Bajax`, `Felicie duo→Felicie Duo`, `KRONOS→Kronos`, `NEXOR→Nexor`, `RAPTOR PRO→Raptor Pro`. Codes preservados: `G7`, `GT1`, `X11`, `Harley 16`, `Eco Bike`, `X Buddy 12ah/20ah`. Pré-checagem confirmou 0 colisões antes do UPDATE. **`_PRODUTO_ALIASES` esvaziado** — os 2 aliases que existiam (`skylo→eskilo` e `pit/1000w→pit + suporte`) ficaram redundantes: agora o matcher do Tiny casa direto via etapa 2 (exato case-insensitive) ou 3 (startsWith normalizado).
- **2026-05-19 — `montagens_itens.chassi` opcional.** Originalmente `NOT NULL`; algumas motos chegam sem chassi do montador (rótulo perdido / falha de etiqueta). `ALTER COLUMN chassi DROP NOT NULL` permite cadastrar item sem chassi. O índice UNIQUE parcial `idx_montagens_itens_chassi_ativo` segue funcionando — múltiplos `NULL`s não conflitam (semântica padrão de UNIQUE no Postgres). UI mostra "—" no lugar do chassi quando vazio.
- **2026-05-19 — `Pixel` → `Pixxel` (correção de nome real do produto).** O nome correto da motoneta (gravado pelo fabricante e usado em comunicação interna) é `Pixxel`, com dois X. O catálogo tinha `Pixel` por engano histórico. Renomeado em 3 frentes:
  - `produtos_precos.modelo`: `UPDATE … SET modelo='Pixxel' WHERE modelo='Pixel'` (1 linha).
  - `lancamentos.descricao` / `observacao`: `REPLACE` case-insensitive cobrindo `pixel`/`Pixel`/`PIXEL` → `pixxel`/`Pixxel`/`PIXXEL` (6 descrições tocadas; nenhuma observação). Filtro `ILIKE '%pixel%'` garantiu que **"taxa pix"** (lançamento sobre PIX o pagamento) ficasse intocado — substring "pixel" não aparece em "pix".
  - `index.html`: `PRODUCTS_SEED` atualizado; comentário do matcher atualizado pra "PIXXEL VERMELHA"; **alias temporário** adicionado em `_PRODUTO_ALIASES` (`{ triggerTokens: ['pixel'], modeloAlvo: 'pixxel' }`) pra que pedidos vindos do Tiny continuem casando enquanto o nome no Tiny não é corrigido. **Remover esse alias** após o rename no Tiny.
  - Menção histórica na entrada de 2026-05-17 ("BAJAX/KRONOS/Pixel R$ 170") **preservada** — é registro do que existia naquele momento, não distorce ao manter.

## Schema de Custos de Produtos

Feature "Custos de Produtos" (substitui a aba Simulador). Objetivo: separar o custo bruto do produto dos custos operacionais embutidos, e mover custos não-por-unidade para configuração.

**Tabela `config_custos`** — pares chave/valor para custos que não escalam por unidade vendida:

| chave | valor | descrição |
|---|---|---|
| `nf_pedido` | 30 | Custo de NF por pedido (não por unidade) |
| `vendas_mes` | 40 | Meta/estimativa de vendas/mês — base do "Custo por Venda" da aba Custos Operacionais. Migrado de `custos_fixos` (linha `vendas_mes_config`) em 2026-05-18. |

Estrutura: `chave TEXT PK`, `valor NUMERIC NOT NULL`, `descricao TEXT`, `atualizado_em TIMESTAMPTZ DEFAULT now()`. RLS `acesso_total FOR ALL TO public` (mesma convenção das outras tabelas do app).

**Colunas novas em `produtos_precos`:**
- `custo_puro NUMERIC` — custo bruto do produto absorvendo os componentes que `ctReal` não toma separadamente. Backfill: `custo_puro = custo + COALESCE(nf_compra,0) + COALESCE(jonosake,0) + COALESCE(financeiro,0)`.
- `categoria TEXT CHECK (categoria IN ('motoneta','acessorio'))` — default backfill `'motoneta'`.

**Relação `ctReal` × `ct()` legado:** `ctReal = custo_puro + montagem + comissao + nf_pedido`. Para produtos com `nf = 30` (a maioria), `ctReal` reproduz `ct()` exatamente. O único divergente no cadastro atual é o **BAJAX** (`nf = 170`): `ctReal` fica R$ 140 abaixo de `ct()` — diferença intencional, pois a NF deixou de ser por-unidade (170) e virou por-pedido (`nf_pedido = 30`). O componente `nf` por-unidade de `produtos_precos` é deliberadamente abandonado por `ctReal` em favor de `config_custos.nf_pedido`.

## Custos Operacionais

Feature 2026-05-18 — substitui a aba/cadastro estático "Custos Fixos". A fonte única passa a ser a tabela `lancamentos`; a aba foi renomeada "Custos Fixos" → **"Custos Operacionais"** (slug `#custos` mantido). A tabela `custos_fixos` foi esvaziada mas **preservada** (rollback) — ver "Correções de dados".

**Backend — `calcularCustosOperacionais(periodo)`** (`index.html`). Lê `lancamentos`, considera só `tipo === 'saida'` sem `transferenciaId` e exclui as categorias do `_DRE_CATEGORIAS_FORA_DESPESA` (mesma lista do DRE). Por categoria agrega: total do período, totais mensais (≤3 últimos meses) e última data de lançamento. Retorna `{ periodo:{iniISO,fimISO}, fixos[], variaveis[], indefinidos[], inativos[], totalFixo, totalVariavel, totalIndefinido, total }`.

- **Janela de atividade:** categoria sem lançamento nos últimos 2 meses → `inativos`.
- **Classificação fixo/variável (`classificarFixoVariavel`):** mesmo valor (±5%) entre meses → `fixo`; varia >5% → `variavel`; <2 meses de histórico → `indefinido`.
- **Drill-down (`agruparPorDescricao` + `_normDesc`):** nível 1 = categoria; nível 2 = descrição normalizada (`toLowerCase`, sem acento, espaços colapsados, `trim`) — agrupamento **literal**, não por palavra-chave. Sem descrição → fallback `(sem descrição)`.
- **Períodos (`_periodoRange` / `_CO_PERIODOS`):** Mês atual, Mês anterior, Trimestre, Semestre, Anual. "Anual" só aparece com >6 meses de histórico operacional (`_coTemHistoricoLongo`).
- **Banner "análise em construção":** quando o histórico tem <3 meses completos (`_despPlanejadoHistorico().nMeses < 3`).

**UI (`renderCustos`):** seletor de período, 3 indicadores (Fixos, Variáveis = variáveis+indefinidos, Total Operacional) + "Custo por Venda" (`config_custos.vendas_mes`); seções 🟦 Fixos / 🟧 Variáveis (indefinidos misturados nas variáveis com selo ⬜) com drill-down por categoria; ⚠️ Inativos só se houver. Estado: `_custosPeriodo`, `_custosExpandido`.

**Excel "Fechar Mês":** a aba 4 foi de "Custos Fixos" → **"Custos Operacionais"** (`gerarFechamentoMes`), montada de `calcularCustosOperacionais('mes-atual')` — header, 4 indicadores, seções 🟦/🟧 com drill-down indentado, ⚠️ Inativos condicional, aviso "análise em construção" quando `nMeses<3`. **Dívida técnica leve:** a aba é sempre "mês atual", independente do range do selector de fechamento — aceitar parâmetro de range é TODO.

## Montagens — schema

Feature 2026-05-19 — gestão de lotes de motonetas enviadas a montadores externos (Marcos/Helder/Danton). 4 tabelas com triggers que mantêm os totais do lote sempre em sincronia com itens e pagamentos.

**Tabelas:**

| Tabela | Papel |
|---|---|
| `montadores` | Cadastro do prestador: `nome`, `telefone`, `preco_padrao` (default R$ 110), `principal BOOLEAN`, `ativo BOOLEAN`, `observacoes`. Seed: Marcos (principal), Helder, Danton. |
| `montagens_lotes` | Lote = remessa entregue a um montador. `numero_lote SERIAL UNIQUE`, `montador_id UUID REFERENCES montadores(id) ON DELETE SET NULL`, `data_envio DATE`, `data_ultimo_recebimento DATE`, e agregados (`valor_total`, `valor_pago`, `status_pagamento`). **Agregados são mantidos por trigger — nunca escrever à mão.** |
| `montagens_itens` | Uma motoneta no lote: `modelo`, `cor`, `chassi`, `preco_montagem` (snapshot — não FK pra `montadores.preco_padrao`), `status_montagem ∈ {fila, montando, montada, recebida}` (CHECK), `data_recebimento`. `lote_id ON DELETE CASCADE`. |
| `montagens_pagamentos` | Pagamento (parcial ou integral) feito ao montador: `valor`, `data_pagamento`, `itens_ids JSONB` (lista opcional dos itens cobertos), `lancamento_id TEXT REFERENCES lancamentos(id) ON DELETE SET NULL` (vínculo opcional com o lançamento de caixa). `lote_id ON DELETE CASCADE`. |

**Sincronia via triggers — `montagens_recalc_lote(p_lote_id)`.** Função única chamada por dois triggers AFTER INSERT/UPDATE/DELETE FOR EACH ROW: `trg_montagens_itens_recalc` e `trg_montagens_pagamentos_recalc`. Recalcula no lote:

- `valor_total = Σ itens.preco_montagem`
- `valor_pago  = Σ pagamentos.valor`
- `data_ultimo_recebimento = MAX(itens.data_recebimento)`
- `status_pagamento`: `pago <= 0 → 'pendente'`; `pago >= total ∧ total > 0 → 'pago'`; resto → `'parcial'`.

UPDATE que troca `lote_id` (mover item/pagamento entre lotes) recalcula os dois — velho e novo. CASCADE de delete do lote dispara recalc num `lote_id` já inexistente — vira no-op (sem erro). As 3 funções têm `SET search_path = ''` + tudo `public.`-qualificado (silencia o advisor).

**Anti-race com `FOR UPDATE` (R1).** A função abre com `PERFORM 1 FROM montagens_lotes WHERE id = p_lote_id FOR UPDATE`. Trava a linha do lote pelo resto da transação, serializando recálculos concorrentes. Sem isso, 2 pagamentos parciais simultâneos no mesmo lote leem o mesmo `valor_pago` antigo, somam separadamente e o último UPDATE sobrescreve o do anterior — lost update clássico. Com o lock, o segundo espera o primeiro, recalcula sobre o estado já atualizado, e o total bate.

**Convenção — chassi `UPPER(TRIM(...))` no frontend.** O app normaliza chassi (uppercase + trim) antes de gravar. O banco **não** força via CHECK — confia no app. Pareamento se dá pelo índice UNIQUE parcial `idx_montagens_itens_chassi_ativo` (`WHERE status_montagem != 'recebida'`): um chassi não pode estar em 2 montagens ativas simultâneas. Uma vez `recebida`, sai do índice e pode reaparecer no futuro (raro, mas válido — ex: revisão/retorno).

**Convenção — `principal` sem UNIQUE.** A flag `montadores.principal BOOLEAN` marca o montador de maior volume (hoje: Marcos). **Não há índice UNIQUE parcial forçando "só um"** — é convenção de uso, não constraint. UI ordena `principal DESC, nome`. Reatribuir é só UPDATE em 2 linhas; sem complicação de constraint para um valor que muda raramente.

## Oficina ↔ SAC — paridade bidirecional + status `transferido`

Feature 2026-05-19 — fluxo bidirecional simétrico Oficina↔SAC com status separado pra **movimentações** (≠ conclusão). Antes só existia Oficina→SAC (`ofMoverParaSac`) + uma reversão admin-only (`sacReverterParaOficina`); agora os dois lados são genuínos. **Sub-commit A** (este) cobre só o schema + migração retroativa; **sub-commit B** (frontend) traz `sacMoverParaOficina`, botão "🔧 Mover pra Oficina" no modal SAC, banners condicionais nos dois sentidos, e ajuste dos filtros/KPIs.

**Colunas — par espelho:**

| Tabela | Coluna | Aponta pra | Significado |
|---|---|---|---|
| `oficina_ordens` | `sac_destino_id UUID` *(preexistente)* | `sac_casos(id)` | "Esta OS foi transferida pro SAC #Y" |
| `oficina_ordens` | `sac_origem_id UUID` *(novo)* | `sac_casos(id)` | "Esta OS foi criada a partir do SAC #X" |
| `sac_casos` | `os_origem_id UUID` *(preexistente)* | `oficina_ordens(id)` | "Este caso foi criado a partir da OS #X" |
| `sac_casos` | `oficina_destino_id UUID` *(novo)* | `oficina_ordens(id)` | "Este caso foi transferido pra OS #Y" |

Todas `ON DELETE SET NULL` (preserva histórico, zera ponteiro órfão — convenção do projeto pra FKs de relacionamento entre tabelas operacionais). Índices parciais nas 4 (`WHERE col IS NOT NULL`).

**Status `'transferido'`** — novo valor adicionado ao CHECK de `oficina_ordens.status` e `sac_casos.status` (antes: `acao_interna|aguardando_terceiro|pronto_entrega|finalizado` — agora idem + `transferido`). A distinção é semântica: `finalizado` = caso resolvido; `transferido` = caso migrou pra outra fila e **não deve poluir KPIs de resolução**. Listagens "Em aberto" / "Finalizados" e KPIs filtram `status != 'transferido'` no front (não via DB).

Defaults pré-existentes (`oficina_ordens.status = 'aguardando'` e `sac_casos.status = 'aberto'`) seguem **fora** do CHECK — inconsistência herdada antes desta feature, fora do escopo.

**Migração retroativa (2026-05-19):**

- **Oficina — 2 linhas** mudaram pra `'transferido'`: OS #10 (Ademar, antes `finalizado`) e OS #13 (Gabriel, antes `aguardando_terceiro`). O plano original filtrava `status='finalizado'`, mas isso pegava só a #10. Ajustamos pra usar o **marcador semântico** (`sac_destino_id IS NOT NULL`) — o status atual era ruído de fluxos diferentes ao longo do tempo.
- **SAC — 0 linhas** migradas. A heurística usa `timeline_eventos` (`descricao = 'Revertido pra Oficina'`, `excluido_em IS NULL`) pra distinguir **revertidos** (via `sacReverterParaOficina`) de **finalizados normais** — ambos têm `os_origem_id` + `status='finalizado'`, então só a timeline diferencia. Nenhuma reversão existia no histórico; query fica registrada na migração pro caso de aparecerem no futuro.

---

## Armadilha #1 — `pg_trigger_depth()` na cláusula WHEN

**Sintoma:** trigger registrado, função compila, mas nunca dispara.

**Causa:** a `WHEN (...)` é avaliada **antes** da função entrar em execução. Logo, no top-level (UPDATE direto vindo de cliente/MCP/app), `pg_trigger_depth()` retorna **0**, não 1.

```sql
-- ❌ ERRADO: nunca dispara em top-level
CREATE TRIGGER ... WHEN (pg_trigger_depth() = 1) ...

-- ✅ CERTO: dispara em top-level e bloqueia recursão (que veria depth >= 1)
CREATE TRIGGER ... WHEN (pg_trigger_depth() = 0) ...
```

**Como pensar:** durante o corpo da função, `pg_trigger_depth()` retorna 1+. Mas a WHEN é avaliada como pré-condição, então enxerga o nível do *caller*, não da função.

## Armadilha #2 — guard `IS DISTINCT FROM` é estreito por design

`fn_parcela_to_conta` e `fn_conta_to_parcela` só propagam quando mudam os 4 campos sincronizados (`valor`, `vencimento`, `status`, `data_pagamento`/`paga_em`).

**Consequência:** UPDATE em **outros** campos (ex: `descricao` em `contas_pagar`, `nome` em `emprestimo`) **não** dispara propagação. Isso é intencional pra evitar churn, mas significa que mudanças que deveriam refletir em ambos os lados precisam ser feitas manualmente.

Caso conhecido: renomear `emprestimo.nome` não atualiza `contas_pagar.descricao`. Se for renomear, faça em transação:

```sql
BEGIN;
UPDATE emprestimo SET nome = 'Novo Nome' WHERE id = '...';
UPDATE contas_pagar cp
SET descricao = 'Empréstimo ' || e.nome || ' — Parcela ' || p.numero || '/' ||
    (SELECT COUNT(*) FROM emprestimo_parcelas WHERE emprestimo_id = p.emprestimo_id)
FROM emprestimo_parcelas p
JOIN emprestimo e ON e.id = p.emprestimo_id
WHERE cp.emprestimo_parcela_id = p.id AND e.id = '...';
COMMIT;
```

---

## Convenções

### Nome do credor em `emprestimo.nome`

Guardar **só o nome do credor**, sem o prefixo `"Empréstimo "`. O prefixo é responsabilidade da camada que monta `contas_pagar.descricao` (`'Empréstimo ' || e.nome || ' — Parcela X/Y'`).

✅ `nome = 'Henrique'`, `nome = 'Importação'`
❌ `nome = 'Empréstimo Importação'` (gera `"Empréstimo Empréstimo Importação — Parcela 2/36"`)

### Categoria

`contas_pagar.categoria = 'Empréstimos'` (capitalizado, plural — segue padrão de `lancamentos`).

### Status

- `emprestimo_parcelas.status` ∈ `{'pendente', 'pago'}`
- `contas_pagar.status` ∈ `{'pendente', 'pago', 'vencido'}` (constraint permite `'vencido'`, mas hoje propagação é direta sem mapear; se aparecer `'vencido'` no futuro, ajustar `fn_conta_to_parcela` pra mapear → `'pendente'`)
- `contas_receber.status` ∈ `{'pendente', 'recebido'}` (sem `'vencido'` — diferente de `contas_pagar`; vencimento atrasado é derivado da data, não materializado)

### Skip de parcelas já pagas no INSERT

`fn_parcela_to_conta` **não** cria `contas_pagar` quando uma parcela é inserida já com `status = 'pago'`. Reabrir (UPDATE `pago→pendente`) cria sob demanda. Backfill segue a mesma regra: só pendentes geram conta.

### Vínculo de cliente — `cliente_id` + snapshot

As 3 tabelas operacionais que referenciam cliente — `contas_receber`, `oficina_ordens`, `sac_casos` — seguem o **mesmo desenho**, fechado na feature de componente de busca de cliente:

- `cliente_id UUID NULL REFERENCES clientes(id) ON DELETE SET NULL` — vínculo navegável. `idx_<tabela>_cliente_id` parcial (`WHERE cliente_id IS NOT NULL`).
- Junto, **snapshot** `cliente_nome` (+ `cliente_telefone`/`cliente_cpf` em oficina/sac). **Não é redundância:** é histórico imutável. Cliente avulso nunca vira FK; renomear um cliente não reescreve registros antigos.
- `cliente_id IS NULL` = caso avulso **ou** registro pré-feature (sem backfill — `oficina_ordens`/`sac_casos` antigos ficaram NULL de propósito). O snapshot de nome é sempre a fonte de exibição; `cliente_id` é só o ponteiro.
- `ON DELETE SET NULL` (nunca CASCADE): deletar um cliente **não** apaga OS/caso/conta — só zera o ponteiro. O snapshot preserva quem era.

No frontend, o componente único `initClienteSearch` alimenta os 3 modais; salvar avulso passa pelo modal de proteção `cli-avulso-warn-modal`. `sac_casos` e `oficina_ordens` **não** têm entry em `TABLE_MAP` — usam os mappers genéricos `toSnake`/`toCamel`, que já fazem o round-trip `clienteId` ↔ `cliente_id`. Tabela nova que linke cliente deve repetir esse desenho.

---

## Convenções — `lancamentos`

### Transferência entre contas — par com `transferencia_id`

Uma transferência entre contas bancárias é representada por **2 registros** em `lancamentos` que compartilham o mesmo `transferencia_id` (UUID):

- 1 registro `tipo='saida'`, `conta_nome=<origem>`
- 1 registro `tipo='entrada'`, `conta_nome=<destino>`
- ambos com `categoria='Transferência'` e descrição `'Transferência de {origem} para {destino}'`

Criação acontece via UI dedicada (botão `⇄ Transferência` no modal de lançamento). Edição/delete sempre tratam o par junto:
- Editar qualquer um dos 2 abre o modal em modo transferência e altera os 2 lançamentos.
- Deletar qualquer um dos 2 dispara confirmação e deleta o par via `WHERE transferencia_id = <uuid>`.

KPIs Entradas/Saídas/Fluxo/Margem **excluem** transferências (movimentação interna ≠ receita/despesa). Lista, gráfico de categorias e evolução temporal continuam mostrando.

### Dívida técnica — `lancamentos.conta_id`

Coluna `conta_id UUID` existe no schema desde sempre, mas **só é populada para transferências** (criadas a partir desta feature). Lançamentos antigos têm `conta_id = NULL` — match com `contas_bancarias` continua via `conta_nome` (string).

**Consequência:** renomear uma conta bancária quebra o vínculo de lançamentos antigos com a conta. Saldos no JS são recalculados por `conta_nome`, então renames também precisam atualizar todos os lançamentos antigos manualmente (ou popular `conta_id` num backfill).

Backfill possível (não aplicado):
```sql
UPDATE lancamentos l
SET conta_id = cb.id
FROM contas_bancarias cb
WHERE l.conta_id IS NULL AND l.conta_nome = cb.nome;
```

Não foi rodado porque o app ainda lê pelo `conta_nome`. Quando migrar a leitura pra `conta_id`, fazer o backfill antes de remover a leitura por nome.

---

## Tradeoff conhecido — C1 vs C2

Quando uma mudança em `emprestimo` (ex: rename) precisa refletir em descrições de `contas_pagar`, há 3 opções:

- **C1 (em uso):** UPDATE manual em transação. Simples, sem trigger nova. Custo: lembrar de fazer toda vez.
- **C2:** Trigger em `emprestimo` (AFTER UPDATE OF nome) que re-monta descrições. Custo: mais código pra manter, dispara em renames raros.
- **C3:** Relaxar guard pra propagar quando descrição calculada mudar. Custo: lógica mais sofisticada, complexidade desproporcional ao caso.

Decisão atual: **C1**. Se renames passarem a ser frequentes, migrar pra C2.
