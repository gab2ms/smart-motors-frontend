# Dashboard Analítico — Especificação Final da Fase 1

> **Status:** **implementada** (commit `df83698`) · escopo: só apresentação/UX
> **Garantia:** diff-zero nos números atuais (nenhuma regra de negócio muda)
> **Última atualização:** 2026-06-17

> ⚠️ **Mudança de escopo na implementação (2026-06-17):** a **faixa "Destaques
> do Período" NÃO foi entregue** — removida por **redundância com os cards**.
> Com a comparação vs. período anterior já em destaque em cada card (diferença
> absoluta colorida + %), os insights repetiam a mesma informação em prosa. O
> que de fato entrou foi só os **cards de KPI enriquecidos**. As §§4, 6 e 7
> abaixo (estados vazios, catálogo de insights e helpers `_insightsBuild`/
> `_insightBanner`/`_insightItem`) descrevem os Destaques e ficam aqui como
> registro histórico do plano — não refletem o código atual.

Fase 1 do roadmap em [`dashboard-roadmap.md`](./dashboard-roadmap.md).
Entrega: **cards de KPI enriquecidos** (comparação com período anterior em
destaque). ~~+ faixa "Destaques do Período"~~ (removida — ver nota acima). Sem
sparklines, sem gráficos, sem modais (essas vêm nas fases seguintes).

---

## 0. Princípios travados

1. **Nenhuma regra de negócio muda.** Faturamento, regra de canal, comparação de
   período, cálculo de lucro (estimativa), dedup Tiny×PDV, janela de data
   (`_janelaPdvUTC`) e `deltaHTML` permanecem como já validados.
2. **Cards calmos e uniformes** — sem hint, sem seta "↗", sem cursor-pointer, sem
   hover-lift e **sem clique** nesta fase. A navegação analítica volta na Fase 3
   via modal, com affordance correta em todos os cards de uma vez.
3. **Comparação com o período anterior é protagonista** — a diferença absoluta
   aparece em destaque, colorida (verde/vermelho), não em linha cinza fininha.
4. **Destaques do Período** = widget configurável no "Personalizar"
   (reordenável/desativável), formato **lista simples com setas direcionais**.

### Por que os cards perdem o clique nesta fase (decisão registrada)

- Manter o clique só nos 3 que hoje navegam (Faturamento/Scooters/Custo) criaria
  inconsistência no hover (3 reagem, 2 não).
- Tirar o realce pra ficarem iguais criaria **clique invisível** (anti-padrão).
- O clique atual só leva às telas genéricas (`pedidos`/`custos`) que a auditoria
  criticou; elas seguem acessíveis pelo menu lateral.
- A Fase 3 devolve o clique do jeito certo (modal analítico).

Perda: atalho de 1 clique. Mitigação: menu lateral. Totalmente reversível.

---

## 1. Wireframes (formatos escolhidos)

**Cards de KPI** — comparação no formato "diferença em destaque":

```
┌ FATURAMENTO DO PERÍODO ┐   ┌ SCOOTERS VENDIDAS ┐   ┌ TICKET MÉDIO ┐
│ R$ 135.202,24          │   │ 14                │   │ R$ 9.657,30  │
│ ▲ +R$ 2.722  (+2%)     │   │ ▼ −1 un  (−7%)    │   │ ▲ +R$159 (+2%)│
│ vs. R$ 132.480 anterior│   │ vs. 15 un anterior│   │ vs. R$9.498 ant│
└────────────────────────┘   │ 14 pedidos        │   │ por pedido    │
                             └───────────────────┘   └───────────────┘
┌ LUCRO BRUTO · est.ⓘ ──┐   ┌ CUSTO FIXO PLANEJADO ┐
│ R$ 33.749,31           │   │ R$ 32.952,98         │
│ ▲ +R$ 629  (+2%)       │   │ média histórica ·    │
│ vs. R$ 33.120 anterior │   │ real no widget DRE   │   ← sem comparação
│ estimativa · MC 25,0%  │   └──────────────────────┘
└────────────────────────┘
```

**Faixa "Destaques do Período"** — lista simples com setas:

```
┌ 📈 DESTAQUES DO PERÍODO ──────────────────────────┐
│ ▲ Faturamento cresceu R$ 2.722 (+2%)              │
│ ▲ Lucro estimado cresceu +2%                      │
│ ▲ Ticket médio subiu +2% (R$ 9.498 → R$ 9.657)    │
│ ▼ Scooters caíram de 15 para 14 unidades          │
│ ● Loja Matriz representa 61% da receita do período│
└────────────────────────────────────────────────────┘
```

