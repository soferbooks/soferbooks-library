/**
 * Dicta's library (library.dicta.org.il) as an extra source.
 *
 * Where it comes from (Dicta's own servers, nothing hosted by SoferBooks):
 *   catalogue  raw.githubusercontent.com/Dicta-Israel-Center-for-Text-Analysis/Dicta-Library-Download/main/books.json
 *              Dicta's official list (its library site links to it: "to reach the full texts");
 *              each book's textFileURL is a zip of its pages on files.dicta.org.il
 *   one book   files.dicta.org.il/library-1-0/<fileName>/<fileName>__text_files.zip  (one .txt a page)
 * Licence: CC BY-SA 4.0 - the repository's README and the library's About page link
 * creativecommons.org/licenses/by-sa/4.0 under "the full text of the books is offered for the
 * public's benefit at no cost". Credit: Dicta, the Israel Center for Text Analysis.
 *
 * Converted as Sofer's importer converts it (importers.import_dicta, _dicta_tree):
 *   - Otzaria's copy of a Dicta book (its DictaToOtzaria collection) is used instead of Dicta's
 *     own pages when it has text: the same text in paragraphs, with headings and bold opening
 *     words; still Dicta's book (its licence and credit), "laid out by the Otzaria library".
 *     It is fetched from Otzaria's repository (extras/otzaria.js bookUrlForPath).
 *   - else Dicta's pages: the running head atop each page dropped, punctuation the OCR moved to
 *     the next line put back, "סימן / פרק / ..." lines as headings, headings inside the text
 *     (tree.inlineSections);
 *   - where that has no sections, another Otzaria collection's copy that has them is used: one
 *     with a clear licence under its own source and licence (Eitz Hadar), one with no stated
 *     licence when at least 80% of Dicta's text is in it, under Dicta's licence (Tevunah).
 *     The collections and licences are the app's (extras/otzaria.js COLLECTIONS: Otzaria's
 *     README of 2026-11), so collections the app does not offer are never used.
 * Not included: Dicta's editions with nikud added by its computer program (nikudMetegFileURL,
 * the Nakdan's output) - left out for now (owner's decision, 2026-11-10).
 */
import * as FileSystem from 'expo-file-system/legacy';
import {unzip} from 'react-native-zip-archive';
import md5 from 'md5';
import {Node, normTitle, safe, splitLines, inlineSections, restricted, permission} from './tree';
import {otzariaTree, bookUrlForPath, COLLECTIONS, CATEGORY_HE, CREDIT_HE, HOME_URL as OTZARIA_HOME} from './otzaria';
import RULES from './otzariaRules.json';

export const ID = 'dicta';
export const CATALOG_URL = 'https://raw.githubusercontent.com/Dicta-Israel-Center-for-Text-Analysis/Dicta-Library-Download/main/books.json';
export const OTZARIA_MANIFEST_URL = 'https://raw.githubusercontent.com/Otzaria/otzaria-library/main/files_manifest.json';
export const HOME_URL = 'https://library.dicta.org.il';
export const CONVERTER_VERSION = 1;

// importers.DICTA_LICENSE / DICTA_SOURCE / OTZARIA_LAYOUT_NOTE / DICTA_IN_COPY
export const LICENSE = 'CC-BY-SA';
export const SOURCE = `Dicta, the Israel Center for Text Analysis (${HOME_URL})`;
export const OTZARIA_LAYOUT_NOTE = `; laid out by the Otzaria library (${OTZARIA_HOME})`;
export const IN_COPY = 0.8;
// CC BY-SA asks for credit and the licence: the version's Hebrew note
export const CREDIT_HE_DICTA = 'הטקסט מספריית דיקטה - המרכז הישראלי לניתוח טקסטים (library.dicta.org.il), ברישיון CC BY-SA 4.0.';

// importers.DICTA_CATEGORIES: Dicta's categories -> Sefaria's top categories
export const CATEGORIES = {
  'Responsa': 'Responsa', 'Talmud and Commentaries': 'Talmud', 'Halakha and Minhaggim': 'Halakhah',
  'Miscellaneous': 'Reference', 'Chassidut': 'Chasidut', 'Tanakh and Commentaries': 'Tanakh',
  'Derashot (Homilies)': 'Jewish Thought', 'Rambam': 'Halakhah', 'Rabbinic Literature': 'Midrash',
  'Kabbala': 'Kabbalah', 'Jewish Thought and Ethics': 'Jewish Thought', 'General Topics': 'Reference',
};
export const SHELF = 'Dicta Library';
export const SHELF_HE = 'ספריית דיקטה';

