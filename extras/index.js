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
 *   (optional) versionsOf(entry, text, tree) -> [{version, tree}]  more than one edition of the
 *     book, laid out alike, the one shown first (Dicta's with nikud, then the plain text)
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
import {zip} from 'react-native-zip-archive';
import md5 from 'md5';
import otzaria from './otzaria';
import dicta from './dicta';
import wikisource from './wikisource';
import {bookFiles} from './schema7';
import {chooseBooks, addToToc, categoryNames} from './catalog';
import {bookLines} from '../localSearch';
import {clearOfflineSearchCache} from '../offlineSearch';
import * as shomer from '../shomer';

export const EXTRA_SOURCES = {[otzaria.id]: otzaria, [dicta.id]: dicta, [wikisource.id]: wikisource};
export const ENABLED_KEY = 'extraSources';
export const CATALOG_MAX_AGE = 7 * 24 * 3600 * 1000;   // a week, as Sefaria's own update check
const LIBRARY_DIR = `${FileSystem.documentDirectory}library/`;
const EXTRAS_DIR = `${LIBRARY_DIR}_extras/`;
const STATE_FILE = `${EXTRAS_DIR}state.json`;
const TMP_DIR = `${FileSystem.cacheDirectory}extras/`;
const catalogFile = id => `${EXTRAS_DIR}${id}.catalog.json`;

let enabled = {};          // {sourceId: true}
let catalogs = {};         // {sourceId: {fetchedAt, entries}}
let state = {installed: {}, blocked: {}};
let books = {};            // {title: entry}: the extra books in the library now
let loaded = null;
const listeners = new Set();

export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.log(e); } });

// ---------------------------------------------------------------- what the library has

export const isExtraTitle = title => !!title && title in books;
export const extraBook = title => books[title] || null;
export const isDownloaded = title => !!title && title in state.installed;
export const needsDownload = title => isExtraTitle(title) && !isDownloaded(title);
export const isEnabled = id => !!enabled[id];
export const installedTitles = (source = null) => Object.keys(state.installed)
  .filter(t => !source || state.installed[t].source === source);
/** The books downloaded (not counting the books made with them: Wikisource's editors' notes) */
export const downloadedBooks = (source = null) => installedTitles(source).filter(t => !state.installed[t].companionOf);
export const firstSectionOf = title => (state.installed[title] || {}).firstSection || null;
export const getBooks = () => books;

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
        if (enabled[id]) { catalogs[id] = await readJSON(catalogFile(id), null); }
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
  const lists = {};
  for (const [id, cat] of Object.entries(catalogs)) {
    if (enabled[id] && cat && Array.isArray(cat.entries)) { lists[id] = cat.entries; }
  }
  books = chooseBooks(toc, lists, state).books;
  for (const [title, rec] of Object.entries(state.installed)) {    // (books made with another: its notes)
    if (rec.companionOf && books[rec.companionOf] && rec.entry) { books[title] = {...rec.entry, source: rec.source, title}; }
  }
  const first = {};
  for (const [title, rec] of Object.entries(state.installed)) { first[title] = rec.firstSection; }
  if (typeof Sefaria !== 'undefined' && Sefaria.hebrewCategories) {
    Object.assign(Sefaria.hebrewCategories, extraCategoryNames());
  }
  return addToToc(toc, books, first);
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

/** Turn a source on (its catalogue is downloaded) or off (its downloaded books are deleted). */
export async function setSourceEnabled(id, on) {
  await loadExtras();
  if (on) {
    if (!catalogs[id]) { await refreshCatalog(id); }
    enabled = {...enabled, [id]: true};
  } else {
    for (const title of installedTitles(id)) { await removeFiles(title); delete state.installed[title]; }
    await saveState();
    const {[id]: _, ...rest} = enabled;
    enabled = rest;
  }
  await AsyncStorage.setItem(ENABLED_KEY, JSON.stringify(enabled));
  await reloadToc();
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
    return (entry.hash && entry.hash !== rec.hash) || rec.converter !== src.converterVersion;
  });
}

/** "Check for updates" for one source: a fresh catalogue, then the books that changed. */
export async function checkUpdates(id) {
  await refreshCatalog(id);
  await reloadToc();
  return booksToUpdate(id);
}

async function removeFiles(title) {
  for (const path of [`${LIBRARY_DIR}${title}.zip`, `${LIBRARY_DIR}${title}_search.txt`,
    `${FileSystem.documentDirectory}${title}_index.json`]) {
    await FileSystem.deleteAsync(path, {idempotent: true}).catch(() => {});
  }
}

function forgetCaches() {
  if (typeof Sefaria !== 'undefined') {
    Sefaria._jsonSectionData = {};
    Sefaria._jsonData = {};
  }
  clearOfflineSearchCache();
}

/** The book's files, converted from the source's text (pure apart from the source). */
export function convertBook(entry, text) {
  const source = EXTRA_SOURCES[entry.source];
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
  return {files, firstSection, companions};
}

