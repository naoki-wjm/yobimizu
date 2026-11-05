// 呼び水 検索窓の確認（見本の置き場で）
// 実ブラウザ（headless の Chrome か Edge）を CDP で操作して確かめる。依存なし。Node 22 以上。
// 使い方: python reader/build_reader.py shelf/example の後に node reader/tests/browser_main.mjs
// ブラウザの場所が違う時は環境変数 CHROME で指定する。スクリーンショットは一時フォルダの shots/ に出る。
import { spawn } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, join, dirname } from "node:path";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
const url = pathToFileURL(resolve(process.argv[2] || join(REPO, "shelf", "example", "reader.html"))).href;
const port = 9333;
const chrome = spawn(BROWSER, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${join(sp, "prof-e2e")}`, "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const wait = new Map(); const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id) { wait.get(d.id)(d); wait.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.text + " " + (d.params.exceptionDetails.exception?.description || ""));
  if (d.method === "Log.entryAdded" && d.params.entry.level === "error") errors.push(d.params.entry.text);
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(JSON.stringify(d.params.args));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
await send("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch(() => {});

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "OK  " : "NG  "} ${name} ${ok ? "" : extra}`); };

await send("Page.navigate", { url }); await sleep(600);
check("開いた直後に案内", await ev(`document.querySelector('.landing') !== null && document.querySelector('.shelf-stat').textContent.includes('節 34')`));

