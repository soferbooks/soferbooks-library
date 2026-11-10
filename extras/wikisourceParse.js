/**
 * Hebrew Wikisource ("Wikitext", he.wikisource.org): a book's rendered pages -> its sections.
 *
 * A thin JavaScript port of Sofer's converter (C:\Users\morde\Sofer\src\sofer\wikisource.py:
 * page_parse, without_site_boxes, _Text; importers.py: _wiki_tree, _tidy_wiki_tree, _wiki_author,
 * _title_area_lines, _without_lead ...). Names and comments follow Sofer's so the two can be
 * compared line by line; behaviour changes belong in Sofer first. Pure functions only.
 *
 * Sofer reads the pages as the site renders them (the API's action=parse), not their wiki markup:
 * templates (navigation boxes, notes, layout) are already expanded there. So the parser here is an
 * HTML one - htmlparser2 (MIT, already in the app) in place of Python's html.parser - and no
 * wikitext parser (wtf_wikipedia ...) is needed: it would have to expand the site's templates to
 * give the same text.
 *
 * A book is {title, pages: [{page, name, depth, revid, html}]}: the title page, then each part in
 * the order the title page links to them (extras/wikisource.js fetches them).
 */
import {Parser} from 'htmlparser2';
import {decodeHTML} from 'entities';
import {Node, normTitle} from './tree';

// ---------------------------------------------------------------- small Python helpers

/** importers._plain */
const plain = s => pyStrip(String(s || '').replace(/<[^>]+>/g, ''));

// Python's str.isspace() / str.strip() (JS's trim also strips U+FEFF and not U+001C-1F, U+0085)
const PY_SPACE = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, 'g');
const PY_SPACES = new RegExp(`[${PY_SPACE}]+`, 'g');
const pyStrip = s => String(s).replace(PY_STRIP, '');
const isSpace = c => new RegExp(`^[${PY_SPACE}]$`).test(c);
/** Python's re.sub(r"\s+", " ", s) */
const oneSpace = s => String(s).replace(PY_SPACES, ' ');
/** importers.norm_space */
export const normSpace = s => pyStrip(oneSpace(s || ''));
/** Python's len(): code points */
const pyLen = s => {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (!(c >= 0xDC00 && c <= 0xDFFF && i > 0 && s.charCodeAt(i - 1) >= 0xD800 && s.charCodeAt(i - 1) <= 0xDBFF)) { n += 1; }
  }
  return n;
};
/** Python's html.unescape */
export const unescape = s => decodeHTML(String(s));
/** Python's urllib.parse.unquote (bad escapes are left as they are) */
export function unquote(s) {
  return String(s).replace(/(?:%[0-9A-Fa-f]{2})+/g, run => {
    try { return decodeURIComponent(run); } catch (e) {
      // (bytes that are not UTF-8: each sequence that is, decoded; the others as U+FFFD)
      const esc = run.match(/%[0-9A-Fa-f]{2}/g);
      let out = '';
      for (let i = 0; i < esc.length;) {
        let n = 4;
        for (; n > 0; n--) {
          try { out += decodeURIComponent(esc.slice(i, i + n).join('')); break; } catch (e2) { /* shorter */ }
        }
        if (!n) { out += '�'; n = 1; }
        i += n;
      }
      return out;
    }
  });
}
// Python's \w (Unicode letters and digits): Hebrew letters count, nikud does not
const WORD = 'A-Za-z0-9_\\u00AA\\u00B5\\u00BA\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u05D0-\\u05EA\\u05EF-\\u05F2';

// ---------------------------------------------------------------- wikisource.py

// pages of a book that are the editors' own, not the sefer ("about this edition")
export const EDITORS_PAGES = /^(אודות|על המהדורה|הערות המעתיק|מבוא המהדיר)/;

// books whose title page lists its parts' chapters flat (wikisource.PARTS_BY_PREFIX)
export const PARTS_BY_PREFIX = {
  'ספר התניא': [['ליקוטי אמרים', 'תניא חלק א '], ['שער היחוד והאמונה', 'תניא שער היחוד והאמונה '],
    ['אגרת התשובה', 'תניא אגרת התשובה '], ['אגרת הקודש', 'תניא חלק ד '], ['קונטרס אחרון', 'תניא קונטרס אחרון ']],
};
// lines of a book's pages that are its printed edition's decoration (wikisource.DROP_LINES)
export const DROP_LINES = {'ספר התניא': ['לקוטי ספר של בינונים אמרים']};

