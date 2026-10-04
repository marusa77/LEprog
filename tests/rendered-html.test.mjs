import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const nodeRequire = createRequire(import.meta.url);

async function loadTypeScriptModule(relativePath, globals = {}) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, URL, URLSearchParams, Date, JSON, process: { env: {} }, ...globals };
  vm.createContext(context); vm.runInContext(compiled, context);
  return context.exports;
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the PhraseNest learning app", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>PhraseNest/);
  assert.match(html, /PhraseNest/);
  assert.match(html, /保存内容を読み込んでいます/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("ships the extension and cloud schema", async () => {
  const [manifest, serviceWorker, contentScript, expressionsScript, patternsScript, panelCss, translateFunction, schema, coreImageMigration, organizationMigration, organizationModule, organizationGuide, learningApp, packageJson] = await Promise.all([
    readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/content-script.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/common-expressions.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/conversation-patterns.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/panel.css", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/translate/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/0001_initial_schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/0002_core_image_notes.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/0003_organization_workflow.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/organization.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/organization-guide.md", import.meta.url), "utf8"),
    readFile(new URL("../app/learning-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(manifest, /translate-selection/);
  assert.match(manifest, /Ctrl\+Shift\+Y/);
  assert.match(manifest, /common-expressions\.js/);
  assert.match(manifest, /conversation-patterns\.js/);
  assert.equal(JSON.parse(manifest).action.default_popup, "launcher.html");
  assert.match(contentScript, /function openLauncher/);
  assert.match(contentScript, /保存後の変更あり/);
  assert.match(contentScript, /phraseNestPanelPreferences/);
  assert.match(learningApp, /保存内容をまとめて検索/);
  assert.match(learningApp, /function SearchView/);
  assert.match(learningApp, /よく出会う（3回以上）/);
  assert.match(contentScript, /保存内容/);
  assert.match(contentScript, /学習メモ/);
  assert.match(contentScript, /core_image/);
  assert.match(contentScript, /GET_CUSTOM_PATTERNS/);
  assert.match(contentScript, /今日の復習/);
  assert.match(contentScript, /searchParams\.set\("tab"/);
  assert.match(panelCss, /:host\(\[hidden\]\)\s*\{\s*display:\s*none\s*!important/);
  const openTranslator = contentScript.slice(contentScript.indexOf("async function openTranslator"), contentScript.indexOf("function createPanel"));
  assert.ok(openTranslator.indexOf("requestCloudTranslation") < openTranslator.indexOf("translateLocally"));
  assert.match(translateFunction, /monthlyLimit:\s*450000/);
  assert.match(translateFunction, /q:\s*items/);
  assert.match(schema, /create table public\.vocabulary_items/i);
  assert.match(schema, /create or replace function public\.save_capture/i);
  assert.match(coreImageMigration, /add column if not exists core_image/i);
  assert.match(coreImageMigration, /v_term->>'core_image'/i);
  assert.match(serviceWorker, /custom_phrase_patterns/);
  assert.match(organizationMigration, /apply_organization_result/i);
  assert.match(organizationMigration, /organization_changes/i);
  assert.match(organizationModule, /maxItems: 50, maxCharacters: 20000/);
  assert.match(organizationModule, /estimatedTokens/);
  assert.match(organizationModule, /countPendingOrganizationItems/);
  assert.match(organizationGuide, /元のメモ、訳、コアイメージは変更しない/);
  assert.match(learningApp, /Codex整理/);
  assert.match(learningApp, /整理用JSONを保存/);
  assert.match(learningApp, /件が未整理/);
  assert.match(schema, /reserve_cloud_translation/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  const extensionContext = { chrome: { runtime: { onMessage: { addListener() {} } } } };
  vm.createContext(extensionContext);
  vm.runInContext(expressionsScript, extensionContext);
  vm.runInContext(patternsScript, extensionContext);
  vm.runInContext(contentScript, extensionContext);
  assert.ok(extensionContext.PHRASE_NEST_COMMON_EXPRESSIONS.length >= 200);
  const candidates = vm.runInContext('extractCandidateDetails("We finally figured out the problem and ran out of time.").map((candidate) => candidate.term)', extensionContext);
  assert.ok(candidates.includes("figured out"));
  assert.ok(candidates.includes("ran out of"));
  const formatCandidates = vm.runInContext(`extractCandidateDetails("How's the weather there? I'd like some coffee.")`, extensionContext);
  assert.ok(formatCandidates.some((candidate) => candidate.term === "How's ... there?" && candidate.meaning.includes("そちら")));
  assert.ok(formatCandidates.some((candidate) => candidate.term === "I'd like ..." && candidate.meaning.includes("欲しい")));
});

test("extension opens without a selection and reports the saved draft correctly", async () => {
  const script = await readFile(new URL("../extension/content-script.js", import.meta.url), "utf8");
  const elements = new Map();
  const root = { querySelector: (selector) => elements.get(selector), querySelectorAll: () => [] };
  for (const selector of ["#pn-launcher", "#pn-editor", "#pn-save-footer", "#pn-resume", "#pn-save-state", "#pn-save-hint", "#pn-save", "#pn-translation", "#pn-note"]) {
    elements.set(selector, { hidden: false, value: "", textContent: "", disabled: false, classList: { toggle() {} } });
  }
  const context = { window: { getSelection: () => ({ toString: () => "" }) }, chrome: { runtime: { onMessage: { addListener() {} } } }, host: { shadowRoot: root, hidden: true } };
  vm.createContext(context);
  vm.runInContext(script, context);
  vm.runInContext("phraseNestHost = host; applyPanelPreferences = () => {}", context);
  await vm.runInContext("openTranslator()", context);
  assert.equal(context.host.hidden, false);
  assert.equal(elements.get("#pn-launcher").hidden, false);
  assert.equal(elements.get("#pn-editor").hidden, true);
  assert.equal(elements.get("#pn-resume").hidden, true);
  vm.runInContext('selectedPageText = "Keep going."; updateSaveState()', context);
  assert.equal(elements.get("#pn-save-state").textContent, "未保存");
  vm.runInContext("savedCaptureSnapshot = captureSnapshot(); updateSaveState()", context);
  assert.equal(elements.get("#pn-save-state").textContent, "保存済み");
  assert.equal(elements.get("#pn-save").disabled, true);
  elements.get("#pn-note").value = "コアイメージのメモ";
  vm.runInContext("updateSaveState()", context);
  assert.equal(elements.get("#pn-save-state").textContent, "保存後の変更あり");
  assert.equal(elements.get("#pn-save").disabled, false);
  vm.runInContext("openLauncher()", context);
  assert.equal(elements.get("#pn-resume").hidden, false);
  assert.equal(elements.get("#pn-note").value, "コアイメージのメモ");
});

test("keyboard shortcut on other pages opens the extension menu", async () => {
  const script = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  let popupCount = 0;
  let translatorCount = 0;
  const context = { chrome: { action: { openPopup: async () => { popupCount++; } }, tabs: { sendMessage: async () => { translatorCount++; } }, commands: { onCommand: { addListener() {} } }, runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } } } };
  vm.createContext(context);
  vm.runInContext(script, context);
  await vm.runInContext('openPanel({ id: 1, url: "https://example.com/" })', context);
  await vm.runInContext('openPanel({ id: 1, url: "https://not-reddit.com/" })', context);
  assert.equal(popupCount, 2);
  await vm.runInContext('openPanel({ id: 1, url: "https://www.reddit.com/r/English/" })', context);
  assert.equal(translatorCount, 1);
});

test("panel resizing keeps the opposite corner fixed and enforces size limits", async () => {
  const script = await readFile(new URL("../extension/content-script.js", import.meta.url), "utf8");
  const context = { chrome: { runtime: { onMessage: { addListener() {} } } } };
  vm.createContext(context); vm.runInContext(script, context);
  const start = { left: 300, top: 100, width: 560, height: 600 };
  for (const corner of ["nw", "ne", "sw", "se"]) {
    context.start = start; context.corner = corner;
    const bounds = vm.runInContext("resizePanelBounds(start, corner, 80, 60, 1280, 900)", context);
    assert.equal(bounds.width, corner.includes("w") ? 480 : 640);
    assert.equal(bounds.height, corner.includes("n") ? 540 : 660);
    assert.equal(corner.includes("w") ? bounds.left + bounds.width : bounds.left, corner.includes("w") ? start.left + start.width : start.left);
    assert.equal(corner.includes("n") ? bounds.top + bounds.height : bounds.top, corner.includes("n") ? start.top + start.height : start.top);
    const small = vm.runInContext(`resizePanelBounds(start, corner, ${corner.includes("w") ? 9000 : -9000}, ${corner.includes("n") ? 9000 : -9000}, 1280, 900)`, context);
    assert.equal(small.width, 400); assert.equal(small.height, 400);
    const large = vm.runInContext(`resizePanelBounds(start, corner, ${corner.includes("w") ? -9000 : 9000}, ${corner.includes("n") ? -9000 : 9000}, 1280, 900)`, context);
    assert.ok(large.left >= 8 && large.top >= 8);
    assert.ok(large.left + large.width <= 1272 && large.top + large.height <= 892);
  }
  const tiny = vm.runInContext('resizePanelBounds({ left:8, top:8, width:284, height:284 }, "se", -9000, -9000, 300, 300)', context);
  assert.equal(tiny.width, 284); assert.equal(tiny.height, 284);
});

test("custom panel dimensions restore and reset without changing the draft or font", async () => {
  const script = await readFile(new URL("../extension/content-script.js", import.meta.url), "utf8");
  const classes = new Set();
  const style = { setProperty(name, value) { this[name] = value; } };
  const panel = { style, classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } }, getBoundingClientRect: () => ({ width: parseFloat(style.width), height: style.height === "auto" ? 650 : parseFloat(style.height) }) };
  const elements = new Map([[".pn-panel", panel], ["#pn-font-size", {}], ["#pn-wide", { setAttribute() {} }]]);
  let persisted;
  const context = { innerWidth:1280, innerHeight:900, root: { querySelector: key => elements.get(key), querySelectorAll: () => [] }, chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: { set(value) { persisted = value; } } } } };
  vm.createContext(context); vm.runInContext(script, context);
  vm.runInContext('phraseNestHost = {shadowRoot:root}; selectedPageText = "Keep going."; panelPreferences = { wide:true, fontSize:18, right:24, top:24, width:420, height:480 }; applyPanelPreferences()', context);
  assert.equal(style.width, "420px"); assert.equal(style.height, "480px");
  assert.equal(classes.has("pn-two-columns"), false);
  vm.runInContext('panelPreferences.width = 900; applyPanelPreferences()', context);
  assert.equal(classes.has("pn-two-columns"), true);
  vm.runInContext("resetPanelSize()", context);
  assert.equal(style.width, "560px"); assert.equal(style.height, "auto");
  assert.equal(style["--reading-size"], "18px");
  assert.equal(vm.runInContext("selectedPageText", context), "Keep going.");
  assert.equal(persisted.phraseNestPanelPreferences.width, null);
  assert.equal(persisted.phraseNestPanelPreferences.height, null);
  context.innerWidth = 320; context.innerHeight = 280;
  vm.runInContext('panelPreferences.width = 900; panelPreferences.height = 900; panelPreferences.top = 800; panelPreferences.right = 800; applyPanelPreferences()', context);
  assert.equal(style.width, "304px"); assert.equal(style.height, "264px");
  assert.equal(style.top, "8px"); assert.equal(style.right, "8px");
  assert.equal(classes.has("pn-short"), true);
});

