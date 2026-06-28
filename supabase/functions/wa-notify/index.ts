// wa-notify — envia WhatsApp via CallMeBot/textmebot a partir do servidor,
// para que a API key não fique exposta no front (GitHub Pages público).
//
// Resolução da api_key (nesta ordem):
//   1) apiKey vinda no body (fluxo de "teste" com key digitada, ainda não salva);
//   2) busca na tabela whatsapp_destinatarios pelo número (service_role);
//   3) fallback opcional: secret WA_APIKEY, se o número == secret WA_NUMBER.
//
// DEDUP NO SERVIDOR: a mesma mensagem pro mesmo número no mesmo dia é enviada
// só uma vez (tabela wa_dedup). Evita repeticao quando varios navegadores
// disparam o mesmo aviso de evento (o dedup do front e por navegador).
//
// Auth: verify_jwt=true. Healthcheck: mensagem "__ping__" (não envia, não dedup).

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const sbAdmin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, erro: "use POST" }, 405);

  try {
    const { numero, mensagem, apiKey } = await req.json().catch(() => ({}));
    if (!numero || !mensagem) {
      return json({ ok: false, erro: "numero e mensagem são obrigatórios" }, 400);
    }

    const numeroLimpo = String(numero).replace(/\D/g, "");

    // Healthcheck sem envio real.
    if (mensagem === "__ping__") return json({ ok: true, ping: true, numero: numeroLimpo });

    const sb = sbAdmin();

    // DEDUP: mesma (numero + dia + mensagem) só envia uma vez. Quem inserir a
    // chave primeiro envia; chamadas seguintes batem em conflito (23505) e param.
    const dia = new Date().toISOString().slice(0, 10);
    const chave = (numeroLimpo + "|" + dia + "|" + mensagem).slice(0, 1024);
    const { error: dedupErr } = await sb.from("wa_dedup").insert({ chave });
    if (dedupErr) {
      // ja enviado hoje (ou erro ao gravar) -> nao reenvia
      return json({ ok: true, dedup: true });
    }

    // Resolve a api_key.
    let key = (apiKey || "").toString().trim();
    if (!key) {
      const { data } = await sb
        .from("whatsapp_destinatarios")
        .select("api_key")
        .eq("numero", numeroLimpo)
        .limit(1)
        .maybeSingle();
      if (data?.api_key) key = String(data.api_key).trim();
    }
    if (!key) {
      const lojaNum = (Deno.env.get("WA_NUMBER") || "").replace(/\D/g, "");
      if (lojaNum && numeroLimpo === lojaNum) key = (Deno.env.get("WA_APIKEY") || "").trim();
    }
    if (!key) return json({ ok: false, erro: "sem api_key para esse número" }, 422);

    const url = `https://api.textmebot.com/send.php?recipient=+${encodeURIComponent(numeroLimpo)}` +
      `&text=${encodeURIComponent(mensagem)}&apikey=${encodeURIComponent(key)}`;

    const r = await fetch(url, { method: "GET" });
    const body = await r.text();
    const limpo = body
      .replace(/apikey=[^&"'\s<>]+/gi, "apikey=***")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const ok = r.ok && !/error|invalid|not found|disconnected/i.test(limpo);
    // Se o envio falhou, libera a chave pra permitir nova tentativa depois.
    if (!ok) { try { await sb.from("wa_dedup").delete().eq("chave", chave); } catch (_) { /* ignore */ } }
    return json({ ok, status: r.status, resposta: limpo.slice(0, 300) });
  } catch (e) {
    return json({ ok: false, erro: String((e as Error)?.message || e) }, 500);
  }
});
