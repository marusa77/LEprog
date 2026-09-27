const urlInput = document.querySelector("#url");
const keyInput = document.querySelector("#key");
const message = document.querySelector("#message");
const configMessage = document.querySelector("#config-message");
const saveConfigButton = document.querySelector("#save-config");
const signedOut = document.querySelector("#signed-out");
const signedIn = document.querySelector("#signed-in");

initialize();

async function initialize() {
  const values = await chrome.storage.local.get(["supabaseUrl", "supabaseKey", "phraseNestSession"]);
  urlInput.value = values.supabaseUrl || "";
  keyInput.value = values.supabaseKey || "";
  if (values.supabaseUrl && values.supabaseKey) setConfigMessage("✓ 接続情報は保存済みです");
  showSession(Boolean(values.phraseNestSession?.access_token));
  document.querySelector("#redirect-url").textContent = chrome.identity.getRedirectURL("supabase");
}

saveConfigButton.addEventListener("click", async () => {
  try {
    const url = urlInput.value.trim().replace(/\/$/, "");
    const key = keyInput.value.trim();
    if (!url || !key) return setConfigMessage("Project URLとPublishable keyを入力してください", true);
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) return setConfigMessage("Project URLの形式を確認してください", true);
    if (!key.startsWith("sb_publishable_") && !key.startsWith("eyJ")) return setConfigMessage("Publishable keyを確認してください", true);
    saveConfigButton.disabled = true;
    saveConfigButton.textContent = "保存中…";
    await chrome.storage.local.set({ supabaseUrl: url, supabaseKey: key });
    const saved = await chrome.storage.local.get(["supabaseUrl", "supabaseKey"]);
    if (saved.supabaseUrl !== url || saved.supabaseKey !== key) throw new Error("保存内容を確認できませんでした");
    setConfigMessage("✓ 接続情報を保存しました");
  } catch (error) {
    setConfigMessage(error.message || "保存できませんでした", true);
  } finally {
    saveConfigButton.disabled = false;
    saveConfigButton.textContent = "接続情報を保存";
  }
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
function setConfigMessage(text, error = false) { configMessage.textContent = text; configMessage.style.color = error ? "#a4473e" : "#1f654f"; }