test("corner pointer drags and keyboard resizing remember the dimensions", async () => {
  const script = await readFile(new URL("../extension/content-script.js", import.meta.url), "utf8");
  const listeners = new Map();
  let storedCount = 0;
  const handle = { dataset: { corner:"se" }, addEventListener: (name, callback) => listeners.set(name, callback), setPointerCapture() {}, hasPointerCapture: () => true };
  const panel = { querySelectorAll: () => [handle], getBoundingClientRect: () => ({ left:100, top:100, width:560, height:600 }), classList: { add() {}, remove() {} } };
  const context = { panel, innerWidth:1280, innerHeight:900, chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: { set() { storedCount++; } } } } };
  vm.createContext(context); vm.runInContext(script, context);
  vm.runInContext("applyPanelPreferences = () => {}; enableResizing(panel)", context);
  listeners.get("pointerdown")({ button:0, clientX:660, clientY:700, pointerId:1, preventDefault() {} });
  listeners.get("pointermove")({ clientX:500, clientY:520, pointerId:1 });
  assert.equal(vm.runInContext("panelPreferences.width", context), 400);
  assert.equal(vm.runInContext("panelPreferences.height", context), 420);
  listeners.get("pointerup")(); assert.equal(storedCount, 1);
  listeners.get("keydown")({ key:"ArrowRight", shiftKey:true, preventDefault() {} });
  assert.equal(vm.runInContext("panelPreferences.width", context), 600);
  assert.equal(storedCount, 2);
});

