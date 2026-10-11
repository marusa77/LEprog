import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const nodeRequire = createRequire(import.meta.url);

test("calendar cells stay square and weekday labels track their responsive row height", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const buttonRule = css.match(/\.activity-week button\s*\{([^}]*)\}/)?.[1];
  assert.match(buttonRule, /aspect-ratio:\s*1\s*\/\s*1/);
  assert.match(buttonRule, /height:\s*auto/);
  assert.match(buttonRule, /min-height:\s*0/);
  assert.match(css, /\.activity-chart\s*\{[^}]*width:100%[^}]*max-width:300px/);
  assert.match(css, /\.activity-weekdays\s*\{[^}]*grid-template-rows:18px repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(css, /\.activity-week\s*\{[^}]*grid-template-rows:18px repeat\(7,auto\)/);
  assert.doesNotMatch(css, /grid-template-rows:18px repeat\(7,26px\)/);
});

test("learning activity uses Japanese midnight, Monday weeks and leap/year boundaries", async () => {
  const activity = await loadTypeScriptModule("../app/learning-activity.ts");
  assert.equal(activity.japanDateKey("2026-10-09T14:59:59Z"), "2026-10-09");
  assert.equal(activity.japanDateKey("2026-10-09T15:00:00Z"), "2026-10-10");
  assert.equal(activity.japanDateKey("invalid"), "");
  assert.equal(activity.shiftDateKey("2024-03-01", -1), "2024-02-29");
  assert.equal(activity.shiftDateKey("2026-01-01", -1), "2025-12-31");
  const range = activity.activityRange("2026-10-10");
  assert.equal(range.start, "2026-08-17");
  assert.equal(range.end, "2026-10-12");
  assert.equal(range.from, "2026-08-16T15:00:00.000Z");
  assert.equal(range.until, "2026-10-10T15:00:00.000Z");
  for (const today of ["2026-10-05", "2026-10-11", "2026-01-01"]) {
    const days = activity.buildActivityDays(today, [], []);
    assert.equal(days.length, 56);
    assert.equal(new Date(`${days[0].date}T00:00:00Z`).getUTCDay(), 1);
    assert.equal(days.filter(day => day.date === today).length, 1);
  }
});

test("activity counts saves once and reviews once per word per Japan day including forgotten answers", async () => {
  const activity = await loadTypeScriptModule("../app/learning-activity.ts");
  const sentences = [{ id:"s1", created_at:"2026-10-09T16:00:00Z", terms:Array(10).fill("word") }, { id:"s1", created_at:"2026-10-09T16:00:00Z" }, { id:"s2", created_at:"2026-10-10T03:00:00Z" }, { id:"bad", created_at:"bad" }, { id:"future", created_at:"2026-10-11T03:00:00Z" }];
  const reviews = [{ vocabulary_id:"w1", reviewed_at:"2026-10-09T14:59:59Z", result:"forgot" }, { vocabulary_id:"w1", reviewed_at:"2026-10-09T15:00:00Z", result:"forgot" }, { vocabulary_id:"w1", reviewed_at:"2026-10-10T01:00:00Z", result:"remembered" }, { vocabulary_id:"w2", reviewed_at:"2026-10-10T02:00:00Z", result:"uncertain" }];
  const days = activity.buildActivityDays("2026-10-10", sentences, reviews);
  const today = days.find(day => day.date === "2026-10-10");
  assert.equal(today.saves, 2); assert.equal(today.reviews, 2); assert.equal(today.total, 4); assert.equal(today.level, 2);
  assert.equal(days.find(day => day.date === "2026-10-09").reviews, 1);
  assert.equal(days.find(day => day.date === "2026-10-11").total, 0);
  assert.equal(days.find(day => day.date === "2026-10-11").future, true);
  assert.match(activity.activityDayLabel(today), /英文の保存 2件・復習 2語/);
  for (const [count, level] of [[0,0],[1,1],[2,2],[4,2],[5,3],[9,3],[10,4],[1000,4]]) assert.equal(activity.activityLevel(count), level);
});

test("calendar reads only ranged IDs/timestamps, pages all reviews, uses authentication and never writes or translates", async () => {
  const activity = await loadTypeScriptModule("../app/learning-activity.ts");
  const helpers = await loadTypeScriptModule("../app/manual-entry-data.ts");
  const values = new Map([
    ["phrase-nest-web-config", JSON.stringify({ projectUrl:"https://example.supabase.co", publishableKey:"test-key" })],
    ["phrase-nest-web-session", JSON.stringify({ access_token:"test-access", refresh_token:"test-refresh", expires_at:Math.floor(Date.now()/1000)+3600 })],
  ]);
  const calls = [];
  const browser = await loadTypeScriptModule("../app/supabase-browser.ts", {
    require:name => name === "./learning-activity" ? activity : helpers, window:{}, localStorage:{ getItem:key => values.get(key) || null },
    fetch:async (url, init) => {
      const parsed = new URL(url); calls.push({ parsed, init });
      if (parsed.pathname.endsWith("sentences")) return new Response(JSON.stringify([{ id:"saved", created_at:"2026-10-09T16:00:00Z" }]));
      const offset = Number(parsed.searchParams.get("offset"));
      return new Response(JSON.stringify(Array.from({ length:offset < 1000 ? 500 : 1 }, (_, index) => ({ vocabulary_id:`w${offset + index}`, reviewed_at:"2026-10-09T16:00:00Z" }))));
    },
  });
  const data = await browser.loadLearningActivity("2026-10-10");
  assert.equal(data.sentences.length, 1); assert.equal(data.reviews.length, 1001); assert.equal(calls.length, 4);
  assert.equal(activity.buildActivityDays("2026-10-10", data.sentences, data.reviews).find(day => day.date === "2026-10-10").reviews, 1001);
  for (const { parsed, init } of calls) {
    assert.equal(init.method, undefined); assert.equal(init.headers.Authorization, "Bearer test-access");
    assert.doesNotMatch(parsed.pathname, /functions|rpc/);
    const timestamp = parsed.pathname.endsWith("sentences") ? "created_at" : "reviewed_at";
    assert.equal(parsed.searchParams.getAll(timestamp)[0], "gte.2026-08-16T15:00:00.000Z");
    assert.equal(parsed.searchParams.getAll(timestamp)[1], "lt.2026-10-10T15:00:00.000Z");
    assert.equal(parsed.searchParams.get("select"), timestamp === "created_at" ? "id,created_at" : "vocabulary_id,reviewed_at");
  }
});

