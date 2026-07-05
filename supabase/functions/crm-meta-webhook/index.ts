// crm-meta-webhook — webhook ÚNICO da Meta para o CRM omnichannel.
// Recebe WhatsApp Cloud API (F1), Instagram Direct e Messenger (F2) no mesmo
// endpoint, ramificando pelo campo `object` do payload.
//
// Segurança:
//   - GET  = verificação da Meta (hub.challenge) com CRM_WA_VERIFY_TOKEN.
//   - POST = valida X-Hub-Signature-256 (HMAC-SHA256 do corpo cru com CRM_META_APP_SECRET).
//   - verify_jwt = false (a Meta chama sem JWT); a assinatura HMAC é a autenticação.
//
// Regras (revisão de engenharia):
//   - Responde 200 IMEDIATAMENTE e processa em background (EdgeRuntime.waitUntil)
//     — a Meta reenvia o webhook inteiro se demorar.
//   - Idempotência por unique(canal, canal_message_id) — reentrega não duplica.
//   - Status callbacks nunca regridem (lido > entregue > enviado > pendente).
//   - Opt-out (SAIR/STOP/PARE) marca contato e bloqueia envios proativos.
//   - Lead ≠ cliente: só VINCULA a clientes existente (por telefone); nunca cria.
//
// Secrets (Edge Function secrets):
//   CRM_META_APP_SECRET  — App Secret do app Meta (valida assinatura)
//   CRM_WA_VERIFY_TOKEN  — token arbitrário usado no cadastro do webhook
//   CRM_WA_TOKEN         — token de System User (baixar mídia)

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v21.0";

const sbAdmin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// ── util ──────────────────────────────────────────────────────────────────
const RANK: Record<string, number> = { pendente: 0, enviado: 1, entregue: 2, lido: 3 };
const OPTOUT_RE = /^\s*(sair|stop|pare|parar|cancelar|descadastrar)\s*[.!]?\s*$/i;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function assinaturaValida(corpo: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get("CRM_META_APP_SECRET") || "";
  if (!secret || !header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC", key, hexToBytes(header.slice(7)), new TextEncoder().encode(corpo),
  );
}

// tipo de mensagem WhatsApp → nosso enum
function tipoMsg(m: Record<string, unknown>): string {
  const t = String(m.type || "texto");
  const mapa: Record<string, string> = {
    text: "texto", image: "imagem", video: "video", audio: "audio",
    document: "documento", sticker: "sticker", location: "localizacao",
    contacts: "contato", template: "template",
  };
  return mapa[t] || "outro";
}

function textoMsg(m: Record<string, any>): string | null {
  if (m.text?.body) return m.text.body;
  if (m.button?.text) return m.button.text;
  if (m.interactive?.button_reply?.title) return m.interactive.button_reply.title;
  if (m.interactive?.list_reply?.title) return m.interactive.list_reply.title;
  const midia = m.image || m.video || m.audio || m.document || m.sticker;
  if (midia?.caption) return midia.caption;
  if (m.location) return `📍 ${m.location.latitude},${m.location.longitude}`;
  return null;
}

