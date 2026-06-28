import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Edge Function: portal do afiliado. ÚNICA peça que toca o banco em nome do portal.
// A página portal.html (GitHub Pages) NÃO carrega chave Supabase — só chama esta
// função, que roda com service_role e devolve apenas dados sanitizados (allowlist).
// Nada de custo, fornecedor, quantidade de estoque, outros afiliados ou outras tabelas.
//
// Endpoints (via ?acao=):
//   login  — body { identificador, telefone } → { token, afiliado:{id,nome} }
//   dados  — header Authorization: Bearer <token> → { vitrine[], pedidos[], totais }
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
//    faixas=0 → comissão = base. ──
function comissaoUnit(valorUnit: number, precoMin: number, cfg: { base: number; incremento: number; passo: number }): number {
  const faixas = Math.max(0, Math.floor(((valorUnit || 0) - (precoMin || 0)) / (cfg.passo || 100)));
  return cfg.base + cfg.incremento * faixas;
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

      const { data, error } = await sb.from("afiliados").select("id,nome,telefone").eq("ativo", true);
      if (error) return json({ error: "Falha ao validar." }, 500);
      const match = (data || []).filter((a) => norm(a.nome) === idNome && digits(a.telefone) === tel);
      // Erro genérico (não revela se nome existe). Ambíguo (2+) também recusa.
      if (match.length !== 1) return json({ error: "Nome ou telefone não confere." }, 401);

      const afil = match[0];
      const token = await makeToken(SECRET, afil.id);
      return json({ token, afiliado: { id: afil.id, nome: afil.nome } });
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
        .in("chave", ["afiliado_comissao_base", "afiliado_comissao_incremento", "afiliado_comissao_passo"]);
      const ccMap = new Map((ccRows || []).map((r) => [r.chave, Number(r.valor)]));
      const cfg = {
        base: ccMap.get("afiliado_comissao_base") || 100,
        incremento: ccMap.get("afiliado_comissao_incremento") || 50,
        passo: ccMap.get("afiliado_comissao_passo") || 100,
      };

      // produtos_precos: modelo + preço mínimo (id é a FK alvo de produtos.produto_precos_id).
      const { data: precos } = await sb.from("produtos_precos").select("id,modelo,preco_minimo_afiliado");
      const precoById = new Map((precos || []).map((p) => [p.id, p]));

      // produtos: estoque/categoria por variante, ligados ao modelo pela FK.
      const { data: prods } = await sb.from("produtos")
        .select("id,categoria,estoque,ativo,produto_precos_id,comissao_afiliado");
      const prodById = new Map((prods || []).map((p) => [p.id, p]));

      // ── Vitrine: agrega scooters por modelo (FK exata). Sem quantidade/custo. ──
      const vitMap = new Map<string, { modelo: string; disponivel: boolean; precoMinimo: number | null }>();
      for (const p of prods || []) {
        if (p.ativo === false) continue;
        if (!isScooter(p.categoria)) continue;
        if (!p.produto_precos_id) continue;
        const pp = precoById.get(p.produto_precos_id);
        if (!pp) continue;
        const key = String(p.produto_precos_id);
        const cur = vitMap.get(key) || {
          modelo: pp.modelo || "Modelo",
          disponivel: false,
          precoMinimo: pp.preco_minimo_afiliado != null ? Number(pp.preco_minimo_afiliado) : null,
        };
        if (Number(p.estoque) > 0) cur.disponivel = true;
        vitMap.set(key, cur);
      }
      const comissaoBaseTexto = `Base R$ ${cfg.base} + R$ ${cfg.incremento} a cada R$ ${cfg.passo} acima do mínimo`;
      const vitrine = [...vitMap.values()]
        .sort((a, b) => a.modelo.localeCompare(b.modelo))
        .map((v) => ({ ...v, comissaoBaseTexto }));

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

      return json({ vitrine, pedidos, totais });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
