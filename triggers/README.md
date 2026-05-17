# Triggers — Smart Motors

Notas e convenções para triggers PL/pgSQL no Supabase deste projeto. Migrations vivem direto no Supabase (sem versionamento em arquivo); este doc serve de memória curta pra evitar repetir armadilhas.

## Triggers ativos

| Trigger | Tabela | Eventos | Função | Propósito |
|---|---|---|---|---|
| `trg_parcela_to_conta` | `emprestimo_parcelas` | INSERT, UPDATE, DELETE | `fn_parcela_to_conta()` | Cria/atualiza/deleta `contas_pagar` espelhada |
| `trg_conta_to_parcela` | `contas_pagar` | UPDATE, DELETE | `fn_conta_to_parcela()` | Propaga status/valor/datas de volta pra `emprestimo_parcelas` |

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

`calcularDRE(iniISO, fimISO)` é o cálculo puro do DRE (não toca DOM). Consumido pelo widget `renderDashDreMes` (mês corrente) e pela aba "Resumo" do Excel em `gerarFechamentoMes` (range do selector). Estrutura de **7 linhas**:

```
   Receita (faturamento Tiny)
(−) CPV real — Σ ct(produto) × qtd dos itens vendidos
(+) Ajuste comissão venda direta
=  Margem bruta ajustada
(−) Despesas operacionais
(−) Empréstimos pagos no mês
=  Resultado do mês
```

**Princípio — caixa × competência.** O DRE mistura faturamento Tiny (competência) com lançamentos de caixa. O risco é duplicar: qualquer lançamento que pague algo **já embutido no CPV** conta duas vezes. Por isso o `despReal` exclui a constante `_DRE_CATEGORIAS_FORA_DESPESA`:

- `Fornecedores`, `Motonetas`, `Montagem / Serviço Técnico`, `Nota Fiscal e Imposto` — custo de produto, já no `ct()` do CPV.
- `Empréstimos` — amortização de dívida; entra só na linha própria, vinda de `emprestimo_parcelas` (não dos lançamentos). Antes contava em dobro.
- `Acerto de Caixa`, `Estorno`, `Transferência` — movimentações não-operacionais.

**CPV real:** loop nos `pedidos[].itens[]` do Tiny, `_matchProdutoPorNome` → `Σ ct(prod) × qtd`. Item sem cadastro (acessório/serviço) usa fallback estimado `valor × (1 − avgMCpct)`. O `avgMCpct` (média de MC% — fallback e referência) considera só produtos `ativo !== false`.

**Ajuste de venda direta:** o `ct()` soma `comissao`, mas em venda direta os sócios ("Venda Direta Smart Motors") não recebem comissão. A linha `(+) Ajuste` devolve essa comissão fantasma: `Σ prod.comissao × qtd` dos itens de pedidos de venda direta — comissão **real** de cada produto, não flat R$100 (6 produtos têm `comissao = 0`).

**Instabilidade do Tiny:** `_tinyStabilityCheck` faz 2 buscas forçadas; se a contagem de pedidos diverge, `tinyEstabilidade.estavel = false` → widget mostra badge "⚠️ Dados Tiny instáveis" e o Excel adiciona linha de aviso. É mitigação visual — o fix de raiz do Tiny é separado.

**Decisão de UI:** o widget DRE é a **fonte única** do resultado. O KPI "Lucro líquido est." foi removido do bloco Faturamento do Dashboard e da página Vendas do Mês pra não haver dois lucros líquidos divergentes; "Custo fixo do mês" virou "Custo Fixo Planejado" (deixa claro que é o cadastro, não o real). Existe ainda um `renderDRE`/`recalcDRE` separado (análise de planilha de vendas importada) que **não** usa `calcularDRE` — é outra ferramenta, fora desta estrutura.

## Correções de dados

