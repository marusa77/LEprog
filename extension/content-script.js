let phraseNestHost;
let selectedPageText = "";
let localTranslator;

const commonPhrases = [
  "on the fence", "at the end of the day", "as far as i know", "for the most part",
  "in the long run", "out of nowhere", "a lot of", "kind of", "sort of",
  "turn out", "figure out", "find out", "come up with", "get rid of", "end up",
  "make sure", "deal with", "look forward to", "be supposed to", "used to",
];

const stopWords = new Set(
  "this that these those there here have has had been being were was will would could should about after before because while where which what when who whom whose then than just also very really much many some any each every other another into from with without your yours their theirs they them our ours you are and but not for the its it's can may might must does did doing done said says like even only more most such still already ever never reddit post comment people thing things something anything everything someone anyone everyone".split(" "),
);

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "OPEN_TRANSLATOR") openTranslator();
});

async function openTranslator() {
  const selection = window.getSelection()?.toString().trim() || "";
  if (selection) selectedPageText = selection;
  if (!selectedPageText) return showPageToast("先に翻訳する英文を選択してください");
  if (!phraseNestHost) createPanel();
  phraseNestHost.hidden = false;
  const root = phraseNestHost.shadowRoot;
  root.querySelector("#pn-source").textContent = selectedPageText;
  root.querySelector("#pn-translation").value = "";
  root.querySelector("#pn-note").value = "";
  root.querySelector("#pn-terms").replaceChildren();
  setPanelMessage("Chrome内蔵翻訳を準備しています…");
  const localResult = await translateLocally(selectedPageText);
  if (localResult.translation) {
    root.querySelector("#pn-translation").value = localResult.translation;
    root.querySelector("#pn-provider").textContent = "端末内翻訳 · ¥0";
    root.querySelector("#pn-local").hidden = true;
    root.querySelector("#pn-cloud").hidden = true;
    await populateCandidateTerms(selectedPageText);
  } else if (localResult.needsActivation) {
    root.querySelector("#pn-provider").textContent = "英日翻訳データの準備が必要です";
    root.querySelector("#pn-local").hidden = false;
    root.querySelector("#pn-cloud").hidden = true;
    setPanelMessage("下のボタンを押すと、無料の英日翻訳データをChromeへ準備します。");
  } else {
    root.querySelector("#pn-provider").textContent = "端末内翻訳を利用できません";
    root.querySelector("#pn-local").hidden = true;
    root.querySelector("#pn-cloud").hidden = false;
    setPanelMessage("必要な場合だけ、クラウド翻訳を実行できます。");
  }
}

function createPanel() {
  phraseNestHost = document.createElement("div");
  phraseNestHost.id = "phrase-nest-extension";
  const shadow = phraseNestHost.attachShadow({ mode: "open" });
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = chrome.runtime.getURL("panel.css");
  shadow.append(stylesheet);
  const panel = document.createElement("section");
  panel.className = "pn-panel";
  panel.innerHTML = `
    <header class="pn-header" id="pn-drag"><div class="pn-brand"><span>P</span><div><strong>PhraseNest</strong><small id="pn-provider">端末内翻訳 · ¥0</small></div></div><button id="pn-close" class="pn-icon" type="button" aria-label="閉じる">×</button></header>
    <div class="pn-body">
      <label class="pn-label">選択した英文</label>
      <div id="pn-source" class="pn-source" tabindex="0"></div>
      <p class="pn-help">単語はダブルクリック、熟語はドラッグして選択できます。</p>
      <button id="pn-use-selection" class="pn-link" type="button">選択した語句を追加</button>
      <label class="pn-label" for="pn-translation">日本語訳</label>
      <textarea id="pn-translation" rows="3" placeholder="翻訳結果は自由に編集できます"></textarea>
      <button id="pn-local" class="pn-primary pn-full" type="button" hidden>端末内翻訳を開始（無料）</button>
      <button id="pn-cloud" class="pn-secondary pn-full" type="button" hidden>クラウド翻訳を使う</button>
      <label class="pn-label" for="pn-note">自分用の説明・メモ</label>
      <textarea id="pn-note" rows="2" placeholder="直訳では分かりにくい点など"></textarea>
      <div class="pn-section-title"><strong>単語・熟語の候補</strong><span>保存するものにチェック</span></div>
      <div class="pn-add-row"><input id="pn-term-input" type="text" placeholder="例：on the fence"><button id="pn-add-term" class="pn-secondary" type="button">追加</button></div>
      <div id="pn-terms" class="pn-terms"></div>
      <p id="pn-message" class="pn-message" role="status"></p>
      <footer><button id="pn-settings" class="pn-plain" type="button">設定</button><button id="pn-save" class="pn-primary" type="button">英文と語句を保存</button></footer>
    </div>`;
  shadow.append(panel);
  document.documentElement.append(phraseNestHost);
  bindPanelEvents(shadow);
  enableDragging(panel, shadow.querySelector("#pn-drag"));
}

