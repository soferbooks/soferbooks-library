/**
 * Extra library sources (Otzaria now; Dicta and Wikisource later): books the phone downloads
 * from the source's own server, one at a time, and converts into the offline library's
 * layout ("rewraps" them, as Sofer's importers do). Nothing of theirs is hosted by SoferBooks.
 *
 * A source is a plain object (extras/otzaria.js is the model):
 *   id, converterVersion
 *   catalogUrl, parseCatalog(text) -> [entry]   entry: {source, id, hash, heTitle,
 *                                                categories, heCategories, license, ...}
 *   bookUrl(entry) -> url of the book's file
 *   (optional) fetchCatalog() -> [entry], fetchBook(entry, job) -> what toTree takes: for a source
 *     whose catalogue or book is more than one file (extras/dicta.js). job: the download's
 *     progress(done, total, unit) and Cancel (check(), onCancel(fn)) - see jobFor below
 *   toTree(text, entry) -> [Node, author]        extras/tree.js
 *   isRestricted(text, entry) -> bool            the book's own notice forbids it
 *   versionOf(entry, text) -> {versionTitle, versionSource, license, librarySource, ...}
 *   (optional) convert(entry, text) -> {files, firstSection, companions, tree}  in place of toTree
 *     and the conversion, for books that come ready made in the library's layout (extras/sofer.js;
 *     null: convert this one as usual - Wikisource's pages from the site, not its release)
 *   (optional) versionsOf(entry, text, tree) -> [{version, tree}]  more than one edition of the
 *     book, laid out alike, the one shown first (Dicta's with nikud, then the plain text)
 *   (optional) linksOf(entry, text) -> {otzariaPath, dictaPages}  where the book's connections
 *     come from (extras/links.js): downloaded with it
 * and, for a source whose book is not one file (extras/wikisource.js):
 *   loadCatalog(installedRecords) -> [entry]     in place of catalogUrl + parseCatalog
 *   fetchBook(entry) -> text                     in place of fetching bookUrl (any value toTree takes)
 *   installRecord(entry, text) -> {hash, ...}    kept with the downloaded book (its update check)
 *   companions(tree, entry, {files, sections}, text) -> [{entry, files, firstSection}]
 *                                                books made with it (the editors' notes), kept and
 *                                                deleted with it (state.installed[t].companionOf)
 *
 * What the phone keeps (library/_extras/):
 *   <source>.catalog.json   the source's catalogue (refreshed weekly and on "Check for updates")
 *   state.json              {installed: {title: {source, id, hash, converter, firstSection, at}},
 *                            blocked: {"source|id": reason}}
 *   AsyncStorage extraSources  {sourceId: true} - the sources the reader turned on in Settings
 * A downloaded book is library/<Title>.zip (the schema-7 files, extras/schema7.js) plus
 * library/<Title>_search.txt (offline search lines, localSearch.js's format), exactly what a
 * Sefaria book has, so the reader and offline search need nothing new.
 *
 * Sefaria's books are read online; these have no online reader, so a book that is not
 * downloaded opens a warning with a Download button (ReaderApp.extraBookAlert).
 */
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {InteractionManager} from 'react-native';
import {zip} from 'react-native-zip-archive';
import md5 from 'md5';
import otzaria from './otzaria';
import dicta from './dicta';
import wikisource, {withCurrentShelf} from './wikisource';
import chok from './chok';
import soferLibrary from './sofer';
import pninim from './pninim';
import {READY_MADE} from '../sources';
import {bookFiles, setEnglishNameLookup} from './schema7';
import * as links from './links';
import {inferBase} from './inferred';
import {chooseBooks, addToToc, categoryNames, replacementForRef, redirectNameResults as redirectNames} from './catalog';
import {bookLines} from '../localSearch';
import {clearOfflineSearchCache} from '../offlineSearch';
import * as shomer from '../shomer';
import {WORK_DIR, ensureRoom, replaceFile, MB, safeUnzip} from '../storage';
import {loadOfflineSearch} from '../searchPrefs';

// (chok: Chok LeYisrael, one book from Otzaria's library, turned on by its learning schedule - no
//  switch in Settings: extras/chok.js)
export const EXTRA_SOURCES = {[otzaria.id]: otzaria, [dicta.id]: dicta, [wikisource.id]: wikisource, [chok.id]: chok, [soferLibrary.id]: soferLibrary, [pninim.id]: pninim};
export const ENABLED_KEY = 'extraSources';
export const CATALOG_MAX_AGE = 7 * 24 * 3600 * 1000;   // a week, as Sefaria's own update check
const LIBRARY_DIR = `${FileSystem.documentDirectory}library/`;
const EXTRAS_DIR = `${LIBRARY_DIR}_extras/`;
const STATE_FILE = `${EXTRAS_DIR}state.json`;
// (work files in the documents folder, not the cache folder: Android empties that when space
//  runs low, under a download still using it - storage.js)
const TMP_DIR = `${WORK_DIR}extras/`;
const catalogFile = id => `${EXTRAS_DIR}${id}.catalog.json`;

let enabled = {};          // {sourceId: true}
let catalogs = {};         // {sourceId: {fetchedAt, entries}}
let state = {installed: {}, blocked: {}};
let books = {};            // {title: entry}: the extra books in the library now
let replaced = {};         // {Sefaria's title: title}: Sefaria's books a preferred book is used instead of
let superseded = {};       // {downloaded title: title}: another source's copies a preferred book is used instead of
let loaded = null;
const listeners = new Set();

export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.log(e); } });

// ---------------------------------------------------------------- what the library has

export const isExtraTitle = title => !!title && title in books;
export const extraBook = title => books[title] || null;
export const isDownloaded = title => !!title && title in state.installed;
/** {downloadMB, storedMB} of a book whose source knows it (source.approxSize), else null */
export const approxSizeOf = title => {
  const book = books[title];
  const source = book && EXTRA_SOURCES[book.source];
  return (source && source.approxSize && source.approxSize(book)) || null;
};
export const needsDownload = title => isExtraTitle(title) && !isDownloaded(title);
/** A book made with another (Wikisource's editors' notes): it comes with its book */
export const isCompanion = title => !!(state.installed[title] && state.installed[title].companionOf);

/**
 * The book's English title, when it has a real one to show: the Sofer Library's books are named
 * in English (Sefaria's names, or their translators'); the other sources' "English" title is only
 * the Hebrew name made safe for a file name, or a transliteration, so null for those (and for a
 * Sofer book named only in Hebrew) - unless the source's list names it in English (Wikisource's
 * Rokeach on Shir HaShirim, used instead of Sefaria's "Rokeach on Song of Songs").
 */
