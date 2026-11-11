/**
 * Chok LeYisrael (חק לישראל) as an extra source: the whole sefer, from the Otzaria library's
 * copy (Orayta's edition: OraytaToOtzaria/ספרים/אוצריא/לימוד יומי/חק לישראל, five volumes,
 * one per chumash). Nothing of it is hosted by SoferBooks: the phone downloads the five files
 * from Otzaria's GitHub and converts them into one library book, laid out for daily learning:
 *
 *   הקדמות                     the introductions, and the prayers said before each part
 *     תפלות קודם הלימוד         (the six prayers, one after the other)
 *     הקדמת מהרח"ו, הקדמת החיד"א, מעשה רוקח
 *   פרשת בראשית ... פרשת וזאת הברכה
 *     יום ראשון ... יום חמישי, ליל שישי, יום שישי
 *       תורה (with Onkelos and Rashi), נביאים, כתובים (with Targum and Rashi), משנה (Bartenura),
 *       גמרא (Rashi), זוהר (with its translation), הלכה פסוקה, מוסר; on Friday the rest of the
 *       parsha and the haftarah
 *
 * Each part is a section, so the learning schedule (learningSchedules/chokDay.js) opens the
 * day's parts in order; it finds them by their Hebrew names, so it does not depend on the
 * section keys. This source has no switch in Settings: it is turned on by the Chok LeYisrael
 * learning schedule, and its one book is downloaded when the reader first opens it.
 *
 * Licence: Otzaria's Orayta collection (extras/otzaria.js COLLECTIONS: offered, licence
 * "unknown" - the texts themselves, Chok LeYisrael, Onkelos, Rashi, Bartenura and the Zohar,
 * are centuries old). Otzaria's credit line goes with it.
 */
import {Node, plain, splitLines} from './tree';
import {RAW_BASE, CATALOG_URL, HOME_URL, CREDIT_HE, CATEGORY_HE, COLLECTIONS, bookUrlForPath, isRestricted as otzariaRestricted} from './otzaria';

export const ID = 'chok';
export const TITLE = 'Chok LeYisrael';
export const HE_TITLE = 'חק לישראל';
// The converter's own version: a book converted by an older one is converted again (as an update)
export const CONVERTER_VERSION = 1;

const FOLDER = 'OraytaToOtzaria/ספרים/אוצריא/לימוד יומי/חק לישראל';
export const VOLUMES = ['בראשית', 'שמות', 'ויקרא', 'במדבר', 'דברים'].map(b => ({
  he: `חק לישראל - ${b}`,
  path: `${FOLDER}/חק לישראל - ${b}.txt`,
}));
const COLLECTION = COLLECTIONS.OraytaToOtzaria;

// Names of the parts the book is laid out in (learningSchedules/chokDay.js finds them by these)
export const INTRO_HE = 'הקדמות';
export const PRAYERS_HE = 'תפלות קודם הלימוד';

/** The catalogue: the one book. Its hash is the five files' (Otzaria's manifest), when it can be read. */
export function catalogEntry(hash = null) {
  return {
    source: ID,
    id: FOLDER,
    hash,
    title: TITLE,
    heTitle: HE_TITLE,
    categories: ['Reference', 'Otzaria', 'לימוד יומי'],
    heCategories: [CATEGORY_HE.Reference, CATEGORY_HE.Otzaria, 'לימוד יומי'],
    collection: COLLECTION.source,
    license: COLLECTION.license,
    via: 'otzaria',               // (the source named to the reader: its books come from Otzaria)
    // one copy of the sefer: this one, not also Otzaria's five volumes (extras/catalog.js)
    preferred: true,
    replaces: VOLUMES.map(v => v.he),
  };
}

/** The volumes' hashes in Otzaria's files_manifest.json, joined; null when one is missing */
export function hashFromManifest(manifest) {
  const m = typeof manifest === 'string' ? JSON.parse(manifest) : manifest;
  const hashes = VOLUMES.map(v => m && m[v.path] && m[v.path].hash);
  return hashes.every(Boolean) ? hashes.join(',') : null;
}

export async function fetchCatalog() {
  let hash = null;
  try {
    const r = await fetch(CATALOG_URL);
    if (r.ok) { hash = hashFromManifest(await r.text()); }
  } catch (e) {
    console.log('chok: Otzaria manifest', e);     // (the book is still offered; updates are checked later)
  }
  return [catalogEntry(hash)];
}

/** The five volumes' text, from Otzaria's server: {volumes: [text]} */
export async function fetchBook(entry, job) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  if (controller && job) { job.onCancel(() => controller.abort()); }
  const volumes = [];
  for (let i = 0; i < VOLUMES.length; i++) {
    if (job) { job.progress(Math.round((i / VOLUMES.length) * 100), 100, 'percent'); }
    const response = await fetch(bookUrlForPath(VOLUMES[i].path), controller ? {signal: controller.signal} : undefined);
    if (!response.ok) { throw new Error(`chok: HTTP ${response.status} for ${VOLUMES[i].he}`); }
    volumes.push(await response.text());
    if (job) { job.check(); }
  }
  if (job) { job.progress(100, 100, 'percent'); }
  return {volumes};
}

// ---------------------------------------------------------------- the text

