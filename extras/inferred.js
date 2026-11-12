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
 * base:  {units: [{key, ref, he, words}]}   (the Gemara's also dibburim, perakim, unread: looseComments)
 */
export function inferredLinks(comm, base, likelyBook = false) {
  return runSteps(inferredSteps(comm, base, likelyBook));
}

/**
 * inferredLinks a few milliseconds at a time, the app answering between (QA round 17: placing a
 * Gemara commentary on a whole masechta took 22 s at once, and taps waited for it)
 */
export function inferredLinksAsync(comm, base, likelyBook = false, pause = undefined) {
  return runStepsAsync(inferredSteps(comm, base, likelyBook), pause);
}

function* inferredSteps(comm, base, likelyBook = false) {
  const leaves = comm.leaves || [];
  const paths = numberPaths(leaves.map(l => ({keys: l[2], heTitles: l[3]})));
  // (the Gemara by amudim: a heading's "דף קיב" is no chapter 112 - Sofer's rules are for chapters)
  const talmud = base.units.some(u => u.amud !== undefined);
  let placed = talmud ? [] : placeComments(leaves.map((l, i) => ({...paths[i], signs: l[4] || []})), base.units);
  if (!placed.some(p => p.how !== 'neighbour')) {
    // (Sofer's rules found no place: the comments' opening words, matched loosely - beyond Sofer)
    placed = yield* looseSteps(leaves.map((l, i) => ({path: paths[i].path, heTitles: l[3], openings: l[5] || []})),
      base.units, {dibburim: base.dibburim || null, perakim: base.perakim || [], unread: base.unread || null});
  }
  const out = [];
  for (const p of placed) {
    const l = leaves[p.leaf];
    const u = base.units[p.unit];
    // (a quote found whole in one place, a dibbur of Rashi's or Tosafos': sure; beside another
    //  comment, or only at the daf its siman names: likely)
    const sure = (p.how === 'loose' || p.how === 'dibbur' ? p.exact
      : p.how !== 'neighbour' && p.how !== 'loose-neighbour' && p.how !== 'daf')
      && !paths[p.leaf].likely && !likelyBook;
    out.push({a: `${l[0]}:${p.para + 1}`, ah: `${l[1]} ${p.para + 1}`, t: u.ref, th: u.he, r: 'base',
      c: sure ? 'sure' : 'likely', how: p.how});
  }
  return out;
}

// ---------------------------------------------------------------- loose matching (loose_placement.py)
// For a commentary Sofer's rules cannot place (Dicta's pages without headings, a commentary on the
// Gemara under "דף ב." headings): each comment's opening words - what it quotes, its dibbur
// hamaschil - looked for in the text it is on, in order, forgiving the scan's errors (a word
// missing or misread), a letter of prefix, and full or short spelling. Where the commentary says
// which daf (a heading "דף ב." / "דף ב ע"א", or a comment opening "ע"ב"), only that amud and the
// ones beside it are searched. A comment not found goes with the one before it (else the next).
// All 'likely', except a quote found whole, and in one place only of where it was looked for.
//
// Sofer's placement recheck (Sofer src/sofer/loose_placement.py, dibburim.py, masechta_pieces.py,
// 2026-11-12), ported here so the phone places as Sofer does, given the same text:
//   - a comment on Rashi's or Tosafos' words ("בתוס' בד"ה ...", "[רש"י ד"ה ...]", "בד"ה") goes on the
//     Gemara line their dibbur is on (Sefaria's Rashi and Tosafos are arranged by the Gemara's lines);
//   - a quote spelled its own way is found by its letters in the amud named (rapidfuzz's partial
//     ratio, ported exactly: partialRatioAtLeast);
//   - essays on the daf, too few of whose comments quote the Gemara, are placed siman by siman at the
//     daf each names ("סימן יח - לדף ט", "דף כג", "שם" / "עוד בענין" continuing): bySiman.

const NIKUD_ALL = /[֑-ׇ]/g;
/** A paragraph's opening, as kept for loose matching (no tags or nikud, 80 letters) */
export const paraOpening = html => String(html || '').replace(NIKUD_ALL, '').replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, 80);

const Q = '["\'׳״]';
const QG = new RegExp(Q, 'g');
// what a comment opens with before its quote: which text it is on ("גמ'", "בתוס' ד"ה", "מתני'"),
// its daf ("דף ב ע"א", "ע"ב"), "שם", "פי'"
// (and the masechet and perek running into the first comment - "ברכות פרק א משעה שהכהנים" in the
//  copy of Rishon LeTzion with nikud by computer - as Sofer's loose_placement.py _LEADER has it)
const LEADER = new RegExp(`^(?:[([]\\s*)?(?:(?:[א-ת]+\\s+){0,2}פרק\\s+[א-ת]{1,3}${Q}?[א-ת]?|דף\\s+[א-ת]{1,3}${Q}?[א-ת]?\\s*(?:[.:]|ע${Q}?\\s*[אב]${Q}?)?`
  + `|ע${Q}\\s*[אב]${Q}?|ו?ב?(?:גמ(?:רא)?|מתני(?:תין)?|משנה|במשנה|רש${Q}י|פרש${Q}י|פירש${Q}י|תוס(?:פות)?|תד${Q}ה`
  + `|ד${Q}ה|בא${Q}ד|שם|פי|פירוש|בפירוש|הרי${Q}ף|הר${Q}ן|רא${Q}ש)${Q}?)(?=[\\s.,:)\\]]|$)[\\s.,:)\\]]*`);
const CUT = new RegExp(`ו?כו${Q}|וגו${Q}|וגומר|וכולי|[.:\\-–—]`);

