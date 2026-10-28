import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const files = ["manifest.json","service-worker.js","content-script.js","panel.css","common-expressions.js","conversation-patterns.js","options.html","options.js","options.css","launcher.html","launcher.js","launcher.css"];

export function validatePackageConfiguration(input) {
  const projectUrl = String(input.projectUrl || "").trim().replace(/\/$/, "");
  const publishableKey = String(input.publishableKey || "").trim();
  let review;
  try { review = new URL(input.reviewUrl); } catch { throw new Error("復習ページのURLを確認してください。"); }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(projectUrl)) throw new Error("Supabase Project URLを確認してください。");
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) throw new Error("Publishable keyだけを指定してください。管理用・翻訳用キーは使用できません。");
  if (review.protocol !== "https:" || review.username || review.password || review.search || review.hash) throw new Error("復習ページにはHTTPSのURLを指定してください。");
  return { projectUrl, publishableKey, reviewUrl:review.href, requireAccess:true };
}

export function extensionId(publicKey) {
  return createHash("sha256").update(Buffer.from(publicKey,"base64")).digest("hex").slice(0,32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value,16)));
}

// ZIP's stored format needs no dependency and can be unpacked by Windows/Chrome.
export function zipFiles(entries) {
  const chunks = [], directory = []; let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name), bytes = Buffer.from(content);
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let bit=0; bit<8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4); header.writeUInt16LE(0x800,6); header.writeUInt32LE(crc,14); header.writeUInt32LE(bytes.length,18); header.writeUInt32LE(bytes.length,22); header.writeUInt16LE(filename.length,26);
    chunks.push(header, filename, bytes);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(0x800,8); central.writeUInt32LE(crc,16); central.writeUInt32LE(bytes.length,20); central.writeUInt32LE(bytes.length,24); central.writeUInt16LE(filename.length,28); central.writeUInt32LE(offset,42);
    directory.push(central,filename); offset += header.length + filename.length + bytes.length;
  }
  const index = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10); end.writeUInt32LE(index.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,index,end]);
}

export function packageExtension(root, input) {
  const config = validatePackageConfiguration(input);
  const profile = path.join(root,".phrase-nest"); mkdirSync(profile,{ recursive:true });
  const identityPath = path.join(profile,"extension-identity.json");
  let publicKey;
  if (existsSync(identityPath)) publicKey = JSON.parse(readFileSync(identityPath,"utf8")).publicKey;
  else {
    // Only a public identity is needed for unpacked extensions. Discard the private
    // key immediately; there is no signing key or login token in this package.
    publicKey = generateKeyPairSync("rsa",{ modulusLength:2048 }).publicKey.export({ type:"spki", format:"der" }).toString("base64");
    writeFileSync(identityPath,JSON.stringify({ publicKey },null,2));
  }
  if (!publicKey || !/^[A-Za-z0-9+/=]+$/.test(publicKey)) throw new Error("保存済みの拡張機能IDを確認してください。");
  try { createPublicKey({key:Buffer.from(publicKey,"base64"),type:"spki",format:"der"}); } catch { throw new Error("保存済みの拡張機能IDが壊れています。"); }
  const destination = path.join(root,"outputs","phrasenest-extension"); mkdirSync(destination,{ recursive:true });
  const entries = [];
  for (const file of files) {
    const output = path.join(destination,file);
    copyFileSync(path.join(root,"extension",file),output);
    if (file === "manifest.json") {
      const manifest = JSON.parse(readFileSync(output,"utf8")); manifest.key = publicKey;
      writeFileSync(output,JSON.stringify(manifest,null,2)+"\n");
    }
    entries.push([file,readFileSync(output)]);
  }
  for (const [file,content] of [["deployment-config.json",JSON.stringify(config,null,2)+"\n"]]) {
    writeFileSync(path.join(destination,file),content); entries.push([file,Buffer.from(content)]);
  }
  const archive = path.join(root,"outputs","phrasenest-extension.zip"); writeFileSync(archive,zipFiles(entries));
  const id = extensionId(publicKey), redirectUrl = `https://${id}.chromiumapp.org/supabase`;
  writeFileSync(path.join(root,"outputs","extension-setup.txt"),`Chromeで解凍後のフォルダーを読み込み、Googleでログインしてください。\nSupabase Redirect URLsへ一度だけ追加：\n${redirectUrl}\n\n同じZIPを別PCでも使うと、IDと戻り先は変わりません。\n管理用キー・翻訳用キー・ログイントークンは含みません。\n`);
  return { destination, archive, id, redirectUrl };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL("../",import.meta.url));
  if (existsSync(path.join(root,".env.local"))) process.loadEnvFile(path.join(root,".env.local"));
  let config;
  if (process.argv.includes("--config-stdin")) {
    process.stdout.write("Ready for package configuration on stdin (input is hidden).\n");
    process.stdin.setEncoding("utf8"); let input="";
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    config = await new Promise((resolve,reject) => process.stdin.on("data",chunk => {
      input += chunk;
      if (/\r|\n/.test(input)) { if (process.stdin.isTTY) process.stdin.setRawMode(false); process.stdin.pause(); try { resolve(JSON.parse(input.trim())); } catch { reject(new Error("設定JSONの形式を確認してください。")); } }
    }));
  } else config = { projectUrl:process.env.NEXT_PUBLIC_SUPABASE_URL, publishableKey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, reviewUrl:process.env.PHRASE_NEST_REVIEW_URL };
  console.log(JSON.stringify(packageExtension(root,config)));
}
