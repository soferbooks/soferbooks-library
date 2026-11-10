"""Tests for sofer_corrections.py and build_sefaria_packs.make_shards (small synthetic zips).

    python -m unittest tools/library-export/test_sofer_corrections.py
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_search  # noqa: E402
import build_sefaria_packs  # noqa: E402
import sofer_corrections as sc  # noqa: E402

MAM = "Miqra according to the Masorah"
OLD_4_13 = ("וַיֹּ֥אמֶר קַ֖יִן אֶל־יְהֹוָ֑ה גָּד֥וֹל עֲוֺנִ֖י "
            "מִנְּשֹֽׂא׃")   # (as Sefaria has it)


def make_zip(path: Path, title: str, sections: dict[str, dict[tuple[str, str], object]]):
    """sections: {section ref: {(versionTitle, lang): payload}}"""
    with zipfile.ZipFile(path, "w") as z:
        for ref, versions in sections.items():
            meta = {"ref": ref, "heRef": ref, "sectionRef": ref, "indexTitle": title,
                    "versions": [{"versionTitle": vt, "language": lang} for vt, lang in versions]}
            z.writestr(f"{ref}.metadata.json", json.dumps(meta))
            for (vt, lang), payload in versions.items():
                z.writestr(f"{ref}.{sc.version_hash(vt)}.{lang}.json", json.dumps(payload, ensure_ascii=False))


class CorrectionsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_hash_matches_js(self):
        self.assertEqual(sc.text_hash("בְּרֵאשִׁית"), "d6e86cd7efdb")   # corrections.test.js

    def test_apply_ops_guards_and_fills(self):
        payload = ["a", "b"]
        _, n = sc.apply_ops(payload, [[[1], sc.text_hash("b"), "B"], [[0], sc.text_hash("zzz"), "X"],
                                      [[3], "", "fill"]])
        self.assertEqual(n, 2)
        self.assertEqual(payload, ["a", "B", "", "fill"])

    def test_masorah_verse_correction_without_private_marks(self):
        verses = ["v"] * 26
        verses[12] = OLD_4_13
        zp = self.tmp / "Genesis.zip"
        make_zip(zp, "Genesis", {"Genesis 4": {(MAM, "he"): verses, ("JPS", "en"): ["x"] * 26}})
        files = sc.book_ops(zp, "Genesis")
        ops = files[f"Genesis 4.{sc.version_hash(MAM)}.he"]
        self.assertEqual(len(ops), 1)
        path, from_hash, new = ops[0]
        self.assertEqual((path, from_hash), ([12], sc.text_hash(OLD_4_13)))
        self.assertIn("ו" + "ֹ", new)            # מִנְּשֽׂוֹא
        self.assertNotIn("׈", new)
        self.assertNotIn("׉", new)

    def test_zohar_question_marks_and_search_text_uses_corrections(self):
        zp = self.tmp / "Zohar.zip"
        make_zip(zp, "Zohar", {"Zohar 1": {("Sulam", "he"): ["מַהוּ וַיֵּצְאוּ אִתָּם. ? ועוד", "plain"]}})
        files = sc.book_ops(zp, "Zohar")
        [(name, ops)] = files.items()
        self.assertEqual(ops[0][2], "מַהוּ וַיֵּצְאוּ אִתָּם? ועוד")
        out = self.tmp / "Zohar.txt"
        build_search.build_book(zp, out, files)
        self.assertIn("אִתָּם? ועוד", out.read_text(encoding="utf-8"))

    def test_depth_three_wrapper(self):
        zp = self.tmp / "Zohar.zip"
        with zipfile.ZipFile(zp, "w") as z:
            meta = {"ref": "Zohar 1", "sections": {
                "Zohar 1:1": {"ref": "Zohar 1:1", "versions": []},
                "Zohar 1:2": {"ref": "Zohar 1:2", "versions": [{"versionTitle": "Sulam", "language": "he"}]}}}
            z.writestr("Zohar 1.metadata.json", json.dumps(meta))
            z.writestr(f"Zohar 1.{sc.version_hash('Sulam')}.he.json", json.dumps(
                {"ref": "Zohar 1", "sections": {"Zohar 1:2": ["x", "מַהוּ אִתָּם. ?"]}}, ensure_ascii=False))
        [(name, ops)] = sc.book_ops(zp, "Zohar").items()
        self.assertEqual(ops[0][0], ["sections", "Zohar 1:2", 1])
        self.assertEqual(ops[0][2], "מַהוּ אִתָּם?")

    def test_fill_only_when_missing(self):
        vt = "The Rashi Ketuvim by Rabbi Shraga Silverstein"
        zp = self.tmp / "Psalms.zip"
        make_zip(zp, "Psalms", {"Psalms 82": {(vt, "en"): ["1", "2", "3", "4", "5", "6", "7"]}})
        ops = sc.book_ops(zp, "Psalms")[f"Psalms 82.{sc.version_hash(vt)}.en"]
        self.assertEqual(ops[0][:2], [[7], ""])
        make_zip(zp, "Psalms", {"Psalms 82": {(vt, "en"): ["1"] * 8}})
        self.assertEqual(sc.book_ops(zp, "Psalms"), {})


class ShardsTest(unittest.TestCase):
    def test_each_book_in_one_shard(self):
        packages = [
            {"en": "COMPLETE LIBRARY"},
            {"en": "TANAKH with Rashi", "indexes": ["Genesis", "Rashi on Genesis"]},
            {"en": "TANAKH and all commentaries", "indexes": ["Genesis", "Rashi on Genesis", "Ibn Ezra"]},
        ]
        shards = build_sefaria_packs.make_shards(packages, ["Genesis", "Rashi on Genesis", "Ibn Ezra", "X"])
        self.assertEqual(shards["tanakh-with-rashi"]["titles"], ["Genesis", "Rashi on Genesis"])
        self.assertEqual(shards["tanakh-and-all-commentaries"]["titles"], ["Ibn Ezra"])
        self.assertEqual(shards["other"]["titles"], ["X"])


if __name__ == "__main__":
    unittest.main()
