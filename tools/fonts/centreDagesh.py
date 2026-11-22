"""Put the dagesh in the middle of ב כ ת ס מ פ (and the mapiq of ה) in the app's fonts.

Owner, 2026-11-22: "It seems that the dagesh isn't centered in ת ב ס". Each font draws these letters
with a dagesh as one glyph made of the letter and the dagesh at an offset (betdagesh = bet +
dagesh at (481, 0) in Frank Sofer). Measured against the letter's own inside, the dot was off in
every font: in ב and כ about 85 units (of a letter about 800 wide) toward the right stroke, in ת
up to 35 toward the right leg, in ס up to 40 too high. This moves the dagesh of those glyphs to

  ב כ  the middle, left to right, of the letter's inside (the white inside the letter's outline,
       its open side closed off: its convex hull), at the height the font gives it;
  ת    halfway between the two legs, at the height the font gives it;
  ס    the middle of the closed space;
  מ פ, the mapiq in ה  the middle of the white around it, left-right and up-down (מ in Frank
       Sofer, פ in Vilna Sofer - on its tongue -, ה in Hadassah; checked 2026-11-22 with every other
       letter, whose dot beside or under the stroke - ג ד ו ז י ך ר ... - is as the letters are
       written). ט is left as the fonts draw it (owner, 2026-11-22: "ט should revert").

Nothing else in the font changes; running it again changes nothing. Run after the fonts are synced
from SoferShared (after addShvaNaSequences.py):

    python -I tools/fonts/centreDagesh.py android/app/src/main/assets/fonts

(The fonts in SoferShared/fonts are the website team's: the same change belongs in their font tools.)
"""
from __future__ import annotations

import sys
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw

# precomposed letter -> (plain letter, how its middle is found)
LETTERS = {0xFB31: (0x05D1, "inside-x"), 0xFB3B: (0x05DB, "inside-x"),
           0xFB4A: (0x05EA, "between-legs"), 0xFB41: (0x05E1, "inside"),
           # (checked the same way, 2026-11-22: מ in Frank Sofer, the mapiq in Hadassah's ה, פ in
           #  Vilna Sofer; not ט, as the fonts draw it - owner)
           0xFB3E: (0x05DE, "around"), 0xFB34: (0x05D4, "between-legs"),
           0xFB44: (0x05E4, "around")}
# The dagesh of ז nearer the letter (owner, 2026-11-22: "ז to the right"): just under half the white
# between the dot and the stem closed, in each font (Frank Sofer had 54 units, Hadassah 144) - the
# dot's place in each font, as the font drew it (x) and where it is put
ZAYIN = {"FrankSofer": (125, 149), "FrankSofer_bold": (125, 139), "VilnaSofer": (27, 73),
         "VilnaSofer_bold": (27, 67), "Hadassah": (26, 91), "Hadassah_bold": (37, 91)}

# (a move further than this is a measuring mistake - the left leg of Frank Sofer's ה does not reach
#  the dot's height - and is left out)
MOST = 150
FONTS = ("FrankSofer", "VilnaSofer", "Hadassah")
SCALE = 0.5          # pixels per font unit while measuring
ORIGIN = (300, 1500)  # where (0, 0) of the glyph is drawn, in font units from the image's top left


class _Polygons(BasePen):
    """The glyph's contours as polygons (curves flattened)."""

    def __init__(self, glyphset):
        super().__init__(glyphset)
        self.polygons, self._cur = [], []

    def _moveTo(self, p):
        self._cur = [p]

    def _lineTo(self, p):
        self._cur.append(p)

    def _curveToOne(self, p1, p2, p3):
        p0 = self._cur[-1]
        for i in range(1, 9):
            t = i / 8
            m = 1 - t
            self._cur.append((m ** 3 * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t ** 3 * p3[0],
                              m ** 3 * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t ** 3 * p3[1]))

    def _qCurveToOne(self, p1, p2):
        p0 = self._cur[-1]
        for i in range(1, 9):
            t = i / 8
            m = 1 - t
            self._cur.append((m * m * p0[0] + 2 * m * t * p1[0] + t * t * p2[0],
                              m * m * p0[1] + 2 * m * t * p1[1] + t * t * p2[1]))

    def _closePath(self):
        if self._cur:
            self.polygons.append(self._cur)
        self._cur = []

    _endPath = _closePath


def _px(x, y):
    return (x + ORIGIN[0]) * SCALE, (ORIGIN[1] - y) * SCALE


def _units(px, py):
    return px / SCALE - ORIGIN[0], ORIGIN[1] - py / SCALE