- **2026-05-17 — `produtos_precos.jonosake` zerado em GT1, G7, Valley e Best.** O campo `jonosake` (componente somado no custo total via `ct()`) tinha R$ 1.157,30 nesses 4 produtos. Não era custo real: era um **acordo temporário de evento** — parte do lucro repassada a um parceiro durante um evento específico. O evento foi encerrado, então o valor não corresponde mais a custo nenhum. `UPDATE produtos_precos SET jonosake = 0` nos 4. Impacto: `avgMCpct` global (média de MC% dos produtos, usada no CPV estimado do `calcularDRE`) subiu de **~22,2% → 23,81%**, melhorando a fidelidade do DRE. Nenhum outro produto tinha `jonosake ≠ 0`.
- **2026-05-17 — split + recategorização de lançamentos de Montagem/NF.** As categorias `Montagem / Serviço Técnico` e `Nota Fiscal e Imposto` misturavam custo de produto (já contado no CPV via `ct()`) com despesa operacional pura. Para o DRE reestruturado poder excluir por nome de categoria (ver "DRE — regime de competência" abaixo), separamos: (1) o lançamento misto de R$ 1.250 ("10 montagens + 150 serviços externos") foi **dividido** em R$ 1.100 (`10 montagens`, fica em `Montagem / Serviço Técnico`) + R$ 150 (`150 serviços externos`, nova categoria `Oficina - Peças e Serviços`); (2) 2 lançamentos de reparo de oficina (R$ 35 frete peça + R$ 330 módulo p/ conserto de cliente) movidos para `Oficina - Peças e Serviços`; (3) o DAS de abril (R$ 242,88) movido para a nova categoria `Imposto e Tributos`. Resultado: `Montagem / Serviço Técnico` (R$ 1.790) e `Nota Fiscal e Imposto` (R$ 600) ficam **puros** (custo de produto, no CPV); `Oficina - Peças e Serviços` (R$ 515) e `Imposto e Tributos` (R$ 242,88) ficam **puros** (operacional). Sem isso, o DRE duplicaria ~R$ 2.390 (montagem/NF já no CPV) ou perderia ~R$ 758 de despesa operacional real. Categorias são texto livre em `lancamentos.categoria` — não há tabela de categorias; "Oficina - Peças e Serviços" e "Imposto e Tributos" passam a existir só pelo uso.

## Schema de Custos de Produtos

Feature "Custos de Produtos" (substitui a aba Simulador). Objetivo: separar o custo bruto do produto dos custos operacionais embutidos, e mover custos não-por-unidade para configuração.

**Tabela `config_custos`** — pares chave/valor para custos que não escalam por unidade vendida:

| chave | valor | descrição |
|---|---|---|
| `nf_pedido` | 30 | Custo de NF por pedido (não por unidade) |

Estrutura: `chave TEXT PK`, `valor NUMERIC NOT NULL`, `descricao TEXT`, `atualizado_em TIMESTAMPTZ DEFAULT now()`. RLS `acesso_total FOR ALL TO public` (mesma convenção das outras tabelas do app).

**Colunas novas em `produtos_precos`:**
- `custo_puro NUMERIC` — custo bruto do produto absorvendo os componentes que `ctReal` não toma separadamente. Backfill: `custo_puro = custo + COALESCE(nf_compra,0) + COALESCE(jonosake,0) + COALESCE(financeiro,0)`.
- `categoria TEXT CHECK (categoria IN ('motoneta','acessorio'))` — default backfill `'motoneta'`.

**Relação `ctReal` × `ct()` legado:** `ctReal = custo_puro + montagem + comissao + nf_pedido`. Para produtos com `nf = 30` (a maioria), `ctReal` reproduz `ct()` exatamente. O único divergente no cadastro atual é o **BAJAX** (`nf = 170`): `ctReal` fica R$ 140 abaixo de `ct()` — diferença intencional, pois a NF deixou de ser por-unidade (170) e virou por-pedido (`nf_pedido = 30`). O componente `nf` por-unidade de `produtos_precos` é deliberadamente abandonado por `ctReal` em favor de `config_custos.nf_pedido`.

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