export function englishTitleOf(title) {
  const b = books[title];
  if (!b) { return null; }
  const english = name => typeof name === 'string' && /[A-Za-z]/.test(name) && !/[֐-׿]/.test(name);
  // (the catalogue's English name, from Sofer's schema - else the title itself, when English)
  if (english(b.enTitle)) { return b.enTitle; }
  if (!READY_MADE.has(b.source)) { return null; }
  return english(title) ? title : null;
}

// (the reader's header and tabs show a keyed ref with the book's English name: extras/schema7.js)
setEnglishNameLookup(ref => {
  if (typeof Sefaria === 'undefined' || !Sefaria.textTitleForRef) { return null; }
  const title = Sefaria.textTitleForRef(ref);
  const en = englishTitleOf(title);
  return en ? {en, he: books[title].heTitle} : null;
});

/** The bytes a book's download is known to take (its zips: the Sofer Library's catalogue), else 0 */
export function knownDownloadBytes(title) {
  const b = books[title];
  if (!b) { return 0; }
  return [b, ...(b.companions || [])].reduce((n, e) => n + (e.size || 0), 0);
}
// a book is unpacked and zipped again on the phone: room for that, besides its download
const ROOM_FACTOR = 5;
const ROOM_UNKNOWN = 30 * MB;
const ROOM_MARGIN = 100 * MB;
export const isEnabled = id => !!enabled[id];
export const installedTitles = (source = null) => Object.keys(state.installed)
  .filter(t => !source || state.installed[t].source === source);
/** The books downloaded (not counting the books made with them: Wikisource's editors' notes) */
export const downloadedBooks = (source = null) => installedTitles(source).filter(t => !state.installed[t].companionOf);
export const firstSectionOf = title => (state.installed[title] || {}).firstSection || null;
export const getBooks = () => books;

/**
 * A preferred book is used instead of Sefaria's copy (catalog.chooseBooks: Wikisource's Rokeach on
 * Shir HaShirim, with its footnotes): Sefaria's is not in the toc, and its title - a link, a
 * sefaria.org address, a saved place - opens ours (offering to download it, as any extra book).
 */
export const replacementOf = title => (title && Object.prototype.hasOwnProperty.call(replaced, title) ? replaced[title] : null);
/** The preferred book a ref of a replaced book opens (at its start), else null */
export function redirectRef(ref) {
  if (!ref || !Object.keys(replaced).length) { return null; }
  let known = null;
  try { known = typeof Sefaria !== 'undefined' && Sefaria.textTitleForRef ? Sefaria.textTitleForRef(ref) : null; } catch (e) { known = null; }
  return replacementForRef(ref, replaced, known);
}
/** Sefaria's Name API answer (autocomplete) with the replaced books as ours */
export const redirectNameResults = results => redirectNames(results, replaced, books);

async function readJSON(path, fallback) {
  try { return JSON.parse(await FileSystem.readAsStringAsync(path)); } catch (e) { return fallback; }
}

async function writeJSON(path, data) {
  await FileSystem.makeDirectoryAsync(EXTRAS_DIR, {intermediates: true}).catch(() => {});
  await FileSystem.writeAsStringAsync(path, JSON.stringify(data));
}

const saveState = () => writeJSON(STATE_FILE, state);

/** Read the settings, catalogues and downloaded books (before the toc is built). */
export function loadExtras() {
  if (!loaded) {
    loaded = (async () => {
      try { enabled = JSON.parse(await AsyncStorage.getItem(ENABLED_KEY)) || {}; } catch (e) { enabled = {}; }
      const s = await readJSON(STATE_FILE, null);
      state = {installed: (s && s.installed) || {}, blocked: (s && s.blocked) || {}};
      catalogs = {};
      for (const id of Object.keys(EXTRA_SOURCES)) {
        const hasInstalled = Object.values(state.installed).some(r => r.source === id);
        if (enabled[id] || hasInstalled) { catalogs[id] = await readJSON(catalogFile(id), null); }
      }
      // (SoferBooks' own editions - extras/sofer.js APP_BOOKS - in a catalogue kept from before them)
      const sl = catalogs[soferLibrary.id];
      // (always this version's entries for them: a newer copy - its hash - is then offered as an update)
      if (sl && Array.isArray(sl.entries)) {
        const app = (soferLibrary.APP_BOOKS || []).map(b => ({...b}));
        const titles = new Set(app.map(b => b.title));
        catalogs[soferLibrary.id] = {...sl, entries: sl.entries.filter(e => !titles.has(e.title)).concat(app)};
      }
    })();
  }
  return loaded;
}

/**
 * Sefaria's toc with the extra books of the sources turned on (call before the content filter,
 * which then applies to these books too). Also tells hebrewCategory() their categories' names.
 */
export function applyToToc(toc) {
  const isCombined = e => !e || e.kind === 'combined' ||
    /\(Combined editions\)$/i.test(e.title || '') || /\(מהדורות משולבות\)$/.test(e.heTitle || '');
  const lists = {};
  for (const [id, cat] of Object.entries(catalogs)) {
    if (cat && Array.isArray(cat.entries)) {
      const current = (EXTRA_SOURCES[id] && EXTRA_SOURCES[id].currentEntry) || (e => e);
      const isOn = !!enabled[id];
      const installedIds = new Set(Object.values(state.installed).filter(r => r.source === id).map(r => r.id));
      lists[id] = cat.entries
        .map(withCurrentShelf)
        .map(current)
        .filter(e => !isCombined(e) && (isOn || installedIds.has(e.id) || (e.title && state.installed[e.title])));
    }
  }
  const chosen = chooseBooks(toc, lists, state);
  books = chosen.books;
  replaced = chosen.replaced;
  superseded = chosen.superseded || {};
  if (Object.keys(superseded).length) { setTimeout(() => { dropSuperseded(); }, 0); }
  for (const [title, rec] of Object.entries(state.installed)) {    // (books made with another: its notes)
    if (rec.companionOf && books[rec.companionOf] && rec.entry) { books[title] = {...withCurrentShelf(rec.entry), source: rec.source, title}; }
  }
  const first = {};
  for (const [title, rec] of Object.entries(state.installed)) { first[title] = rec.firstSection; }
  if (typeof Sefaria !== 'undefined' && Sefaria.hebrewCategories) {
    Object.assign(Sefaria.hebrewCategories, extraCategoryNames());
  }
  return addToToc(toc, books, first, replaced);
}

/** {English category: Hebrew} for the categories the extra books brought */
export const extraCategoryNames = () => categoryNames(books);

