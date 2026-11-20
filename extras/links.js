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
import {commentaryShortTitles} from './schema7';
import {sectionsOf} from './schema7';
import {normTitle} from './tree';
import {linksUrlForPath} from './otzaria';
import {paraSign, paraOpening, inferBase, inferredLinksAsync, chaptersWanted, sefariaUnits, extraUnits, amudimWanted,
  talmudUnits, quotesDibburim, dibburimOf, amudLabel} from './inferred';

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
  await writeLinksFile(title, data);
  invalidate(title);
}

/**
 * A book's links file written. The version it replaces is kept aside (removed/, unless one is
 * there already: the index still has that one's records) so the index on the phone swaps the
 * book's records - readyOnDisk: an updated book kept its old records beside the new ones
 * until the whole index was made again (2026-11-20). And the book's summary noted (summariesFor).
 */
async function writeLinksFile(title, data) {
  const from = linksFile(title);
  const aside = `${REMOVED_DIR()}${md5(title)}.json`;
  const [now, kept] = await Promise.all([FileSystem.getInfoAsync(from).catch(() => null), FileSystem.getInfoAsync(aside).catch(() => null)]);
  if (now && now.exists && !(kept && kept.exists)) {
    await FileSystem.makeDirectoryAsync(REMOVED_DIR(), {intermediates: true}).catch(() => {});
    await FileSystem.moveAsync({from, to: aside}).catch(() => {});
  }
  await writeJSON(from, data);
  await noteSummary(title, data);
}

// ---------------------------------------------------------------- the books' summaries
// (what the obvious connections need to know of every downloaded book - its Hebrew name, whether it
//  has sections to tie, what it was tied to - kept in one small file, so a download or a deletion
//  reads only the books whose base may have changed: reading all 1,971 books' links files, 380 MB,
//  took minutes on the 32-bit tablet each time - 2026-11-20)
const SUMMARY_FILE = () => `${DIR()}summary.json`;
let summary = null;
let summarySaving = null;
const summarize = f => ({heTitle: f.heTitle || null, secs: Array.isArray(f.secs) && f.secs.length > 0, inferredOn: f.inferredOn || null});
async function loadSummary() {
  if (!summary) { summary = (await readJSON(SUMMARY_FILE())) || {}; }
  return summary;
}
function saveSummarySoon() {
  if (!summarySaving) {
    summarySaving = new Promise(resolve => setTimeout(resolve, 1000))
      .then(() => { summarySaving = null; return writeJSON(SUMMARY_FILE(), summary); })
      .catch(() => { summarySaving = null; });
  }
  return summarySaving;
}
async function noteSummary(title, f) {
  await loadSummary();
  if (f) { summary[title] = summarize(f); } else { delete summary[title]; }
  saveSummarySoon();
}
/** {title: {heTitle, secs, inferredOn}} of these books (a book not noted yet: its file read once) */
export async function summariesFor(titles) {
  await loadSummary();
  let added = false;
  for (const t of titles) {
    if (summary[t]) { continue; }
    const f = await readJSON(linksFile(t));
    if (f) { summary[t] = summarize(f); added = true; }
  }
  if (added) { saveSummarySoon(); }
  const out = {};
  titles.forEach(t => { if (summary[t]) { out[t] = summary[t]; } });
  return out;
}
export const _resetSummary = () => { summary = null; };

