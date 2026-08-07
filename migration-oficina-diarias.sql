-- ═══════════════════════════════════════════════════════════════════════════
--  Oficina — DIÁRIAS do prestador (regime real de pagamento do Marcos)
--
--  Contexto (dono, 06/08/2026): o Marcos vai à loja toda QUARTA-FEIRA e recebe
--  uma diária fixa (R$ 100) + alimentação (~R$ 16), INDEPENDENTE de quantos
--  serviços fez. Logo, o `custo_mao_obra` da OS mede o lucro do serviço, mas
--  NÃO é conta a pagar — a conta a pagar é a quarta-feira.
--
--  Tudo anterior a 04/08/2026 está quitado (vinha embutido nos acertos
--  acumulados de manutenção). O controle começa na quarta 05/08/2026.
--
--  Aditiva: cria tabela nova e 1 coluna; o único DROP é o do CHECK de origem
--  da `oficina_pagamentos`, recriado logo em seguida com a 3ª origem.
--  Data: 07/08/2026
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Diárias ─────────────────────────────────────────────────────────────
-- Uma linha por (prestador, data). `valor_diaria` é o que sai em dinheiro pro
-- prestador — é ISSO que fica pendente. `valor_alimentacao` é a marmita, que
-- normalmente JÁ FOI paga e lançada à parte no caixa: entra aqui só pra compor
-- o custo real da quarta (100 + 16 = 116), sem virar dívida em duplicidade.
CREATE TABLE IF NOT EXISTS oficina_diarias (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestador_id      UUID NOT NULL REFERENCES montadores(id) ON DELETE RESTRICT,
  data              DATE NOT NULL,
  valor_diaria      NUMERIC(12,2) NOT NULL DEFAULT 100 CHECK (valor_diaria >= 0),
  valor_alimentacao NUMERIC(12,2) NOT NULL DEFAULT 0   CHECK (valor_alimentacao >= 0),
  -- Lançamento da marmita que já existe no caixa (opcional): amarra o custo
  -- sem relançar. ON DELETE SET NULL preserva a diária se o lançamento sumir.
  lancamento_alimentacao_id TEXT NULL REFERENCES lancamentos(id) ON DELETE SET NULL,
  observacoes       TEXT NULL,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Uma diária por prestador por dia (evita duplicar ao gerar as quartas).
  CONSTRAINT oficina_diarias_prestador_data_unica UNIQUE (prestador_id, data)
);

CREATE INDEX IF NOT EXISTS idx_oficina_diarias_data      ON oficina_diarias(data);
CREATE INDEX IF NOT EXISTS idx_oficina_diarias_prestador ON oficina_diarias(prestador_id);

ALTER TABLE oficina_diarias ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='oficina_diarias' AND policyname='acesso_total') THEN
    CREATE POLICY acesso_total ON oficina_diarias FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 2. Pagamento de diária ─────────────────────────────────────────────────
-- `oficina_pagamentos` passa a aceitar uma 3ª origem. O CHECK vira "exatamente
-- uma das três", em vez do XOR de duas.
ALTER TABLE oficina_pagamentos ADD COLUMN IF NOT EXISTS diaria_id UUID NULL REFERENCES oficina_diarias(id) ON DELETE CASCADE;

ALTER TABLE oficina_pagamentos DROP CONSTRAINT IF EXISTS oficina_pagamentos_origem_unica;
ALTER TABLE oficina_pagamentos ADD CONSTRAINT oficina_pagamentos_origem_unica
  CHECK (
    (CASE WHEN ordem_id    IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN sac_caso_id IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN diaria_id   IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

CREATE INDEX IF NOT EXISTS idx_oficina_pagamentos_diaria ON oficina_pagamentos(diaria_id) WHERE diaria_id IS NOT NULL;

-- ── 3. Valor padrão da diária (editável na tela de config de custos) ───────
INSERT INTO config_custos (chave, valor, descricao)
VALUES ('oficina_diaria_valor', 100, 'Oficina: valor padrão da diária do prestador (R$)')
ON CONFLICT (chave) DO NOTHING;

-- ── Conferência ────────────────────────────────────────────────────────────
SELECT 'oficina_diarias (linhas)' AS item, count(*)::text AS ok FROM oficina_diarias
UNION ALL
SELECT 'oficina_pagamentos.diaria_id',
       count(*)::text FROM information_schema.columns
 WHERE table_name='oficina_pagamentos' AND column_name='diaria_id'
UNION ALL
SELECT 'config oficina_diaria_valor',
       coalesce(max(valor)::text,'AUSENTE') FROM config_custos WHERE chave='oficina_diaria_valor';
