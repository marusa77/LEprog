import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

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
  vm.runInContext("phraseNestHost = host", context);
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
