import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Edge Function: gera um resumo curto (problema + situação) de uma OS / caso de
// pós-venda usando a API da Claude (Haiku). Chamada pelo app via
// sb.functions.invoke('gerar-resumo-os', { body: <linha da OS> }).
// Secret necessário: ANTHROPIC_API_KEY (Settings -> Edge Functions).

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STATUS_LBL: Record<string, string> = {
  acao_interna: "ação interna (estamos resolvendo internamente)",
  aguardando_terceiro: "aguardando terceiro/fornecedor",
  pronto_entrega: "pronto para entrega",
  finalizado: "finalizado",
  transferido: "transferido",
};
const LOC_LBL: Record<string, string> = {
  com_cliente: "com o cliente",
  na_loja: "na loja em manutenção",
  enviada_fornecedor: "enviada ao fornecedor",
  voltou_fornecedor: "voltou do fornecedor",
  entregue_cliente: "entregue ao cliente",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY não configurada nos secrets da função" }, 500);

    const os = await req.json().catch(() => ({}));
    const dados = {
      tipo_problema: os.tipoProblema ?? os.tipo_problema ?? null,
      tipo_problema_outro: os.tipoProblemaOutro ?? os.tipo_problema_outro ?? null,
      problema_relatado: os.problemaRelatado ?? os.problema_relatado ?? os.problema ?? null,
      diagnostico: os.diagnostico ?? null,
      solucao: os.solucao ?? null,
      status: STATUS_LBL[os.status] ?? os.status ?? null,
      localizacao: LOC_LBL[os.localizacao] ?? os.localizacao ?? null,
      prioridade: os.prioridade ?? null,
      modelo: os.modeloScooter ?? os.modelo_scooter ?? os.modelo ?? null,
      pecas: os.pecas ?? null,
    };

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 120,
        system:
          "Você resume ordens de serviço de uma loja de scooters elétricas. Responda com UMA única frase curta em português (máximo ~90 caracteres), telegráfica, dizendo o PROBLEMA e a SITUAÇÃO atual do serviço. Situações típicas: aguardando peça do fornecedor, conserto interno pendente, aguardando retorno do cliente, pronto para entrega, finalizado. Use os campos status e localizacao para inferir a situação. NÃO invente informações ausentes. Não use aspas nem ponto final.",
        messages: [
          { role: "user", content: "Dados da ordem de serviço (JSON):\n" + JSON.stringify(dados, null, 2) },
        ],
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return json({ error: "Anthropic " + r.status, detail: t.slice(0, 500) }, 502);
    }
    const data = await r.json();
    const resumo = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join(" ")
      .trim();
    return json({ resumo });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