/** The words a comment quotes (its loose dibbur hamaschil): after its leaders, to "וכו'" or a stop */
export function looseQuote(opening) {
  let s = String(opening || '').trim();
  for (let k = 0; k < 6; k++) {
    const m = LEADER.exec(s);
    if (!m || !m[0]) { break; }
    s = s.slice(m[0].length);
  }
  // (an abbreviation - ר"ג, רשב"י - stands for words the text writes out: any one word)
  const words = s.split(CUT)[0].replace(NIKUD_ALL, '').split(/\s+/)
    .map(w => (new RegExp(`[א-ת]${Q}[א-ת]`).test(w) ? '*' : (hebrewWords(w)[0] || '')))
    .filter(w => w === '*' || w.length > 1);
  while (words.length && words[0] === '*') { words.shift(); }
  const out = words.slice(0, 6);
  while (out.length && out[out.length - 1] === '*') { out.pop(); }
  return out;
}

const FINALS = {'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ'};
const unfinal = w => w.replace(/[ךםןףץ]/g, c => FINALS[c]);
/** supercommentary.skeleton / loose_placement._skel: without ו and י, final letters as others */
const skel = w => unfinal(w).replace(/[וי]/g, '') || w;
const near = (q, w) => sameWord(q, w) || sameWord(skel(q), skel(w));

const AMUD = new RegExp(`^(?:[([]\\s*)?דף\\s+([א-ת]{1,3}${Q}?[א-ת]?)\\s*(?:([.:])|ע${Q}?\\s*([אב]))?`);
const SIDE = new RegExp(`^ע${Q}\\s*([אב])`);

/**
 * The amud a heading or a comment's opening names: {daf, side ('a' | 'b' | null)} or null.
 * "דף ב." "דף ב:" "דף ב ע"א" "דף קיב"; an opening "ע"ב" alone: {daf: null, side}.
 */
export function amudOf(text) {
  const s = String(text || '').replace(NIKUD_ALL, '').trim();
  let m = AMUD.exec(s);
  if (m) {
    const daf = NUMBERS.get(m[1].replace(QG, ''));
    if (!daf) { return null; }
    const side = m[2] === '.' || m[3] === 'א' ? 'a' : (m[2] === ':' || m[3] === 'ב' ? 'b' : null);
    return {daf, side};
  }
  m = SIDE.exec(s);
  return m ? {daf: null, side: m[1] === 'א' ? 'a' : 'b'} : null;
}

/** An amud's place among a masechta's (Sefaria's: 1a is 0) */
export const amudIndex = (daf, side) => 2 * daf - 2 + (side === 'b' ? 1 : 0);

// ---- what a siman's heading or first lines say of its place (loose_placement.py)

// (Python's \b after a Hebrew word: no letter or digit follows)
const WORD_END = '(?![0-9A-Za-z_\\u05D0-\\u05EA\\u05F0-\\u05F2])';
// a heading's daf anywhere in it ("סימן יח - לדף ט", "(סימן כו - לדף צה)"), or the masechta's start
const NAMED_DAF = new RegExp(`(?:^|[\\s(\\[\\-–—])ל?דף\\s+([א-ת]{1,3}${Q}?[א-ת]?)(?=[\\s.,:)\\]]|$)\\s*(?:([.:])|ע${Q}?\\s*([אב]))?`);
const START = new RegExp(`\\(?\\s*(?:ב?ריש|בתחילת|תחילת)\\s+(?:ה)?(?:מסכת(?:א|ין)?|המסכתא)${WORD_END}`);
const ORDINALS = {
  'ראשון': 1, 'שני': 2, 'שלישי': 3, 'רביעי': 4, 'חמישי': 5, 'ששי': 6, 'שישי': 6, 'שביעי': 7, 'שמיני': 8,
  'תשיעי': 9, 'עשירי': 10, 'אחד עשר': 11, 'שנים עשר': 12, 'שלשה עשר': 13, 'שלושה עשר': 13,
  'ארבעה עשר': 14, 'חמשה עשר': 15, 'חמישה עשר': 15, 'ששה עשר': 16, 'שישה עשר': 16, 'שבעה עשר': 17,
  'שמונה עשר': 18, 'תשעה עשר': 19, 'עשרים': 20,
};
const PEREK = /^\s*\(?\s*פרק\s+(?:של\s+)?(.+?)\s*\)?\s*$/;
// what a comment says it is on before its quote, when Rashi's or Tosafos' (by their dibbur)
const ON_TOSAFOT = new RegExp(`^(?:ו?ב?(?:תוס(?:פות|${Q})?|תוד${Q}ה|תד${Q}ה))(?=[\\s.,:]|$)`);
const ON_RASHI = new RegExp(`^(?:ו?ב?(?:רש${Q}י|פירש${Q}י|פרש${Q}י|פירוש\\s+רש${Q}י|קונטרס|הקונטרס))(?=[\\s.,:]|$)`);
const ON_DH = new RegExp(`^ו?ב?ד${Q}ה(?=[\\s.,:]|$)`);
// a comment's own number before it: "א)", "(ב)", "ג."
const ENUM = new RegExp(`^\\s*\\(?[א-ת]{1,2}\\)\\s*|^\\s*[א-ת]{1,2}\\.\\s+|^\\s*\\(?(?:הלכה|פיסקא|סעיף)\\s+[א-ת]{1,2}${Q}?\\)?[\\s.,:]+`);
const DIBBUR_WORD = new RegExp(`[א-ת]+(?:${Q}[א-ת]+)*`, 'g');
// a daf named inside a siman's first lines ("ובהא דאמרו בגמרא דף ה'") - not another masechet's
const INNER_DAF = `(\\S+)\\s+ב?דף\\s+([א-ת]{1,3}${Q}?[א-ת]?)(?=[\\s.,:)\\]]|$)\\s*(?:ע${Q}?\\s*([אב]))?`;
const ABBREVIATED = new Set(['ב"ק', 'ב"מ', 'ב"ב', 'ע"ז', 'ר"ה', 'מו"ק', 'בב"ק', 'בב"מ', 'בב"ב', 'בע"ז', "פ'", 'פרק', 'בפרק', "בפ'"]);
// (sofer.wikisource.MASECHTOS: the masechtos' names, a word of one before "דף" is not this one's daf)
const MASECHTOS = ['ברכות', 'שבת', 'עירובין', 'פסחים', 'שקלים', 'יומא', 'סוכה', 'ביצה', 'ראש השנה', 'תענית',
  'מגילה', 'מועד קטן', 'חגיגה', 'יבמות', 'כתובות', 'נדרים', 'נזיר', 'סוטה', 'גיטין', 'קידושין', 'בבא קמא',
  'בבא מציעא', 'בבא בתרא', 'סנהדרין', 'מכות', 'שבועות', 'עבודה זרה', 'הוריות', 'זבחים', 'מנחות', 'חולין',
  'בכורות', 'ערכין', 'תמורה', 'כריתות', 'מעילה', 'תמיד', 'נידה', 'נדה'];