function bindPanelEvents(root) {
  root.querySelector("#pn-close").addEventListener("click", () => { phraseNestHost.hidden = true; });
  root.querySelector("#pn-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  root.querySelector("#pn-use-selection").addEventListener("click", () => {
    const selection = root.getSelection?.()?.toString().trim() || window.getSelection()?.toString().trim();
    if (!selection) return setPanelMessage("英文の中から語句を選択してください。", true);
    root.querySelector("#pn-term-input").value = selection;
    addTerm(selection);
  });
  root.querySelector("#pn-add-term").addEventListener("click", () => addTerm(root.querySelector("#pn-term-input").value));
  root.querySelector("#pn-term-input").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addTerm(event.target.value); } });
  root.querySelector("#pn-local").addEventListener("click", useLocalTranslation);
  root.querySelector("#pn-cloud").addEventListener("click", useCloudTranslation);
  root.querySelector("#pn-save").addEventListener("click", saveCapture);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && phraseNestHost && !phraseNestHost.hidden) phraseNestHost.hidden = true; });
}

async function addTerm(rawTerm, automatic = false) {
  const root = phraseNestHost.shadowRoot;
  const term = rawTerm.trim().replace(/\s+/g, " ");
  if (!term) return;
  const normalized = term.toLowerCase();
  if ([...root.querySelectorAll(".pn-term")].some((row) => row.dataset.normalized === normalized)) return setPanelMessage("この語句はすでに追加されています。", true);
  root.querySelector("#pn-term-input").value = "";
  const row = document.createElement("div");
  row.className = "pn-term";
  row.dataset.normalized = normalized;
  const check = document.createElement("input");
  check.type = "checkbox";
  check.className = "pn-term-check";
  check.checked = !automatic;
  check.setAttribute("aria-label", `${term}を保存する`);
  const text = document.createElement("div"); text.className = "pn-term-text";
  const titleLine = document.createElement("div"); titleLine.className = "pn-term-title";
  const title = document.createElement("strong"); title.textContent = term;
  titleLine.append(title);
  if (automatic) {
    const badge = document.createElement("span"); badge.textContent = "候補";
    titleLine.append(badge);
  }
  const meaning = document.createElement("input"); meaning.placeholder = "意味を入力"; meaning.setAttribute("aria-label", `${term}の意味`);
  text.append(titleLine, meaning);
  const actions = document.createElement("div"); actions.className = "pn-term-actions";
  const ai = document.createElement("button"); ai.type = "button"; ai.className = "pn-ai"; ai.textContent = "AI解説"; ai.addEventListener("click", () => explainTerm(term, meaning));
  const remove = document.createElement("button"); remove.type = "button"; remove.className = "pn-remove"; remove.textContent = "×"; remove.setAttribute("aria-label", `${term}を削除`); remove.addEventListener("click", () => row.remove());
  actions.append(ai, remove); row.append(check, text, actions); root.querySelector("#pn-terms").append(row);
  const localResult = await translateLocally(term);
  if (localResult.translation) meaning.value = localResult.translation;
}

async function translateLocally(text, allowDownload = false, onProgress = () => {}) {
  try {
    if (!("Translator" in globalThis)) return { translation: null, needsActivation: false };
    if (localTranslator) return { translation: await localTranslator.translate(text), needsActivation: false };
    if (!allowDownload) {
      const availability = await globalThis.Translator.availability({ sourceLanguage: "en", targetLanguage: "ja" });
      if (availability === "unavailable") return { translation: null, needsActivation: false };
      if (availability !== "available") return { translation: null, needsActivation: true };
    }
    localTranslator = await globalThis.Translator.create({
      sourceLanguage: "en",
      targetLanguage: "ja",
      monitor(monitor) { monitor.addEventListener("downloadprogress", (event) => onProgress(Math.round(event.loaded * 100))); },
    });
    return { translation: await localTranslator.translate(text), needsActivation: false };
  } catch { return { translation: null, needsActivation: false }; }
}

async function useLocalTranslation() {
  const root = phraseNestHost.shadowRoot;
  const button = root.querySelector("#pn-local");
  button.disabled = true;
  button.textContent = "英日翻訳データを準備中…";
  const result = await translateLocally(selectedPageText, true, (percent) => {
    button.textContent = `英日翻訳データを準備中… ${percent}%`;
  });
  button.disabled = false;
  button.textContent = "端末内翻訳を開始（無料）";
  if (!result.translation) {
    root.querySelector("#pn-cloud").hidden = false;
    return setPanelMessage("端末内翻訳を利用できませんでした。Chromeの更新またはクラウド翻訳をお試しください。", true);
  }
  root.querySelector("#pn-translation").value = result.translation;
  root.querySelector("#pn-provider").textContent = "端末内翻訳 · ¥0";
  button.hidden = true;
  root.querySelector("#pn-cloud").hidden = true;
  await populateCandidateTerms(selectedPageText);
}

async function useCloudTranslation() {
  const root = phraseNestHost.shadowRoot;
  setPanelMessage("クラウド翻訳中…");
  const response = await chrome.runtime.sendMessage({ type: "TRANSLATE", payload: { text: selectedPageText, source: "en", target: "ja" } });
  if (!response?.ok) return setPanelMessage(response?.error || "クラウド翻訳に失敗しました。", true);
  root.querySelector("#pn-translation").value = response.result.translation;
  root.querySelector("#pn-provider").textContent = `クラウド翻訳 · ${response.result.characters}文字`;
  root.querySelector("#pn-cloud").hidden = true;
  await populateCandidateTerms(selectedPageText);
}

