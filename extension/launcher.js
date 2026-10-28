chrome.storage.session.get("phraseNestLaunchError").then(async ({ phraseNestLaunchError }) => {
  if (!phraseNestLaunchError) return;
  document.querySelector("#message").textContent = phraseNestLaunchError;
  await chrome.storage.session.remove("phraseNestLaunchError");
}).catch(() => { /* The normal instructions remain available. */ });
document.querySelectorAll("a[data-tab]").forEach(link => {
  link.href = "#";
  link.addEventListener("click", async event => {
    event.preventDefault();
    const result = await chrome.runtime.sendMessage({ type:"OPEN_LEARNING_PAGE", tab:link.dataset.tab });
    if (!result?.ok) document.querySelector("#message").textContent = result?.error || "接続設定を確認してください。";
  });
});
document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#translate").addEventListener("click", async () => {
  const button = document.querySelector("#translate");
  button.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "OPEN_PANEL" });
    if (result?.ok) window.close();
    else document.querySelector("#message").textContent = result?.error || "通常のWebページを開いてからお試しください。";
  } catch { document.querySelector("#message").textContent = "拡張機能を再読み込みしてからお試しください。"; }
  finally { button.disabled = false; }
});