// ---------------------------------------------------------------- Python's whitespace
// Sofer's code is Python: str.strip(), str.split() and re's \s take these as whitespace
// (JavaScript's \s lacks \x1c-\x1f and \x85, and has ﻿, which Python's has not).
const WS = '\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const STRIP = new RegExp(`^[${WS}]+|[${WS}]+$`, 'g');
const SPLIT = new RegExp(`[${WS}]+`);
const pyStrip = s => s.replace(STRIP, '');
const pyWords = s => pyStrip(s).split(SPLIT).filter(Boolean).length;
const pyLen = s => [...s].length;

// ---------------------------------------------------------------- the catalogue

// "<collection folder>/[<sub>/]ספרים/אוצריא/<category>/.../<name>.txt" (as extras/otzaria.js)
const BOOK_PATH = /^([^/]+)\/(?:[^/]+\/)?ספרים\/אוצריא\/(.+)\.txt$/;

/**
 * Otzaria's copies that may stand for Dicta's books: {normalised name: {otzaria, copies}}.
 * otzaria: the copy in DictaToOtzaria (Dicta's book laid out by Otzaria); copies: the others,
 * from collections the app offers, each with its licence ('unknown': none stated).
 */
export function otzariaCopies(manifest, rules = RULES) {
  const out = {};
  for (const [path, info] of Object.entries(manifest || {})) {
    const m = BOOK_PATH.exec(path);
    if (!m) { continue; }
    const coll = COLLECTIONS[m[1]];
    if (!coll) { continue; }
    const he = m[2].split('/').pop();
    const name = normTitle(he);
    const slot = out[name] || (out[name] = {otzaria: null, copies: []});
    const hash = (info && info.hash) || null;
    if (coll.source === 'Dicta') {
      if (!slot.otzaria) { slot.otzaria = {path, hash}; }
      continue;
    }
    if (!coll.offered) { continue; }
    const key = `${coll.source}|${he}`;
    const permitted = (rules.permitted || {})[key];
    if (coll.offered === 'permitted' && !permitted) { continue; }
    if ((rules.restricted || []).includes(key) && !permitted) { continue; }
    slot.copies.push({collection: coll.source, path, hash, license: permitted || coll.license});
  }
  return out;
}

/** Dicta's books.json (and Otzaria's files_manifest.json, for its copies) -> the catalogue */
export function parseCatalog(booksText, manifestText = null, rules = RULES) {
  const books = typeof booksText === 'string' ? JSON.parse(booksText.replace(/^﻿/, '')) : booksText;
  const manifest = typeof manifestText === 'string' ? JSON.parse(manifestText) : manifestText;
  const copies = manifest ? otzariaCopies(manifest, rules) : {};
  const out = [];
  for (const b of books || []) {
    const he = pyStrip(String(b.displayName || ''));
    if (!he || !b.textFileURL || !b.fileName) { continue; }
    const en = pyStrip(String(b.displayNameEnglish || ''));
    const top = CATEGORIES[b.categoryEnglish || ''] || 'Reference';
    const sub = safe(b.subcategoryEnglish || 'General');
    const found = copies[normTitle(he)] || {otzaria: null, copies: []};
    out.push({
      source: ID,
      id: b.fileName,
      title: en || he,
      heTitle: he,
      categories: [top, SHELF, sub],
      heCategories: [CATEGORY_HE[top] || top, SHELF_HE, pyStrip(String(b.subcategory || '')) || sub],
      license: LICENSE,
      author: pyStrip(String(b.author || '')),
      authorEnglish: pyStrip(String(b.authorEnglish || '')),
      printLocation: b.printLocationEnglish || '',
      printYear: b.printYear || '',
      textUrl: b.textFileURL,
      otzaria: found.otzaria,
      copies: found.copies,
      // (a new file at Dicta, or a change in Otzaria's copies, is an update)
      hash: md5(JSON.stringify([b.textFileURL, found.otzaria, found.copies.map(c => [c.path, c.hash])])).slice(0, 16),
    });
  }
  return out;
}

/** Both lists from their servers (Otzaria's is optional: without it, Dicta's own pages) */
export async function fetchCatalog() {
  const response = await fetch(CATALOG_URL);
  if (!response.ok) { throw new Error(`dicta catalogue: HTTP ${response.status}`); }
  let manifest = null;
  try {
    const m = await fetch(OTZARIA_MANIFEST_URL);
    if (m.ok) { manifest = await m.text(); }
  } catch (e) {
    console.log('dicta: Otzaria\'s list of copies', e);
  }
  return parseCatalog(await response.text(), manifest);
}

export const bookUrl = entry => entry.textUrl;

// ---------------------------------------------------------------- Dicta's pages

