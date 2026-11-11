/**
 * The dibbur hamaschil (a comment's opening words) in bold, as the SoferBooks books print it:
 * a port of Sofer's markup.bold_dibbur (C:\Users\morde\Sofer\src\sofer\markup.py; tests in
 * __tests__/dibbur.test.js are Sofer's own, tests/test_small_modules.py). Done at display time:
 * the stored texts are never changed, so a library update keeps it and new books get it.
 *
 * Sofer's rule (bold_dibbur): only when the comment does not already open in bold. The dibbur
 * is the opening words up to the first full stop (included) or dash (" – ", not included), within
 * the first DIBBUR_MAX_WORDS words; a leading label ("[מתני']:", "גמרא:") is skipped. If no such
 * end is found, or other formatting starts or ends inside those words, the comment is left as it is.
 *
 * Where Sofer applies it: commentaries only - each comment beside the main text (mikraos.py
 * _comment) and a commentary printed as a book of its own (build.py: schema dependence
 * "Commentary" or the book is a commentary). Hebrew only (Sofer bolds `b.hebrew`).
 *
 * Sofer works on its parsed tokens (parse_comment); here the HTML is walked the same way: the
 * style tags Sofer knows (b, strong, i, em, small, big, u, sup, sub) are "formatting"; any
 * other tag (span, a ...) is ignored as Sofer's parser ignores it; <br> is a space (a comment's
 * <br>, parse_comment); entities count as the letter they stand for.
 */

export const DIBBUR_MAX_WORDS = 15;
// a label before the dibbur that stays as it is: "[מתני']:", "גמרא:", "מתני':"
const DIBBUR_LABEL = /^\s*(?:\[[^\]]{1,20}\]\s*:?|(?:גמרא|גמ['׳]|מתני['׳]|מתניתין)\s*:)\s*/;
const DIBBUR_END = /\s[–—-]\s|\./g;

// markup._TAGS_COMMON's HTML tags -> Sofer's style names
const STYLE_TAGS = {
  b: 'bold', strong: 'bold', i: 'italic', em: 'italic', small: 'small', big: 'large',
  u: 'underline', sup: 'superscript', sub: 'subscript',
};
const VOID_TAGS = new Set(['br', 'img', 'hr', 'wbr']);
const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', thinsp: '\u2009',
  ensp: '\u2002', emsp: '\u2003', ndash: '–', mdash: '—', lrm: '\u200e', rlm: '\u200f', zwj: '\u200d',
  zwnj: '\u200c', shy: '\u00ad'};

const decodeEntity = ent => {
  const name = ent.slice(1, -1);
  if (name[0] === '#') {
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ent;
  }
  return name in ENTITIES ? ENTITIES[name] : ent;
};

const TOKEN = /<\/?[A-Za-z][^>]*>|<!--[\s\S]*?-->|[^<]+|</g;
const UNIT = /&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z]{2,8});|[\s\S]/g;

/**
 * The HTML as Sofer's tokens, each keeping its raw HTML:
 *   {kind: 'text', units: [[raw, decoded], ...]}   letters (an entity one unit; <br> one " ")
 *   {kind: 'open' | 'close', style, raw}            a style tag Sofer knows
 *   {kind: 'other', raw}                            what Sofer's parser leaves out (other tags,
 *                                                    another commentary's anchor and its contents)
 */
