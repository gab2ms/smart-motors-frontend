// crm-send — envio de mensagens do CRM, adaptador por canal.
// F1: WhatsApp Cloud API (texto, imagem, documento, template HSM).
// F2+: instagram/messenger entram aqui como novos ramos do adaptador.
//
// REGRAS NO SERVIDOR (revisão de engenharia — o front nunca é a última barreira):
//   - kill switch: crm_config.envio_ativo = false → recusa tudo.
//   - opt-out: contato.opt_in = false → recusa (LGPD/Meta).
//   - janela: fora de janela_expira_em → só template HSM aprovado (422 texto livre).
//   - fila durável: toda mensagem nasce em crm_saida; envio falhou → fica
//     'pendente' com proximo_retry (retry) até 3 tentativas → 'falhou'.
//   - nota interna NUNCA passa por aqui (é insert direto em crm_mensagens).
//
// Auth: verify_jwt=true. Atendente (JWT) ou worker de IA (service_role, header
// x-crm-remetente: ia).
//
// Secrets: CRM_WA_TOKEN, CRM_WA_PHONE_NUMBER_ID.

import { createClient } from "jsr:@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v21.0";
const MAX_TENTATIVAS = 3;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-crm-remetente",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

const sbAdmin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// ── adaptador WhatsApp ────────────────────────────────────────────────────
async function enviarWhatsApp(destino: string, payload: Record<string, any>, midiaUrl: string | null) {
  const token = Deno.env.get("CRM_WA_TOKEN");
  const phoneId = Deno.env.get("CRM_WA_PHONE_NUMBER_ID");
  if (!token || !phoneId) return { ok: false, erro: "CRM_WA_TOKEN/PHONE_NUMBER_ID não configurados" };

  let corpo: Record<string, any> = { messaging_product: "whatsapp", to: destino };
  if (payload.template) {
    corpo.type = "template";
    corpo.template = {
      name: payload.template.nome,
      language: { code: payload.template.idioma || "pt_BR" },
      components: payload.template.variaveis?.length
        ? [{ type: "body", parameters: payload.template.variaveis.map((v: string) => ({ type: "text", text: v })) }]
        : undefined,
    };
  } else if (payload.tipo === "imagem" && midiaUrl) {
    corpo.type = "image";
    corpo.image = { link: midiaUrl, caption: payload.texto || undefined };
  } else if (payload.tipo === "documento" && midiaUrl) {
    corpo.type = "document";
    corpo.document = { link: midiaUrl, caption: payload.texto || undefined, filename: payload.nome_arquivo || undefined };
  } else if (payload.tipo === "video" && midiaUrl) {
    corpo.type = "video";
    corpo.video = { link: midiaUrl, caption: payload.texto || undefined };
  } else {
    corpo.type = "text";
    corpo.text = { body: String(payload.texto || ""), preview_url: true };
  }

  const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const resp = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { ok: false, erro: resp?.error?.message || `HTTP ${r.status}`, codigo: resp?.error?.code };
  }
  return { ok: true, wa_message_id: resp?.messages?.[0]?.id as string | undefined };
}

