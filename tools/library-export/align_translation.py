"""Lay a translation out on its original's sections, passage by passage.

Rabbi Eliezer Ben-David's "Return to Your Homes" is the English of his "Shuvu Lachem
LeOhaleichem" (sofer.saba.ENGLISH_BOOKS), but the two Word files were laid out separately: the
English splits chapter 4 in two, has no פיוט at the end, and breaks paragraphs and headings
differently.  The owner (2026-11-11) wants the English as a translation of the Hebrew book,
shown beside it.  Sofer has no aligner for these books (only enwikisource.py's "whole chapters
whose se'ifim count alike"), so this uses the Gale-Church length-based aligner (NLTK's, copied
in third_party/ under Apache 2.0) twice, the second inside the first one's result:

1. the sections under the headings (all of them, the whole book at once: the chapters are
   numbered differently), 2. the paragraphs of each pair of sections.

Each Hebrew passage gets the English paragraphs aligned to it (joined), so the English edition
has exactly the Hebrew's sections and passages; an English paragraph aligned to nothing is
added to the passage before it (nothing is lost).  Lengths are letters without markup or
nikud, the English scaled by the book's overall English/Hebrew ratio.

    python tools/library-export/align_translation.py   # prints the pairs, for checking by eye
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "third_party"))
from gale_church import align_blocks  # noqa: E402

_TAGS = re.compile(r"<[^>]+>")
_MARKS = re.compile(r"[\u0591-\u05C7\s]")


def length(x) -> int:
    """Letters in a passage, a list of them or a section (markup, nikud and spaces left out)."""
    if isinstance(x, str):
        return len(_MARKS.sub("", _TAGS.sub("", x)))
    if isinstance(x, list):
        return sum(length(y) for y in x)
    if isinstance(x, dict):
        return sum(length(y) for y in x.values())
    return 0


def leaves(text, path=()):
    """[(path, [passages])] of a book's text (Sofer's export layout: named parts -> lists)."""
    if isinstance(text, dict):
        out = []
        for k, v in text.items():
            out += leaves(v, path + (k,))
        return out
    if isinstance(text, list) and all(isinstance(p, str) for p in text):
        return [(path, text)]
    return [(path, [p for p in _flat(text)])]


def _flat(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, list):
        for y in x:
            yield from _flat(y)


def _groups(links, n_src, n_tgt):
    """Gale-Church links -> for each source index, the target indices aligned to it (a target
    aligned to nothing goes with the source before it, or the first one)."""
    out = [[] for _ in range(n_src)]
    owner = {}
    for i, j in links:
        if j not in owner:
            owner[j] = i
    last = 0
    for j in range(n_tgt):
        last = owner.get(j, last)
        out[last].append(j)
    return out


def _align(src_lens, tgt_lens, ratio, unit):
    """Gale-Church on lengths counted in `unit` letters: the model's variance is set for
    sentences, so chapters and sections are counted in bigger units (else every length
    difference looks huge and whole chapters are dropped)."""
    if not src_lens:
        return []
    if not tgt_lens:
        return [[] for _ in src_lens]
    scaled = [max(1, round(t / ratio / unit)) for t in tgt_lens]
    src = [max(1, round(s / unit)) for s in src_lens]
    return _groups(align_blocks(src, scaled), len(src), len(scaled))


# letters per length unit at each level (chapters, sections, paragraphs)
UNITS = (100, 20, 5)


def align(original: dict, translation: dict, joiner: str = "<br>", units=UNITS) -> tuple[dict, dict]:
    """The translation laid out as the original: a text with the original's keys and, in each
    section, one passage per original passage.  Returns (text, report)."""
    ratio = (length(translation) or 1) / (length(original) or 1)
    report = {"ratio": round(ratio, 3), "chapters": [], "sections": [], "passages": 0, "empty": 0}
    src_ch, tgt_ch = list(original.items()), list(translation.items())
    chapter_groups = _align([length(v) for _, v in src_ch], [length(v) for _, v in tgt_ch], ratio, units[0])
    out = {}
    for (key, he), cg in zip(src_ch, chapter_groups):
        report["chapters"].append([key, [tgt_ch[j][0] for j in cg]])
        he_leaves = leaves(he, (key,))
        en_leaves = [lf for j in cg for lf in leaves(tgt_ch[j][1], (tgt_ch[j][0],))]
        section_groups = _align([length(p) for _, p in he_leaves], [length(p) for _, p in en_leaves], ratio, units[1])
        for (path, he_paras), sg in zip(he_leaves, section_groups):
            report["sections"].append([" / ".join(path), [" / ".join(en_leaves[j][0]) for j in sg]])
            en_paras = [p for j in sg for p in en_leaves[j][1]]
            pg = _align([length(p) for p in he_paras], [length(p) for p in en_paras], ratio, units[2])
            passages = [joiner.join(en_paras[j] for j in g) for g in pg]
            report["passages"] += len(passages)
            report["empty"] += sum(1 for p in passages if not p)
            node = out
            for k in path[:-1]:
                node = node.setdefault(k, {})
            node[path[-1]] = passages
    return _ordered(original, out), report


def _ordered(original, aligned):
    """The aligned text in the original's order (with every key the original has)."""
    if isinstance(original, dict):
        return {k: _ordered(v, (aligned or {}).get(k) if isinstance(aligned, dict) else None)
                for k, v in original.items()}
    return aligned if aligned is not None else []


if __name__ == "__main__":
    import json
    R = Path(r"C:\Users\morde\Sofer\data\sefaria-export\json\Jewish Thought\Rabbi Eliezer Ben-David")
    V = "Rabbi Eliezer Ben-David (family edition).json"
    he = json.loads((R / "Shuvu Lachem LeOhaleichem" / "Hebrew" / V).read_text(encoding="utf-8-sig"))["text"]
    en = json.loads((R / "Return to Your Homes" / "English" / V).read_text(encoding="utf-8-sig"))["text"]
    text, rep = align(he, en)
    print(json.dumps(rep, ensure_ascii=False))
    for path, paras in leaves(he):
        node = text
        for k in path:
            node = node[k]
        for h, e in zip(paras, node):
            print("HE:", _TAGS.sub("", h)[:110])
            print("EN:", _TAGS.sub("", e)[:110])
            print()