async function reloadToc() {
  try {
    if (typeof Sefaria !== 'undefined' && Sefaria._loadTOC) { await Sefaria._loadTOC(); }
  } catch (e) {
    console.log('extras: could not reload the toc', e);
  }
  notify();
}

// ---------------------------------------------------------------- sources on and off

export async function refreshCatalog(id) {
  const source = EXTRA_SOURCES[id];
  let entries;
  if (source.fetchCatalog) {           // (a source whose catalogue needs more than one file)
    entries = await source.fetchCatalog();
  } else if (source.loadCatalog) {
    entries = await source.loadCatalog(Object.values(state.installed).filter(r => r.source === id && !r.companionOf));
  } else {
    const response = await fetch(source.catalogUrl);
    if (!response.ok) { throw new Error(`${id} catalogue: HTTP ${response.status}`); }
    entries = source.parseCatalog(await response.text());
  }
  catalogs[id] = {fetchedAt: Date.now(), entries};
  await writeJSON(catalogFile(id), catalogs[id]);
  return entries;
}

/** Turn a source on (its catalogue is downloaded) or off (stop active downloads, keep or delete books). */
export async function setSourceEnabled(id, on, { keepBooks = false } = {}) {
  await loadExtras();
  if (on) {
    if (!catalogs[id]) { await refreshCatalog(id); }
    enabled = {...enabled, [id]: true};
  } else {
    try {
      const eq = require('../extrasQueue');
      if (eq && eq.removeSources) { await eq.removeSources([id]); }
    } catch (e) { /* queue not loaded */ }
    await cancelSourceDownloads(id);
    if (!keepBooks) {
      for (const title of installedTitles(id)) { await removeFiles(title); delete state.installed[title]; }
      await saveState();
      forgetCaches();
    }
    const {[id]: _, ...rest} = enabled;
    enabled = rest;
  }
  await AsyncStorage.setItem(ENABLED_KEY, JSON.stringify(enabled));
  await reloadToc();
  if (on) {
    try {
      const eq = require('../extrasQueue');
      if (eq && eq.restoreSource) { await eq.restoreSource(id); }
    } catch (e) { /* queue not loaded */ }
  }
}

/** Weekly: the catalogues of the sources turned on (new books, and which books changed). */
export async function refreshStaleCatalogs(now = Date.now()) {
  await loadExtras();
  let changed = false;
  for (const id of Object.keys(enabled)) {
    if (!EXTRA_SOURCES[id]) { continue; }
    const c = catalogs[id];
    if (!c || !c.fetchedAt || now - c.fetchedAt > CATALOG_MAX_AGE) {
      try { await refreshCatalog(id); changed = true; } catch (e) { console.log('extras: catalogue', e); }
    }
  }
  if (changed) { await reloadToc(); }
  return changed;
}

// ---------------------------------------------------------------- one book

/** The downloaded books whose source changed (or whose converter is newer) */
export function booksToUpdate(source = null) {
  return installedTitles(source).filter(title => {
    const rec = state.installed[title];
    const entry = books[title];
    const src = EXTRA_SOURCES[rec.source];
    if (!entry || !src || rec.companionOf) { return false; }
    // (a zip of an earlier release with the same text - only its sections' metadata differs - is
    //  not downloaded again: the Sofer Library's sameTextAs)
    const sameText = Array.isArray(entry.sameTextAs) && entry.sameTextAs.includes(rec.hash);
    return (entry.hash && entry.hash !== rec.hash && !sameText) || rec.converter !== src.converterVersion;
  });
}

/** "Check for updates" for one source: a fresh catalogue, then the books that changed. */
export async function checkUpdates(id) {
  await refreshCatalog(id);
  await reloadToc();
  return booksToUpdate(id);
}

async function removeFiles(title, {keepZip = false} = {}) {
  await links.removeLinks(title);
  for (const path of [keepZip ? null : `${LIBRARY_DIR}${title}.zip`, `${LIBRARY_DIR}${title}_search.txt`,
    `${FileSystem.documentDirectory}${title}_index.json`].filter(Boolean)) {
    await FileSystem.deleteAsync(path, {idempotent: true}).catch(() => {});
  }
  // the book's sections unpacked from its zip when it was read (offline.js reads those first): a
  // deleted book stayed readable until the app was restarted, an updated one showed its old text
  let names = [];
  try { names = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory); } catch (e) { names = []; }
  const unpacked = names.filter(n => isUnpackedFileOf(n, title));
  const DELETE_BATCH = 128;
  for (let i = 0; i < unpacked.length; i += DELETE_BATCH) {
    await Promise.all(unpacked.slice(i, i + DELETE_BATCH).map(name =>
      FileSystem.deleteAsync(`${FileSystem.documentDirectory}${name}`, {idempotent: true}).catch(() => {})));
  }
}

/** A file offline.js unpacked from `title`'s zip: "<title>, S1.metadata.json", "<title>, S1.<hash>.he.json" */
export const isUnpackedFileOf = (name, title) => typeof name === 'string' && !!title && name.endsWith('.json')
  && (name.startsWith(`${title}, `) || name.startsWith(`${title}.`));

function forgetCaches() {
  if (typeof Sefaria !== 'undefined') {
    Sefaria._jsonSectionData = {};
    Sefaria._jsonData = {};
    Sefaria._commentatorListBySection = {};
  }
  clearOfflineSearchCache();
}

/** The book's files, converted from the source's text (pure apart from the source). */
export function convertBook(entry, text) {
  const source = EXTRA_SOURCES[entry.source];
  // (books that come ready made: extras/sofer.js; Wikisource's from its release - null for its
  //  pages from the site, converted below)
  const ready = source.convert ? source.convert(entry, text) : null;
  if (ready) { return ready; }
  const [tree, author] = source.toTree(text, entry);
  const {files, firstSection, sections} = bookFiles(tree, {
    title: entry.title,
    heTitle: entry.heTitle,
    categories: entry.categories,
    heCategories: entry.heCategories,
    authors: author ? [{he: author, en: ''}] : null,
    // (a source with more than one edition of the book - Dicta's with nikud - gives them all)
    ...(source.versionsOf ? {versions: source.versionsOf(entry, text, tree)} : {version: source.versionOf(entry, text)}),
  });
  const companions = source.companions ? source.companions(tree, entry, {files, sections}, text) : [];
  return {files, firstSection, companions, tree};
}

/**
 * A converted book's files as library/<title>.zip and its offline search lines. The zip is made
 * beside the library and put in place only once complete (storage.replaceFile): a book that was
 * there stays readable until then, and stays as it was if this fails (QA round 14: a disk that
 * filled up mid-way left books half written).
 */
const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));