test("manual captures preserve supplied translations and use the existing cloud schema", async () => {
  const helpers = await loadTypeScriptModule("../app/manual-entry-data.ts");
  const entry = { english:" Please draw one slip. ", japanese:" 1枚引いてください ", note:" 紙のくじを箱から引く場面 ", origin:"daily", sourceUrl:"", terms:[{ term:" draw   lots ", meaning:" くじを引く ", core_image:"引き出すイメージ", note:"手書きの説明" }] };
  const payload = helpers.buildManualCapture(entry);
  assert.equal(payload.p_original_text, "Please draw one slip.");
  assert.equal(payload.p_translation, "1枚引いてください");
  assert.equal(payload.p_machine_translation, null);
  assert.equal(payload.p_source_url, null);
  assert.equal(payload.p_subreddit, null);
  assert.equal(payload.p_source_title, "日常・自分用");
  assert.equal(payload.p_terms[0].term, "draw lots");
  assert.equal(payload.p_terms[0].core_image, "引き出すイメージ");
  assert.equal(payload.p_note, "紙のくじを箱から引く場面");
  const external = helpers.buildManualCapture({ ...entry, origin:"external", sourceUrl:"https://example.com/article", machineTranslation:"機械による元の訳" });
  assert.equal(external.p_translation, "1枚引いてください");
  assert.equal(external.p_machine_translation, "機械による元の訳");
  assert.equal(helpers.sentenceSourceLabel({ subreddit:null, source_title:external.p_source_title }), "外部から入力");
  assert.equal(helpers.sentenceSourceLabel({ subreddit:"r/English", source_url:"https://www.reddit.com/" }), "r/English");
  assert.equal(helpers.sentenceSourceLabel({ subreddit:null, source_url:"https://www.reddit.com/" }), "Reddit");
  assert.throws(() => helpers.buildManualCapture({ ...entry, sourceUrl:"javascript:alert(1)" }), /通常のWebページ/);
  assert.throws(() => helpers.buildManualCapture({ ...entry, english:" " }), /英文/);
  assert.throws(() => helpers.buildManualCapture({ ...entry, terms:[entry.terms[0], { ...entry.terms[0], term:"DRAW LOTS" }] }), /重複/);
  assert.throws(() => helpers.buildManualCapture({ ...entry, terms:[{ ...entry.terms[0], meaning:"" }] }), /意味/);
});

