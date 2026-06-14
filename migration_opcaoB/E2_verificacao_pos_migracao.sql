-- ============================================================
-- Opção B · E2 — verificação READ-ONLY após rodar a E1
-- Rodar DEPOIS do ALTER + dos 78 UPDATEs. Nada aqui escreve.
-- ============================================================

-- 1) Cobertura: quantos produtos ativos ficaram com vínculo vs NULL
select
  count(*) filter (where produto_precos_id is not null) as com_id,
  count(*) filter (where produto_precos_id is null)     as sem_id,
  count(*)                                              as total_ativos
from produtos
where ativo is true;
-- Esperado (auditoria E0): com_id = 78, sem_id = 24 (20 acessório + 2 serviço + 2 scooter)

-- 2) Os NULL — confirmar que são acessório/serviço + os 2 scooters já conhecidos
select categoria, count(*)
from produtos
where ativo is true and produto_precos_id is null
group by categoria
order by categoria;

-- 3) Scooters ativos SEM vínculo (devem ser só os 2: MC20 2000W e Pagamento Faltante)
select id, nome
from produtos
where ativo is true and categoria = 'scooter' and produto_precos_id is null
order by nome;

-- 4) Integridade: nenhum produto_precos_id deve apontar pra linha inexistente
--    (a FK já garante, mas confirma 0)
select count(*) as fk_quebrada
from produtos p
where p.produto_precos_id is not null
  and not exists (select 1 from produtos_precos pp where pp.id = p.produto_precos_id);

-- 5) Linhas de custo NÃO referenciadas (os 7 órfãos descontinuados — inertes)
select pp.id, pp.modelo
from produtos_precos pp
where not exists (select 1 from produtos p where p.produto_precos_id = pp.id)
order by pp.modelo;
-- Esperado: GT1, Best, Valley, Sol, Ready, Dot, X Buddy 20ah
