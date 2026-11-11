/**
 * Otzaria (github.com/Otzaria/otzaria-library) as an extra source.
 *
 * Where it comes from (Otzaria's own servers, nothing hosted by SoferBooks):
 *   catalogue  raw.githubusercontent.com/Otzaria/otzaria-library/main/files_manifest.json
 *              every file of the library's repository with its sha256; a book is
 *              "<Collection folder>/ספרים/אוצריא/<category>/.../<name>.txt"
 *   one book   raw.githubusercontent.com/Otzaria/otzaria-library/main/<that path>
 * (The library's GitHub release, otzaria_latest.zip, is the same files in one 1.2 GB zip;
 *  the repository serves each book on its own, so a reader downloads only the books opened.)
 *
 * A book's text is plain lines with heading markup: <h1> the title, then (often) the author on
 * a line of its own, then <h2>..<h6> headings over lines of text, a line a paragraph.
 * Converted as Sofer's importer converts it (importers._otzaria_tree, extras/tree.js).
 *
 * Licences are per collection (the folder). Sofer's table (importers.OTZARIA_LICENSES), brought
 * up to date with the library's README of 2026-11 (see COLLECTIONS): collections whose texts the
 * README says may not be taken (special permission, all rights reserved, personal use only) are
 * not offered. Each book's own notice is checked as Sofer does (tree.restricted), from the
 * bundled list made by tools/library-export/otzaria_rules.py and again on download.
 * Otzaria's copies of Dicta's books (DictaToOtzaria) belong to the Dicta source (one copy of
 * each sefer: Dicta's, laid out by Otzaria - credited to Dicta); bookUrlForPath lets it fetch them.
 */
import {Node, plain, splitLines, inlineSections, safe, restricted, permission} from './tree';
import RULES from './otzariaRules.json';

export const ID = 'otzaria';
export const REPO = 'Otzaria/otzaria-library';
export const BRANCH = 'main';
export const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
export const CATALOG_URL = `${RAW_BASE}/files_manifest.json`;
export const HOME_URL = `https://github.com/${REPO}`;
// The converter's own version: books converted by an older one are converted again (as an update)
// (2: the book's links are downloaded with it - books converted by 1 are updated to get them)
export const CONVERTER_VERSION = 2;

// Otzaria's credit line, as its README asks for every use of its content
export const CREDIT_HE = "התכנים שלפניכם נאספו, מוינו, סוננו ונערכו בעמל רב ובמסירות על ידי צוות פרויקט 'אוצריא' (otzaria.org).";

/**
 * Collection folder -> {source (Sofer's name for it, as in SourcesBooks.csv), license, offered}.
 * offered: false - not listed at all; 'permitted' - only books in RULES.permitted.
 * A folder not listed here (a collection added later) is not offered until it is reviewed.
 */
export const COLLECTIONS = {
  'Ben-YehudaToOtzaria': {source: 'Ben-Yehuda', license: 'Public Domain', offered: true},
  // Sofer: public domain (Sefaria lists On Your Way's texts so); README: "subject to the source's licence"
  'OnYourWayToOtzaria': {source: 'OnYourWay', license: 'Public Domain', offered: true},
  // README: CC BY-NC-SA 2.5 (Sofer had public domain); non-commercial use: a free app may
  'ToratEmetToOtzaria': {source: 'ToratEmet', license: 'CC-BY-NC-SA 2.5', offered: true},
  'wikisourceToOtzaria': {source: 'wikiSource', license: 'CC-BY-SA', offered: true},
  // README: GNU FDL 1.3, their corrected copies too
  'pninimToOtzaria': {source: 'Pninim', license: 'GFDL 1.3', offered: true},
  // README: CC BY-NC-SA 4.0, "the rights are theirs"
  'National-LibraryToOtzaria': {source: 'National-Library', license: 'CC-BY-NC-SA 4.0', offered: true},
  'OraytaToOtzaria': {source: 'Orayta', license: 'unknown', offered: true},
  'KSK': {source: 'KSK', license: 'unknown', offered: true},
  // README: free Torah libraries may copy (all of it, with credit to Yam HaChochma and a link)
  'yam-HaHachmaToOtzaria': {
    source: 'yam-HaHachma', offered: true,
    license: 'Yam HaChochma licence: free Torah libraries may copy, with credit (github.com/torahtyh/yam-HaHachma)',
  },
  // README 2026-11: "Personal Use License" for the texts too - only the books whose holder gave
  // permission (Rav Yosef Peretz's, Sofer's licenses.PERMISSIONS) are offered
  'MoreBooks': {source: 'MoreBooks', license: 'Personal Use License (Otzaria)', offered: 'permitted'},
  // README: special permission only, "do not take the texts without permission"
  'wikiJewishBooksToOtzaria': {source: 'wiki_jewish_books', license: 'special permission only', offered: false},
  'tashmaToOtzaria': {source: 'Tashma', license: 'All rights reserved (Tashma)', offered: false},
  'BeitAharonVeYisraelToOtzaria': {source: 'Beit-Aharon-VeYisrael', license: 'All rights reserved (Beit Aharon VeYisrael)', offered: false},
  // Otzaria's copies of Dicta's books: the Dicta source's (see above)
  'DictaToOtzaria': {source: 'Dicta', license: 'CC-BY-SA', offered: false},
};