function extractCandidates(sentence) {
  const lower = sentence.toLowerCase().replace(/[’]/g, "'");
  const phrases = commonPhrases.filter((phrase) => {
    const pattern = phrase.replace(/\s+/g, "\\s+");
    return new RegExp(`\\b${pattern}\\b`, "i").test(lower);
  });
  const words = (lower.match(/[a-z]+(?:'[a-z]+)?/g) || [])
    .filter((word) => word.length >= 4 && !word.includes("'") && !stopWords.has(word));
  const uniqueWords = [...new Set(words)].filter(
    (word) => !phrases.some((phrase) => phrase.split(" ").includes(word)),
  );
  return [...phrases, ...uniqueWords].slice(0, 8);
}

async function populateCandidateTerms(sentence) {
  const candidates = extractCandidates(sentence);
  if (!candidates.length) return setPanelMessage("単語・熟語の候補は見つかりませんでした。");
  setPanelMessage(`単語・熟語の候補を準備中… 0/${candidates.length}`);
  let completed = 0;
  await Promise.all(candidates.map(async (candidate) => {
    await addTerm(candidate, true);
    completed += 1;
    setPanelMessage(`単語・熟語の候補を準備中… ${completed}/${candidates.length}`);
  }));
  setPanelMessage("保存したい単語・熟語にチェックを入れてください。");
}

async function explainTerm(expression, meaningInput) {
  const root = phraseNestHost.shadowRoot;
  setPanelMessage(`「${expression}」をAIで説明しています…`);
  const response = await chrome.runtime.sendMessage({ type: "EXPLAIN", payload: { sentence: selectedPageText, expression, translation: root.querySelector("#pn-translation").value } });
  if (!response?.ok) return setPanelMessage(response?.error || "AI解説に失敗しました。", true);
  const explanation = response.result.explanation;
  meaningInput.value = meaningInput.value ? `${meaningInput.value} — ${explanation}` : explanation;
  setPanelMessage("AI解説を追加しました。保存前に内容を確認してください。");
}

async function saveCapture() {
  const root = phraseNestHost.shadowRoot;
  const saveButton = root.querySelector("#pn-save");
  saveButton.disabled = true; saveButton.textContent = "保存中…";
  const terms = [...root.querySelectorAll(".pn-term")]
    .filter((row) => row.querySelector(".pn-term-check").checked)
    .map((row) => ({
      term: row.querySelector("strong").textContent,
      meaning: row.querySelector(".pn-term-text input").value,
      note: "",
    }));
  const pathMatch = location.pathname.match(/\/r\/([^/]+)/i);
  const payload = { p_original_text: selectedPageText, p_machine_translation: root.querySelector("#pn-translation").value, p_translation: root.querySelector("#pn-translation").value, p_note: root.querySelector("#pn-note").value, p_source_url: location.href, p_source_title: document.title, p_subreddit: pathMatch ? `r/${pathMatch[1]}` : null, p_terms: terms };
  const response = await chrome.runtime.sendMessage({ type: "SAVE_CAPTURE", payload });
  saveButton.disabled = false; saveButton.textContent = "英文と語句を保存";
  if (!response?.ok) return setPanelMessage(response?.error || "保存に失敗しました。", true);
  const existingCount = response.result.terms?.filter((term) => term.existing).length || 0;
  setPanelMessage(`保存しました。${existingCount ? `登録済みの語句 ${existingCount}件は登場回数を増やしました。` : ""}`);
}

function setPanelMessage(text, error = false) { if (!phraseNestHost) return; const element = phraseNestHost.shadowRoot.querySelector("#pn-message"); element.textContent = text; element.classList.toggle("pn-error", error); }

function showPageToast(text) {
  const toast = document.createElement("div"); toast.textContent = text; Object.assign(toast.style, { position:"fixed", right:"24px", top:"24px", zIndex:"2147483647", padding:"13px 17px", borderRadius:"9px", background:"#17231f", color:"white", font:"13px Arial,sans-serif", boxShadow:"0 12px 30px rgba(0,0,0,.2)" }); document.documentElement.append(toast); setTimeout(() => toast.remove(), 2600);
}

function enableDragging(panel, handle) {
  let startX = 0, startY = 0, startRight = 0, startTop = 0;
  handle.addEventListener("pointerdown", (event) => { if (event.target.closest("button")) return; const rect = panel.getBoundingClientRect(); startX = event.clientX; startY = event.clientY; startRight = innerWidth - rect.right; startTop = rect.top; handle.setPointerCapture(event.pointerId); });
  handle.addEventListener("pointermove", (event) => { if (!handle.hasPointerCapture(event.pointerId)) return; panel.style.right = `${Math.max(8, startRight - (event.clientX - startX))}px`; panel.style.top = `${Math.max(8, startTop + event.clientY - startY)}px`; });
}
