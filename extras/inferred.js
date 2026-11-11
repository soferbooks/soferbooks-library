/**
 * The "obvious" connections of a downloaded extra book that nobody published links for: a
 * commentary found by its name ("רוקח על שיר השירים" is on שיר השירים) and each of its paragraphs
 * put on the passage it explains - as Sofer does when it prints such a commentary beside its text.
 *
 * A port of Sofer (C:\Users\morde\Sofer\src\sofer, read only); names follow Sofer's so the two can
 * be compared line by line, and tools/library-export/compare_inferred.js checks the port against
 * Sofer's own code on the same books:
 *   library.infer_commentaries / _name_key   which book a book "X על Y" is on
 *   mg_books.chapter_sections                its sections numbered by their headings ("פרק א")
 *   mg_books.QuotePlacer (marker, target)    a paragraph that is only a verse's number; the words
 *                                            a comment opens with in bold (its dibbur hamaschil)
 *   mg_books.build_plan's loop               "arranged like the main text, one level deeper"; the
 *                                            places kept in order; a comment with no place of its
 *                                            own goes with the one before it (else the next)
 *   hebrew.gematria                          Hebrew numbers
 * What is added to Sofer's rules (the phone has no Sefaria links file to find more by):
 *   - headings numbered at every level, not only the top one, and with more words before the
 *     number (סימן, סעיף, פסוק, הלכה, משנה, מזמור, אות, דף ...), so a book in פרק > פסוק is put on
 *     its verses; a level where only some headings are numbers (a הקדמה beside the פרקים) is
 *     numbered where it can be, and those links are "likely";
 *   - the base may be another downloaded extra book, numbered by its headings the same way;
 *   - doubtful matches are kept (the owner, 2026-11-11), marked: confidence 'sure' for what Sofer
 *     places by itself (structure, a verse's number, the quoted words), 'likely' for the rest
 *     (a comment placed beside its neighbours, a name found only by its spelling or among two).
 * Pure functions only (tested in __tests__/extrasInferred.test.js); extras/index.js does the I/O.
 */

// ---------------------------------------------------------------- Hebrew numbers (hebrew.gematria)

const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];
// (numbers whose plain spelling makes an unpleasant word: hebrew._AVOIDED_WORDS)
const AVOIDED = {
  270: 'ער', 272: 'ערב', 274: 'עדר', 275: 'ערה', 298: 'רחצ', 304: 'דש', 344: 'שדמ',
  670: 'עתר', 672: 'תערב', 674: 'עדרת', 698: 'תרחצ', 744: 'תשדמ',
};

/** hebrew.gematria (1-999: no thousands are needed here) */
export function gematria(n) {
  if (!Number.isInteger(n) || n < 1 || n > 999) { throw new Error(`gematria: ${n}`); }
  if (AVOIDED[n]) { return AVOIDED[n]; }
  let out = '';
  let hundreds = Math.floor(n / 100);
  const rest = n % 100;
  while (hundreds >= 4) { out += 'ת'; hundreds -= 4; }
  out += HUNDREDS[hundreds];
  if (rest === 15) { return `${out}טו`; }
  if (rest === 16) { return `${out}טז`; }
  return out + TENS[Math.floor(rest / 10)] + ONES[rest % 10];
}

const NUMBERS = new Map();
for (let n = 1; n <= 999; n++) { NUMBERS.set(gematria(n), n); }

/** A number as Sefaria writes it in a Hebrew ref: "א׳", "י״ב" */
export const heNumber = n => {
  const g = gematria(n);
  return g.length === 1 ? `${g}\u05F3` : `${g.slice(0, -1)}\u05F4${g.slice(-1)}`;
};

// ---------------------------------------------------------------- headings (chapter_sections)

// Sofer: ^(פרק|פרשה|שער)\s+ ; the rest added (see above)
const HEADING_WORDS = ['פרק', 'פרשה', 'שער', 'סימן', "סי'", 'סעיף', 'פסוק', 'הלכה', 'משנה', 'מזמור', 'אות',
  'דף', 'מאמר', 'כלל', 'ענף', 'שאלה', 'תשובה', 'דרוש'];
