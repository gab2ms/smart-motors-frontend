# Backlog de Implementações Futuras

> Itens registrados com dependências e cuidados — pra não virar retrabalho nem
> perder contexto entre sessões.
> **Última atualização:** 2026-06-20
>
> **Status:** #1 e #2 pendentes. **#4 ✅ FEITO** (commit `5a4f79b`). **#3 🟡 PARCIAL**
> — helper reutilizável `calcPeriodoAtalho` + 1ª integração (tela de Pedidos) feitos
> no mesmo commit; falta espalhar pros demais módulos com filtro de data.

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

## 3. Atalhos de Período (em todos os módulos com filtro de data) — 🟡 PARCIAL

> **Feito (commit `5a4f79b`):** helper reutilizável `calcPeriodoAtalho(tipo)` em
> `index.html` (devolve `{iniISO,fimISO}` p/ mes-atual, mes-anterior, quinzena,
> trimestre, ano) + 1ª integração na tela de **Pedidos** (`_pedAtalhoPeriodo` +
> 5 botões; data personalizada preservada). **Falta:** espalhar pros demais
> módulos com filtro de data (Dashboard, DRE, Caixa…), cada um com seu applier
> reusando `calcPeriodoAtalho` — um por vez.

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