test("calendar renders selectable days, handles failure/retry and refreshes after saves/reviews and returning to the page", async () => {
  const activity = await loadTypeScriptModule("../app/learning-activity.ts");
  const hooks = []; let cursor = 0; let effects = []; let requests = [];
  const events = new Map(); const intervals = new Map();
  const fakeReact = {
    useState(initial) { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = typeof initial === "function" ? initial() : initial; return [hooks[slot], value => { hooks[slot] = typeof value === "function" ? value(hooks[slot]) : value; }]; },
    useMemo(callback) { return callback(); },
    useEffect(callback, deps) { const slot = cursor++; const old = hooks[slot]; if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) effects.push(() => { old?.cleanup?.(); hooks[slot] = { deps, cleanup:callback() }; }); },
  };
  const module = await loadTypeScriptModule("../app/activity-calendar.tsx", {
    window:{ setInterval(callback) { intervals.set(1, callback); return 1; }, clearInterval:id => intervals.delete(id), addEventListener:(name, callback) => events.set(name, callback), removeEventListener:name => events.delete(name) },
    document:{ visibilityState:"visible", addEventListener:(name, callback) => events.set(name, callback), removeEventListener:name => events.delete(name) },
    require:name => name === "react" ? fakeReact : name === "./learning-activity" ? activity : name === "./supabase-browser" ? { loadLearningActivity(today) { return new Promise((resolve, reject) => requests.push({ today, resolve, reject })); } } : nodeRequire(name),
  });
  function render(version = 0) { cursor = 0; effects = []; const tree = module.ActivityCalendar({ refreshVersion:version }); effects.forEach(effect => effect()); return tree; }
  function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || typeof node !== "object") return []; return [node, ...nodes(node.props?.children)]; }
  let tree = render();
  assert.match(renderToStaticMarkup(tree), /学習記録を読み込んでいます/);
  const today = requests[0].today;
  const data = { sentences:[{ id:"s", created_at:`${today}T10:00:00+09:00` }], reviews:[{ vocabulary_id:"w", reviewed_at:`${today}T11:00:00+09:00` }] };
  requests[0].resolve(data); await Promise.resolve(); tree = render();
  let html = renderToStaticMarkup(tree);
  assert.equal((html.match(/<button /g) || []).length, 56);
  assert.match(html, /aria-current="date"/); assert.match(html, /英文の保存 1件・復習 1語/); assert.match(html, /何が記録される/);
  const past = nodes(tree).find(node => node.type === "button" && !node.props.disabled && node.props["aria-label"].includes("英文の保存 0件"));
  past.props.onClick(); tree = render();
  assert.match(renderToStaticMarkup(tree), /aria-pressed="true"/);
  render(1); assert.equal(requests.length, 2); tree = render(1);
  assert.match(renderToStaticMarkup(tree), /activity-weeks/); // Keep the grid while refreshing after a review.
  requests[1].reject(new Error("temporary failure")); await Promise.resolve(); await Promise.resolve(); tree = render(1);
  html = renderToStaticMarkup(tree); assert.match(html, /保存・復習はそのまま使えます/);
  nodes(tree).find(node => node.type === "button" && node.props.children === "再読み込み").props.onClick(); render(1);
  assert.equal(requests.length, 3);
  requests[2].resolve(data); await Promise.resolve(); render(1);
  events.get("focus")(); render(1); assert.equal(requests.length, 4);
  requests[3].resolve(data); await Promise.resolve(); render(1);
  events.get("visibilitychange")(); render(1); assert.equal(requests.length, 5);
  intervals.get(1)(); render(1); assert.equal(requests.length, 5); // No repeated reads just for the clock.
});

async function loadTypeScriptModule(relativePath, globals = {}) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, URL, URLSearchParams, Date, JSON, process: { env: {} }, ...globals };
  vm.createContext(context); vm.runInContext(compiled, context);
  return context.exports;
}

