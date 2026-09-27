import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  const [manifest, contentScript, panelCss, translateFunction, schema, packageJson] = await Promise.all([
    readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../extension/content-script.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/panel.css", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/translate/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/0001_initial_schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(manifest, /translate-selection/);
  assert.match(manifest, /Ctrl\+Shift\+Y/);
  assert.match(panelCss, /:host\(\[hidden\]\)\s*\{\s*display:\s*none\s*!important/);
  const openTranslator = contentScript.slice(contentScript.indexOf("async function openTranslator"), contentScript.indexOf("function createPanel"));
  assert.ok(openTranslator.indexOf("requestCloudTranslation") < openTranslator.indexOf("translateLocally"));
  assert.match(translateFunction, /monthlyLimit:\s*450000/);
  assert.match(translateFunction, /q:\s*items/);
  assert.match(schema, /create table public\.vocabulary_items/i);
  assert.match(schema, /create or replace function public\.save_capture/i);
  assert.match(schema, /reserve_cloud_translation/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