// parts of a rendered page that are not the sefer's text
const SKIP_CLASSES = ['noprint', 'ws-noexport', 'mw-editsection', 'reference', 'references', 'navbox',
  'toc', 'mw-empty-elt', 'metadata', 'ambox', 'mw-references-wrap', 'noexport'];
const VOID = new Set(['br', 'img', 'hr', 'wbr', 'meta', 'link']);
const BLOCKS = new Set(['p', 'div', 'li', 'dd', 'dt', 'blockquote', 'center']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export const NOTE_ANCHOR = 'הערות';         // (the anchors of the editors' notes in the text)
const ANCHOR = /<i data-commentator="הערות" data-order="([^"]*)"><\/i>/g;

/** wikisource._Text: paragraphs ("p", html with <b>) and headings ("h", level, text) of a page. */
class TextParser {
  constructor() {
    this.out = [];
    this.buf = [];
    this.skip = 0;              // depth inside something skipped
    this.stack = [];
    this.heading = 0;
    this.pending = [];          // footnote markers met since the last paragraph
    this.marks = {};            // paragraph index -> its footnotes' ids
  }

  flush() {
    let text = pyStrip(oneSpace(this.buf.join('')));
    text = text.replace(/<b>\s*<\/b>/g, '');
    const bare = text.replace(/<[^>]+>/g, '');
    if (pyStrip(bare)) {
      if (this.heading && /^[\d.\s]+$/.test(bare)) {
        // (a heading that is only a number the site added: "1.1")
      } else if (this.heading) {
        this.out.push(['h', this.heading, pyStrip(bare)]);
      } else {
        this.out.push(['p', text]);
        if (this.pending.length) {
          const i = this.out.length - 1;
          this.marks[i] = (this.marks[i] || []).concat(this.pending);
          this.pending = [];
        }
      }
    }
    this.buf = [];
  }

  start(tag, a) {
    if (VOID.has(tag)) {
      if (tag === 'br' && !this.skip) { this.flush(); }
      return;
    }
    const cls = a.class || '';
    const href = a.href || '';
    if (tag === 'a' && (/^#(?:_ftn|fn_)\d/.test(href) || href.startsWith('#cite_note'))) {
      this.pending.push(href.slice(1));         // (a footnote marker: its note goes with this paragraph)
      if (!this.heading) {
        // and its exact place, an invisible anchor (numbered by pageParse)
        this.buf.push(`<i data-commentator="${NOTE_ANCHOR}" data-order="${href.slice(1)}"></i>`);
      }
    }
    const classes = cls.split(/\s+/).filter(Boolean);
    const skip = ['table', 'style', 'script', 'sup', 'math'].includes(tag)
      || (a.style || '').replace(/ /g, '').includes('display:none')
      || classes.some(c => SKIP_CLASSES.includes(c))
      || (tag === 'a' && href.startsWith('#_ftn')) || (a.id || '').startsWith('_ftn');
    this.stack.push([tag, skip]);
    if (skip) {
      this.skip += 1;
      return;
    }
    if (this.skip) { return; }
    if (BLOCKS.has(tag)) {
      this.flush();
    } else if (HEADINGS.has(tag)) {
      this.flush();
      this.heading = parseInt(tag[1], 10);
    } else if (tag === 'b' || tag === 'strong') {
      this.buf.push('<b>');
    }
  }

  end(tag) {
    if (VOID.has(tag)) { return; }           // (never opened: see start)
    // (close up to the matching open tag)
    while (this.stack.length) {
      const [t, skip] = this.stack.pop();
      if (skip) {
        this.skip -= 1;
      } else if (!this.skip) {
        if (BLOCKS.has(t)) {
          this.flush();
        } else if (HEADINGS.has(t)) {
          this.flush();
          this.heading = 0;
        } else if (t === 'b' || t === 'strong') {
          this.buf.push('</b>');
        }
      }
      if (t === tag) { break; }
    }
  }

  data(text) {
    if (!this.skip) { this.buf.push(text.replace(/</g, '&lt;').replace(/>/g, '&gt;')); }
  }

  feed(html) {
    const parser = new Parser({
      onopentag: (name, attrs) => this.start(name, attrs),
      onclosetag: name => this.end(name),
      ontext: text => this.data(text),
    }, {decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true, recognizeSelfClosing: true});
    parser.write(html);
    parser.end();
    this.flush();
  }
}

/** Where the element opening at `start` ends (after its own closing tag): wikisource._element_end */
function elementEnd(html, start, tag) {
  let depth = 0;
  const pat = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  pat.lastIndex = start;
  let m;
  while ((m = pat.exec(html)) !== null) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) { return m.index + m[0].length; }
  }
  return html.length;
}