// 打つと引ける（ハッシュは replace）
const before = await ev("history.length");
await ev(`(()=>{const i=document.getElementById('q');i.value='どこに作る';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await sleep(450);
check("打つだけで結果が出る", (await ev(`document.getElementById('status')?.textContent`)) === "2 件");
check("打ち始めで履歴が一つ積まれる", (await ev("history.length")) === before + 1);
const typed = await ev("history.length");
await ev(`(()=>{const i=document.getElementById('q');i.value='どこに作';i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(350);
await ev(`(()=>{const i=document.getElementById('q');i.value='どこに作る';i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(350);
check("打ち足しても履歴は増えない", (await ev("history.length")) === typed);
await ev("history.back()"); await sleep(300);
check("戻ると案内へ", await ev(`document.querySelector('.landing') !== null`));
await ev("history.forward()"); await sleep(300);
// 案内の絞り込み
await ev(`location.hash=''`); await sleep(200);
await ev(`[...document.querySelectorAll('.chip')].find(c=>c.textContent==='Windows PCシリーズ').focus();[...document.querySelectorAll('.chip')].find(c=>c.textContent==='Windows PCシリーズ').click()`); await sleep(250);
check("案内も絞り込まれる", (await ev(`document.querySelector('.shelf-stat').textContent`)).includes("題名 1 本") && (await ev(`document.querySelectorAll('.toc-title').length`)) === 1);
check("押したチップへフォーカスが戻る", (await ev(`document.activeElement.textContent`)) === "Windows PCシリーズ");
await ev(`[...document.querySelectorAll('.chip')].find(c=>c.dataset.key==='s'&&c.textContent==='全部').click()`); await sleep(200);
await ev(`location.hash='#q='+encodeURIComponent('どこに作る')`); await sleep(250);

// 変換中は引かない
await ev(`(()=>{const i=document.getElementById('q');i.dispatchEvent(new CompositionEvent('compositionstart'));i.value='ざざざ';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await sleep(450);
check("変換中は引かない", (await ev(`document.getElementById('status')?.textContent`)) === "2 件" && (await ev(`document.getElementById('q').value`)) === "ざざざ");
await ev(`(()=>{const i=document.getElementById('q');i.value='どこに作る';i.dispatchEvent(new CompositionEvent('compositionend'))})()`);
await sleep(300);

// 開く → 節 N で飛ぶ → 戻る
await ev(`document.getElementById('q').blur();[...document.querySelectorAll('.hit-title a')].find(a=>a.textContent.includes('7.')).click()`); await sleep(200);
check("開くと節 7 の本文", (await ev(`document.getElementById('doc-heading').textContent`)).startsWith("7."));
check("開いた見出しへフォーカス", (await ev(`document.activeElement.id`)) === "doc-heading");
check("開いている件に印", (await ev(`document.querySelector('.hit[aria-current=true] .hit-title').textContent`)).includes("7."));
await ev(`[...document.querySelectorAll('.doc a')].find(a=>a.textContent==='節 8').click()`); await sleep(200);
check("節 8 へ飛ぶ", (await ev(`document.getElementById('doc-heading').textContent`)).startsWith("8."));
check("検索語は残る", (await ev(`document.getElementById('q').value`)) === "どこに作る");
await ev("history.back()"); await sleep(300);
check("戻るで節 7", (await ev(`document.getElementById('doc-heading').textContent`)).startsWith("7."));

// 小段へ飛ぶ
await ev(`[...document.querySelectorAll('.doc a')].find(a=>a.textContent.includes('3-3')).click()`); await sleep(300);
check("節 3 の 3-3 へ飛び印が付く", await ev(`document.getElementById('step-3-3').classList.contains('step-flash')`));
check("ページ自体は動かない", (await ev("window.scrollY")) === 0);

// 反応
await ev(`document.querySelector('[data-react="部分的"]').click()`); await sleep(300);
const today = new Date(); const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
const expected = `- ${d} | どこに作る | コードさんと新しい企画を立ち上げる時の流れ | 節 3 | 部分的 |`;
check("反応の一行", (await ev(`document.getElementById('line').value`)) === expected, await ev(`document.getElementById('line').value`));
console.log("     コピーの案内:", await ev(`document.getElementById('line-note').textContent`));
check("押した印", (await ev(`document.querySelector('[data-react="部分的"]').getAttribute('aria-pressed')`)) === "true");
await ev(`document.querySelector('[data-react="役に立った"]').click()`); await sleep(200);
check("押し直すと作り直す", (await ev(`document.getElementById('line').value`)).includes("役に立った") && (await ev(`document.querySelectorAll('.react-line').length`)) === 1);

// 絞り込み
await ev(`[...document.querySelectorAll('.chip')].find(c=>c.textContent==='Windows PCシリーズ').click()`); await sleep(200);
check("絞り込みで 0 件の案内", (await ev(`document.getElementById('results').textContent`)).includes("絞り込みを外すと 2 件"));
await ev(`[...document.querySelectorAll('#results a')].find(a=>a.textContent==='絞り込みを外す').click()`); await sleep(200);
check("外すと戻る", (await ev(`document.getElementById('status')?.textContent`)) === "2 件");

// 出なかった
await ev(`(()=>{const i=document.getElementById('q');i.value='雛形のパス';document.getElementById('search').requestSubmit()})()`); await sleep(300);
check("出なかった", (await ev(`document.getElementById('results').textContent`)).includes("出ませんでした"));
check("開いていた節は閉じて紙面の案内に", await ev(`document.querySelector('#reader .paper-empty') !== null`));
check("出なかった一行", (await ev(`document.getElementById('line').value`)) === `- ${d} | 雛形のパス |  |  |  | 出なかった`);
await ev(`document.querySelector('[data-copy]').click()`); await sleep(200);
console.log("     コピーの案内:", await ev(`document.getElementById('line-note').textContent`));

// ハッシュからの攻撃文字列
await ev(`location.hash='#q='+encodeURIComponent('<img src=x onerror=window.__x=1>')`); await sleep(300);
check("検索語の HTML が動かない", (await ev(`window.__x===undefined && document.querySelector('#results img')===null`)));
await ev(`location.hash='#t='+encodeURIComponent('<img src=x onerror=window.__x=1>')+'&n=1&q='+encodeURIComponent('<svg onload=window.__x=2>')`); await sleep(300);
check("題名の HTML が動かない", (await ev(`window.__x===undefined && document.querySelector('#reader img,#reader svg')===null`)));
check("無い節の案内", (await ev(`document.getElementById('reader').textContent`)).includes("今の索引にありません"));
await ev(`location.hash='#t=x&n=abc'`); await sleep(200);
check("番号が数字でなくても落ちない", (await ev(`document.getElementById('reader').textContent`)).includes("今の索引にありません"));

// 行のどこを押しても開く
await ev(`location.hash='#q='+encodeURIComponent('二枚組')`); await sleep(300);
const hitAt = (sel) => `(()=>{document.querySelector('${sel}').scrollIntoView({block:'center'});const r=document.querySelector('${sel}').getClientRects()[0];return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)})()`;
check("要約の上も開くリンク", (await ev(`${hitAt('.hit .hit-summary')}.closest('a')?.closest('.hit-title') != null`)) === true);
check("札の上も開くリンク", (await ev(`${hitAt('.hit .where')}.closest('a')?.closest('.hit-title') != null`)) === true);
check("ぶら下がる節は自分のリンク", (await ev(`${hitAt('.children a')}.closest('a').closest('.children') != null`)) === true);
check("見出しに下線", (await ev(`getComputedStyle(document.querySelector('.hit-name')).textDecorationLine`)) === "underline");
// 文のまま引いて本文に印
await ev(`location.hash='#q='+encodeURIComponent('AGENTS.md の雛形はどこにあるか')+'&t='+encodeURIComponent('コードさんと新しい企画を立ち上げる時の流れ')+'&n=3'`); await sleep(300);
check("文で引いても本文の雛形に印", (await ev(`[...document.querySelectorAll('.doc mark')].some(m=>m.textContent==='雛形')`)) === true);

// 語尾の引き直し
await ev(`location.hash='#q='+encodeURIComponent('もふもふとは')`); await sleep(300);
check("語尾を落として引き直す", (await ev(`document.querySelector('.relaxed')?.textContent`) || "").includes("『もふもふ』で引きました"));
check("入力欄は打った言葉のまま", (await ev(`document.getElementById('q').value`)) === "もふもふとは");
await ev(`document.querySelector('#results .hit-title a').click()`); await sleep(250);
check("開いた本文に印", await ev(`document.querySelector('.doc mark') !== null`));
await ev(`document.querySelector('[data-react="部分的"]').click()`); await sleep(250);
check("反応の一行は打った言葉", (await ev(`document.getElementById('line').value`)).includes("| もふもふとは |"));
await ev(`location.hash='#q='+encodeURIComponent('ペンギンがいない')`); await sleep(300);
check("落としても出なければ出ない", (await ev(`document.getElementById('results').textContent`)).includes("出ませんでした"));

// 同じ質問は一行に、外れた語に下線
await ev(`location.hash='#q='+encodeURIComponent('bot に話しかけると遅い')`); await sleep(300);
const firstWhere = `document.querySelector('.hit .where')`;
check("同じ質問は一行にまとまる", (await ev(`${firstWhere}.querySelectorAll('br').length`)) === 0);
check("両方の語に印", (await ev(`${firstWhere}.querySelectorAll('mark').length`)) === 2);
check("外れた語に下線", (await ev(`getComputedStyle(document.querySelector('.absent-term')).textDecorationLine`)) === "underline");
let s2 = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(sp, "shots", "absent.png"), Buffer.from(s2.result.data, "base64"));

// 題字で検索を消して読み込み直す
await ev(`window.__before=1;document.getElementById('home').click()`); await sleep(700);
check("題字で読み込み直す", (await ev(`window.__before`)) === undefined);
check("検索が消える", (await ev(`document.getElementById('q').value`)) === "" && (await ev(`location.hash`)) === "");
check("案内に戻る", await ev(`document.querySelector('.landing') !== null`));
await ev(`window.__before=1;document.getElementById('home').click()`); await sleep(700);
check("検索がない時も読み込み直す", (await ev(`window.__before`)) === undefined);
await ev(`location.hash='#q='+encodeURIComponent('鯨')`); await sleep(200);

// 開いても閉じても、画面が動かない
const box = (sel) => `(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return [r.left,r.top,r.width].map(Math.round).join(',')})()`;
const paperH = `Math.round(document.getElementById('reader').getBoundingClientRect().height)`;
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await ev(`location.hash=''`); await sleep(300);
const closed = { h1: await ev(box('h1')), results: await ev(box('#results')), reader: await ev(box('#reader')), q: await ev(box('#q')), rH: await ev(paperH), filters: await ev(`document.querySelector('.filters').getBoundingClientRect().height`) };
check("閉じていても紙面に案内", (await ev(`document.querySelector('#reader .paper-empty')?.textContent`) || "").includes("マニュアル本体はここに出ます"));
check("検索窓と一覧の左端が揃う", closed.q.split(',')[0] === closed.results.split(',')[0], `${closed.q} ${closed.results}`);
await ev(`document.querySelector('.toc-title').click()`); await sleep(300);
for (const k of ['h1', 'results', 'reader', 'q']) check(`開いても ${k} が動かない`, (await ev(box(k === 'h1' ? 'h1' : '#' + k))) === closed[k], `${closed[k]} → ${await ev(box(k === 'h1' ? 'h1' : '#' + k))}`);
check("開いても紙の高さが同じ", (await ev(paperH)) === closed.rH);
check("開いてもチップの折り返しが同じ", (await ev(`document.querySelector('.filters').getBoundingClientRect().height`)) === closed.filters);
check("紙面が画面に収まる", await ev(`document.getElementById('reader').getBoundingClientRect().bottom <= innerHeight`));
check("広い画面では目次へ", (await ev(`document.querySelector('.close-row a').innerText.trim()`)) === "目次へ");
await ev(`document.querySelector('.close-row a').click()`); await sleep(250);
check("目次へ戻れる", await ev(`document.querySelector('.toc-heading') !== null`));
// 一本一行、説明はホバーで重ねて出す
const itemH = `Math.round(document.querySelector('.toc-item').getBoundingClientRect().height)`;
const titleTop = `Math.round(document.querySelector('.toc-title').getBoundingClientRect().top)`;
const dateTop = `Math.round(document.querySelector('.toc-date').getBoundingClientRect().top)`;
check("更新日が題名の横", Math.abs((await ev(titleTop)) - (await ev(dateTop))) < 8);
const h0 = await ev(itemH);
check("一本が一行の高さ", h0 < 40, String(h0));
check("説明は最初は見えない", (await ev(`getComputedStyle(document.querySelector('.toc-tip')).opacity`)) === "0");
const pt = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector('.toc-title').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})())`));
const scrollH0 = await ev(`document.getElementById('reader').clientWidth`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y }); await sleep(150);
check("ホバーで説明が出る", (await ev(`getComputedStyle(document.querySelector('.toc-tip')).opacity`)) === "1");
check("ホバーしても行の高さが同じ", (await ev(itemH)) === h0);
check("ホバーしても紙の幅が同じ", (await ev(`document.getElementById('reader').clientWidth`)) === scrollH0);
const s5 = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(sp, "shots", "toc-hover.png"), Buffer.from(s5.result.data, "base64"));
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 }); await sleep(100);
check("目次にまとまりの見出し", (await ev(`[...document.querySelectorAll('.toc-series')].map(e=>e.textContent).join('/')`)).includes("Windows PCシリーズ"));
check("どのまとまりにも入らない物は最後", (await ev(`[...document.querySelectorAll('.toc-series')].pop().textContent`)) === "どのまとまりにも入っていない物");
await ev(`document.querySelector('.toc-title').click()`); await sleep(250);
const s3 = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(sp, "shots", "stable-open.png"), Buffer.from(s3.result.data, "base64"));
await ev(`location.hash=''`); await sleep(300);
const s4 = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(sp, "shots", "stable-closed.png"), Buffer.from(s4.result.data, "base64"));
await send("Emulation.clearDeviceMetricsOverride");
await ev(`location.hash='#q='+encodeURIComponent('鯨')`); await sleep(200);

// 前後の節
const openSec = (n) => `location.hash='#q='+encodeURIComponent('鯨')+'&t='+encodeURIComponent('Windowsが再起動された後にやるべきルーチン')+'&n=${n}'`;
await ev(openSec(4)); await sleep(300);
check("前後の節: 真ん中は両方", await ev(`!!document.querySelector('.sec-nav-prev') && !!document.querySelector('.sec-nav-next')`));
await ev(`document.querySelector('.sec-nav').scrollIntoView({ block: 'center' })`); await sleep(100);
const navShot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(sp, "shots", "sec-nav.png"), Buffer.from(navShot.result.data, "base64"));
await ev(`document.querySelector('.sec-nav-next').click()`); await sleep(300);
check("前後の節: 次へで次の節が開く", (await ev(`document.getElementById('doc-heading').textContent`)).startsWith("5."));
check("前後の節: 開き直すと紙の先頭へ", (await ev(`document.getElementById('reader').scrollTop`)) === 0);
check("前後の節: 検索語を持ったまま", (await ev(`location.hash`)).includes(encodeURIComponent("鯨")));
await ev(`document.querySelector('.sec-nav-prev').click()`); await sleep(300);
check("前後の節: 前へで戻る", (await ev(`document.getElementById('doc-heading').textContent`)).startsWith("4."));
await ev(openSec(0)); await sleep(300);
check("前後の節: 最初は前がない", await ev(`!document.querySelector('.sec-nav-prev') && !!document.querySelector('.sec-nav-next')`));
await ev(`document.querySelector('details.toc')?.setAttribute('open','')`);
const lastSec = await ev(`[...document.querySelectorAll('details.toc a')].pop().getAttribute('href')`);
await ev(`location.hash=${JSON.stringify(lastSec)}`); await sleep(300);
check("前後の節: 最後は次がない", await ev(`!!document.querySelector('.sec-nav-prev') && !document.querySelector('.sec-nav-next')`));

// 単語で引く案内
await ev(`location.hash=''`); await sleep(200);
check("入力欄の案内", (await ev(`document.getElementById('q').placeholder`)).includes("単語で引く"));
check("開いた直後に案内", (await ev(`document.querySelector('.landing .search-hint')?.textContent`) || "").includes("単語で引いて"));
const egWords = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.landing li a')].map(a=>a.textContent))`));
check("例は単語が三つ", egWords.length === 3 && egWords.every((w) => [...w].length <= 9 && !/\s/.test(w)), egWords.join("／"));
check("例は横一列", await ev(`(() => { const t = [...document.querySelectorAll('.landing li')].map(li => li.getBoundingClientRect().top); return t.length === 3 && new Set(t).size < 3; })()`));
await ev(`location.hash='#q='+encodeURIComponent('オブシディアンを立ち上げるタイミング')`); await sleep(250);
check("出なかった時に案内", (await ev(`document.querySelector('#results .search-hint')?.textContent`) || "").includes("単語で引いて"));
await ev(`location.hash='#q='+encodeURIComponent('鯨')`); await sleep(200);

