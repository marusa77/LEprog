const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { text, texts, source = "en", target = "ja" } = await request.json();
    const items = Array.isArray(texts) ? texts : [text];
    if (!items.length || items.some((item) => typeof item !== "string" || !item.trim())) throw new Error("翻訳する文章がありません");
    const characters = items.reduce((total, item) => total + item.length, 0);
    if (characters > 5000) throw new Error("一度に翻訳できるのは合計5,000文字までです");
    const apiKey = Deno.env.get("GOOGLE_TRANSLATE_API_KEY");
    if (!apiKey) throw new Error("Google翻訳がまだ設定されていません。");
    const monthlyCharacters = await reserveUsage(request, "reserve_cloud_translation", { p_characters: characters });
    const response = await fetch("https://translation.googleapis.com/language/translate/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
      body: JSON.stringify({ q: items, source, target, format: "text" }),
    });
    if (!response.ok) throw new Error("Google翻訳を利用できませんでした");
    const result = await response.json();
    const translations = result.data.translations.map((entry: { translatedText: string }) => entry.translatedText);
    return Response.json({
      translation: translations[0],
      translations,
      characters,
      monthlyCharacters,
      monthlyLimit: 450000,
    }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "翻訳に失敗しました" }, { status: 400, headers: corsHeaders });
  }
});

async function reserveUsage(request: Request, name: string, body: Record<string, unknown>) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = getPublishableKey();
  const authorization = request.headers.get("Authorization");
  if (!url || !key || !authorization) throw new Error("利用上限を確認できませんでした");
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: key, Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("今月のクラウド翻訳上限に達しました");
  return await response.json() as number;
}

function getPublishableKey() {
  const keys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (keys) {
    const key = (JSON.parse(keys) as Record<string, string>).default;
    if (key) return key;
  }
  const legacyKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!legacyKey) throw new Error("Supabaseの公開キーを確認できませんでした");
  return legacyKey;
}