async function writeBook(title, files, job = null) {
  const dir = `${TMP_DIR}${md5(title)}/`;
  const newZip = `${TMP_DIR}${md5(title)}.zip`;
  const zipPath = `${LIBRARY_DIR}${title}.zip`;
  const entries = Object.entries(files);
  const showSteps = !!(job && entries.length > 50);
  await FileSystem.deleteAsync(dir, {idempotent: true}).catch(() => {});
  await FileSystem.deleteAsync(newZip, {idempotent: true}).catch(() => {});   // (zip adds to a file that is there)
  try {
    if (job) { job.check(); }
    await FileSystem.makeDirectoryAsync(dir, {intermediates: true});
    const BATCH = 128;
    for (let i = 0; i < entries.length; i += BATCH) {
      if (job) { job.check(); }
      const batch = entries.slice(i, i + BATCH);
      await Promise.all(batch.map(([name, data]) => {
        if (job) { job.check(); }
        return FileSystem.writeAsStringAsync(`${dir}${name}`, JSON.stringify(data));
      }));
      if (showSteps) {
        job.progress(20 + Math.round((60 * Math.min(entries.length, i + BATCH)) / entries.length), 100, 'percent');
      }
      await yieldFrame();
    }
    if (job) { job.check(); }
    if (showSteps) { job.progress(85, 100, 'percent'); }
    await FileSystem.makeDirectoryAsync(LIBRARY_DIR, {intermediates: true}).catch(() => {});
    await zip(dir, newZip);
    if (job) { job.check(); }
    const made = await FileSystem.getInfoAsync(newZip).catch(() => null);
    if (!made || !made.exists || !made.size) { throw new Error(`extras: the zip of ${title} was not made`); }
    await removeFiles(title, {keepZip: true});   // (what was unpacked from the old copy, its search lines)
    if (job) { job.check(); }
    await replaceFile(newZip, zipPath);
  } finally {
    await FileSystem.deleteAsync(dir, {idempotent: true}).catch(() => {});
    await FileSystem.deleteAsync(newZip, {idempotent: true}).catch(() => {});
  }
  if (job) { job.check(); }
  if (showSteps) { job.progress(92, 100, 'percent'); }
  // (offline search off - searchPrefs.js: the book is read, not searched, on the phone)
  const lines = (await loadOfflineSearch()) ? await searchLines(files, job) : [];
  if (job) { job.check(); }
  if (lines.length) {
    await FileSystem.writeAsStringAsync(`${LIBRARY_DIR}${title}_search.txt`, `${lines.join('\n')}\n`);
  }
}

/**
 * Offline search turned on (searchPrefs.js): the search lines of the downloaded books that have
 * none, made again from their zips on the phone, one book at a time. Returns how many were made.
 */
let makingSearch = null;
export function makeMissingSearchFiles({isCancelled = () => false} = {}) {
  if (!makingSearch) {
    makingSearch = (async () => {
      await loadExtras();
      let made = 0;
      for (const title of downloadedBooks()) {
        if (isCancelled() || !(await loadOfflineSearch())) { break; }
        const out = `${LIBRARY_DIR}${title}_search.txt`;
        if ((await FileSystem.getInfoAsync(out).catch(() => ({}))).exists) { continue; }
        const dir = `${TMP_DIR}search-${md5(title)}/`;
        try {
          await FileSystem.makeDirectoryAsync(dir, {intermediates: true}).catch(() => {});
          await safeUnzip(`${LIBRARY_DIR}${title}.zip`, dir);
          const files = {};
          for (const name of (await FileSystem.readDirectoryAsync(dir)).filter(n => n.endsWith('.json'))) {
            files[name] = JSON.parse(await FileSystem.readAsStringAsync(`${dir}${name}`));
          }
          const lines = await searchLines(files);
          if (lines.length) { await FileSystem.writeAsStringAsync(out, `${lines.join('\n')}\n`); made += 1; }
        } catch (e) {
          console.log('extras: search lines of', title, e);
        } finally {
          await FileSystem.deleteAsync(dir, {idempotent: true}).catch(() => {});
        }
        await yieldFrame();
      }
      return made;
    })().finally(() => { makingSearch = null; });
  }
  return makingSearch;
}

/**
 * SoferBooks' own editions (extras/sofer.js APP_BOOKS: the Sephardi siddur with shva na) come with
 * any download of Sefaria's books (owner, 2026-11-20): the Sofer Library turned on and each one
 * downloaded, in the background. Never throws.
 */
export async function downloadAppEditions() {
  try {
    await loadExtras();
    if (!isEnabled(soferLibrary.id)) { await setSourceEnabled(soferLibrary.id, true); }
    for (const b of soferLibrary.APP_BOOKS || []) {
      if (isExtraTitle(b.title) && needsDownload(b.title)) { await downloadBook(b.title).catch(e => console.log('extras: our edition', b.title, e)); }
    }
  } catch (e) {
    console.log('extras: our editions', e);
  }
}

/**
 * Once, at the first start with this version: the Sofer Library turned on (its books listed, each
 * downloaded when opened), so SoferBooks' Sephardi siddur is the one the library shows in place of
 * Sefaria's (owner, 2026-11-20). A reader who turns it off later keeps it off.
 */
export const DEFAULTS_KEY = 'extrasDefaults.v1';
export async function applyDefaultSources() {
  try {
    if (await AsyncStorage.getItem(DEFAULTS_KEY)) { return false; }
    await loadExtras();
    if (!isEnabled(soferLibrary.id)) { await setSourceEnabled(soferLibrary.id, true); }
    await AsyncStorage.setItem(DEFAULTS_KEY, '1');
    return true;
  } catch (e) {
    return false;   // (no network: tried again next start)
  }
}

/** The books made with `title` (its editors' notes) */
const companionsOf = title => Object.keys(state.installed).filter(t => state.installed[t].companionOf === title);

/** The offline search lines of a converted book (localSearch.js's format) */
export async function searchLines(files, job = null) {
  // (no _index.json given: bookLines then treats every version as not hosted, so all are indexed)
  const names = Object.keys(files).filter(n => !n.endsWith('_index.json'));
  let count = 0;
  return bookLines(names, async name => {
    if (job) { job.check(); }
    count += 1;
    if (count % 200 === 0) { await yieldFrame(); }
    return files[name];
  });
}

export class RestrictedBookError extends Error {}
export class DownloadCancelledError extends Error {}

