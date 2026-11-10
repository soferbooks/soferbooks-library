/**
 * A book as sections and paragraphs, and the text rules every extra source shares.
 *
 * A thin JavaScript port of the parts of Sofer's importer that the phone needs
 * (C:\Users\morde\Sofer\src\sofer\importers.py: _Node, norm_title, safe, the "headings
 * inside the text" step _inline_sections/_inline_run, and restricted()). Names and
 * comments follow Sofer's so the two can be compared line by line; behaviour changes
 * belong in Sofer first. Pure functions only (no React Native), tested in
 * __tests__/extras.test.js.
 */

// ---------------------------------------------------------------- names

const UNSAFE = /[\\/:*?"<>|\x00-\x1f]/g;
const NIKUD = /[\u0591-\u05C9]/g;           // Sofer's _NIKUD (cantillation, vowels, maqaf ...)
const NIKUD_ONE = /[\u0591-\u05C9]/;

/** A name that can be a file name (and stays the book's key): importers.safe */
export function safe(name) {
  let s = String(name || '').replace(UNSAFE, '-').trim().replace(/\.+$/, '');
  s = s.replace(/\s+/g, ' ');
  return s.slice(0, 120) || 'untitled';
}

/** For finding the same sefer under slightly different spellings: importers.norm_title */
export function normTitle(t) {
  let s = String(t || '').replace(/[-\u2013\u05BE]/g, ' ');   // a maqaf or dash joins words
  s = s.replace(NIKUD, '');
  s = s.replace(/["'\u05F4\u05F3\u201D\u201C\u2018\u2019,.()[\]]/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** Tags taken out: importers._plain */
export const plain = s => String(s || '').replace(/<[^>]+>/g, '').trim();

/** Python's str.splitlines() */
export const splitLines = text => String(text || '').split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);

// ---------------------------------------------------------------- the book's sections

/** importers._Node (without the editors' notes, which only Wikitext and Ben-Yehuda have yet) */
export class Node {
  constructor(title) {
    this.title = title;
    this.paras = [];
    this.children = [];
  }

  addChild(title) {
    if (this.paras.length && !this.children.length) {
      // text before the first heading inside this section: an unnamed first part
      const first = new Node('');
      first.paras = this.paras;
      this.paras = [];
      this.children.push(first);
    }
    const n = new Node(title);
    this.children.push(n);
    return n;
  }

  addPara(text) {
    if (this.children.length) {          // text after the sub-sections: with the last one
      this.children[this.children.length - 1].deepest().paras.push(text);
    } else {
      this.paras.push(text);
    }
  }

  deepest() {
    return this.children.length ? this.children[this.children.length - 1].deepest() : this;
  }

  empty() {
    return !this.paras.length && this.children.every(c => c.empty());
  }

  hasNotes() { return false; }
}

// ---------------------------------------------------------------- headings inside the text
// Many books have a whole page on one line, with the headings inside it ("... הקטן יעקב:
// סימן ז ב"ה אלטאנא ..."). A heading there is a word like "סימן" and a number, at the start
// of a paragraph or right after a sentence ends; it counts only as one of a run of such
// headings numbered in order (one number may be missing), which a reference to another place
// ("(סי' מ"א)") almost never is.

const INLINE_WORDS = ['סימן', "סי'", 'פרק', 'שאלה', 'אות', 'תשובה', 'דרוש', 'מאמר', 'כלל', 'שער', 'ענף', 'חקירה', 'דף'];
const INLINE_SOURCE = `(?:^|(?<=[:.]))\\s*(${INLINE_WORDS.join('|')})\\s+`
  + '([א-ת]{1,3}(?:["\u05F4\'\u05F3][א-ת]?)?)(?=[\\s.:,)\\-]|$)';
const LETTER_VALUES = {};
'אבגדהוזחטיכךלמםנןסעפףצץקרשת'.split('').forEach((c, i) => {
  LETTER_VALUES[c] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 20, 30, 40, 40, 50, 50, 60, 70, 80, 80, 90, 90,
    100, 200, 300, 400][i];
});
export const INLINE_MIN = 5;       // headings in a run, at least
const LEADING_PUNCT = /^\s*([.:!,;?])\s*/;

/** A Hebrew number ("קס"ה" = 165, "טו" = 15), or null for a word that is not one */
export function hebrewNumber(s) {
  s = String(s).replace(/["\u05F4'\u05F3]/g, '');
  if (!s || [...s].some(c => !(c in LETTER_VALUES))) { return null; }
  const v = [...s].map(c => LETTER_VALUES[c]);
  const sorted = [...v].sort((a, b) => b - a);
  if (v.some((x, i) => x !== sorted[i]) && !['טו', 'טז'].includes(s.slice(-2))) { return null; }
  return v.reduce((a, b) => a + b, 0);
}

/** The text without nikud, and where each of its letters is in the text */
function bareWithMap(text) {
  const out = [];
  const where = [];
  for (let i = 0; i < text.length; i++) {
    if (!NIKUD_ONE.test(text[i])) {
      out.push(text[i]);
      where.push(i);
    }
  }
  where.push(text.length);
  return [out.join(''), where];
}

function countIn(haystack, needle, end) {
  let n = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0 && at + needle.length <= end) {
    n += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return n;
}

/** importers._inline_run: the longest run of headings numbered in order, [] when short */
export function inlineRun(paras) {
  const cands = [];
  paras.forEach((p, pi) => {
    const [bare, where] = bareWithMap(p);
    const re = new RegExp(INLINE_SOURCE, 'g');
    let m;
    while ((m = re.exec(bare)) !== null) {
      const n = hebrewNumber(m[2]);
      if (n) {
        const word = m[1] === "סי'" ? 'סימן' : m[1];
        const s1 = m.index + /^\s*/.exec(m[0])[0].length;   // where group 1 (the word) starts
        const end = m.index + m[0].length;
        const h = bare.slice(s1, end);
        cands.push([word, n, pi, where[s1], where[end], h, countIn(bare, h, s1)]);
      }
      if (m[0].length === 0) { re.lastIndex += 1; }
    }
  });
  let best = [];
  for (const word of [...new Set(cands.map(c => c[0]))]) {
    const cs = cands.filter(c => c[0] === word);
    const ends = new Map();       // number -> [longest run ending there, its last heading]
    const back = [];
    let top = null;
    cs.forEach((c, i) => {
      let prev = null;
      for (const k of [1, 2]) {
        const e = ends.get(c[1] - k);
        if (e && (!prev || e[0] > prev[0] || (e[0] === prev[0] && e[1] > prev[1]))) { prev = e; }
      }
      const length = prev ? prev[0] + 1 : 1;
      back[i] = prev ? prev[1] : null;
      if (!ends.has(c[1]) || ends.get(c[1])[0] < length) { ends.set(c[1], [length, i]); }
      if (top === null || length > top[0]) { top = [length, i]; }
    });
    if (top && top[0] > best.length) {
      const run = [];
      let i = top[1];
      while (i !== null && i !== undefined) {
        run.push(cs[i].slice(2));
        i = back[i];
      }
      best = run.reverse();
    }
  }
  return best.length >= INLINE_MIN ? best : [];
}

/**
 * importers._inline_sections: a book with at most one section and headings inside its text
 * gets one section for each heading, cut out of its paragraph; otherwise the book as it is.
 */
export function inlineSections(tree) {
  const parts = tree.children.filter(c => !c.empty());
  if (parts.filter(c => c.title).length > 1 || parts.some(c => c.children.length) || tree.hasNotes()) {
    return tree;
  }
  const owners = tree.paras.map(() => tree).concat(...parts.map(c => c.paras.map(() => c)));
  const paras = tree.paras.concat(...parts.map(c => c.paras));
  const run = inlineRun(paras);
  if (!run.length) { return tree; }
  const out = new Node('');
  out.inlineRun = run;
  const keep = new Map([[tree, out]]);    // the book's own sections before the first heading
  const cut = new Map();
  for (const [pi, a, b] of run) {
    if (!cut.has(pi)) { cut.set(pi, []); }
    cut.get(pi).push([a, b]);
  }
  let current = null;                    // the section of the last heading
  paras.forEach((p, pi) => {
    const pieces = [];
    let pos = 0;
    for (const [a, b] of cut.get(pi) || []) {
      pieces.push([null, p.slice(pos, a)]);
      pieces.push([p.slice(a, b).replace(/\s+/g, ' ').trim(), null]);
      pos = b;
    }
    pieces.push([null, p.slice(pos)]);
    let after = false;
    for (const [heading, raw] of pieces) {
      if (heading !== null) {
        current = out.addChild(heading);
        after = true;
        continue;
      }
      const text = (after ? raw.replace(LEADING_PUNCT, '') : raw).trim();
      after = false;
      if (!text) { continue; }
      if (current === null && !keep.has(owners[pi])) {
        keep.set(owners[pi], out.addChild(owners[pi].title));
      }
      (current || keep.get(owners[pi])).addPara(text);
    }
  });
  return out;
}

// ---------------------------------------------------------------- a book's own notice
// importers.restricted (Mordy, 2026-10-11): a book whose own notice, near its start, says
// "personal study only", "not for commercial use", or "all rights reserved" without a free
// licence is not offered. Pninim's "all rights reserved ... under the free GNU licence" is free.
// (Python's \b is a Unicode word boundary: Hebrew letters count as word letters, so "NC" must
//  not touch a Hebrew letter either.)

const W = 'A-Za-z0-9_\u0590-\u05FF';
const NON_COMMERCIAL = new RegExp('לא מסחרי|לשימוש אישי|ללימוד אישי|לימוד אישי בלבד|שימוש אישי בלבד|'
  + `non[- ]?commercial|(?<![${W}])NC(?![${W}])|-NC-|BY-NC`, 'i');
const RESERVED = /כל הזכו?יות שמורות|©|all rights reserved/i;
const FREE = /GNU|GPL|GFDL|CC[- ]?BY(?![- ]?NC)|CC0|Creative Commons|רישיון חופשי|הרישיון החופשי|נחלת הכלל|public domain/i;
export const NOTICE_LETTERS = 20000;

export function restricted(text) {
  const head = String(text || '').slice(0, NOTICE_LETTERS);
  if (NON_COMMERCIAL.test(head)) { return true; }
  return RESERVED.test(head) && !FREE.test(head);
}

// Editions whose own notice reserves their rights to someone who gave permission (Sofer's
// licenses.PERMISSIONS): [notice, the licence they are given]
export const PERMISSIONS = [
  // (Mordy, 2026-10-30: "My cousin (Rav Yosef Peretz) gave me permission to put his books on" -
  //  his Machon Pi Yesharim's editions in Otzaria's MoreBooks collection)
  [/שמורות\s+ל(?:ה?רב\s+)?יוסף\s+פרץ|מכון\s+פי\s+ישרים/, 'By permission of Rav Yosef Peretz (Machon Pi Yesharim, Panama)'],
];

/** The permission a restricted book's notice names (its licence), or null: licenses.permitted */
export function permission(text) {
  const head = String(text || '').slice(0, 5000);
  const found = PERMISSIONS.find(([notice]) => notice.test(head));
  return found ? found[1] : null;
}