/** A converted book's files as library/<title>.zip and its offline search lines */
async function writeBook(title, files) {
  const dir = `${TMP_DIR}${md5(title)}/`;
  const zipPath = `${LIBRARY_DIR}${title}.zip`;
  await FileSystem.deleteAsync(dir, {idempotent: true}).catch(() => {});
  try {
    await FileSystem.makeDirectoryAsync(dir, {intermediates: true});
    for (const [name, data] of Object.entries(files)) {
      await FileSystem.writeAsStringAsync(`${dir}${name}`, JSON.stringify(data));
    }
    await FileSystem.makeDirectoryAsync(LIBRARY_DIR, {intermediates: true}).catch(() => {});
    await removeFiles(title);                    // (zip adds to a file that is there)
    await zip(dir, zipPath);
  } finally {
    await FileSystem.deleteAsync(dir, {idempotent: true}).catch(() => {});
  }
  const lines = await searchLines(files);
  if (lines.length) {
    await FileSystem.writeAsStringAsync(`${LIBRARY_DIR}${title}_search.txt`, `${lines.join('\n')}\n`);
  }
}

/** The books made with `title` (its editors' notes) */
const companionsOf = title => Object.keys(state.installed).filter(t => state.installed[t].companionOf === title);

/** The offline search lines of a converted book (localSearch.js's format) */
export async function searchLines(files) {
  // (no _index.json given: bookLines then treats every version as not hosted, so all are indexed)
  const names = Object.keys(files).filter(n => !n.endsWith('_index.json'));
  return bookLines(names, async name => JSON.stringify(files[name]));
}

export class RestrictedBookError extends Error {}
export class DownloadCancelledError extends Error {}

// ---------------------------------------------------------------- downloads under way
// {title: {done, total, unit, cancelled, hooks, promise}}: what the reader is shown (pages done of
// all, or a share of the bytes) and the Cancel. unit: 'pages' (Wikisource's pages), 'percent'
// (a file whose size is known: Dicta's zips), null (not known: a spinner).
const downloads = {};
const PROGRESS_EVERY = 250;          // ms between two progress notices
let lastNotice = 0;

/** {done, total, unit} of a book being downloaded now (total 0: not known yet), else null */
export function downloadProgress(title) {
  const d = downloads[title];
  return d ? {done: d.done, total: d.total, unit: d.unit} : null;
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
  if (downloads[title]) { return downloads[title].promise; }     // (already under way)
  downloads[title] = {done: 0, total: 0, unit: null, cancelled: false, hooks: []};
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

async function fetchAndInstall(title, job) {
  await loadExtras();
  const entry = books[title];
  if (!entry) { throw new Error(`not an extra book: ${title}`); }
  const source = EXTRA_SOURCES[entry.source];
  let text;
  if (source.fetchBook) {              // (a book that is more than one text file: Dicta's zip of pages)
    text = await source.fetchBook(entry, job);
  } else {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (controller) { job.onCancel(() => controller.abort()); }
    const response = await fetch(source.bookUrl(entry), controller ? {signal: controller.signal} : undefined);
    if (!response.ok) { throw new Error(`${entry.source}: HTTP ${response.status} for ${title}`); }
    text = await response.text();
  }
  job.check();
  if (source.isRestricted(text, entry)) {
    state.blocked[`${entry.source}|${entry.id}`] = 'the book\'s own notice';
    await saveState();
    await reloadToc();
    throw new RestrictedBookError(title);
  }
  const {files, firstSection, companions} = convertBook(entry, text);
  job.check();                         // (the last moment to cancel: nothing is written yet)
  await writeBook(title, files);
  const at = new Date().toISOString();
  state.installed[title] = {
    source: entry.source, id: entry.id, hash: entry.hash || null, converter: source.converterVersion,
    firstSection, at, ...(source.installRecord ? source.installRecord(entry, text) : {}),
  };
  for (const old of companionsOf(title)) { await removeFiles(old); delete state.installed[old]; }
  for (const c of companions || []) {
    await writeBook(c.entry.title, c.files);
    state.installed[c.entry.title] = {
      source: entry.source, id: `${entry.id}#${c.entry.title}`, companionOf: title, entry: c.entry,
      converter: source.converterVersion, firstSection: c.firstSection, at,
    };
    books[c.entry.title] = {...c.entry, source: entry.source};
  }
  await saveState();
  forgetCaches();
  if (companions && companions.length) { await reloadToc(); }     // (the notes book joins the library)
  const index = typeof Sefaria !== 'undefined' && Sefaria.index && Sefaria.index(title);
  if (index) { index.firstSection = firstSection; }
  notify();
  return firstSection;
}

/** Delete one downloaded book (it stays in the library, to be downloaded again). */
export async function deleteBook(title) {
  await loadExtras();
  const companions = companionsOf(title);
  for (const t of [title, ...companions]) {
    await removeFiles(t);
    delete state.installed[t];
  }
  companions.forEach(t => { delete books[t]; });
  await saveState();
  if (companions.length) { await reloadToc(); }   // (its notes book leaves the library with it)
  forgetCaches();
  const index = typeof Sefaria !== 'undefined' && Sefaria.index && Sefaria.index(title);
  if (index) { index.firstSection = title; }
  notify();
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
  Object.keys(downloads).forEach(t => { delete downloads[t]; });
  loaded = next.loaded === false ? null : Promise.resolve();
}
