#!/usr/bin/env python3
"""呼び水 — 置き場のマニュアルから、検索用の一枚 HTML を作る。

使い方:
    python build_reader.py <置き場のパス>               → <置き場>/reader.html（reactions.md が無ければ、見出しだけの物も）
    python build_reader.py <置き場のパス> --json        → 索引の JSON を標準出力へ（HTML は作らない）
    python build_reader.py <置き場のパス> --out 出力先  → 出力先へ

読むのは <置き場>/manuals/*.md だけ。形の決まりは shelf/format.md の 6 節、
索引の一件の形は reader/spec.md の 2 節。標準ライブラリだけで動く。

書く人（LLM を含む）が少し崩しても、黙って取り違えないことを優先する。
拾える崩れは拾い、拾えない物は「注意」に出す。
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

TEMPLATE_NAME = "template.html"
PLACEHOLDER = "/*__INDEX__*/null"

KEY_RE = re.compile(r"^([A-Za-z_][\w-]*)\s*[:：]\s*(.*)$")
ITEM_RE = re.compile(r"^\s*-\s+(.*)$")
SECTION_RE = re.compile(r"^##\s+(\d+)\.\s*(.*?)\s*$")
H2_RE = re.compile(r"^##\s")
H1_RE = re.compile(r"^#\s")
BLANK_SECTION_RE = re.compile(r"^##\s+空欄\s*$")
# 開く囲い: 字下げ三つまで。後ろに書けるのは言語名だけ（「```x``` を実行」「~~~だよ」は文章）
FENCE_OPEN_RE = re.compile(r"^ {0,3}(~~~+|```+)\s*[A-Za-z0-9_.+-]*\s*$")
FENCE_CLOSE_RE = re.compile(r"^ {0,3}(~~~+|```+)\s*$")
ARROW_RE = re.compile(r"^(.*?)\s*[（(]?\s*(?:→|->|⇒|=>)\s*(節.*)$")
TARGET_NUMBER_RE = re.compile(r"節\s*(\d+)")
FUDA_RE = re.compile(r"^\s*(?:(?:[-*+]|\d+\.)\s+)?(?:\*\*)?(注意|済んだ合図|やらない)\s*[:：]", re.M)
RECORD_RE = re.compile(r"^(?:-\s+)?(?:\*\*)?記録\s*[:：]\s*(?:\*\*)?\s*(.*\[\[.*)$")
WIKILINK_RE = re.compile(r"\[\[([^\[\]]+)\]\]")
PAREN_RE = re.compile(r"[（(][^（）()]*[）)]")
RULE_RE = re.compile(r"^\s*(-{3,}|\*{3,}|_{3,})\s*$")
KARI_RE = re.compile(r"〔仮(?=[:：〕\s])")
KUURAN_RE = re.compile(r"〔空欄(?=[:：〕\s])")
# 閉じ括弧の直前の ` は顔文字 (´･ω･`) の一部。コードの始まりと見なさない
INLINE_CODE_RE = re.compile(r"`(?![)）])[^`\n]+`")

LIST_KEYS = {"aliases", "questions", "readers", "related", "series"}
SCALAR_KEYS = {"title", "created", "updated", "summary"}
YAML_BLOCK_VALUES = {">", "|", ">-", "|-", ">+", "|+"}


class Warnings:
    """止めずに最後にまとめて見せる。一本の書き損じで全体を落とさない。"""

    def __init__(self) -> None:
        self.items: list[str] = []

    def add(self, where: str, message: str) -> None:
        self.items.append(f"{where}: {message}")


def read_lines(path: Path) -> list[str]:
    """UTF-8（BOM 可）、LF・CRLF どちらでも。splitlines は U+2028 等でも割るので使わない。"""
    text = path.read_bytes().decode("utf-8-sig")
    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


class FenceTracker:
    """囲いの中かどうかを一行ずつ追う。閉じるのは同じ字で同じ長さ以上の、それだけの行。"""

    def __init__(self, ignored: frozenset[int] = frozenset()) -> None:
        self.marker: str | None = None
        self.opened_at: int | None = None
        self.ignored = ignored

    def feed(self, number: int, line: str) -> bool:
        """この行が囲いの中（囲いの線を含む）なら True。"""
        if self.marker is None:
            match = FENCE_OPEN_RE.match(line)
            if match and number not in self.ignored:
                self.marker = match.group(1)
                self.opened_at = number
                return True
            return False
        match = FENCE_CLOSE_RE.match(line)
        if match and match.group(1)[0] == self.marker[0] and len(match.group(1)) >= len(self.marker):
            self.marker = None
            self.opened_at = None
        return True


def unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'" and value[0] not in value[1:-1]:
        return value[1:-1]
    return value


def clean_item(value: str) -> str:
    """一覧の一項目。Obsidian の癖で [[題名]] と書かれても題名として読む。"""
    value = unquote(value)
    link = WIKILINK_RE.fullmatch(value)
    return link.group(1).split("|")[0].strip() if link else value


def parse_inline_list(value: str) -> list[str]:
    inner = value.strip()
    if "[[" in inner:
        return [name.split("|")[0].strip() for name in WIKILINK_RE.findall(inner)]
    if inner.startswith("[") and inner.endswith("]"):
        inner = inner[1:-1]
        return [clean_item(part) for part in inner.split(",") if part.strip()]
    return [clean_item(inner)] if inner else []


def strip_outer_fence(lines: list[str], where: str, warnings: Warnings) -> list[str]:
    """全文を ~~~ で囲んだまま保存された物（format.md 9 節の渡し方の名残）から囲いを外す。"""
    nonblank = [i for i, line in enumerate(lines) if line.strip()]
    if len(nonblank) < 2:
        return lines
    first, last = nonblank[0], nonblank[-1]
    opened = FENCE_OPEN_RE.match(lines[first])
    closed = FENCE_CLOSE_RE.match(lines[last])
    has_frontmatter = any(line.strip() == "---" for line in lines[first + 1 : first + 3])
    if opened and closed and opened.group(1)[0] == closed.group(1)[0] and has_frontmatter:
        warnings.add(where, "全文が囲いに入っていたので、外側の囲いを外して読みました")
        return lines[first + 1 : last]
    return lines


def parse_frontmatter(lines: list[str], where: str, warnings: Warnings) -> tuple[dict, list[str], bool]:
    """format.md 2 節の縛り（1 行 1 項目・値は 1 行）に甘えた読み方。知らない項目は捨てる。

    返すのは (項目, 残りの行, 設定欄が壊れているか)。
    壊れている時、節より前の行は設定欄の断片かもしれないので本文に混ぜない。
    """
    fields: dict = {}
    start = next((i for i, line in enumerate(lines) if line.strip()), None)
    if start is None or lines[start].strip() != "---":
        warnings.add(where, "設定欄がありません")
        return fields, lines, False

    closing = None
    for i in range(start + 1, len(lines)):
        if lines[i].strip() == "---":
            closing = i
            break
        if SECTION_RE.match(lines[i]):
            break  # 節まで来ても閉じていない。本文の区切り線を閉じと間違えない
    if closing is None:
        warnings.add(where, "設定欄が閉じていません（--- が足りない）。設定欄の項目は読みません")
        return fields, lines[start + 1 :], True

    current_list: str | None = None
    for line in lines[start + 1 : closing]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue  # 空行や注釈で一覧を切らない
        item = ITEM_RE.match(line)
        if item and current_list:
            value = clean_item(item.group(1))
            if value:
                fields[current_list].append(value)
            continue
        match = KEY_RE.match(line)
        if not match:
            current_list = None
            continue
        key, value = match.group(1), match.group(2).strip()
        current_list = None
        if key not in LIST_KEYS and key not in SCALAR_KEYS:
            continue
        if value in YAML_BLOCK_VALUES or (key in LIST_KEYS and value.startswith("[") and not value.endswith("]")):
            warnings.add(where, f"{key} は 1 行で書いてください（複数行の値は読みません）")
            fields[key] = [] if key in LIST_KEYS else ""
            continue
        if key in LIST_KEYS:
            fields[key] = parse_inline_list(value)
            if not value:
                current_list = key
        else:
            fields[key] = unquote(value)
    return fields, lines[closing + 1 :], False


def split_sections(lines: list[str], where: str, warnings: Warnings) -> tuple[list[dict], list[str]]:
    """`## 番号. 見出し` で割る。囲いの中の ## は見出しではない。

    閉じない囲いは残りの節を飲み込むので、注意を出してその行を囲いと見なさず読み直す。
    番号のない ## は前の節の本文に残す。最初の節より前の行は前書きとして別に返す。
    """
    ignored: set[int] = set()
    while True:
        sections: list[dict] = []
        preamble: list[str] = []
        current: dict | None = None
        notes: list[str] = []
        tracker = FenceTracker(frozenset(ignored))
        for number, line in enumerate(lines):
            in_fence = tracker.feed(number, line)
            section = SECTION_RE.match(line) if not in_fence else None
            if section:
                current = {"number": int(section.group(1)), "heading": section.group(2), "lines": []}
                sections.append(current)
                continue
            if not in_fence and BLANK_SECTION_RE.match(line):
                # 番号の付け忘れ。前の節に混ぜると印を二重に数え、「空欄」でも引けなくなる
                current = {"number": None, "heading": "空欄", "lines": []}
                sections.append(current)
                continue
            if not in_fence and H2_RE.match(line):
                place = "前の節の本文" if current is not None else "前書き"
                notes.append(f"番号のない節見出しは{place}として扱います: {line.strip()}")
            (current["lines"] if current is not None else preamble).append(line)
        if tracker.marker is None:
            for note in notes:
                warnings.add(where, note)
            return sections, preamble
        warnings.add(where, f"囲い（{tracker.marker}）が閉じていないので、囲いと見なさず読みました: {lines[tracker.opened_at].strip()}")
        ignored.add(tracker.opened_at)


def strip_fences(body: str) -> str:
    """数える時だけ、囲いの中（書式の例など）と行内コードを外す。"""
    kept: list[str] = []
    tracker = FenceTracker()
    for number, line in enumerate(body.split("\n")):
        if not tracker.feed(number, line):
            kept.append(line)
    return INLINE_CODE_RE.sub("", "\n".join(kept))


def is_record_line(text: str) -> str | None:
    """記録の一覧だけの行なら中身を返す。文の中の [[ ]]（「記録: [[台帳]] を先に開く」）は指示なので拾わない。"""
    match = RECORD_RE.match(text)
    if not match:
        return None
    rest = WIKILINK_RE.sub("", match.group(1))
    while PAREN_RE.search(rest):
        rest = PAREN_RE.sub("", rest)
    return match.group(1) if not re.sub(r"[\s・、,，/／*]", "", rest) else None


def pop_record_lines(sections: list[dict]) -> tuple[str, list[str]]:
    """本文末尾の「記録: [[…]]」を節から外す。記録は節ではなくファイルの持ち物。"""
    if not sections:
        return "", []
    lines = sections[-1]["lines"]
    found: list[str] = []
    i = len(lines) - 1
    while i >= 0:
        text = lines[i].strip()
        if not text or (RULE_RE.match(text) and not found):
            i -= 1
            continue
        content = is_record_line(text)
        if content is None:
            break
        found.insert(0, content)
        del lines[i]
        i -= 1
    names = [name.split("|")[0].strip() for content in found for name in WIKILINK_RE.findall(content)]
    line = "／".join(WIKILINK_RE.sub(lambda m: m.group(1).split("|")[0].strip(), content) for content in found)
    return line, names


def count_mark(pattern: re.Pattern, text: str) -> int:
    return len(pattern.findall(text))


def build_file_entries(path: Path, warnings: Warnings) -> list[dict]:
    where = path.name
    try:
        lines = read_lines(path)
    except UnicodeDecodeError:
        warnings.add(where, "UTF-8 で読めないので飛ばしました")
        return []
    except OSError as error:
        warnings.add(where, f"読めないので飛ばしました（{error.__class__.__name__}）")
        return []

    lines = strip_outer_fence(lines, where, warnings)
    fields, rest, broken_frontmatter = parse_frontmatter(lines, where, warnings)
    title = fields.get("title") or path.stem
    if not fields.get("title"):
        warnings.add(where, "title がないのでファイル名を題名にしました")
    elif title != path.stem:
        warnings.add(where, f"title（{title}）とファイル名が違います")

    sections, preamble = split_sections(rest, where, warnings)
    for section in sections:
        if section["number"] is None:
            used = [s["number"] for s in sections if s["number"] is not None]
            section["number"] = max(used, default=-1) + 1
            warnings.add(where, f"`## 空欄` に番号がないので、節 {section['number']} として入れました（本文にも番号を振ってください）")
    # 前書きから `# 題名` の行を除く。残りは捨てずに最初の節へ（設定欄が壊れた時は断片かもしれないので捨てる）
    preamble_text = [line for line in preamble if not H1_RE.match(line)]
    has_preamble = any(line.strip() for line in preamble_text)
    if not sections:
        if broken_frontmatter:
            warnings.add(where, "節がなく設定欄も壊れているので飛ばしました")
            return []
        warnings.add(where, "`## 番号. 見出し` の節が一つもないので、本文全体を一節として入れました")
        sections = [{"number": 0, "heading": "本文", "lines": preamble_text}]
    elif has_preamble and broken_frontmatter:
        warnings.add(where, "設定欄が壊れているので、最初の節より前の行は入れませんでした")
    elif has_preamble:
        warnings.add(where, f"最初の節より前の文章は、節 {sections[0]['number']} の本文に入れました")
        sections[0]["lines"] = preamble_text + sections[0]["lines"]

    record_line, record_names = pop_record_lines(sections)

    numbers = [s["number"] for s in sections]
    for number in sorted({n for n in numbers if numbers.count(n) > 1}):
        warnings.add(where, f"節 {number} が二つあります（番号は名前なので一つに）")

    entrance_number = 0 if 0 in numbers else numbers[0]
    if entrance_number != 0:
        warnings.add(where, f"節 0 がないので、節 {entrance_number} を入口にします")

    # 想定質問を、宛先のある物（その節へ）と無い物（入口へ）に分ける
    open_questions: list[str] = []
    targeted: dict[int, list[str]] = {}
    for question in fields.get("questions", []):
        match = ARROW_RE.match(question)
        targets = [int(n) for n in TARGET_NUMBER_RE.findall(match.group(2))] if match else []
        if not targets:
            open_questions.append(question)
            continue
        text = match.group(1).strip()
        if not text:
            warnings.add(where, f"宛先だけで質問の文がないので捨てました: {question}")
            continue
        for number in targets:
            if number in numbers:
                targeted.setdefault(number, []).append(text)
            else:
                warnings.add(where, f"想定質問の宛先 節 {number} がありません。入口の質問にします: {text}")
                if text not in open_questions:
                    open_questions.append(text)

    created = fields.get("created", "")
    updated = fields.get("updated") or created
    entries: list[dict] = []
    seen_entrance = False
    for section in sections:
        body = "\n".join(section["lines"]).strip("\n")
        is_entrance = section["number"] == entrance_number and not seen_entrance
        seen_entrance = seen_entrance or is_entrance
        countable = strip_fences(body)
        # 見出しの語は「空欄」で固定だが、括弧を足す書き手もいる
        is_blank_section = section["heading"].startswith("空欄")
        entry = {
            "title": title,
            "number": section["number"],
            "heading": section["heading"],
            "body": body,
            "summary": fields.get("summary", ""),
            "readers": fields.get("readers", []),
            "series": fields.get("series", []),
            "related": fields.get("related", []),
            "created": created,
            "updated": updated,
            "entrance": is_entrance,
            # ファイルの言葉は入口だけに。全節に写すと一語で全節が同じ強さで当たる（spec 2 節）
            "aliases": fields.get("aliases", []) if is_entrance else [],
            "questions": open_questions if is_entrance else [],
            # 重複した節番号があれば先の節にだけ渡す
            "targeted_questions": targeted.pop(section["number"], []),
            # 空欄の節では数えない。本文の印と二重になる（spec 2 節）
            "kari": 0 if is_blank_section else count_mark(KARI_RE, countable),
            "kuuran": 0 if is_blank_section else count_mark(KUURAN_RE, countable),
            "fuda": sorted(set(FUDA_RE.findall(countable))),
            "record_line": record_line,
            "records": record_names,
        }
        entries.append(entry)
    return entries


def build_index(shelf: Path, warnings: Warnings) -> dict:
    manuals = shelf / "manuals"
    if not manuals.is_dir():
        raise FileNotFoundError(f"manuals/ が見つかりません: {manuals.name}")
    entries: list[dict] = []
    seen_titles: dict[str, str] = {}
    paths = [p for p in manuals.glob("*.md") if p.is_file()]
    for path in sorted(paths, key=lambda p: p.name):
        file_entries = build_file_entries(path, warnings)
        if not file_entries:
            continue
        title = file_entries[0]["title"]
        if title in seen_titles:
            warnings.add(path.name, f"題名が {seen_titles[title]} と同じです")
        seen_titles.setdefault(title, path.name)
        entries.extend(file_entries)
    if not entries:
        warnings.add("manuals", "マニュアルが一本もありません")
    # 分まで持つ。同じ日に作り直しても、効いたかどうかが画面で分かるように
    return {"built": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "entries": entries}


def embeddable_json(index: dict) -> str:
    """script の中に埋めても閉じない・壊れない JSON にする。"""
    text = json.dumps(index, ensure_ascii=False, separators=(",", ":"))
    for char, escape in (("<", "\\u003c"), (">", "\\u003e"), ("&", "\\u0026"),
                         (" ", "\\u2028"), (" ", "\\u2029")):
        text = text.replace(char, escape)
    return text


def render_html(index: dict) -> str:
    template_path = Path(__file__).resolve().parent / TEMPLATE_NAME
    template = template_path.read_text(encoding="utf-8")
    if template.count(PLACEHOLDER) != 1:
        raise ValueError(f"{TEMPLATE_NAME} の埋め込み位置が一か所ではありません")
    return template.replace(PLACEHOLDER, embeddable_json(index))


REACTIONS_NAME = "reactions.md"
REACTIONS_HEADER = """# 反応の記録