test("manual saving never calls translation and explicit translation supports both directions", async () => {
  const helpers = await loadTypeScriptModule("../app/manual-entry-data.ts");
  const values = new Map([
    ["phrase-nest-web-config", JSON.stringify({ projectUrl:"https://example.supabase.co", publishableKey:"test-key" })],
    ["phrase-nest-web-session", JSON.stringify({ access_token:"test-access", refresh_token:"test-refresh", expires_at:Math.floor(Date.now()/1000)+3600 })],
  ]);
  const calls = [];
  const browser = await loadTypeScriptModule("../app/supabase-browser.ts", {
    require: () => helpers, window: {}, localStorage: { getItem:key => values.get(key) || null },
    fetch: async (url, init) => {
      calls.push({ url, body:JSON.parse(init.body) });
      return new Response(JSON.stringify(url.includes("save_capture") ? { sentence_id:"saved-test", terms:[] } : { translation:"test translation", monthlyCharacters:20, monthlyLimit:450000 }));
    },
  });
  const entry = { english:"Please draw one slip.", japanese:"1枚引いてください", note:"", origin:"daily", sourceUrl:"", terms:[] };
  const result = await browser.saveManualEntry(entry);
  assert.equal(result.sentence_id, "saved-test");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/save_capture$/);
  assert.equal(calls[0].body.p_translation, entry.japanese);
  await browser.translateManualText("1枚引いてください", "ja", "en");
  assert.match(calls[1].url, /\/functions\/v1\/translate$/);
  assert.equal(calls[1].body.source, "ja"); assert.equal(calls[1].body.target, "en");
  await browser.translateManualText("Please draw one slip.", "en", "ja");
  assert.equal(calls[2].body.source, "en"); assert.equal(calls[2].body.target, "ja");
  await assert.rejects(browser.translateManualText(" ", "en", "ja"), /英文/);
  await assert.rejects(browser.translateManualText("a".repeat(5001), "en", "ja"), /5,000/);
  assert.equal(calls.length, 3);
});

