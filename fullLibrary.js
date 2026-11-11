// "Full library": the reader who downloads the whole library gets every library's books, not
// only Sefaria's (owner, 2026-11-11). Its parts - Sefaria's library and each extra source (Dicta,
// Otzaria, Wikisource, the Sofer Library) - are ticked in Settings (FullLibraryPanel.js) with
// what each costs: the download, and the space on the phone after the books are converted.
//
// The sizes: Sefaria's from its COMPLETE LIBRARY package (packages.json). The extra sources'
// catalogues list no sizes (the Sofer Library's does), so fullLibrarySizes.json has each book's
// download (from the files Sofer downloaded from the same servers) and each source's measured
// conversion ratio (tools/library-export/full_library_sizes.py / .js). A source whose catalogue
// is on the phone is counted from it: the books the library keeps (one copy of each sefer,
// Sefaria's first) and the content filter shows. Otherwise the table's totals (made the same
// way, with the default filter) are used.
//
// The extra sources' books then download one at a time in the background (extrasQueue.js).
import * as extras from './extras';
import * as shomer from './shomer';
import { SOURCES } from './sources';
import SIZES from './fullLibrarySizes.json';

export const FULL_LIBRARY = 'COMPLETE LIBRARY';
export const SEFARIA = 'sefaria';

/** The extra sources the full library brings */
export const fullLibrarySources = () => SOURCES.filter(s => s.extra && s.available).map(s => s.id);
/** Every part of the full library, Sefaria's first */
export const fullLibraryParts = () => [SEFARIA, ...fullLibrarySources()];

const average = map => {
  const all = Object.values(map || {});
  return all.length ? Math.round(all.reduce((x, y) => x + y, 0) / all.length) : 0;
};

/** A catalogue entry's download in kB (full_library_sizes.js has the same rule) */
export function sizeOfEntry(b, sizes = SIZES) {
  if (b.source === 'sofer_library') {
    return Math.round([b, ...(b.companions || [])].reduce((n, e) => n + (e.size || 0), 0) / 1024);
  }
  const map = sizes[b.source] || {};
  const key = b.source === 'otzaria' ? b.heTitle : b.id;
  return map[key] || average(map);
}

export const ratioOf = (id, sizes = SIZES) => (sizes.ratios || {})[id] || 1;

/**
 * A part's size: {books, downloadKB, phoneKB, measured}. sefariaBytes: the COMPLETE LIBRARY
 * package's size (its books are kept as the zips they come in).
 */
export function estimate(id, {sefariaBytes = 0, sizes = SIZES} = {}) {
  if (id === SEFARIA) {
    const kB = Math.round(sefariaBytes / 1024);
    return {books: null, downloadKB: kB, phoneKB: kB, measured: true};
  }
  const books = Object.values(extras.getBooks())
    .filter(b => b.source === id && !shomer.isBookHidden(b.title));
  if (extras.isEnabled(id) && books.length) {
    const downloadKB = books.reduce((n, b) => n + sizeOfEntry(b, sizes), 0);
    return {books: books.length, downloadKB, phoneKB: Math.round(downloadKB * ratioOf(id, sizes)), measured: true};
  }
  const t = (sizes.totals || {})[id] || {};
  return {books: t.books || null, downloadKB: t.downloadKB || 0, phoneKB: t.phoneKB || 0, measured: false};
}

/** The parts' sizes and their total ({parts: {id: estimate}, total: {downloadKB, phoneKB}}) */
export function estimateAll(ids, options = {}) {
  const parts = {};
  const total = {downloadKB: 0, phoneKB: 0};
  for (const id of ids) {
    parts[id] = estimate(id, options);
    total.downloadKB += parts[id].downloadKB;
    total.phoneKB += parts[id].phoneKB;
  }
  return {parts, total};
}

/** "350 MB", "1.2 GB" (1000s, as Sefaria's own package sizes) */
export function formatSize(kB) {
  const mb = (kB * 1024) / 1e6;
  if (mb >= 1000) { return `${(mb / 1000).toFixed(1)} GB`; }
  return `${Math.max(1, Math.round(mb))} MB`;
}

/** A part's name in the interface language */
export function partName(id, strings, isHebrew) {
  if (id === SEFARIA) { return strings.full_library.part_sefaria; }
  const s = SOURCES.find(x => x.id === id) || {};
  return (isHebrew ? s.heName : s.name) || id;
}

/** Turn on every extra source that is off (each catalogue fetched; one failing does not stop the others) */
export async function turnOnExtraSources(ids = fullLibrarySources()) {
  await extras.loadExtras();
  const turnedOn = [];
  for (const id of ids) {
    if (extras.isEnabled(id)) { continue; }
    try {
      await extras.setSourceEnabled(id, true);
      turnedOn.push(id);
    } catch (e) {
      console.log(`full library: could not turn on ${id}`, e);
    }
  }
  return turnedOn;
}

/**
 * A package was chosen for download. The whole library (COMPLETE LIBRARY) brings every extra
 * source's books too: they are turned on and downloaded in the background (extrasQueue.js).
 */
export async function onPackageChosen(packageName, queue = require('./extrasQueue')) {
  if (packageName !== FULL_LIBRARY) { return []; }
  await queue.start(fullLibrarySources());
  return fullLibrarySources();
}