// ── servidor ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, erro: "use POST" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const { conversa_id, tipo = "texto", texto, midia_path, template, nome_arquivo } = body;
    if (!conversa_id) return json({ ok: false, erro: "conversa_id é obrigatório" }, 400);
    if (!texto && !midia_path && !template) return json({ ok: false, erro: "mensagem vazia" }, 400);

    const sb = sbAdmin();

    // quem envia: atendente (JWT) ou IA (service_role + header)
    let remetente = "atendente";
    let remetenteId: string | null = null;
    const ehIA = req.headers.get("x-crm-remetente") === "ia";
    if (ehIA) {
      remetente = "ia";
    } else {
      const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: u } = await sbAdmin().auth.getUser(jwt);
      if (!u?.user) return json({ ok: false, erro: "não autenticado" }, 401);
      const { data: usuario } = await sb.from("usuarios").select("id").eq("auth_uid", u.user.id).maybeSingle();
      if (!usuario) return json({ ok: false, erro: "usuário sem cadastro" }, 403);
      remetenteId = usuario.id;
    }

    // config / kill switch
    const { data: cfg } = await sb.from("crm_config").select("envio_ativo").single();
    if (!cfg?.envio_ativo) return json({ ok: false, erro: "envio desativado (kill switch)" }, 423);

    // conversa + contato + canal
    const { data: conversa } = await sb.from("crm_conversas")
      .select("id, canal, janela_expira_em, contato:crm_contatos(id, canal_user_id, opt_in)")
      .eq("id", conversa_id).single();
    if (!conversa) return json({ ok: false, erro: "conversa não encontrada" }, 404);

    const contato = conversa.contato as unknown as { id: string; canal_user_id: string; opt_in: boolean };
    if (!contato?.opt_in) return json({ ok: false, erro: "contato optou por não receber mensagens (SAIR)" }, 422);

    if (conversa.canal !== "whatsapp") {
      return json({ ok: false, erro: `canal ${conversa.canal} ainda não suportado no envio` }, 422);
    }

    // janela 24h — VALIDAÇÃO NO SERVIDOR
    const dentroJanela = conversa.janela_expira_em && Date.parse(conversa.janela_expira_em) > Date.now();
    if (!dentroJanela && !template) {
      return json({
        ok: false, erro: "fora_da_janela",
        detalhe: "Janela de 24h fechada — só é possível enviar template aprovado.",
      }, 422);
    }
    if (template) {
      const { data: tpl } = await sb.from("crm_templates")
        .select("id,status").eq("canal", "whatsapp").eq("nome", template.nome).maybeSingle();
      if (!tpl || tpl.status !== "aprovado") {
        return json({ ok: false, erro: "template não aprovado/cadastrado" }, 422);
      }
    }

    // mídia: signed URL (bucket privado) pro link da Meta
    let midiaUrl: string | null = null;
    if (midia_path) {
      const { data: signed } = await sb.storage.from("crm-midia").createSignedUrl(midia_path, 3600);
      midiaUrl = signed?.signedUrl || null;
      if (!midiaUrl) return json({ ok: false, erro: "mídia não encontrada no Storage" }, 404);
    }

    const agora = new Date().toISOString();
    const payload = { tipo, texto, midia_path, template, nome_arquivo };

    // registra mensagem + fila de saída (durável) ANTES de tentar enviar
    const { data: msg, error: msgErr } = await sb.from("crm_mensagens").insert({
      conversa_id, canal: "whatsapp", direcao: "saida",
      remetente, remetente_id: remetenteId, tipo: template ? "template" : tipo,
      texto: texto || template?.corpo || null, midia_path: midia_path || null,
      status_entrega: "pendente", timestamp_canal: agora,
    }).select("id").single();
    if (msgErr || !msg) return json({ ok: false, erro: "falha ao registrar mensagem" }, 500);

    const { data: fila } = await sb.from("crm_saida").insert({
      conversa_id, mensagem_id: msg.id, canal: "whatsapp",
      destino: contato.canal_user_id, payload, estado: "enviando",
      tentativas: 1, criado_por: remetenteId,
    }).select("id").single();

    // tenta enviar agora
    const r = await enviarWhatsApp(contato.canal_user_id, payload, midiaUrl);

    if (r.ok) {
      await sb.from("crm_mensagens").update({
        canal_message_id: r.wa_message_id || null, status_entrega: "enviado",
      }).eq("id", msg.id);
      if (fila) await sb.from("crm_saida").update({ estado: "enviado", atualizado_em: agora }).eq("id", fila.id);
      // primeira resposta (métrica de tempo de espera) — só grava a 1ª vez
      await sb.from("crm_conversas").update({ primeira_resposta_em: agora })
        .eq("id", conversa_id).is("primeira_resposta_em", null);
      // resposta do atendente zera SLA e não-lidas
      await sb.from("crm_conversas").update({
        sla_prazo_em: null, nao_lidas: 0,
        ultima_msg_em: agora, ultima_msg_preview: (texto || `[${tipo}]`).slice(0, 120),
        atualizado_em: agora,
      }).eq("id", conversa_id);
      return json({ ok: true, mensagem_id: msg.id, wa_message_id: r.wa_message_id });
    }

    // falhou: mantém na fila com retry (cron F2) ou marca falha definitiva
    const definitivo = 1 >= MAX_TENTATIVAS;
    await sb.from("crm_mensagens").update({ status_entrega: definitivo ? "falhou" : "pendente", erro: r.erro }).eq("id", msg.id);
    if (fila) {
      await sb.from("crm_saida").update({
        estado: definitivo ? "falhou" : "pendente", erro: r.erro,
        proximo_retry: new Date(Date.now() + 60_000).toISOString(), atualizado_em: agora,
      }).eq("id", fila.id);
    }
    return json({ ok: false, erro: r.erro, mensagem_id: msg.id, retry: !definitivo }, 502);
  } catch (e) {
    return json({ ok: false, erro: String((e as Error)?.message || e) }, 500);
  }
});