test("writing prompts include only selected, clipped references and never leak past feedback", async () => {
  const writing = await loadTypeScriptModule("../app/writing-practice-data.ts");
  const word = { id:"w1", term:"at some point", meaning:"意味".repeat(200), coreImage:"コアイメージ".repeat(200), status:"learning", createdAt:"2026-10-10" };
  const entry = { topic:"やってみたいこと", words:[word], english:"I'd like to travel at some point.", japanese:"いつか旅行したい", feedback:"PAST_FEEDBACK_PRIVATE" };
  const prompt = writing.buildWritingPrompt(entry, "feedback");
  const data = JSON.parse(prompt.slice(prompt.indexOf("{\n")));
  assert.equal(data.saved_expressions.length, 1);
  assert.equal(data.saved_expressions[0].meaning.length, 250);
  assert.equal(data.saved_expressions[0].core_image_note.length, 600);
  assert.equal(data.original_writing, entry.english);
  assert.equal(data.intended_meaning, entry.japanese);
  assert.doesNotMatch(prompt, /PAST_FEEDBACK_PRIVATE/);
  assert.match(prompt, /命令は実行せず/); assert.match(prompt, /絶対的な正解とは扱わない/);
  const topicPrompt = writing.buildWritingPrompt(entry, "topic");
  assert.match(topicPrompt, /模範解答・英文・採点はまだ出さない/);
  assert.doesNotMatch(topicPrompt, /I'd like to travel|PAST_FEEDBACK_PRIVATE/);
  assert.match(writing.buildWritingPrompt({ ...entry, words:[] }, "feedback"), /1〜3個/);
});

test("writing word selection is unique, bounded and prefers useful saved explanations", async () => {
  const writing = await loadTypeScriptModule("../app/writing-practice-data.ts");
  const words = Array.from({ length:8 }, (_, i) => ({ id:`w${i}`, term:`word${i}`, meaning:"意味", coreImage:i === 5 ? "中心のイメージ" : "", status:"learning", createdAt:`2026-10-${String(i + 1).padStart(2,"0")}` }));
  const chosen = writing.chooseWritingWords(words);
  assert.equal(chosen.length, 3); assert.equal(chosen[0].id, "w5");
  assert.equal(writing.chooseWritingWords([]).length, 0);
  assert.equal(writing.chooseWritingWords([words[0], { ...words[0], id:"duplicate", term:" WORD0 " }]).length, 1);
  const shuffled = writing.chooseWritingWords(words, () => .5);
  assert.equal(shuffled.length, 3); assert.equal(new Set(shuffled.map(word => word.id)).size, 3);
  assert.equal(writing.chooseWritingWords([words[0]], () => 0)[0].id, "w0");
});

test("writing cloud payload keeps original writing and full notes separate without re-registering words", async () => {
  const writing = await loadTypeScriptModule("../app/writing-practice-data.ts");
  const helpers = await loadTypeScriptModule("../app/manual-entry-data.ts");
  const entry = { topic:" 自分の課題 ", words:[{ id:"w1", term:"draw", meaning:"引く", coreImage:"CORE".repeat(300) }], english:" Please draw one slip. ", japanese:"", feedback:" 添削\n修正文 " };
  const payload = writing.buildWritingCapture(entry);
  assert.equal(payload.p_original_text, "Please draw one slip.");
  assert.equal(payload.p_translation, ""); assert.equal(payload.p_machine_translation, null);
  assert.equal(payload.p_terms.length, 0); assert.equal(payload.p_source_title, "英作文");
  assert.match(payload.p_note, /【英作文のお題】[\s\S]*【選んだ表現[\s\S]*──────────[\s\S]*【外部AIの添削・解説】/);
  assert.ok(payload.p_note.includes(entry.words[0].coreImage));
  assert.ok(payload.p_note.includes("添削\n修正文"));
  assert.equal(helpers.sentenceSourceLabel({ subreddit:null, source_title:"英作文" }), "英作文");
  assert.throws(() => writing.buildWritingCapture({ ...entry, english:" " }), /作文/);
  assert.throws(() => writing.buildWritingCapture({ ...entry, words:[] }), /1〜3個/);
  assert.throws(() => writing.buildWritingCapture({ ...entry, english:"a".repeat(4001) }), /長すぎ/);
});

test("writing saves and updates the same authenticated record, never calls an AI or translation API", async () => {
  const writing = await loadTypeScriptModule("../app/writing-practice-data.ts");
  const values = new Map([
    ["phrase-nest-web-config", JSON.stringify({ projectUrl:"https://example.supabase.co", publishableKey:"test-key" })],
    ["phrase-nest-web-session", JSON.stringify({ access_token:"test-access", refresh_token:"test-refresh", expires_at:Math.floor(Date.now()/1000)+3600 })],
  ]);
  const calls = []; let empty = false;
  const browser = await loadTypeScriptModule("../app/supabase-browser.ts", {
    require:() => writing, window:{}, localStorage:{ getItem:key => values.get(key) || null },
    fetch:async (url, init) => {
      calls.push({ url:new URL(url), init, body:JSON.parse(init.body) });
      return new Response(JSON.stringify(init.method === "POST" ? { sentence_id:"saved", terms:[] } : empty ? [] : [{ id:"saved" }]));
    },
  });
  const entry = { topic:"日常", words:[{ id:"w1", term:"draw", meaning:"引く", coreImage:"" }], english:"Please draw one slip.", japanese:"", feedback:"" };
  assert.equal((await browser.saveWritingEntry(entry)).sentence_id, "saved");
  assert.equal((await browser.saveWritingEntry({ ...entry, feedback:"AIの解説" }, "saved")).sentence_id, "saved");
  assert.equal(calls.length, 2);
  assert.match(calls[0].url.pathname, /rpc\/save_capture$/); assert.equal(calls[0].body.p_terms.length, 0);
  assert.equal(calls[1].init.method, "PATCH"); assert.equal(calls[1].url.searchParams.get("id"), "eq.saved");
  assert.equal(calls[1].url.searchParams.get("source_title"), "eq.英作文");
  assert.deepEqual(Object.keys(calls[1].body).sort(), ["note", "translation", "updated_at"]);
  for (const call of calls) { assert.equal(call.init.headers.Authorization, "Bearer test-access"); assert.doesNotMatch(call.url.pathname, /functions|review|vocabulary/); }
  empty = true;
  await assert.rejects(browser.saveWritingEntry(entry, "saved"), /更新できませんでした/);
});

test("writing screen offers topic choices, editable feedback and copy instructions without paid services", async () => {
  const writing = await loadTypeScriptModule("../app/writing-practice-data.ts");
  let calls = 0;
  const ui = await loadTypeScriptModule("../app/writing-practice.tsx", { require:name => name === "./writing-practice-data" ? writing : name === "./supabase-browser" ? { saveWritingEntry() { calls++; } } : nodeRequire(name) });
  const html = renderToStaticMarkup(createElement(ui.WritingPracticeView, { words:[], sentences:[], onSaved() {}, onOpenLibrary() {}, onEditSentence() {} }));
  assert.match(html, /英作文の練習/); assert.match(html, /作文と指示文をコピー/);
  assert.match(html, /お題作成用の指示文をコピー/);
  assert.match(html, /id="writing-feedback"/); assert.match(html, /日本語訳・伝えたかったこと（任意）/);
  assert.match(html, /AI・翻訳APIは呼びません/); assert.match(html, /まず「入力して保存」/);
  assert.equal(calls, 0);
});

test("writing draft survives failures, copy errors and tab changes; feedback updates keep the original", async () => {
  const data = await loadTypeScriptModule("../app/writing-practice-data.ts");
  const hooks = []; let cursor = 0; let effects = []; const listeners = new Map();
  const requests = []; const copied = []; let refreshes = 0; let confirmResult = false; let copyingFails = false;
  const fakeReact = {
    useState(initial) { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = typeof initial === "function" ? initial() : initial; return [hooks[slot], value => { hooks[slot] = typeof value === "function" ? value(hooks[slot]) : value; }]; },
    useRef(initial) { const slot = cursor++; return hooks[slot] ||= { current:initial }; },
    useEffect(callback, deps) { const slot = cursor++; const old = hooks[slot]; if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) effects.push(() => { old?.cleanup?.(); hooks[slot] = { deps, cleanup:callback() }; }); },
  };
  const ui = await loadTypeScriptModule("../app/writing-practice.tsx", {
    Error, navigator:{ clipboard:{ async writeText(text) { if (copyingFails) throw new Error("denied"); copied.push(text); } } },
    window:{ addEventListener:(name, listener) => listeners.set(name, listener), removeEventListener:name => listeners.delete(name), confirm:() => confirmResult },
    require:name => name === "react" ? fakeReact : name === "./writing-practice-data" ? data : name === "./supabase-browser" ? { saveWritingEntry(entry, id) { return new Promise((resolve, reject) => requests.push({ entry, id, resolve, reject })); } } : nodeRequire(name),
  });
  function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || typeof node !== "object") return []; return [node, ...nodes(node.props?.children)]; }
  const words = [{ id:"w1", term:"at some point", meaning:"いつか", coreImage:"ある時点", status:"learning", createdAt:"2026-10-11" }];
  let tree;
  function render() { cursor = 0; effects = []; tree = ui.WritingPracticeView({ words, sentences:[], onSaved() { refreshes++; }, onOpenLibrary() {}, onEditSentence() {} }); effects.forEach(effect => effect()); return tree; }
  const byId = id => nodes(tree).find(node => node.props?.id === id);
  const button = text => nodes(tree).find(node => node.type === "button" && node.props.children === text);
  render(); render();
  byId("writing-english").props.onChange({ target:{ value:"I want to travel at some point." } });
  render(); byId("writing-japanese").props.onChange({ target:{ value:"いつか旅行したい" } }); render();
  await button("作文と指示文をコピー").props.onClick();
  await new Promise(resolve => setImmediate(resolve)); render();
  assert.ok(copied[0].includes("I want to travel at some point."));
  assert.ok(copied[0].includes("ある時点"));
  copyingFails = true; let selections = 0;
  const promptNode = nodes(tree).find(node => node.type === "textarea" && node.props["aria-label"] === "添削用のAIへの指示文と作文");
  promptNode.props.ref.current = { closest:() => ({ setAttribute() {} }), focus() {}, select() { selections++; } };
  await button("作文と指示文をコピー").props.onClick(); await new Promise(resolve => setImmediate(resolve)); render();
  assert.equal(selections, 1); assert.match(renderToStaticMarkup(tree), /Ctrl\+C/);
  let warned = false; listeners.get("beforeunload")({ preventDefault() { warned = true; } }); assert.equal(warned, true);
  const form = nodes(tree).find(node => node.type === "form");
  const failed = form.props.onSubmit({ preventDefault() {} });
  await form.props.onSubmit({ preventDefault() {} }); assert.equal(requests.length, 1);
  requests[0].reject(new Error("temporary save error")); await failed; render();
  assert.equal(byId("writing-english").props.value, "I want to travel at some point.");
  assert.match(renderToStaticMarkup(tree), /temporary save error/);
  const retry = nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  requests[1].resolve({ sentence_id:"s1", terms:[] }); await retry; render();
  assert.equal(byId("writing-english").props.readOnly, true); assert.equal(refreshes, 1);
  assert.equal(button("添削・メモの変更を保存").props.disabled, true);
  byId("writing-feedback").props.onChange({ target:{ value:"良い点と修正文。" } }); render();
  button("次の練習を始める").props.onClick(); render(); // Cancel preserves pending feedback.
  assert.equal(byId("writing-feedback").props.value, "良い点と修正文。");
  const update = nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(requests[2].id, "s1"); assert.equal(requests[2].entry.english, "I want to travel at some point.");
  requests[2].resolve({ sentence_id:"s1", terms:[] }); await update; render();
  assert.equal(refreshes, 2); assert.equal(button("添削・メモの変更を保存").props.disabled, true);
  warned = false; listeners.get("beforeunload")({ preventDefault() { warned = true; } }); assert.equal(warned, false);
  button("次の練習を始める").props.onClick(); render();
  assert.equal(byId("writing-english").props.value, ""); assert.equal(byId("writing-feedback").props.value, "");
  assert.equal(byId("writing-english").props.readOnly, false);
  const appSource = await readFile(new URL("../app/learning-app.tsx", import.meta.url), "utf8");
  assert.match(appSource, /hidden=\{tab !== "writing"\}/); // Keep the component mounted across navigation.
});

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
  assert.match(serviceWorker, /common-expressions\.js/);
  assert.match(serviceWorker, /conversation-patterns\.js/);
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