export function tokenize(html) {
  const out = [];
  const stack = [];         // open tags: [name, kind] (kind 'style' | 'ignored' | 'skip')
  let skip = 0;
  const text = (raw, decoded) => {
    const last = out[out.length - 1];
    if (last && last.kind === 'text') { last.units.push([raw, decoded]); } else { out.push({kind: 'text', units: [[raw, decoded]]}); }
  };
  for (const m of String(html).match(TOKEN) || []) {
    if (m.length > 1 && m[0] === '<' && m[1] !== '!' ) {
      const closing = m[1] === '/';
      const name = (/^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(m) || [])[1].toLowerCase();
      if (VOID_TAGS.has(name)) {
        if (name === 'br' && !skip) { text(m, ' '); } else { out.push({kind: 'other', raw: m}); }
        continue;
      }
      if (!closing) {
        if (skip) { skip++; stack.push([name, 'skip']); out.push({kind: 'other', raw: m}); continue; }
        // (another commentary's invisible anchor, and a footnote marker: never text - markup._Parser)
        if ((name === 'i' && /\sdata-commentator\s*=/.test(m)) || (name === 'sup' && /footnote-marker/.test(m))) {
          skip = 1; stack.push([name, 'skip']); out.push({kind: 'other', raw: m}); continue;
        }
        if (name in STYLE_TAGS) { stack.push([name, 'style']); out.push({kind: 'open', style: STYLE_TAGS[name], raw: m}); }
        else { stack.push([name, 'ignored']); out.push({kind: 'other', raw: m}); }
        continue;
      }
      if (skip) {
        const [opener] = stack.pop();
        skip--;
        // (a footnote marker is a space - markup._Parser; given at its end, outside it)
        if (!skip && opener === 'sup') { text(m, ' '); } else { out.push({kind: 'other', raw: m}); }
        continue;
      }
      // the matching open tag: everything opened after it closes with it (markup._Parser.handle_endtag)
      let pos = stack.length - 1;
      while (pos >= 0 && stack[pos][0] !== name) { pos--; }
      if (pos < 0) { out.push({kind: 'other', raw: m}); continue; }   // (a stray closing tag: dropped)
      while (stack.length > pos + 1) {
        const [inner, kind] = stack.pop();
        if (kind === 'style') { out.push({kind: 'close', style: STYLE_TAGS[inner], raw: ''}); }
      }
      const [, kind] = stack.pop();
      out.push(kind === 'style' ? {kind: 'close', style: STYLE_TAGS[name], raw: m} : {kind: 'other', raw: m});
      continue;
    }
    if (m.startsWith('<!--') || skip) { out.push({kind: 'other', raw: m}); continue; }
    for (const u of m.match(UNIT)) { text(u, u[0] === '&' ? decodeEntity(u) : u); }
  }
  return out;
}

const textOf = tok => tok.units.map(u => u[1]).join('');
const rawOf = tok => tok.kind === 'text' ? tok.units.map(u => u[0]).join('') : tok.raw;

/**
 * Where the dibbur is, as Sofer finds it: [start, end] in the comment's letters, or null
 * (it opens in bold already, or has no clear end).
 */
function dibburSpan(toks) {
  for (const t of toks) {                       // already opens in bold?
    if (t.kind === 'open' && t.style === 'bold') { return null; }
    if ((t.kind === 'text' && textOf(t).trim()) || t.kind === 'close') { break; }
  }
  const text = toks.filter(t => t.kind === 'text').map(textOf).join('');
  const m = DIBBUR_LABEL.exec(text);
  const start = m ? m[0].length : text.length - text.trimStart().length;
  DIBBUR_END.lastIndex = start;
  const endM = DIBBUR_END.exec(text);
  if (!endM) { return null; }
  const end = endM[0] === '.' ? endM.index + 1 : endM.index;
  const words = text.slice(start, end).trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > DIBBUR_MAX_WORDS) { return null; }
  return [start, end];
}

/** A comment's HTML with its dibbur hamaschil in <b>, when the source did not make it bold */
export function boldDibbur(html) {
  if (typeof html !== 'string' || !html) { return html; }
  const toks = tokenize(html);
  const span = dibburSpan(toks);
  if (!span) { return html; }
  const [start, end] = span;
  let out = '';
  let pos = 0;
  let opened = false;        // (Sofer's: the dibbur has started / ended)
  let closed = false;
  let inTag = false;         // a <b> written and not yet closed: the HTML's own tags (a <span>
                             // ...) stay outside it, so the bold is cut around them and nests well
  const cut = () => {
    if (pos === start && !opened) { opened = true; }
    if (pos === end && opened && !closed) {
      closed = true;
      if (inTag) { out += '</b>'; inTag = false; }
    }
  };
  for (const t of toks) {
    if (t.kind !== 'text') {
      if ((t.kind === 'open' || t.kind === 'close') && opened && !closed) {
        return html;                           // other formatting inside the dibbur: leave it
      }
      if (inTag) { out += '</b>'; inTag = false; }
      out += t.raw;
      continue;
    }
    // (the cuts at the letter positions, as Sofer cuts its text tokens)
    for (const [raw, decoded] of t.units) {
      cut();
      if (opened && !closed && !inTag) { out += '<b>'; inTag = true; }
      out += raw;
      pos += decoded.length;
    }
    cut();
  }
  return opened && closed ? out : html;
}