// Otzaria's top folders -> Sefaria's top categories (importers.OTZARIA_CATEGORIES)
export const CATEGORIES = {
  'תלמוד בבלי': 'Talmud', 'תלמוד ירושלמי': 'Talmud', 'הלכה': 'Halakhah', 'שות': 'Responsa',
  'מדרש': 'Midrash', 'תנך': 'Tanakh', 'קבלה': 'Kabbalah', 'ספרות עזר': 'Reference', 'משנה': 'Mishnah',
  'ספרי מוסר': 'Musar', 'חסידות': 'Chasidut', 'מחשבת ישראל': 'Jewish Thought', 'סדר התפילה': 'Liturgy',
  'לימוד יומי': 'Reference', 'בית שני': 'Second Temple',
};
// Hebrew names of those (importers.CATEGORY_HE)
export const CATEGORY_HE = {
  Responsa: 'שו"ת', Talmud: 'תלמוד', Halakhah: 'הלכה', Reference: 'ספרות עזר', Chasidut: 'חסידות',
  Tanakh: 'תנ"ך', 'Jewish Thought': 'מחשבת ישראל', Midrash: 'מדרש', Kabbalah: 'קבלה', Mishnah: 'משנה',
  Musar: 'ספרי מוסר', Liturgy: 'סדר התפילה', 'Second Temple': 'בית שני', Otzaria: 'אוצריא', General: 'כללי',
};
const NOT_BOOKS = new Set(['אודות התוכנה']);   // the program's own files

const BOOK_PATH = /^([^/]+)\/(?:[^/]+\/)?ספרים\/אוצריא\/(.+)\.txt$/;

/** A file of the repository as a catalogue entry, or null (not a book, or not offered). */
export function entryForPath(path, hash, rules = RULES) {
  const m = BOOK_PATH.exec(path);
  if (!m) { return null; }
  const folder = m[1];
  const parts = m[2].split('/');
  const he = parts.pop();
  if (!parts.length || NOT_BOOKS.has(parts[0])) { return null; }
  const coll = COLLECTIONS[folder];
  if (!coll || !coll.offered) { return null; }
  const key = `${coll.source}|${he}`;
  const permitted = (rules.permitted || {})[key];
  if (coll.offered === 'permitted' && !permitted) { return null; }
  if ((rules.restricted || []).includes(key) && !permitted) { return null; }
  // the same sefer as a Sefaria book under one of its other Hebrew names (the phone's toc has
  // only each book's main name; extras/catalog.js compares those)
  if ((rules.in_sefaria || []).includes(key)) { return null; }
  const top = CATEGORIES[parts[0]] || 'Reference';
  const sub = parts.length > 1 ? safe(parts[1]) : 'General';
  return {
    source: ID,
    id: path,
    hash,
    heTitle: he,
    categories: [top, 'Otzaria', sub],
    heCategories: [CATEGORY_HE[top] || top, CATEGORY_HE.Otzaria, CATEGORY_HE[sub] || sub],
    collection: coll.source,
    license: permitted || coll.license,
  };
}

/** files_manifest.json -> the catalogue's entries */
export function parseCatalog(manifestText, rules = RULES) {
  const manifest = typeof manifestText === 'string' ? JSON.parse(manifestText) : manifestText;
  const out = [];
  for (const [path, info] of Object.entries(manifest || {})) {
    if (!path.endsWith('.txt')) { continue; }
    const e = entryForPath(path, info && info.hash, rules);
    if (e) {
      // (whether Otzaria has links for it: downloaded with it - extras/links.js)
      e.links = !!manifest[linksPathFor(path)];
      out.push(e);
    }
  }
  return out;
}

