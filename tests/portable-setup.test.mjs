import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, cp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { packageExtension, validatePackageConfiguration } from "../scripts/package-extension.mjs";

async function load(file, globals={}) {
  const source = await readFile(new URL(file,import.meta.url),"utf8");
  const code = ts.transpileModule(source,{ compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports:{}, URL,URLSearchParams,Date,JSON,Error,Response,atob,process:{env:{}},...globals };
  vm.createContext(context); vm.runInContext(code,context); return context.exports;
}
const config = { projectUrl:"https://test-project.supabase.co", publishableKey:"sb_publishable_test", reviewUrl:"https://review.example/", requireAccess:true };
const jwt = role => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({role})).toString("base64url")}.signature`;

test("public bootstrap exposes only publishable fields and rejects admin keys", async () => {
  const module = await load("../app/public-configuration.ts");
  const result = module.publicConfigurationResponse(new Request("https://review.example/api/public-config"),{
    PHRASE_NEST_SUPABASE_URL:config.projectUrl, PHRASE_NEST_SUPABASE_PUBLISHABLE_KEY:config.publishableKey, GOOGLE_TRANSLATE_API_KEY:"never-serialize", OPENAI_API_KEY:"never-serialize", access_token:"never-serialize",
  });
  assert.deepEqual(await result.json(),{ projectUrl:config.projectUrl,publishableKey:config.publishableKey,requireAccess:true });
  assert.equal(result.headers.get("Cache-Control"),"no-store");
  for (const key of ["sb_secret_admin",jwt("service_role"),jwt("anon"),"bad"]) assert.equal(module.parsePublicConfiguration({...config,publishableKey:key}),null);
  assert.equal(module.isPublicApiKey(jwt("anon")),true);
  assert.equal(module.isPublicApiKey(jwt("service_role")),false);
  assert.equal(module.publicConfigurationResponse(new Request("https://review.example/",{method:"POST"}),{}).status,405);
});

test("a new PC bootstraps without pasted values, verifies approval, and never overwrites another project's session", async () => {
  const parsing = await load("../app/public-configuration.ts");
  let allowed=true, unavailable=false; const calls=[]; const values=new Map();
  values.set("phrase-nest-web-session",JSON.stringify({access_token:"private-session",refresh_token:"private-refresh",expires_at:Math.floor(Date.now()/1000)+3600}));
  const browser = await load("../app/supabase-browser.ts",{ window:{},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},require:name=>name==="./public-configuration"?parsing:{},fetch:async (url,init)=>{
    calls.push({url,init});
    if (url==="/api/public-config") return Response.json(config);
    if (unavailable) return Response.json({message:"missing"},{status:404});
    return Response.json(allowed);
  }});
  await browser.initializeSupabaseConfiguration();
  assert.equal(browser.getSupabaseConfiguration().projectUrl,config.projectUrl);
  assert.equal(values.has("phrase-nest-web-config"),false);
  assert.equal(await browser.verifyAppAccess(),true);
  assert.equal(calls[1].init.headers.Authorization,"Bearer private-session");
  assert.ok(calls.every(call=>call.url==="/api/public-config" || call.url.endsWith("/rpc/app_access_status")));
  allowed=false; assert.equal(await browser.verifyAppAccess(),false);
  unavailable=true; await assert.rejects(browser.verifyAppAccess(),/0008/);
  const other={projectUrl:"https://other-project.supabase.co",publishableKey:"sb_publishable_other"};
  const otherSession=JSON.stringify({access_token:"other-private-session"});
  const otherBrowser = await load("../app/supabase-browser.ts",{window:{},localStorage:{getItem:key=>key==="phrase-nest-web-config"?JSON.stringify(other):otherSession},require:name=>name==="./public-configuration"?parsing:{},fetch:async()=>Response.json(config)});
  await otherBrowser.initializeSupabaseConfiguration();
  assert.equal(otherBrowser.getSupabaseConfiguration().projectUrl,other.projectUrl);
  assert.equal(otherBrowser.getStoredSession().access_token,"other-private-session");
});

test("portable packages reuse a stable identity and include no private keys, login sessions or local files", async () => {
  const prefix=path.join(os.tmpdir(),"pn-package-test-"); const root=await mkdtemp(prefix);
  try {
    await cp(new URL("../extension/",import.meta.url),path.join(root,"extension"),{recursive:true});
    await writeFile(path.join(root,".env.local"),"GOOGLE_TRANSLATE_API_KEY=never-package-this");
    const first=packageExtension(root,{...config,access_token:"never-package-this",GOOGLE_TRANSLATE_API_KEY:"never-package-this"});
    const firstId=first.id;
    const second=packageExtension(root,config);
    assert.equal(firstId,second.id); assert.match(firstId,/^[a-p]{32}$/);
    assert.equal(second.redirectUrl,`https://${firstId}.chromiumapp.org/supabase`);
    const manifest=JSON.parse(await readFile(path.join(second.destination,"manifest.json"),"utf8"));
    assert.ok(manifest.key); assert.deepEqual(manifest.permissions,["storage","identity","activeTab","scripting"]);
    const preset=JSON.parse(await readFile(path.join(second.destination,"deployment-config.json"),"utf8"));
    assert.deepEqual(preset,config);
    const archive=await readFile(second.archive);
    assert.equal(archive.readUInt32LE(0),0x04034b50);
    assert.ok(!archive.includes(Buffer.from("never-package-this")));
    assert.ok(!archive.includes(Buffer.from("PRIVATE KEY")));
    assert.ok(!archive.includes(Buffer.from(".env.local")));
    if (process.platform === "win32") {
      const unpacked = execFileSync("tar.exe",["-xOf",second.archive,"deployment-config.json"],{encoding:"utf8",windowsHide:true});
      assert.deepEqual(JSON.parse(unpacked),config);
    }
    assert.throws(()=>validatePackageConfiguration({...config,publishableKey:jwt("service_role")}),/Publishable/);
    assert.throws(()=>validatePackageConfiguration({...config,reviewUrl:"https://review.example/#access_token=secret"}),/HTTPS/);
  } finally { if (!path.resolve(root).startsWith(path.resolve(prefix))) throw new Error("Unsafe test cleanup"); await rm(root,{recursive:true,force:true}); }
});

