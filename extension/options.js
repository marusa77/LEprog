const urlInput = document.querySelector("#url");
const keyInput = document.querySelector("#key");
const message = document.querySelector("#message");
const signedOut = document.querySelector("#signed-out");
const signedIn = document.querySelector("#signed-in");

initialize();

async function initialize() {
  const values = await chrome.storage.local.get(["supabaseUrl", "supabaseKey", "phraseNestSession"]);
  urlInput.value = values.supabaseUrl || "";
  keyInput.value = values.supabaseKey || "";
  showSession(Boolean(values.phraseNestSession?.access_token));
  document.querySelector("#redirect-url").textContent = chrome.identity.getRedirectURL("supabase");
}

document.querySelector("#save-config").addEventListener("click", async () => {
  const url = urlInput.value.trim().replace(/\/$/, "");
  const key = keyInput.value.trim();
  if (!url || !key) return setMessage("Project URLとPublishable keyを入力してください", true);
  await chrome.storage.local.set({ supabaseUrl: url, supabaseKey: key });
  setMessage("接続情報を保存しました");
});

document.querySelector("#google-login").addEventListener("click", async () => {
  try {
    const { supabaseUrl, supabaseKey } = await chrome.storage.local.get(["supabaseUrl", "supabaseKey"]);
    if (!supabaseUrl || !supabaseKey) throw new Error("先にSupabaseの接続情報を保存してください");
    const redirectUrl = chrome.identity.getRedirectURL("supabase");
    const authUrl = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;
    const resultUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
    if (!resultUrl) throw new Error("ログインを完了できませんでした");
    const hash = new URL(resultUrl).hash.slice(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) throw new Error(params.get("error_description") || "ログイン情報を受け取れませんでした");
    const expiresIn = Number(params.get("expires_in") || 3600);
    await chrome.storage.local.set({ phraseNestSession: { access_token: accessToken, refresh_token: refreshToken, expires_at: Math.floor(Date.now() / 1000) + expiresIn } });
    showSession(true); setMessage("Googleでログインしました");
  } catch (error) { setMessage(error.message, true); }
});

document.querySelector("#logout").addEventListener("click", async () => { await chrome.storage.local.remove("phraseNestSession"); showSession(false); setMessage("ログアウトしました"); });
function showSession(active) { signedOut.hidden = active; signedIn.hidden = !active; }
function setMessage(text, error = false) { message.textContent = text; message.style.color = error ? "#a4473e" : "#1f654f"; }
