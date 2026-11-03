"""索引を作るコードの検品。python -m unittest discover reader/tests で動く。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
READER = HERE.parent
sys.path.insert(0, str(READER))

import build_reader as br  # noqa: E402

GOOD = """---
title: 題名A
created: 2026-01-01
summary: 一文の要約
aliases: [別名一, 別名二]
questions:
  - 宛先なしの質問
  - 節一へ行く質問 → 節 1
  - 無い節へ行く質問 → 節 99
readers: [読み手]
series: まとまり
related: []
tags: [無視される]
---

# 題名A

## 0. 前提

前提の本文。〔仮: 理由〕

## 1. 一段目

注意: 気を付ける。
- 1-1. する。〔空欄: 無い〕〔仮〕
- 済んだ合図: 見える。

~~~
## 2. 囲いの中は節ではない
〔仮〕
注意: 囲いの中は札ではない
~~~

## 2. 空欄

- 節 1: 聞けなかった〔空欄〕

記録: [[2026-01-01-第一弾]]（聞き手）・[[2026-01-02-第二弾]]
"""


def write_shelf(root: Path, files: dict) -> Path:
    manuals = root / "manuals"
    manuals.mkdir(parents=True)
    for name, data in files.items():
        (manuals / name).write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))
    return root


class BuildCase(unittest.TestCase):
    def build(self, files):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        warnings = br.Warnings()
        index = br.build_index(write_shelf(Path(self.tmp.name), files), warnings)
        return index["entries"], warnings.items


class EntryShape(BuildCase):
    def setUp(self):
        self.entries, self.warnings = self.build({"題名A.md": GOOD})
        self.by = {e["number"]: e for e in self.entries}

    def test_one_entry_per_section_and_fence_is_not_a_section(self):
        self.assertEqual(sorted(self.by), [0, 1, 2])
        self.assertIn("## 2. 囲いの中は節ではない", self.by[1]["body"])
        self.assertEqual(self.by[2]["heading"], "空欄")

    def test_file_words_only_on_entrance(self):
        self.assertEqual(self.by[0]["aliases"], ["別名一", "別名二"])
        self.assertTrue(self.by[0]["entrance"])
        self.assertEqual(self.by[1]["aliases"], [])
        self.assertEqual(self.by[1]["questions"], [])
        self.assertFalse(self.by[1]["entrance"])

    def test_targeted_question_goes_to_its_section(self):
        self.assertEqual(self.by[1]["targeted_questions"], ["節一へ行く質問"])
        self.assertIn("宛先なしの質問", self.by[0]["questions"])

    def test_bad_target_falls_back_to_entrance_with_warning(self):
        self.assertIn("無い節へ行く質問", self.by[0]["questions"])
        self.assertTrue(any("節 99" in w for w in self.warnings))

    def test_copied_fields_on_every_entry(self):
        for entry in self.entries:
            self.assertEqual(entry["summary"], "一文の要約")
            self.assertEqual(entry["readers"], ["読み手"])
            self.assertEqual(entry["series"], ["まとまり"])

    def test_updated_falls_back_to_created(self):
        self.assertEqual(self.by[0]["updated"], "2026-01-01")

    def test_unknown_key_ignored(self):
        self.assertNotIn("tags", self.by[0])

    def test_counts_skip_fences_and_blank_section(self):
        self.assertEqual((self.by[0]["kari"], self.by[0]["kuuran"]), (1, 0))
        self.assertEqual((self.by[1]["kari"], self.by[1]["kuuran"]), (1, 1))
        self.assertEqual((self.by[2]["kari"], self.by[2]["kuuran"]), (0, 0))

    def test_fuda_after_list_marker_and_not_in_fence(self):
        self.assertEqual(self.by[1]["fuda"], ["注意", "済んだ合図"])
        self.assertEqual(self.by[0]["fuda"], [])

    def test_record_line_moved_out_of_body(self):
        self.assertNotIn("記録", self.by[2]["body"])
        self.assertEqual(self.by[0]["records"], ["2026-01-01-第一弾", "2026-01-02-第二弾"])
        self.assertNotIn("[[", self.by[0]["record_line"])


class Tolerance(BuildCase):
    def test_bom_and_crlf(self):
        data = b"\xef\xbb\xbf" + GOOD.replace("\n", "\r\n").encode("utf-8")
        entries, _ = self.build({"題名A.md": data})
        self.assertEqual(entries[0]["title"], "題名A")
        self.assertEqual(len(entries), 3)
        self.assertNotIn("\r", entries[1]["body"])

    def test_not_utf8_is_skipped_with_warning(self):
        entries, warnings = self.build({"壊れ.md": "題名".encode("cp932"), "題名A.md": GOOD})
        self.assertEqual({e["title"] for e in entries}, {"題名A"})
        self.assertTrue(any("UTF-8" in w for w in warnings))

    def test_no_section_zero_uses_first_section_as_entrance(self):
        text = "---\ntitle: 無零\naliases: [甲]\n---\n\n## 3. 三\n\n本文\n\n## 5. 五\n\n本文\n"
        entries, warnings = self.build({"無零.md": text})
        self.assertEqual([e["entrance"] for e in entries], [True, False])
        self.assertEqual(entries[0]["aliases"], ["甲"])
        self.assertTrue(any("節 0" in w for w in warnings))

    def test_no_sections_keeps_text_searchable(self):
        entries, warnings = self.build({"平文.md": "---\ntitle: 平文\n---\n\nただの文章\n"})
        self.assertEqual(len(entries), 1)
        self.assertIn("ただの文章", entries[0]["body"])
        self.assertTrue(entries[0]["entrance"])
        self.assertTrue(warnings)

    def test_no_frontmatter_title_from_filename(self):
        entries, warnings = self.build({"名前.md": "## 0. 前提\n\n本文\n"})
        self.assertEqual(entries[0]["title"], "名前")
        self.assertTrue(warnings)

    def test_unclosed_frontmatter_does_not_crash(self):
        entries, warnings = self.build({"閉じず.md": "---\ntitle: 閉じず\n\n## 0. 前提\n\n本文\n"})
        self.assertEqual(entries[0]["number"], 0)
        self.assertTrue(any("閉じて" in w for w in warnings))

    def test_scalar_where_list_expected_and_quotes(self):
        text = '---\ntitle: "引用"\nreaders: 一人\naliases:\n  - "甲"\n  - 乙\n---\n\n## 0. 前提\n\n本文\n'
        entries, _ = self.build({"引用.md": text})
        self.assertEqual(entries[0]["title"], "引用")
        self.assertEqual(entries[0]["readers"], ["一人"])
        self.assertEqual(entries[0]["aliases"], ["甲", "乙"])

    def test_value_with_colon_is_kept(self):
        text = "---\ntitle: 題\nsummary: 前半: 後半\n---\n\n## 0. 前提\n\n本文\n"
        entries, _ = self.build({"題.md": text})
        self.assertEqual(entries[0]["summary"], "前半: 後半")

    def test_unnumbered_h2_stays_in_previous_section(self):
        text = "---\ntitle: 題\n---\n\n## 0. 前提\n\n本文\n\n## 余談\n\n残る\n"
        entries, warnings = self.build({"題.md": text})
        self.assertEqual(len(entries), 1)
        self.assertIn("残る", entries[0]["body"])
        self.assertTrue(any("余談" in w for w in warnings))

    def test_duplicate_numbers_warn_and_targeted_goes_once(self):
        text = "---\ntitle: 題\nquestions:\n  - 問 → 節 1\n---\n\n## 0. 前提\n\n甲\n\n## 1. 一\n\n乙\n\n## 1. 二\n\n丙\n"
        entries, warnings = self.build({"題.md": text})
        self.assertEqual([e["targeted_questions"] for e in entries if e["number"] == 1], [["問"], []])
        self.assertTrue(any("節 1 が二つ" in w for w in warnings))

    # --- 2026-11-02 のレビューで出た崩れ方 ---

    def body_of(self, text, number=0, name="題.md"):
        entries, warnings = self.build({name: text})
        return next(e for e in entries if e["number"] == number), entries, warnings

    def test_inline_fence_like_line_does_not_swallow_sections(self):
        text = "---\ntitle: 題\n---\n\n## 0. 前提\n\n```x``` を実行\n\n## 1. 一\n\n本文\n"
        _, entries, _ = self.body_of(text)
        self.assertEqual([e["number"] for e in entries], [0, 1])

    def test_unnumbered_blank_section_gets_next_number(self):
        text = "---\ntitle: 題\n---\n\n## 0. 前提\n\n〔仮〕\n\n## 6. 六\n\n本文\n\n## 空欄\n\n- 節 6: 〔仮〕\n\n記録: [[甲]]\n"
        entry, entries, warnings = self.body_of(text, number=7)
        self.assertEqual([e["number"] for e in entries], [0, 6, 7])
        self.assertEqual(entry["heading"], "空欄")
        self.assertEqual(entry["kari"], 0)
        self.assertEqual(entry["records"], ["甲"])
        self.assertNotIn("聞けな", entries[1]["body"])
        self.assertTrue(any("節 7" in w for w in warnings))

    def test_tilde_in_prose_is_not_a_fence(self):
        text = "---\ntitle: 題\n---\n\n## 0. 前提\n\n~~~だよ、と言った\n\n## 1. 一\n\n本文\n"
        _, entries, warnings = self.body_of(text)
        self.assertEqual([e["number"] for e in entries], [0, 1])
        self.assertFalse(any("囲い" in w for w in warnings))

    def test_kaomoji_backtick_is_not_code_when_counting(self):
        text = "---\ntitle: 題\n---\n\n## 0. 前提\n\n(´･ω･`) 〔仮〕 (´･ω･`)\n"
        self.assertEqual(self.body_of(text)[0]["kari"], 1)

    def test_unclosed_fence_warns_and_keeps_sections(self):
        text = "---\ntitle: 題\n---\n\n## 0. 前提\n\n~~~\n中\n\n## 1. 一\n\n本文\n"
        _, entries, warnings = self.body_of(text)
        self.assertEqual([e["number"] for e in entries], [0, 1])
        self.assertTrue(any("囲い" in w for w in warnings))

    def test_inner_fence_shorter_or_with_info_does_not_close(self):
        text = "---\ntitle: 題\n---\n\n## 0. 前提\n\n~~~~\n~~~\n## 7. 例\n~~~\n~~~~\n\n```\n```md\n## 8. 例\n```\n"
        _, entries, _ = self.body_of(text)
        self.assertEqual([e["number"] for e in entries], [0])

    def test_rule_in_body_is_not_frontmatter_close(self):
        text = "---\ntitle: 題\n\n## 0. 前提\n\n甲\n\n---\n\n## 1. 一\n\n乙\n"
        _, entries, warnings = self.body_of(text)
        self.assertEqual([e["number"] for e in entries], [0, 1])
        self.assertIn("甲", entries[0]["body"])
        self.assertTrue(any("閉じて" in w for w in warnings))

    def test_broken_frontmatter_fragment_stays_out_of_index(self):
        text = "---\ntitle: 題\nsource: 持ち主の手元の場所\n\n## 0. 前提\n\n本文\n"
        _, entries, _ = self.body_of(text)
        self.assertNotIn("手元の場所", json.dumps(entries, ensure_ascii=False))

    def test_leading_blank_lines_before_frontmatter(self):
        text = "\n\n---\ntitle: 題\nsource: 手元の場所\n---\n\n## 0. 前提\n\n本文\n"
        entry, entries, _ = self.body_of(text)
        self.assertEqual(entry["title"], "題")
        self.assertNotIn("手元の場所", json.dumps(entries, ensure_ascii=False))

    def test_whole_file_in_outer_fence(self):
        text = "~~~\n---\ntitle: 題\nsource: 手元の場所\n---\n\n## 0. 前提\n\n本文\n\n## 1. 一\n\n乙\n~~~\n"
        _, entries, warnings = self.body_of(text)
        self.assertEqual([e["number"] for e in entries], [0, 1])
        self.assertNotIn("手元の場所", json.dumps(entries, ensure_ascii=False))
        self.assertTrue(any("囲い" in w for w in warnings))

    def test_preamble_kept_in_first_section(self):
        text = "---\ntitle: 題\n---\n\n# 題\n\n前書き〔仮〕\n\n## はじめに\n\n続き\n\n## 0. 前提\n\n本文\n"
        entry, _, warnings = self.body_of(text)
        self.assertIn("前書き", entry["body"])
        self.assertIn("続き", entry["body"])
        self.assertNotIn("# 題\n", entry["body"])
        self.assertEqual(entry["kari"], 1)
        self.assertTrue(any("前書き" in w or "より前" in w for w in warnings))

    def test_blank_and_comment_lines_do_not_cut_list(self):
        text = "---\ntitle: 題\nquestions:\n  - 問甲 → 節 0\n\n  # 注\n  - 問乙 → 節 1\n---\n\n## 0. 前提\n\n甲\n\n## 1. 一\n\n乙\n"
        _, entries, _ = self.body_of(text)
        self.assertEqual(entries[1]["targeted_questions"], ["問乙"])

    def test_target_variants(self):
        for question in ("問 → 節 1-2", "問 →節1。", "問（→ 節 1）", "問 ⇒ 節 1", "問 -> 節 1"):
            text = f"---\ntitle: 題\nquestions:\n  - {question}\n---\n\n## 0. 前提\n\n甲\n\n## 1. 一\n\n乙\n"
            _, entries, _ = self.body_of(text)
            self.assertEqual(entries[1]["targeted_questions"], ["問"], question)
            self.assertEqual(entries[0]["questions"], [], question)

    def test_target_two_sections_and_empty_text(self):
        text = "---\ntitle: 題\nquestions:\n  - 問 → 節 0、節 1\n  - → 節 1\n---\n\n## 0. 前提\n\n甲\n\n## 1. 一\n\n乙\n"
        _, entries, warnings = self.body_of(text)
        self.assertEqual(entries[0]["targeted_questions"], ["問"])
        self.assertEqual(entries[1]["targeted_questions"], ["問"])
        self.assertTrue(any("質問の文がない" in w for w in warnings))

    def test_block_values_warn_instead_of_misreading(self):
        text = "---\ntitle: 題\nsummary: >\n  続き\naliases: [\n  甲,\n]\n---\n\n## 0. 前提\n\n甲\n"
        entry, _, warnings = self.body_of(text)
        self.assertEqual(entry["summary"], "")
        self.assertEqual(entry["aliases"], [])
        self.assertEqual(sum("1 行で" in w for w in warnings), 2)

    def test_colon_variants_and_wikilinks_in_related(self):
        text = "---\ntitle: 題\nsummary:要約\nquestions：\n  - 問\nrelated: [[他A]]\n---\n\n## 0. 前提\n\n甲\n"
        entry, _, _ = self.body_of(text)
        self.assertEqual(entry["summary"], "要約")
        self.assertEqual(entry["questions"], ["問"])
        self.assertEqual(entry["related"], ["他A"])
        text = "---\ntitle: 題\nrelated:\n  - [[他A]]\n---\n\n## 0. 前提\n\n甲\n"
        self.assertEqual(self.body_of(text)[0]["related"], ["他A"])

    def test_two_series(self):
        text = "---\ntitle: 題\nseries: [甲, 乙]\n---\n\n## 0. 前提\n\n本文\n"
        self.assertEqual(self.body_of(text)[0]["series"], ["甲", "乙"])

    def test_instruction_mentioning_record_is_not_a_record_line(self):
        text = "---\ntitle: 題\n---\n\n## 0. 空欄\n\n記録: [[台帳]] を先に開いてから、次へ進むこと。\n"
        entry, _, _ = self.body_of(text)
        self.assertIn("次へ進むこと", entry["body"])
        self.assertEqual(entry["records"], [])

    def test_record_line_variants(self):
        for line in ("- 記録: [[甲]]・[[乙]]", "**記録:** [[甲]]・[[乙]]", "記録: [[甲]]（聞き手。補足）・[[乙]]\n\n---"):
            text = f"---\ntitle: 題\n---\n\n## 0. 空欄\n\n本文\n\n{line}\n"
            entry, _, _ = self.body_of(text)
            self.assertEqual(entry["records"], ["甲", "乙"], line)
            self.assertNotIn("[[", entry["body"], line)

    def test_two_record_lines(self):
        text = "---\ntitle: 題\n---\n\n## 0. 前提\n\n本文\n\n記録: [[甲]]\n記録: [[乙]]\n"
        self.assertEqual(self.body_of(text)[0]["records"], ["甲", "乙"])

    def test_marks_only_real_ones(self):
        text = "---\ntitle: 題\n---\n\n## 0. 前提\n\n`〔仮: 例〕` 〔仮名〕 〔空欄〕 〔仮〕 〔仮: 本物〕\n\n## 1. 空欄（後で埋める）\n\n〔仮〕〔空欄〕\n"
        entry, entries, _ = self.body_of(text)
        self.assertEqual((entry["kari"], entry["kuuran"]), (2, 1))
        self.assertEqual((entries[1]["kari"], entries[1]["kuuran"]), (0, 0))

    def test_fuda_variants(self):
        text = "---\ntitle: 題\n---\n\n## 0. 前提\n\n**注意:** 甲\n\n* やらない: 乙\n\n1. 済んだ合図: 丙\n"
        self.assertEqual(self.body_of(text)[0]["fuda"], ["やらない", "注意", "済んだ合図"])

    def test_folder_named_md_is_skipped(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        shelf = write_shelf(Path(self.tmp.name), {"題名A.md": GOOD})
        (shelf / "manuals" / "箱.md").mkdir()
        index = br.build_index(shelf, br.Warnings())
        self.assertEqual({e["title"] for e in index["entries"]}, {"題名A"})

    def test_empty_shelf_warns(self):
        entries, warnings = self.build({})
        self.assertEqual(entries, [])
        self.assertTrue(warnings)


class Output(unittest.TestCase):
    def test_embedded_json_cannot_close_script(self):
        text = br.embeddable_json({"a": "</script><b>& "})
        self.assertNotIn("</script>", text)
        self.assertNotIn(" ", text)
        self.assertEqual(json.loads(text)["a"], "</script><b>& ")

    def test_html_has_no_placeholder_and_no_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            shelf = write_shelf(Path(tmp) / "秘密の場所", {"題名A.md": GOOD})
            warnings = br.Warnings()
            html = br.render_html(br.build_index(shelf, warnings))
        self.assertNotIn(br.PLACEHOLDER, html)
        self.assertNotIn("秘密の場所", html)
        self.assertIn("題名A", html)

    def test_built_has_minutes(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = br.build_index(write_shelf(Path(tmp), {"題名A.md": GOOD}), br.Warnings())
        self.assertRegex(index["built"], r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$")

    def test_no_external_requests_in_template(self):
        html = (READER / br.TEMPLATE_NAME).read_text(encoding="utf-8")
        for needle in ('src="http', 'href="http', "@import", "url(", "fetch("):
            self.assertNotIn(needle, html)

    def test_missing_manuals_exits_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(br.main([tmp]), 2)


class Examples(unittest.TestCase):
    """見本の置き場が読めること。数は sketch.md の絵と同じ。"""

    def test_example_shelf(self):
        warnings = br.Warnings()
        index = br.build_index(READER.parent / "shelf" / "example", warnings)
        entries = index["entries"]
        self.assertEqual(warnings.items, [])
        self.assertEqual(len({e["title"] for e in entries}), 3)
        self.assertEqual(len(entries), 34)
        self.assertEqual(sum(e["kari"] for e in entries), 12)
        self.assertEqual(sum(e["kuuran"] for e in entries), 10)


if __name__ == "__main__":
    unittest.main()