const MASECHET_WORDS = new Set([].concat(...MASECHTOS.map(n => n.split(' ').flatMap(w => [w, `ב${w}`]))));
// a siman on the same place as the one before: "שם," / "עוד בענין ..." / "בענין הנ"ל"
const SAME_PLACE = new RegExp(`^(?:שם[\\s,.]|עוד\\s+ב|בענין\\s+הנ${Q}ל)`);
const WORDS_LIKE_NUMBERS = new Set(['לא', 'לו', 'מה', 'כה', 'עד', 'פה', 'מי', 'זה', 'זו']);

/** A comment's opening without its own number ("א)", "הלכה ה", "פיסקא", "יא מתני'") */
export function stripNumber(text) {
  let t = text;
  for (let k = 0; k < 2; k++) {
    t = t.replace(ENUM, '');
    const s = t.trim();
    const i = s.indexOf(' ');
    const first = i < 0 ? s : s.slice(0, i);
    const rest = i < 0 ? '' : s.slice(i + 1);
    if (rest && first.length > 0 && first.length <= 2 && !WORDS_LIKE_NUMBERS.has(first) && NUMBERS.get(first)) { t = rest; }
  }
  return t;
}

/** A daf of this masechet named in the first words of a siman's text: {daf, side} or null */
export function innerDaf(text) {
  const re = new RegExp(INNER_DAF, 'g');
  const s = text.slice(0, 100);
  let m;
  while ((m = re.exec(s)) !== null) {
    const before = m[1].replace(/[.,:;()]/g, '');
    if (MASECHET_WORDS.has(before) || ABBREVIATED.has(before) || ABBREVIATED.has(before.replace(QG, '"'))) { continue; }
    const daf = NUMBERS.get(m[2].replace(QG, ''));
    if (daf) { return {daf, side: m[3] === 'א' ? 'a' : (m[3] === 'ב' ? 'b' : null)}; }
  }
  return null;
}

/** The amud a section's heading names anywhere in it ("סימן יח - לדף ט", "(ריש המסכת)": 2a), or null */
export function namedDaf(heading) {
  const s = String(heading || '').replace(NIKUD_ALL, '');
  const m = NAMED_DAF.exec(s);
  if (m) {
    const daf = NUMBERS.get(m[1].replace(QG, ''));
    if (daf) { return {daf, side: m[2] === '.' || m[3] === 'א' ? 'a' : (m[2] === ':' || m[3] === 'ב' ? 'b' : null)}; }
  }
  return START.test(s) ? {daf: 2, side: 'a'} : null;
}

/** The perek a heading names ("פרק תשיעי", "פרק של שלשה עשר", "פרק ט"), or null */
export function perekNumber(heading) {
  const m = PEREK.exec(String(heading || '').replace(NIKUD_ALL, ''));
  if (!m) { return null; }
  const t = m[1].replace(QG, '').trim();
  return ORDINALS[t] || (t.length <= 3 ? NUMBERS.get(t) || null : null);
}

/** Whose dibbur a comment opens with: 'tosafot', 'rashi', 'either' (a bare "בד"ה"), or null - after a daf it names */
export function onCommentary(openingText) {
  let s = openingText.trim();
  const m = AMUD.exec(s) || SIDE.exec(s);
  if (m) { s = s.slice(m[0].length).replace(/^[ .,:)\]]+/, ''); }
  if (ON_TOSAFOT.test(s)) { return 'tosafot'; }
  if (ON_RASHI.test(s)) { return 'rashi'; }
  if (ON_DH.test(s)) { return 'either'; }
  return null;
}

/** A dibbur's words as its quote is matched (an abbreviation one word, its marks dropped) */
const dibburWords = text => (String(text || '').replace(NIKUD_ALL, '').match(DIBBUR_WORD) || []).map(w => w.replace(QG, ''));

// ---- Rashi's and Tosafos' dibburim (dibburim.py)

// what opens a dibbur before its words: "מתני'", "גמ'", "הג"ה", "ה"ג", "בא"ד"
const DIBBUR_LEAD = new RegExp(`^\\s*(?:(?:מתני(?:תין)?|גמ(?:רא)?|הג${Q}ה|ה${Q}ג|בא${Q}ד|שם)${Q}?\\s+)+`);
const plainText = html => String(html || '').replace(NIKUD_ALL, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const stripEnds = (s, chars) => {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) { a++; }
  while (b > a && chars.includes(s[b - 1])) { b--; }
  return s.slice(a, b);
};

