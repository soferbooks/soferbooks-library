/**
 * Connections (links) of the extra sources' books: shown in the connections panel and "Under each
 * passage" of an extra book's passage, and of the Sefaria passage (or other extra book's passage)
 * on the other end - an Otzaria commentary on the Shulchan Aruch appears among the Shulchan
 * Aruch's connections once it is downloaded.
 *
 * Where they come from (downloaded with the book, from the book's own source):
 *   Otzaria   its repository's link files (extras/otzaria.js linksPathFor), as Sofer reads them
 *             (importers.otzaria_links): each a line of the book (line_index_1, counted from 1),
 *             tied to Sefaria's ref (ref_2) or, with none, to a line (line_index_2) of another
 *             Otzaria book (path_2). Kinds as Sofer's OTZARIA_LINK_TYPES: "source" (this line
 *             explains that one), "commentary" and "footnotes" (that one explains this);
 *             "reference" (a mention only) is not used.
 *   Dicta     Otzaria's links of the copy a Dicta book is laid out from, and the citations Dicta's
 *             site lists for each page (Sefaria's Linker, extras/dicta.js fetchPageCitations),
 *             placed on the book's paragraphs by their letters. These take a request a page, so
 *             they are fetched after the book opens, in the background.
 *   Wikisource none: its pages link to other Wikisource pages, not to Sefaria's refs.
 *   Sofer Library  the links in the book's own files (extras/sofer.js linksOf: each section's
 *             metadata), as where.ownLinks - Chashukei Chemed's pieces on their Gemara lines.
 *
 * What the phone keeps: library/_extras/links/<md5(title)>.json, one per downloaded book:
 *   {v, title, heTitle,
 *    leaves: [[section ref, Hebrew ref]], lines: {line: [leaf, paragraph]}   (Otzaria's layout: for
 *                                         the links of other books to this one's lines)
 *    links: [{a, ah, t, th, r}]           a: a passage of this book ("<title>, S2, S1:4"), t: the
 *                                         other end (Sefaria's ref, or another extra book's passage);
 *                                         ah/th their Hebrew names; r: 'commentary' (t explains a),
 *                                         'base' (a explains t), 'cite' (a cites t)
 *    pending: [{a, ah, book, line, r}]}   links to another Otzaria book by its line, resolved when
 *                                         that book is downloaded too
 *    secs: [[section ref, Hebrew ref, keys, headings, signs]]   the book's sections, what their
 *                                         headings and paragraphs say of their place (extras/inferred.js)
 *    inferred: [{a, ah, t, th, r: 'base', c}], inferredOn   the obvious connections of a commentary
 *                                         nobody published links for, found by its name and placed as
 *                                         Sofer places it (extras/inferred.js); c: 'sure' | 'likely'.
 *                                         Worked out again whenever a book is downloaded or deleted, so
 *                                         they appear whichever of the two is downloaded first
 * The links of all downloaded books are read into one index by section (both ends), and
 * offlineOnline.loadRelated adds the section's to what Sefaria's links (online or offline) give.
 * The content filter applies as to Sefaria's links: a book it hides is not in the toc, and links
 * to books not in the toc are left out (Sefaria.links.organizeRelatedBySegment, linkSummary).
 */
import * as FileSystem from 'expo-file-system/legacy';
import md5 from 'md5';
import {sectionsOf} from './schema7';
import {normTitle} from './tree';
import {linksUrlForPath} from './otzaria';
import {paraSign, paraOpening, inferBase, inferredLinks, chaptersWanted, sefariaUnits, extraUnits, amudimWanted,
  talmudUnits} from './inferred';

export const VERSION = 1;
const DIR = () => `${FileSystem.documentDirectory}library/_extras/links/`;
export const linksFile = title => `${DIR()}${md5(title)}.json`;

// importers.OTZARIA_LINK_TYPES (Sofer): which end explains which
export const OTZARIA_ROLES = {source: 'base', commentary: 'commentary', footnotes: 'commentary'};