// ---------------------------------------------------------------- downloads under way
// {title: {done, total, unit, cancelled, hooks, promise}}: what the reader is shown (pages done of
// all, or a share of the bytes) and the Cancel. unit: 'pages' (Wikisource's pages), 'percent'
// (a file whose size is known: Dicta's zips), null (not known: a spinner).
const downloads = {};
const PROGRESS_EVERY = 650;          // ms between two progress notices
let lastNotice = 0;

/** {done, total, unit} of a book being downloaded now (total 0: not known yet), else null */
export function downloadProgress(title) {
  const d = downloads[title];
  return d && !d.cancelled ? {done: d.done, total: d.total, unit: d.unit} : null;
}
export const downloadsUnderWay = () => Object.keys(downloads);

/** Cancel a download under way: it stops at its next step and leaves nothing behind */
export function cancelDownload(title) {
  const d = downloads[title];
  if (!d || d.cancelled) { return; }
  d.cancelled = true;
  d.hooks.forEach(fn => { try { fn(); } catch (e) { console.log('extras: cancel', e); } });
  notify();
}

/** Cancel every download under way belonging to `sourceId` and wait for them to finish cleaning up. */
export async function cancelSourceDownloads(sourceId) {
  const waiting = [];
  for (const [title, d] of Object.entries(downloads)) {
    const src = d.sourceId || (books[title] && books[title].source);
    if (src === sourceId) {
      cancelDownload(title);
      if (d.promise) { waiting.push(d.promise.catch(() => {})); }
    }
  }
  if (waiting.length) { await Promise.all(waiting); }
}

/**
 * What a source's fetchBook is given: job.progress(done, total, unit) as it goes; job.check()
 * (throws once cancelled) between steps; job.onCancel(fn) to stop a transfer at once.
 */
function jobFor(title) {
  const d = downloads[title];
  return {
    progress(done, total, unit = 'pages') {
      Object.assign(d, {done, total, unit});
      const now = Date.now();
      if (now - lastNotice >= PROGRESS_EVERY || (total && done >= total)) { lastNotice = now; notify(); }
    },
    get cancelled() { return d.cancelled; },
    check() { if (d.cancelled) { throw new DownloadCancelledError(title); } },
    onCancel(fn) { d.hooks.push(fn); },
  };
}

/**
 * Download one book from its source, convert it and put it in the library.
 * Returns its first section's ref. Throws RestrictedBookError when the book's own notice
 * forbids it (it is then left out of the library), DownloadCancelledError when cancelled
 * (cancelDownload). While it runs, downloadProgress(title) tells how far it is.
 */
export function downloadBook(title) {
  const under = downloads[title];
  if (under && !under.cancelled) { return under.promise; }      // (already under way)
  if (under) {
    // (a download being cancelled - the full library's queue paused on this book: QA round 14 -
    //  is not the reader's: a new one starts once it has stopped)
    return under.promise.catch(() => {}).then(() => downloadBook(title));
  }
  downloads[title] = {done: 0, total: 0, unit: null, cancelled: false, hooks: [], sourceId: books[title]?.source || null};
  const promise = fetchAndInstall(title, jobFor(title)).then(first => {
    delete downloads[title];
    notify();
    return first;
  }, e => {
    const cancelled = downloads[title] && downloads[title].cancelled;
    delete downloads[title];
    notify();
    throw cancelled && !(e instanceof RestrictedBookError) ? new DownloadCancelledError(title) : e;
  });
  downloads[title].promise = promise;
  notify();
  return promise;
}

/**
 * The book's entry in a catalogue fetched now, when it differs from the one on the phone (another
 * file, another checksum): a release rebuilt under the same name leaves the phone's catalogue - read
 * again only weekly - naming files the release no longer has, and the book could never be
 * downloaded (QA round 16: the Zelicha Megillat Antiochus, "Check the connection" every time).
 * null: the catalogue could not be had, or says the same.
 */
export async function freshEntryOf(title, entry) {
  const source = EXTRA_SOURCES[entry.source];
  if (!source || !source.catalogUrl) { return null; }      // (only a catalogue kept on a server)
  let entries;
  try { entries = await refreshCatalog(entry.source); } catch (e) { return null; }
  const now = (entries || []).find(e => e.title === title);
  if (!now || (now.file === entry.file && now.md5 === entry.md5 && now.hash === entry.hash)) { return null; }
  await reloadToc();                   // (the library's entry of the book, and its size, as the catalogue now has them)
  return books[title] || now;
}

async function fetchAndInstall(title, job) {
  await loadExtras();
  let entry = books[title];
  if (!entry) { throw new Error(`not an extra book: ${title}`); }
  const source = EXTRA_SOURCES[entry.source];
  // room for the download and the book made of it (storage.js: never fill the phone)
  const known = knownDownloadBytes(title);
  await ensureRoom(known ? known * ROOM_FACTOR : ROOM_UNKNOWN, ROOM_MARGIN);
  let text;
  if (source.fetchBook) {              // (a book that is more than one text file: Dicta's zip of pages)
    try {
      text = await source.fetchBook(entry, job);
    } catch (e) {
      if (job.cancelled || e instanceof DownloadCancelledError) { throw e; }
      // (the phone's catalogue may name a file of an earlier build of the release: once more with
      //  the catalogue as it is now)
      const fresh = await freshEntryOf(title, entry);
      if (!fresh) { throw e; }
      console.log('extras:', title, 'is downloaded again by the catalogue as it is now:', String((e && e.message) || e));
      entry = fresh;
      job.check();
      text = await source.fetchBook(entry, job);
    }
  } else {
    job.progress(2, 100, 'percent');
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (controller) { job.onCancel(() => controller.abort()); }
    const response = await fetch(source.bookUrl(entry), controller ? {signal: controller.signal} : undefined);
    if (!response.ok) { throw new Error(`${entry.source}: HTTP ${response.status} for ${title}`); }
    text = await response.text();
    job.check();
    job.progress(15, 100, 'percent');
    await yieldFrame();
    job.check();
  }
  const { firstSection } = await installConverted(title, entry, source, text, job);
  return firstSection;
}

/**
 * Validate, convert, write to disk, record in state.installed, collect links, and notify
 * for a single already-fetched book payload (text/doc). Shared by fetchAndInstall and bundle installers.
 */