/**
 * wikisource.without_site_boxes: the page without the site's own additions inside the text - a
 * word's hover explanation (TooltipSpan), and the box saying the chapter is incomplete ("פרק זה
 * לוקה בחסר") with the "דברי המגיה" heading over it.
 */
export function withoutSiteBoxes(html) {
  for (;;) {
    const at = html.search(/<span class="TooltipSpan"/);
    if (at < 0) { break; }
    html = html.slice(0, at) + html.slice(elementEnd(html, at, 'span'));
  }
  let at = 0;
  for (;;) {
    const found = html.indexOf('לוקה בחסר', at);
    if (found < 0) { break; }
    at = found + 'לוקה בחסר'.length;
    // (the box itself: the nearest bordered div around the words, a few lines long)
    const before = html.slice(0, found);
    const boxes = [...before.matchAll(/<div[^>]*border[^>]*>/g)];
    if (!boxes.length) { continue; }
    let start = boxes[boxes.length - 1].index;
    const end = elementEnd(html, start, 'div');
    if (end <= found || end - start > 3000) { continue; }
    const head = /<div class="mw-heading[^"]*">\s*<h\d[^>]*>[\s\S]*?<\/h\d>\s*<\/div>\s*$|<h\d[^>]*>[^<]*(?:<span[^>]*><\/span>)?[^<]*דברי המגיה[^<]*<\/h\d>\s*$/
      .exec(html.slice(0, start));
    if (head && head[0].includes('דברי המגיה')) { start = head.index; }
    html = html.slice(0, start) + html.slice(end);
    at = start;
  }
  return html;
}

const FTN = /<p>\s*<a[^>]*href="#_ftnref(\d+)"[^>]*>[\s\S]*?<\/a>([\s\S]*?)<\/p>/g;
// (the site writes the note's id with "&#95;" for "_"; a note may hold spans of its own)
export const CITE = /<li id="cite(?:_|&#95;)note-([^"]+)"[^>]*>[\s\S]*?<span class="reference-text">([\s\S]*?)<\/li>/g;
// the editors' notes of a third style: <cite id="fn_N"> paragraphs under a "הערות" heading
const FN = /<p>\s*<cite id="fn(?:_|&#95;)(\d+)"[^>]*>[\s\S]*?<\/cite>([\s\S]*?)<\/p>/g;
const NOTES_HEADING = /<div class="mw-heading[^"]*">\s*<h2 id="הערות">/;
const FTN_RULE = /<hr\s*\/?>(?=\s*(?:<div[^>]*>\s*)?<p>\s*<a[^>]*_ftnref)/;

/** wikisource._note_text */
export const noteText = html => pyStrip(oneSpace(unescape(html.replace(/<[^>]+>/g, ''))));

/** Python's re.split(pattern, s, maxsplit=1) for a pattern without groups */
function splitOnce(re, s) {
  const m = re.exec(s);
  return m ? [s.slice(0, m.index), s.slice(m.index + m[0].length)] : [s];
}

