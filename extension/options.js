const urlInput = document.querySelector("#url");
const keyInput = document.querySelector("#key");
const reviewInput = document.querySelector("#review-url");
const accessInput = document.querySelector("#require-access");
const message = document.querySelector("#message");
const configMessage = document.querySelector("#config-message");
const saveConfigButton = document.querySelector("#save-config");
const signedOut = document.querySelector("#signed-out");
const signedIn = document.querySelector("#signed-in");

initialize();

async function initialize() {
  const preset = await readPreset();
  const values = await chrome.storage.local.get(["supabaseUrl", "supabaseKey", "phraseNestSession"]);
  if (preset.projectUrl && ((!values.supabaseUrl && !values.supabaseKey) || values.supabaseUrl === preset.projectUrl)) {
    if (!values.supabaseUrl && values.phraseNestSession) { await chrome.storage.local.remove("phraseNestSession"); values.phraseNestSession = null; }
    await chrome.storage.local.set({ supabaseUrl:preset.projectUrl, supabaseKey:preset.publishableKey, reviewUrl:preset.reviewUrl, requireAppAccess:true });
  }
  const settings = await chrome.storage.local.get(["supabaseUrl","supabaseKey","reviewUrl","requireAppAccess"]);
  urlInput.value = settings.supabaseUrl || "";
  keyInput.value = settings.supabaseKey || "";
  reviewInput.value = settings.reviewUrl || "";
  accessInput.checked = settings.requireAppAccess !== false;
  const configured = Boolean(settings.supabaseUrl && settings.supabaseKey);
  document.querySelector("#connection-status").textContent = !configured ? "最初に接続設定を入力してください。" : !settings.reviewUrl ? "復習ページのURLを接続設定に追加してください。" : "接続先は設定済みです。Googleでログインしてください。";
  document.querySelector("#connection-settings").open = !configured || !settings.reviewUrl;
  showSession(Boolean(values.phraseNestSession?.access_token));
  document.querySelector("#redirect-url").textContent = chrome.identity.getRedirectURL("supabase");
}

async function readPreset() {
  try {
    const response = await fetch(chrome.runtime.getURL("deployment-config.json"));
    const preset = await response.json();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(preset.projectUrl) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(preset.publishableKey)) return {};
    return preset;
  } catch { return {}; }
}

saveConfigButton.addEventListener("click", async () => {
  try {
    const url = urlInput.value.trim().replace(/\/$/, "");
    const key = keyInput.value.trim();
    if (!url || !key) return setConfigMessage("Project URLとPublishable keyを入力してください", true);
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) return setConfigMessage("Project URLの形式を確認してください", true);
    if (!isPublicKey(key)) return setConfigMessage("Publishable keyを確認してください。管理用キーは使用できません。", true);
    saveConfigButton.disabled = true;
    saveConfigButton.textContent = "保存中…";
    const reviewUrl = new URL(reviewInput.value.trim());
    if (reviewUrl.protocol !== "https:" || reviewUrl.username || reviewUrl.password || reviewUrl.search || reviewUrl.hash) throw new Error("復習ページには、ログイン情報やパラメーターを含まないHTTPSのURLを入力してください。");
    const previous = await chrome.storage.local.get(["supabaseUrl","supabaseKey"]);
    if (previous.supabaseUrl !== url || previous.supabaseKey !== key) {
      await chrome.storage.local.remove("phraseNestSession"); showSession(false);
    }
    await chrome.storage.local.set({ supabaseUrl: url, supabaseKey: key, reviewUrl:reviewUrl.href, requireAppAccess:accessInput.checked });
    const saved = await chrome.storage.local.get(["supabaseUrl", "supabaseKey"]);
    if (saved.supabaseUrl !== url || saved.supabaseKey !== key) throw new Error("保存内容を確認できませんでした");
    setConfigMessage("✓ 接続情報を保存しました");
    document.querySelector("#connection-status").textContent = "接続先は設定済みです。";
  } catch (error) {
    setConfigMessage(error.message || "保存できませんでした", true);
  } finally {
    saveConfigButton.disabled = false;
    saveConfigButton.textContent = "接続情報を保存";
  }
});

document.querySelector("#google-login").addEventListener("click", async () => {
  try {
    const { supabaseUrl, supabaseKey, requireAppAccess } = await chrome.storage.local.get(["supabaseUrl", "supabaseKey", "requireAppAccess"]);
    if (!supabaseUrl || !supabaseKey) throw new Error("先にSupabaseの接続情報を保存してください");
    setMessage("Supabaseのログイン設定を確認しています…");
    await verifyGoogleProvider(supabaseUrl, supabaseKey);
    const redirectUrl = chrome.identity.getRedirectURL("supabase");
    const authUrl = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;
    const resultUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
    if (!resultUrl) throw new Error("ログインを完了できませんでした");
    const returned = new URL(resultUrl), expected = new URL(redirectUrl);
    if (returned.origin !== expected.origin || returned.pathname !== expected.pathname) throw new Error("ログインの戻り先が一致しません。接続設定を確認してください。");
    const hash = new URL(resultUrl).hash.slice(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) throw new Error(params.get("error_description") || "ログイン情報を受け取れませんでした");
    const expiresIn = Number(params.get("expires_in") || 3600);
    if (requireAppAccess) {
      const access = await fetch(`${supabaseUrl}/rest/v1/rpc/app_access_status`, { method:"POST", headers:{ apikey:supabaseKey, Authorization:`Bearer ${accessToken}`, "Content-Type":"application/json" }, body:"{}" });
      if (!access.ok) throw new Error("利用許可を確認できません。管理者は0008のSQL設定を確認してください。");
      if (await access.json() !== true) { await chrome.storage.local.remove("phraseNestSession"); showSession(false); throw new Error("このGoogleアカウントには利用許可がありません。"); }
    }
    await chrome.storage.local.set({ phraseNestSession: { access_token: accessToken, refresh_token: refreshToken, expires_at: Math.floor(Date.now() / 1000) + expiresIn } });
    showSession(true); setMessage("✓ Googleでログインしました");
  } catch (error) {
    const detail = error.message || "Googleログインを開始できませんでした";
    if (/Authorization page could not be loaded/i.test(detail)) {
      setMessage("ログイン画面を開けませんでした。Google CloudのAuthorized redirect URIに、Supabaseの『Callback URL』が正確に登録されているか確認してください。", true);
    } else {
      setMessage(detail, true);
    }
  }
});

async function verifyGoogleProvider(url, key) {
  let response;
  try {
    response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
  } catch {
    throw new Error("Supabaseへ接続できません。Project URLを確認してください");
  }
  if (response.status === 401 || response.status === 403) throw new Error("Publishable keyが正しいか確認してください");
  if (!response.ok) throw new Error(`Supabaseの設定確認に失敗しました（${response.status}）`);
  const settings = await response.json();
  if (!settings.external?.google) throw new Error("SupabaseでGoogleログインが有効になっていません。Authentication → Sign In / Providers → Googleを確認してください");
}

function isPublicKey(value) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  try { return JSON.parse(atob(value.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))).role === "anon"; }
  catch { return false; }
}

document.querySelector("#logout").addEventListener("click", async () => { await chrome.storage.local.remove("phraseNestSession"); showSession(false); setMessage("ログアウトしました"); });
function showSession(active) { signedOut.hidden = active; signedIn.hidden = !active; }
function setMessage(text, error = false) { message.textContent = text; message.style.color = error ? "var(--rose)" : "var(--green)"; }
function setConfigMessage(text, error = false) { configMessage.textContent = text; configMessage.style.color = error ? "var(--rose)" : "var(--green)"; }
