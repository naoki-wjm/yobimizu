# yobimizu（呼び水）

人の頭の中にしかない知識を、聞き取りで引き出して、後から検索で引けるマニュアルにする仕組み。

古い手押しポンプは、上から少し水を注がないと深い所の水が上がってきません。小さな質問を注いで、頭の奥の知識を汲み上げる道具、という意味の名前です。

## 部品

- **書く側**: 聞き取りの台本。どの LLM に貼っても動く 1 枚の文章（`yobimizu-kumiage/script.md`、第三稿）と、それを包むだけの Claude 向けスキル（同じフォルダの `SKILL.md`。フォルダごとスキル置き場にコピーすれば入る）
- **置き場の型**: できたマニュアルを置くフォルダと、ファイル冒頭の設定欄・本文・記録の決まり（`shelf/format.md`）。見本は `shelf/example/`（本文四本と、その元になった聞き取りの記録。実際の聞き取りから固有の名前を言い換えた合成版）
- **直す側**: 反応を手掛かりに、話し手に聞きながら本文を直す台本（`yobimizu-kaitei/script.md`、第三稿）と、それを包むだけのスキル（同じフォルダの `SKILL.md`）
- **読む側**: 置き場から引く検索窓（サーバー不要の 1 枚 HTML）。作るコードは `reader/build_reader.py`（Python の標準ライブラリだけ）と雛形の `reader/template.html`。設計図は `reader/spec.md`、画面の絵は `reader/sketch.md`

## 下準備（初回だけ）

1. **置き場を決める**: マニュアルを置くフォルダ。中に検索窓（`reader.html`）と反応の記録（`reactions.md`）もできるので、忘れにくい場所に。何人かで見るなら、全員が開ける場所に。yobimizu 本体とは別の場所でよい
2. **yobimizu を落とす**: どちらかで
   - ZIP: GitHub のこのページの緑の **Code** ボタン → 一番下の **Download ZIP**。ZIP の中の `yobimizu-main` フォルダを、行方不明にならない好きな場所に置く
   - git: `git clone https://github.com/naoki-wjm/yobimizu.git`。OneDrive などの同期が掛かる場所は避ける（git と同期が喧嘩するため）
3. **Python を用意する**: 検索窓を作る時に要る（下の「必要な環境」）。聞き取りとまとめだけなら要らない
4. **スキルとして使うなら登録する**: `yobimizu-kumiage/`・`yobimizu-kaitei/` をフォルダごとスキル置き場へ。台本を貼って使うなら要らない

**消す・入れ替える**: yobimizu が書き出すのは、置き場の中の `reader.html` と `reactions.md` だけです。消す時は yobimizu のフォルダを消せば済み、置き場のマニュアルはそのまま残ります（スキルとして入れた物は、スキル置き場からも消す）。新しい版に入れ替える時は、落とし直して古いフォルダと差し替えます（git なら `git pull`）。

## 使い方

通る人は段ごとに違ってかまいません。置き場の用意と検索窓づくりは管理する人、聞き取りは知識を持っている人、引くのは誰でも。

1. **聞き取る**: `yobimizu-kumiage/script.md` を LLM に貼り（Claude Code ならフォルダごとスキルとして入れ）、聞かれた問いに一つずつ答える。弾（回）ごとに聞き取りの記録が返ってくる
2. **まとめる**: 記録と `shelf/format.md` を LLM に渡して、マニュアル本文を書いてもらう。聞き取りをした LLM と同じでなくてよい
3. **置く**: 本文を `manuals/`、記録を `records/<題名>/` に置く。形は `shelf/example/` と同じ（初回は置き場の下に `manuals/` と `records/` を作る）
4. **引く**: yobimizu のフォルダでターミナルを開き、置き場を指して `python reader/build_reader.py <置き場のパス>` を実行し、できた `<置き場>/reader.html` をブラウザで開いて検索する。サーバーもネットも要らない。本文を直したら作り直す。検索窓に LLM はいないので、打った言葉がそのまま書かれている所を探す。文のままより単語で引く方が当たる
5. **直す**: 引いた答えへの反応を `reactions.md` に貼って溜める。溜まったら `yobimizu-kaitei/script.md` と本文と `reactions.md` を LLM に渡して（Claude Code ならフォルダごとスキルとして入れ）、聞かれた問いに答えながら直す。直したら 4 の作り直しへ

先に出来上がりを見たい人は、**見本の検索窓を [naoki-wjm.github.io/yobimizu](https://naoki-wjm.github.io/yobimizu/) で触れます**（反応の一行は作れますが、貼り先の `reactions.md` は手元に置き場を作った時だけです）。手元で作るなら `python reader/build_reader.py shelf/example` で作って開くか、`shelf/example/manuals/` の四本へ。読み手が LLM の手順、読み手が本人の手順、心得寄りの物、それとこの道具自体の使い方（段ごとに読み手が替わる手順）です。

## 必要な環境

| 何をするか | 要る物 |
|---|---|
| 引くだけ | ブラウザ。できた `reader.html` を開けば動きます。サーバーもネット接続も要らず、ファイルを渡せば Python のない端末でも使えます |
| 検索窓を作る | Python 3.10 以上（のはず）。入れるパッケージはなく、標準ライブラリだけで動きます |
| 読む側を直してテストする | 上の Python と Node.js（`node --test reader/tests/test_core.mjs`）。Python 側のテストは `python -m unittest discover reader/tests` |

聞き取りとまとめには、台本を貼れる LLM が別に要ります。

確かめた範囲: 作るのは Windows の Python 3.14 で、それより古い版は試していません。検索窓は Windows の Chrome で動かしました（スマホ幅は Chrome で幅を再現した物）。Edge の検索画面と、Firefox・Safari・スマホの実機は未確認です。

## 状態

作っている途中。書く側と置き場の型は文章として一通り揃い、読む側は検索・開く・反応の一行まで動く。Build mainly with Claude Code: 茶々入れ2026

作っている途中の経過（なぜその問いを立てたか・何に引っ掛かったか・なぜ方針を変えたか）は、リポジトリの外の雑記に残しています。

- [初見さん向けの案内（連載の目次と拾い読み）](https://garasudama.yumegatari.com/%E9%9B%91%E9%8C%B2/%E5%BF%9C%E5%8B%9F%E3%81%97%E3%81%A6%E3%81%84%E3%81%BE%E3%81%9B%E3%82%93/Anthropic%E3%83%8F%E3%83%83%E3%82%AB%E3%82%BD%E3%83%B3%E8%8C%B6%E3%80%85%E5%85%A5%E3%82%8C2026%EF%BC%88%E5%BF%9C%E5%8B%9F%E3%81%97%E3%81%A6%E3%81%84%E3%81%BE%E3%81%9B%E3%82%93%EF%BC%89.html)
- [連載の一覧（新しい順）](https://garasudama.yumegatari.com/%E3%82%BF%E3%82%B0/BmwC%E8%8C%B6%E3%80%85%E5%85%A5%E3%82%8C2026.html)
- [初回から読むなら 2026-1](https://garasudama.yumegatari.com/%E9%9B%91%E8%A8%98/2026%E5%B9%B410%E6%9C%88/2026-10-15-01%EF%BC%88Build%20mainly%20with%20Claude%20Code%EF%BC%9A%20%E8%8C%B6%E3%80%85%E5%85%A5%E3%82%8C%202026-1%EF%BC%89.html)

## ライセンス

MIT
