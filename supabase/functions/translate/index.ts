const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { text, source = "en", target = "ja" } = await request.json();
    if (typeof text !== "string" || !text.trim()) throw new Error("翻訳する文章がありません");
    if (text.length > 5000) throw new Error("一度に翻訳できるのは5,000文字までです");
    const apiKey = Deno.env.get("GOOGLE_TRANSLATE_API_KEY");
    if (!apiKey) throw new Error("クラウド翻訳がまだ設定されていません");
    await reserveUsage(request, "reserve_cloud_translation", { p_characters: text.length });
    const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text, source, target, format: "text" }),
    });
    if (!response.ok) throw new Error("クラウド翻訳を利用できませんでした");
    const result = await response.json();
    return Response.json({ translation: result.data.translations[0].translatedText, characters: text.length }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "翻訳に失敗しました" }, { status: 400, headers: corsHeaders });
  }
});

async function reserveUsage(request: Request, name: string, body: Record<string, unknown>) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = request.headers.get("Authorization");
  if (!url || !key || !authorization) throw new Error("利用上限を確認できませんでした");
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: key, Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("今月のクラウド翻訳上限に達しました");
}
