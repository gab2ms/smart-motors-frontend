# Triggers — Smart Motors

Notas e convenções para triggers PL/pgSQL no Supabase deste projeto. Migrations vivem direto no Supabase (sem versionamento em arquivo); este doc serve de memória curta pra evitar repetir armadilhas.

## Triggers ativos

| Trigger | Tabela | Eventos | Função | Propósito |
|---|---|---|---|---|
| `trg_parcela_to_conta` | `emprestimo_parcelas` | INSERT, UPDATE, DELETE | `fn_parcela_to_conta()` | Cria/atualiza/deleta `contas_pagar` espelhada |
| `trg_conta_to_parcela` | `contas_pagar` | UPDATE, DELETE | `fn_conta_to_parcela()` | Propaga status/valor/datas de volta pra `emprestimo_parcelas` |

Link: `contas_pagar.emprestimo_parcela_id UUID REFERENCES emprestimo_parcelas(id) ON DELETE CASCADE`.

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

### Skip de parcelas já pagas no INSERT

`fn_parcela_to_conta` **não** cria `contas_pagar` quando uma parcela é inserida já com `status = 'pago'`. Reabrir (UPDATE `pago→pendente`) cria sob demanda. Backfill segue a mesma regra: só pendentes geram conta.

---

## Tradeoff conhecido — C1 vs C2

Quando uma mudança em `emprestimo` (ex: rename) precisa refletir em descrições de `contas_pagar`, há 3 opções:

- **C1 (em uso):** UPDATE manual em transação. Simples, sem trigger nova. Custo: lembrar de fazer toda vez.
- **C2:** Trigger em `emprestimo` (AFTER UPDATE OF nome) que re-monta descrições. Custo: mais código pra manter, dispara em renames raros.
- **C3:** Relaxar guard pra propagar quando descrição calculada mudar. Custo: lógica mais sofisticada, complexidade desproporcional ao caso.

Decisão atual: **C1**. Se renames passarem a ser frequentes, migrar pra C2.
