// 検索の芯と描画の検品。node --test reader/tests/test_core.mjs で動く（開発の時だけ node を使う）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../template.html", import.meta.url), "utf8");
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
vm.runInThisContext(script); // document が無いので芯だけ読んで戻る
const Y = globalThis.YOBIMIZU;

function entry(over) {
  return Object.assign({
    title: "題", number: 1, heading: "見出し", body: "", summary: "", readers: [], series: [], related: [],
    created: "2026-01-01", updated: "2026-01-01", entrance: false, aliases: [], questions: [],
    targeted_questions: [], kari: 0, kuuran: 0, fuda: [], record_line: "", records: [],
  }, over);
}
const door = (over) => entry(Object.assign({ number: 0, heading: "前提", entrance: true }, over));

test("開いた直後の例: 別名の短い語だけ、一本から一つずつ順に、無ければ出さない", () => {
  const a = door({ title: "甲", aliases: ["鯨", "九文字ちょうどです", "十文字ちょうどですよ", "Docker が起動しない"] });
  const b = door({ title: "乙", aliases: ["毛繕い"] });
  const c = door({ title: "丙", aliases: [] });
  const section = entry({ title: "甲", aliases: ["節の別名"] });
  const words = Y.exampleWords([a, b, c, section], 2);
  assert.equal(words.length, 2);
  assert.ok(words.includes("毛繕い"), "一本目から二つ取る前に、次の本へ回る");
  assert.ok(words.every((w) => ["鯨", "九文字ちょうどです", "毛繕い"].includes(w)), words.join("／"));
  assert.deepEqual(Y.exampleWords([a, b, c], 3).sort(), ["九文字ちょうどです", "毛繕い", "鯨"].sort());
  assert.deepEqual(Y.exampleWords([c], 3), []);
});

test("全角英数と大文字を揃える。かなは揃えない", () => {
  assert.equal(Y.norm("ＤｏｃＫＥＲ１"), "docker1");
  assert.equal(Y.norm("カナ").includes("かな"), false);
  const entries = [entry({ body: "Docker を使う" })];
  assert.equal(Y.search(entries, "ＤＯＣＫＥＲ").total, 1);
  assert.equal(Y.search(entries, "どっかー").total, 0);
});

test("空白は半角も全角も区切り、同じ語は一つに", () => {
  assert.deepEqual(Y.splitTerms("雛形　パス  雛形").map((t) => t.raw), ["雛形", "パス"]);
  assert.equal(Y.search([entry({ body: "x" })], "   ").total, 0);
});

test("OR: 語の多い順に並び、含まれなかった語が残る", () => {
  const entries = [
    entry({ number: 1, heading: "雛形の話" }),
    entry({ number: 2, heading: "雛形とパスの話" }),
  ];
  const found = Y.search(entries, "雛形 パス");
  assert.deepEqual(found.main.map((c) => c.entry.number), [2, 1]);
  assert.deepEqual(found.main[1].absent, ["パス"]);
  assert.deepEqual(found.main[0].absent, []);
});

test("重さ: 宛先付きの質問 > ファイルの言葉 > 見出し > 本文", () => {
  const entries = [
    door({ title: "入口の", aliases: ["語"] }),
    entry({ title: "質問の", number: 1, targeted_questions: ["語は何か"] }),
    entry({ title: "見出しの", number: 1, heading: "語の話" }),
    entry({ title: "本文の", number: 1, body: "語がある" }),
  ];
  const found = Y.search(entries, "語");
  assert.deepEqual(found.main.map((c) => c.entry.title), ["質問の", "入口の", "見出しの"]);
  assert.deepEqual(found.body.map((c) => c.entry.title), ["本文の"]);
});

test("二段: ファイルの当たりの下に節がぶら下がる。宛先付きは独立", () => {
  const entries = [
    door({ aliases: ["語"] }),
    entry({ number: 1, body: "語" }),
    entry({ number: 2, heading: "語" }),
    entry({ number: 3, targeted_questions: ["語？"] }),
  ];
  const found = Y.search(entries, "語");
  assert.deepEqual(found.main.map((c) => [c.type, c.entry.number]), [["section", 3], ["door", 0]]);
  assert.deepEqual(found.main[1].children.map((c) => c.entry.number), [2, 1]);
  assert.equal(found.total, 4);
});

test("入口なしなら節だけで出る。本文だけは下へ", () => {
  const entries = [door({ body: "語" }), entry({ number: 1, heading: "語" })];
  const found = Y.search(entries, "語");
  assert.deepEqual(found.main.map((c) => c.entry.number), [1]);
  assert.deepEqual(found.body.map((c) => [c.type, c.entry.number]), [["section", 0]]);
});