// importers._HEADING, _LEADING_PUNCT
const HEADING = new RegExp('^(סימן|סי\'|פרק|שאלה|תשובה|הקדמה|הקדמת|פתיחה|פתח דבר|דרוש|דרש|מאמר|כלל|ענין|שער|'
  + `חלק|מערכת|אות|קונטרס|הלכות|מסכת|פרשת|דף|מפתח|הסכמה|הסכמות)([${WS}]|$)`);
const LEADING_PUNCT = new RegExp(`^[${WS}]*([.:!,;?])[${WS}]*`);
const NIKUD = /[֑-׉]/g;
const bare = s => s.replace(NIKUD, '');

/** importers._dicta_tree: Dicta's pages (one text file each, in order) as a book */
export function dictaTree(pages) {
  const linesByPage = pages.map(p => splitLines(String(p)).map(pyStrip));
  // a line that opens many pages is the running head printed at the top: not text
  const firsts = new Map();
  for (const lines of linesByPage) {
    const first = bare(lines.find(ln => ln) || '');
    firsts.set(first, (firsts.get(first) || 0) + 1);
  }
  const atLeast = Math.max(3, Math.floor(pages.length / 10));
  const heads = new Set([...firsts].filter(([ln, n]) => ln && n >= atLeast).map(([ln]) => ln));
  const root = new Node('');
  for (const all of linesByPage) {
    let lines = all.filter(ln => ln);
    if (lines.length && heads.has(bare(lines[0]))) { lines = lines.slice(1); }
    for (let ln of lines) {
      const m = LEADING_PUNCT.exec(ln);
      if (m) {                  // (punctuation the OCR moved to the start of the next line)
        const last = root.deepest();
        if (last.paras.length) { last.paras[last.paras.length - 1] += m[1]; }
        ln = ln.slice(m[0].length);
        if (!ln) { continue; }
      }
      const b = bare(ln);
      if (pyLen(b) <= 40 && pyWords(ln) <= 6 && HEADING.test(b)) {
        root.addChild(ln);
      } else {
        root.addPara(ln);
      }
    }
  }
  return inlineSections(root);
}

// ---------------------------------------------------------------- which text: Sofer's rule

const LETTERS = /[א-ת]/g;
const lettersOf = s => (String(s).replace(/<[^>]+>/g, '').match(LETTERS) || []).join('');

/** importers._share_in: how much of tree's text (~300 pieces of 30 letters) is in other's */
export function shareIn(tree, other) {
  const paras = n => [n.title, ...n.paras].map(lettersOf).concat(...n.children.map(paras));
  const mine = paras(tree).filter(t => t.length >= 30);
  const o = paras(other).join('');
  const step = Math.max(30, Math.floor(mine.reduce((a, t) => a + t.length, 0) / 300));
  const pieces = [];
  for (const t of mine) {
    for (let i = 0; i < t.length - 29; i += step) { pieces.push(t.slice(i, i + 30)); }
  }
  return pieces.length ? pieces.filter(p => o.includes(p)).length / pieces.length : 0;
}

const notRestricted = text => !(restricted(text) && !permission(text));

/** Otzaria's DictaToOtzaria copy, when it may be used: not restricted, with text */
function otzariaLayout(text) {
  if (text === null || text === undefined || !notRestricted(text)) { return null; }
  const [tree] = otzariaTree(text);
  return tree.paras.length || tree.children.length ? tree : null;
}

const dictaTreeOf = doc => doc.dictaTree || (doc.dictaTree = dictaTree(doc.pages || []));

/**
 * importers.import_dicta's choice. doc: {otzaria: Otzaria's DictaToOtzaria text or null,
 * pages: Dicta's pages, copies: [{collection, license, text}] the other collections' copies}.
 * Returns {tree, kind ("Dicta", "Dicta/Otzaria" or "Otzaria/<collection>"), license, versionSource,
 * librarySource}.
 */
