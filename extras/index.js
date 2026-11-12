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
import {zip} from 'react-native-zip-archive';
import md5 from 'md5';
import otzaria from './otzaria';
import dicta from './dicta';
import wikisource, {withCurrentShelf} from './wikisource';
import chok from './chok';
import soferLibrary from './sofer';
import {bookFiles, setEnglishNameLookup} from './schema7';
import * as links from './links';
import {chooseBooks, addToToc, categoryNames, replacementForRef, redirectNameResults as redirectNames} from './catalog';
import {bookLines} from '../localSearch';
import {clearOfflineSearchCache} from '../offlineSearch';
import * as shomer from '../shomer';
import {WORK_DIR, ensureRoom, replaceFile, MB} from '../storage';

// (chok: Chok LeYisrael, one book from Otzaria's library, turned on by its learning schedule - no
//  switch in Settings: extras/chok.js)
export const EXTRA_SOURCES = {[otzaria.id]: otzaria, [dicta.id]: dicta, [wikisource.id]: wikisource, [chok.id]: chok, [soferLibrary.id]: soferLibrary};
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
 * Sofer book named only in Hebrew).
 */
export function englishTitleOf(title) {
  const b = books[title];
  if (!b || b.source !== 'sofer_library') { return null; }
  return /[A-Za-z]/.test(title) && !/[֐-׿]/.test(title) ? title : null;
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
    if (enabled[id] && cat && Array.isArray(cat.entries)) { lists[id] = cat.entries.map(withCurrentShelf); }
  }
  const chosen = chooseBooks(toc, lists, state);
  books = chosen.books;
  replaced = chosen.replaced;
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