/**
 * One line of Otzaria's markup as the reader's: the sizes and colours of Orayta's layout become
 * the reader's own (smaller text - Onkelos, Rashi, the notes - in <small>; a commentary's name,
 * shown on a coloured badge there, in bold), pictures are left out, and the parsha's open and
 * closed breaks (פפפ, ססס) are not shown.
 */
export function cleanLine(line) {
  const out = [];
  const stack = [];
  let small = 0;
  const openSmall = () => { small += 1; return small === 1 ? '<small>' : ''; };
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let last = 0;
  let m;
  const text = String(line || '');
  while ((m = re.exec(text))) {
    out.push(text.slice(last, m.index));
    last = re.lastIndex;
    const [, closing, rawTag, attrs] = m;
    const tag = rawTag.toLowerCase();
    if (closing) {
      const i = stack.map(s => s.tag).lastIndexOf(tag);
      if (i < 0) { continue; }
      while (stack.length > i) {
        const s = stack.pop();
        if (s.small) { small -= 1; }
        out.push(s.close);
      }
      continue;
    }
    if (tag === 'img' || tag === 'br' || tag === 'hr' || /\/\s*$/.test(attrs)) {
      if (tag === 'br') { out.push(' '); }
      continue;
    }
    if (tag === 'span') {
      const size = /font-size:\s*(\d+)%/.exec(attrs);
      if (/background-color/.test(attrs)) {
        out.push('<b>');
        stack.push({tag, close: '</b>'});
      } else if (size && Number(size[1]) < 95) {     // (the text itself is 97%-150%)
        const o = openSmall();
        out.push(o);
        stack.push({tag, close: o ? '</small>' : '', small: true});
      } else {
        stack.push({tag, close: ''});
      }
    } else if (tag === 'small') {
      const o = openSmall();
      out.push(o);
      stack.push({tag, close: o ? '</small>' : '', small: true});
    } else if (['b', 'strong', 'i', 'em', 'u', 'sup', 'sub'].includes(tag)) {
      out.push(`<${tag}>`);
      stack.push({tag, close: `</${tag}>`});
    } else {
      stack.push({tag, close: ''});         // big, font, a ...: their text only
    }
  }
  out.push(text.slice(last));
  while (stack.length) { out.push(stack.pop().close); }
  return out.join('')
    .replace(/:?\s*(?:פפפ|ססס):?/g, ':')
    .replace(/<(b|small|i|u)><\/\1>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const H = /^\s*<h([1-6])[^>]*>(.*?)<\/h\1>\s*$/i;

/** "וירא יום רביעי" -> "יום רביעי"; "לך לך ליל שישי" -> "ליל שישי" */
export const dayName = heading => {
  const m = /(?:^|\s)((?:יום|ליל) \S+)\s*$/.exec(heading);
  return m ? m[1] : heading;
};

/** The five volumes as one book: [tree, author] (see the layout at the top) */
export function chokTree(book) {
  const root = new Node('');
  let haveIntro = false;
  for (const text of (book && book.volumes) || []) {
    let top = null;          // the h2: the introductions or a parsha
    let isIntro = false;
    let day = null;
    let part = null;
    let prayers = null;
    for (const raw of splitLines(String(text || '').replace(/^﻿/, ''))) {
      const ln = raw.trim();
      if (!ln) { continue; }
      const h = H.exec(ln);
      if (h) {
        const level = parseInt(h[1], 10);
        const name = plain(h[2]).replace(/\s+/g, ' ');
        if (level === 1) { continue; }
        if (level === 2) {
          isIntro = name === INTRO_HE;
          // (every volume opens with the same introductions: the book has them once)
          top = isIntro && haveIntro ? null : root.addChild(name);
          if (isIntro) { haveIntro = true; }
          day = null; part = null; prayers = null;
          continue;
        }
        if (!top) { continue; }
        if (level === 3) {
          if (isIntro && /^תפלה/.test(name)) {
            prayers = prayers || top.addChild(PRAYERS_HE);
            prayers.addPara(`<b>${name}</b>`);
            part = prayers;
          } else if (isIntro) {
            part = top.addChild(name);
          } else {
            day = top.addChild(dayName(name));
            part = null;
          }
          continue;
        }
        part = (day || top).addChild(name);
        continue;
      }
      if (!top) { continue; }
      const para = cleanLine(ln);
      if (!plain(para)) { continue; }            // (a picture alone)
      (part || day || top).addPara(para);
    }
  }
  return [root, ''];
}

/** Whether a volume's own notice forbids it (as Otzaria's books are checked) */
export const isRestricted = book => ((book && book.volumes) || []).some(t => otzariaRestricted(t));

export function versionOf(entry) {
  return {
    versionTitle: `Otzaria (${COLLECTION.source})`,
    versionSource: `Otzaria library, from ${COLLECTION.source} (${HOME_URL})`,
    license: entry.license || COLLECTION.license,
    versionNotesInHebrew: CREDIT_HE,
    librarySource: ID,
  };
}

export default {
  id: ID,
  converterVersion: CONVERTER_VERSION,
  catalogUrl: CATALOG_URL,
  fetchCatalog,
  bookUrl: () => `${RAW_BASE}/${FOLDER}`,
  fetchBook,
  toTree: book => chokTree(book),
  isRestricted,
  versionOf,
};
