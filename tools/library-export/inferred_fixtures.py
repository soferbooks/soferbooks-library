"""Sofer's own placing of a commentary without links on its text, for compare_inferred.js.

Places each paragraph of a commentary (a Sofer export file: schema + text, e.g. Wikitext's
"רוקח על שיר השירים") on the verses of the text it is on (a Sefaria export file in chapters and
verses, e.g. Song of Songs' "Miqra according to the Masorah") with Sofer's code itself
(C:\\Users\\morde\\Sofer\\src, read only): mg_books.chapter_sections, QuotePlacer.marker /
.target, and the rules of build_plan's loop for a commentary with no links (kept in order; a
comment with no place goes with the one before it, else the next, else the chapter's last verse).
The loop is copied from build_plan (it is inline there); everything it calls is Sofer's.

    python -I tools\\library-export\\inferred_fixtures.py <commentary.json> <base.json> <out.json>

<out.json>: {"<commentary path joined by |>": ["<chapter>|<verse>" (0-based), how]}
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, r"C:\Users\morde\Sofer\src")

from sofer.mg_books import QuotePlacer, chapter_sections, leaves  # noqa: E402


class _Provider:
    def __init__(self, schema):
        self.schema = schema

    def get_schema(self, title):
        return self.schema


def place(comm: dict, base: dict) -> dict:
    keys, htmls = [], []
    for c, verses in enumerate(base["text"]):
        for v, html in enumerate(verses):
            keys.append((c, v))
            htmls.append(html)
    key_set = set(keys)
    order = {k: i for i, k in enumerate(keys)}
    prefixes = {k[:n] for k in keys for n in range(len(k) + 1)}
    last_in = {}
    for k in keys:
        last_in[k[:-1]] = k
        last_in[k] = k
    quotes = QuotePlacer(keys, htmls)
    text = comm["text"]
    chapter_of = chapter_sections(_Provider(comm), comm.get("title", ""), text)
    groups: dict = {}
    for path, html in leaves(text):
        npath = (chapter_of[path[0]],) + path[1:] if path and path[0] in chapter_of else path
        target, how = None, None
        if npath[:-1] in key_set:
            target, how = npath[:-1], "structure"
        if target is None:
            target = quotes.marker(npath[:-1], html)
            if target is not None:
                how = "marker"
            else:
                target = quotes.target(npath[:-1], html)
                how = "quote" if target is not None else None
        groups.setdefault(npath[:-1], []).append((path, target, how))
    out = {}
    if not any(t is not None for items in groups.values() for _, t, _ in items) \
            and not any(g in prefixes for g in groups):
        return out
    for gkey, items in groups.items():
        if not (any(t is not None for _, t, _ in items) or gkey in prefixes or gkey in key_set):
            continue
        targets, last = [], None
        for _, t, _ in items:
            ok = t is not None and (last is None or order[t] >= order[last])
            targets.append(t if ok else None)
            if ok:
                last = t
        fallback = last_in.get(gkey)
        for i, (path, _, how) in enumerate(items):
            t = targets[i]
            if t is None:
                before = next((x for x in reversed(targets[:i]) if x is not None), None)
                after = next((x for x in targets[i + 1:] if x is not None), None)
                t = (before or after) or fallback
                how = "neighbour"
                if t is None:
                    continue
            out["|".join(map(str, path))] = ["|".join(map(str, t)), how]
    return out


def main() -> int:
    comm = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    base = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8-sig"))
    Path(sys.argv[3]).write_text(json.dumps(place(comm, base), ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
