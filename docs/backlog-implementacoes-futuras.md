# Backlog de Implementações Futuras

> Itens registrados com dependências e cuidados — pra não virar retrabalho nem
> perder contexto entre sessões.
> **Última atualização:** 2026-06-20
>
> **Status:** #1 e #2 pendentes. **#3 ✅ FEITO** (Pedidos `5a4f79b`, Caixa `8be1b70`,
> Dashboard `89be020`, Montagem `462bb93`, DRE `62193d6` — todos sobre o helper único
> `calcPeriodoAtalho`). **#4 ✅ FEITO** (commit `5a4f79b`).

---

## 1. Relatórios de Venda (alimentam as Centrais Analíticas)

**Onde vive:** dentro das **Centrais Comercial / Receita** (Etapas 4–5 do
[`dashboard-roadmap.md`](./dashboard-roadmap.md)). **Não é frente isolada** — são
as quebras analíticas dessas centrais.

**Relatórios previstos:**
- **Venda por scooter/modelo** — mais vendidos, ticket médio por modelo, volume.
- **Venda por vendedor** — performance e ranking.
- **Venda por canal** — já existe o **widget base** no dashboard (ponto de partida).
- **Outras quebras** — por período, por categoria, por forma de pagamento.

**Dependências / cuidados:**
- ⚠️ **Maio/2026 é dado torto** — o sync do Tiny jogou tudo como "Tráfego Pago".
  **Só junho/2026 em diante é confiável** para análises por canal (mesmo
  reality-check da Etapa 3 do roadmap).
- ⚠️ **Venda por vendedor depende de associação correta** + da tabela
  `vendedores_mapeamento` (nomes do Tiny vêm **duplicados** — precisa de
  de-duplicação/normalização antes de ranquear).
- Seguir o princípio transversal do roadmap: **não construir a tela antes do dado
  existir e ser confiável.**
- Registrar/entregar **dentro das centrais**, não como módulo de relatórios à parte.

---

## 2. Unificação SAC + Oficina (com custo real de serviço)

**O quê:**
- **Unificar os módulos SAC e Oficina** (hoje separados).
- Registrar o **CUSTO real do serviço** (mão de obra + peças) — não só o **preço
  cobrado** — para calcular **LUCRO REAL por serviço**.

**Dependências / cuidados:**
- ⚠️ **Mesmo princípio da Opção B** (custo real, não só preço): quando a **Opção B
  / Etapa 2** for feita, o lucro de serviço entra na **mesma lógica de DRE/margem**.
  Alinhar com essa base em vez de inventar cálculo paralelo.
- **Custo de peça** pode vir do **estoque** ou ser **avulso** — **definir no design**.
- ⚠️ **Investigar histórico antes de implementar.** Já existem as tabelas
  `sac_casos` e `oficina_ordens`, **e também** os backups `backup_sac_pre_unif`
  e `backup_oficina_pre_unif` — isso sugere uma **unificação parcial anterior**.
  Entender o que já foi tentado/feito antes de mexer.

---

## 3. Atalhos de Período (em todos os módulos com filtro de data) — ✅ FEITO

> **Concluído.** Helper único `calcPeriodoAtalho(tipo)` em `index.html` (devolve
> `{iniISO,fimISO}` p/ mes-atual, mes-anterior, quinzena/15d, 7d, 30d, trimestre,
> ano) com **5 appliers** que o reusam, um por módulo de filtro de range:
> - **Pedidos** `_pedAtalhoPeriodo` (`5a4f79b`)
> - **Caixa/Lançamentos** `_finCaixaAtalhoPeriodo` (`8be1b70`) — era a única lacuna real
> - **Dashboard** `setPeriodoPreset` refatorado p/ delegar (`89be020`)
> - **Montagem** `setMontPeriodoPreset` refatorado (`462bb93`)
> - **DRE** `_finDrePreset` refatorado (`62193d6`)
>
> **Decisão "coexistir":** Dashboard/Montagem/DRE já tinham 7d/30d — mantidos; só
> ADICIONADOS 15d/trimestre/ano. Diff-zero no comportamento atual verificado
> numericamente (mês atual/anterior/7d/30d idênticos pela lógica nova). A data
> personalizada segue nos inputs. Inputs de data avulsos (vencimento, pgto, etc.)
> são campos de formulário — fora de escopo (não são filtros de range).

**O quê:**
- Botões de **período pré-definido**: mês atual, mês anterior, quinzenal,
  trimestral, anual — **mantendo** a opção de **data personalizada**.
- **Mínimo viável:** mensal (mês atual / mês anterior).

**Dependências / cuidados:**
- ⚠️ **Criar UM componente/helper de período reutilizável** por todos os módulos.
  **NÃO** implementar separado em cada tela (senão vira N implementações
  divergentes pra manter).
- **Reaproveitar a lógica de data já existente** — `calcPeriodoAnterior` e
  `_janelaPdvUTC` (ambos no `index.html`) — em vez de reescrever cálculo de janela.

---

## 4. Itens na Lista de Pedidos — ✅ FEITO (commit `5a4f79b`)

**O quê (entregue):**
- Todos os itens do pedido (nome completo do modelo) exibidos **abaixo do nome
  do cliente** na lista de pedidos, sem abrir o pedido.

**Como ficou:**
- `carregarPedidosUnif` traz itens das 2 fontes: `+raw` no select do Tiny (itens
  em `raw.itens[].item.descricao`) e join `pdv_itens_pedido(...)` no select do PDV.
- `_unifArquivo`/`_unifPdv` normalizam um array `itens`; PDV ordenado por `ordem`
  (⚠️ `toCamel` é **shallow** → chaves internas do join seguem snake_case).
- `_pedidoItensLista` renderiza a lista completa (distinto do `_pedidoProdutoLabel`
  compacto usado no dashboard).

**Cuidado remanescente:**
- O select do Tiny agora puxa a coluna `raw` (JSONB grande) por pedido. OK pelo
  arquivo ser limitado (dez/2025→31/05/2026) e a busca ser por data; em range
  largo o payload cresce. Otimização futura: pedir só `raw->itens`.