test("summary の当たりは入口だけ。全節に広がらない", () => {
  const entries = [door({ summary: "語" }), entry({ number: 1, summary: "語" }), entry({ number: 2, summary: "語" })];
  const found = Y.search(entries, "語");
  assert.equal(found.total, 1);
  assert.equal(found.main[0].type, "door");
});

test("ぶら下がる節の語も入口の語の数に入る", () => {
  const entries = [door({ aliases: ["甲"] }), entry({ number: 1, body: "乙" })];
  const card = Y.search(entries, "甲 乙 丙").main[0];
  assert.equal(card.matched, 2);
  assert.deepEqual(card.absent, ["丙"]);
});

test("絞り込み", () => {
  const entries = [entry({ title: "甲", heading: "語", readers: ["人"], series: ["束"] }), entry({ title: "乙", heading: "語", readers: ["機"] })];
  assert.equal(Y.search(entries, "語", { reader: "人" }).total, 1);
  assert.equal(Y.search(entries, "語", { series: "束" }).main[0].entry.title, "甲");
  assert.equal(Y.search(entries, "語", { reader: "無" }).total, 0);
});

test("絞り込みの開閉型は、どちらかの選択肢が 6 以上の時だけ", () => {
  assert.equal(Y.collapseFilters(4, 2), false); // 今の見本
  assert.equal(Y.collapseFilters(5, 5), false);
  assert.equal(Y.collapseFilters(6, 0), true);
  assert.equal(Y.collapseFilters(1, 6), true);
});

test("同点は updated の新しい順", () => {
  const entries = [entry({ title: "古", heading: "語", updated: "2026-01-01" }), entry({ title: "新", heading: "語", updated: "2026-02-01" })];
  assert.equal(Y.search(entries, "語").main[0].entry.title, "新");
});

test("反応の一行は format.md 7 節の形", () => {
  assert.equal(Y.reactionLine("2026-01-05", "語", "題", 3, "部分的"), "- 2026-01-05 | 語 | 題 | 節 3 | 部分的 |");
  assert.equal(Y.noHitLine("2026-01-07", "語"), "- 2026-01-07 | 語 |  |  |  | 出なかった");
  assert.equal(Y.noHitLine("2026-01-07", "a|b  c"), "- 2026-01-07 | a b c |  |  |  | 出なかった");
});

test("日付は手元の暦（UTC にずらさない）", () => {
  assert.equal(Y.today(new Date(2026, 0, 2, 0, 30)), "2026-01-02");
});

const lookup = Y.buildLookup([
  door({ title: "本", aliases: ["旧題"] }),
  entry({ title: "本", number: 7 }),
  door({ title: "別" }),
  entry({ title: "別", number: 3 }),
]);
const ctx = (terms = []) => ({ terms, lookup, title: "本", state: { q: "語" } });
const render = (md) => Y.renderBody(md, ctx());

test("文字は必ず逃がす（本文に HTML を書かれても動かない）", () => {
  const out = render('<img src=x onerror="alert(1)"> **<b>太</b>**\n\n`<code>`\n\n| <a> | b |\n|---|---|\n| <i> | c |\n\n> <q>\n\n- <li>\n\n~~~\n<pre>\n~~~');
  for (const raw of ["<img", "<b>", "<a>", "<i>", "<q>", "<li><li>", "<pre>\n"]) assert.equal(out.includes(raw), false, raw);
  assert.ok(out.includes("&lt;img"));
});

test("リンクは http(s) だけ", () => {
  assert.ok(render("[a](https://example.com/x)").includes('href="https://example.com/x"'));
  assert.equal(render("[a](javascript:alert(1))").includes("href"), false);
});

test("節 N はある節だけリンクに。小段も指せる", () => {
  assert.ok(render("（節 7）").includes("<a href="));
  assert.equal(render("（節 8）").includes("<a href="), false);
  assert.ok(render("節 7 の 7-3-1").includes("m=7-3-1"));
  assert.equal(render("季節 7").includes("<a href="), false);
});

test("[[題名]]: ある物は入口へ、節も指せる、旧題名は aliases で辿る、無い物は（未作成）", () => {
  assert.ok(render("[[別]]").includes("n=0"));
  assert.ok(render("[[別]] の節 3").includes("n=3"));
  assert.ok(render("[[別]] の節 3").includes("節 3</a>"));
  assert.ok(render("[[旧題]]").includes("<a href="));
  const missing = render("[[無い]]");
  assert.ok(missing.includes("（未作成）"));
  assert.equal(missing.includes("<a href="), false);
});

