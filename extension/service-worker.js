const panelOpenings = new Map();

function supportsPage(url) {
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol)
      && parsed.hostname !== "chromewebstore.google.com"
      && !(parsed.hostname === "chrome.google.com" && parsed.pathname.startsWith("/webstore"));
  } catch { return false; }
}

async function openPanel(tab) {
  if (!Number.isInteger(tab?.id) || !supportsPage(tab.url)) {
    return { ok: false, error: "この画面では英文を取り込めません。Engooなどの通常のWebページを開いてください。Chromeの設定画面やウェブストアでは使えません。" };
  }
  // One opening per tab, even when the shortcut/button is pressed repeatedly.
  if (panelOpenings.has(tab.id)) return panelOpenings.get(tab.id);
  const opening = (async () => {
    try {
      let ready = false;
      try { ready = (await chrome.tabs.sendMessage(tab.id, { type: "PHRASE_NEST_READY" }))?.ready === true; }
      catch { /* The page has not loaded PhraseNest yet. */ }
      if (!ready) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["common-expressions.js", "conversation-patterns.js", "content-script.js"],
        });
      }
      // Existing scripts are reused: keep the window size and unsaved draft.
      const response = await chrome.tabs.sendMessage(tab.id, { type: "OPEN_TRANSLATOR" });
      if (response?.ok !== true) throw new Error("Page did not acknowledge opening");
      return { ok: true };
    } catch {
      return { ok: false, error: "このページでPhraseNestを開けませんでした。ページを再読み込みして、英文を選択し直してからお試しください。Chromeが拡張機能の動作を制限している画面では使えません。" };
    }
  })();
  panelOpenings.set(tab.id, opening);
  try { return await opening; }
  finally { if (panelOpenings.get(tab.id) === opening) panelOpenings.delete(tab.id); }
}

async function showLaunchError(error) {
  try {
    await chrome.storage.session.set({ phraseNestLaunchError: error });
    await chrome.action.openPopup();
  } catch { /* Browser controls can prevent opening the menu; no page data was sent. */ }
}

let customPatternCache = { expiresAt: 0, rows: [] };
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && ["supabaseUrl","supabaseKey","phraseNestSession"].some(key => key in changes)) customPatternCache = { expiresAt:0, rows:[] };
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "translate-selection") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await openPanel(tab);
    if (!result.ok) await showLaunchError(result.error);
  } catch { await showLaunchError("ページを再読み込みしてから、もう一度PhraseNestを呼び出してください。"); }
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;
  const { supabaseUrl } = await chrome.storage.local.get("supabaseUrl");
  if (!supabaseUrl) await chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OPEN_PANEL") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => openPanel(tab))
      .catch(() => ({ ok: false, error: "ページを再読み込みしてからお試しください。" })).then(sendResponse);
  }
  else if (message.type === "OPEN_LEARNING_PAGE") {
    openLearningPage(message.tab).then(sendResponse);
  }
  else if (message.type === "SAVE_CAPTURE") handleSave(message.payload).then(sendResponse);
  else if (message.type === "TRANSLATE") callFunction("translate", message.payload).then(sendResponse);
  else if (message.type === "EXPLAIN") callFunction("explain", message.payload).then(sendResponse);
  else if (message.type === "GET_CUSTOM_PATTERNS") getCustomPatterns().then(sendResponse);
  else if (message.type === "RECORD_LOOKUP") recordLookup().then(sendResponse);
  else return false;
  return true;
});

async function getConfiguration() {
  const config = await chrome.storage.local.get(["supabaseUrl", "supabaseKey", "reviewUrl", "requireAppAccess", "phraseNestSession"]);
  if (!config.supabaseUrl && !config.supabaseKey && !config.phraseNestSession) {
    const preset = await readDeploymentConfiguration();
    if (preset.projectUrl && preset.publishableKey) return { url:preset.projectUrl, key:preset.publishableKey, reviewUrl:preset.reviewUrl, requireAccess:preset.requireAccess !== false };
  }
  if (!config.supabaseUrl || !config.supabaseKey) throw new Error("先に拡張機能の設定を完了してください");
  return { url: config.supabaseUrl.replace(/\/$/, ""), key: config.supabaseKey, reviewUrl:config.reviewUrl, requireAccess:config.requireAppAccess === true };
}

