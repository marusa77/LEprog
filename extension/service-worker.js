async function openPanel(tab) {
  if (!tab?.id || !tab.url?.includes("reddit.com")) return;
  try { await chrome.tabs.sendMessage(tab.id, { type: "OPEN_TRANSLATOR" }); }
  catch { /* The Reddit tab may still be loading. */ }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "translate-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await openPanel(tab);
});

chrome.action.onClicked.addListener(openPanel);

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;
  const { supabaseUrl } = await chrome.storage.local.get("supabaseUrl");
  if (!supabaseUrl) await chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SAVE_CAPTURE") handleSave(message.payload).then(sendResponse);
  else if (message.type === "TRANSLATE") callFunction("translate", message.payload).then(sendResponse);
  else if (message.type === "EXPLAIN") callFunction("explain", message.payload).then(sendResponse);
  else return false;
  return true;
});

async function getConfiguration() {
  const config = await chrome.storage.local.get(["supabaseUrl", "supabaseKey"]);
  if (!config.supabaseUrl || !config.supabaseKey) throw new Error("先に拡張機能の設定を完了してください");
  return { url: config.supabaseUrl.replace(/\/$/, ""), key: config.supabaseKey };
}

async function getSession() {
  const { phraseNestSession } = await chrome.storage.local.get("phraseNestSession");
  if (!phraseNestSession?.refresh_token) throw new Error("拡張機能の設定画面からログインしてください");
  const expiresSoon = !phraseNestSession.expires_at || phraseNestSession.expires_at * 1000 < Date.now() + 60000;
  if (!expiresSoon) return phraseNestSession;
  const { url, key } = await getConfiguration();
  const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: phraseNestSession.refresh_token }),
  });
  const refreshed = await response.json();
  if (!response.ok) throw new Error("ログインの有効期限が切れました。もう一度ログインしてください");
  await chrome.storage.local.set({ phraseNestSession: refreshed });
  return refreshed;
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

async function callFunction(name, payload) {
  try {
    const result = await authenticatedFetch(`/functions/v1/${name}`, { method: "POST", body: JSON.stringify(payload) });
    return { ok: true, result };
  } catch (error) { return { ok: false, error: error.message }; }
}
