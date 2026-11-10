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
 *   toTree(text, entry) -> [Node, author]        extras/tree.js
 *   isRestricted(text, entry) -> bool            the book's own notice forbids it
 *   versionOf(entry, text) -> {versionTitle, versionSource, license, librarySource, ...}
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
import {bookFiles} from './schema7';
import {chooseBooks, addToToc, categoryNames} from './catalog';
import {bookLines} from '../localSearch';
import {clearOfflineSearchCache} from '../offlineSearch';
import * as shomer from '../shomer';

export const EXTRA_SOURCES = {[otzaria.id]: otzaria};
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
  const response = await fetch(source.catalogUrl);
  if (!response.ok) { throw new Error(`${id} catalogue: HTTP ${response.status}`); }
  const entries = source.parseCatalog(await response.text());
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
    if (!entry || !src) { return false; }
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
  const {files, firstSection} = bookFiles(tree, {
    title: entry.title,
    heTitle: entry.heTitle,
    categories: entry.categories,
    heCategories: entry.heCategories,
    authors: author ? [{he: author, en: ''}] : null,
    version: source.versionOf(entry, text),
  });
  return {files, firstSection};
}

/** The offline search lines of a converted book (localSearch.js's format) */
export async function searchLines(files) {
  // (no _index.json given: bookLines then treats every version as not hosted, so all are indexed)
  const names = Object.keys(files).filter(n => !n.endsWith('_index.json'));
  return bookLines(names, async name => JSON.stringify(files[name]));
}

export class RestrictedBookError extends Error {}

/**
 * Download one book from its source, convert it and put it in the library.
 * Returns its first section's ref. Throws RestrictedBookError when the book's own notice
 * forbids it (it is then left out of the library).
 */
export async function downloadBook(title) {
  await loadExtras();
  const entry = books[title];
  if (!entry) { throw new Error(`not an extra book: ${title}`); }
  const source = EXTRA_SOURCES[entry.source];
  const response = await fetch(source.bookUrl(entry));
  if (!response.ok) { throw new Error(`${entry.source}: HTTP ${response.status} for ${title}`); }
  const text = await response.text();
  if (source.isRestricted(text, entry)) {
    state.blocked[`${entry.source}|${entry.id}`] = 'the book\'s own notice';
    await saveState();
    await reloadToc();
    throw new RestrictedBookError(title);
  }
  const {files, firstSection} = convertBook(entry, text);
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
  state.installed[title] = {
    source: entry.source, id: entry.id, hash: entry.hash || null, converter: source.converterVersion,
    firstSection, at: new Date().toISOString(),
  };
  await saveState();
  forgetCaches();
  const index = typeof Sefaria !== 'undefined' && Sefaria.index && Sefaria.index(title);
  if (index) { index.firstSection = firstSection; }
  notify();
  return firstSection;
}

/** Delete one downloaded book (it stays in the library, to be downloaded again). */
export async function deleteBook(title) {
  await loadExtras();
  await removeFiles(title);
  delete state.installed[title];
  await saveState();
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
  loaded = next.loaded === false ? null : Promise.resolve();
}