Setas: `▲` verde (subiu) · `▼` vermelho (caiu) · `●` neutro (fato/share). A cor
só reforça; a seta + o texto já comunicam a direção (acessibilidade).

Tooltip do selo `est.ⓘ` (Lucro): *"Estimativa: receita do período × margem de
contribuição média atual (25,0%). Não usa CMV real por pedido — lucro real virá
em fase futura."*

---

## 2. Campos · origem · regra de exibição

| Campo | Origem (já calculado em `carregarFaturamentoDash`) | Regra |
|---|---|---|
| Valor faturamento | `receitaTotal` (=`kc.receita`) | `fmt()`, sempre |
| Comparação faturamento | `ka.receita` | linha destaque `±fmt(diff)` + `(±%)` + "vs. {fmt(ka.receita)} anterior"; oculta se `ka.receita<=0` |
| Valor / comparação scooters | `scootersUnid` / `scootersUnidAnt` | diff em **unidades** |
| Valor / comparação ticket | `ticketMedio` (=`kc.ticket`) / `ka.ticket` | diff em R$ |
| Valor / comparação lucro | `lucroBruto` / `lucroBrutoAnt` | diff em R$ + selo `est.ⓘ` |
| Valor custo fixo | `custoFixoMensal` (`_despPlanejadoHistorico().media`) | `fmt()`, **sem comparação** (média histórica, não métrica de período) |
| Tooltip est. | `avgMCpct` | texto fixo + % formatado |
| Destaques | agregados acima + retorno de `renderDashCanais` | ver §6 |

A diferença é `atual − anterior`, calculada na **camada de view** (não é um novo
cálculo de negócio).

---

## 3. Hierarquia visual

- **Primária:** valor atual (fonte grande, cor existente).
- **Secundária (peso + cor):** linha de diferença `±R$/±un (±%)`.
- **Terciária:** "vs. {anterior}", sublabel, selo `est.`.
- **Destaques:** peso menor que os cards (é resumo, não hero).

---

## 4. Estados vazios

| Situação | Card | Destaques |
|---|---|---|
| Sem vendas no período | valor zero, sem chip Δ, **sem linha de comparação** | "Nenhuma venda no período." |
| Sem período anterior / 1º mês da base | some chip Δ e linha de comparação (nunca "∞%"/"+100%") | insights de variação não emitem; só o de share de canal |
| Não-admin | só card Scooters (sem R$) | filtra qualquer item com R$ (mantém qtd e share %) |
| Custo Fixo sem histórico | "—" | não gera insight |

**Regra-mãe:** dado-base ausente ou divisão por zero ⇒ o elemento não aparece.

---

## 5. Responsividade · Hover · Clique

- **Desktop (>1100px):** 5 cards em linha (`kpi-grid`). **Tablet (700–1100px):**
  wrap 2–3. **Mobile (<700px):** empilhados; a linha de diferença quebra abaixo
  do valor; Destaques em 1 coluna, fonte ≥12px.
- **Hover:** cards sem reação (calmos). Único hover ativo = selo `est.ⓘ` →
  tooltip no desktop / tap no mobile.
- **Clique:** nenhum nos cards nesta fase; Destaques sem clique.

---

## 6. Insights automáticos

Catálogo de 6, ordem de prioridade fixa:

1. Faturamento Δ — "Faturamento {cresceu|caiu} {fmt(|diff|)} ({±%})" · guard `ka.receita>0`
2. Lucro est. Δ — "Lucro estimado {cresceu|caiu} {±%}" · guard `lucroBrutoAnt>0` (admin)
3. Ticket Δ — "Ticket médio {subiu|caiu} {±%} (R$ ant → R$ atual)" · guard `ka.ticket>0`
4. Scooters Δ — "Scooters {subiram|caíram} de {ant} para {atual} unidades" · guard `scootersUnidAnt>0`
5. Canal líder — "{Canal top} representa {Z}% da receita do período" · guard `totVal>0`
6. 2º canal — "{Canal 2} representa {W}% do faturamento" · guard ≥2 canais (admin)