export async function removeLinks(title) {
  // (kept aside until the index on the phone has taken out this book's records - readyOnDisk -
  //  instead of the whole index made again: 20 minutes on the 32-bit tablet, with no connections
  //  of the extra books meanwhile, after Otzaria's copies were deleted - 2026-11-20)
  const info = await FileSystem.getInfoAsync(linksFile(title)).catch(() => null);
  const kept = await FileSystem.getInfoAsync(`${REMOVED_DIR()}${md5(title)}.json`).catch(() => null);
  await noteSummary(title, null);
  if (info && info.exists && kept && kept.exists) {
    // (an earlier version is kept aside already: the index still has its records)
    await FileSystem.deleteAsync(linksFile(title), {idempotent: true}).catch(() => {});
  } else if (info && info.exists) {
    await FileSystem.makeDirectoryAsync(REMOVED_DIR(), {intermediates: true}).catch(() => {});
    try {
      await FileSystem.moveAsync({from: linksFile(title), to: `${REMOVED_DIR()}${md5(title)}.json`});
    } catch (e) {
      await FileSystem.deleteAsync(linksFile(title), {idempotent: true}).catch(() => {});
      invalidate();
      return;
    }
  }
  invalidate(title, {removed: true});
}
const REMOVED_DIR = () => `${DIR()}removed/`;

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
    await writeLinksFile(title, data).catch(e => console.log('extras: links', e));
    invalidate(title);
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
      // (from the Otzaria release's zip when the book came from it, else from Otzaria's server)
      let body = typeof where.otzariaLinks === 'string' ? where.otzariaLinks : null;
      if (body === null) {
        const url = linksUrlForPath(where.otzariaPath);
        const response = url ? await fetch(url) : null;
        if (response && response.ok) { body = await response.text(); }
      }
      if (body !== null) {
        const raw = JSON.parse(body.replace(/^﻿/, ''));
        Object.assign(data, mapOtzariaLinks(raw, lines, passages, heTitle));
      }
    } catch (e) {
      console.log('extras: Otzaria\'s links of', title, e);
    }
  }
  await writeLinksFile(title, data).catch(e => console.log('extras: links', e));
  invalidate(title);
  let later = Promise.resolve(false);
  if (where && where.dictaPages && fetchCitations) {
    later = (async () => {
      try {
        const pages = await fetchCitations();
        const cites = placeCitations(pages, passages);
        if (!cites.length || !stillWanted()) { return false; }
        const now = (await readJSON(linksFile(title))) || data;
        now.links = (now.links || []).concat(cites);
        await writeLinksFile(title, now);
        invalidate(title);
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

/**
 * A moment for the reader between two steps of the obvious connections' work: it reads a whole
 * masechta (with Rashi and Tosafos) a section at a time, and the app answers taps meanwhile.
 */
export const yieldToUI = () => new Promise(resolve => setTimeout(resolve, 0));

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

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
 *   loadIndex(title) -> its index or null       a Sefaria book's index (the Gemara's length and perakim)
 * Returns the titles whose file changed.
 */
export async function inferAll({files, books, changed = null, loadSection, loadIndex = null}) {
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
          const started = now();
          inferred = await linksTo(f, base, files, loadSection, loadIndex);
          if (found.confidence === 'likely') { inferred = inferred.map(l => ({...l, c: 'likely'})); }
          // (how long it took, in the log: a masechta is read whole - QA round 16)
          console.log('extras: inferred links of', title, 'on', base.title, `(${found.why}):`, inferred.length,
            'links in', Math.round(now() - started), 'ms');
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

const MAX_AMUDIM = 400;        // (a masechta read amud by amud when its index does not say how long it is)
const MAX_MISSES = 6;          // (amudim missing in a row that end a masechta whose length is not known)
const READ_AT_ONCE = 6;        // (amudim read at once when the length is known)
const amudims = (amudim, i, segs) => { amudim.push([amudLabel(i), segs]); };

/** "Gittin 2a:1-15a:7" -> [first amud, last amud] (1a = 0): mg_books._perek_amuds */
export function perekAmuds(index) {
  const nodes = (((index && index.alts) || {}).Chapters || {}).nodes || [];
  const out = [];
  for (const n of nodes) {
    const last = String(n.wholeRef || '').split(' ').pop();
    const m = [...last.matchAll(/(\d+)([ab])/g)].map(x => 2 * parseInt(x[1], 10) - 2 + (x[2] === 'b' ? 1 : 0));
    if (m.length) { out.push([m[0], m[m.length - 1]]); }
  }
  return out;
}

/** A Gemara commentary's lines of one amud ("Rashi on Gittin 2a"): [line: [comment html]], or null */
async function commentaryLines(ref, nLines, loadSection) {
  let got = null;
  try { got = await loadSection(ref); } catch (e) { got = null; }
  if (!Array.isArray(got)) { return null; }
  // (Sefaria's API: the amud's lines, each a list of comments)
  if (!got.length || got.some(Array.isArray)) { return got.map(l => (Array.isArray(l) ? l : [l])); }
  // (the offline files give one line at a time: each line of the Gemara's amud)
  const lines = [];
  for (let i = 0; i < nLines; i++) {
    let line = null;
    try { line = await loadSection(`${ref}:${i + 1}`); } catch (e) { line = null; }
    lines.push(Array.isArray(line) ? line.filter(c => typeof c === 'string') : []);
  }
  return lines;
}

/**
 * The Gemara a commentary is on, as Sofer reads it for its loose placement (mg_books._loose_place):
 * the whole masechta, amud by amud from 2a; Rashi's and Tosafos' dibburim on it when the commentary
 * opens comments on their words (dibburim.load); the amudim of its perakim. -> {units, dibburim,
 * perakim, unread} or null (none of it could be read).
 */
async function talmudBase(f, base, loadSection, loadIndex) {
  let index = null;
  try { index = loadIndex ? await loadIndex(base.title) : null; } catch (e) { index = null; }
  const length = index && index.schema && Array.isArray(index.schema.lengths) ? index.schema.lengths[0] : null;
  const named = amudimWanted({leaves: f.secs}).map(l => {
    const m = /^(\d+)([ab])$/.exec(l);
    return 2 * parseInt(m[1], 10) - 2 + (m[2] === 'b' ? 1 : 0);
  });
  let lastNamed = 2;
  for (const n of named) { if (n > lastNamed) { lastNamed = n; } }
  const amudim = [];
  const unread = new Set();
  const read = async i => {
    let segs = null;
    try { segs = await loadSection(`${base.title} ${amudLabel(i)}`); } catch (e) { segs = null; }
    return Array.isArray(segs) && segs.length && segs.every(v => typeof v === 'string') ? segs : null;
  };
  if (length) {
    // (its length known: several amudim at once - read online they are a request each - with a
    //  moment for the reader between batches)
    for (let from = 2; from < length; from += READ_AT_ONCE) {
      const batch = [];
      for (let i = from; i < Math.min(length, from + READ_AT_ONCE); i++) { batch.push(i); }
      const got = await Promise.all(batch.map(read));
      batch.forEach((i, k) => { if (got[k]) { amudims(amudim, i, got[k]); } else { unread.add(i); } });
      await yieldToUI();
    }
  } else {
    let misses = 0;
    for (let i = 2; i < MAX_AMUDIM; i++) {
      if (i % 4 === 0) { await yieldToUI(); }
      const segs = await read(i);
      if (segs) {
        misses = 0;
        amudims(amudim, i, segs);
        continue;
      }
      misses += 1;
      // (past the masechta's end: after the last amud the commentary names, or - a heading read as a
      //  daf it is not - after several missing in a row: QA round 17 read Berakhot on to 138a)
      if (amudim.length && (i > lastNamed || misses >= MAX_MISSES)) { break; }
      unread.add(i);
    }
  }
  if (!amudim.length) { return null; }
  let dibburim = null;
  if (quotesDibburim({leaves: f.secs})) {
    const of = {rashi: [], tosafot: []};
    for (let k = 0; k < amudim.length; k += READ_AT_ONCE) {
      const batch = amudim.slice(k, k + READ_AT_ONCE);
      const got = await Promise.all(batch.map(([label, segs]) => Promise.all(['Rashi', 'Tosafot'].map(name =>
        commentaryLines(`${name} on ${base.title} ${label}`, segs.length, loadSection)))));
      batch.forEach(([label], j) => {
        const m = /^(\d+)([ab])$/.exec(label);
        const ai = 2 * parseInt(m[1], 10) - 2 + (m[2] === 'b' ? 1 : 0);
        if (got[j][0]) { of.rashi.push([ai, got[j][0]]); }
        if (got[j][1]) { of.tosafot.push([ai, got[j][1]]); }
      });
      await yieldToUI();
    }
    dibburim = dibburimOf(of);
  }
  return {units: talmudUnits(base.title, base.heTitle, amudim), dibburim, perakim: perekAmuds(index), unread};
}

/** The links of commentary f to `base`: a Sefaria book in chapters and verses, or a downloaded extra book */
async function linksTo(f, base, files, loadSection, loadIndex = null) {
  let units;
  if (base.kind === 'extra') {
    const g = files[base.title];
    if (!g || !g.secs) { return []; }
    const texts = {};
    for (const l of g.secs) { texts[l[0]] = await loadSection(l[0]); }
    units = extraUnits(g.secs, texts);
  } else if ((base.categories || [])[0] === 'Talmud') {
    // (the Gemara: the whole masechta, with Rashi's and Tosafos' dibburim - as Sofer reads it)
    const read = now();
    const gemara = await talmudBase(f, base, loadSection, loadIndex);
    if (!gemara) {
      devLog(f.heTitle, '-', base.title, ': it could not be read');
      return [];
    }
    console.log('extras: inferred links:', base.title, 'read in', Math.round(now() - read), 'ms');
    await yieldToUI();
    return (await inferredLinksAsync({leaves: f.secs}, gemara, false, yieldToUI)).map(({how, ...l}) => l);
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
  return (await inferredLinksAsync({leaves: f.secs}, {units}, false, yieldToUI)).map(({how, ...l}) => l);
}

// ---------------------------------------------------------------- the index: section -> links

let index = null;           // Map: section ref -> [{anchor, other, otherHe, commentary}]
let building = null;
let generation = 0;

export function invalidate(title = null, {removed = false} = {}) {
  index = null;
  building = null;
  generation += 1;
  // (a book deleted: its records are taken out of the index when next needed - removeLinks)
  if (removed) {
    if (typeof disk !== 'undefined') { disk.shards.clear(); }
    return;
  }
  // (the index on the phone: a book's links saved - downloaded, updated - are added to it when next
  //  needed; anything else - a book deleted - has it made again. Kept so across a restart too.)
  if (typeof disk !== 'undefined') { disk.shards.clear(); }
  if (title) {
    markedTitles = markedTitles.then(async () => {
      const list = (await readJSON(`${DIR()}added.json`)) || [];
      if (!list.includes(title)) { list.push(title); }
      await writeJSON(`${DIR()}added.json`, list);
    }).catch(() => {});
    return;
  }
  FileSystem.makeDirectoryAsync(DIR(), {intermediates: true}).catch(() => {})
    .then(() => FileSystem.writeAsStringAsync(`${DIR()}changed.json`, '1')).catch(() => {});
}
let markedTitles = Promise.resolve();

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
export const commentaryTitles = () => (disk.commentaries || (index && index.commentaries) || new Set());

// ---------------------------------------------------------------- the index on the phone's storage
// (2026-11-20, the 32-bit tablet: the index above, all 1,971 books' links in one Map, took the app
// from 156 MB to 1 GB of its 2 GB and 87 s at every start.) The same records (buildIndex's) are
// kept on the phone instead, one file per book of the passages they are on ("Niddah", "Shulchan
// Arukh, Orach Chayim", an extra book's keyed parts), made by reading the link files one at a time,
// and kept from one start to the next until a book's links change. A section's links are read from
// its book's file alone.
const INDEX_DIR = () => `${FileSystem.documentDirectory}library/_extras/links-index/`;
const INDEX_VERSION = 1;
const FLUSH_EVERY = 100000;       // records kept in memory before they are written to their files (about 20 MB)
const SHARDS_KEPT = 6;            // books' files kept in memory (the book being read, its commentaries)
const disk = {manifest: null, commentaries: null, building: null, shards: new Map(), checked: null};

/** The book a section is in, as the index files are kept: the section without its last part */
export const shardOf = section => String(section || '').replace(/,? [^ ]+$/, '') || String(section || '');
const shardFile = (dir, shard) => `${dir}${md5(shard)}.json`;
const titlesKey = titles => md5([...(titles || [])].sort().join('\n'));

/** The index on the phone, as last made (its manifest), or null */
async function diskManifest() {
  if (disk.manifest) { return disk.manifest; }
  const m = await readJSON(`${INDEX_DIR()}manifest.json`);
  if (m && m.v === INDEX_VERSION) {
    disk.manifest = m;
    disk.commentaries = new Set(m.commentaries || []);
  }
  return disk.manifest;
}

/** Write the records of `buckets` ({shard: {section: [record]}}) into their files in `dir` */
async function flushBuckets(dir, buckets, fresh = null) {
  for (const [shard, sections] of buckets) {
    const path = shardFile(dir, shard);
    // (a book's file written for the first time in a build starts empty: nothing of the last index stays)
    const first = fresh && !fresh.has(shard);
    if (fresh) { fresh.add(shard); }
    const have = first ? {} : ((await readJSON(path)) || {});
    for (const [section, recs] of Object.entries(sections)) {
      const list = have[section] || [];
      const keys = new Set(list.map(r => `${r.anchor}|${r.other}`));
      for (const r of recs) {
        const k = `${r.anchor}|${r.other}`;
        if (!keys.has(k)) { keys.add(k); list.push(r); }     // (the first record of two passages wins)
      }
      have[section] = list;
    }
    await FileSystem.writeAsStringAsync(path, JSON.stringify(have));
    await yieldToUI();
  }
  buckets.clear();
}

/** Make the index on the phone from the books' link files, a file at a time */
async function buildOnDisk(titles) {
  // (made in place; its manifest is written last, so an index half made - the app closed meanwhile
  //  - is never used: it is made again)
  const dir = INDEX_DIR();
  disk.manifest = null;
  await FileSystem.deleteAsync(dir, {idempotent: true}).catch(() => {});
  await FileSystem.makeDirectoryAsync(dir, {intermediates: true}).catch(() => {});
  // the books other books' pending links point to (by line): only their lines are kept
  const needed = new Set();
  const commentaries = [];
  for (const t of titles) {
    const f = await readJSON(linksFile(t));
    if (!f) { continue; }
    (f.pending || []).forEach(p => needed.add(normTitle(p.book)));
    if ((f.links || []).some(l => l.r === 'base') || (f.pending || []).some(p => p.r === 'base') || (f.inferred || []).length) {
      commentaries.push(f.title || t);
    }
    await yieldToUI();
  }
  const byName = new Map();
  if (needed.size) {
    for (const t of titles) {
      const f = await readJSON(linksFile(t));
      if (f && f.lines && f.leaves && f.heTitle && needed.has(normTitle(f.heTitle))) {
        byName.set(normTitle(f.heTitle), {lines: f.lines, leaves: f.leaves});
      }
      await yieldToUI();
    }
  }
  const buckets = new Map();
  const fresh = new Set();
  let count = 0;
  const add = async (anchor, other, otherHe, commentary, confidence) => {
    const section = sectionOf(anchor);
    if (!section) { return; }
    const shard = shardOf(section);
    if (!buckets.has(shard)) { buckets.set(shard, {}); }
    const b = buckets.get(shard);
    (b[section] = b[section] || []).push({anchor: rangeStart(anchor), other, otherHe, commentary, ...(confidence ? {confidence} : {})});
    count += 1;
    if (count >= FLUSH_EVERY) { count = 0; await flushBuckets(dir, buckets, fresh); }
  };
  const both = async l => {
    await add(l.a, l.t, l.th, l.r === 'commentary', l.c);
    await add(l.t, l.a, l.ah, l.r === 'base', l.c);
  };
  // the books' own links (and their pending ones, by line) first; the obvious connections last
  for (const pass of ['own', 'inferred']) {
    for (const t of titles) {
      const f = await readJSON(linksFile(t));
      if (!f) { continue; }
      if (pass === 'own') {
        for (const l of f.links || []) { await both(l); }
        for (const p of f.pending || []) {
          const g = byName.get(normTitle(p.book));
          const at = g && g.lines[p.line];
          if (!at || !g.leaves[at[0]]) { continue; }
          const leaf = g.leaves[at[0]];
          await both({a: p.a, ah: p.ah, t: `${leaf[0]}:${at[1]}`, th: `${leaf[1]} ${at[1]}`, r: p.r});
        }
      } else {
        for (const l of f.inferred || []) { await both(l); }
      }
      await yieldToUI();
    }
    await flushBuckets(dir, buckets, fresh);
    count = 0;
  }
  const manifest = {v: INDEX_VERSION, key: titlesKey(titles), titles: [...titles], made: Date.now(), commentaries};
  await FileSystem.writeAsStringAsync(`${dir}manifest.json`, JSON.stringify(manifest));
  return manifest;
}

/**
 * Books downloaded or updated since the index was made: their records added to it (their own links,
 * their pending ones by the lines of the books they point to, their obvious connections). A book
 * updated has its earlier records taken out first (removeFromDisk, its earlier file kept aside).
 */
/** The index's records a book's links file makes ({shard: {section: [record]}}), and whether it is a commentary */
async function recordsOf(f, titles, lineBooks = new Map()) {
  const buckets = new Map();
  const add = (anchor, other, otherHe, commentary, confidence) => {
    const section = sectionOf(anchor);
    if (!section) { return; }
    const shard = shardOf(section);
    if (!buckets.has(shard)) { buckets.set(shard, {}); }
    const b = buckets.get(shard);
    (b[section] = b[section] || []).push({anchor: rangeStart(anchor), other, otherHe, commentary, ...(confidence ? {confidence} : {})});
  };
  const both = l => {
    add(l.a, l.t, l.th, l.r === 'commentary', l.c);
    add(l.t, l.a, l.ah, l.r === 'base', l.c);
  };
  const linesOf = async name => {
    if (lineBooks.has(name)) { return lineBooks.get(name); }
    let found = null;
    for (const t of titles) {
      const f = await readJSON(linksFile(t));
      if (f && f.lines && f.leaves && f.heTitle && normTitle(f.heTitle) === name) { found = {lines: f.lines, leaves: f.leaves}; break; }
    }
    lineBooks.set(name, found);
    return found;
  };
  (f.links || []).forEach(both);
  for (const p of f.pending || []) {
    const g = await linesOf(normTitle(p.book));
    const at = g && g.lines[p.line];
    if (!at || !g.leaves[at[0]]) { continue; }
    const leaf = g.leaves[at[0]];
    both({a: p.a, ah: p.ah, t: `${leaf[0]}:${at[1]}`, th: `${leaf[1]} ${at[1]}`, r: p.r});
  }
  (f.inferred || []).forEach(both);
  const commentary = (f.links || []).some(l => l.r === 'base') || (f.pending || []).some(p => p.r === 'base') || (f.inferred || []).length > 0;
  return {buckets, commentary};
}

async function appendOnDisk(m, added, titles) {
  const dir = INDEX_DIR();
  const commentaries = new Set(m.commentaries || []);
  const lineBooks = new Map();
  for (const t of added) {
    const f = await readJSON(linksFile(t));
    if (!f) { continue; }
    const {buckets, commentary} = await recordsOf(f, titles, lineBooks);
    if (commentary) { commentaries.add(f.title || t); }
    await flushBuckets(dir, buckets);
    await yieldToUI();
  }
  const manifest = {...m, key: titlesKey(titles), titles: [...titles], made: Date.now(), commentaries: [...commentaries]};
  await FileSystem.writeAsStringAsync(`${dir}manifest.json`, JSON.stringify(manifest));
  return manifest;
}

/**
 * Books deleted since the index was made: the records their links files made taken out of it
 * (removed: [{title, f}]; the other books' records stay, as a whole rebuild would make them).
 */
async function removeFromDisk(m, removed, titles) {
  const dir = INDEX_DIR();
  const gone = new Set(removed.map(r => r.f.title || r.title).concat(removed.map(r => r.title)));
  const lineBooks = new Map();
  const key = r => `${r.anchor}|${r.other}|${!!r.commentary}`;
  for (const {f} of removed) {
    const {buckets} = await recordsOf(f, titles, lineBooks);
    for (const [shard, sections] of buckets) {
      const path = shardFile(dir, shard);
      const have = await readJSON(path);
      if (!have) { continue; }
      for (const [section, recs] of Object.entries(sections)) {
        if (!have[section]) { continue; }
        const drop = new Set(recs.map(key));
        have[section] = have[section].filter(r => !drop.has(key(r)));
        if (!have[section].length) { delete have[section]; }
      }
      await FileSystem.writeAsStringAsync(path, JSON.stringify(have));
      await yieldToUI();
    }
  }
  return {...m, key: titlesKey(titles), titles: [...titles], made: Date.now(),
    commentaries: (m.commentaries || []).filter(t => !gone.has(t))};
}

/** The deleted books' links files kept aside for removeFromDisk: [{title, f, path}] */
async function removedFiles() {
  const dir = REMOVED_DIR();
  let names = [];
  try { names = await FileSystem.readDirectoryAsync(dir); } catch (e) { return []; }
  // (taken: renamed first, so a version set aside again while the index is updated keeps its own
  //  name and waits for the next time - its records are taken out then, and the newest added after)
  let n = 0;
  for (const name of names.filter(x => x.endsWith('.json') && !x.endsWith('.taking.json'))) {
    const to = `${dir}${name.replace(/\.json$/, '')}.${Date.now()}-${n++}.taking.json`;
    await FileSystem.moveAsync({from: `${dir}${name}`, to}).catch(() => {});
  }
  try { names = await FileSystem.readDirectoryAsync(dir); } catch (e) { return []; }
  const out = [];
  for (const name of names.filter(x => x.endsWith('.taking.json'))) {
    const f = await readJSON(`${dir}${name}`);
    if (f) { out.push({title: f.title, f, path: `${dir}${name}`}); } else {
      await FileSystem.deleteAsync(`${dir}${name}`, {idempotent: true}).catch(() => {});
    }
  }
  return out;
}

/** The index on the phone for these books: made (or made again) when it is not theirs */
export function readyOnDisk(titles) {
  if (disk.building) { return disk.building; }
  const key = titlesKey(titles);
  if (disk.manifest && disk.manifest.key === key && disk.checked === generation) { return Promise.resolve(disk.manifest); }
  const gen = generation;
  disk.building = (async () => {
    const m = await diskManifest();
    await markedTitles;
    // (the same books, and no link of them changed since: a change marks the index - invalidate)
    const changed = !!(await readJSON(`${DIR()}changed.json`));
    const added = (await readJSON(`${DIR()}added.json`)) || [];
    const removed = await removedFiles();
    const dropRemoved = async () => {
      for (const r of removed) { await FileSystem.deleteAsync(r.path, {idempotent: true}).catch(() => {}); }
    };
    if (m && m.key === key && !changed && !added.length && !removed.length) { disk.checked = gen; return m; }
    // (books downloaded, updated or deleted since: their records added to the index, or taken out)
    const had = new Set(m && m.titles ? m.titles : []);
    const removedTitles = new Set(removed.map(r => r.title));
    const onlyAdded = m && !changed && Array.isArray(m.titles)
      && titles.every(t => had.has(t) || added.includes(t))
      && m.titles.every(t => titles.includes(t) || removedTitles.has(t));
    if (onlyAdded) {
      // (deleted books, and the earlier version of a book updated since: their records out)
      const gone = removed.filter(r => had.has(r.title));
      const kept = gone.length ? await removeFromDisk(m, gone, titles) : m;
      const made = await appendOnDisk(kept, added.filter(t => titles.includes(t)), titles);
      await dropRemoved();
      lastIndexWork = 'incremental';
      disk.manifest = made;
      disk.commentaries = new Set(made.commentaries || []);
      disk.shards.clear();
      if (gen === generation) {
        disk.checked = gen;
        await FileSystem.deleteAsync(`${DIR()}added.json`, {idempotent: true}).catch(() => {});
      }
      return made;
    }
    const made = await buildOnDisk(titles);
    await dropRemoved();
    lastIndexWork = 'whole';
    disk.manifest = made;
    disk.commentaries = new Set(made.commentaries || []);
    disk.shards.clear();
    if (gen === generation) {
      disk.checked = gen;
      await FileSystem.deleteAsync(`${DIR()}changed.json`, {idempotent: true}).catch(() => {});
      await FileSystem.deleteAsync(`${DIR()}added.json`, {idempotent: true}).catch(() => {});
    }
    return made;
  })().finally(() => { disk.building = null; });
  return disk.building;
}

/** Whether the index on the phone is ready for a section's links to be read at once */
export const isDiskReady = () => !!disk.manifest && disk.checked === generation && !disk.building;

/** A section's records from the index on the phone (its book's file) - a Map, as relatedFromIndex takes */
export async function sectionIndex(titles, section) {
  await readyOnDisk(titles);
  const shard = shardOf(section);
  let recs = disk.shards.get(shard);
  if (!recs) {
    recs = (await readJSON(shardFile(INDEX_DIR(), shard))) || {};
    disk.shards.set(shard, recs);
    if (disk.shards.size > SHARDS_KEPT) { disk.shards.delete(disk.shards.keys().next().value); }
  } else {
    disk.shards.delete(shard);
    disk.shards.set(shard, recs);
  }
  return new Map([[section, recs[section] || []]]);
}


/** Read the link files of the downloaded books (titles) into the index, once until invalidated */
/** Whether the downloaded books' links are read already (ready() resolves at once) */
export const isReady = () => isDiskReady();

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
    let collectiveTitle;
    let heCollectiveTitle;
    if (category === 'Commentary') {
      const dict = typeof Sefaria !== 'undefined' && Sefaria.collectiveTitlesDict && Sefaria.collectiveTitlesDict[title];
      const idx = typeof Sefaria !== 'undefined' && Sefaria.index ? Sefaria.index(title) : null;
      const short = dict
        ? { collectiveTitle: dict.en || dict.collectiveTitle, heCollectiveTitle: dict.he || dict.heCollectiveTitle }
        : commentaryShortTitles(title, (idx && idx.heTitle) || String(l.otherHe || '').split(',')[0], idx && idx.enTitle, 'Commentary');
      if (short) {
        collectiveTitle = short.collectiveTitle;
        heCollectiveTitle = short.heCollectiveTitle;
      }
    }
    out.push({
      sourceRef: dafRef(l.other, title),
      sourceHeRef: l.otherHe || l.other,
      index_title: title,
      collectiveTitle,
      ...(heCollectiveTitle ? {heCollectiveTitle} : {}),
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
let lastIndexWork = null;
export const _lastIndexWork = () => lastIndexWork;