/** wikisource.page_parse: [blocks, {paragraph's index among the blocks: the editors' notes on it}] */
export function pageParse(html) {
  html = withoutSiteBoxes(html);
  // the editors' footnotes ("_ftn") come after a rule at the end of the page
  const parts = splitOnce(FTN_RULE, html);
  const notes = {};
  if (parts.length > 1) {
    for (const m of parts[1].matchAll(FTN)) { notes[`_ftn${m[1]}`] = noteText(m[2]); }
  }
  const fn = splitOnce(NOTES_HEADING, parts[0]);
  if (fn.length > 1 && new RegExp(FN.source).test(fn[1])) {   // (a "הערות" section of fn_N notes: not the text)
    for (const m of fn[1].matchAll(FN)) { notes[`fn_${m[1]}`] = noteText(m[2]); }
    parts[0] = fn[0];
  }
  for (const m of html.matchAll(CITE)) { notes[`cite_note-${m[1]}`] = noteText(m[2]); }
  const p = new TextParser();
  p.feed(parts[0]);
  const on = {};
  for (const [i, ids] of Object.entries(p.marks)) {
    const texts = ids.filter(x => notes[x]).map(x => notes[x]);
    if (texts.length) { on[i] = texts; }
  }
  // each anchor numbered as its note is among the paragraph's notes (1, 2 ...); an anchor with no
  // note is dropped
  const out = p.out.map((b, i) => {
    if (b[0] === 'p' && b[1].includes(NOTE_ANCHOR)) {
      const kept = (p.marks[i] || []).filter(x => notes[x]);
      return ['p', b[1].replace(ANCHOR, (whole, id) => (kept.includes(id)
        ? `<i data-commentator="${NOTE_ANCHOR}" data-order="${kept.indexOf(id) + 1}"></i>` : ''))];
    }
    return b;
  });
  return [out, on];
}

// ---------------------------------------------------------------- importers.py: the book

/** importers._Node, with the editors' notes on each paragraph */
export class WikiNode extends Node {
  constructor(title) {
    super(title);
    this.notes = [];          // the editors' notes on each paragraph (may be shorter)
  }

  addNote(text) {
    const node = this.deepest();
    while (node.notes.length < node.paras.length) { node.notes.push([]); }
    if (node.notes.length) { node.notes[node.notes.length - 1].push(text); }
  }

  hasNotes() {
    return this.notes.some(n => n.length) || this.children.some(c => c.hasNotes());
  }

  addChild(title) {
    if (this.paras.length && !this.children.length) {
      const first = new WikiNode('');
      first.paras = this.paras;
      this.paras = [];
      first.notes = this.notes;
      this.notes = [];
      this.children.push(first);
    }
    const n = new WikiNode(title);
    this.children.push(n);
    return n;
  }

  /** importers._notes_of: the notes of each paragraph */
  notesOf() {
    return this.paras.map((_, i) => (i < this.notes.length ? this.notes[i] : []));
  }
}

/** importers.wiki_keys: the names a Wikitext book may have in the library */
export function wikiKeys(title) {
  const t = String(title).split('/')[0];
  const out = new Set([normTitle(t)]);
  for (let x of [...out]) {
    x = x.replace(/\s*מנוקד$/, '');
    out.add(x);
    if (x.startsWith('ספר ')) { out.add(x.slice(4)); }
  }
  return [...out].filter(Boolean).sort();
}

// Wikitext's note on a title page that it was copied there by permission
const PERMISSION_NOTE = /^(?:הספרים|הספר|החיבור)\s+(?:מועתקים|מועתק)\s+לכאן\s+באישור/;
// a page's navigation line, printed as text ("<< · תניא · שער היחוד והאמונה · א · >>")
const WIKI_NAV = /^\s*(?:<<|&lt;&lt;|«)?[^.:]{0,120}\s·\s[^.:]{0,120}(?:>>|&gt;&gt;|»)\s*$|^\s*(?:<<|&lt;&lt;|«)\s[^.:]{0,120}\s·\s/;
// the site's own lists at a page's end and its lines that are not the book's
const WIKI_END = new Set(['מראי מקומות', 'הערות שוליים', 'ראו גם', 'קישורים חיצוניים', 'קישורים', 'הערות']);
const WIKI_LINES = /^(?:הטקסט בספר זה הושלם|פרק זה חסר\.?|לפרק (?:הראשון|הבא|הקודם)|ראו גם:?|הערות שוליים|ביאור:.*|ערך בוויקיפדיה:.*|לדף הראשי.*|חזרה לדף.*|(?:ר'|ראו|ראה)\s+\S+\s+זה\s+במהדורה\s+המבוארת\.?)\s*$/;

/** importers._wiki_furniture: a line of the site's, not of the book */
function wikiFurniture(text, pageName) {
  if (WIKI_LINES.test(text)) { return true; }
  return !!pageName && normTitle(text) === pageName;
}

/** importers._without_lead: `html` without the words it opens with, whatever tags are around them */
export function withoutLead(html, words) {
  const want = words.replace(/\s/g, '');
  const chars = [...want];
  let k = 0;
  let i = 0;
  while (i < html.length && k < chars.length) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      i = close + 1 || html.length;
      continue;
    }
    const c = html[i];
    if (isSpace(c) || (c >= '\u0591' && c <= '\u05C7')) {
      i += 1;
      continue;
    }
    if (c !== chars[k]) { return html; }
    k += 1;
    i += 1;
  }
  if (k < chars.length) { return html; }
  const rest = html.slice(i).replace(new RegExp(`^(?:[${PY_SPACE}]|</[^>]+>)*`),
    m => (m.match(/<\/[^>]+>/g) || []).join(''));
  // (the tags the name opened are closed again: "<b>פרק</b> א" -> "")
  const opened = [...html.slice(0, i).matchAll(/<([a-z]+)[^>]*>/g)].map(x => x[1]);
  const closed = [...html.slice(0, i).matchAll(/<\/([a-z]+)>/g)].map(x => x[1]);
  const head = opened.slice(closed.length).map(t => `<${t}>`).join('');
  return pyStrip(head + rest) || html;
}

