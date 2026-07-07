// admin-usuarios — gestao de usuarios no Supabase Auth (service_role). Frente 2.
// verify_jwt=false: a propria funcao valida — admin logado (JWT) para as acoes
// do dia a dia, e um token de setup (tabela _admin_setup) so para o seed inicial.
// NAO vira a chave do login sozinha: o front so passa a usar Auth no cutover.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function senhaProvisoria(n = 12) {
  const alf = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const b = new Uint32Array(n);
  crypto.getRandomValues(b);
  let o = "";
  for (let i = 0; i < n; i++) o += alf[b[i] % alf.length];
  return o;
}

const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function requireAdmin(req: Request, sb: ReturnType<typeof admin>) {
  const h = req.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: u } = await sb.from("usuarios").select("role,perfil").eq("auth_uid", data.user.id).maybeSingle();
  if (!u) return null;
  return (u.role === "admin" || u.perfil === "admin") ? data.user : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, erro: "use POST" }, 405);
  const sb = admin();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const acao = body.acao;

  try {
    // SEED INICIAL — cria os auth.users a partir da tabela usuarios. So roda
    // se o Auth estiver vazio E com o token correto em _admin_setup.
    if (acao === "seed") {
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (list?.users?.length) return json({ ok: false, erro: "Auth ja inicializado (seed bloqueado)" }, 409);
      const { data: ctrl } = await sb.from("_admin_setup").select("token,used_at").eq("id", 1).maybeSingle();
      if (!ctrl?.token || ctrl.used_at || body.token !== ctrl.token) {
        return json({ ok: false, erro: "token de setup invalido" }, 403);
      }
      const { data: usuarios } = await sb.from("usuarios").select("id,nome,email").not("email", "is", null);
      const out: unknown[] = [];
      for (const u of (usuarios || [])) {
        if (!u.email) continue;
        const senha = senhaProvisoria();
        const { data: created, error } = await sb.auth.admin.createUser({
          email: u.email, password: senha, email_confirm: true,
          user_metadata: { nome: u.nome, must_change: true },
        });
        if (error || !created?.user) { out.push({ email: u.email, erro: error?.message || "falha" }); continue; }
        await sb.from("usuarios").update({ auth_uid: created.user.id }).eq("id", u.id);
        out.push({ nome: u.nome, email: u.email, senha });
      }
      await sb.from("_admin_setup").update({ used_at: new Date().toISOString() }).eq("id", 1);
      return json({ ok: true, criados: out });
    }

    // Demais acoes exigem um admin logado (JWT do Supabase Auth).
    const adminUser = await requireAdmin(req, sb);
    if (!adminUser) return json({ ok: false, erro: "nao autorizado" }, 401);

    if (acao === "reset") {
      const email = String(body.email || "").toLowerCase();
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const alvo = (list?.users || []).find((x) => (x.email || "").toLowerCase() === email);
      if (!alvo) return json({ ok: false, erro: "usuario nao encontrado" }, 404);
      // Senha custom (o admin digitou uma) OU provisoria aleatoria.
      // Custom -> vale direto (must_change=false, a nao ser que peca true).
      // Provisoria -> forca a troca no proximo acesso (fluxo de 1o acesso).
      const custom = typeof body.senha === "string" && body.senha.length >= 6 ? body.senha : null;
      const senha = custom || senhaProvisoria();
      const mustChange = custom ? body.must_change === true : true;
      const { error } = await sb.auth.admin.updateUserById(alvo.id, {
        password: senha,
        user_metadata: { ...(alvo.user_metadata || {}), must_change: mustChange },
      });
      if (error) return json({ ok: false, erro: error.message }, 400);
      return json({ ok: true, email, senha, provisoria: !custom });
    }

    if (acao === "criar") {
      const email = String(body.email || "").toLowerCase();
      const nome = String(body.nome || email);
      if (!email) return json({ ok: false, erro: "email obrigatorio" }, 400);
      // Senha custom (o admin digitou uma no modal) OU provisoria aleatoria.
      // Custom -> vale direto (must_change=false). Provisoria -> forca a troca
      // no 1o acesso. Mesma logica da acao 'reset'.
      const custom = typeof body.senha === "string" && body.senha.length >= 6 ? body.senha : null;
      const senha = custom || senhaProvisoria();
      const mustChange = custom ? body.must_change === true : true;
      const { data: created, error } = await sb.auth.admin.createUser({
        email, password: senha, email_confirm: true, user_metadata: { nome, must_change: mustChange },
      });
      if (error || !created?.user) return json({ ok: false, erro: error?.message || "falha" }, 400);
      // modulos_permitidos: coluna TEXT com JSON (perfil customizado). Front manda array.
      const modulos = Array.isArray(body.modulos_permitidos) ? JSON.stringify(body.modulos_permitidos) : null;
      const { error: insErr } = await sb.from("usuarios").insert({
        nome, email, senha: "auth", role: body.role || "usuario", perfil: body.perfil || null,
        modulos_permitidos: modulos,
        status: "aprovado", auth_uid: created.user.id, criado_em: new Date().toISOString(),
      });
      if (insErr) {
        // Rollback: sem a linha em usuarios, o auth.users viraria orfao (e travaria
        // recriar com o mesmo email). Desfaz o createUser.
        await sb.auth.admin.deleteUser(created.user.id);
        return json({ ok: false, erro: insErr.message }, 400);
      }
      return json({ ok: true, email, senha, provisoria: !custom });
    }

    if (acao === "aprovar" || acao === "bloquear") {
      const email = String(body.email || "").toLowerCase();
      const status = acao === "aprovar" ? "aprovado" : "rejeitado";
      const { error } = await sb.from("usuarios").update({ status }).eq("email", email);
      if (error) return json({ ok: false, erro: error.message }, 400);
      return json({ ok: true, email, status });
    }

    if (acao === "listar") {
      const { data: usuarios } = await sb.from("usuarios").select("nome,email,role,perfil,status,auth_uid");
      return json({ ok: true, usuarios });
    }

    return json({ ok: false, erro: "acao desconhecida" }, 400);
  } catch (e) {
    return json({ ok: false, erro: String((e as Error)?.message || e) }, 500);
  }
});
