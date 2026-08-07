-- ═══════════════════════════════════════════════════════════════════════════
--  Oficina/SAC — regime de mão de obra por serviço
--
--  Contexto (dono, 07/08/2026): custo zero é AMBÍGUO. Pode ser "o Marcos fez
--  na quarta e já está pago pela diária" ou "não gastou nada com ninguém"
--  (resolvido internamente). Hoje 46 das 54 OS estão com custo zero — tratar
--  isso como trabalho do Marcos encheria o painel de serviço que não é dele.
--
--  A coluna torna a intenção EXPLÍCITA:
--    NULL        → a classificar (histórico; aparece numa lista pra revisar)
--    'sem_custo' → não teve custo de mão de obra terceirizada
--    'diaria'    → o prestador fez dentro da diária da quarta (não paga extra,
--                  mas conta como serviço coberto por aquela diária)
--    'a_parte'   → cobrado à parte, além da diária → usa `custo_mao_obra` e
--                  entra no "a pagar ao prestador"
--
--  Aditiva pura. Data: 07/08/2026
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE oficina_ordens ADD COLUMN IF NOT EXISTS mao_obra_regime TEXT NULL;
ALTER TABLE sac_casos      ADD COLUMN IF NOT EXISTS mao_obra_regime TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oficina_ordens_mao_obra_regime_chk') THEN
    ALTER TABLE oficina_ordens ADD CONSTRAINT oficina_ordens_mao_obra_regime_chk
      CHECK (mao_obra_regime IS NULL OR mao_obra_regime IN ('sem_custo','diaria','a_parte'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sac_casos_mao_obra_regime_chk') THEN
    ALTER TABLE sac_casos ADD CONSTRAINT sac_casos_mao_obra_regime_chk
      CHECK (mao_obra_regime IS NULL OR mao_obra_regime IN ('sem_custo','diaria','a_parte'));
  END IF;
END $$;

-- Índice parcial: a tela filtra "a classificar" (NULL) e "a pagar" ('a_parte').
CREATE INDEX IF NOT EXISTS idx_oficina_ordens_mao_obra_regime ON oficina_ordens(mao_obra_regime) WHERE mao_obra_regime IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sac_casos_mao_obra_regime      ON sac_casos(mao_obra_regime)      WHERE mao_obra_regime IS NOT NULL;

-- Backfill mínimo e seguro: quem JÁ tem custo lançado só pode ser 'a_parte'
-- (foi cobrado além da diária — as 8 OS de R$ 710 já pagas no acerto de 04/08).
-- Quem está com custo zero fica NULL de propósito: é o "a classificar" que o
-- dono pediu pra revisar, e não dá pra adivinhar sem ele.
UPDATE oficina_ordens SET mao_obra_regime = 'a_parte'
 WHERE mao_obra_regime IS NULL AND coalesce(custo_mao_obra, 0) > 0;
UPDATE sac_casos SET mao_obra_regime = 'a_parte'
 WHERE mao_obra_regime IS NULL AND coalesce(custo_mao_obra, 0) > 0;

-- ── Conferência ────────────────────────────────────────────────────────────
SELECT coalesce(mao_obra_regime, '(a classificar)') AS regime,
       count(*)                                     AS os,
       to_char(sum(coalesce(custo_mao_obra,0)), 'FM999G999D00') AS custo
  FROM oficina_ordens GROUP BY 1 ORDER BY 1;
