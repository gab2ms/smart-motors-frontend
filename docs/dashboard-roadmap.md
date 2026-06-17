# Dashboard Analítico — Roadmap Executivo (revisado)

> Evolução do dashboard de **informativo** para **analítico/gerencial**.
> Princípio de produto: página calma e escaneável; profundidade via drill-down
> (centrais/modais) — mais gráficos ≠ melhor dashboard.
> **Última atualização:** 2026-06-17

## ⚠️ Princípio transversal (vale para TODAS as etapas)

1. **Não construir tela antes do dado existir.** Toda superfície analítica
   depende de um dado confiável a montante:
   - *lucro por canal* depende de **lucro correto** (CMV real por pedido);
   - *meta × realizado* depende de **metas cadastradas**;
   - *giro de estoque* depende de **estoque confiável**.
   Sem o dado, a tela mente — então o dado vem primeiro.
2. **A infraestrutura (Etapa 2) vem ANTES do analytics novo.** É a parte chata
   (NF-e, lucro real, consolidação financeira), mas é a trava real. **Não pular
   pra tela bonita adiando a infra** — qualquer analytics construído sobre dado
   torto vira retrabalho.

---

## Reality-check de dados (auditoria da base)

O que os dados **realmente** suportam hoje:

- **Histórico de faturamento total:** arquivo Tiny (`tiny_pedidos`) cobre
  **dez/2025 → jun/2026** (~7 meses) + PDV (`pdv_pedidos`). Tendência mensal do
  **total** é viável.
- **Canal só é confiável de junho/2026 em diante.** Antes disso a origem estava
  codificada no nome do vendedor; o arquivo Tiny não tem `local_venda_id`. Maio
  no PDV está todo marcado "Tráfego Pago" (artefato do import) — **dado torto**.
  Logo: comparações/tendências **por canal** só ganham sentido conforme os meses
  de PDV acumulam.
- **Lucro é ESTIMATIVA**, não medição: `receita × margem de contribuição média
  plana (~25%)`. Não há CMV real por pedido hoje. Lucro real / waterfall honesto
  dependem de cruzar itens vendidos × custo do produto — é a **Opção B (Etapa 2)**.
- **Conversão é IMPOSSÍVEL hoje:** não existe funil — sem leads, visitas ou
  sessões rastreadas. Só após instrumentar captação de leads.
- **Comparação com período anterior já é calculada** (`ka`/`mergedAnt`) — foi a
  superfície entregue na **Etapa 1**.

---

## ETAPA 1 — Finalizar Dashboard Atual

- **Entrega:** cards de KPI com comparação ao período anterior em destaque
  (diferença absoluta colorida) + selo `est.` no Lucro com tooltip. Cards calmos
  (sem clique nesta etapa — o clique volta na Central de Receita, Etapa 4).
- **Status:**
  - ✅ **Cards enriquecidos** — FEITO (commit `df83698`). Spec detalhada em
    [`dashboard-analitico-fase-1.md`](./dashboard-analitico-fase-1.md).
  - ✅ **Destaques do Período removidos** — FEITO, por **redundância com os
    cards**: a comparação vs. período anterior já aparece em destaque em cada
    card, então os insights em prosa repetiam a mesma informação.
  - ⏳ **Ajustes finos de layout/KPI** — pendente (refino visual; sem nova regra).
- **Depende de:** nada novo — reusa agregados já calculados.

## ETAPA 2 — Infraestrutura (a trava real · vem ANTES de qualquer analytics novo)

> Parte chata e estrutural. É pré-requisito de dado de quase tudo que vem depois.

- **NF-e (Focus NFe):** emissão de notas integrada (artefatos `nfe_etapa*.sql`).
- **Opção B — lucro real / `produto_precos_id`:** custo confiável por produto,
  substituindo a margem plana estimada. É o que destrava lucro real, lucro por
  canal e waterfall. Sem isso, tudo que envolve lucro permanece **estimativa
  rotulada**.
- **Consolidação dos dados financeiros:** fechar/normalizar as fontes (Tiny ×
  PDV × lançamentos) pra que a camada financeira tenha base única e confiável.
- **Depende de:** —. **Destrava:** Etapas 3–6 (analytics) e a Central Financeira.

## ETAPA 3 — Analytics Básico (gráficos)

- **Entrega:** **gráfico de faturamento diário** + **gráfico de evolução
  mensal**, logo abaixo dos KPIs.
- **Decisão registrada:** **gráfico real ANTES de sparkline.** A sparkline
  responde pouco (mini-tendência decorativa dentro do card); o gráfico responde
  mais (lê o comportamento do período de fato). Por isso **sparklines deixam de
  ser a evolução central e viram refinamento (Etapa 6)**.
- **Depende de:** histórico de total já é confiável (~7 meses). Gráfico **por
  canal** ainda não (só junho+ é limpo) — entra conforme os meses acumulam.

## ETAPA 4 — Central de Receita V1

- **Entrega:** clicar no **KPI de Faturamento** abre uma **Central de Receita**
  (em vez de mandar pra lista de pedidos genérica). V1 **enxuta**:
  - evolução diária;
  - comparação histórica (vs. período anterior);
  - receita por canal;
  - top vendas.
- **Fora da V1 (não fazer agora):** metas, projeção, lucro por canal, IA/insights.
- **Depende de:** Etapas 1–3; reintroduz a affordance de clique que a Etapa 1
  removeu (agora consistente, em todos os cards de uma vez).

## ETAPA 5 — Demais Centrais (uma por vez)

- **Entrega:** seguindo o padrão da Central de Receita, uma central por vez:
  - **Comercial** (vendas/vendedores/produtos);
  - **Financeira** (DRE, resultado, despesas);
  - **de Caixa** (saldo, fluxo, entradas/saídas).
- **Regra:** cada central só entra **quando o dado dela existir e for confiável**
  (ex.: a **Financeira depende da Opção B / Etapa 2** pra lucro correto).
- **Depende de:** Etapa 4 (padrão de central) + o dado-base de cada uma.

## ETAPA 6 — Analytics Avançado

- **Entrega:** metas, projeções, **insights automáticos**, **sparklines** e
  demais refinamentos sobre as centrais já existentes.
- **Depende de:** todas as anteriores + dados maduros (meses limpos de canal,
  lucro real, metas cadastradas).
- **Reality-check:** só aqui o "Lucro" deixa de ser estimativa (após Opção B) e
  o selo `est.` sai; share por canal ao longo dos meses precisa de ≥3–4 meses
  limpos de PDV (junho/2026 em diante).

---

## Fora de escopo até existir dado

- **Taxa de conversão / funil:** requer instrumentar captação de leads/visitas
  antes. Não é uma etapa — é um pré-requisito de produto.
</content>
</invoke>
