-- =====================================================================
-- NF-e · ETAPA 1 — Schema (REVISAR COM O CONTADOR, NÃO RODAR AINDA)
-- =====================================================================
-- Objetivo: criar a tabela notas_fiscais e adicionar os campos fiscais
-- que faltam em produtos. NÃO altera nenhum fluxo existente.
--
-- DADOS FISCAIS CONFIRMADOS PELO CONTADOR (validados pelo dono):
--   [x] Modelo da nota: NF-e (modelo 55)
--   [x] Regime tributário: Simples Nacional -> usa CSOSN
--   [x] CSOSN: 102
--   [x] CFOP: 5102 (dentro do RJ) / 6102 (outro estado)
--           -> o SISTEMA escolhe pela UF do cliente na emissão (não fixa um só)
--   [x] Origem da mercadoria: 2 (adquirida no mercado interno, importada
--           por terceiro — montadora nacional que importa)
--   [x] NCM scooters: 87116000
--
-- Tudo é idempotente (IF NOT EXISTS) e seguro de rodar uma vez.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PARTE A — Colunas fiscais em `produtos`
-- ---------------------------------------------------------------------
-- Todas nullable: você preenche aos poucos, começando pelos produtos
-- que vai vender este mês. Nada quebra se ficar null.

ALTER TABLE produtos
  -- NCM: Nomenclatura Comum do Mercosul. Classifica o produto p/ a Receita.
  -- 8 dígitos, sem ponto. Informado por produto.
  -- Scooters elétricas = "87116000" (CONFIRMADO pelo contador). Acessórios
  -- têm NCM próprio (a levantar caso vá emitir nota de acessório).
  ADD COLUMN IF NOT EXISTS ncm varchar(8),

  -- CFOP: Código Fiscal de Operações e Prestações. Diz QUE operação é.
  -- 4 dígitos. Para VENDA de mercadoria a consumidor (CONFIRMADO):
  --   dentro do RJ:      "5102"
  --   para outro estado: "6102"
  -- Guardamos aqui o CFOP padrão intraestadual ("5102"); o SISTEMA troca
  -- para "6102" na emissão quando a UF do cliente for diferente de RJ.
  ADD COLUMN IF NOT EXISTS cfop varchar(4),

  -- CSOSN: situação tributária do ICMS no SIMPLES NACIONAL. Um campo só
  -- (igual ao Focus, que usa "icms_situacao_tributaria" p/ CST e CSOSN).
  -- Loja é Simples Nacional -> CSOSN = "102" (CONFIRMADO pelo contador:
  -- tributada pelo Simples, sem permissão de crédito de ICMS).
  ADD COLUMN IF NOT EXISTS cst_csosn varchar(3),

  -- Unidade comercial: como a quantidade é medida. Scooter é unidade.
  -- Default "UN". Outros ex.: "PC" (peça), "CX" (caixa).
  ADD COLUMN IF NOT EXISTS unidade varchar(6) DEFAULT 'UN',

  -- Origem da mercadoria: de onde veio (0 a 8). Vai junto do ICMS na NF.
  --   0 = Nacional
  --   1 = Estrangeira, importação direta
  --   2 = Estrangeira, adquirida no mercado interno  <-- CONFIRMADO
  --       (compro de montadora nacional que importa)
  --   (3..8 = casos específicos de conteúdo de importação)
  ADD COLUMN IF NOT EXISTS origem_mercadoria smallint,

  -- EAN / GTIN: código de barras do produto. OPCIONAL na NF.
  -- Se o produto não tem código de barras, a NF aceita "SEM GTIN".
  -- Ex.: "7891234567895".
  ADD COLUMN IF NOT EXISTS ean varchar(14);

-- Documentação das colunas no próprio banco (aparece no Supabase):
COMMENT ON COLUMN produtos.ncm              IS 'NCM 8 dígitos (scooters=87116000)';
COMMENT ON COLUMN produtos.cfop             IS 'CFOP intraestadual padrão (5102); sistema troca p/ 6102 quando UF do cliente <> RJ';
COMMENT ON COLUMN produtos.cst_csosn        IS 'CSOSN do ICMS (Simples Nacional); scooters=102';
COMMENT ON COLUMN produtos.unidade          IS 'Unidade comercial (default UN)';
COMMENT ON COLUMN produtos.origem_mercadoria IS 'Origem da mercadoria 0-8 (scooters=2: mercado interno/importada por terceiro)';
COMMENT ON COLUMN produtos.ean              IS 'EAN/GTIN (código de barras); opcional, usar "SEM GTIN" se não houver';


-- ---------------------------------------------------------------------
-- PARTE B — Tabela `notas_fiscais`
-- ---------------------------------------------------------------------
-- Uma linha por TENTATIVA de emissão, ligada ao pedido. Guarda o
-- resultado do Focus e os JSONs de envio/retorno p/ auditoria e debug.

CREATE TABLE IF NOT EXISTS notas_fiscais (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Pedido que originou a nota.
  pedido_id     uuid NOT NULL REFERENCES pdv_pedidos(id),

  -- "ref": identificador único que MANDAMOS pro Focus (idempotência).
  -- É a chave usada p/ consultar/cancelar a nota depois. Provável que
  -- seja derivado do pedido (ex.: "PED-<numero_smart>"). Único.
  ref           text NOT NULL UNIQUE,

  -- Modelo do documento. CONFIRMADO: NF-e = 55 (default).
  --   55 = NF-e   |   65 = NFC-e (não usado por ora)
  modelo        smallint NOT NULL DEFAULT 55,

  -- Ambiente em que a nota foi emitida (rastreabilidade):
  --   'homologacao' = teste, sem valor fiscal | 'producao' = real
  ambiente      text NOT NULL DEFAULT 'homologacao'
                  CHECK (ambiente IN ('homologacao','producao')),

  -- Status espelhado do Focus:
  --   'processando_autorizacao' | 'autorizado' | 'erro_autorizacao' | 'cancelado'
  status        text NOT NULL DEFAULT 'processando_autorizacao',

  -- Dados retornados quando AUTORIZADO:
  chave_nfe     varchar(44),   -- chave de acesso (44 dígitos)
  numero        text,          -- número da nota
  serie         text,          -- série

  -- Diagnóstico da SEFAZ (essencial p/ entender rejeição):
  status_sefaz  text,          -- código de status da SEFAZ
  mensagem_sefaz text,         -- mensagem legível (motivo do erro/autorização)

  -- Caminhos do XML e do DANFE (PDF) retornados pelo Focus.
  -- Vêm relativos; concatenar a URL base do ambiente p/ baixar.
  caminho_xml   text,
  caminho_danfe text,

  -- Auditoria: payload enviado e resposta recebida, na íntegra.
  json_envio    jsonb,
  json_retorno  jsonb,

  -- Cancelamento (Etapa 6):
  cancelada_em               timestamptz,
  justificativa_cancelamento text,   -- 15-255 chars exigidos pela SEFAZ

  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Buscar notas por pedido (mostrar status no PDV) e por status (fila).
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_pedido_id ON notas_fiscais(pedido_id);
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_status    ON notas_fiscais(status);

COMMENT ON TABLE notas_fiscais IS 'Notas fiscais emitidas via Focus NFe; 1 linha por tentativa de emissão';


-- =====================================================================
-- FIM — revisar com o contador antes de rodar no Supabase.
-- =====================================================================
