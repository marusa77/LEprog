const learningUrl = "https://phrasenest-reddit-english.uchimaruyukihiro.chatgpt.site";
document.querySelectorAll("a[data-tab]").forEach((link) => {
  const url = new URL(learningUrl);
  url.searchParams.set("tab", link.dataset.tab);
  link.href = url.toString();
  link.target = "_blank";
  link.rel = "noopener noreferrer";
});
document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#translate").addEventListener("click", async () => {
  const button = document.querySelector("#translate");
  button.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "OPEN_PANEL" });
    if (result?.ok) window.close();
    else document.querySelector("#message").textContent = result?.error || "Redditのページを開いてください。";
  } catch { document.querySelector("#message").textContent = "拡張機能を再読み込みしてからお試しください。"; }
  finally { button.disabled = false; }
});
