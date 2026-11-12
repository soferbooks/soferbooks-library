"""Tests for export_v7's Talmud-addressed books (as Sefaria's official export names them) and
build_sofer_library's Wikitext books the phone does not convert (Chashukei Chemed, Megillat Antiochus).

    C:\\Users\\morde\\Sofer\\.venv\\Scripts\\python.exe -m unittest tools/library-export/test_export_v7_talmud.py
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_v7 as ev  # noqa: E402

TALMUD = {"title": "Chashukei Chemed on Berakhot", "heTitle": "חשוקי חמד על ברכות",
          "schema": {"nodeType": "JaggedArrayNode", "depth": 2, "sectionNames": ["Daf", "Paragraph"],
                     "addressTypes": ["Talmud", "Integer"], "key": "Chashukei Chemed on Berakhot",
                     "titles": [{"text": "Chashukei Chemed on Berakhot", "lang": "en", "primary": True},
                                {"text": "חשוקי חמד על ברכות", "lang": "he", "primary": True}]}}


class TalmudAddresses(unittest.TestCase):
    def test_the_array_index_is_the_amud(self):
        # (Sefaria's arrays: 0 = 1a, 1 = 1b, 2 = 2a - "Berakhot 2a" is the array's third entry)
        self.assertEqual(ev.format_address("Talmud", 2, "en"), "2a")
        self.assertEqual(ev.format_address("Talmud", 3, "en"), "2b")
        self.assertEqual(ev.format_address("Talmud", 18, "en"), "10a")
        self.assertEqual(ev.format_address("Talmud", 2, "he"), "ב׳ א")
        self.assertEqual(ev.format_address("Integer", 3, "en"), "3")

    def test_sections_start_at_2a(self):
        leaf = TALMUD["schema"]
        units = ev.BookReference.enumerate_top_units(None, leaf, [6, 4])
        self.assertEqual(units, [3, 4, 5, 6])          # (1-based: 2a, 2b, 3a, 3b - no 1a, 1b)
        en, he = ev.compose_top_ref([], [], leaf["addressTypes"], units[0], 2, 1)
        self.assertEqual((en, he), (["2a"], ["ב׳ א"]))
        plain = {"depth": 2, "addressTypes": ["Perek", "Pasuk"]}
        self.assertEqual(ev.BookReference.enumerate_top_units(None, plain, [3]), [1, 2, 3])

    def test_first_section(self):
        self.assertEqual(ev.first_section_ref(TALMUD["title"], TALMUD),
                         ("Chashukei Chemed on Berakhot 2a", "חשוקי חמד על ברכות ב׳ א"))


class HebrewNumbers(unittest.TestCase):
    def test_sefarias_style(self):
        # (as Sefaria's mobile export's heRefs: "ברכות נ״ו א", "משנה ברורה ער״ד")
        cases = {1: "א׳", 10: "י׳", 15: "ט״ו", 16: "ט״ז", 56: "נ״ו", 115: "קט״ו", 270: "ע״ר",
                 274: "ער״ד", 298: "רצ״ח", 304: "ש״ד", 344: "שמ״ד", 515: "תקט״ו", 697: "תרצ״ז"}
        for n, he in cases.items():
            self.assertEqual(ev.format_address("Integer", n, "he"), he)
        self.assertEqual(ev.format_address("Talmud", 2 * 56 - 2, "he"), "נ״ו א")
        self.assertEqual(ev.format_address("Talmud", 2 * 56 - 1, "he"), "נ״ו ב")


class DefaultNode(unittest.TestCase):
    def test_a_default_node_adds_nothing_to_the_ref(self):
        schema = {"title": "Tur, Orach Chayim", "heTitle": "טור אורח חיים", "schema": {
            "nodeType": "SchemaNode", "key": "Tur, Orach Chayim", "nodes": [
                {"nodeType": "JaggedArrayNode", "key": "Introduction", "depth": 1, "addressTypes": ["Integer"],
                 "titles": [{"text": "Introduction", "lang": "en", "primary": True},
                            {"text": "הקדמה", "lang": "he", "primary": True}]},
                {"nodeType": "JaggedArrayNode", "key": "default", "default": True, "depth": 2,
                 "addressTypes": ["Siman", "Seif"], "sectionNames": ["Siman", "Seif"]}]}}
        ref = ev.BookReference(ev.Book("Tur, Orach Chayim"), schema, "טור אורח חיים")
        leaf, path = ref.leaves[1]
        self.assertEqual(ref.leaf_refs(leaf, path), ([], []))
        en, he = ev.compose_top_ref([], [], ["Siman", "Seif"], 1, 2, 2)
        self.assertEqual(ev.join_ref("Tur, Orach Chayim", en, True), "Tur, Orach Chayim 1")
        self.assertEqual(ev.join_ref("טור אורח חיים", he, True), "טור אורח חיים א׳")


class PrevNext(unittest.TestCase):
    def test_across_the_whole_book_skipping_empty_sections(self):
        files = [("X_index.json", {}),
                 ("X, Intro.metadata.json", {"ref": "X, Intro", "versions": [{"versionTitle": "v"}]}),
                 ("X 1.metadata.json", {"ref": "X 1", "versions": [{"versionTitle": "v"}]}),
                 ("X 2.metadata.json", {"ref": "X 2", "versions": []}),
                 ("X 3.metadata.json", {"ref": "X 3", "sections": {
                     "X 3:1": {"ref": "X 3:1", "versions": [{"versionTitle": "v"}]},
                     "X 3:4": {"ref": "X 3:4", "versions": [{"versionTitle": "v"}]}}}),
                 ("X 3.abc.he.json", {"ref": "X 3", "sections": {}})]
        ev.link_sections(files)
        d = {n: doc for n, doc in files}
        self.assertEqual((d["X, Intro.metadata.json"]["prev"], d["X, Intro.metadata.json"]["next"]), (None, "X 1"))
        self.assertEqual((d["X 1.metadata.json"]["prev"], d["X 1.metadata.json"]["next"]), ("X, Intro", "X 3:1"))
        self.assertEqual((d["X 2.metadata.json"]["prev"], d["X 2.metadata.json"]["next"]), ("X 1", "X 3:1"))
        inner = d["X 3.metadata.json"]["sections"]
        self.assertEqual((inner["X 3:1"]["prev"], inner["X 3:1"]["next"]), ("X 1", "X 3:4"))
        self.assertEqual((inner["X 3:4"]["prev"], inner["X 3:4"]["next"]), ("X 3:1", None))
        self.assertNotIn("prev", d["X 3.abc.he.json"])


class Itags(unittest.TestCase):
    def test_an_editors_note_anchor_stays_whole(self):
        anchor = '<i data-commentator="הערות" data-order="1"></i>'
        self.assertEqual(ev.strip_itags(f"מהר\"י{anchor} שמה <i>נטוי</i>"), f"מהר\"י{anchor} שמה נטוי")
        self.assertEqual(ev.strip_itags([["<i>א</i>"], "ב"]), [["א"], "ב"])


class WikitextNotOnPhone(unittest.TestCase):
    def test_the_two_books_and_their_notes(self):
        import build_sofer_library as bsl
        table = bsl.wikitext_not_on_phone()
        he = lambda t: bsl.wikitext_he_title(t, table)  # noqa: E731
        self.assertEqual(he("Megillat Antiochus (Rabbi Menashe Zelicha edition)"),
                         "מגילת אנטיוכוס (מהדורת הרב מנשה זליכה)")
        self.assertEqual(he("Targum Megillat Antiochus (Rabbi Menashe Zelicha edition)"),
                         "תרגום מגילת אנטיוכוס (מהדורת הרב מנשה זליכה)")
        self.assertEqual(he("Chashukei Chemed on Berakhot"), "")         # (Sofer's own Hebrew title)
        self.assertEqual(he("הערות המהדיר על חשוקי חמד על ברכות"), "")
        self.assertEqual(he("הערות המהדיר על מגילת אנטיוכוס"), "")
        self.assertEqual(he("הערות המהדיר על תרגום מגילת אנטיוכוס"), "")
        for other in ("חשוקי חמד", "Megillat Antiochus", "צרור החיים", "הערות המהדיר על צרור החיים"):
            self.assertIsNone(he(other))


if __name__ == "__main__":
    unittest.main()