test("extension blocks paid calls before translation for an unapproved account and opens the configured review URL", async () => {
  const source=await readFile(new URL("../extension/service-worker.js",import.meta.url),"utf8");
  const calls=[], opened=[]; let approved=false;
  const stored={supabaseUrl:config.projectUrl,supabaseKey:config.publishableKey,requireAppAccess:true,reviewUrl:config.reviewUrl,phraseNestSession:{access_token:"private-token",refresh_token:"private-refresh",expires_at:Math.floor(Date.now()/1000)+3600}};
  const context={URL,Date,Error,fetch:async(url,init)=>{calls.push({url,init});return Response.json(url.endsWith("app_access_status")?approved:{translation:"訳"});},chrome:{storage:{local:{async get(){return stored;}}},commands:{onCommand:{addListener(){}}},runtime:{onInstalled:{addListener(){}},onMessage:{addListener(){}},async openOptionsPage(){}},tabs:{async create(item){opened.push(item.url);}}}};
  vm.createContext(context);vm.runInContext(source,context);
  const denied=await vm.runInContext("callFunction('translate',{text:'private text'})",context);
  assert.equal(denied.ok,false);assert.match(denied.error,/利用許可/);
  assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith("/rpc/app_access_status"));
  assert.ok(!calls[0].init.body.includes("private text"));
  approved=true;
  await vm.runInContext("authenticatedFetch('/functions/v1/translate',{method:'POST',body:'{}'})",context);
  assert.ok(calls.at(-1).url.endsWith("/functions/v1/translate"));
  await vm.runInContext("openLearningPage('library')",context);
  assert.equal(opened[0],"https://review.example/?tab=library");
  await vm.runInContext("openLearningPage('https://attacker.example')",context);
  assert.equal(opened.length,1);
});
