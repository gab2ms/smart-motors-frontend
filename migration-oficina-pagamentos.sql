-- ═══════════════════════════════════════════════════════════════════════════
--  Oficina + SAC — controle de pagamento aos prestadores de serviço
--  (espelha o conceito de Montagens: o que falta pagar por prestador,
--   seleção múltipla e baixa em uma única operação)
--
--  Aditiva pura: só ADD COLUMN IF NOT EXISTS e CREATE TABLE/INDEX/POLICY.
--  Nada existente é alterado ou removido. Rodar inteira, de uma vez.
--  Data: 06/08/2026
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Responsável pelo serviço ────────────────────────────────────────────
-- Reusa `montadores` como cadastro único de PRESTADORES: o mesmo Marcos que
-- monta também faz manutenção (o Pix de R$ 4.566,20 de 04/08/2026 misturou
-- montagem + oficina). Uma lista só = dívida total por pessoa num lugar só.
-- ON DELETE SET NULL: apagar prestador nunca apaga a OS/caso, só solta o ponteiro.
ALTER TABLE oficina_ordens ADD COLUMN IF NOT EXISTS prestador_id UUID NULL REFERENCES montadores(id) ON DELETE SET NULL;
ALTER TABLE sac_casos      ADD COLUMN IF NOT EXISTS prestador_id UUID NULL REFERENCES montadores(id) ON DELETE SET NULL;

-- ── 2. Data de execução do serviço ─────────────────────────────────────────
-- Campo próprio porque `data_conclusao` não serve como data de execução: em
-- 04/08/2026 oito OS de junho/julho foram finalizadas em lote no mesmo dia.
ALTER TABLE oficina_ordens ADD COLUMN IF NOT EXISTS data_servico DATE NULL;
ALTER TABLE sac_casos      ADD COLUMN IF NOT EXISTS data_servico DATE NULL;

CREATE INDEX IF NOT EXISTS idx_oficina_ordens_prestador ON oficina_ordens(prestador_id) WHERE prestador_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sac_casos_prestador      ON sac_casos(prestador_id)      WHERE prestador_id IS NOT NULL;

-- ── 3. Pagamentos aos prestadores ──────────────────────────────────────────
-- Um registro por baixa. Vários registros podem compartilhar o mesmo
-- `lancamento_id` (pagamento agregado de N serviços num Pix só), igual a
-- `montagens_pagamentos`. Pagamento parcial é suportado: o saldo de cada
-- serviço é `custo_mao_obra − SUM(valor dos pagamentos)`.
--
-- Sem colunas derivadas (valor_pago/status) e sem trigger de recálculo: aqui
-- cada serviço é uma unidade só (diferente do lote de montagem, que agrega N
-- motos), então o saldo é somado no cliente — mesmo padrão do `_cpSaldo()` de
-- Contas a Pagar. Menos superfície pra dessincronizar.
CREATE TABLE IF NOT EXISTS oficina_pagamentos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ordem_id       UUID NULL REFERENCES oficina_ordens(id) ON DELETE CASCADE,
  sac_caso_id    UUID NULL REFERENCES sac_casos(id)      ON DELETE CASCADE,
  prestador_id   UUID NULL REFERENCES montadores(id)     ON DELETE SET NULL,
  valor          NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  data_pagamento DATE NOT NULL,
  lancamento_id  TEXT NULL REFERENCES lancamentos(id) ON DELETE SET NULL,
  observacoes    TEXT NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- exatamente uma origem: ou é OS da Oficina, ou é caso do SAC
  CONSTRAINT oficina_pagamentos_origem_unica
    CHECK ((ordem_id IS NOT NULL) <> (sac_caso_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_oficina_pagamentos_ordem      ON oficina_pagamentos(ordem_id)      WHERE ordem_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oficina_pagamentos_sac        ON oficina_pagamentos(sac_caso_id)   WHERE sac_caso_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oficina_pagamentos_prestador  ON oficina_pagamentos(prestador_id)  WHERE prestador_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oficina_pagamentos_lancamento ON oficina_pagamentos(lancamento_id) WHERE lancamento_id IS NOT NULL;

-- RLS: mesmo padrão do resto do app (policy `acesso_total`).
ALTER TABLE oficina_pagamentos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'oficina_pagamentos' AND policyname = 'acesso_total'
  ) THEN
    CREATE POLICY acesso_total ON oficina_pagamentos FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── Conferência (deve devolver as 3 linhas de estrutura + 0 pagamentos) ────
SELECT 'oficina_ordens.prestador_id' AS item,
       count(*) FILTER (WHERE column_name = 'prestador_id') AS ok
  FROM information_schema.columns WHERE table_name = 'oficina_ordens'
UNION ALL
SELECT 'sac_casos.prestador_id',
       count(*) FILTER (WHERE column_name = 'prestador_id')
  FROM information_schema.columns WHERE table_name = 'sac_casos'
UNION ALL
SELECT 'oficina_pagamentos (linhas)', count(*) FROM oficina_pagamentos;