test("manual form renders editable inputs without invoking paid services", async () => {
  let serviceCalls = 0;
  const entryModule = await loadTypeScriptModule("../app/manual-entry.tsx", { require: name => name === "./supabase-browser" ? { saveManualEntry() { serviceCalls++; }, translateManualText() { serviceCalls++; } } : nodeRequire(name) });
  const html = renderToStaticMarkup(createElement(entryModule.ManualEntryView, { onSaved() {}, onOpenLibrary() {}, onTranslation() {} }));
  assert.match(html, /入力して保存/);
  assert.match(html, /英語を日本語に翻訳/);
  assert.match(html, /日本語を英語に翻訳/);
  assert.match(html, /textarea id="manual-english"/);
  assert.match(html, /textarea id="manual-japanese"/);
  assert.match(html, /語句を追加/);
  assert.equal(serviceCalls, 0);
});

test("four primary destinations group saved content and retain direct links", async () => {
  const navigation = await loadTypeScriptModule("../app/navigation.ts");
  assert.equal(navigation.resolveTab("library", "notes"), "notes");
  assert.equal(navigation.resolveTab("library", "invalid"), "sentences");
  for (const tab of ["words", "sentences", "notes"]) {
    assert.equal(navigation.resolveTab(tab, "sentences"), tab);
    assert.equal(navigation.primaryTab(tab), "library");
  }
  for (const tab of ["menu", "organize", "settings"]) assert.equal(navigation.primaryTab(tab), "menu");
  assert.equal(navigation.resolveTab("unknown", "notes"), "today");
  const app = await loadTypeScriptModule("../app/learning-app.tsx", { require: name => name === "./navigation" ? navigation : name.startsWith(".") ? {} : nodeRequire(name) });
  const selections = [];
  const props = { tab:"notes", lastSavedTab:"notes", mobile:true, onSelect:tab => selections.push(tab) };
  const element = app.PrimaryNavigation(props);
  assert.equal(element.props.children.length, 4);
  element.props.children[2].props.onClick();
  assert.deepEqual(selections, ["notes"]);
  const html = renderToStaticMarkup(createElement(app.PrimaryNavigation, props));
  assert.equal((html.match(/<button /g) || []).length, 4);
  assert.match(html, /今日の復習/);
  assert.match(html, /aria-current="page"[^>]*>[\s\S]*?保存内容/);
  assert.doesNotMatch(html, /Codex整理|学習メモ|単語・熟語/);
  const savedHtml = renderToStaticMarkup(createElement(app.SavedContentNavigation, { tab:"notes", counts:{ sentences:2, words:3, notes:4 }, onSelect:props.onSelect }));
  assert.equal((savedHtml.match(/<button /g) || []).length, 3);
  assert.match(savedHtml, /英文/); assert.match(savedHtml, /単語・熟語/); assert.match(savedHtml, /学習メモ/);
  const menu = app.MenuView({ pendingCount:5, onSelect:props.onSelect });
  const options = menu.props.children[1].props.children;
  options[0].props.onClick(); options[1].props.onClick();
  assert.deepEqual(selections, ["notes", "organize", "settings"]);
  const menuHtml = renderToStaticMarkup(menu);
  assert.match(menuHtml, /未整理 5件/);
  assert.match(menuHtml, /設定/);
});
