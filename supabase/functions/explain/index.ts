const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { sentence, expression, translation } = await request.json();
    if (!sentence || !expression) throw new Error("英文と説明する語句が必要です");
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("AI解説がまだ設定されていません");
    await reserveAiUsage(request);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-6-luna",
        max_output_tokens: 500,
        input: [
          { role: "developer", content: "英語初学者向けに、指定された表現の文中での意味とニュアンスを日本語で簡潔に説明してください。回答は200文字以内にしてください。" },
          { role: "user", content: `英文: ${sentence}\n訳: ${translation || "未入力"}\n表現: ${expression}` },
        ],
      }),
    });
    if (!response.ok) throw new Error("AI解説を利用できませんでした");
    const result = await response.json();
    const explanation = result.output_text ?? result.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content ?? []).map((item: { text?: string }) => item.text ?? "").join("") ?? "";
    return Response.json({ explanation }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "AI解説に失敗しました" }, { status: 400, headers: corsHeaders });
  }
});

async function reserveAiUsage(request: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = request.headers.get("Authorization");
  if (!url || !key || !authorization) throw new Error("AI利用上限を確認できませんでした");
  const response = await fetch(`${url}/rest/v1/rpc/reserve_ai_request`, { method: "POST", headers: { apikey: key, Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify({ p_estimated_usd: 0.001 }) });
  if (!response.ok) throw new Error("今月のAI利用上限に達しました");
}