export function choose(doc) {
  if (doc.choice) { return doc.choice; }
  let choice;
  const otz = otzariaLayout(doc.otzaria);
  if (otz) {
    choice = {tree: otz, kind: 'Dicta/Otzaria', license: LICENSE, versionSource: SOURCE + OTZARIA_LAYOUT_NOTE, librarySource: ID};
  } else {
    choice = {tree: dictaTreeOf(doc), kind: 'Dicta', license: LICENSE, versionSource: SOURCE, librarySource: ID};
    if (choice.tree.children.length < 2) {
      // (clearly licensed copies first)
      const found = (doc.copies || []).filter(c => c.text !== null && c.text !== undefined && notRestricted(c.text));
      const ordered = found.filter(c => c.license !== 'unknown').concat(found.filter(c => c.license === 'unknown'));
      for (const c of ordered) {
        const [other] = otzariaTree(c.text);
        if (other.children.length < 2) { continue; }
        if (c.license === 'unknown') {
          if (shareIn(choice.tree, other) < IN_COPY) { continue; }
          choice = {
            tree: other, kind: `Otzaria/${c.collection}`, license: LICENSE, librarySource: ID,
            versionSource: `${SOURCE}; laid out by the Otzaria library, from ${c.collection} (${OTZARIA_HOME})`,
          };
        } else {
          // (another collection's text, under its own licence: corrections go to Otzaria)
          choice = {
            tree: other, kind: `Otzaria/${c.collection}`, license: permission(c.text) || c.license, librarySource: 'otzaria',
            versionSource: `Otzaria library, from ${c.collection} (${OTZARIA_HOME})`,
          };
        }
        break;
      }
    }
  }
  doc.choice = choice;
  return choice;
}

/** The version's name, as Sofer's: "Dicta Library (<place>, <year>)", or Otzaria's collection */
export function versionTitle(entry, kind) {
  if (kind.startsWith('Otzaria/')) { return `Otzaria (${kind.slice('Otzaria/'.length)})`; }
  const parts = [entry.printLocation, entry.printYear].filter(x => x).map(String);
  return parts.length ? `Dicta Library (${parts.join(', ')})` : 'Dicta Library';
}

export function versionOf(entry, doc) {
  const c = choose(doc);
  const notes = c.librarySource === ID ? [CREDIT_HE_DICTA] : [];
  if (c.kind !== 'Dicta') { notes.push(CREDIT_HE); }
  return {
    versionTitle: versionTitle(entry, c.kind),
    versionSource: c.versionSource,
    license: c.license,
    versionNotesInHebrew: notes.join(' '),
    librarySource: c.librarySource,
  };
}

// ---------------------------------------------------------------- downloading

async function getText(url) {
  const response = await fetch(url);
  if (!response.ok) { throw new Error(`dicta: HTTP ${response.status} for ${url}`); }
  return response.text();
}

/** Dicta's zip of a book's pages, downloaded, unzipped and read in order (then deleted) */
export async function dictaPages(url) {
  const dir = `${FileSystem.cacheDirectory}extras/`;
  const base = `${dir}dicta-${md5(url)}`;
  const zipPath = `${base}.zip`;
  const pagesDir = `${base}/`;
  await FileSystem.makeDirectoryAsync(dir, {intermediates: true}).catch(() => {});
  try {
    const res = await FileSystem.downloadAsync(url, zipPath);
    if (res.status < 200 || res.status >= 300) { throw new Error(`dicta: HTTP ${res.status} for ${url}`); }
    await FileSystem.makeDirectoryAsync(pagesDir, {intermediates: true}).catch(() => {});
    await unzip(zipPath, pagesDir);
    const names = (await FileSystem.readDirectoryAsync(pagesDir)).filter(n => n.endsWith('.txt')).sort();
    const pages = [];
    for (const name of names) {
      pages.push((await FileSystem.readAsStringAsync(`${pagesDir}${name}`)).replace(/^﻿/, ''));
    }
    return pages;
  } finally {
    await FileSystem.deleteAsync(zipPath, {idempotent: true}).catch(() => {});
    await FileSystem.deleteAsync(pagesDir, {idempotent: true}).catch(() => {});
  }
}

/**
 * What the book is made from, fetched as needed: Otzaria's layout of it if usable (then nothing
 * of Dicta's is needed), else Dicta's pages, and the other copies only when those have no sections.
 */
export async function fetchBook(entry) {
  const doc = {otzaria: null, pages: null, copies: []};
  if (entry.otzaria) {
    doc.otzaria = await getText(bookUrlForPath(entry.otzaria.path));
    if (otzariaLayout(doc.otzaria)) { return doc; }
  }
  doc.pages = await dictaPages(entry.textUrl);
  if ((entry.copies || []).length && dictaTreeOf(doc).children.length < 2) {
    for (const c of entry.copies) {
      doc.copies.push({...c, text: await getText(bookUrlForPath(c.path))});
    }
  }
  return doc;
}

export default {
  id: ID,
  converterVersion: CONVERTER_VERSION,
  catalogUrl: CATALOG_URL,
  fetchCatalog,
  parseCatalog,
  bookUrl,
  fetchBook,
  toTree: (doc, entry) => [choose(doc).tree, (entry && entry.author) || ''],
  // (Dicta's own text has no notice; Otzaria's copies are checked when chosen)
  isRestricted: () => false,
  versionOf,
};