test("印の色分けと札と小段", () => {
  assert.ok(render("〔仮: 理由〕").includes('class="kari"'));
  assert.ok(render("〔空欄: 無い〕").includes('class="blank"'));
  assert.ok(render("〔資料: 名前〕").includes('class="source"'));
  assert.ok(render("注意: 気を付ける").includes('class="fuda fuda-注意"'));
  assert.ok(render("- 済んだ合図: 見える").includes("fuda-済んだ合図"));
  assert.ok(render("- 3-4a. する").includes('id="step-3-4a"'));
  assert.equal(render("文の途中の注意: は札ではない").includes("fuda"), false);
});

test("箇条書きの入れ子と、番号なし・番号ありの混在", () => {
  const out = render("- 甲\n  - 乙\n    - 丙\n- 丁\n\n1. 一\n2. 二");
  assert.equal((out.match(/<ul>/g) || []).length, 3);
  assert.ok(out.includes("<ol><li>一</li><li>二</li></ol>"));
  assert.ok(out.indexOf("丙") < out.indexOf("丁"));
});

test("囲いの中は描かない・中の ``` で閉じない", () => {
  const out = render("~~~\n```\n**太**\n```\n節 7\n~~~\n後");
  assert.ok(out.includes("**太**"));
  assert.equal(out.includes("<strong>"), false);
  assert.equal(out.includes("<a href"), false);
  assert.ok(out.includes("<p>後</p>"));
});

test("閉じない囲いは文章のまま。行が消えない", () => {
  const out = render("~~~\n中\n\n節 7");
  assert.ok(out.includes("~~~"));
  assert.ok(out.includes("中"));
  assert.ok(out.includes("<a href"));
});

test("~~~ の後ろに文章があれば囲いではない", () => {
  for (const line of ["~~~だよ、と言った", "~~~ 大事な一文"]) {
    const out = render(`${line}\n\n後\n\n~~~\n中\n~~~`);
    assert.ok(out.includes(line), line);
    assert.ok(out.includes("<p>後</p>"), line);
  }
  assert.ok(render("~~~python\n中\n~~~").includes("<pre>"));
});

test("箇条書きの中の囲いはコードのまま。空行があっても後ろを飲まない", () => {
  const out = render("- 項目\n  ~~~\n  **太**\n\n  二行目\n  ~~~\n\n後の段落と節 7");
  assert.ok(out.includes("**太**"));
  assert.equal(out.includes("<strong>"), false);
  assert.ok(out.includes("<pre><code>**太**\n\n二行目</code></pre>"));
  assert.ok(out.includes("<p>後の段落と"));
  assert.ok(out.includes("<a href"));
});

test("番号付きの一覧は書かれた番号から", () => {
  assert.ok(render("3. 三\n4. 四").includes('<ol start="3">'));
  assert.ok(render("1. 一\n\n間の文\n\n2. 二").includes('<ol start="2">'));
  assert.equal(render("1. 一\n2. 二").includes("start"), false);
});