async function installConverted(title, entry, source, text, job, { triggerInferred = true, skipReloadToc = false } = {}) {
  const activeJob = job || { cancelled: false, check() {}, progress() {}, onCancel() {} };
  activeJob.check();
  if (source.isRestricted(text, entry)) {
    state.blocked[`${entry.source}|${entry.id}`] = 'the book\'s own notice';
    await saveState();
    await reloadToc();
    throw new RestrictedBookError(title);
  }
  let converted = convertBook(entry, text);
  let {files, firstSection, companions, tree} = converted;
  converted = null;
  activeJob.check();                   // (the last moment to cancel before writing)
  try {
    await writeBook(title, files, activeJob);
    files = null;
    for (const c of companions || []) {
      activeJob.check();
      await writeBook(c.entry.title, c.files, activeJob);
      c.files = null;
    }
    activeJob.check();
  } catch (e) {
    if (activeJob.cancelled || e instanceof DownloadCancelledError) {
      await removeFiles(title).catch(() => {});
      for (const c of companions || []) { await removeFiles(c.entry.title).catch(() => {}); }
    }
    throw e;
  }
  const at = new Date().toISOString();
  state.installed[title] = {
    source: entry.source, id: entry.id, hash: entry.hash || null, converter: source.converterVersion,
    firstSection, at, ...(source.installRecord ? source.installRecord(entry, text) : {}),
  };
  for (const old of companionsOf(title)) { await removeFiles(old); delete state.installed[old]; }
  for (const c of companions || []) {
    state.installed[c.entry.title] = {
      source: entry.source, id: `${entry.id}#${c.entry.title}`, companionOf: title, entry: c.entry,
      converter: source.converterVersion, firstSection: c.firstSection, at,
    };
    books[c.entry.title] = {...c.entry, source: entry.source};
  }
  await saveState();
  await collectLinks(title, entry, source, text, tree, at, activeJob);
  tree = null;
  text = null;
  if (activeJob.cancelled) {
    for (const c of companions || []) { await removeFiles(c.entry.title).catch(() => {}); delete state.installed[c.entry.title]; }
    await removeFiles(title).catch(() => {});
    delete state.installed[title];
    await saveState();
    throw new DownloadCancelledError(title);
  }
  forgetCaches();
  if (triggerInferred) {
    let queueBusy = false;
    try {
      const eq = require('../extrasQueue');
      queueBusy = !!(eq.isQueueActive && eq.isQueueActive());
      if (queueBusy) { pendingInferred = true; ensureQueueInferredHook(eq); }
    } catch (e) { /* queue not loaded */ }
    if (!queueBusy) {
      refreshInferred(title);              // (in the background: it may read the texts it is on)
    }
  }
  const hadCompanions = !!(companions && companions.length);
  if (hadCompanions && !skipReloadToc) { await reloadToc(); }     // (the notes book joins the library)
  const index = typeof Sefaria !== 'undefined' && Sefaria.index && Sefaria.index(title);
  if (index) { index.firstSection = firstSection; }
  notify();
  return { firstSection, hadCompanions };
}

/**
 * The book's connections, from its source (extras/links.js): Otzaria's link file now; Dicta's
 * citations, a request a page, in the background (kept only if the same download is still there).
 */
async function collectLinks(title, entry, source, text, tree, at, job = null) {
  // (a source with no links of its own - Wikisource - still keeps what its sections say of their
  //  place: its obvious connections, extras/inferred.js)
  const stillThere = () => !(job && job.cancelled) && !!state.installed[title] && state.installed[title].at === at;
  // (a book that comes ready made - the Sofer Library's - has no tree to place connections on
  //  (QA round 14, "Cannot read property 'paras' of undefined"), but its files' own links are
  //  still kept: links.collect without a tree. Leaving them out kept Chashukei Chemed off the
  //  Gemara's panel - QA round 16)
  if (!tree) {
    try {
      const where = (source.linksOf && source.linksOf(entry, text)) || {};
      await links.collect({title, heTitle: entry.heTitle, tree: null, where});
    } catch (e) {
      console.log('extras: the links of', title, e);
    }
    return;
  }
  try {
    const where = (source.linksOf && source.linksOf(entry, text)) || {};
    const {later} = await links.collect({
      title, heTitle: entry.heTitle, tree, where,
      fetchCitations: where.dictaPages && source.fetchPageCitations
        ? () => source.fetchPageCitations(entry, {get cancelled() { return !stillThere(); }}) : null,
      stillWanted: () => stillThere(),
    });
    later.then(added => { if (added) { notify(); } });
  } catch (e) {
    console.log('extras: the links of', title, e);
  }
}

let pendingInferred = false;
let queueHooked = false;
function ensureQueueInferredHook(eq) {
  if (queueHooked || !eq || !eq.subscribe) { return; }
  queueHooked = true;
  eq.subscribe(() => {
    if (pendingInferred && (!eq.isQueueActive || !eq.isQueueActive())) {
      pendingInferred = false;
      refreshInferred(null);
    }
  });
}

/**
 * The obvious connections (extras/inferred.js) of the downloaded books, worked out again after
 * `changed` was downloaded (or a book deleted: null): the book's own, those of the books on it,
 * and of any book whose base is now another. One at a time; never throws.
 */
let inferring = Promise.resolve();
let wholeWaiting = null;
export function refreshInferred(changed = null) {
  // (a pass over every book that has not started yet covers this one too: books deleted one after
  //  another - extras.dropSuperseded, five on the 32-bit tablet, 2026-11-20 - queued five passes of
  //  minutes each, and the downloads waited behind them)
  if (wholeWaiting) { return wholeWaiting; }
  const run = () => {
    if (changed === null) { wholeWaiting = null; }
    return inferNow(changed);
  };
  inferring = inferring.then(run).catch(e => console.log('extras: inferred links', e));
  if (changed === null) { wholeWaiting = inferring; }
  return inferring;
}