const HEADING = new RegExp(`^(${HEADING_WORDS.map(w => w.replace(/'/g, '')).join('|')})\\s+`);

/**
 * A heading's number (1 for "פרק א", "א", "פרק א'"), or null: mg_books.chapter_sections's rule
 * (the quotes taken out, the word before the number, the number exactly as gematria writes it).
 */
export function headingNumber(he) {
  // (and the stops around it: Otzaria's "\u05D0." "(\u05D1)")
  const s = String(he || '').trim().replace(/['"\u05F3\u05F4]/g, '').replace(/^[([]\s*|\s*[.:,)\]]+$/g, '');
  const n = NUMBERS.get(s.replace(HEADING, '').trim());
  return n === undefined ? null : n;
}

/**
 * The book's sections ([{keys, heTitles}], extras/schema7.js sectionsOf's leaves) as paths of
 * numbers where their headings are numbers (0-based, as Sefaria's addresses), else their keys:
 * [{path, likely}]. At each level, the sections under one part are numbered when their numbers
 * are all different and at least half of the named ones have one (Sofer: all, at the top only).
 */
export function numberPaths(leaves) {
  const kids = new Map();            // parent path -> Map(key -> heading)
  for (const l of leaves) {
    for (let d = 0; d < l.keys.length; d++) {
      const parent = l.keys.slice(0, d).join('|');
      if (!kids.has(parent)) { kids.set(parent, new Map()); }
      kids.get(parent).set(l.keys[d], l.heTitles[d]);
    }
  }
  const mapped = new Map();          // parent path -> {map: key -> index, partial}
  for (const [parent, m] of kids) {
    const named = [...m.keys()].filter(k => !/^S0/.test(k));
    const nums = new Map();
    named.forEach(k => { const n = headingNumber(m.get(k)); if (n !== null) { nums.set(k, n - 1); } });
    const unique = new Set(nums.values()).size === nums.size;
    if (nums.size && unique && nums.size * 2 >= named.length) {
      mapped.set(parent, {map: nums, partial: nums.size < named.length});
    }
  }
  return leaves.map(l => {
    let likely = false;
    const path = l.keys.map((k, d) => {
      const at = mapped.get(l.keys.slice(0, d).join('|'));
      if (at && at.map.has(k)) {
        likely = likely || at.partial;
        return at.map.get(k);
      }
      return k;
    });
    return {path, likely};
  });
}

// ---------------------------------------------------------------- a comment's opening words

const HEBREW_WORD = /[א-ת]+/g;
// markup._NIKUD
const NIKUD = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05C8\u05C9\uFB1E]/g;
// mg_books._DIBBUR, _VERSE_MARK
const DIBBUR = /^\s*(?:דבר אחר[,:]?\s*)?(?:<[^>]+>\s*)*<b>([\s\S]*?)<\/b>/;
const VERSE_MARK = /^\s*<b>\s*([א-ת]{1,3})\s*<\/b>\s*$/;
const PREFIX_LETTERS = 'בהוכלמש';
const MAX_WORDS = 4;                  // QuotePlacer.MAX_WORDS

/** mg_books._hebrew_words: the Hebrew words of a text (no tags, nikud, punctuation; a maqaf a space) */
export const hebrewWords = html => String(html || '').replace(NIKUD, '').replace(/<[^>]+>/g, ' ')
  .replace(/\u05BE/g, ' ').match(HEBREW_WORD) || [];

/** mg_books._same_word: the same word, allowing a letter of prefix on either */
export const sameWord = (a, b) => a === b
  || (b.length > 2 && PREFIX_LETTERS.includes(b[0]) && b.slice(1) === a)
  || (a.length > 2 && PREFIX_LETTERS.includes(a[0]) && a.slice(1) === b);

/**
 * What a commentary's paragraph says of its place, kept with the book (a short string):
 * "m:ג" a paragraph that is only a verse's number (QuotePlacer.marker), "d:w1 w2" the words it
 * opens with in bold (QuotePlacer.target's dibbur, at most four), "" neither.
 */
export function paraSign(html) {
  const mark = VERSE_MARK.exec(html || '');
  if (mark) { return `m:${mark[1]}`; }
  const m = DIBBUR.exec(html || '');
  const words = m ? hebrewWords(m[1]).slice(0, MAX_WORDS) : [];
  return words.length ? `d:${words.join(' ')}` : '';
}

// ---------------------------------------------------------------- placing (build_plan's loop)

const K = path => path.join('|');

/**
 * Each paragraph of a commentary put on a unit (passage) of the text it is on.
 * comm:  [{path, likely, signs: [paraSign]}]   its sections in order (path: numberPaths)
 * units: [{key, words}]                        the text's passages in order (key: their path,
 *                                              words: hebrewWords of the passage, or null when
 *                                              only the structure is known)
 * -> [{leaf, para, unit, how}]  how: 'structure' | 'marker' | 'quote' | 'neighbour'
 */
export function placeComments(comm, units) {
  const keys = units.map(u => K(u.key));
  const order = new Map(keys.map((k, i) => [k, i]));
  const span = new Map();            // a prefix of the keys -> [first unit, after the last]
  units.forEach((u, i) => {
    for (let n = 0; n <= u.key.length; n++) {
      const p = K(u.key.slice(0, n));
      if (!span.has(p)) { span.set(p, [i, i]); }
      span.get(p)[1] = i + 1;
    }
  });
  const words = units.map(u => u.words || []);
  const first = new Map();           // a word (and without its prefix) -> units having it
  words.forEach((ws, i) => {
    const set = new Set(ws);
    ws.forEach(x => { if (x.length > 2 && PREFIX_LETTERS.includes(x[0])) { set.add(x.slice(1)); } });
    for (const w of set) {
      if (!first.has(w)) { first.set(w, []); }
      first.get(w).push(i);
    }
  });
  const cursor = new Map();
  const lastIn = new Map();          // a chapter (or unit) -> its last unit (c_last_in)
  keys.forEach((k, i) => {
    lastIn.set(K(units[i].key.slice(0, -1)), i);
    lastIn.set(k, i);
  });

  const marker = (chapter, letters) => {
    const s = span.get(chapter);
    if (!s) { return null; }
    let n = null;
    for (let k = 1; k <= s[1] - s[0]; k++) { if (gematria(k) === letters) { n = k; break; } }
    if (n === null) { return null; }
    cursor.set(chapter, s[0] + n - 1);
    return s[0] + n - 1;
  };
  const target = (chapter, dibbur) => {
    const s = span.get(chapter);
    if (!dibbur.length || !s) { return null; }
    const start = Math.max(cursor.has(chapter) ? cursor.get(chapter) : s[0], s[0]);
    const cands = [...new Set([...(first.get(dibbur[0]) || []),
      ...(dibbur[0].length > 2 ? first.get(dibbur[0].slice(1)) || [] : [])])].sort((a, b) => a - b);
    for (const i of cands) {
      if (i < start) { continue; }
      if (i >= s[1]) { break; }
      const ws = words[i];
      for (let p = 0; p < ws.length; p++) {
        let all = true;
        for (let j = 0; j < dibbur.length; j++) {
          if (!(p + j < ws.length && sameWord(dibbur[j], ws[p + j]))) { all = false; break; }
        }
        if (all) {
          cursor.set(chapter, i);
          return i;
        }
      }
    }
    return null;
  };

  const groups = new Map();          // (comment path minus its last index) -> [{leaf, para, t, how}]
  comm.forEach((leaf, li) => {
    const g = K(leaf.path);
    (leaf.signs || []).forEach((sign, j) => {
      if (sign === null) { return; }  // (an empty paragraph: mg_books.leaves skips it)
      let t = null;
      let how = null;
      if (order.has(g)) {            // arranged like the main text, one level deeper
        t = order.get(g);
        how = 'structure';
      } else if (sign.startsWith('m:')) {
        t = marker(g, sign.slice(2));
        how = 'marker';
      }
      if (t === null && sign) {      // (a verse's number that is not one: its bold word, as a quote)
        t = target(g, sign.slice(2).split(' '));
        how = 'quote';
      }
      if (!groups.has(g)) { groups.set(g, []); }
      groups.get(g).push({leaf: li, para: j, t, how: t === null ? null : how});
    });
  });
  const out = [];
  const any = [...groups.values()].some(items => items.some(x => x.t !== null));
  if (!any && ![...groups.keys()].some(g => span.has(g))) { return out; }   // (nothing has a place)
  for (const [g, items] of groups) {
    if (!items.some(x => x.t !== null) && !span.has(g) && !order.has(g)) { continue; }
    // (the places kept in order: one before the last placed is no place)
    let last = null;
    const targets = items.map(x => {
      const ok = x.t !== null && (last === null || x.t >= last);
      if (ok) { last = x.t; }
      return ok ? x.t : null;
    });
    const fallback = lastIn.has(g) ? lastIn.get(g) : null;
    items.forEach((x, i) => {
      let t = targets[i];
      let how = x.how;
      if (t === null) {
        // (a commentary placed by its words: a comment with none follows the one before it;
        //  otherwise it goes with the next)
        let before = null;
        for (let k = i - 1; k >= 0 && before === null; k--) { before = targets[k]; }
        let after = null;
        for (let k = i + 1; k < items.length && after === null; k++) { after = targets[k]; }
        t = before !== null ? before : (after !== null ? after : fallback);
        how = 'neighbour';
        if (t === null) { return; }
      }
      out.push({leaf: x.leaf, para: x.para, unit: t, how});
    });
  }
  return out;
}

// ---------------------------------------------------------------- which book (infer_commentaries)

const HE_ON = /^(.+?) על (.+)$/;
// library._NIKUD_ETC, _DASHES
const NIKUD_ETC = /[\u0591-\u05C9"'\u05F3\u05F4\u201C\u201D\u2018\u2019,.()[\]]/g;
const DASHES = /[-\u2013\u05BE]/g;

/** library._name_key: a name for comparing (no nikud, quotes or punctuation; a maqaf a space) */
export const nameKey = name => String(name || '').replace(DASHES, ' ').replace(NIKUD_ETC, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

/** A name by its letters alone (supercommentary.skeleton, library._bare_he): for a "likely" match */
const spellingKey = name => nameKey(name).replace(/^ספר /, '').replace(/^ה(?=[א-ת]{3})/, '')
  .replace(/[ךםןףץ]/g, c => 'כמנפצ'['ךםןףץ'.indexOf(c)])
  .split(' ').map(w => w.replace(/[וי]/g, '') || w).join(' ');

/**
 * The book a book is on, by its name ("X על Y": Y), among `books` ([{key, title, heTitle,
 * commentary}]: Sefaria's and the downloaded extra books; commentary: Sefaria's catalogue says it
 * is one). library.infer_commentaries: Y found by its main names, never a commentary, never the
 * book itself; one book only. Beyond it (all 'likely'): Y by its spelling alone; a name that fits
 * two books - Sefaria's first, else the first; Y a commentary when no other book has its name
 * (a supercommentary). -> {book, confidence, why} or {book: null, why}
 */
export function inferBase(heTitle, books, self = null) {
  const m = HE_ON.exec(String(heTitle || '').trim());
  if (!m) { return {book: null, why: 'its name is not "X על Y"'}; }
  const want = nameKey(m[2]);
  const others = books.filter(b => b.key !== self);
  const byName = others.filter(b => nameKey(b.heTitle) === want || nameKey(b.title) === want);
  let opts = byName.filter(b => !b.commentary);
  let confidence = 'sure';
  let why = 'by its name';
  if (!opts.length) {
    const spelled = others.filter(b => spellingKey(b.heTitle) === spellingKey(m[2]));
    opts = spelled.filter(b => !b.commentary);
    if (opts.length) {
      confidence = 'likely';
      why = 'by the spelling of its name';
    }
  }
  if (!opts.length && byName.length) {
    opts = byName;
    confidence = 'likely';
    why = 'a commentary on a commentary, by its name';
  }
  if (!opts.length) { return {book: null, why: `no book named "${m[2]}"`}; }
  const unique = [...new Map(opts.map(b => [b.key, b])).values()];
  if (unique.length > 1) {
    confidence = 'likely';
    why = `${unique.length} books named "${m[2]}": the first taken`;
    unique.sort((a, b) => (a.kind === 'sefaria' ? 0 : 1) - (b.kind === 'sefaria' ? 0 : 1));
  }
  return {book: unique[0], confidence, why};
}

// ---------------------------------------------------------------- the links

/**
 * The links of a commentary to the text it is on, in extras/links.js's format
 * ({a, ah, t, th, r: 'base', c: 'sure' | 'likely'}: a explains t).
 * comm:  {leaves: [[ref, heRef, keys, heTitles, signs]]}   (what extras/links.js keeps of a book)
 * base:  {units: [{key, ref, he, words}]}
 */
export function inferredLinks(comm, base, likelyBook = false) {
  const leaves = comm.leaves || [];
  const paths = numberPaths(leaves.map(l => ({keys: l[2], heTitles: l[3]})));
  const placed = placeComments(leaves.map((l, i) => ({...paths[i], signs: l[4] || []})), base.units);
  const out = [];
  for (const p of placed) {
    const l = leaves[p.leaf];
    const u = base.units[p.unit];
    const sure = p.how !== 'neighbour' && !paths[p.leaf].likely && !likelyBook;
    out.push({a: `${l[0]}:${p.para + 1}`, ah: `${l[1]} ${p.para + 1}`, t: u.ref, th: u.he, r: 'base',
      c: sure ? 'sure' : 'likely', how: p.how});
  }
  return out;
}

/** Which chapters (0-based, at the top) of a book in numbered sections a commentary needs */
export function chaptersWanted(comm) {
  const leaves = comm.leaves || [];
  const paths = numberPaths(leaves.map(l => ({keys: l[2], heTitles: l[3]})));
  return [...new Set(paths.map(p => p.path[0]).filter(x => typeof x === 'number'))].sort((a, b) => a - b);
}

/** The units of a Sefaria book in chapters and verses: chapters [[n (0-based), [verse html]]] */
export function sefariaUnits(title, heTitle, chapters) {
  const units = [];
  for (const [n, verses] of chapters) {
    (verses || []).forEach((v, i) => {
      units.push({key: [n, i], ref: `${title} ${n + 1}:${i + 1}`,
        he: `${heTitle} ${heNumber(n + 1)}:${heNumber(i + 1)}`, words: hebrewWords(v)});
    });
  }
  return units;
}

/**
 * The units of a downloaded extra book: its sections ([[ref, heRef, keys, heTitles, signs]]) numbered by
 * their headings, each paragraph a unit ({ref: [paragraph html]} its text, when it was loaded).
 */
export function extraUnits(leaves, texts = {}) {
  const paths = numberPaths(leaves.map(l => ({keys: l[2], heTitles: l[3]})));
  const units = [];
  leaves.forEach((l, i) => {
    const paras = texts[l[0]];
    const n = paras ? paras.length : (l[4] || []).length;
    for (let j = 0; j < n; j++) {
      units.push({key: paths[i].path.concat(j), ref: `${l[0]}:${j + 1}`, he: `${l[1]} ${j + 1}`,
        words: paras ? hebrewWords(paras[j]) : null});
    }
  });
  return units;
}