検索窓で引いた答えへの一言を、1 行ずつ末尾に追記する。

- 日付 | 検索語 | 題名 | 節 | 反応（役に立った／部分的／見当違い／人に渡した） | 一言
"""


def ensure_reactions(shelf: Path) -> bool:
    """貼り先が無いと初めての人が止まるので、無い時だけ作る。あれば決して触らない。"""
    path = shelf / REACTIONS_NAME
    if path.exists():
        return False
    path.write_text(REACTIONS_HEADER, encoding="utf-8", newline="\n")
    return True


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="置き場のマニュアルから検索用の一枚 HTML を作る")
    parser.add_argument("shelf", type=Path, help="置き場のパス（中に manuals/ がある所）")
    parser.add_argument("--json", action="store_true", help="索引の JSON を標準出力へ。HTML は作らない")
    parser.add_argument("--out", type=Path, help="HTML の出力先（既定は <置き場>/reader.html）")
    args = parser.parse_args(argv)

    warnings = Warnings()
    try:
        index = build_index(args.shelf, warnings)
    except FileNotFoundError as error:
        print(f"止まりました: {error}", file=sys.stderr)
        return 2

    for item in warnings.items:
        print(f"注意 {item}", file=sys.stderr)

    if args.json:
        print(json.dumps(index, ensure_ascii=False, indent=2))
        return 0

    out = args.out or args.shelf / "reader.html"
    out.write_text(render_html(index), encoding="utf-8", newline="\n")
    titles = len({e["title"] for e in index["entries"]})
    print(f"{out.name} を作りました（題名 {titles} 本・節 {len(index['entries'])}）")
    if not args.out and ensure_reactions(args.shelf):
        print(f"{REACTIONS_NAME} も作りました（検索窓で作った一行を、ここの末尾に貼ります）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
