// crm-meta-webhook — webhook ÚNICO da Meta para o CRM omnichannel.
// Recebe WhatsApp Cloud API (F1), Instagram Direct e Messenger (F2) no mesmo
// endpoint, ramificando pelo campo `object` do payload.
//
// Segurança (depende do provider — CRM_WA_PROVIDER = "meta" | "360dialog"):
//   - meta:      GET verifica hub.challenge (CRM_WA_VERIFY_TOKEN); POST valida
//                X-Hub-Signature-256 (HMAC-SHA256 do corpo cru com CRM_META_APP_SECRET).
//   - 360dialog: POST valida HTTP Basic Auth (CRM_D360_WEBHOOK_USER/PASS, definido no
//                registro do webhook no 360dialog). O 360dialog NÃO manda o HMAC da Meta.
//   - verify_jwt = false (o provedor chama sem JWT); a autenticação é a assinatura/Basic.
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
//   [meta]      CRM_META_APP_SECRET — App Secret do app Meta (valida a assinatura HMAC)
//   [meta]      CRM_WA_VERIFY_TOKEN — token arbitrário do cadastro do webhook (GET challenge)
//   [meta]      CRM_WA_TOKEN        — token de System User (baixar mídia)
//   [360dialog] CRM_D360_API_KEY    — API key do canal (baixar mídia)
//   [360dialog] CRM_D360_WEBHOOK_USER / CRM_D360_WEBHOOK_PASS — Basic Auth do webhook

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v21.0";
const D360 = "https://waba-v2.360dialog.io"; // BSP 360dialog (coexistência)
const PROVIDER = (Deno.env.get("CRM_WA_PROVIDER") || "meta").toLowerCase(); // "meta" | "360dialog"

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

// autenticação do webhook conforme o provider (HMAC da Meta ou Basic Auth do 360dialog)
async function webhookAutenticado(req: Request, corpo: string): Promise<boolean> {
  if (PROVIDER === "360dialog") {
    const user = Deno.env.get("CRM_D360_WEBHOOK_USER") || "";
    const pass = Deno.env.get("CRM_D360_WEBHOOK_PASS") || "";
    if (!user || !pass) return false;
    const esperado = "Basic " + btoa(`${user}:${pass}`);
    const recebido = req.headers.get("authorization") || "";
    return recebido.length === esperado.length && recebido === esperado;
  }
  return assinaturaValida(corpo, req.headers.get("x-hub-signature-256"));
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

// Baixa mídia recebida e sobe no bucket crm-midia. Best-effort (não bloqueia a msg).
// meta:      GET graph/{id} (Bearer) → url lookaside (Bearer) → binário.
// 360dialog: GET waba-v2/{id} (D360-API-KEY) → url attachments (D360-API-KEY) → binário.
async function baixarMidia(sb: SupabaseClient, conversaId: string, msg: Record<string, any>) {
  try {
    const media = msg.image || msg.video || msg.audio || msg.document || msg.sticker;
    if (!media?.id) return null;

    let base: string, headers: Record<string, string>;
    if (PROVIDER === "360dialog") {
      const key = Deno.env.get("CRM_D360_API_KEY");
      if (!key) return null;
      base = D360; headers = { "D360-API-KEY": key };
    } else {
      const token = Deno.env.get("CRM_WA_TOKEN");
      if (!token) return null;
      base = GRAPH; headers = { Authorization: `Bearer ${token}` };
    }

    const meta = await fetch(`${base}/${media.id}`, { headers }).then((r) => r.json()).catch(() => null);
    if (!meta?.url) return null;

    const bin = await fetch(meta.url, { headers });
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

// acha (ou cria) contato + conversa aberta do CLIENTE por wa_id; retorna a janela calculada.
// Reusado pela mensagem recebida e pelo echo de coexistência.
async function acharOuCriarConversaCliente(
  sb: SupabaseClient, waId: string, perfilNome: string | null, ts: string,
) {
  let { data: contato } = await sb.from("crm_contatos")
    .select("id,cliente_id,opt_in").eq("canal", "whatsapp").eq("canal_user_id", waId).maybeSingle();
  if (!contato) {
    const { data: clienteId } = await sb.rpc("crm_casar_cliente_por_telefone", { p_tel: waId });
    const ins = await sb.from("crm_contatos").insert({
      canal: "whatsapp", canal_user_id: waId, telefone: `+${waId}`,
      display_name: perfilNome || null, cliente_id: clienteId || null,
    }).select("id,cliente_id,opt_in").single();
    contato = ins.data;
    if (!contato) return null; // corrida: outro worker criou
  } else if (perfilNome) {
    await sb.from("crm_contatos").update({
      display_name: perfilNome, atualizado_em: new Date().toISOString(),
    }).eq("id", contato.id);
  }

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
    if (!conversa) return null;
  }
  return { contato, conversa, janelaExpira };
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

    const cc = await acharOuCriarConversaCliente(sb, waId, perfil?.name || null, ts);
    if (!cc) continue;
    const { contato, conversa, janelaExpira } = cc;

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

  // 3) Echoes de COEXISTÊNCIA (360dialog): mensagens que a LOJA respondeu pelo APP do
  //    celular. Chegam em value.message_echoes[] (from = número da loja, to = cliente).
  //    Registramos como SAÍDA pra thread do CRM ficar sincronizada com o que foi dito no app.
  const echoes: Record<string, any>[] = value.message_echoes || [];
  for (const m of echoes) {
    const waId = String(m.to || ""); // a conversa é a do cliente destinatário
    if (!waId || !m.id) continue;
    const ts = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();

    const cc = await acharOuCriarConversaCliente(sb, waId, null, ts);
    if (!cc) continue;
    const { conversa } = cc;

    const texto = textoMsg(m);
    const tipo = tipoMsg(m);
    const midia = await baixarMidia(sb, conversa.id, m);

    // remetente "atendente" (a loja respondeu) — valor que o app do CRM já renderiza como saída.
    // A origem (app do celular) fica no raw; distinguir visualmente é refinamento pós-validação.
    const { error: msgErr } = await sb.from("crm_mensagens").insert({
      conversa_id: conversa.id, canal: "whatsapp", canal_message_id: m.id,
      direcao: "saida", remetente: "atendente", tipo, texto,
      midia_path: midia?.path || null, midia_mime: midia?.mime || null,
      status_entrega: "enviado", timestamp_canal: ts, raw: m,
    });
    if (msgErr) continue; // idempotente: echo/reentrega duplicado (unique canal+canal_message_id)

    // a loja respondeu (pelo app) → zera SLA/não-lidas e atualiza o preview, como resposta normal
    await sb.from("crm_conversas").update({
      sla_prazo_em: null, nao_lidas: 0,
      ultima_msg_em: ts, ultima_msg_preview: (texto || `[${tipo}]`).slice(0, 120),
      atualizado_em: ts,
    }).eq("id", conversa.id);
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
  if (!(await webhookAutenticado(req, corpo))) {
    return new Response("unauthorized", { status: 401 });
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
            const v = change.value || {};
            // "messages" (padrão Meta/360dialog) + fields de coexistência: roteia por
            // conteúdo do value (echoes vêm em field diferente, ex. smb_message_echoes).
            if (change.field === "messages" || v.messages || v.statuses || v.message_echoes) {
              await processarWhatsApp(sb, v);
            }
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