/** importers._regrouped: the parts made by their pages' names (PARTS_BY_PREFIX) */
function regrouped(book) {
  const parts = PARTS_BY_PREFIX[book.title];
  if (!parts) { return book; }
  const pages = [book.pages[0]];
  parts.forEach(([name, prefix], i) => {
    pages.push({page: `${book.title}/${name}`, name, depth: 1, html: `<div id="sofer-part-${i}"></div>`});
    for (const pg of book.pages.slice(1)) {
      if (pg.page.startsWith(prefix) && pg.page !== pyStrip(prefix)) { pages.push({...pg, depth: 2}); }
    }
  });
  return {...book, pages};
}

// a line listing old printings - "דפוס הענא תעו, דפוס פראג שעב"
const EDITIONS_LINE = /^(?:דפוס\s+[^\s,]+(?:\s+[^\s,]+)?\s*,?\s*)+$/;
const WHOLE_BOOK_PAGE = /^(?:שלם|כל הספר)$|(?:^|\s)(?:הכל|הכול)$|בדף אחד/;

/** importers._repeats_others: a page holding the whole book, or a part of it, again */
function repeatsOthers(page, pages) {
  const flat = h => h.replace(/<[^>]+>/g, ' ').replace(PY_SPACES, ' ');
  const text = flat(page.html);
  const rest = pages.filter(p => p !== page && p.depth > 0).map(p => flat(p.html)).join(' ');
  if (text.length < 2000 || !rest) { return false; }
  const step = Math.floor((text.length - 1000) / 10);
  let n = 0;
  for (let k = 0; k < 10; k++) {
    if (rest.includes(text.slice(500 + k * step, 540 + k * step))) { n += 1; }
  }
  return n >= 8;
}

/** importers._outside_links: a line that is only links to other sites */
function outsideLinks(html) {
  const links = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) || [];
  const rest = html.replace(/<a\b[\s\S]*?<\/a>|<[^>]+>|[\s,.;:|·־-]/g, '');
  return links.length > 0 && html.includes('external') && pyLen(rest) <= 3;
}

/** importers._words_in: `part`'s words, in order, together inside `whole`'s */
function wordsIn(part, whole) {
  const n = part.length;
  if (!n) { return false; }
  for (let i = 0; i + n <= whole.length; i++) {
    if (part.every((w, j) => whole[i + j] === w)) { return true; }
  }
  return false;
}

const CONTENTS = new Set(['תוכן', 'תוכן עניינים', 'תוכן העניינים', 'תוכן הענינים', 'מפתח']);
const OPENING = new Set(['פתח דבר', 'פתיחה', 'הקדמה', 'הקדמת המחבר']);

/**
 * importers._tidy_wiki_tree: a part with no text is left out; a "contents" part that is a list of
 * the book's headings is left out, one that holds the text keeps it without that name; the
 * opening words ("פתח דבר", "הקדמה") come first.
 */
function tidyWikiTree(root) {
  const kids = [];
  for (const c of root.children) {
    if (!c.paras.length && !c.children.length) { continue; }
    if (CONTENTS.has(normSpace(plain(c.title)))) {
      const lines = c.paras.map(x => pyLen(plain(x)));
      if (!c.children.length && lines.length && [...lines].sort((a, b) => a - b)[Math.floor(lines.length / 2)] < 80) {
        continue;                               // (the site's table of contents)
      }
      c.title = '';
    }
    kids.push(c);
  }
  const opening = kids.filter(c => OPENING.has(normSpace(plain(c.title))));
  root.children = opening.concat(kids.filter(c => !opening.includes(c)));
  return root;
}

