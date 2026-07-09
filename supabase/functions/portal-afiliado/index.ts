import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Edge Function: portal do afiliado. ÚNICA peça que toca o banco em nome do portal.
// A página portal.html (GitHub Pages) NÃO carrega chave Supabase — só chama esta
// função, que roda com service_role e devolve apenas dados sanitizados (allowlist).
// Nada de custo, fornecedor, quantidade de estoque, outros afiliados ou outras tabelas.
//
// Endpoints (via ?acao=):
//   login     — body { identificador, telefone } → { token, afiliado:{id,nome} }
//   cadastro  — body { nome, telefone, email, documento, cidade, uf, chavePix, instagram, termoAceito }
//               → cria afiliado PENDENTE (ativo=false) pra aprovação no painel; { ok:true }
//   dados     — header Authorization: Bearer <token> → { vitrine[], pedidos[], totais, gerais }
//   materiais — header Authorization + ?modelo=<produto_precos_id> OU ?geral=1
//               → { materiais: [{id,tipo,titulo,nome,tamanho,url}] } (signed URLs 1h)
//
// Secrets necessários (Settings → Edge Functions):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (default nas functions) e PORTAL_SECRET.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

const enc = new TextEncoder();
const TOKEN_TTL_S = 60 * 60 * 12; // 12h

// ── HMAC token (sem dependência externa; assina { afiliadoId, exp }) ──
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToStr(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}
async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return b64url(new Uint8Array(sig));
}
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function makeToken(secret: string, afiliadoId: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ afiliadoId, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_S })));
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}
async function readToken(secret: string, token: string): Promise<{ afiliadoId: string } | null> {
  if (!token || token.indexOf(".") < 0) return null;
  const [payload, sig] = token.split(".");
  const expected = await hmac(secret, payload);
  if (!timingSafeEq(sig, expected)) return null;
  try {
    const obj = JSON.parse(b64urlToStr(payload));
    if (!obj.afiliadoId || !obj.exp || obj.exp < Math.floor(Date.now() / 1000)) return null;
    return { afiliadoId: String(obj.afiliadoId) };
  } catch {
    return null;
  }
}

