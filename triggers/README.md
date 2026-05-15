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