/** importers._wiki_author: the author a Wikitext title page links to ("מחבר:יעקב חאגיז") */
export function wikiAuthor(book) {
  let html = book.pages && book.pages.length ? book.pages[0].html : '';
  // (only on the title page itself, before its first section, or in a box headed "מחברים")
  const first = /<h2\b/.exec(html);
  const box = /מחברים\s*(?:<[^>]+>\s*)*/.exec(html);
  html = (first ? html.slice(0, first.index) : html)
    + (box ? html.slice(box.index + box[0].length, box.index + box[0].length + 3000) : '');
  const m = /title="מחבר:([^"(]+)/.exec(html) || /href="\/wiki\/(?:%D7%9E%D7%97%D7%91%D7%A8|מחבר):([^"#?]+)/.exec(html);
  if (!m) {
    // (no link: the title area's plain "מאת<br />הנצי"ב מוולאזי'ן")
    const cut = html.includes('<p') ? html.indexOf('<p') : 3000;
    const by = /מאת\s*<br\s*\/?>\s*([^<>]{2,60})</.exec(html.slice(0, cut));
    return by ? pyStrip(unescape(by[1])) : '';
  }
  return pyStrip(unescape(unquote(m[1])).replace(/_/g, ' '));
}

/** importers._title_area_lines: the lines of a page's title area (centred divs before its text) */
function titleAreaLines(html) {
  const cut = ['<p', '<h2', '<pre'].map(x => html.indexOf(x)).filter(i => i >= 0);
  const area = cut.length ? html.slice(0, Math.min(...cut)) : '';
  if (!area.includes('text-align')) { return new Set(); }
  const lines = area.replace(/<br\s*\/?>|<\/div>/g, '|').replace(/<[^>]+>/g, '').split('|');
  return new Set(lines.map(x => normTitle(x)).filter(x => pyLen(x) > 1));
}

const bareHtml = html => html.replace(/<!--[\s\S]*?-->/g, '');   // (hidden notes differ on every copy)

/**
 * importers._wiki_tree: each part page (as the title page lists them) a section, its sub-pages
 * inside it; the text of a page in paragraphs. A heading on a page that repeats the page's own
 * name is left out; other headings inside a page are bold lines. A book on one page: its headings
 * are its sections.
 */