async function inferNow(changed) {
  await loadExtras();
  // (after what the reader is doing - opening the book just downloaded - not in its way)
  //  (at most a few seconds: an interaction never ended must not hold it back for good)
  if (typeof jest === 'undefined' && InteractionManager && InteractionManager.runAfterInteractions) {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 3000);
      InteractionManager.runAfterInteractions(() => { clearTimeout(timer); resolve(); });
    });
  }
  const titles = installedTitles().filter(t => !state.installed[t].companionOf);
  // (only the books whose base may have changed are read - the book downloaded, those whose base
  //  is now another - and the downloaded books they are on: the books' summaries tell which.
  //  Reading every links file, 380 MB, took minutes on the 32-bit tablet - 2026-11-20)
  const books = inferenceBooks();
  const sums = await links.summariesFor(titles);
  const files = {};
  for (const t of titles) {
    const sm = sums[t];
    if (!sm || !sm.secs) { continue; }
    const found = inferBase(sm.heTitle, books, `extra:${t}`);
    const on = found.book ? found.book.key : null;
    if (t !== changed && (!changed || on !== `extra:${changed}`) && (sm.inferredOn || null) === on) { continue; }
    const f = await links.readLinks(t);
    if (!f) { continue; }
    files[t] = f;
    if (found.book && found.book.kind === 'extra' && !files[found.book.title]) {
      const g = await links.readLinks(found.book.title);
      if (g) { files[found.book.title] = g; }
    }
  }
  if (!Object.keys(files).length) { return; }
  const loadSection = async ref => {
    const {loadText} = require('../offlineOnline');      // (lazily, when a text is needed: it imports this module)
    const {result} = await loadText(ref, false, null, true, true);
    const he = result && result.he;
    // (read online, the text API joins a section's lines into one string: the inference needs them
    //  line by line - the Gemara's amud, Rashi's lines - so they are asked for as the API keeps
    //  them. Before, a masechta read online gave nothing, after reading it all - QA round 17)
    if (typeof he === 'string' && !isExtraTitle(Sefaria.textTitleForRef(ref)) && Sefaria.api && Sefaria.api._request) {
      try {
        const data = await Sefaria.api._request(ref, 'text', true, {context: 0, stripItags: 1}, true);
        if (data && (Array.isArray(data.he) || typeof data.he === 'string')) { return data.he; }
      } catch (e) { /* as it came */ }
    }
    return he;
  };
  // (a Sefaria book's index, for the Gemara's length and perakim: the downloaded one)
  // (the downloaded one, else Sefaria's: without it the masechta's length was not known, and it was
  //  read on past its end - QA round 17)
  const loadIndex = async title => {
    try {
      const offline = await require('../offline').loadTextIndexOffline(title);
      if (offline) { return offline; }
    } catch (e) { /* not downloaded */ }
    try { return await require('../offlineOnline').textToc(title); } catch (e) { return null; }
  };
  const done = await links.inferAll({files, books, changed, loadSection, loadIndex});
  for (const t of done) {
    if (state.installed[t]) { await links.saveLinks(t, files[t]); }
  }
  if (done.length) { forgetCaches(); notify(); }
}

/** The books a commentary may be on: Sefaria's (the toc the content filter leaves) and the downloaded extra books */
function inferenceBooks() {
  const out = [];
  const walk = items => {
    for (const x of items || []) {
      if (x.contents) { walk(x.contents); continue; }
      if (!x.title || shomer.isBookHidden(x.title)) { continue; }
      if (isExtraTitle(x.title)) {
        if (state.installed[x.title] && !state.installed[x.title].companionOf) {
          out.push({key: `extra:${x.title}`, kind: 'extra', title: x.title, heTitle: x.heTitle || books[x.title].heTitle});
        }
      } else {
        out.push({key: `sefaria:${x.title}`, kind: 'sefaria', title: x.title, heTitle: x.heTitle,
          commentary: x.dependence === 'Commentary', categories: x.categories || []});
      }
    }
  };
  walk(typeof Sefaria !== 'undefined' ? Sefaria.toc : []);
  return out;
}

const readyListeners = new Set();
/** fn() once the downloaded books' links are read (after a withExtraLinks that did not wait); returns an unsubscribe */
export const onExtraLinksReady = fn => { readyListeners.add(fn); return () => readyListeners.delete(fn); };

/** Sefaria's links API's response for a section, with the downloaded extra books' links of it */
export async function withExtraLinks(sectionRef, response, { wait = true } = {}) {
  // wait: false - the first time in a session, the downloaded books' links are read from all their
  // files (1,971 books took 87 s on a 32-bit tablet, 2026-11-20): Sefaria's own links are given at
  // once meanwhile, and the extra books' join them once read (onExtraLinksReady)
  if (!wait && !links.isReady()) {
    extraLinksFor(sectionRef).then(() => { for (const fn of readyListeners) { try { fn(); } catch (e) {} } });
    return response;
  }
  const extra = await extraLinksFor(sectionRef);
  return links.withExtraLinks(response, extra);
}

/**
 * The Sofer Library's books downloaded before their own links were kept (QA round 16: Chashukei
 * Chemed missing on the Gemara's side): their links file made once from the book's zip on the
 * phone (its sections' metadata), so they need not be downloaded again. Once a session; never throws.
 */
let repaired = null;
export function repairReadyMadeLinks(titles) {
  if (!repaired) {
    repaired = (async () => {
      for (const title of titles) {
        const entry = books[title];
        const rec = state.installed[title];
        if (!entry || !rec || !READY_MADE.has(rec.source)) { continue; }
        const existing = await links.readLinks(title);
        const needsCommRepair = entry.dependence === 'Commentary' && Array.isArray(entry.base_text_titles) &&
          entry.base_text_titles.length > 0 && (!existing || (!(existing.links || []).length && !(existing.inferred || []).length));
        if (existing && !needsCommRepair) { continue; }
        const dir = `${TMP_DIR}links-${md5(title)}/`;
        try {
          await FileSystem.makeDirectoryAsync(dir, {intermediates: true}).catch(() => {});
          await safeUnzip(`${LIBRARY_DIR}${title}.zip`, dir);
          const files = {};
          const wantJson = name => needsCommRepair ? (name.endsWith('.json') && !name.endsWith('_index.json')) : name.endsWith('.metadata.json');
          for (const name of (await FileSystem.readDirectoryAsync(dir)).filter(wantJson)) {
            files[name] = JSON.parse(await FileSystem.readAsStringAsync(`${dir}${name}`));
          }
          const where = soferLibrary.linksOf(entry, {book: {files}}) || {};
          await links.collect({title, heTitle: entry.heTitle, tree: null, where});
        } catch (e) {
          console.log('extras: the links of', title, 'could not be read from its zip', e);
        } finally {
          await FileSystem.deleteAsync(dir, {idempotent: true}).catch(() => {});
        }
      }
    })().catch(e => console.log('extras: links repair', e));
  }
  return repaired;
}

/** The downloaded extra books' links of a section (both ends: theirs and the passages they explain) */
export async function extraLinksFor(sectionRef) {
  try {
    await loadExtras();
    const titles = installedTitles().filter(t => !state.installed[t].companionOf);
    if (!titles.length) { return []; }
    await repairReadyMadeLinks(titles);
    // (the index kept on the phone: only this section's book is read - links.sectionIndex)
    return links.relatedFromIndex(await links.sectionIndex(titles, sectionRef), sectionRef);
  } catch (e) {
    console.log('extras: links of', sectionRef, e);
    return [];
  }
}

/**
 * Install pre-built shard bundles for a source when it provides a hosted manifest (e.g. Dicta),
 * dramatically faster than fetching/converting each book individually. Returns true if handled
 * (remaining unbundled books still fall back to per-book downloads).
 */