test("page capture uses temporary access without automatic scripts or all-site read permissions", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, "0.9.3");
  assert.ok(manifest.permissions.includes("activeTab")); assert.ok(manifest.permissions.includes("scripting"));
  assert.deepEqual(manifest.host_permissions, ["https://*.supabase.co/*"]);
  assert.equal(manifest.content_scripts, undefined);
  assert.ok(!manifest.permissions.includes("tabs"));
  assert.equal(manifest.web_accessible_resources[0].resources.length, 1);
  assert.equal(manifest.web_accessible_resources[0].resources[0], "panel.css");
  assert.deepEqual(manifest.web_accessible_resources[0].matches, ["https://*/*", "http://*/*"]);
});

test("shortcuts inject capture only when requested on Engoo, Reddit and other normal pages, then reuse it", async () => {
  const script = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  const installed = new Set(); const injections = []; const opens = []; let command;
  const context = { URL, chrome:{
    scripting:{ async executeScript(options) { injections.push(options); installed.add(options.target.tabId); } },
    tabs:{ async query() { return [{ id:1, url:"https://engoo.com/app/daily-news" }]; }, async sendMessage(id, message) { if (message.type === "PHRASE_NEST_READY") { if (!installed.has(id)) throw new Error("No listener"); return { ready:true }; } opens.push(id); return { ok:true }; } },
    commands:{ onCommand:{ addListener(listener) { command = listener; } } }, runtime:{ onInstalled:{ addListener() {} }, onMessage:{ addListener() {} } },
  } };
  vm.createContext(context);
  vm.runInContext(script, context);
  assert.equal(injections.length, 0); assert.equal(opens.length, 0);
  await command("unrelated-command"); assert.equal(injections.length, 0);
  await command("translate-selection");
  for (const [id, url] of [[2,"https://www.reddit.com/r/English/"],[3,"https://example.com/r/news"],[4,"http://localhost/article"]]) {
    context.tab = { id, url };
    assert.equal((await vm.runInContext("openPanel(tab)", context)).ok, true);
  }
  assert.equal(injections.length, 4); assert.equal(opens.length, 4);
  await command("translate-selection");
  assert.equal(injections.length, 4); assert.equal(opens.length, 5);
  for (const options of injections) {
    assert.deepEqual([...options.files], ["common-expressions.js", "conversation-patterns.js", "content-script.js"]);
    assert.equal(options.target.allFrames, undefined);
    assert.deepEqual(Object.keys(options.target), ["tabId"]);
  }
});