/* ---------- which texts: commentaries ---------- */

// the connections panel's categories of a commentary's comments (Sefaria's link categories)
export const COMMENTARY_CATEGORIES = ['Commentary', 'Quoting Commentary', 'Modern Commentary'];

export const isCommentaryCategory = category => COMMENTARY_CATEGORIES.indexOf(category) !== -1;

/**
 * Is `title` a commentary (Sofer: schema dependence "Commentary", or the book is a commentary)?
 * Sefaria's and the Sofer Library's books say so in the catalogue (dependence); a downloaded
 * Otzaria / Dicta / Wikisource book is one when its links tie it to the text it explains
 * (extras/links.js commentaryTitles: its own links, or found by its name - extras/inferred.js).
 */
export function isCommentaryBook(title, extraCommentaries = null) {
  if (!title) { return false; }
  const S = typeof Sefaria !== 'undefined' ? Sefaria : null;
  const index = S && S.index ? S.index(title) : null;
  if (index && typeof index.dependence === 'string' && index.dependence.toLowerCase() === 'commentary') { return true; }
  if (index && index.primary_category === 'Commentary') { return true; }
  return !!(extraCommentaries && extraCommentaries.has(title));
}

/* ---------- plain text with its bold (the commentary under each passage) ---------- */

const BOLD_TAG = /^<\/?(?:b|strong)(?:\s[^>]*)?>$/i;

/**
 * A comment's HTML as plain text (as the inline commentary shows it: tags dropped, <br> a space,
 * spaces collapsed) with its bold words: {text, bold: [true|false per word]}.
 */
export function plainWithBold(html) {
  if (typeof html !== 'string' || !html) { return {text: '', bold: []}; }
  const words = [];
  const bold = [];
  let depth = 0;
  let cur = '';
  let curBold = false;
  const flush = () => { if (cur) { words.push(cur); bold.push(curBold); } cur = ''; curBold = false; };
  for (const m of html.match(TOKEN) || []) {
    if (m.length > 1 && m[0] === '<' && m[1] !== '!') {
      if (BOLD_TAG.test(m)) { depth = Math.max(0, depth + (m[1] === '/' ? -1 : 1)); }
      else if (/^<br\b/i.test(m)) { flush(); }
      continue;
    }
    if (m.startsWith('<!--')) { continue; }
    for (const u of m.match(UNIT)) {
      const ch = u[0] === '&' ? decodeEntity(u) : u;
      if (/^\s+$/.test(ch)) { flush(); continue; }
      cur += ch;
      if (depth > 0) { curBold = true; }
    }
  }
  flush();
  return {text: words.join(' '), bold};
}

/**
 * Runs of a text by the bold of its words ([{text, bold}]): the words of `text` (split at
 * spaces) bold as `bold` says, by their place - so the same flags fit the text with nikud added
 * by Dicta, which keeps its words.
 */
export function boldRuns(text, bold) {
  if (!text) { return []; }
  if (!bold || !bold.some(Boolean)) { return [{text, bold: false}]; }
  const parts = text.split(/(\s+)/);
  const runs = [];
  let w = 0;
  for (let i = 0; i < parts.length; i++) {
    const piece = parts[i];
    if (!piece) { continue; }
    let b;
    if (i % 2 === 0) { b = !!bold[w]; w++; } else {
      // a space between two bold words is bold, else not
      b = !!bold[w - 1] && !!bold[w];
    }
    const last = runs[runs.length - 1];
    if (last && last.bold === b) { last.text += piece; } else { runs.push({text: piece, bold: b}); }
  }
  return runs;
}

export const _rawOf = rawOf;