def _hull(points):
    pts = sorted(set(points))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _middle(glyphset, letter: str, dot: tuple, how: str) -> tuple:
    """Where the dot's centre belongs in `letter` (font units), from where it is now."""
    pen = _Polygons(glyphset)
    glyphset[letter].draw(pen)
    size = (int(2000 * SCALE), int(2200 * SCALE))
    ink = Image.new("1", size, 0)
    for poly in pen.polygons:      # (even-odd: a counter drawn inside a contour is a hole)
        m = Image.new("1", size, 0)
        ImageDraw.Draw(m).polygon([_px(x, y) for x, y in poly], fill=1)
        ink = Image.frombytes("1", size, bytes(a ^ b for a, b in zip(ink.tobytes(), m.tobytes())))
    ink_px = ink.load()
    sx, sy = (int(v) for v in _px(*dot))
    def runs(x, y):
        left = right = up = down = 0
        while x - left - 1 >= 0 and not ink_px[x - left - 1, y]:
            left += 1
        while x + right + 1 < size[0] and not ink_px[x + right + 1, y]:
            right += 1
        while y - up - 1 >= 0 and not ink_px[x, y - up - 1]:
            up += 1
        while y + down + 1 < size[1] and not ink_px[x, y + down + 1]:
            down += 1
        return left, right, up, down
    if how == "around":
        # (the middle of the white around it, left-right and up-down: found again from there)
        x, y = sx, sy
        for _ in range(3):
            left, right, up, down = runs(x, y)
            x, y = int(x + (right - left) / 2), int(y + (down - up) / 2)
        return _units(x, y)
    if how == "between-legs":
        left = right = 0
        while sx - left - 1 >= 0 and not ink_px[sx - left - 1, sy]:
            left += 1
        while sx + right + 1 < size[0] and not ink_px[sx + right + 1, sy]:
            right += 1
        return _units(sx + (right - left) / 2, sy)[0], dot[1]
    hull = Image.new("1", size, 0)
    ImageDraw.Draw(hull).polygon([_px(x, y) for x, y in _hull([p for poly in pen.polygons for p in poly])], fill=1)
    hull_px = hull.load()
    seen, stack, sum_x, sum_y, n = set(), [(sx, sy)], 0, 0, 0
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < size[0] and 0 <= y < size[1]):
            continue
        seen.add((x, y))
        if ink_px[x, y] or not hull_px[x, y]:
            continue
        sum_x, sum_y, n = sum_x + x, sum_y + y, n + 1
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    cx, cy = _units(sum_x / n, sum_y / n)
    return (cx, dot[1]) if how == "inside-x" else (cx, cy)


def patch(path: Path) -> str:
    font = TTFont(path)
    cmap = font.getBestCmap()
    glyf = font["glyf"]
    glyphset = font.getGlyphSet()
    moved = []
    for composed, (plain, how) in LETTERS.items():
        name, letter = cmap.get(composed), cmap.get(plain)
        if not name or not letter:
            continue
        # (the letter with a dagesh chazak too: betdagesh.xazaq - addShvaNaSequences.py)
        for glyph in (name, f"{name}.xazaq"):
            if glyph in glyf.keys() and glyf[glyph].isComposite():
                moved += _centre(glyf, glyphset, glyph, letter, plain, how)
    # ז: its dot nearer the stem (ZAYIN), the plain dagesh and the chazak
    places = ZAYIN.get(path.stem)
    zayin = cmap.get(0xFB36)
    for glyph in ((zayin, f"{zayin}.xazaq") if places and zayin else ()):
        if glyph in glyf.keys() and glyf[glyph].isComposite():
            dot = next((c for c in glyf[glyph].components if c.glyphName != cmap.get(0x05D6)), None)
            if dot is not None and dot.x == places[0]:
                dot.x = places[1]
                glyf[glyph].recalcBounds(glyf)
                moved.append(f"ז{' chazak' if glyph.endswith('.xazaq') else ''} ({places[0]})->({places[1]})")
    if not any("not moved" not in m for m in moved):
        return f"{path.name}: already in the middle" + "".join(f", {m}" for m in moved)
    font.save(path)
    return f"{path.name}: " + ", ".join(moved)


def _centre(glyf, glyphset, name, letter, plain, how) -> list:
    """Move the dagesh of glyph `name` (the letter `letter` and a dagesh) to the letter's middle."""
    comps = glyf[name].components
    dagesh = next((c for c in comps if c.glyphName != letter), None)
    if dagesh is None or len(comps) != 2:
        return []
    bp = BoundsPen(glyphset)
    glyphset[dagesh.glyphName].draw(bp)
    x0, y0, x1, y1 = bp.bounds
    dot = ((x0 + x1) / 2 + dagesh.x, (y0 + y1) / 2 + dagesh.y)
    tx, ty = _middle(glyphset, letter, dot, how)
    nx, ny = round(dagesh.x + tx - dot[0]), round(dagesh.y + ty - dot[1])
    if abs(nx - dagesh.x) > MOST or abs(ny - dagesh.y) > MOST:
        return [f"{chr(plain)}{' chazak' if name.endswith('.xazaq') else ''}: not moved (measured {nx - dagesh.x:+},{ny - dagesh.y:+})"]
    if abs(nx - dagesh.x) > 6 or abs(ny - dagesh.y) > 6:   # (closer than that: measuring noise)
        label = f"{chr(plain)}{' chazak' if name.endswith('.xazaq') else ''} ({dagesh.x},{dagesh.y})->({nx},{ny})"
        dagesh.x, dagesh.y = nx, ny
        glyf[name].recalcBounds(glyf)
        return [label]
    return []


def main(folder: str) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    # (SoferBooks' own fonts only: the others are not checked)
    for path in sorted(Path(folder).glob("*.ttf")):
        if path.name.startswith(FONTS):
            print(patch(path))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "android/app/src/main/assets/fonts")