// Baixa mídia da Meta e sobe no bucket crm-midia. Best-effort (não bloqueia a msg).
async function baixarMidia(sb: SupabaseClient, conversaId: string, msg: Record<string, any>) {
  try {
    const token = Deno.env.get("CRM_WA_TOKEN");
    if (!token) return null;
    const media = msg.image || msg.video || msg.audio || msg.document || msg.sticker;
    if (!media?.id) return null;

    const meta = await fetch(`${GRAPH}/${media.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    if (!meta?.url) return null;

    const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!bin.ok) return null;
    const mime = meta.mime_type || bin.headers.get("content-type") || "application/octet-stream";
    const ext = (mime.split("/")[1] || "bin").split(";")[0];
    const path = `conversas/${conversaId}/${media.id}.${ext}`;

    const { error } = await sb.storage.from("crm-midia")
      .upload(path, new Uint8Array(await bin.arrayBuffer()), { contentType: mime, upsert: true });
    if (error) return null;
    return { path, mime };
  } catch (_) {
    return null;
  }
}

// ── processamento WhatsApp ────────────────────────────────────────────────
async function processarWhatsApp(sb: SupabaseClient, value: Record<string, any>) {
  const contatos: Record<string, any>[] = value.contacts || [];
  const mensagens: Record<string, any>[] = value.messages || [];
  const statuses: Record<string, any>[] = value.statuses || [];

  // 1) Status callbacks (sent/delivered/read/failed) — nunca regridem
  for (const st of statuses) {
    const mapa: Record<string, string> = {
      sent: "enviado", delivered: "entregue", read: "lido", failed: "falhou",
    };
    const novo = mapa[st.status];
    if (!novo || !st.id) continue;

    const { data: msg } = await sb.from("crm_mensagens")
      .select("id,status_entrega").eq("canal", "whatsapp").eq("canal_message_id", st.id)
      .maybeSingle();
    if (!msg) continue;

    const regride = novo !== "falhou" &&
      (RANK[msg.status_entrega ?? "pendente"] ?? 0) >= (RANK[novo] ?? 0);
    if (regride) continue;

    const erro = st.errors?.[0]
      ? `${st.errors[0].code}: ${st.errors[0].title || st.errors[0].message || ""}` : null;
    await sb.from("crm_mensagens").update({ status_entrega: novo, erro }).eq("id", msg.id);
    if (novo === "falhou") {
      await sb.from("crm_saida").update({ estado: "falhou", erro, atualizado_em: new Date().toISOString() })
        .eq("mensagem_id", msg.id);
    }
  }

  // 2) Mensagens recebidas
  for (const m of mensagens) {
    const waId = String(m.from || "");
    if (!waId || !m.id) continue;
    const perfil = contatos.find((c) => c.wa_id === waId)?.profile;
    const ts = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();

    // upsert contato (vincula a clientes existente por telefone; nunca cria cliente)
    let { data: contato } = await sb.from("crm_contatos")
      .select("id,cliente_id,opt_in").eq("canal", "whatsapp").eq("canal_user_id", waId).maybeSingle();
    if (!contato) {
      const { data: clienteId } = await sb.rpc("crm_casar_cliente_por_telefone", { p_tel: waId });
      const ins = await sb.from("crm_contatos").insert({
        canal: "whatsapp", canal_user_id: waId, telefone: `+${waId}`,
        display_name: perfil?.name || null, cliente_id: clienteId || null,
      }).select("id,cliente_id,opt_in").single();
      contato = ins.data;
      if (!contato) continue; // corrida: outro worker criou — reprocura
    } else if (perfil?.name) {
      await sb.from("crm_contatos").update({
        display_name: perfil.name, atualizado_em: new Date().toISOString(),
      }).eq("id", contato.id);
    }

    // conversa aberta do contato (ou cria)
    let { data: conversa } = await sb.from("crm_conversas")
      .select("id,status,atendente_id").eq("contato_id", contato.id)
      .neq("status", "finalizada").order("criado_em", { ascending: false })
      .limit(1).maybeSingle();

    const { data: canalCfg } = await sb.from("crm_canais")
      .select("janela_seg").eq("canal", "whatsapp").single();
    const janelaExpira = canalCfg?.janela_seg
      ? new Date(Date.parse(ts) + canalCfg.janela_seg * 1000).toISOString() : null;

    if (!conversa) {
      const ins = await sb.from("crm_conversas").insert({
        contato_id: contato.id, canal: "whatsapp", status: "aguardando",
        aguardando_desde: ts, janela_expira_em: janelaExpira, ultima_msg_em: ts,
      }).select("id,status,atendente_id").single();
      conversa = ins.data;
      if (!conversa) continue;
    }

    const texto = textoMsg(m);
    const tipo = tipoMsg(m);

    // mídia (best-effort, não bloqueia)
    const midia = await baixarMidia(sb, conversa.id, m);

    // insere mensagem — idempotente (unique canal+canal_message_id)
    const { error: msgErr } = await sb.from("crm_mensagens").insert({
      conversa_id: conversa.id, canal: "whatsapp", canal_message_id: m.id,
      direcao: "entrada", remetente: "cliente", tipo, texto,
      midia_path: midia?.path || null, midia_mime: midia?.mime || null,
      timestamp_canal: ts, raw: m,
    });
    if (msgErr) {
      if (!String(msgErr.code) .includes("23505")) console.error("crm_mensagens insert:", msgErr.message);
      continue; // duplicada (reentrega da Meta) — não atualiza contadores de novo
    }

    // opt-out (STOP/SAIR)
    if (texto && OPTOUT_RE.test(texto)) {
      await sb.from("crm_contatos").update({
        opt_in: false, opt_out_em: new Date().toISOString(),
      }).eq("id", contato.id);
      await sb.from("crm_eventos").insert({
        conversa_id: conversa.id, tipo: "opt_out", autor_nome: "cliente",
        detalhe: { texto },
      });
    }

    // atualiza conversa (janela reabre a cada msg do CLIENTE)
    await sb.rpc("crm_msg_recebida", {
      p_conversa_id: conversa.id, p_ts: ts,
      p_preview: (texto || `[${tipo}]`).slice(0, 120),
      p_janela_expira: janelaExpira,
    });

    // roteia se ninguém é dono ainda
    if (!conversa.atendente_id) {
      await sb.rpc("crm_atribuir_conversa", { p_conversa_id: conversa.id });
    }
  }
}

// ── Instagram / Messenger (F2): por ora só registra o evento cru ─────────
async function processarMensageria(sb: SupabaseClient, objeto: string, body: Record<string, any>) {
  await sb.from("crm_eventos").insert({
    tipo: "webhook_" + objeto, autor_nome: "meta",
    detalhe: { object: objeto, entries: (body.entry || []).length },
  });
}

// ── servidor ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Verificação da Meta (cadastro do webhook)
  if (req.method === "GET") {
    const modo = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (modo === "subscribe" && token === Deno.env.get("CRM_WA_VERIFY_TOKEN")) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const corpo = await req.text();
  if (!(await assinaturaValida(corpo, req.headers.get("x-hub-signature-256")))) {
    return new Response("invalid signature", { status: 401 });
  }

  let body: Record<string, any>;
  try { body = JSON.parse(corpo); } catch { return new Response("bad json", { status: 400 }); }

  // 200 imediato; processamento em background (Meta reenvia se demorar)
  const tarefa = (async () => {
    try {
      const sb = sbAdmin();
      if (body.object === "whatsapp_business_account") {
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            if (change.field === "messages") await processarWhatsApp(sb, change.value || {});
          }
        }
      } else if (body.object === "instagram" || body.object === "page") {
        await processarMensageria(sb, body.object, body);
      }
    } catch (e) {
      console.error("crm-meta-webhook:", (e as Error)?.message || e);
    }
  })();

  // @ts-ignore EdgeRuntime existe no ambiente Supabase
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(tarefa);
  else await tarefa;

  return new Response("ok", { status: 200 });
});
