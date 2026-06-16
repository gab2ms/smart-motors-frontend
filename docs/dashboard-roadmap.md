# Dashboard Analítico — Roadmap (6 fases)

> Evolução do dashboard de **informativo** para **analítico/gerencial**.
> Princípio transversal: página calma e escaneável; profundidade via
> drill-down (modais) — mais gráficos ≠ melhor dashboard.
> **Última atualização:** 2026-06-16

## Reality-check de dados (vale para TODAS as fases)

Auditoria da base feita antes do roadmap. O que os dados **realmente** suportam:

- **Histórico de faturamento total:** arquivo Tiny (`tiny_pedidos`) cobre
  **dez/2025 → jun/2026** (~7 meses) + PDV (`pdv_pedidos`). Tendência mensal do
  **total** é viável.
- **Canal só é confiável de junho/2026 em diante.** Antes disso a origem estava
  codificada no nome do vendedor; o arquivo Tiny não tem `local_venda_id`. Maio
  no PDV está todo marcado "Tráfego Pago" (artefato do import) — **dado torto**.
  Logo: comparações/tendências **por canal** só ganham sentido conforme os meses
  de PDV acumulam.
- **Lucro é ESTIMATIVA**, não medição: `receita × margem de contribuição média
  plana (~25%)`. Não há CMV real por pedido hoje. Waterfall honesto depende de
  cruzar itens vendidos × custo do produto (Fase 5).
- **Conversão é IMPOSSÍVEL hoje:** não existe funil — sem leads, visitas ou
  sessões rastreadas. Só após instrumentar captação de leads.
- **Comparação com período anterior já é calculada** (`ka`/`mergedAnt`) — está
  pronta, só faltava superfície (Fase 1).

---

## Fase 1 — Cards enriquecidos + Destaques do Período

- **Entrega:** cards de KPI com comparação ao período anterior em destaque
  (diferença absoluta colorida) + faixa "Destaques do Período" (lista simples com
  setas) + selo `est.` no Lucro com tooltip. Cards calmos (sem clique nesta fase).
- **Depende de:** nada novo — só reusa agregados já calculados.
- **Reality-check:** Lucro exibido como estimativa rotulada. Canal nos Destaques
  só como **share do período atual** (não "subiu/caiu vs anterior").
- **Spec detalhada:** [`dashboard-analitico-fase-1.md`](./dashboard-analitico-fase-1.md).
- **Status:** spec aprovada e travada · não implementada.

## Fase 2 — Sparklines

- **Entrega:** mini-gráfico de tendência mensal (dez→jun) dentro dos cards de
  Faturamento, Scooters e Ticket. SVG/CSS leve (o app não usa `<canvas>`).
- **Depende de:** estrutura de card preparada na Fase 1 (coluna flex, sem altura
  travada, ponto de inserção definido — ver §8 da spec da Fase 1).
- **Reality-check:** sparkline do **total** é confiável (7 meses). Sparkline
  **por canal** NÃO entra aqui (só 2 pontos confiáveis). Lucro mensal seria
  estimativa — exibir só se rotulado.

## Fase 3 — Modais analíticos (drill-down do Faturamento)

- **Entrega:** clicar no card abre **modal de análise** (não troca de página).
  Faturamento primeiro: atual vs anterior, evolução diária comparada (2 séries),
  participação por canal, decomposição da variação por canal, insight automático.
  Reintroduz a affordance de clique nos cards (que a Fase 1 removeu).
- **Depende de:** infra de modal já existente no app; Fases 1–2.
- **Reality-check:** decomposição/participação por canal confiável só de junho em
  diante; rotular quando o período incluir meses sem canal.

## Fase 4 — Ticket e Lucro aprofundados

- **Entrega:** modais de drill-down para Ticket Médio (por canal, por vendedor,
  por categoria, evolução diária) e Lucro (comparação, evolução da margem, lucro
  por canal) — Lucro ainda **estimado** até a Fase 5.
- **Depende de:** Fase 3 (padrão de modal); vendedor nos itens e `categoria` no
  produto (já existem).
- **Reality-check:** ticket por canal limitado pela disponibilidade de canal;
  lucro permanece estimativa rotulada.

## Fase 5 — CMV real + Waterfall

- **Entrega:** lucro **real** por pedido (itens vendidos × custo do produto) e
  waterfall Receita → (−) CMV → (=) Lucro Bruto; margem real. Substitui a
  estimativa de margem plana.
- **Depende de:** **Opção B das telas de custo** (custo confiável por produto /
  `produto_precos_id`) — é o pré-requisito de dado. Sem isso o waterfall mente.
- **Reality-check:** só após esta fase o "Lucro" deixa de ser estimativa e o selo
  `est.` sai. Até lá, tudo que envolve lucro fica rotulado como estimativa.

## Fase 6 — Share por canal ao longo dos meses

- **Entrega:** evolução da participação de cada canal mês a mês — quem cresce,
  quem perde relevância (ganho/perda de share, ranking visual).
- **Depende de:** acúmulo de meses **limpos** de PDV (de junho/2026 em diante).
- **Reality-check:** começa pobre (poucos meses) e melhora organicamente a cada
  mês. Não forçar antes de ter ≥3–4 meses de canal confiável.

---

## Fora de escopo até existir dado

- **Taxa de conversão / funil:** requer instrumentar captação de leads/visitas
  antes. Não é uma fase — é um pré-requisito de produto.