// ── Comissão escalonada por unidade (réplica de _aflComissaoEscalonadaUnit no
//    index.html — mantenha as duas em sincronia). Vendeu no/abaixo do mínimo →
//    faixas=0 → comissão = base. Teto (quando configurado) trava a comissão. ──
type CfgComissao = { base: number; incremento: number; passo: number; teto: number | null };
function comissaoUnit(valorUnit: number, precoMin: number, cfg: CfgComissao): number {
  const faixas = Math.max(0, Math.floor(((valorUnit || 0) - (precoMin || 0)) / (cfg.passo || 100)));
  const c = cfg.base + cfg.incremento * faixas;
  return cfg.teto != null ? Math.min(c, cfg.teto) : c;
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const isScooter = (cat: unknown) => /scooter|motoneta|triciclo/i.test(String(cat ?? ""));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = new URL(req.url);
    const acao = url.searchParams.get("acao") || "";
    const SUPA_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SECRET = Deno.env.get("PORTAL_SECRET");
    if (!SUPA_URL || !SERVICE) return json({ error: "Função sem SUPABASE_URL/SERVICE_ROLE_KEY" }, 500);
    if (!SECRET) return json({ error: "PORTAL_SECRET não configurado" }, 500);
    const sb = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });

    // ───────────────────────── LOGIN ─────────────────────────
    if (acao === "login") {
      const body = await req.json().catch(() => ({}));
      const idNome = norm(body.identificador);
      const tel = digits(body.telefone);
      if (!idNome || !tel) return json({ error: "Informe nome e telefone." }, 400);

      const { data, error } = await sb.from("afiliados").select("id,nome,telefone,email,ativo,status");
      if (error) return json({ error: "Falha ao validar." }, 500);
      // identificador casa com o nome OU com o e-mail; telefone é o 2º fator.
      const match = (data || []).filter((a) =>
        (norm(a.nome) === idNome || (a.email && norm(a.email) === idNome)) && digits(a.telefone) === tel);
      // Match único: decide pelo status. Pendente/rejeitado/inativo NÃO logam (mas
      // damos uma mensagem clara — é o próprio dado da pessoa). 0 ou ambíguo = genérico.
      if (match.length === 1) {
        const afil = match[0];
        if (afil.status === "pendente")
          return json({ error: "Seu cadastro está em análise. A loja vai liberar seu acesso em breve." }, 403);
        if (afil.status === "rejeitado" || afil.ativo === false)
          return json({ error: "Acesso indisponível no momento. Fale com a loja." }, 403);
        const token = await makeToken(SECRET, afil.id);
        return json({ token, afiliado: { id: afil.id, nome: afil.nome } });
      }
      return json({ error: "Nome ou telefone não confere." }, 401);
    }

    // ───────────────────────── CADASTRO (auto-cadastro da campanha) ─────────────────────────
    // A pessoa preenche o formulário no portal e aceita o termo → cria um afiliado
    // PENDENTE (ativo=false). O admin aprova depois no painel. Sem senha (login futuro
    // será nome/e-mail + telefone, como os demais).
    if (acao === "cadastro") {
      const body = await req.json().catch(() => ({}));
      const nome = String(body.nome ?? "").trim();
      const telefone = String(body.telefone ?? "").trim();
      const email = String(body.email ?? "").trim();
      const documento = String(body.documento ?? "").trim();
      const cidade = String(body.cidade ?? "").trim();
      const uf = String(body.uf ?? "").trim().toUpperCase().slice(0, 2);
      const chavePix = String(body.chavePix ?? "").trim();
      const instagram = String(body.instagram ?? "").trim();
      const termoAceito = body.termoAceito === true;

      if (nome.length < 3) return json({ error: "Informe seu nome completo." }, 400);
      if (digits(telefone).length < 10) return json({ error: "Informe um WhatsApp válido com DDD." }, 400);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Informe um e-mail válido." }, 400);
      if (!termoAceito) return json({ error: "É preciso aceitar o termo de uso pra continuar." }, 400);

      // Dedup por telefone OU e-mail (não duplica quem já se cadastrou / já é afiliado).
      const tel = digits(telefone);
      const { data: existentes } = await sb.from("afiliados").select("telefone,email,status");
      const dup = (existentes || []).find((a) =>
        digits(a.telefone) === tel || (email && a.email && norm(a.email) === norm(email)));
      if (dup) {
        const msg = dup.status === "pendente"
          ? "Você já tem um cadastro em análise. Aguarde a liberação da loja."
          : "Já existe um cadastro com esse telefone ou e-mail. Se já é afiliado, é só entrar.";
        return json({ error: msg }, 409);
      }

      const { error: insErr } = await sb.from("afiliados").insert({
        nome, telefone, email: email || null, documento: documento || null,
        cidade: cidade || null, uf: uf || null, chave_pix: chavePix || null,
        instagram: instagram || null,
        status: "pendente", ativo: false, criado_via: "portal",
        termo_aceito: true, termo_aceito_em: new Date().toISOString(), termo_versao: "v1-2026-07",
      });
      if (insErr) return json({ error: "Não foi possível enviar o cadastro. Tente de novo." }, 500);
      return json({ ok: true });
    }

    // ───────────────────────── DADOS ─────────────────────────
    if (acao === "dados") {
      const auth = req.headers.get("authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      const tok = await readToken(SECRET, token);
      if (!tok) return json({ error: "Sessão inválida ou expirada." }, 401);
      const afiliadoId = tok.afiliadoId;

      // Escala global da comissão.
      const { data: ccRows } = await sb.from("config_custos").select("chave,valor")
        .in("chave", ["afiliado_comissao_base", "afiliado_comissao_incremento", "afiliado_comissao_passo", "afiliado_comissao_teto"]);
      const ccMap = new Map((ccRows || []).map((r) => [r.chave, r.valor == null ? null : Number(r.valor)]));
      const tetoRaw = ccMap.get("afiliado_comissao_teto");
      const cfg: CfgComissao = {
        base: ccMap.get("afiliado_comissao_base") || 100,
        incremento: ccMap.get("afiliado_comissao_incremento") || 50,
        passo: ccMap.get("afiliado_comissao_passo") || 100,
        teto: tetoRaw != null && tetoRaw > 0 ? tetoRaw : null, // 0/NULL = sem teto (espelha _aflCfgEscala)
      };
      // Delta do preço sugerido automático: quanto acima do mínimo a comissão atinge o teto.
      const deltaSugerido = cfg.teto != null && cfg.teto > cfg.base && cfg.incremento > 0
        ? Math.ceil((cfg.teto - cfg.base) / cfg.incremento) * cfg.passo
        : null;

      // produtos_precos: modelo + preços + conteúdo comercial (allowlist — nada de custo).
      // visivel_afiliado = seleção do admin: só produtos marcados entram na vitrine.
      const { data: precos } = await sb.from("produtos_precos")
        .select("id,modelo,preco_minimo_afiliado,preco_sugerido_afiliado,ficha_tecnica,condicoes_pagamento,visivel_afiliado");
      const precoById = new Map((precos || []).map((p) => [p.id, p]));

      // Contagem de materiais ativos por modelo (NULL = materiais gerais da loja).
      const { data: mats } = await sb.from("afiliados_materiais")
        .select("produto_precos_id,tipo").eq("ativo", true);
      const matCount = new Map<string, { imagens: number; arquivos: number }>();
      for (const m of mats || []) {
        const key = m.produto_precos_id == null ? "__geral__" : String(m.produto_precos_id);
        const c = matCount.get(key) || { imagens: 0, arquivos: 0 };
        if (m.tipo === "imagem") c.imagens++; else c.arquivos++;
        matCount.set(key, c);
      }

      // produtos: estoque/categoria por variante, ligados ao modelo pela FK.
      const { data: prods } = await sb.from("produtos")
        .select("id,categoria,estoque,ativo,produto_precos_id,comissao_afiliado");
      const prodById = new Map((prods || []).map((p) => [p.id, p]));

      // ── Vitrine: agrega por modelo (FK exata) os produtos que o admin marcou como
      //    visíveis no programa (visivel_afiliado). Qualquer categoria — permite liberar
      //    acessórios, não só scooters. Sem quantidade/custo. ──
      const vitMap = new Map<string, { id: string; modelo: string; disponivel: boolean; precoMinimo: number | null }>();
      for (const p of prods || []) {
        if (p.ativo === false) continue;
        if (!p.produto_precos_id) continue;
        const pp = precoById.get(p.produto_precos_id);
        if (!pp) continue;
        if (!pp.visivel_afiliado) continue; // fora do programa → não aparece no portal
        const key = String(p.produto_precos_id);
        const cur = vitMap.get(key) || {
          id: key,
          modelo: pp.modelo || "Modelo",
          disponivel: false,
          precoMinimo: pp.preco_minimo_afiliado != null ? Number(pp.preco_minimo_afiliado) : null,
        };
        if (Number(p.estoque) > 0) cur.disponivel = true;
        vitMap.set(key, cur);
      }
      const comissaoBaseTexto = `Base R$ ${cfg.base} + R$ ${cfg.incremento} a cada R$ ${cfg.passo} acima do mínimo`
        + (cfg.teto != null ? ` (teto R$ ${cfg.teto})` : "");
      const vitrine = [...vitMap.values()]
        // disponíveis primeiro; depois indisponíveis. Dentro de cada grupo, por nome.
        .sort((a, b) => (Number(b.disponivel) - Number(a.disponivel)) || a.modelo.localeCompare(b.modelo))
        .map((v) => {
          const pp = precoById.get(v.id) || {};
          // Preço sugerido: manual do modelo vence; senão automático = mínimo + delta do teto.
          const manual = pp.preco_sugerido_afiliado != null ? Number(pp.preco_sugerido_afiliado) : null;
          const auto = v.precoMinimo != null && deltaSugerido != null ? v.precoMinimo + deltaSugerido : null;
          const precoSugerido = manual ?? auto;
          const mc = matCount.get(v.id) || { imagens: 0, arquivos: 0 };
          return {
            ...v,
            comissaoBaseTexto,
            comissaoMinimo: v.precoMinimo != null ? cfg.base : null,
            precoSugerido,
            comissaoSugerido: precoSugerido != null && v.precoMinimo != null
              ? comissaoUnit(precoSugerido, v.precoMinimo, cfg) : null,
            fichaTecnica: pp.ficha_tecnica || null,
            condicoesPagamento: pp.condicoes_pagamento || null,
            qtdImagens: mc.imagens,
            qtdArquivos: mc.arquivos,
          };
        });
      const gerais = matCount.get("__geral__") || { imagens: 0, arquivos: 0 };

      // ── Pedidos do próprio afiliado (status != cancelado). ──
      const { data: peds } = await sb.from("pdv_pedidos")
        .select("numero_smart,total,status,criado_em,data_entrega_real,cliente_dados,comissao_afiliado_override,pdv_itens_pedido(produto_id,quantidade,valor_unitario,valor_total)")
        .eq("afiliado_id", afiliadoId)
        .neq("status", "cancelado")
        .order("criado_em", { ascending: false });

      const comissaoDoPedido = (ped: any): number => {
        if (ped.comissao_afiliado_override != null) return Number(ped.comissao_afiliado_override);
        const itens = ped.pdv_itens_pedido || [];
        let soma = 0;
        for (const it of itens) {
          const qtd = Number(it.quantidade || 0);
          if (!qtd) continue;
          const prod = prodById.get(it.produto_id);
          const pp = prod && prod.produto_precos_id ? precoById.get(prod.produto_precos_id) : null;
          const precoMin = pp && pp.preco_minimo_afiliado != null ? Number(pp.preco_minimo_afiliado) : null;
          let cu: number;
          if (precoMin != null) {
            const valorUnit = it.valor_unitario != null ? Number(it.valor_unitario) : Number(it.valor_total || 0) / Math.max(1, qtd);
            cu = comissaoUnit(valorUnit, precoMin, cfg);
          } else {
            cu = prod && prod.comissao_afiliado != null ? Number(prod.comissao_afiliado) : 0; // fallback
          }
          soma += cu * qtd;
        }
        return soma;
      };

      let totalVendido = 0, comissaoLiberada = 0, comissaoPendente = 0;
      const pedidos = (peds || []).map((p: any) => {
        const comissao = comissaoDoPedido(p);
        const entregue = p.status === "entregue";
        totalVendido += Number(p.total || 0);
        if (entregue) comissaoLiberada += comissao; else comissaoPendente += comissao;
        return {
          numero: p.numero_smart ?? null,
          data: entregue ? (p.data_entrega_real || p.criado_em) : p.criado_em,
          cliente: (p.cliente_dados && p.cliente_dados.nome) || "—",
          valorTotal: Number(p.total || 0),
          status: p.status,
          comissao,
        };
      });

      const round2 = (n: number) => Math.round(n * 100) / 100;
      const totais = {
        totalVendido: round2(totalVendido),
        comissaoLiberada: round2(comissaoLiberada),
        comissaoPendente: round2(comissaoPendente),
        comissaoTotal: round2(comissaoLiberada + comissaoPendente),
      };

      return json({
        vitrine, pedidos, totais,
        gerais: { qtdImagens: gerais.imagens, qtdArquivos: gerais.arquivos },
        escala: { base: cfg.base, incremento: cfg.incremento, passo: cfg.passo, teto: cfg.teto },
      });
    }

    // ───────────────────────── MATERIAIS ─────────────────────────
    // Lista os materiais de um modelo (ou os gerais) com signed URL de 1h.
    // Gerado sob demanda pra não inflar o payload do `dados`.
    if (acao === "materiais") {
      const auth = req.headers.get("authorization") || "";
      const tok = await readToken(SECRET, auth.replace(/^Bearer\s+/i, "").trim());
      if (!tok) return json({ error: "Sessão inválida ou expirada." }, 401);

      const modelo = url.searchParams.get("modelo") || "";
      const geral = url.searchParams.get("geral") === "1";
      if (!modelo && !geral) return json({ error: "Informe o modelo." }, 400);

      let q = sb.from("afiliados_materiais")
        .select("id,tipo,titulo,arquivo_path,arquivo_nome,tamanho")
        .eq("ativo", true)
        .order("ordem").order("criado_em");
      q = geral ? q.is("produto_precos_id", null) : q.eq("produto_precos_id", modelo);
      const { data: rows, error } = await q.limit(100);
      if (error) return json({ error: "Falha ao listar materiais." }, 500);

      const materiais: Array<Record<string, unknown>> = [];
      for (const m of rows || []) {
        const { data: signed } = await sb.storage.from("afiliados-materiais")
          .createSignedUrl(m.arquivo_path, 60 * 60);
        if (!signed?.signedUrl) continue; // arquivo sumiu do bucket → não lista quebrado
        materiais.push({
          id: m.id,
          tipo: m.tipo,
          titulo: m.titulo || null,
          nome: m.arquivo_nome || null,
          tamanho: m.tamanho != null ? Number(m.tamanho) : null,
          url: signed.signedUrl,
        });
      }
      return json({ materiais });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