// ---------------------------------------------------------------- the book's passages

/**
 * The book's passages in order, as the converted book names them (extras/schema7.js):
 * {leaves: [[section ref, Hebrew ref]], segs: [[leaf, paragraph (from 1)]], texts: [paragraph]}
 */
export function passagesOf(tree, title, heTitle) {
  const {leaves} = sectionsOf(tree, heTitle);
  const out = {leaves: [], segs: [], texts: []};
  leaves.forEach((l, i) => {
    out.leaves.push([`${title}, ${l.keys.join(', ')}`, `${heTitle}, ${l.heTitles.join(', ')}`]);
    l.paras.forEach((p, j) => {
      out.segs.push([i, j + 1]);
      out.texts.push(p);
    });
  });
  return out;
}

/** A ranged ref's start ("X 4:8-9" -> "X 4:8", "X 60b:8-75b:14" -> "X 60b:8"); titles may have dashes */
export const rangeStart = ref => String(ref || '').replace(/-\d+[ab]?(?::\d+[ab]?)*$/, '');

const segRef = (passages, [leaf, n]) => `${passages.leaves[leaf][0]}:${n}`;
const segHe = (passages, [leaf, n]) => `${passages.leaves[leaf][1]} ${n}`;

/** {line: [leaf, paragraph]} from the tree's lineParas (extras/otzaria.js), or null */
export function lineMap(tree, passages) {
  if (!tree || !tree.lineParas || tree.paraCount !== passages.segs.length) { return null; }
  const out = {};
  for (const [line, i] of Object.entries(tree.lineParas)) { out[line] = passages.segs[i]; }
  return out;
}

/** The name of the book an Otzaria link points to ("אוצריא\\הלכה\\הערות על X.txt" -> "הערות על X") */
export const otzariaBookName = path => String(path || '').split(/[\\/]/).pop().replace(/\.txt$/, '');

/**
 * Otzaria's link file of a book -> {links, pending}: its lines put on the book's passages (Sofer's
 * importers.otzaria_links: Sefaria's ref when Otzaria gives one, else the other book's line).
 */
export function mapOtzariaLinks(raw, lines, passages, heTitle) {
  const out = {links: [], pending: []};
  if (!lines || !Array.isArray(raw)) { return out; }
  const own = normTitle(heTitle);
  for (const e of raw) {
    const r = e && OTZARIA_ROLES[e['Conection Type']];
    const at = r && lines[e.line_index_1];
    if (!at) { continue; }
    const a = segRef(passages, at);
    const ah = segHe(passages, at);
    const ref2 = String(e.ref_2 || '').trim();
    if (ref2) {
      out.links.push({a, ah, t: ref2, th: String(e.heRef_2 || '').trim() || ref2, r});
      continue;
    }
    const book = otzariaBookName(e.path_2);
    if (!book || normTitle(book) === own || !e.line_index_2) { continue; }
    out.pending.push({a, ah, book, line: e.line_index_2, r});
  }
  return out;
}

// ---------------------------------------------------------------- Dicta's citations

const LETTER = /[א-ת]/g;
const lettersOf = s => (String(s || '').replace(/<[^>]+>/g, '').match(LETTER) || []).join('');
const CONTEXT = 15;          // letters on each side that tell one citation of a place from another
const SHORTEST = 6;          // a citation's own letters, alone, are looked for only if this many