test("顔文字の ` は消えず、間がコードにならない", () => {
  const out = render("(´･ω･`) と (´･ω･`)");
  assert.equal((out.match(/`/g) || []).length, 2);
  assert.equal(out.includes("<code>"), false);
  assert.ok(render("`コード` と (´･ω･`)").includes("<code>コード</code>"));
});

test("表の中の [[題|名]] と `a|b` で列がずれない", () => {
  const out = render("| 甲 | 乙 |\n|---|---|\n| [[別|名前]] | `a|b` |");
  assert.equal((out.match(/<td>/g) || []).length, 2);
  assert.ok(out.includes(">名前</a>"));
  assert.ok(out.includes("<code>a|b</code>"));
});

test("URL の後ろの括弧や句点は入れない。URL の中の括弧は残す", () => {
  assert.ok(render("(https://example.com/x)").includes('href="https://example.com/x"'));
  assert.ok(render("(https://example.com/x)").includes("</a>)"));
  assert.ok(render("https://example.com/a_(b)").includes('href="https://example.com/a_(b)"'));
});

test("コード・リンクの中の語にも印が付く", () => {
  const terms = Y.splitTerms("語");
  assert.ok(Y.renderBody("`語`", ctx(terms)).includes("<code><mark>語</mark></code>"));
  assert.ok(Y.renderBody("[[語の題]]", ctx(terms)).includes("<mark>語</mark>"));
  assert.ok(Y.renderBody("https://example.com/語", ctx(terms)).includes("<mark>語</mark>"));
});

test("表", () => {
  const out = render("| 甲 | 乙 |\n|---|---|\n| 丙 | 節 7 |");
  assert.ok(out.includes("<th>甲</th>"));
  assert.ok(out.includes("<td>丙</td>"));
  assert.ok(out.includes("<a href"));
});

test("当たった語を本文で mark。大文字小文字を越えて、元の字のまま", () => {
  const out = Y.renderBody("Docker と〔仮: docker〕", ctx(Y.splitTerms("DOCKER")));
  assert.equal((out.match(/<mark>/g) || []).length, 2);
  assert.ok(out.includes("<mark>Docker</mark>"));
});

test("文のまま引いても、本文にかたまりで印が付く", () => {
  const marks = Y.markTerms(Y.splitTerms("AGENTS.md の雛形はどこにあるか"));
  assert.deepEqual(marks.map((m) => m.key), ["agents.md", "の雛形はどこにあるか", "雛形"]);
  const out = Y.renderBody("二枚の雛形があります", ctx(marks));
  assert.ok(out.includes("<mark>雛形</mark>"));
  // 一文字のかたまりと、ひらがなだけの語は足さない
  assert.deepEqual(Y.markTerms(Y.splitTerms("鯨がいない")).map((m) => m.key), ["鯨がいない"]);
  assert.deepEqual(Y.markTerms(Y.splitTerms("もふもふ")).map((m) => m.key), ["もふもふ"]);
});

test("何も出ない時だけ語尾を落として引き直す", () => {
  const entries = [entry({ heading: "もふもふの話", body: "鯨がいる" })];
  assert.equal(Y.effectiveQuery(entries, "もふもふとは"), "もふもふ");
  assert.equal(Y.effectiveQuery(entries, "もふもふって何？"), "もふもふ");
  assert.equal(Y.effectiveQuery(entries, "鯨について"), "鯨");
  // 出るなら触らない
  assert.equal(Y.effectiveQuery([entry({ body: "もふもふとは何か" })], "もふもふとは"), "もふもふとは");
  // 落としても出なければ元のまま（「出なかった」を隠さない）
  assert.equal(Y.effectiveQuery(entries, "ぽふぽふとは"), "ぽふぽふとは");
  assert.equal(Y.effectiveQuery(entries, "クジラがいない"), "クジラがいない");
  // 語尾そのものは消さない
  assert.equal(Y.stripTail("とは"), "とは");
  // 語ごとに落とす
  assert.equal(Y.effectiveQuery(entries, "もふもふとは 鯨って"), "もふもふ 鯨");
});

test("目次: まとまり → 題名。入らない物は最後に", () => {
  const entries = [
    door({ title: "乙の手順", series: ["束"], readers: ["人"] }),
    entry({ title: "乙の手順", number: 1, series: ["束"], readers: ["人"] }),
    door({ title: "甲の手順", series: ["束", "別の束"], readers: ["機"] }),
    door({ title: "束", series: ["束"], readers: ["人"] }),
    door({ title: "ばらの手順", readers: ["人"] }),
  ];
  const groups = Y.tocGroups(entries);
  assert.deepEqual(groups.map((g) => g.name), ["束", "別の束", ""]);
  // まとまりと同じ名前のマニュアルは見出しに、子には入れない
  assert.equal(groups[0].lead.title, "束");
  assert.equal(groups[0].doors.length, 2);
  // 二つのまとまりに入る本は両方に
  assert.deepEqual(groups[1].doors.map((d) => d.title), ["甲の手順"]);
  assert.deepEqual(groups[2].doors.map((d) => d.title), ["ばらの手順"]);
  // 節は目次の組には入らない。絞り込みも効く
  assert.deepEqual(Y.tocGroups(entries, { reader: "機" }).map((g) => g.name), ["束", "別の束"]);
  assert.deepEqual(Y.tocGroups([]), []);
});

test("重なる語の mark が壊れない", () => {
  const out = Y.highlight("abcd", Y.splitTerms("abc bcd"));
  assert.equal(out.replace(/<\/?mark>/g, ""), "abcd");
});

test("抜粋は当たった一行だけで、記号を落とす", () => {
  assert.equal(Y.snippet("- 別の行\n- 3-6. **Docker** の手順\n- 次の行", "docker"), "Docker の手順");
  assert.equal(Y.snippet("[[語の題]] を開く", "語"), "語の題 を開く");
  assert.ok(Y.snippet("a**b", "a**b").includes("a**b")); // 語が記号を含むなら元のまま
});

test("抜粋は語を含み、長い本文を切る", () => {
  const out = Y.snippet("あ".repeat(100) + "語" + "い".repeat(100), "語");
  assert.ok(out.includes("語"));
  assert.ok(out.startsWith("…"));
  assert.ok(out.endsWith("…"));
  assert.ok(out.length < 60);
});