/** A comment's dibbur hamaschil: its bold opening, else up to " - " or the first stop */
export function dibburOf(html) {
  const m = /^\s*<b>([\s\S]*?)<\/b>/.exec(html || '');
  let t = m && plainText(m[1]).length > 1 ? plainText(m[1]) : '';
  if (!t) {
    const s = plainText(html);
    const cut = /\s[-–—]\s|[.:]/.exec(s);
    t = cut && cut.index <= 100 ? s.slice(0, cut.index) : s.split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
  }
  return stripEnds(t.replace(DIBBUR_LEAD, ''), ' -–—.:');
}

/**
 * Rashi's and Tosafos' comments on a masechta as dibburim.load gives them: {rashi, tosafot} each
 * [[amud index (1a = 0), [line: html or [html]]]] -> Map(amud -> [{who, words, text, line}]) in line order.
 */
export function dibburimOf({rashi = [], tosafot = []} = {}) {
  const out = new Map();
  for (const [who, amudim] of [['rashi', rashi], ['tosafot', tosafot]]) {
    for (const [ai, lines] of amudim || []) {
      (Array.isArray(lines) ? lines : []).forEach((line, li) => {
        for (const c of Array.isArray(line) ? line : [line]) {
          if (typeof c === 'string' && c.trim()) {
            if (!out.has(ai)) { out.set(ai, []); }
            out.get(ai).push({who, words: dibburOf(c), text: plainText(c), line: li});
          }
        }
      });
    }
  }
  for (const v of out.values()) { v.sort((a, b) => a.line - b.line); }   // (stable: Rashi before Tosafos on a line)
  return out;
}

const skeleton = w => unfinal(w).replace(/[וי]/g, '');
/** dibburim.alike: two words alike, or one the other's start by their letters (3 or more) */
function alike(a, b) {
  if (near(a, b)) { return true; }
  const x = skeleton(a);
  const y = skeleton(b);
  return Math.min(x.length, y.length) >= 3 && Math.abs(x.length - y.length) <= 2 && (x.startsWith(y) || y.startsWith(x));
}

/**
 * dibburim.find: {amud, line} of the first dibbur on `amuds` (in order) whose words open with the
 * quote q (by `who` when given; on the first amud the first at or after line `after` if any), or null.
 */
function findDibburLine(index, amuds, q, who, after) {
  if (!q.some(w => w !== '*')) { return null; }
  for (let n = 0; n < amuds.length; n++) {
    const ai = amuds[n];
    const hits = [];
    for (const d of index.get(ai) || []) {
      if (who && d.who !== who) { continue; }
      // (the comment from its dibbur on: a quote often runs on into its words) ...
      const dw = dibburWords(d.text.replace(DIBBUR_LEAD, '')).slice(0, q.length);
      if (dw.length >= q.length && q.every((a, i) => a === '*' || near(a, dw[i]))) { hits.push(d.line); continue; }
      // ... or the dibbur alone: its first word and most of the rest alike
      const dib = dibburWords(d.words.replace(DIBBUR_LEAD, ''));
      const k = Math.min(q.length, dib.length);
      if (!k || q[0] === '*' || !alike(q[0], dib[0])) { continue; }
      if (k === 1 && q.length > 1 && q[0].length < 4) { continue; }      // (one short word: too common to tell)
      let got = 0;
      for (let i = 0; i < k; i++) { if (q[i] === '*' || alike(q[i], dib[i])) { got += 1; } }
      if (got >= Math.max(1, Math.ceil((3 * k) / 5))) { hits.push(d.line); }
    }
    if (hits.length) {
      const later = n === 0 ? hits.filter(h => h >= after) : hits;
      return {amud: ai, line: (later.length ? later : hits)[0]};
    }
  }
  return null;
}

// ---- a quote by its letters (masechta_pieces.letters, rapidfuzz's partial ratio)

/** masechta_pieces.words run together: without ו and י, a final ן as ם, final letters as others */
export function letters(words) {
  let out = '';
  for (let w of words) {
    w = w.replace(QG, '');
    if (w.endsWith('ן')) { w = `${w.slice(0, -1)}ם`; }
    out += unfinal(w).replace(/[וי]/g, '');
  }
  return out;
}

/** The length of the longest common subsequence of a and b (Hyyrö's bit-parallel algorithm) */
function lcsLength(a, b, pm) {
  const m = a.length;
  if (!m || !b.length) { return 0; }
  const W = Math.ceil(m / 32);
  const V = new Array(W).fill(0xFFFFFFFF);
  for (let j = 0; j < b.length; j++) {
    const M = pm.get(b[j]);
    if (!M) { continue; }
    let carry = 0;
    for (let w = 0; w < W; w++) {
      const v = V[w];
      const u = (v & M[w]) >>> 0;
      const sum = v + u + carry;
      carry = sum > 0xFFFFFFFF ? 1 : 0;
      V[w] = ((sum >>> 0) | (v & ~M[w])) >>> 0;
    }
  }
  let zeros = 0;
  for (let i = 0; i < m; i++) { if (!((V[i >> 5] >>> (i & 31)) & 1)) { zeros += 1; } }
  return zeros;
}

function patternOf(a) {
  const W = Math.ceil(a.length / 32);
  const pm = new Map();
  for (let i = 0; i < a.length; i++) {
    if (!pm.has(a[i])) { pm.set(a[i], new Array(W).fill(0)); }
    const arr = pm.get(a[i]);
    arr[i >> 5] = (arr[i >> 5] | (1 << (i & 31))) >>> 0;
  }
  return pm;
}

/** rapidfuzz's Indel normalized similarity (0..1) of a (pattern pm) and b */
const indelSimilarity = (a, b, pm) => {
  const lensum = a.length + b.length;
  if (!lensum) { return 1; }
  return 1.0 - (lensum - 2 * lcsLength(a, b, pm)) / lensum;
};

