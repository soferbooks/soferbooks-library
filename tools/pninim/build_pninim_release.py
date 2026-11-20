"""Build the app's Pninim library (extras/pninim.js) from the website's Pninim books.

The website imported six books from Pninim (pninim.org, GNU FDL 1.3) that no other source gives
(Sofer's src/sofer/pninim_import.py, 2026-11-19): Birkei Yosef, Midrash Talpiot, Artzot HaChaim,
Asifat Zekenim, Ezra LeHavin, Tzeidah LaDerekh, with their editors' notes. The owner, 2026-11-20:
"add the pnimim library that we just added to the site".

Everything is the website's own code, read only (it reads SoferShared/library and writes only into
<out>):
1. scripts/library_app/build_sofer_library.py --books <the six and their notes> exports them as the
   Sofer Library's books are (schema-7 zips, one archive with all of them, a catalogue).
2. Here: the catalogue made Pninim's (source "pninim", their licence, and each book's notice,
   project page and dedications - pninim_import.version_notes - which the licence's Invariant
   Sections ask to keep with the text; the app shows them under the edition in the book's
   contents), and the files renamed pninim-*.

    python tools/pninim/build_pninim_release.py <out dir> --tag pninim-2026-11-20
    gh release create pninim-2026-11-20 --repo soferbooks/soferbooks-library-data --latest=false \
        <out>/release/*
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import subprocess
import sys
from pathlib import Path

SOFER = Path(r"C:/Users/morde/Sofer")
PYTHON = SOFER / ".venv" / "Scripts" / "python.exe"
REPO = Path(r"C:/Users/morde/SoferShared/library/pninim/repo")
NOTES_PREFIX = "הערות המהדיר על "
LICENSE = "GFDL 1.3"
LICENSE_URL = "https://www.gnu.org/licenses/fdl-1.3.html"


def plain(notes: str) -> str:
    """Pninim's notes (<b>, <br>) as plain lines, as the app shows an edition's notes"""
    text = re.sub(r"<br\s*/?>", "\n", notes)
    text = html.unescape(re.sub(r"<[^>]+>", "", text))
    return "\n".join(line.strip() for line in text.splitlines()).strip()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--tag", required=True)
    args = ap.parse_args()
    out = Path(args.out).resolve()
    sys.path.insert(0, str(SOFER / "src"))
    from sofer import pninim_import            # the website's code, read only

    titles = [c["en"] for c in pninim_import.BOOKS.values()]
    notes_books = [NOTES_PREFIX + c["he"] for c in pninim_import.BOOKS.values()]
    subprocess.run([str(PYTHON), str(SOFER / "scripts" / "library_app" / "build_sofer_library.py"),
                    "--out", str(out), "--tag", args.tag, "--books", "|".join(titles + notes_books)],
                   check=True, env={**os.environ, "PYTHONIOENCODING": "utf8"})
    rel = out / "release"
    cat = json.loads((rel / "sofer-library-catalog.json").read_text(encoding="utf-8"))
    notice = {c["en"]: plain(pninim_import.version_notes(REPO / folder)) + f"\n{LICENSE_URL}"
              for folder, c in pninim_import.BOOKS.items()}
    for b in cat["books"]:
        for e in [b] + b.get("companions", []):
            e["license"] = [LICENSE]
            e["versionNotesInHebrew"] = notice[b["title"]]
    cat["source"] = "pninim"
    bundle = rel / "pninim-all.zip"
    (rel / "sofer-library-all.zip").replace(bundle)
    data = bundle.read_bytes()
    cat["bundle"].update(file=bundle.name, size=len(data), sha256=hashlib.sha256(data).hexdigest(),
                         md5=hashlib.md5(data).hexdigest())
    (rel / "pninim-catalog.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1), encoding="utf-8")
    (rel / "sofer-library-catalog.json").unlink()
    (rel / "SHA256SUMS.txt").write_text("".join(
        f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in sorted(rel.iterdir())
        if p.name != "SHA256SUMS.txt"), encoding="utf-8")
    print(json.dumps({"books": len(cat["books"]), "bundle": cat["bundle"], "files": sorted(p.name for p in rel.iterdir())}))


if __name__ == "__main__":
    main()