// 外への読み込みが無い
const res = await ev(`performance.getEntriesByType('resource').map(r=>r.name).join(',')`);
check("外部への読み込みなし", res === "", res);

// 狭い画面で横にはみ出さない
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });
await ev(`location.hash='#q='+encodeURIComponent('鯨')+'&t='+encodeURIComponent('Windowsが再起動された後にやるべきルーチン')+'&n=4'`); await sleep(400);
check("狭い画面: 開くと一覧は隠れる", (await ev(`getComputedStyle(document.getElementById('results')).display`)) === "none");
const over = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check("狭い画面: 横にはみ出さない", over <= 0, String(over));
let shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(sp, "shots", "mobile-open.png"), Buffer.from(shot.result.data, "base64"));
await ev(`document.querySelector('.close-row a').focus();document.querySelector('.close-row a').click()`); await sleep(300);
check("狭い画面: 閉じると開いていた件へフォーカス", (await ev(`document.activeElement.textContent`)).includes("4."), await ev(`document.activeElement.tagName`));
await ev(`window.scrollTo(0,150)`); await sleep(100);
const scrolledTo = await ev(`window.scrollY`);
await ev(`document.querySelector('#results .hit-title a').click()`); await sleep(300);
check("狭い画面: 開くと先頭へ", (await ev(`window.scrollY`)) === 0);
await ev(`document.querySelector('.close-row a').click()`); await sleep(300);
check("狭い画面: 閉じると元の位置へ", scrolledTo > 0 && (await ev(`window.scrollY`)) === scrolledTo, `${scrolledTo} ${await ev(`window.scrollY`)}`);
check("狭い画面: 一覧へ戻れる", (await ev(`getComputedStyle(document.getElementById('results')).display`)) !== "none");
check("狭い画面: 一覧も横にはみ出さない", (await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0);
shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(sp, "shots", "mobile-list.png"), Buffer.from(shot.result.data, "base64"));

// 暗い画面
await send("Emulation.clearDeviceMetricsOverride");
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await ev(`location.hash='#q='+encodeURIComponent('Docker')+'&t='+encodeURIComponent('Windowsが再起動された後にやるべきルーチン')+'&n=4'`); await sleep(400);
shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(sp, "shots", "dark.png"), Buffer.from(shot.result.data, "base64"));

check("画面の例外なし", errors.length === 0, errors.join(" / "));
console.log(`\n${pass} 通過 / ${fail} 不通過`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