/** The best Indel similarity of the shorter `s1` against any part of `s2` (rapidfuzz's short needle:
 *  each prefix of s2 shorter than s1, each window as long as s1, each suffix) */
function partialSimilarity(s1, s2) {
  const pm = patternOf(s1);
  const n = s1.length;
  let best = 0;
  for (let i = 1; i < n; i++) { best = Math.max(best, indelSimilarity(s1, s2.slice(0, i), pm)); }
  for (let i = 0; i < s2.length - n; i++) { best = Math.max(best, indelSimilarity(s1, s2.slice(i, i + n), pm)); }
  for (let i = Math.max(0, s2.length - n); i < s2.length; i++) { best = Math.max(best, indelSimilarity(s1, s2.slice(i), pm)); }
  return best;
}

/** fuzz.partial_ratio(s1, s2, score_cutoff=cutoff) is not 0 (both shorter than 65 letters, as a quote is) */
export function partialRatioAtLeast(s1, s2, cutoff) {
  if (!s1.length || !s2.length) { return false; }
  const [shorter, longer] = s1.length > s2.length ? [s2, s1] : [s1, s2];
  let best = partialSimilarity(shorter, longer);
  if (s1.length === s2.length && best < 1) { best = Math.max(best, partialSimilarity(longer, shorter)); }
  return best >= cutoff / 100;
}

// ---- the commentary's comments and the Gemara's units

/** Each comment's amud, from its section's headings and the comments' openings: [[index or null]] per leaf */
function amudsOf(comm) {
  let daf = null;
  let side = null;
  return comm.map(leaf => {
    for (const h of leaf.heTitles || []) {
      const a = amudOf(h);
      if (a && a.daf) { daf = a.daf; side = a.side; }
    }
    return (leaf.openings || []).map(o => {
      const a = amudOf(o);
      if (a) {
        if (a.daf) { daf = a.daf; }
        if (a.side) { side = a.side; }
      }
      if (!daf) { return null; }
      return side ? [amudIndex(daf, side)] : [amudIndex(daf, 'a'), amudIndex(daf, 'b')];
    });
  });
}

/** The amudim (Sefaria's refs' "2a") a commentary names, and the ones beside them */
export function amudimWanted(comm) {
  const leaves = (comm.leaves || []).map(l => ({heTitles: l[3], openings: l[5] || []}));
  const out = new Set();
  for (const per of amudsOf(leaves)) {
    for (const a of per) { (a || []).forEach(i => { out.add(i - 1); out.add(i); out.add(i + 1); }); }
  }
  return [...out].filter(i => i >= 2).sort((a, b) => a - b)
    .map(i => `${Math.floor(i / 2) + 1}${i % 2 ? 'b' : 'a'}`);
}

/** A commentary's comments that open on Rashi's or Tosafos' words (their dibburim are then needed) */
export const quotesDibburim = comm => (comm.leaves || []).some(l => (l[5] || []).some(o => o && onCommentary(stripNumber(o))));

/** "2a" for an amud's index (1a = 0) */
export const amudLabel = i => `${Math.floor(i / 2) + 1}${i % 2 ? 'b' : 'a'}`;

/** The units of a masechta of Sefaria's Gemara: amudim [["2a", [segment html]]] (its lines with text, as Sofer's leaves) */
export function talmudUnits(title, heTitle, amudim) {
  const units = [];
  for (const [label, segs] of amudim) {
    const m = /^(\d+)([ab])$/.exec(label);
    if (!m) { continue; }
    const daf = parseInt(m[1], 10);
    const a = amudIndex(daf, m[2]);
    (segs || []).forEach((s, i) => {
      if (typeof s !== 'string' || !s.trim()) { return; }
      units.push({key: [a, i], amud: a, line: i, ref: `${title} ${label}:${i + 1}`,
        he: `${heTitle} ${gematria(daf)}${m[2] === 'a' ? '.' : ':'} ${i + 1}`, words: hebrewWords(s)});
    });
  }
  return units;
}

const LOOK_AHEAD = 40;        // units looked at past the last placed before the whole text is searched

/**
 * The comments put on the text by their quotes, loosely - LoosePlacer.place of Sofer's
 * loose_placement.py, for the same text and comments the same places.
 * comm:  [{path, heTitles, openings}]   the commentary's sections in order (heTitles: the Hebrew
 *        names of its levels; openings: each paragraph's paraOpening, null for an empty one)
 * units: [{key, words, amud?, line?}]   the text's passages in order (a masechta: each one's amud,
 *        1a = 0, and line in it)
 * opts:  dibburim  Map(amud -> [{who, words, text, line}]) Rashi's and Tosafos' (dibburimOf)
 *        perakim   [[first amud, last amud]] of each perek
 *        unread    Set of amudim that could not be read: a comment on those only is left out (Sofer
 *                  reads the whole masechet, so its loose_placement.py never meets this)
 * -> [{leaf, para, unit, how, exact}]: how 'loose' (by its quote), 'dibbur' (by Rashi's / Tosafos'
 *    dibbur), 'daf' (beside a comment of its siman, at the daf the siman names), 'loose-neighbour'
 *    (beside the one before or after it); exact: the quote found whole, in one place only.
 */
export function looseComments(comm, units, options = {}) {
  return runSteps(looseSteps(comm, units, options));
}

/** looseComments, a few milliseconds at a time with the app answering between (extras/links.js) */
export function looseCommentsAsync(comm, units, options = {}, pause) {
  return runStepsAsync(looseSteps(comm, units, options), pause);
}

/** A generator of steps run to its end at once -> its value */
export function runSteps(it) {
  let r = it.next();
  while (!r.done) { r = it.next(); }
  return r.value;
}