const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
export const bookUrlForPath = path => `${RAW_BASE}/${encodePath(path)}`;
export const bookUrl = entry => bookUrlForPath(entry.id);

/**
 * Otzaria's links of a book (its lines tied to the texts it explains, to its commentaries and to its
 * notes), in the same repository: "<collection>[/<sub>]/links/<name>_links.json" beside
 * "<collection>[/<sub>]/ספרים/אוצריא/.../<name>.txt". A JSON list of {line_index_1 (the book's
 * line, from 1), path_2 (the other book's file name), line_index_2, ref_2 (Sefaria's ref, when the
 * other book is Sefaria's), heRef_2, "Conection Type" (source / commentary / footnotes / reference)}.
 */
export function linksPathFor(path) {
  const m = /^(.*?)ספרים\/אוצריא\/(?:.+\/)?([^/]+)\.txt$/.exec(path || '');
  return m ? `${m[1]}links/${m[2]}_links.json` : null;
}
export const linksUrlForPath = path => {
  const p = linksPathFor(path);
  return p ? bookUrlForPath(p) : null;
};

// ---------------------------------------------------------------- the text

const H = /^\s*<h([1-6])[^>]*>(.*?)<\/h\1>\s*$/i;

/**
 * importers._otzaria_tree: [sections, author line].
 * The tree also gets lineParas ({line: paragraph}, as importers' root.para_lines): the line of the
 * file (from 1, as Otzaria's link files count them) of each paragraph, counted over all the
 * book's paragraphs in order; a heading's line goes with the paragraph under it. Not kept when the
 * paragraphs were cut at headings inside the text (no longer a line each).
 */
export function otzariaTree(text) {
  const root = new Node('');
  const stack = [];
  let author = '';
  let paras = 0;
  const lineParas = {};
  let headings = [];                            // heading lines waiting for their first paragraph
  // (Otzaria counts lines by '\n'; the pieces a line splits into besides are on the same line)
  String(text || '').replace(/^﻿/, '').split('\n').forEach((whole, i) => {
    const line = i + 1;
    for (const raw of splitLines(whole)) {
      const ln = raw.trim();
      if (!ln) { continue; }
      const m = H.exec(ln);
      if (m) {
        const level = parseInt(m[1], 10);
        if (level === 1) { continue; }
        const depth = level - 1;                // h2 = top-level section
        while (stack.length && stack[stack.length - 1][0] >= depth) { stack.pop(); }
        const parent = stack.length ? stack[stack.length - 1][1] : root;
        stack.push([depth, parent.addChild(plain(m[2]))]);
        headings.push(line);
        continue;
      }
      if (!author && !stack.length && !root.paras.length && ln.length < 60 && !ln.includes('<')) {
        author = ln;                            // the line under the title
        continue;
      }
      (stack.length ? stack[stack.length - 1][1] : root).addPara(ln);
      for (const h of headings.concat(line)) { if (!(h in lineParas)) { lineParas[h] = paras; } }
      headings = [];
      paras += 1;
    }
  });
  const tree = inlineSections(root);
  if (tree === root) {
    tree.lineParas = lineParas;
    tree.paraCount = paras;
  }
  return [tree, author];
}

/** Whether the book may not be offered: its own notice (unless its holder gave permission). */
export function isRestricted(text) {
  return restricted(text) && !permission(text);
}

/** What the converter needs besides the tree: the version's name, source and licence. */
export function versionOf(entry, text) {
  return {
    versionTitle: `Otzaria (${entry.collection})`,
    versionSource: `Otzaria library, from ${entry.collection} (${HOME_URL})`,
    license: permission(text) || entry.license,
    versionNotesInHebrew: CREDIT_HE,
    librarySource: ID,
  };
}

export default {
  id: ID,
  converterVersion: CONVERTER_VERSION,
  catalogUrl: CATALOG_URL,
  parseCatalog,
  bookUrl,
  toTree: text => otzariaTree(text),
  isRestricted,
  versionOf,
  // where the book's connections come from (extras/links.js): Otzaria's links of this file
  linksOf: entry => (entry.links === false ? {} : {otzariaPath: entry.id}),
};
