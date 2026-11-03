// 呼び水 絞り込みの開閉型の確認（読み手 8 人の合成の置き場で）
// 実ブラウザ（headless の Chrome か Edge）を CDP で操作して確かめる。依存なし。Node 22 以上。
// 使い方: node reader/tests/browser_filters.mjs
// ブラウザの場所が違う時は環境変数 CHROME で指定する。スクリーンショットは一時フォルダの shots/ に出る。
import { spawn, execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, join, dirname } from "node:path";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const CANDIDATES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const BROWSER = CANDIDATES.find((p) => existsSync(p));
if (!BROWSER) { console.error("Chrome か Edge が見つかりません。環境変数 CHROME で指定してください"); process.exit(2); }
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sp = mkdtempSync(join(tmpdir(), "yobimizu-browser-"));
mkdirSync(join(sp, "shots"));
const shelf = join(sp, "many-shelf"); rmSync(shelf, { recursive: true, force: true }); mkdirSync(join(shelf, "manuals"), { recursive: true });
const readers = ["受付の人", "新しく入った人", "遅番の人", "事務の人", "応援の人", "管理の人", "店頭の人", "倉庫の人"];
readers.forEach((r, i) => writeFileSync(join(shelf, "manuals", `手順${i}.md`), `---\ntitle: 手順${i}\ncreated: 2026-01-01\nsummary: 手順${i} の要約\nquestions:\n  - 鍵はどこにあるか → 節 0\nreaders: [${r}]\nseries: 束${i % 3}\n---\n\n## 0. 前提\n\n本文 ${i}\n`));
execFileSync(process.env.PYTHON || "python", [join(REPO, "reader", "build_reader.py"), shelf], { stdio: "ignore" });
const url = pathToFileURL(join(shelf, "reader.html")).href;
const port = 9335;
const chrome = spawn(BROWSER, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${join(sp, "prof-f")}`, "--window-size=1280,800", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const wait = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) { wait.get(d.id)(d); wait.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result.result.value;
let fail = 0, pass = 0;
const check = (n, ok, x = "") => { ok ? pass++ : fail++; console.log(`${ok ? "OK" : "NG"} ${n} ${ok ? "" : x}`); };
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(sp, "shots", name + ".png"), Buffer.from(s.result.data, "base64")); };
await send("Page.enable"); await send("Page.navigate", { url }); await sleep(600);
check("既定は畳まれている", await ev(`document.querySelector('.filter-box') !== null && !document.querySelector('.filter-box').open`));
check("題名は見出しの案内", (await ev(`document.querySelector('.filter-box summary').textContent`)) === "検索オプション（読み手、まとまりでの絞り）");
await shot("filters-closed");
await ev(`document.querySelector('.filter-box summary').click()`); await sleep(150);
check("開ける", await ev(`document.querySelector('.filter-box').open`));
await ev(`location.hash='#q='+encodeURIComponent('鍵')`); await sleep(250);
check("結果を作り直しても開いたまま", await ev(`document.querySelector('.filter-box').open`));
await ev(`[...document.querySelectorAll('.chip')].find(c=>c.textContent==='遅番の人').focus();[...document.querySelectorAll('.chip')].find(c=>c.textContent==='遅番の人').click()`); await sleep(250);
check("絞れる", (await ev(`document.getElementById('status').textContent`)) === "1 件");
check("目次も絞り込まれる", (await ev(`document.querySelectorAll('.toc-title').length`)) === 1);
check("押したチップにフォーカス", (await ev(`document.activeElement.textContent`)) === "遅番の人");
await shot("filters-open");
await ev(`document.querySelector('.filter-box summary').click()`); await sleep(150);
await ev(`location.hash=location.hash+'&t='+encodeURIComponent('手順2')+'&n=0'`); await sleep(250);
check("閉じたら閉じたまま", await ev(`!document.querySelector('.filter-box').open`));
check("畳んでいても絞り込み中が見える", (await ev(`document.querySelector('.filter-now').textContent`)).includes("遅番の人"));
await shot("filters-active-closed");
await send("Page.navigate", { url: url + "#q=" + encodeURIComponent("鍵") + "&r=" + encodeURIComponent("遅番の人") }); await sleep(100);
await send("Page.reload"); await sleep(500);
check("URL で絞り込み中なら最初から開く", await ev(`document.querySelector('.filter-box').open`));
console.log(`${pass} 通過 / ${fail} 不通過`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