const SLICE_MS = 12;           // (work between two moments for the reader)
const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** The same, SLICE_MS at a time, `pause()` (a promise) between -> a promise of its value */
export async function runStepsAsync(it, pause = () => new Promise(resolve => setTimeout(resolve, 0))) {
  let start = clock();
  let r = it.next();
  while (!r.done) {
    if (clock() - start >= SLICE_MS) {
      await pause();
      start = clock();
    }
    r = it.next();
  }
  return r.value;
}

/** looseComments as steps (a generator: one step a comment) */
function* looseSteps(comm, units, {dibburim = null, perakim = [], unread = null} = {}) {
  const n = units.length;
  const words = units.map(u => u.words || []);
  const amudOfUnit = units.map(u => (u.amud === undefined ? null : u.amud));
  const lineOfUnit = units.map(u => (u.line === undefined ? null : u.line));
  const byAmud = new Map();
  const unitAt = new Map();
  units.forEach((u, i) => {
    if (u.amud === undefined || u.amud === null) { return; }
    if (!byAmud.has(u.amud)) { byAmud.set(u.amud, []); }
    byAmud.get(u.amud).push(i);
    if (u.line !== undefined && u.line !== null) { unitAt.set(`${u.amud}|${u.line}`, i); }
  });
  const chapter = new Map();          // a chapter's number -> [first unit, after the last]
  if (!byAmud.size) {
    units.forEach((u, i) => {
      if (typeof u.key[0] !== 'number') { return; }
      if (!chapter.has(u.key[0])) { chapter.set(u.key[0], [i, i]); }
      chapter.get(u.key[0])[1] = i + 1;
    });
  }
  const dib = dibburim && dibburim.size ? dibburim : null;
  const skels = words.map(ws => ws.map(skel));
  const lettersOf = new Map();
  const range = (a, b) => { const out = []; for (let i = a; i < b; i++) { out.push(i); } return out; };

  /** The longest run of the quote found at word p of unit i, a word of the text missed or misread at most once */
  const run = (q, i, p) => {
    const ws = words[i];
    let k = p;
    let m = 0;
    let exact = true;
    let slips = 0;
    let wild = 0;
    while (m < q.length && k < ws.length) {
      if (q[m] === '*') {
        wild += 1; exact = false; m += 1; k += 1;
      } else if (sameWord(q[m], ws[k])) {
        m += 1; k += 1;
      } else if (near(q[m], ws[k])) {
        exact = false; m += 1; k += 1;
      } else if (slips < 1 && m > 0) {
        slips += 1; exact = false;
        if (k + 1 < ws.length && near(q[m], ws[k + 1])) { k += 1; } else { m += 1; k += 1; }   // (a word added, or misread)
      } else { break; }
    }
    return {n: m - slips - wild, exact: exact && m === q.length};
  };
  const real = q => q.filter(w => w !== '*').length;
  /** _find_in: the first of `list` (in order) holding the quote -> {unit, exact, unique} or null */
  const findIn = (q, list) => {
    const need = Math.min(3, real(q));
    let best = null;
    let count = 0;
    const s0 = skel(q[0]);
    for (const i of list) {
      const ws = words[i];
      let here = null;
      for (let p = 0; p < ws.length; p++) {
        if (!(skels[i][p] === s0 || near(q[0], ws[p]))) { continue; }
        const r = run(q, i, p);
        if (r.n >= need && (!here || r.n > here.n)) { here = {unit: i, ...r}; }
      }
      if (here) {
        count += 1;
        if (!best) { best = here; }
      }
    }
    return best ? {unit: best.unit, exact: best.exact, unique: count === 1} : null;
  };
  const countIn = (q, list) => {
    let c = 0;
    const need = Math.min(3, real(q));
    for (const i of list) {
      const ws = words[i];
      for (let p = 0; p < ws.length; p++) {
        if (near(q[0], ws[p]) && run(q, i, p).n >= need) { c += 1; break; }
      }
    }
    return c;
  };
  /** _fuzzy_in: a quote spelled its own way, found by its letters (its longest stretch without an abbreviation) */
  const fuzzyIn = (q, list) => {
    const runs = [];
    let cur = [];
    for (const w of q.concat('*')) {
      if (w === '*') { if (cur.length) { runs.push(cur); } cur = []; } else { cur.push(w); }
    }
    let longest = [];
    for (const r of runs) { if (r.join('').length > longest.join('').length) { longest = r; } }
    const qs = letters(longest);
    if (longest.length < 2 || qs.length < 8) { return null; }
    const cutoff = qs.length < 14 ? 88.0 : 84.0;
    const hits = [];
    for (const i of list) {
      if (!lettersOf.has(i)) { lettersOf.set(i, letters(words[i])); }
      const t = lettersOf.get(i);
      if (t.length >= qs.length * 0.8 && partialRatioAtLeast(qs, t, cutoff)) { hits.push(i); }
    }
    return hits.length ? {unit: hits[0], exact: false, unique: hits.length === 1} : null;
  };
  /** _find_dibbur: the unit of the Gemara line whose Rashi or Tosafos dibbur the comment quotes */
  const findDibbur = (text, q, amuds, afterUnit) => {
    const who = onCommentary(text);
    if (!who || !dib || !unitAt.size) { return null; }
    const r = q.filter(w => w !== '*');
    if (!r.length || (r.length === 1 && r[0].length < 3)) { return null; }
    let after = -1;
    if (afterUnit !== null && afterUnit !== undefined && amuds.length && amudOfUnit[afterUnit] === amuds[0]) {
      after = lineOfUnit[afterUnit];
    }
    let got = findDibburLine(dib, amuds, q, who === 'either' ? null : who, after);
    if (!got && who !== 'either') { got = findDibburLine(dib, amuds, q, null, after); }
    if (!got) { return null; }
    const unit = unitAt.get(`${got.amud}|${got.line}`);
    return unit === undefined ? null : {unit, exact: true, unique: true};
  };
  const uniq = list => [...new Set(list)];

  // the comments in order, as Sofer's: [heads (a new section's headings, else []), chapter, opening]
  const comments = [];
  comm.forEach((leaf, li) => {
    let first = true;
    (leaf.openings || []).forEach((opening, j) => {
      if (opening === null || opening === undefined) { return; }
      comments.push({leaf: li, para: j, heads: first ? (leaf.heTitles || []) : [],
        chapter: typeof (leaf.path || [])[0] === 'number' ? leaf.path[0] : null, text: opening});
      first = false;
    });
  });

  // ---- place (LoosePlacer.place)
  let daf = null;
  let side = null;
  const out = [];                     // [{unit, window, unread}]
  const byDib = new Set();
  let cursor = 0;
  for (let k = 0; k < comments.length; k++) {
    const c = comments[k];
    yield;
    for (const h of c.heads) {
      const a = amudOf(h);
      if (a && a.daf) { daf = a.daf; side = a.side; }
    }
    const a = amudOf(c.text);
    if (a) {
      if (a.daf) { daf = a.daf; }
      if (a.side) { side = a.side; }
    }
    const amud = !daf ? null : (side ? [amudIndex(daf, side)] : [amudIndex(daf, 'a'), amudIndex(daf, 'b')]);
    if (amud && unread && unread.size && amud.every(x => unread.has(x))) {
      out.push({unit: null, window: [], unread: true});
      continue;
    }
    const q = looseQuote(c.text);
    let window = null;
    if (amud && byAmud.size) {
      const near3 = uniq(amud.flatMap(x => [x - 1, x, x + 1])).sort((x, y) => x - y);
      window = near3.flatMap(x => byAmud.get(x) || []);
    } else if (c.chapter !== null && chapter.has(c.chapter)) {
      window = range(...chapter.get(c.chapter));
    }
    let found = null;
    if (onCommentary(c.text) && dib) {
      // (a comment on Rashi's or Tosafos' words: the line their dibbur is on)
      const here = cursor < n ? amudOfUnit[cursor] : null;
      const look = amud ? amud.concat([-1, 1].flatMap(d => amud.map(x => x + d)))
        : (here !== null ? [here, here + 1, here + 2] : []);
      found = findDibbur(c.text, q, uniq(look), cursor);
      if (found) { byDib.add(k); }
    }
    if (!found && (real(q) >= 2 || (real(q) === 1 && window && q[0].length >= 4))) {
      if (window) {
        // (in order: from the last placed, then anywhere in the window; then by its letters)
        const later = window.filter(i => i >= cursor);
        found = findIn(q, later) || findIn(q, window) || fuzzyIn(q, later) || fuzzyIn(q, window);
        if (found && found.exact) { found.unique = countIn(q, window) === 1; }
      } else {
        found = findIn(q, range(cursor, Math.min(n, cursor + LOOK_AHEAD))) || findIn(q, range(cursor, n));
      }
    }
    if (found) { cursor = found.unit; }
    out.push({unit: found ? found.unit : null, window, exact: !!(found && found.exact && found.unique)});
  }
  const counted = out.filter(p => !p.unread);
  const got = out.filter(p => p.unit !== null).length;
  const result = placed => placed.map((p, k) => (p && p.unit !== null && p.unit !== undefined
    ? {leaf: comments[k].leaf, para: comments[k].para, unit: p.unit, how: p.how, exact: !!p.exact} : null)).filter(Boolean);
  // nothing much found: not a commentary on this text (a book of responsa named for it) - unless it
  // is essays each on the daf its siman names
  if (got < 3 || got < 0.2 * counted.length) {
    return byAmud.size ? result((yield* bySiman()) || []) : [];
  }
  // a comment not found: with the one before it (in its own amud or chapter when known), else the next
  return result(out.map((p, k) => {
    if (p.unread) { return null; }
    if (p.unit !== null) { return {unit: p.unit, how: byDib.has(k) ? 'dibbur' : 'loose', exact: p.exact}; }
    const ok = u => u !== null && (!p.window || p.window.includes(u));
    let t = null;
    for (let x = k - 1; x >= 0 && t === null; x--) { if (ok(out[x].unit)) { t = out[x].unit; } }
    for (let x = k + 1; x < out.length && t === null; x++) { if (ok(out[x].unit)) { t = out[x].unit; } }
    if (t === null && p.window && p.window.length) { t = p.window[0]; }
    return {unit: t, how: 'loose-neighbour', exact: false};
  }));

  /** _by_siman: a masechet's essays placed siman by siman at the daf each names; null: not such essays */
  function* bySiman() {
    const sections = [];
    comments.forEach((c, k) => {
      if (c.heads.length || !sections.length) { sections.push([]); }
      sections[sections.length - 1].push(k);
    });
    const res = comments.map(() => null);     // [{unit, how, exact}]
    let withDaf = 0;
    let here = 2;                             // (the amud the last placed comment is on: from 2a)
    let top = null;
    let last = null;                          // (the siman a part is in, and the daf the part before ended on)
    const prevIn = (sec, j) => { for (let x = j - 1; x >= 0; x--) { if (res[sec[x]]) { return res[sec[x]].unit; } } return null; };
    const nextIn = (sec, j) => { for (let x = j + 1; x < sec.length; x++) { if (res[sec[x]]) { return res[sec[x]].unit; } } return null; };
    for (const sec of sections) {
      const heads = comments[sec[0]].heads;
      let named = null;
      for (const h of heads) { named = namedDaf(h); if (named) { break; } }
      let perek = null;
      for (const h of heads) { perek = perekNumber(h); if (perek) { break; } }
      const inherit = heads.length > 1 && heads[0] === top ? last : null;
      top = heads.length ? heads[0] : top;
      if (!named && !perek) {
        const firsts = sec.slice(0, 3).map(k => stripNumber(comments[k].text));
        for (const t of firsts) {
          const a = amudOf(t);
          if (a && a.daf) { named = a; break; }
          if (START.test(t.slice(0, 60))) { named = {daf: 2, side: 'a'}; break; }
        }
        if (!named && last && firsts.slice(0, 2).some(t => SAME_PLACE.test(t))) { named = last; }    // ("שם", "עוד בענין")
        if (!named) { for (const t of firsts) { named = innerDaf(t); if (named) { break; } } }
      }
      if (!named && !perek && inherit) { named = inherit; }     // (a part of a siman: the daf the part before was on)
      let d = named ? named.daf : null;
      let s = named ? named.side : null;
      let span = perek && perek > 0 && perek <= perakim.length && !named ? perakim[perek - 1] : null;
      if (d === null && !span) {
        // (no daf named: each comment by its quote near the place the one before was found)
        here = yield* inOrder(sec, here, res);
        sec.forEach((k, j) => {
          if (res[k]) { return; }
          let t = prevIn(sec, j);
          if (t === null) { t = nextIn(sec, j); }
          if (t !== null) { res[k] = {unit: t, how: 'loose-neighbour', exact: false}; }
        });
        continue;
      }
      withDaf += sec.length;
      let anchor = null;
      let cur = null;
      for (const k of sec) {
        yield;
        const text = stripNumber(comments[k].text);
        const a = amudOf(text);
        if (a && a.daf) { d = a.daf; s = a.side; span = null; } else if (a && a.side && d) { s = a.side; }
        let amuds;
        let nearBy;
        if (span) {
          amuds = range(span[0], span[1] + 1);
          nearBy = amuds;
        } else {
          amuds = s ? [amudIndex(d, s)] : [amudIndex(d, 'a'), amudIndex(d, 'b')];
          nearBy = uniq(amuds.flatMap(x => [x - 1, x, x + 1])).sort((x, y) => x - y);
        }
        if (anchor === null) {
          const x = amuds.find(y => (byAmud.get(y) || []).length);
          anchor = x === undefined ? null : byAmud.get(x)[0];
        }
        const window = nearBy.flatMap(x => byAmud.get(x) || []);
        const q = looseQuote(text);
        let hit = null;
        let how = 'loose';
        if (onCommentary(text)) {
          hit = findDibbur(text, q, uniq(amuds.concat(nearBy)), cur);
          how = 'dibbur';
        }
        if (!hit && (real(q) >= 2 || (real(q) === 1 && q[0].length >= 4))) {
          const later = window.filter(i => cur === null || i >= cur);
          hit = findIn(q, later) || findIn(q, window) || fuzzyIn(q, later) || fuzzyIn(q, window);
          how = 'loose';
        }
        if (hit) {
          cur = hit.unit;
          res[k] = {unit: hit.unit, how, exact: how === 'dibbur' || (hit.exact && hit.unique)};
        }
      }
      last = d ? {daf: d, side: s} : null;
      const placedHere = sec.filter(k => res[k]).map(k => res[k].unit);
      if (placedHere.length && amudOfUnit[placedHere[placedHere.length - 1]] !== null) {
        here = amudOfUnit[placedHere[placedHere.length - 1]];
      }
      // (the rest of the siman: beside the comment before it, else after it, else at its daf)
      sec.forEach((k, j) => {
        if (res[k]) { return; }
        let t = prevIn(sec, j);
        if (t === null) { t = nextIn(sec, j); }
        if (t === null) { t = anchor; }
        if (t !== null) { res[k] = {unit: t, how: d ? 'daf' : 'loose-neighbour', exact: false}; }
      });
    }
    const foundAll = res.filter(r => r && (r.how === 'loose' || r.how === 'dibbur')).length;
    if (withDaf + foundAll < 0.5 * comments.length || !res.some(Boolean)) { return null; }
    return res.map((r, k) => {
      if (r) { return r; }
      let t = null;
      for (let x = k - 1; x >= 0 && t === null; x--) { if (res[x]) { t = res[x].unit; } }
      for (let x = k + 1; x < res.length && t === null; x++) { if (res[x]) { t = res[x].unit; } }
      return {unit: t, how: 'loose-neighbour', exact: false};
    });
  }

  /** _in_order: comments with no daf named, by their quote near amud `here` and on -> the amud the last one found is on */
  function* inOrder(ks, here, res) {
    let cur = null;
    for (const k of ks) {
      yield;
      const text = stripNumber(comments[k].text);
      const a = amudOf(text);
      if (a && a.daf) { here = amudIndex(a.daf, a.side || 'a'); }
      const nearBy = range(here - 1, here + 5).filter(x => x >= 0);
      const q = looseQuote(text);
      let hit = null;
      let how = 'loose';
      if (onCommentary(text)) {
        hit = findDibbur(text, q, [here, here + 1, here - 1, here + 2, here + 3].filter(x => x >= 0), cur);
        how = 'dibbur';
      }
      if (!hit && real(q) >= 2) {
        const list = nearBy.flatMap(x => byAmud.get(x) || []);
        hit = findIn(q, list.filter(i => cur === null || i >= cur)) || findIn(q, list);
        how = 'loose';
      }
      if (!hit && real(q) >= 3) {
        const far = findIn(q, range(cur || 0, n));
        hit = far && far.exact && far.unique ? far : null;
      }
      if (hit) {
        cur = hit.unit;
        res[k] = {unit: hit.unit, how, exact: how === 'dibbur' || (hit.exact && hit.unique)};
        if (amudOfUnit[hit.unit] !== null) { here = amudOfUnit[hit.unit]; }
      }
    }
    return here;
  }
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