export async function installHostedBundle(sourceId, { isCancelled = () => false, onProgress = null } = {}) {
  await loadExtras();
  const source = EXTRA_SOURCES[sourceId];
  if (!source) { return false; }

  // Single-archive doc bundles (e.g. sofer_library's sofer-library-all.zip, wikisource's wikisource-all.zip)
  if (typeof source.fetchBundleDocs === 'function') {
    const neededEntries = Object.values(books).filter(e => e.source === sourceId && !isDownloaded(e.title));
    if (!neededEntries.length) { return true; }
    let installedAny = false;
    let anyCompanions = false;
    let handledCount = 0;
    const job = {
      get cancelled() { return isCancelled(); },
      check() { if (isCancelled()) { throw new DownloadCancelledError(sourceId); } },
      progress() {},
      onCancel() {},
    };
    const handled = await source.fetchBundleDocs(neededEntries, {
      isCancelled,
      onBook: async (entry, doc) => {
        if (isCancelled()) { return; }
        try {
          const res = await installConverted(entry.title, entry, source, doc, job, {
            triggerInferred: false,
            skipReloadToc: true,
          });
          installedAny = true;
          if (res.hadCompanions) { anyCompanions = true; }
        } catch (e) {
          if (!(e instanceof RestrictedBookError)) { throw e; }
        }
        handledCount += 1;
        if (onProgress && neededEntries.length > 0) {
          onProgress(handledCount / neededEntries.length);
        }
      },
    });
    if (installedAny) {
      if (anyCompanions) { await reloadToc(); }
      refreshInferred(null);
    }
    return !!handled;
  }

  if (typeof source.hostedManifest !== 'function' || !source.hostedBaseUrl) { return false; }
  const manifest = await source.hostedManifest();
  if (!manifest || !Array.isArray(manifest.shards) || !manifest.shards.length) { return false; }

  await FileSystem.makeDirectoryAsync(TMP_DIR, {intermediates: true}).catch(() => {});
  await FileSystem.makeDirectoryAsync(LIBRARY_DIR, {intermediates: true}).catch(() => {});
  await FileSystem.makeDirectoryAsync(`${EXTRAS_DIR}links`, {intermediates: true}).catch(() => {});

  const bundleBooks = manifest.books || {};
  let installedAny = false;
  for (const shard of manifest.shards) {
    if (isCancelled()) { break; }
    const needed = (shard.titles || []).filter(t => books[t] && books[t].source === sourceId && !isDownloaded(t));
    if (!needed.length) { continue; }
    await ensureRoom((shard.size || 0) * 2, ROOM_MARGIN);
    if (isCancelled()) { break; }

    const shardPath = `${TMP_DIR}${shard.file}`;
    const url = `${source.hostedBaseUrl}/${encodeURIComponent(shard.file)}`;
    await FileSystem.deleteAsync(shardPath, {idempotent: true}).catch(() => {});
    try {
      if (FileSystem.createDownloadResumable) {
        const transfer = FileSystem.createDownloadResumable(url, shardPath, {}, p => {
          if (onProgress && p.totalBytesExpectedToWrite > 0) {
            onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
          }
          if (isCancelled()) { transfer.cancelAsync().catch(() => {}); }
        });
        const res = await transfer.downloadAsync();
        if (!res || (res.status && (res.status < 200 || res.status >= 300))) { continue; }
      } else if (FileSystem.downloadAsync) {
        const res = await FileSystem.downloadAsync(url, shardPath);
        if (!res || (res.status && (res.status < 200 || res.status >= 300))) { continue; }
      } else {
        continue;
      }
      if (isCancelled()) { break; }
      await safeUnzip(shardPath, FileSystem.documentDirectory);
      const at = new Date().toISOString();
      for (const title of needed) {
        const entry = books[title];
        const meta = bundleBooks[title] || {};
        state.installed[title] = {
          source: sourceId,
          id: entry.id,
          hash: entry.hash || meta.hash || null,
          converter: source.converterVersion,
          firstSection: meta.firstSection || title,
          at,
        };
      }
      installedAny = true;
      await saveState();
      forgetCaches();
      notify();
    } catch (e) {
      if (e && e.name === 'LowSpaceError') { throw e; }
      console.log('extras: shard bundle failed for', sourceId, shard.file, e && e.message);
    } finally {
      await FileSystem.deleteAsync(shardPath, {idempotent: true}).catch(() => {});
    }
  }
  if (installedAny) {
    if (links && links._reset) { links._reset(); }
    refreshInferred(null);
  }
  return true;
}

/** Delete one downloaded book (it stays in the library, to be downloaded again). */
export async function deleteBook(title) {
  await loadExtras();
  const companions = companionsOf(title);
  const titles = [title, ...companions];
  for (const t of titles) { delete state.installed[t]; }
  companions.forEach(t => { delete books[t]; });
  await saveState();
  forgetCaches();
  const index = typeof Sefaria !== 'undefined' && Sefaria.index && Sefaria.index(title);
  if (index) { index.firstSection = title; }
  notify();
  for (const t of titles) { await removeFiles(t); }
  if (companions.length) { await reloadToc(); }   // (its notes book leaves the library with it)
  refreshInferred(null);               // (the books that were on it lose those connections)
}

/**
 * A downloaded book another source's better copy is now used instead of (a preferred book:
 * Pninim's own copies over Otzaria's of their text - the owner, 2026-11-20: "always use better
 * versions") is deleted once that copy is downloaded, so the phone does not keep both.
 */
let dropping = null;
export function dropSuperseded() {
  if (!dropping) {
    dropping = (async () => {
      for (const [old, by] of Object.entries(superseded)) {
        if (state.installed[old] && !state.installed[old].companionOf && isDownloaded(by)) {
          console.log('extras: deleting', old, '- used instead:', by);
          await deleteBook(old);
        }
      }
    })().catch(e => console.log('extras: superseded books', e)).finally(() => { dropping = null; });
  }
  return dropping;
}

// The content filter applies to these books too: a book it hides is not kept on the phone
shomer.subscribe(() => {
  const hidden = Object.keys(state.installed).filter(t => shomer.isBookHidden(t));
  if (hidden.length) {
    Promise.all(hidden.map(deleteBook)).catch(e => console.log('extras: content filter', e));
  }
});

// (tests)
export function _reset(next = {}) {
  enabled = next.enabled || {};
  catalogs = next.catalogs || {};
  state = {installed: {}, blocked: {}, ...(next.state || {})};
  books = next.books || {};
  replaced = next.replaced || {};
  Object.keys(downloads).forEach(t => { delete downloads[t]; });
  links._reset();
  repaired = null;
  loaded = next.loaded === false ? null : Promise.resolve();
}