**Regras:** máx. **5 itens**; pula guards que falham (sem buracos); `|%|<0,5%` →
"manteve-se estável"; tom factual (sem adjetivos, sem causa inferida); formatação
de % com a mesma regra do `deltaHTML`. **Filtro não-admin:** remove itens com R$.
**Canal vs. anterior fica fora da Fase 1** (maio é dado torto do import Tiny);
canal entra só como share do período atual.

---

## 7. Componentização (funções de view puras → retornam HTML string)

- `_kpiCard({label, valor, cor, deltaHtml, comparaHtml, sublabel, badge})`
- `_kpiCompara(atual, anterior, tipo)` — `tipo ∈ {money, int}`; retorna `''` se `anterior<=0`
- `_kpiBadgeEst(pct)` — selo `est.ⓘ` + `title`
- `_insightsBuild(ctx, ehAdmin)` — aplica §6, devolve array (≤5)
- `_insightBanner(itens)` / `_insightItem(texto)`
- `renderDashCanais` passa a **retornar** `{linhas, totVal, totQtd}` além de
  renderizar (refator de leitura, não muda o que entra na tela).

---

## 8. Preparo estrutural para a Sparkline (Fase 2) — sem implementar agora

Objetivo: a sparkline da Fase 2 entra **sem reestruturar o card** e **sem deixar
vão vazio na Fase 1**. Decisão de "como":

- **Sem altura travada no card.** O card é uma **coluna flex** (`display:flex;
  flex-direction:column`) com `height:auto` e espaçamento por `gap`/padding — a
  altura é definida pelo conteúdo. Assim, quando a Fase 2 inserir o elemento da
  sparkline, o card **cresce naturalmente** em vez de precisar redesenho.
- **Sem caixa reservada vazia.** Na Fase 1 **não** existe um placeholder de
  sparkline ocupando espaço — nada de buraco/área morta. O slot é apenas um
  **ponto de inserção conhecido** no fluxo do markup, não um elemento renderizado.
- **Ponto de inserção definido:** a sparkline da Fase 2 entra **entre a linha de
  comparação ("vs. anterior") e o sublabel inferior**, ocupando largura total do
  card (~24–32px de altura). Como o `gap` da coluna já espaça os blocos, inserir
  um elemento ali não desalinha o resto.
- **Consequência prática para a Fase 1:** ao montar `_kpiCard`, manter a estrutura
  em coluna flex com os blocos na ordem `[label] [valor+Δ] [comparação]
  [sublabel]`, sem `height`/`min-height` fixos que impeçam o crescimento. Nenhum
  CSS extra é renderizado agora — só a organização do markup já fica
  forward-compatible.

Resultado: card completo e bonito agora; pronto pra ganhar a sparkline depois com
uma única inserção.

---

## 9. Plano técnico

**Sequência de implementação:**

1. Criar helpers de view puros (`_kpiCompara`, `_kpiBadgeEst`).
2. Refatorar a montagem das 5 KPIs em `carregarFaturamentoDash` via `_kpiCard` +
   `_kpiCompara`, **1-para-1** (mesmos valores), removendo hints/affordance e
   adotando a coluna flex do §8.
3. `renderDashCanais` passa a retornar `{linhas, totVal, totQtd}`.
4. Criar `_insightsBuild` + `_insightBanner`; adicionar widget `#dash-destaques`
   no builder (após `kpis-fat`, antes de `vendas-canal`) e chamá-lo a partir de
   `carregarFaturamentoDash`.

**Riscos / pontos de atenção:**

- Quebra de markup no refator → mitigação: refator 1-para-1, comparar HTML
  antes/depois; testar o caminho não-admin (só card Scooters) à parte.
- Divisão por zero / sem anterior → helpers retornam `''`.
- Vazamento de R$ pra não-admin nos Destaques → `_insightsBuild` recebe `ehAdmin`
  e filtra.
- Custo Fixo → exceção explícita (sem `_kpiCompara`).
- Ordem do widget pra quem tem layout salvo → já resolvido pela migração de
  `getLayout` (insere na posição relativa do `DB_DEFAULT`).

**Estratégia diff-zero:**

- Os valores hero saem das **mesmas variáveis**; o refator é só montagem de string.
- Validar no app (antes/depois) que os 5 valores + o total do canal seguem
  idênticos (ex.: R$ 135.202,24) e que `atual − anterior` fecha aritmeticamente
  com o chip Δ% já exibido.

---

## ✅ Confirmação

A Fase 1 **não altera nenhuma regra de negócio** — só a camada de
apresentação/UX. Pronta para implementar quando a frente for retomada.
