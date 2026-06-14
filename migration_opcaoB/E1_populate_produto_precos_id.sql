-- ============================================================
-- Opção B · E1 — coluna produto_precos_id em produtos (FK -> produtos_precos)
-- produtos.id e produtos_precos.id são UUID. ON DELETE SET NULL: se a linha
-- de custo for removida, o produto volta a ficar sem vínculo (fallback nome).
-- ============================================================
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS produto_precos_id uuid
  REFERENCES produtos_precos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_produtos_produto_precos_id
  ON produtos(produto_precos_id);

-- 78 UPDATEs (gerados pelo matcher real — refletem o comportamento de hoje)
UPDATE produtos SET produto_precos_id = 'efc4d9c2-9923-4f9c-822d-8d773f9105bb' WHERE id = '2a518541-a4d8-4a52-b3b8-d800b4ea1419';  -- Baú + Suporte Bashi -> Baú + Suporte Bashi
UPDATE produtos SET produto_precos_id = '6baed94e-295c-4c4e-bcd4-66c24f571660' WHERE id = 'c4ebf3de-f688-459a-9b27-ece44ab1f31c';  -- ECO BIKE ELÉTRICA - CINZA -> Eco Bike
UPDATE produtos SET produto_precos_id = '6baed94e-295c-4c4e-bcd4-66c24f571660' WHERE id = '29133c4b-7f8d-4772-86c5-a67260ad0e04';  -- ECO BIKE ELÉTRICA - PRETA -> Eco Bike
UPDATE produtos SET produto_precos_id = '048787e6-88f1-4673-a090-be8860cb044a' WHERE id = '285a8c7e-7f82-4731-8641-9b74c4ae785c';  -- MOTONETA APOLLO 1000W - PRETO -> Apollo
UPDATE produtos SET produto_precos_id = '048787e6-88f1-4673-a090-be8860cb044a' WHERE id = '525d7051-6997-49ed-ba91-578bd5157b1e';  -- MOTONETA APOLLO 1000W - VERMELHO -> Apollo
UPDATE produtos SET produto_precos_id = '155f9ff1-9b8a-4574-a7c5-c115dbd347c7' WHERE id = 'e5fc5231-5234-4aaa-a1c0-be9330e2915e';  -- MOTONETA BAJAX 1000W - AZUL -> Bajax
UPDATE produtos SET produto_precos_id = '155f9ff1-9b8a-4574-a7c5-c115dbd347c7' WHERE id = '25c9d043-818f-4794-be37-3e235e6f32c7';  -- MOTONETA BAJAX 1000W - BRANCA -> Bajax
UPDATE produtos SET produto_precos_id = '155f9ff1-9b8a-4574-a7c5-c115dbd347c7' WHERE id = 'a17fd752-f36a-48d7-981e-8995b6118cb7';  -- MOTONETA BAJAX 1000W - CINZA -> Bajax
UPDATE produtos SET produto_precos_id = '155f9ff1-9b8a-4574-a7c5-c115dbd347c7' WHERE id = 'f8bd2660-18fa-4e06-bc56-76696227272d';  -- MOTONETA BAJAX 1000W - PRETA -> Bajax
UPDATE produtos SET produto_precos_id = '155f9ff1-9b8a-4574-a7c5-c115dbd347c7' WHERE id = '531a2cb6-d0f6-477b-8c96-ac892a581e2d';  -- MOTONETA BAJAX 1000W - VERMELHA -> Bajax
UPDATE produtos SET produto_precos_id = 'df46dac4-75e0-43c6-b59a-2f367f673d4a' WHERE id = '4bd717d2-12ad-4f67-82b9-3611923466f3';  -- MOTONETA ELÉTRICA CONQUEST 1000W - BRANCA -> Conquest
UPDATE produtos SET produto_precos_id = 'df46dac4-75e0-43c6-b59a-2f367f673d4a' WHERE id = '7347f596-a3ea-46f2-bcec-377c987612fb';  -- MOTONETA ELÉTRICA CONQUEST 1000W - CINZA -> Conquest
UPDATE produtos SET produto_precos_id = 'df46dac4-75e0-43c6-b59a-2f367f673d4a' WHERE id = 'f1887636-4a80-415f-8fe4-18506b09f8c9';  -- MOTONETA ELÉTRICA CONQUEST 1000W - PRETA -> Conquest
UPDATE produtos SET produto_precos_id = 'df46dac4-75e0-43c6-b59a-2f367f673d4a' WHERE id = '2eb88f7b-0349-44a2-a424-5ea3c2a6cc78';  -- MOTONETA ELÉTRICA CONQUEST 1000W - VERMELHA -> Conquest
UPDATE produtos SET produto_precos_id = '68f61557-3b0b-4a33-bfda-45e84e9fcd4d' WHERE id = '2f9ac4cd-3cf3-4fa1-a560-2a60403b3cf7';  -- MOTONETA ELÉTRICA EXPLORER 1000W - AZUL ESPACIAL -> Explore
UPDATE produtos SET produto_precos_id = '68f61557-3b0b-4a33-bfda-45e84e9fcd4d' WHERE id = '68ed9674-1b08-45ff-b2b9-3472ba3eae82';  -- MOTONETA ELÉTRICA EXPLORER 1000W - CINZA -> Explore
UPDATE produtos SET produto_precos_id = '8c2eec63-bf79-4c14-aac7-e9e5e12d0cde' WHERE id = '444c5001-478c-41bc-9a6e-a2b6fcbb3fe4';  -- MOTONETA ELÉTRICA FELICIDUO 800W - AZUL -> Felicie Duo
UPDATE produtos SET produto_precos_id = '8c2eec63-bf79-4c14-aac7-e9e5e12d0cde' WHERE id = 'cb836ec4-28a8-4899-817f-10897c7aebfd';  -- MOTONETA ELÉTRICA FELICIDUO 800W - BEGE -> Felicie Duo
UPDATE produtos SET produto_precos_id = '4b09e33d-d9dd-4716-992d-c0d41887ddae' WHERE id = '75f07856-c8f9-460d-ba3f-f86acb3198be';  -- MOTONETA ELÉTRICA FUTURE 800W - PRETA -> Future
UPDATE produtos SET produto_precos_id = '6b2bad40-b835-4dbb-b32b-1bb90636267b' WHERE id = '70f3d6e1-a8d3-45fc-a093-f85361ceed6a';  -- MOTONETA ELÉTRICA G7 1000W - BRANCA -> G7
UPDATE produtos SET produto_precos_id = '6b2bad40-b835-4dbb-b32b-1bb90636267b' WHERE id = 'ff138f53-cd11-4f8b-b69f-ad4097899954';  -- MOTONETA ELÉTRICA G7 1000W - VERMELHA CEREJA -> G7
UPDATE produtos SET produto_precos_id = '6b2bad40-b835-4dbb-b32b-1bb90636267b' WHERE id = '6bd48260-d56b-40ea-82cd-cbbcc93d78b0';  -- MOTONETA ELÉTRICA G7 1000W - VINHO -> G7
UPDATE produtos SET produto_precos_id = '17f733ca-9cea-4170-83ea-9bfedce83065' WHERE id = 'd8dc7f70-22eb-4577-aa1d-887adf750b7e';  -- MOTONETA ELÉTRICA GRAZIE 500W - PRETA -> Grazie
UPDATE produtos SET produto_precos_id = '47765ac7-58eb-423f-bfae-f41a06868e7f' WHERE id = '2cf2acdf-f685-4447-98ea-29982dbb71b7';  -- MOTONETA ELÉTRICA HARLEY 16 FAN 1000W - BRANCO -> Harley 16
UPDATE produtos SET produto_precos_id = '47765ac7-58eb-423f-bfae-f41a06868e7f' WHERE id = 'b9f2043e-dd9a-4b3b-8466-c5aad8f0c6cc';  -- MOTONETA ELÉTRICA HARLEY 16 FAN 1000W - PRETO FOSCO -> Harley 16
UPDATE produtos SET produto_precos_id = '47765ac7-58eb-423f-bfae-f41a06868e7f' WHERE id = 'e1c50d3e-66fc-44c5-b298-aeafec7e23ee';  -- MOTONETA ELÉTRICA HARLEY 16 FAN 1000W - REINO UNIDO AZUL -> Harley 16
UPDATE produtos SET produto_precos_id = '47765ac7-58eb-423f-bfae-f41a06868e7f' WHERE id = '491e8241-bb5b-4fff-ac6a-6cf2f1c17914';  -- MOTONETA ELÉTRICA HARLEY 16 FAN 1000W - VERMELHO METÁLICO -> Harley 16
UPDATE produtos SET produto_precos_id = '10557bc8-18c6-48c1-aa51-8393b6456b20' WHERE id = '151ed4c8-663a-4301-b036-da2b83bc9f70';  -- MOTONETA ELÉTRICA LEE 1000W - BRANCA -> Lee
UPDATE produtos SET produto_precos_id = '10557bc8-18c6-48c1-aa51-8393b6456b20' WHERE id = 'ffb456f4-de0a-4bd6-8bf6-851776f22587';  -- MOTONETA ELÉTRICA LEE 1000W - PRETA -> Lee
UPDATE produtos SET produto_precos_id = '10557bc8-18c6-48c1-aa51-8393b6456b20' WHERE id = 'ccf064ed-f3c4-4f65-8f4c-b0c7d2b93ae8';  -- MOTONETA ELÉTRICA LEE 1000W - VERMELHA -> Lee
UPDATE produtos SET produto_precos_id = 'fdf92f05-9443-452d-8eac-3426c8b63d41' WHERE id = 'cfd9cb40-2447-4805-852d-00ee31c29c9f';  -- MOTONETA ELÉTRICA MAGGIE 500W - BEGE -> Maggie
UPDATE produtos SET produto_precos_id = '6789db15-d0f6-4ebd-862c-91a85ffd67be' WHERE id = 'cf0cb4e6-99eb-4200-910b-30b5082501f5';  -- MOTONETA ELÉTRICA PIT 1000W - AZUL CAMALEÃO -> Pit
UPDATE produtos SET produto_precos_id = '6789db15-d0f6-4ebd-862c-91a85ffd67be' WHERE id = 'cd936ab5-4fb6-4cd9-8147-2c42ad69af3c';  -- MOTONETA ELÉTRICA PIT 1000W - BRANCA -> Pit
UPDATE produtos SET produto_precos_id = '6789db15-d0f6-4ebd-862c-91a85ffd67be' WHERE id = '223896fc-8401-4a3e-bbf0-af4e22934250';  -- MOTONETA ELÉTRICA PIT 1000W - CINZA -> Pit
UPDATE produtos SET produto_precos_id = '6789db15-d0f6-4ebd-862c-91a85ffd67be' WHERE id = '4e278521-62f9-4743-8c0d-acacc8d7baf0';  -- MOTONETA ELÉTRICA PIT 1000W - PRETA FOSCA -> Pit
UPDATE produtos SET produto_precos_id = '6789db15-d0f6-4ebd-862c-91a85ffd67be' WHERE id = '71fe2382-2548-4ce6-be74-7c1f22434225';  -- MOTONETA ELÉTRICA PIT 1000W - VERMELHO -> Pit
UPDATE produtos SET produto_precos_id = 'b65fee4d-3a59-4b11-beda-9e6610c3ff57' WHERE id = 'a10677d3-f08c-4627-93ae-a4e2dae843ea';  -- MOTONETA ELÉTRICA VIX 1000W - PRETA -> Vix
UPDATE produtos SET produto_precos_id = 'b65fee4d-3a59-4b11-beda-9e6610c3ff57' WHERE id = '5cb5af0d-9447-44e4-bdcb-7685da11716c';  -- MOTONETA ELÉTRICA VIX 1000W - VERMELHA -> Vix
UPDATE produtos SET produto_precos_id = 'a84a39ad-e7d2-4b75-a1f2-3b537ab01816' WHERE id = '35f498b5-147b-47fe-a257-27ad780237be';  -- MOTONETA ELÉTRICA X-BUDDY 1000W - AZUL CAMALEAO -> X Buddy 12ah
UPDATE produtos SET produto_precos_id = 'a84a39ad-e7d2-4b75-a1f2-3b537ab01816' WHERE id = 'd3cfdf72-4860-4fb0-bf71-8777421cd56f';  -- MOTONETA ELÉTRICA X-BUDDY 1000W - BRANCA -> X Buddy 12ah
UPDATE produtos SET produto_precos_id = 'a84a39ad-e7d2-4b75-a1f2-3b537ab01816' WHERE id = 'dc282583-a303-4e55-b1d7-de77e70d315c';  -- MOTONETA ELÉTRICA X-BUDDY 1000W - CINZA -> X Buddy 12ah
UPDATE produtos SET produto_precos_id = 'a84a39ad-e7d2-4b75-a1f2-3b537ab01816' WHERE id = 'b50574f6-808d-4206-bba5-d37d14406786';  -- MOTONETA ELÉTRICA X-BUDDY 1000W - PRETA -> X Buddy 12ah
UPDATE produtos SET produto_precos_id = 'a84a39ad-e7d2-4b75-a1f2-3b537ab01816' WHERE id = '33b53d6b-b529-4d41-a03e-cc2f271577c1';  -- MOTONETA ELÉTRICA X-BUDDY 1000W - VINHO -> X Buddy 12ah
UPDATE produtos SET produto_precos_id = '771b8d1a-0f5a-4f88-bb29-d4c04512a7c9' WHERE id = '476195cc-391b-4eed-9267-e993e7877f31';  -- MOTONETA ELÉTRICA X11 1000W - AZUL -> X11
UPDATE produtos SET produto_precos_id = '771b8d1a-0f5a-4f88-bb29-d4c04512a7c9' WHERE id = 'ad360b45-b146-4619-b4c3-91fa90ee9704';  -- MOTONETA ELÉTRICA X11 1000W - BRANCO -> X11
UPDATE produtos SET produto_precos_id = '771b8d1a-0f5a-4f88-bb29-d4c04512a7c9' WHERE id = '6e60e93f-9781-4a5f-9f2c-60ae680f4dff';  -- MOTONETA ELÉTRICA X11 1000W - CINZA CHUMBO -> X11
UPDATE produtos SET produto_precos_id = '771b8d1a-0f5a-4f88-bb29-d4c04512a7c9' WHERE id = '99962a8d-bd53-422d-8382-711b996523f2';  -- MOTONETA ELÉTRICA X11 1000W - PRETA -> X11
UPDATE produtos SET produto_precos_id = '771b8d1a-0f5a-4f88-bb29-d4c04512a7c9' WHERE id = 'fc5a4b9a-bc99-418b-89e1-b48e8722f28a';  -- MOTONETA ELÉTRICA X11 1000W - Vermelha -> X11
UPDATE produtos SET produto_precos_id = '77312b32-99dd-49fc-b2ed-ed841f5f6845' WHERE id = 'ab6b2912-3b64-46b2-8f06-abc0417f32b3';  -- MOTONETA KRONOS 1000W - BRANCO -> Kronos
UPDATE produtos SET produto_precos_id = '77312b32-99dd-49fc-b2ed-ed841f5f6845' WHERE id = 'e93eaa36-4a81-40d5-be53-6c5061841940';  -- MOTONETA KRONOS 1000W - PRETO -> Kronos
UPDATE produtos SET produto_precos_id = '7550da29-188d-4c0b-9890-08d02e16ed6c' WHERE id = '30865437-198a-490e-88db-11fc9b4d883b';  -- MOTONETA NEXOR 1000W - ROXA -> Nexor
UPDATE produtos SET produto_precos_id = '7550da29-188d-4c0b-9890-08d02e16ed6c' WHERE id = '1cc15e97-523f-4354-9886-73c9fcb966d4';  -- MOTONETA NEXOR 1000W - VERDE -> Nexor
UPDATE produtos SET produto_precos_id = '03f1adf2-8658-4795-ad27-9c5b2cf364b3' WHERE id = '390d47e4-9bfa-4e38-b4a8-a706fbfb6ced';  -- MOTONETA PIXXEL AMARELA -> Pixxel
UPDATE produtos SET produto_precos_id = '03f1adf2-8658-4795-ad27-9c5b2cf364b3' WHERE id = 'f834bb37-7126-41ec-95f5-ca59d931b9ff';  -- MOTONETA PIXXEL AZUL -> Pixxel
UPDATE produtos SET produto_precos_id = '03f1adf2-8658-4795-ad27-9c5b2cf364b3' WHERE id = 'cfba57bc-abdb-49f7-b2df-30d5840523bf';  -- MOTONETA PIXXEL BRANCA -> Pixxel
UPDATE produtos SET produto_precos_id = '03f1adf2-8658-4795-ad27-9c5b2cf364b3' WHERE id = 'fec63c00-7654-4501-9a64-e342cbe90b2b';  -- MOTONETA PIXXEL PRETA -> Pixxel
UPDATE produtos SET produto_precos_id = '03f1adf2-8658-4795-ad27-9c5b2cf364b3' WHERE id = 'ae092864-2e50-4a4b-a92e-0ddede543a0e';  -- MOTONETA PIXXEL VERDE -> Pixxel
UPDATE produtos SET produto_precos_id = '03f1adf2-8658-4795-ad27-9c5b2cf364b3' WHERE id = 'eae2ac3a-f6fa-4983-ac45-a263ef0375b9';  -- MOTONETA PIXXEL VERMELHA -> Pixxel
UPDATE produtos SET produto_precos_id = 'ac01a80a-b4cd-4940-80f0-eeab3a1b3ad2' WHERE id = 'd607d9f1-0fa4-444a-9a0a-b2c50b7544b6';  -- MOTONETA RALF 1000W - AZUL -> Ralf
UPDATE produtos SET produto_precos_id = 'ac01a80a-b4cd-4940-80f0-eeab3a1b3ad2' WHERE id = 'bed5c31c-1708-4739-bd49-b1eb736c746a';  -- MOTONETA RALF 1000W - PRATA -> Ralf
UPDATE produtos SET produto_precos_id = 'ac01a80a-b4cd-4940-80f0-eeab3a1b3ad2' WHERE id = '73d2d1da-e8ed-451b-ae00-fa2e4fb61d71';  -- MOTONETA RALF 1000W - PRETA -> Ralf
UPDATE produtos SET produto_precos_id = 'ac01a80a-b4cd-4940-80f0-eeab3a1b3ad2' WHERE id = '4f2e6498-f219-4e93-8f24-5994c4dd28f5';  -- MOTONETA RALF 1000W - VERMELHA -> Ralf
UPDATE produtos SET produto_precos_id = '6cff3186-7877-4ca5-8647-b937898c8809' WHERE id = 'e8d98d30-a51a-44f5-ad9f-f6fa68f663fe';  -- MOTONETA RAPTOR PRO 1000W - AZUL CAMALEAO -> Raptor Pro
UPDATE produtos SET produto_precos_id = '6cff3186-7877-4ca5-8647-b937898c8809' WHERE id = '48af2da5-423d-4c47-8537-11d252bb1faf';  -- MOTONETA RAPTOR PRO 1000W - PRETA -> Raptor Pro
UPDATE produtos SET produto_precos_id = '6cff3186-7877-4ca5-8647-b937898c8809' WHERE id = '7551a71a-fb52-4bbf-be9b-5a3511e7808c';  -- MOTONETA RAPTOR PRO 1000W - VERDE CAMALEAO -> Raptor Pro
UPDATE produtos SET produto_precos_id = '6cff3186-7877-4ca5-8647-b937898c8809' WHERE id = 'e0199ec5-a3cb-4b02-a0c9-bc95100c0e64';  -- MOTONETA RAPTOR PRO 1000W - VERMELHA -> Raptor Pro
UPDATE produtos SET produto_precos_id = 'e45b423a-6841-4e25-8231-d3f805cc2b2b' WHERE id = 'ef848276-15ac-4cbf-8d42-ab5f9cb24cbc';  -- MOTONETA SKYLO AZUL -> Skylo
UPDATE produtos SET produto_precos_id = 'e45b423a-6841-4e25-8231-d3f805cc2b2b' WHERE id = 'a58897d5-4252-4023-a318-3132c7143bcd';  -- MOTONETA SKYLO BRANCA -> Skylo
UPDATE produtos SET produto_precos_id = 'e45b423a-6841-4e25-8231-d3f805cc2b2b' WHERE id = '1209373d-c559-44b8-a8f3-5b030c9f929f';  -- MOTONETA SKYLO PRETA -> Skylo
UPDATE produtos SET produto_precos_id = 'e45b423a-6841-4e25-8231-d3f805cc2b2b' WHERE id = '181cd08c-5673-41b5-957e-a272d8dc1653';  -- MOTONETA SKYLO VERDE -> Skylo
UPDATE produtos SET produto_precos_id = 'e45b423a-6841-4e25-8231-d3f805cc2b2b' WHERE id = '767d0103-1d65-41f3-a91e-b62041772965';  -- MOTONETA SKYLO VERMELHA -> Skylo
UPDATE produtos SET produto_precos_id = '7d18c662-0338-48a5-a2e5-c45529a49cbb' WHERE id = '38b7fe37-d09e-4cd2-98d0-3a26abdfb70b';  -- SCOOTER X14 BRANCA -> SCOOTER X14 BRANCA
UPDATE produtos SET produto_precos_id = '985a43e0-8439-46f2-971f-65507f17e4ca' WHERE id = '2073abec-a0ed-43dc-943d-2276d1395471';  -- SCOOTER X14 CINZA CAMALEÃO -> SCOOTER X14 CINZA CAMALEÃO
UPDATE produtos SET produto_precos_id = '4bef86d6-c417-43d1-bae6-4daa2f97deb6' WHERE id = '69a388bd-1e0d-4ab0-99a7-45dc99f57bda';  -- SCOOTER X14 PRETA -> SCOOTER X14
UPDATE produtos SET produto_precos_id = 'de078c49-5ac9-4f35-bdc2-f54a5c4dbeec' WHERE id = 'e1cb29d3-1f2f-4500-ba4d-f6bde85652fc';  -- SCOOTER X14 VERMELHA -> SCOOTER X14 VERMELHA
UPDATE produtos SET produto_precos_id = '4ee0d655-b5de-494c-9ec7-606aa4f4a68b' WHERE id = 'b7f568c6-f98e-4746-bbe4-26adb4d63ade';  -- TRICICLO ELÉTRICO 1000W - BEGE -> Triciclo
UPDATE produtos SET produto_precos_id = '4ee0d655-b5de-494c-9ec7-606aa4f4a68b' WHERE id = 'eb760214-de1a-4376-ad37-8171d17aa614';  -- TRICICLO ELÉTRICO 1000W - CINZA -> Triciclo
UPDATE produtos SET produto_precos_id = '4ee0d655-b5de-494c-9ec7-606aa4f4a68b' WHERE id = '7f516688-1090-4ff4-bb8b-6efba1fe19e8';  -- TRICICLO ELÉTRICO 1000W - VERMELHO -> Triciclo