export function wikiTree(book) {
  const drop = new Set((DROP_LINES[book.title] || []).map(normTitle));
  book = regrouped(book);
  const root = new WikiNode('');
  const pages = book.pages.filter(pg => pg.depth === 0 || !EDITORS_PAGES.test(pg.page.split('/').pop()));
  const title = normTitle(book.title.split('/')[0]);
  const [first, firstNotes] = pageParse(pages[0].html);
  // the title page: usually the list of the book's parts; some books are all on it
  const unlinked = pages[0].html.replace(/<a\b[\s\S]*?<\/a>|<style[\s\S]*?<\/style>/g, '');
  const onTitle = pyLen(plain(unlinked).replace(PY_SPACES, '')) > 5000;
  if (pages.length === 1 || onTitle) {
    const author = normTitle(wikiAuthor(book));
    const titleLines = titleAreaLines(pages[0].html);
    const startsAuthor = new RegExp(`^[${PY_SPACE}]*(?:חברו|חיברו|חובר)(?![${WORD}])`);
    first.forEach((b, i) => {
      const fresh = !root.paras.length && !root.children.length;
      if (b[0] !== 'h' && fresh && titleLines.has(normTitle(plain(b[1])))) {
        return;                                // (the title area's own lines)
      }
      if (b[0] !== 'h' && i + 1 < first.length && first[i + 1][0] !== 'h' && fresh
          && plain(first[i + 1][1]) === 'מאת' && pyLen(plain(b[1])) < 80) {
        return;                                // (the title above "מאת / author")
      }
      if (b[0] === 'h') {
        if (b[1] <= 2) {
          root.addChild(b[2]);
        } else if (b[1] === 3 && root.children.length) {
          // (a section's sub-sections: parts of their own beside a section that has its own
          //  text, else inside it)
          const last = root.children[root.children.length - 1];
          (last.paras.length && !last.children.length ? root : last).addChild(b[2]);
        } else {
          root.addPara(`<b>${b[2]}</b>`);
        }
        return;
      }
      const text = plain(b[1]);
      if (PERMISSION_NOTE.test(text)) { return; }      // (the site's note: "copied here with permission")
      if (wikiFurniture(text, '')
          || (fresh && normTitle(plain(b[1])).startsWith(title) && plain(b[1]).includes(' מאת '))
          || (!root.children.length && (outsideLinks(b[1]) || EDITIONS_LINE.test(text)
            || plain(b[1]).includes('בבית הדפוס')
            || (author && pyLen(plain(b[1])) < 100
              && (normTitle(plain(b[1])).includes(author) || startsAuthor.test(plain(b[1]))))))) {
        return;                                // (the site's lines; the book's name "מאת" its author again)
      }
      if (root.children.length || root.paras.length || !(
        [title, 'ספר', 'חיבור', 'קונטרס', ''].includes(normTitle(plain(b[1])))
        || (text.startsWith('מאת ') && pyLen(plain(b[1])) < 80)
        || text === 'מאת')) {
        root.addPara(b[1]);          // (not the title page's "ספר" / "חיבור", title and "מאת ..." again)
        for (const n of firstNotes[i] || []) { root.addNote(n); }
      }
    });
    if (pages.length === 1) { return tidyWikiTree(root); }
  }
  const stack = [root];                        // stack[d]: the section at depth d
  const taken = new Set([bareHtml(pages[0].html)]);
  // (pages under an unlisted middle page that share a name are named after the middle page too)
  const seenNames = {};
  for (const pg of pages.slice(1)) {
    if (Math.max(1, pg.depth) === 1) { const k = normSpace(pg.name); seenNames[k] = (seenNames[k] || 0) + 1; }
  }
  for (const pg of pages.slice(1)) {
    const leafName = pg.page.split('/').pop();
    if (taken.has(bareHtml(pg.html)) || (WHOLE_BOOK_PAGE.test(normTitle(leafName)) && repeatsOthers(pg, pages))) {
      continue;              // (the same page again, under another name; or the whole book on one page)
    }
    taken.add(bareHtml(pg.html));
    const depth = Math.max(1, pg.depth);
    stack.length = Math.min(stack.length, depth);
    while (stack.length < depth) { stack.push(stack[stack.length - 1]); }
    let shown = normSpace(pg.name) || leafName;
    const mids = pg.page.split('/').slice(1, -1);
    if (depth === 1 && mids.length && seenNames[normSpace(pg.name)] > 1) {
      const leaf = normSpace(leafName);
      shown = `${normSpace(mids[mids.length - 1])} – ${leaf.split(PY_SPACES).filter(Boolean).includes(shown) ? leaf : shown}`;
    }
    const node = stack[stack.length - 1].addChild(shown);
    stack.push(node);
    const name = normTitle(pg.name);
    const [blocks, notes] = pageParse(pg.html);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b[0] === 'h') {
        const h = normTitle(b[2]);
        if (WIKI_END.has(h)) { break; }        // (the site's own lists at the page's end)
        const hw = h.split(' ').filter(Boolean);
        const nw = name.split(' ').filter(Boolean);
        if (!h || h === name || (hw.length < nw.length && wordsIn(hw, nw))) { continue; }
        if (wordsIn(nw, hw)) {
          // (the page's fuller name: "אופן א" on the page "א": the section is called so)
          if (!node.paras.length) { node.title = normSpace(b[2]); }
          continue;
        }
        node.paras.push(`<b>${b[2]}</b>`);
        continue;
      }
      const text = plain(b[1]);
      if (WIKI_NAV.test(text) || wikiFurniture(text, name) || drop.has(normTitle(text))
          || (title && normTitle(text) === title)) {
        continue;                              // (the site's navigation)
      }
      if (node.paras.length && /^[.,:;!?״"']+$/.test(text)) {
        node.paras[node.paras.length - 1] += text;   // (a stop on its own: the paragraph's end)
        continue;
      }
      let html = b[1];
      if (!node.paras.length && name && normTitle(text).startsWith(`${name} `)) {
        html = withoutLead(html, name);        // (the page's name again opening its text)
      }
      node.paras.push(html);
      for (const n of notes[i] || []) { node.addNote(n); }
    }
  }
  return tidyWikiTree(root);
}