/** "sefaria.org/Shulchan_Arukh,_Choshen_Mishpat.51.6" -> "Shulchan Arukh, Choshen Mishpat 51:6" */
export function sefariaUrlToRef(url) {
  let s = String(url || '').replace(/^https?:\/\//, '').replace(/^(www\.)?sefaria\.org(\.il)?\//, '');
  s = s.split(/[?#]/)[0];
  try { s = decodeURIComponent(s); } catch (e) { /* as it is */ }
  if (!s) { return null; }
  s = s.replace(/\./, ' ').replace(/_/g, ' ').replace(/\./g, ':');
  return rangeStart(s).trim() || null;      // (a range: its start)
}

/**
 * Dicta's citations ([{text, citations}] a page, extras/dicta.js) put on the book's passages: each
 * found in the book's text by its letters with a few letters around it, from where the last one
 * was found (the pages are in the book's order), else anywhere. -> links [{a, ah, t, th, r: 'cite'}]
 */
export function placeCitations(pages, passages) {
  const starts = [];
  let all = '';
  for (const t of passages.texts) {
    starts.push(all.length);
    all += lettersOf(t);
  }
  const segAt = pos => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) { lo = mid; } else { hi = mid - 1; }
    }
    return lo;
  };
  const out = [];
  const seen = new Set();
  let cursor = 0;
  for (const page of pages || []) {
    const text = String((page && page.text) || '');
    for (const c of (page && page.citations) || []) {
      const core = lettersOf(text.slice(c.start, c.start + c.length)) || lettersOf(c.matched);
      if (!core) { continue; }
      const before = lettersOf(text.slice(Math.max(0, c.start - 4 * CONTEXT), c.start)).slice(-CONTEXT);
      const after = lettersOf(text.slice(c.start + c.length, c.start + c.length + 4 * CONTEXT)).slice(0, CONTEXT);
      const tries = [[before + core + after, before.length], [core + after, 0], [before + core, before.length]];
      if (core.length >= SHORTEST) { tries.push([core, 0]); }
      let at = -1;
      for (const [needle, skip] of tries) {
        let i = all.indexOf(needle, Math.max(0, cursor - 2000));
        if (i < 0) { i = all.indexOf(needle); }
        if (i >= 0) { at = i + skip; break; }
      }
      if (at < 0 || !starts.length) { continue; }
      cursor = at;
      const seg = passages.segs[segAt(at)];
      for (const s of c.sources) {
        const t = sefariaUrlToRef(s.url);
        if (!t) { continue; }
        const a = segRef(passages, seg);
        const key = `${a}|${t}`;
        if (seen.has(key)) { continue; }
        seen.add(key);
        out.push({a, ah: segHe(passages, seg), t, th: s.he || t, r: 'cite'});
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- downloaded with the book

async function readJSON(path) {
  try { return JSON.parse(await FileSystem.readAsStringAsync(path)); } catch (e) { return null; }
}

async function writeJSON(path, data) {
  await FileSystem.makeDirectoryAsync(DIR(), {intermediates: true}).catch(() => {});
  await FileSystem.writeAsStringAsync(path, JSON.stringify(data));
}

export const readLinks = title => readJSON(linksFile(title));
export async function saveLinks(title, data) {
  await writeJSON(linksFile(title), data);
  invalidate();
}

export async function removeLinks(title) {
  await FileSystem.deleteAsync(linksFile(title), {idempotent: true}).catch(() => {});
  invalidate();
}

/**
 * A downloaded book's links, from its source (source.linksOf(entry, text) says where), kept on the
 * phone. Otzaria's file is fetched now (one request); Dicta's citations - a request a page - after,
 * in the background: the promise `later` (stillWanted() is asked before they are kept, so a book
 * deleted meanwhile gets none). Never throws: a book without links is still a book.
 */
export async function collect({title, heTitle, tree, where, fetchCitations, stillWanted = () => true}) {
  const own = (where && where.ownLinks) || [];
  if (!tree) {
    // (a book that came ready made - the Sofer Library's: only the links its files give)
    const data = {v: VERSION, title, heTitle, links: own, pending: []};
    await writeJSON(linksFile(title), data).catch(e => console.log('extras: links', e));
    invalidate();
    return {data, later: Promise.resolve(false)};
  }
  const passages = passagesOf(tree, title, heTitle);
  const lines = lineMap(tree, passages);
  const data = {v: VERSION, title, heTitle, links: own.slice(), pending: [], secs: sectionSigns(tree, heTitle, passages)};
  if (lines) {
    data.leaves = passages.leaves;
    data.lines = lines;
  }
  if (where && where.otzariaPath && lines) {
    try {
      const url = linksUrlForPath(where.otzariaPath);
      const response = url ? await fetch(url) : null;
      if (response && response.ok) {
        const raw = JSON.parse((await response.text()).replace(/^﻿/, ''));
        Object.assign(data, mapOtzariaLinks(raw, lines, passages, heTitle));
      }
    } catch (e) {
      console.log('extras: Otzaria\'s links of', title, e);
    }
  }
  await writeJSON(linksFile(title), data).catch(e => console.log('extras: links', e));
  invalidate();
  let later = Promise.resolve(false);
  if (where && where.dictaPages && fetchCitations) {
    later = (async () => {
      try {
        const pages = await fetchCitations();
        const cites = placeCitations(pages, passages);
        if (!cites.length || !stillWanted()) { return false; }
        const now = (await readJSON(linksFile(title))) || data;
        now.links = (now.links || []).concat(cites);
        await writeJSON(linksFile(title), now);
        invalidate();
        return true;
      } catch (e) {
        console.log('extras: Dicta\'s citations of', title, e);
        return false;
      }
    })();
  }
  return {data, later};
}

// ---------------------------------------------------------------- the obvious connections

/** What extras/inferred.js needs of a book's sections: [[ref, heRef, keys, headings, signs, openings]] */
export function sectionSigns(tree, heTitle, passages) {
  const {leaves} = sectionsOf(tree, heTitle);
  return leaves.map((l, i) => [passages.leaves[i][0], passages.leaves[i][1], l.keys, l.heTitles,
    l.paras.map(p => (String(p).trim() ? paraSign(p) : null)),
    l.paras.map(p => (String(p).trim() ? paraOpening(p) : null))]);
}

const MAX_CHAPTERS = 160;     // (a book's chapters read one by one when the commentary does not say which)

/** A ref in `title` (Sefaria's "Title 1:2", an extra book's "Title, S1:2") */
const inBook = (ref, title) => String(ref || '').startsWith(`${title} `) || String(ref || '').startsWith(`${title},`);

const devLog = (...args) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) { console.log('extras: inferred links:', ...args); }
};

/**
 * Work out again the obvious connections of the downloaded books (extras/inferred.js) where a
 * download or a deletion may change them: of the book `changed` itself, of the books whose base it
 * is, and of any whose base is now another book. Pure apart from what it is given:
 *   files    {title: its links file}            the downloaded books (changed in place)
 *   books    [{key, kind, title, heTitle, commentary}]   the books a commentary may be on: Sefaria's
 *            (as the content filter leaves its toc) and the downloaded extra books ('extra:<title>')
 *   loadSection(ref) -> [paragraph html]        a section's text (offline, else Sefaria's API)
 * Returns the titles whose file changed.
 */
export async function inferAll({files, books, changed = null, loadSection}) {
  const out = [];
  for (const [title, f] of Object.entries(files)) {
    if (!f || !f.secs) { continue; }
    const found = inferBase(f.heTitle, books, `extra:${title}`);
    const on = found.book ? found.book.key : null;
    if (title !== changed && (!changed || on !== `extra:${changed}`) && (f.inferredOn || null) === on) { continue; }
    let inferred = [];
    if (!found.book) {
      if (/ על /.test(f.heTitle || '')) { devLog(f.heTitle, '-', found.why); }
    } else {
      const base = found.book;
      const own = (f.links || []).some(l => l.r === 'base' && inBook(l.t, base.title))
        || (f.pending || []).some(p => normTitle(p.book) === normTitle(base.heTitle));
      if (own) {
        devLog(f.heTitle, '- its own links already tie it to', base.title);
      } else {
        try {
          inferred = await linksTo(f, base, files, loadSection);
          if (found.confidence === 'likely') { inferred = inferred.map(l => ({...l, c: 'likely'})); }
          devLog(f.heTitle, '->', base.title, `(${found.why}):`, inferred.length, 'links');
        } catch (e) {
          devLog(f.heTitle, '->', base.title, '- its text could not be read now:', String((e && e.message) || e));
          continue;                 // (tried again at the next download)
        }
      }
    }
    if (!inferred.length && !(f.inferred || []).length && (f.inferredOn || null) === on) { continue; }
    f.inferred = inferred;
    f.inferredOn = on;
    out.push(title);
  }
  return out;
}

/** The links of commentary f to `base`: a Sefaria book in chapters and verses, or a downloaded extra book */
async function linksTo(f, base, files, loadSection) {
  let units;
  if (base.kind === 'extra') {
    const g = files[base.title];
    if (!g || !g.secs) { return []; }
    const texts = {};
    for (const l of g.secs) { texts[l[0]] = await loadSection(l[0]); }
    units = extraUnits(g.secs, texts);
  } else if ((base.categories || [])[0] === 'Talmud') {
    // (the Gemara: the amudim the commentary names, and those beside them)
    const amudim = [];
    for (const label of amudimWanted({leaves: f.secs})) {
      let segs = null;
      try { segs = await loadSection(`${base.title} ${label}`); } catch (e) { segs = null; }
      if (Array.isArray(segs) && segs.every(v => typeof v === 'string')) { amudim.push([label, segs]); }
    }
    if (!amudim.length) {
      devLog(f.heTitle, '-', base.title, ': no daf named, or none could be read');
      return [];
    }
    units = talmudUnits(base.title, base.heTitle, amudim);
  } else {
    const chapters = [];
    const wanted = chaptersWanted({leaves: f.secs});
    const all = !wanted.length;             // (no chapters named: all of them, for its quotes)
    for (const n of all ? [...Array(MAX_CHAPTERS).keys()] : wanted) {
      let verses;
      try { verses = await loadSection(`${base.title} ${n + 1}`); } catch (e) {
        if (all && chapters.length) { break; }
        throw e;
      }
      if (all && (!Array.isArray(verses) || !verses.length)) { break; }
      if (!Array.isArray(verses) || verses.some(v => typeof v !== 'string')) {
        devLog(f.heTitle, '-', base.title, 'is not in chapters and verses');
        return [];
      }
      chapters.push([n, verses]);
    }
    units = sefariaUnits(base.title, base.heTitle, chapters);
  }
  return inferredLinks({leaves: f.secs}, {units}).map(({how, ...l}) => l);
}

// ---------------------------------------------------------------- the index: section -> links

let index = null;           // Map: section ref -> [{anchor, other, otherHe, commentary}]
let building = null;
let generation = 0;

export function invalidate() {
  index = null;
  building = null;
  generation += 1;
}

/** The section of a passage ref: all but its last number ("X 4:8" -> "X 4"); null for a section */
export function sectionOf(ref) {
  const s = rangeStart(ref);
  const i = s.lastIndexOf(':');
  return i > 0 ? s.slice(0, i) : null;
}

/** The index of the books' link files ([{title, links, pending, leaves, lines, heTitle}]): pure */
export function buildIndex(files) {
  const map = new Map();
  const seen = new Set();
  const add = (anchor, other, otherHe, commentary, confidence) => {
    const section = sectionOf(anchor);
    const key = `${anchor}|${other}`;
    if (!section || seen.has(key)) { return; }
    seen.add(key);
    if (!map.has(section)) { map.set(section, []); }
    map.get(section).push({anchor: rangeStart(anchor), other, otherHe, commentary, ...(confidence ? {confidence} : {})});
  };
  const both = l => {
    add(l.a, l.t, l.th, l.r === 'commentary', l.c);
    add(l.t, l.a, l.ah, l.r === 'base', l.c);
  };
  const byName = new Map();
  for (const f of files) {
    if (f && f.lines && f.leaves && f.heTitle) { byName.set(normTitle(f.heTitle), f); }
  }
  for (const f of files) {
    if (!f) { continue; }
    (f.links || []).forEach(both);
    for (const p of f.pending || []) {
      const g = byName.get(normTitle(p.book));
      const at = g && g.lines[p.line];
      if (!at || !g.leaves[at[0]]) { continue; }
      const leaf = g.leaves[at[0]];
      both({a: p.a, ah: p.ah, t: `${leaf[0]}:${at[1]}`, th: `${leaf[1]} ${at[1]}`, r: p.r});
    }
  }
  // the obvious connections last: a book's own link of the same two passages wins
  for (const f of files) { ((f && f.inferred) || []).forEach(both); }
  // the books that are commentaries: their links tie them to the text they explain (their own,
  // or found by their name) - for the dibbur hamaschil in bold (reader/dibbur.js)
  map.commentaries = new Set(files.filter(f => f && f.title && (
    (f.links || []).some(l => l.r === 'base') || (f.pending || []).some(p => p.r === 'base')
    || (f.inferred || []).length)).map(f => f.title));
  return map;
}

/** The downloaded extra books that are commentaries (a Set; empty until the index is read) */
export const commentaryTitles = () => (index && index.commentaries) || new Set();

/** Read the link files of the downloaded books (titles) into the index, once until invalidated */
export function ready(titles) {
  if (index) { return Promise.resolve(index); }
  if (!building) {
    const gen = generation;
    building = (async () => {
      const files = [];
      for (const t of titles || []) {
        const f = await readJSON(linksFile(t));
        if (f) { files.push(f); }
      }
      const built = buildIndex(files);
      if (gen === generation) { index = built; }
      return built;
    })();
  }
  return building;
}

/** A Talmud ref to a whole daf ("Yoma 18", as Dicta's citations give it) names its first side */
function dafRef(ref, title) {
  const cats = typeof Sefaria !== 'undefined' && Sefaria.categoriesForTitle ? Sefaria.categoriesForTitle(title) : null;
  return cats && cats[0] === 'Talmud' && /^\d+$/.test(ref.slice(title.length).trim()) ? `${ref}a` : ref;
}

/**
 * The extra books' links of a section, as the links API gives them (offline.loadLinksOffline's
 * shape): [{sourceRef, sourceHeRef, index_title, category, anchorRef, sourceHasEn}]
 */
export function relatedFromIndex(map, sectionRef) {
  const out = [];
  for (const l of (map && map.get(sectionRef)) || []) {
    const title = typeof Sefaria !== 'undefined' ? Sefaria.textTitleForRef(l.other) : null;
    if (!title) { continue; }          // (not in the library: hidden by the content filter, or not there)
    const category = l.commentary ? 'Commentary'
      : ((typeof Sefaria !== 'undefined' && Sefaria.primaryCategoryForTitle(title)) || 'Other');
    out.push({
      sourceRef: dafRef(l.other, title),
      sourceHeRef: l.otherHe || l.other,
      index_title: title,
      collectiveTitle: undefined,
      category,
      anchorRef: l.anchor,
      sourceHasEn: false,
      ...(l.confidence ? {inferred: l.confidence} : {}),   // (an obvious connection: 'sure' | 'likely')
    });
  }
  return out;
}

/** The links API's response for a section with the extra books' links of it added */
export function withExtraLinks(response, extra) {
  if (!extra || !extra.length) { return response; }
  const links = (response && response.links) || [];
  const have = new Set(links.map(l => `${l.anchorRef}|${l.sourceRef}`));
  return {...(response || {}), links: links.concat(extra.filter(l => !have.has(`${l.anchorRef}|${l.sourceRef}`)))};
}

// (tests)
export function _reset() { invalidate(); }
