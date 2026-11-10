"""Tests for the licence filter of build_sefaria_packs.py (what the public release may host).

    python -m unittest tools/library-export/test_licence_filter.py
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_sefaria_packs as bsp  # noqa: E402
import sofer_corrections as sc  # noqa: E402

OPEN, CLOSED, NOLIC = "Open Hebrew", "Closed English, All rights reserved", "No licence"


def make_book(path: Path):
    versions = [{"versionTitle": CLOSED, "language": "en"}, {"versionTitle": OPEN, "language": "he"}]
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("Genesis_index.json", json.dumps({"title": "Genesis", "versions": [
            {"versionTitle": CLOSED, "language": "en", "license": "Copyright: Someone"},
            {"versionTitle": OPEN, "language": "he", "license": "Public Domain"},
        ]}))
        z.writestr("Genesis 1.metadata.json", json.dumps(
            {"ref": "Genesis 1", "heRef": "Genesis 1", "versions": versions}))
        z.writestr(f"Genesis 1.{sc.version_hash(CLOSED)}.en.json", json.dumps(["In the beginning"]))
        z.writestr(f"Genesis 1.{sc.version_hash(OPEN)}.he.json", json.dumps(["בראשית ברא"]))
        # a book whose only version has no licence at all
        z.writestr("Genesis 2.metadata.json", json.dumps(
            {"ref": "Genesis 2", "heRef": "Genesis 2", "versions": [{"versionTitle": NOLIC, "language": "en"}]}))
        z.writestr(f"Genesis 2.{sc.version_hash(NOLIC)}.en.json", json.dumps(["Heaven and earth"]))


class LicenceFilterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_classification(self):
        for lic in ("Public Domain", "PD", "CC0", "CC-BY", "CC-BY-SA", "CC-BY-NC", "CC-BY-NC-SA",
                    "CC BY-SA 4.0"):
            self.assertTrue(bsp.licence_open(lic), lic)
        for lic in ("Copyright: Steinsaltz Center", "Copyright", "unknown", "CC-BY-NC-ND",
                    "All rights reserved", "", None):
            self.assertFalse(bsp.licence_open(lic), lic)

    def test_hosted_text_keeps_open_versions_only(self):
        zp = self.tmp / "Genesis.zip"
        make_book(zp)
        r = bsp.build_book(zp, "Genesis", self.tmp / "_search" / "Genesis.txt",
                           self.tmp / "_hosted" / "Genesis.txt", corrections=False)
        full = (self.tmp / "_search" / "Genesis.txt").read_text(encoding="utf-8")
        hosted = (self.tmp / "_hosted" / "Genesis.txt").read_text(encoding="utf-8")
        # the full text (trigram index input) has everything
        self.assertIn("In the beginning", full)
        self.assertIn("Heaven and earth", full)
        # the hosted copy has the open version only
        self.assertEqual(hosted, f"Genesis 1:1\tGenesis 1:1\the\t{OPEN}\tבראשית ברא\n")
        self.assertEqual(r["lines"], 3)
        self.assertEqual(r["hosted_lines"], 1)
        self.assertEqual(r["excluded"], {("en", CLOSED): ("Copyright: Someone", 1), ("en", NOLIC): (None, 1)})

    def test_corrections_of_closed_versions_are_dropped(self):
        files = {f"Genesis 1.{sc.version_hash(OPEN)}.he": [[[0], "", "x"]],
                 f"Genesis 1.{sc.version_hash(CLOSED)}.en": [[[0], "", "y"]]}
        kept = bsp.hosted_corrections(files, {("he", OPEN)})
        self.assertEqual(list(kept), [f"Genesis 1.{sc.version_hash(OPEN)}.he"])


if __name__ == "__main__":
    unittest.main()