/** Turn a source on (its catalogue is downloaded) or off (its downloaded books are deleted). */
export async function setSourceEnabled(id, on) {
  await loadExtras();
  if (on) {
    if (!catalogs[id]) { await refreshCatalog(id); }
    enabled = {...enabled, [id]: true};
  } else {
    for (const title of installedTitles(id)) { await removeFiles(title); delete state.installed[title]; }
    await saveState();
    forgetCaches();
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
  for (const name of names.filter(n => isUnpackedFileOf(n, title))) {
    await FileSystem.deleteAsync(`${FileSystem.documentDirectory}${name}`, {idempotent: true}).catch(() => {});
  }
}

/** A file offline.js unpacked from `title`'s zip: "<title>, S1.metadata.json", "<title>, S1.<hash>.he.json" */
export const isUnpackedFileOf = (name, title) => typeof name === 'string' && !!title && name.endsWith('.json')
  && (name.startsWith(`${title}, `) || name.startsWith(`${title}.`));

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
async function writeBook(title, files) {
  const dir = `${TMP_DIR}${md5(title)}/`;
  const newZip = `${TMP_DIR}${md5(title)}.zip`;
  const zipPath = `${LIBRARY_DIR}${title}.zip`;
  await FileSystem.deleteAsync(dir, {idempotent: true}).catch(() => {});
  await FileSystem.deleteAsync(newZip, {idempotent: true}).catch(() => {});   // (zip adds to a file that is there)
  try {
    await FileSystem.makeDirectoryAsync(dir, {intermediates: true});
    for (const [name, data] of Object.entries(files)) {
      await FileSystem.writeAsStringAsync(`${dir}${name}`, JSON.stringify(data));
    }
    await FileSystem.makeDirectoryAsync(LIBRARY_DIR, {intermediates: true}).catch(() => {});
    await zip(dir, newZip);
    const made = await FileSystem.getInfoAsync(newZip).catch(() => null);
    if (!made || !made.exists || !made.size) { throw new Error(`extras: the zip of ${title} was not made`); }
    await removeFiles(title, {keepZip: true});   // (what was unpacked from the old copy, its search lines)
    await replaceFile(newZip, zipPath);
  } finally {
    await FileSystem.deleteAsync(dir, {idempotent: true}).catch(() => {});
    await FileSystem.deleteAsync(newZip, {idempotent: true}).catch(() => {});
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
  const under = downloads[title];
  if (under && !under.cancelled) { return under.promise; }      // (already under way)
  if (under) {
    // (a download being cancelled - the full library's queue paused on this book: QA round 14 -
    //  is not the reader's: a new one starts once it has stopped)
    return under.promise.catch(() => {}).then(() => downloadBook(title));
  }
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
  // room for the download and the book made of it (storage.js: never fill the phone)
  const known = knownDownloadBytes(title);
  await ensureRoom(known ? known * ROOM_FACTOR : ROOM_UNKNOWN, ROOM_MARGIN);
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
  const {files, firstSection, companions, tree} = convertBook(entry, text);
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
  await collectLinks(title, entry, source, text, tree, at);
  forgetCaches();
  refreshInferred(title);              // (in the background: it may read the texts it is on)
  if (companions && companions.length) { await reloadToc(); }     // (the notes book joins the library)
  const index = typeof Sefaria !== 'undefined' && Sefaria.index && Sefaria.index(title);
  if (index) { index.firstSection = firstSection; }
  notify();
  return firstSection;
}

/**
 * The book's connections, from its source (extras/links.js): Otzaria's link file now; Dicta's
 * citations, a request a page, in the background (kept only if the same download is still there).
 */
async function collectLinks(title, entry, source, text, tree, at) {
  // (a source with no links of its own - Wikisource - still keeps what its sections say of their
  //  place: its obvious connections, extras/inferred.js)
  const stillThere = () => !!state.installed[title] && state.installed[title].at === at;
  // (a book that comes ready made - the Sofer Library's - has no tree to place connections on:
  //  QA round 14, "Cannot read property 'paras' of undefined")
  if (!tree) { return; }
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

/**
 * The obvious connections (extras/inferred.js) of the downloaded books, worked out again after
 * `changed` was downloaded (or a book deleted: null): the book's own, those of the books on it,
 * and of any book whose base is now another. One at a time; never throws.
 */
let inferring = Promise.resolve();
export function refreshInferred(changed = null) {
  inferring = inferring.then(() => inferNow(changed)).catch(e => console.log('extras: inferred links', e));
  return inferring;
}

async function inferNow(changed) {
  await loadExtras();
  const titles = installedTitles().filter(t => !state.installed[t].companionOf);
  const files = {};
  for (const t of titles) {
    const f = await links.readLinks(t);
    if (f) { files[t] = f; }
  }
  if (!Object.keys(files).length) { return; }
  const loadSection = async ref => {
    const {loadText} = require('../offlineOnline');      // (lazily, when a text is needed: it imports this module)
    const {result} = await loadText(ref, false, null, true, true);
    return result && result.he;
  };
  const done = await links.inferAll({files, books: inferenceBooks(), changed, loadSection});
  for (const t of done) {
    if (state.installed[t]) { await links.saveLinks(t, files[t]); }
  }
  if (done.length) { notify(); }
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

/** Sefaria's links API's response for a section, with the downloaded extra books' links of it */
export async function withExtraLinks(sectionRef, response) {
  const extra = await extraLinksFor(sectionRef);
  return links.withExtraLinks(response, extra);
}

/** The downloaded extra books' links of a section (both ends: theirs and the passages they explain) */
export async function extraLinksFor(sectionRef) {
  try {
    await loadExtras();
    const titles = installedTitles().filter(t => !state.installed[t].companionOf);
    if (!titles.length) { return []; }
    return links.relatedFromIndex(await links.ready(titles), sectionRef);
  } catch (e) {
    console.log('extras: links of', sectionRef, e);
    return [];
  }
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
  refreshInferred(null);               // (the books that were on it lose those connections)
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
  replaced = next.replaced || {};
  Object.keys(downloads).forEach(t => { delete downloads[t]; });
  links._reset();
  loaded = next.loaded === false ? null : Promise.resolve();
}