test("concurrent openings share one injection and failed injections can be retried", async () => {
  const script = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  let finishInjection; let injections = 0; let opens = 0; let ready = false; let fail = false;
  const context = { URL, chrome:{
    scripting:{ async executeScript() { injections++; if (fail) throw new Error("Cannot access contents of the page"); await new Promise(resolve => { finishInjection = resolve; }); ready = true; } },
    tabs:{ async sendMessage(id, message) { if (message.type === "PHRASE_NEST_READY") { if (!ready) throw new Error("No receiver"); return { ready:true }; } opens++; return { ok:true }; } },
    commands:{ onCommand:{ addListener() {} } }, runtime:{ onInstalled:{ addListener() {} }, onMessage:{ addListener() {} } },
  } };
  vm.createContext(context); vm.runInContext(script, context);
  const first = vm.runInContext('openPanel({ id:1, url:"https://engoo.com/app/daily-news" })', context);
  const second = vm.runInContext('openPanel({ id:1, url:"https://engoo.com/app/daily-news" })', context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(injections, 1); finishInjection();
  assert.equal((await first).ok, true); assert.equal((await second).ok, true); assert.equal(opens, 1);
  ready = false; fail = true;
  const failed = await vm.runInContext('openPanel({ id:2, url:"https://example.com/" })', context);
  assert.equal(failed.ok, false); assert.match(failed.error, /再読み込み/);
  fail = false;
  const retry = vm.runInContext('openPanel({ id:2, url:"https://example.com/" })', context);
  await new Promise(resolve => setImmediate(resolve)); finishInjection();
  assert.equal((await retry).ok, true); assert.equal(injections, 3);
});

test("restricted pages never inject and show an actionable error through shortcut and popup", async () => {
  const script = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  let command; let listener; let injected = 0; let menuOpened = 0; let message = "";
  const context = { URL, chrome:{
    action:{ async openPopup() { menuOpened++; } }, storage:{ session:{ async set(value) { message = value.phraseNestLaunchError; } } },
    scripting:{ async executeScript() { injected++; } }, tabs:{ async query() { return [{ id:1, url:"chrome://extensions/" }]; } },
    commands:{ onCommand:{ addListener(value) { command = value; } } }, runtime:{ onInstalled:{ addListener() {} }, onMessage:{ addListener(value) { listener = value; } } },
  } };
  vm.createContext(context); vm.runInContext(script, context);
  for (const url of ["chrome://settings/","chrome-extension://other/page.html","file:///C:/file.txt","about:blank","https://chromewebstore.google.com/detail/test","https://chrome.google.com/webstore/detail/test"]) {
    context.tab = { id:1, url }; assert.equal((await vm.runInContext("openPanel(tab)", context)).ok, false);
  }
  assert.equal((await vm.runInContext("openPanel(undefined)", context)).ok, false);
  await command("translate-selection"); assert.equal(menuOpened, 1); assert.match(message, /この画面では/);
  const response = await new Promise(resolve => { assert.equal(listener({ type:"OPEN_PANEL" }, {}, resolve), true); });
  assert.equal(response.ok, false); assert.match(response.error, /ウェブストア/); assert.equal(injected, 0);
});

test("the toolbar popup opens the current page and displays opening errors", async () => {
  const script = await readFile(new URL("../extension/launcher.js", import.meta.url), "utf8");
  const elements = new Map(); let closed = 0; let response = { ok:true };
  for (const id of ["#translate", "#settings", "#message"]) elements.set(id, { events:new Map(), addEventListener(name, callback) { this.events.set(name, callback); }, textContent:"" });
  const context = { URL, document:{ querySelector:id => elements.get(id), querySelectorAll:() => [] }, window:{ close() { closed++; } }, chrome:{
    storage:{ session:{ async get() { return { phraseNestLaunchError:"この画面では使えません" }; }, async remove() {} } },
    runtime:{ openOptionsPage() {}, async sendMessage(message) { assert.equal(message.type, "OPEN_PANEL"); return response; } },
  } };
  vm.createContext(context); vm.runInContext(script, context); await Promise.resolve();
  assert.match(elements.get("#message").textContent, /この画面/);
  await elements.get("#translate").events.get("click")(); assert.equal(closed, 1);
  response = { ok:false, error:"再読み込みしてください" };
  await elements.get("#translate").events.get("click")();
  assert.equal(closed, 1); assert.equal(elements.get("#translate").disabled, false); assert.match(elements.get("#message").textContent, /再読み込み/);
});

test("page capture acknowledges readiness and preserves the actual URL/title without mislabelling other sites as Reddit", async () => {
  const script = await readFile(new URL("../extension/content-script.js", import.meta.url), "utf8");
  let listener;
  const context = { URL, location:{ href:"https://engoo.com/app/daily-news/article" }, document:{ title:"Engoo article" }, chrome:{ runtime:{ onMessage:{ addListener(value) { listener = value; } } } } };
  vm.createContext(context); vm.runInContext(script, context);
  let acknowledged; listener({ type:"PHRASE_NEST_READY" }, {}, value => { acknowledged = value; }); assert.equal(acknowledged.ready, true);
  let metadata = vm.runInContext("pageSourceDetails()", context);
  assert.equal(metadata.p_subreddit, null); assert.equal(metadata.p_source_url, context.location.href); assert.equal(metadata.p_source_title, "Engoo article");
  context.location.href = "https://example.com/r/English";
  assert.equal(vm.runInContext("pageSourceDetails()", context).p_subreddit, null);
  context.location.href = "https://www.reddit.com/r/English/comments/test";
  assert.equal(vm.runInContext("pageSourceDetails()", context).p_subreddit, "r/English");
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

test("vocabulary additions use the append RPC, never a replacing PATCH or paid translation", async () => {
  const helpers = await loadTypeScriptModule("../app/manual-entry-data.ts");
  const values = new Map([
    ["phrase-nest-web-config", JSON.stringify({ projectUrl:"https://example.supabase.co", publishableKey:"test-key" })],
    ["phrase-nest-web-session", JSON.stringify({ access_token:"test-access", refresh_token:"test-refresh", expires_at:Math.floor(Date.now()/1000)+3600 })],
  ]);
  const calls = [];
  let missingMigration = false;
  const browser = await loadTypeScriptModule("../app/supabase-browser.ts", {
    Error, require:() => helpers, window:{}, localStorage:{ getItem:key => values.get(key) || null },
    fetch:async (url, init) => {
      calls.push({ url, method:init.method, body:JSON.parse(init.body) });
      return missingMigration ? new Response(JSON.stringify({ message:"Could not find the function public.append_vocabulary_details" }), { status:404 }) : new Response(JSON.stringify({ id:"word-id", core_image:"元の説明\n\n──────────\n【追記】\n\n追加の説明" }));
    },
  });
  const row = await browser.appendVocabularyDetails("word-id", { meaning:"", core_image:" 追加の説明 ", note:"" });
  assert.match(row.core_image, /元の説明[\s\S]*【追記】[\s\S]*追加の説明/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/append_vocabulary_details$/);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body.p_vocabulary_id, "word-id");
  assert.equal(calls[0].body.p_core_image, "追加の説明");
  assert.equal(calls[0].body.p_meaning, "");
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["p_core_image", "p_meaning", "p_note", "p_vocabulary_id"]);
  await assert.rejects(browser.appendVocabularyDetails("word-id", { meaning:" ", core_image:"", note:"" }), /追記する/);
  assert.equal(calls.length, 1);
  missingMigration = true;
  await assert.rejects(browser.appendVocabularyDetails("word-id", { meaning:"", core_image:"追加", note:"" }), /0004_append_vocabulary_details.sql/);
});

test("append dialog starts empty and migration preserves old explanations with duplicate checks", async () => {
  let services = 0;
  const app = await loadTypeScriptModule("../app/learning-app.tsx", { require:name => name.startsWith(".") ? {} : nodeRequire(name) });
  const html = renderToStaticMarkup(createElement(app.WordAppendDialog, { word:{ term:"draw" }, onClose() {}, onSave() { services++; } }));
  assert.match(html, /draw に説明を追記/); assert.match(html, /追加のコアイメージ/);
  assert.match(html, /追記を保存/); assert.match(html, /区切り線と【追記】/);
  assert.match(html, /<textarea[^>]*><\/textarea>/); assert.equal(services, 0);
  const migration = await readFile(new URL("../supabase/migrations/0004_append_vocabulary_details.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /\b(drop|delete|truncate)\b/i);
  assert.match(migration, /v_result := v_result \|\| v_separator \|\| v_block/);
  assert.match(migration, /if not exists/);
  assert.match(migration, /Duplicate check failed/); assert.match(migration, /Full-text check failed/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /where id = p_vocabulary_id and user_id = v_user_id/);
  assert.match(migration, /on conflict \(user_id, normalized_term\) do nothing/);
  assert.match(migration, /'details_appending', true/);
  const appendFunction = migration.slice(migration.indexOf("create or replace function public.append_vocabulary_details"), migration.indexOf("create or replace function public.save_capture"));
  assert.doesNotMatch(appendFunction, /occurrence_count\s*=|status\s*=|next_review_at\s*=/);
});

test("manual form clears only successful saves, supports consecutive entries and protects the next draft", async () => {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  const listeners = new Map();
  const calls = [];
  let resolveSave;
  let rejectSave;
  let focusCount = 0;
  let scrollCount = 0;
  let refreshCount = 0;
  let translationCalls = 0;
  let confirmed = 0;
  const fakeReact = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in hooks)) hooks[slot] = typeof initial === "function" ? initial() : initial;
      return [hooks[slot], value => { hooks[slot] = typeof value === "function" ? value(hooks[slot]) : value; }];
    },
    useRef(initial) { const slot = cursor++; return hooks[slot] ||= { current:initial }; },
    useEffect(callback, deps) {
      const slot = cursor++;
      const previous = hooks[slot];
      if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
        effects.push(() => { previous?.cleanup?.(); hooks[slot] = { deps, cleanup:callback() }; });
      }
    },
  };
  const module = await loadTypeScriptModule("../app/manual-entry.tsx", {
    Error,
    window:{ addEventListener:(name, callback) => listeners.set(name, callback), removeEventListener:name => listeners.delete(name), confirm() { confirmed++; return false; } },
    require:name => name === "react" ? fakeReact : name === "./supabase-browser" ? {
      saveManualEntry(entry) { calls.push(entry); return new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; }); },
      translateManualText() { translationCalls++; },
    } : nodeRequire(name),
  });
  function nodes(element) {
    if (Array.isArray(element)) return element.flatMap(nodes);
    if (!element || typeof element !== "object") return [];
    return [element, ...nodes(element.props?.children)];
  }
  let tree;
  const input = { getClientRects:() => [{}], focus() { focusCount++; }, scrollIntoView() { scrollCount++; } };
  const find = predicate => nodes(tree).find(predicate);
  function renderForm() {
    cursor = 0; effects = [];
    tree = module.ManualEntryView({ onSaved() { refreshCount++; }, onOpenLibrary() {}, onTranslation() {} });
    find(node => node.props?.id === "manual-english").props.ref.current = input;
    effects.forEach(effect => effect());
  }
  function fill(id, value) { find(node => node.props?.id === id).props.onChange({ target:{ value } }); renderForm(); }
  function submit() { return find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); }
  renderForm();
  fill("manual-english", "Please draw one slip."); fill("manual-japanese", "1枚引いてください"); fill("manual-note", "保存するメモ");
  find(node => node.type === "select").props.onChange({ target:{ value:"external" } }); renderForm();
  find(node => node.props?.type === "url").props.onChange({ target:{ value:"https://example.com/" } }); renderForm();
  find(node => node.type === "button" && node.props.children === "語句を追加").props.onClick(); renderForm();
  find(node => node.props?.placeholder === "例：draw lots").props.onChange({ target:{ value:"draw lots" } }); renderForm();
  find(node => node.props?.placeholder === "例：くじを引く").props.onChange({ target:{ value:"くじを引く" } }); renderForm();
  const first = submit(); renderForm();
  await submit(); assert.equal(calls.length, 1);
  assert.equal(find(node => node.type === "fieldset").props.disabled, true);
  resolveSave({ sentence_id:"first", terms:[{ existing:true }] }); await first; renderForm();
  for (const id of ["manual-english", "manual-japanese", "manual-note"]) assert.equal(find(node => node.props?.id === id).props.value, "");
  assert.equal(find(node => node.props?.type === "url").props.value, "");
  assert.equal(find(node => node.type === "select").props.value, "daily");
  assert.equal(find(node => node.props?.placeholder === "例：draw lots"), undefined);
  assert.equal(find(node => node.type === "fieldset").props.disabled, false);
  assert.match(renderToStaticMarkup(tree), /直前の英文を保存しました/);
  assert.match(renderToStaticMarkup(tree), /登録済みの語句 1件/);
  assert.match(renderToStaticMarkup(tree), /保存した英文を見る/);
  assert.equal(focusCount, 1); assert.equal(scrollCount, 1); assert.equal(refreshCount, 1);
  await submit(); assert.equal(calls.length, 1);
  let warned = false;
  const leaving = { preventDefault() { warned = true; }, returnValue:null };
  listeners.get("beforeunload")(leaving); assert.equal(warned, false);
  fill("manual-english", "Keep going."); fill("manual-japanese", "続けて。");
  listeners.get("beforeunload")(leaving); assert.equal(warned, true);
  find(node => node.type === "button" && node.props.children === "入力をクリア").props.onClick(); renderForm();
  assert.equal(confirmed, 1); assert.equal(find(node => node.props?.id === "manual-english").props.value, "Keep going.");
  const second = submit(); renderForm(); rejectSave(new Error("テスト接続エラー")); await second; renderForm();
  assert.equal(find(node => node.props?.id === "manual-english").props.value, "Keep going.");
  assert.equal(find(node => node.props?.id === "manual-japanese").props.value, "続けて。");
  assert.match(renderToStaticMarkup(tree), /テスト接続エラー/); assert.equal(focusCount, 1);
  const retry = submit(); renderForm(); resolveSave({ sentence_id:"second", terms:[] }); await retry; renderForm();
  assert.equal(find(node => node.props?.id === "manual-english").props.value, "");
  assert.equal(calls.length, 3); assert.equal(refreshCount, 2); assert.equal(focusCount, 2);
  assert.equal(calls[0].terms[0].term, "draw lots");
  assert.equal(calls[1].english, "Keep going."); assert.equal(translationCalls, 0);
});