async function readDeploymentConfiguration() {
  try {
    const response = await fetch(chrome.runtime.getURL("deployment-config.json"));
    const preset = await response.json();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(preset.projectUrl) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(preset.publishableKey)) return {};
    return preset;
  } catch { return {}; }
}

async function openLearningPage(tab) {
  try {
    if (!["capture","today","library","words","notes","organize","help"].includes(tab)) throw new Error("移動先を確認してください。");
    const config = await getConfiguration();
    const defaults = config.reviewUrl ? {} : await readDeploymentConfiguration();
    const preset = defaults.projectUrl === config.url ? defaults : {};
    const url = new URL(config.reviewUrl || preset.reviewUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("設定画面で復習ページのURLを入力してください。");
    if (tab !== "today") url.searchParams.set("tab",tab);
    await chrome.tabs.create({ url:url.href }); return { ok:true };
  } catch { await chrome.runtime.openOptionsPage(); return { ok:false, error:"設定画面で復習ページのURLを確認してください。" }; }
}

async function checkAppAccess(session) {
  const config = await getConfiguration();
  if (!config.requireAccess) return session;
  const response = await fetch(`${config.url}/rest/v1/rpc/app_access_status`, { method:"POST", headers:{ apikey:config.key, Authorization:`Bearer ${session.access_token}`, "Content-Type":"application/json" }, body:"{}" });
  if (!response.ok) throw new Error("利用許可を確認できません。管理者は0008のSQL設定を確認してください。");
  if (await response.json() !== true) throw new Error("このアカウントには利用許可がありません。許可されたGoogleアカウントでログインしてください。");
  return session;
}

async function getSession() {
  const { phraseNestSession } = await chrome.storage.local.get("phraseNestSession");
  if (!phraseNestSession?.refresh_token) throw new Error("拡張機能の設定画面からログインしてください");
  const expiresSoon = !phraseNestSession.expires_at || phraseNestSession.expires_at * 1000 < Date.now() + 60000;
  if (!expiresSoon) return checkAppAccess(phraseNestSession);
  const { url, key } = await getConfiguration();
  const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: phraseNestSession.refresh_token }),
  });
  const refreshed = await response.json();
  if (!response.ok) throw new Error("ログインの有効期限が切れました。もう一度ログインしてください");
  await chrome.storage.local.set({ phraseNestSession: refreshed });
  return checkAppAccess(refreshed);
}

async function authenticatedFetch(path, init = {}) {
  const { url, key } = await getConfiguration();
  const session = await getSession();
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || result.error || "Supabaseとの通信に失敗しました");
  return result;
}

async function handleSave(payload) {
  try {
    const result = await authenticatedFetch("/rest/v1/rpc/save_capture", { method: "POST", body: JSON.stringify(payload) });
    return { ok: true, result };
  } catch (error) { return { ok: false, error: error.message }; }
}

async function getCustomPatterns() {
  try {
    if (customPatternCache.expiresAt > Date.now()) return { ok: true, result: customPatternCache.rows };
    const result = await authenticatedFetch("/rest/v1/custom_phrase_patterns?select=term,meaning&order=updated_at.desc&limit=500");
    customPatternCache = { expiresAt: Date.now() + 300000, rows: result };
    return { ok: true, result };
  } catch (error) { return { ok: false, error: error.message }; }
}

async function callFunction(name, payload) {
  try {
    const result = await authenticatedFetch(`/functions/v1/${name}`, { method: "POST", body: JSON.stringify(payload) });
    const activity = name === "translate" || name === "explain" ? await recordLookup() : null;
    return { ok: true, result: activity ? { ...result, activityRecorded:activity.ok } : result };
  } catch (error) { return { ok: false, error: error.message }; }
}

async function recordLookup() {
  try {
    await authenticatedFetch("/rest/v1/rpc/record_learning_lookup", { method:"POST", body:"{}" });
    return { ok:true };
  } catch { return { ok:false }; } // A logging failure must not discard a translation.
}
