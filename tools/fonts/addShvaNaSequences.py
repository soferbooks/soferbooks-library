"""Let the app's fonts draw the shva na and dagesh chazak on phones that do not know them.

Unicode added U+05C8 (shva na) and U+05C9 (dagesh chazak) in 2025; Android before then treats them
as unknown characters and breaks the Hebrew line around them (seen on the 32-bit tablet, Android 11:
the words of a pasuk out of order). SoferBooks' fonts draw both (glyphs "shevana" and
"dageshxazaq"), so the app asks for them another way: a plain shva or dagesh followed by
VARIATION SELECTOR-1 (U+FE00), which every phone lays out as a mark of the letter before. This
adds to each font
  - an empty glyph for U+FE00 (it is never seen), and
  - a ccmp ligature, first in the feature: shva + U+FE00 -> shevana, dagesh + U+FE00 -> dageshxazaq.
A letter the font draws with its dagesh as one glyph (betdagesh ...) has its dagesh taken into it
before that ligature is reached, so it also gets one of its own: betdagesh + U+FE00 ->
betdagesh.xazaq, the glyph U+05C9 itself gives (2026-11-22: the dagesh chazak showed as a plain
dagesh on those letters). Nothing else in the font changes. Run again after the fonts are synced
from SoferShared:

    python -I tools/fonts/addShvaNaSequences.py android/app/src/main/assets/fonts
"""
from __future__ import annotations

import sys
from pathlib import Path

from fontTools.ttLib import TTFont, newTable  # noqa: F401
from fontTools.ttLib.tables import otTables as ot
from fontTools.ttLib.tables._g_l_y_f import Glyph

VS1 = 0xFE00
VS_GLYPH = "uniFE00"
PAIRS = {"sheva": "shevana", "dagesh": "dageshxazaq"}   # base point -> its marked form


def patch(path: Path) -> str:
    font = TTFont(path)
    cmap = font.getBestCmap()
    names = set(font.getGlyphOrder())
    if any(g not in names for g in list(PAIRS) + list(PAIRS.values())):
        return f"{path.name}: no shva na glyphs, left as it is"
    gsub = font["GSUB"].table
    # (already done: the ligature is there - the letters' own added if they are not)
    for lookup in gsub.LookupList.Lookup:
        for st in lookup.SubTable:
            if getattr(st, "ligatures", None) and "sheva" in st.ligatures and any(
                    VS_GLYPH in lig.Component for lig in st.ligatures["sheva"]):
                added = _letters(font, st)
                if not added:
                    return f"{path.name}: already has it"
                font.save(path)
                return f"{path.name}: dagesh chazak by U+FE00 on {added} letters drawn with their dagesh"
    # the empty glyph for U+FE00
    if VS_GLYPH not in names:
        order = font.getGlyphOrder() + [VS_GLYPH]
        font.setGlyphOrder(order)
        font["glyf"].glyphs[VS_GLYPH] = Glyph()
        font["hmtx"].metrics[VS_GLYPH] = (0, 0)
        font["maxp"].numGlyphs = len(order)
        if "GDEF" in font and font["GDEF"].table.GlyphClassDef:
            font["GDEF"].table.GlyphClassDef.classDefs[VS_GLYPH] = 3      # (a mark)
    for table in font["cmap"].tables:
        if table.isUnicode() and table.format in (4, 12):
            table.cmap[VS1] = VS_GLYPH
    # the ligature lookup, first in every ccmp
    st = ot.LigatureSubst()
    st.Format = 1
    st.ligatures = {}
    for base, marked in PAIRS.items():
        lig = ot.Ligature()
        lig.Component = [VS_GLYPH]
        lig.LigGlyph = marked
        st.ligatures[base] = [lig]
    _letters(font, st)
    lookup = ot.Lookup()
    lookup.LookupType = 4
    lookup.LookupFlag = 0
    lookup.SubTable = [st]
    lookup.SubTableCount = 1
    gsub.LookupList.Lookup.append(lookup)
    gsub.LookupList.LookupCount = len(gsub.LookupList.Lookup)
    index = len(gsub.LookupList.Lookup) - 1
    added = 0
    for fr in gsub.FeatureList.FeatureRecord:
        if fr.FeatureTag == "ccmp":
            fr.Feature.LookupListIndex = [index] + list(fr.Feature.LookupListIndex)
            fr.Feature.LookupCount = len(fr.Feature.LookupListIndex)
            added += 1
    if not added:
        return f"{path.name}: no ccmp feature, left as it is"
    font.save(path)
    return f"{path.name}: shva na and dagesh chazak by U+FE00 ({added} ccmp)"


def _letters(font, st) -> int:
    """betdagesh + U+FE00 -> betdagesh.xazaq for every letter drawn with its dagesh (added to `st`)"""
    names = set(font.getGlyphOrder())
    added = 0
    for name in font.getGlyphOrder():
        marked = f"{name}.xazaq"
        if name == "dagesh" or marked not in names or name in st.ligatures:
            continue
        lig = ot.Ligature()
        lig.Component = [VS_GLYPH]
        lig.LigGlyph = marked
        st.ligatures[name] = [lig]
        added += 1
    return added


def main() -> None:
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else "android/app/src/main/assets/fonts")
    for f in sorted(folder.glob("*.ttf")):
        if f.stem.split("_")[0] in ("FrankSofer", "VilnaSofer", "Hadassah", "MekorotRashi"):
            print(patch(f))


if __name__ == "__main__":
    main()