test("four primary destinations group saved content and retain direct links", async () => {
  const navigation = await loadTypeScriptModule("../app/navigation.ts");
  assert.equal(navigation.resolveTab("library", "notes"), "notes");
  assert.equal(navigation.resolveTab("library", "invalid"), "sentences");
  for (const tab of ["words", "sentences", "notes"]) {
    assert.equal(navigation.resolveTab(tab, "sentences"), tab);
    assert.equal(navigation.primaryTab(tab), "library");
  }
  for (const tab of ["menu", "organize", "settings", "writing"]) assert.equal(navigation.primaryTab(tab), "menu");
  assert.equal(navigation.resolveTab("writing", "notes"), "writing");
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
  options[0].props.onClick(); options[1].props.onClick(); options[2].props.onClick();
  assert.deepEqual(selections, ["notes", "writing", "organize", "settings"]);
  const menuHtml = renderToStaticMarkup(menu);
  assert.match(menuHtml, /未整理 5件/);
  assert.match(menuHtml, /設定/);
});

test("Reddit panel folds secondary actions and closes its menu without losing the draft", async () => {
  const script = await readFile(new URL("../extension/content-script.js", import.meta.url), "utf8");
  const launcher = await readFile(new URL("../extension/launcher.html", import.meta.url), "utf8");
  const navigationMarkup = script.slice(script.indexOf('<nav class="pn-app-links"'), script.indexOf('</nav>'));
  assert.equal((navigationMarkup.split('<details')[0].match(/<button /g) || []).length, 3);
  assert.match(navigationMarkup, /<details id="pn-menu"/);
  assert.match(navigationMarkup, /<summary>メニュー<\/summary>/);
  assert.doesNotMatch(script, /class="pn-preferences"/);
  assert.equal((launcher.split('<details')[0].match(/<a data-tab=/g) || []).length, 3);
  assert.match(launcher, /data-tab="library"/);
  const elements = new Map();
  const documentEvents = new Map();
  const opened = [];
  let optionsCount = 0;
  let focusCount = 0;
  for (const name of ["capture", "review", "library", "words", "notes", "organize"]) elements.set(`#pn-open-${name}`, { events:new Map(), addEventListener(event, callback) { this.events.set(event, callback); } });
  const settings = { events:new Map(), addEventListener(event, callback) { this.events.set(event, callback); } };
  const menu = { ...settings, events:new Map(), open:true, querySelector:() => ({ focus() { focusCount++; } }) };
  elements.set("#pn-settings", settings); elements.set("#pn-menu", menu);
  const style = { setProperty(name, value) { this[name] = value; } };
  elements.set(".pn-panel", { style, getBoundingClientRect:() => ({ bottom:420 }) });
  elements.set(".pn-app-links", { getBoundingClientRect:() => ({ bottom:140 }) });
  elements.set("#pn-note", { value:"自分のメモ" });
  const root = { querySelector:selector => elements.get(selector) };
  const host = { shadowRoot:root, hidden:false };
  const context = { root, host, URL, document:{ addEventListener:(event, callback) => documentEvents.set(event, callback) }, window:{ open:url => opened.push(url) }, chrome:{ runtime:{ onMessage:{ addListener() {} }, openOptionsPage() { optionsCount++; } } } };
  vm.createContext(context); vm.runInContext(script, context);
  vm.runInContext('phraseNestHost = host; selectedPageText = "Keep going."; bindNavigationEvents(root)', context);
  menu.events.get("toggle")();
  assert.equal(style["--menu-max-height"], "268px");
  elements.get("#pn-open-library").events.get("click")();
  assert.equal(new URL(opened[0]).searchParams.get("tab"), "library");
  assert.equal(menu.open, false);
  for (const tab of ["words", "notes", "organize"]) {
    menu.open = true; elements.get(`#pn-open-${tab}`).events.get("click")();
    assert.equal(new URL(opened.at(-1)).searchParams.get("tab"), tab);
    assert.equal(menu.open, false);
  }
  menu.open = true;
  documentEvents.get("click")({ composedPath:() => [menu] }); assert.equal(menu.open, true);
  documentEvents.get("click")({ composedPath:() => [] }); assert.equal(menu.open, false);
  menu.open = true;
  context.escape = { key:"Escape", preventDefault() {} };
  vm.runInContext("handlePanelEscape(escape)", context);
  assert.equal(menu.open, false); assert.equal(host.hidden, false); assert.equal(focusCount, 1);
  vm.runInContext("handlePanelEscape(escape)", context); assert.equal(host.hidden, true);
  settings.events.get("click")(); assert.equal(optionsCount, 1);
  assert.equal(elements.get("#pn-note").value, "自分のメモ");
  assert.equal(vm.runInContext("selectedPageText", context), "Keep going.");
});
