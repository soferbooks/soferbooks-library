/**
 * Offline search lines for the versions the SoferBooks release may not host.
 *
 * The release (packs.js) is public, so tools/library-export/build_sefaria_packs.py puts
 * only versions with an open Sefaria licence in its search files.  The other versions'
 * lines are made here, on the phone, from the book zip Sefaria itself sent it - the same
 * lines build_search.py would write (enRef TAB heRef TAB lang TAB versionTitle TAB text),
 * into local_search/<Title>_search.txt, which offlineSearch.js reads next to the hosted
 * library/<Title>_search.txt.
 *
 * The hosted files have only the PRIMARY version of each language (the first in Sefaria's
 * list).  When the reader's content filter (shomer) hides that version - e.g. Tanakh's
 * English, "THE JPS TANAKH: Gender-Sensitive Edition", from Right-Wing MO up - the reader
 * shows the first version the filter allows instead (offline.js getDefaultVersionForLang),
 * so that version's lines are made here too, and offlineSearch.js leaves the hidden
 * version's hosted lines out.
 *
 * Books looked at: the manifest's search.local_titles, plus every downloaded book whose
 * hosted search file has a version the filter hides (each hosted file's versions are read
 * once and remembered, see hostedVersions).  A book is redone when its zip changes (a
 * Sefaria update re-downloads it) or when the filter changes which of its versions are
 * hidden, one book at a time, pausing between small batches of section files so the UI
 * stays responsive.  A filter change re-runs this in the background (watchContentFilter).
 */
import * as FileSystem from 'expo-file-system/legacy';
import {unzip} from 'react-native-zip-archive';
import AsyncStorage from '@react-native-async-storage/async-storage';
import md5 from 'md5';
import {decodeHTML} from 'entities';
import {clearOfflineSearchCache} from './offlineSearch';
import * as shomer from './shomer';

export const LOCAL_SEARCH_DIR = `${FileSystem.documentDirectory}local_search/`;
export const STATE_KEY = 'soferbooksLocalSearch';       // {title: {stamp, versions, hidden}}
export const HOSTED_KEY = 'soferbooksHostedVersions';   // {title: {stamp, versions: ['lang|vtitle']}}
export const RUN_KEY = 'soferbooksLocalSearchRun';      // {titles, done}: the last run
const LIBRARY_DIR = `${FileSystem.documentDirectory}library/`;
const TMP_DIR = `${FileSystem.cacheDirectory}soferbooks-local/`;
const SEARCH_SUFFIX = '_search.txt';
const BATCH = 20;   // section files read between two pauses

// ------------------------------------------------------------- licences
// Mirrors build_sefaria_packs.py licence_open: non-commercial is fine, anything else
// (copyright, all rights reserved, "unknown", no licence, ND) is not hosted.
const OPEN_LICENSES = new Set(['public-domain', 'pd', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa']);

export function licenseKey(license) {
  if (typeof license !== 'string') { return ''; }
  return license.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-\d+(\.\d+)*$/, '');
}

export function isOpenLicense(license) {
  return OPEN_LICENSES.has(licenseKey(license));
}

// ------------------------------------------------------------- lines (mirrors build_search.py)

function clean(text) {
  if (text === null || text === undefined) { return ''; }
  if (Array.isArray(text)) { return text.filter(p => p !== null && p !== undefined).map(clean).join(' '); }
  if (typeof text === 'object') { return clean(Object.values(text)); }
  return decodeHTML(String(text).replace(/<[^>]*>/g, '')).replace(/[ \t\r\n]+/g, ' ').trim();
}

function textUnits(text) {
  if (typeof text === 'string') { return [text]; }
  if (Array.isArray(text)) {
    return text.every(x => x === null || typeof x !== 'object') ? text : text.map(clean);
  }
  if (text && typeof text === 'object') { return Object.values(text).map(clean); }
  return [];
}

function sectionEntries(metadata) {
  if (metadata.sections && typeof metadata.sections === 'object' && !Array.isArray(metadata.sections)) {
    return Object.entries(metadata.sections).map(([ref, sub]) => (
      [ref, (sub && sub.heRef) || ref, (sub && sub.versions) || []]));
  }
  const ref = metadata.ref || metadata.sectionRef;
  return ref ? [[ref, metadata.heRef || ref, metadata.versions || []]] : [];
}

function hiddenSafe(isVersionHidden, version) {
  try { return !!(isVersionHidden && isVersionHidden(version)); } catch (e) { return false; }
}

/**
 * For each language of one section: [lang, version, isPrimary] for the version the reader
 * shows (the first one the content filter does not hide, as offline.js
 * getDefaultVersionForLang).  The primary one (the first) is the only one hosted files index.
 */
function shownVersions(versions, isVersionHidden) {
  const byLang = new Map();
  for (const v of versions) {
    if (!v || !v.language || !v.versionTitle) { continue; }
    if (!byLang.has(v.language)) { byLang.set(v.language, []); }
    byLang.get(v.language).push(v);
  }
  const out = [];
  for (const [lang, list] of byLang) {
    const shown = list.find(v => !hiddenSafe(isVersionHidden, v));
    if (shown) { out.push([lang, shown, shown === list[0]]); }
  }
  return out;
}

const pause = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * The search lines of one unpacked book that its hosted file cannot have: the versions the
 * release may not host, and the version the reader shows in place of a hidden primary one.
 * names: the file names of the book zip; read(name): that file's text.
 * isVersionHidden(version): the content filter; seen: a Set collecting every
 * "lang|versionTitle" of the book.
 */
export async function bookLines(names, read, {isVersionHidden = null, seen = null} = {}) {
  const nameSet = new Set(names);
  const indexName = names.find(n => n.endsWith('_index.json'));
  const licenses = new Map();
  if (indexName) {
    try {
      for (const v of JSON.parse(await read(indexName)).versions || []) {
        licenses.set(`${v.language}|${v.versionTitle}`, v.license);
      }
    } catch (e) {
      // no licences known: every version counts as not hostable
    }
  }
  const lines = [];
  const metaNames = names.filter(n => n.endsWith('.metadata.json')).sort();
  for (let m = 0; m < metaNames.length; m++) {
    if (m % BATCH === BATCH - 1) { await pause(); }
    const stem = metaNames[m].slice(0, -'.metadata.json'.length);
    let metadata;
    try { metadata = JSON.parse(await read(metaNames[m])); } catch (e) { continue; }
    for (const [ref, heRef, versions] of sectionEntries(metadata)) {
      if (seen) {
        versions.forEach(v => { if (v && v.language && v.versionTitle) { seen.add(`${v.language}|${v.versionTitle}`); } });
      }
      for (const [lang, version, primary] of shownVersions(versions, isVersionHidden)) {
        const vtitle = version.versionTitle;
        if (primary && isOpenLicense(licenses.get(`${lang}|${vtitle}`))) { continue; }  // hosted
        const name = `${stem}.${md5(vtitle).substring(0, 8)}.${lang}.json`;
        if (!nameSet.has(name)) { continue; }
        let payload;
        try { payload = JSON.parse(await read(name)); } catch (e) { continue; }
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const sections = payload.sections || {};
          payload = ref in sections ? sections[ref] : payload.text;
        }
        textUnits(payload).map(clean).forEach((unit, i) => {
          if (unit) { lines.push(`${ref}:${i + 1}\t${heRef}:${i + 1}\t${lang}\t${vtitle}\t${unit}`); }
        });
      }
    }
  }
  return lines;
}

// ------------------------------------------------------------- files

async function remove(path) {
  try { await FileSystem.deleteAsync(path, {idempotent: true}); } catch (e) { /* gone */ }
}

async function listDir(path) {
  try { return await FileSystem.readDirectoryAsync(path); } catch (e) { return []; }
}

export const localSearchPath = title => `${LOCAL_SEARCH_DIR}${title}${SEARCH_SUFFIX}`;

/**
 * Unpack one book into a scratch folder and write its local search file.
 * Returns every "lang|versionTitle" of the book, or null on failure.
 */
async function buildBook(title, zipUri, isVersionHidden) {
  const dir = `${TMP_DIR}${md5(title)}/`;
  await remove(dir);
  try {
    await FileSystem.makeDirectoryAsync(dir, {intermediates: true});
    await unzip(zipUri, dir);
    const names = await listDir(dir);
    const seen = new Set();
    const lines = await bookLines(names, name => FileSystem.readAsStringAsync(`${dir}${name}`),
        {isVersionHidden, seen});
    if (lines.length) {
      await FileSystem.makeDirectoryAsync(LOCAL_SEARCH_DIR, {intermediates: true}).catch(() => {});
      await FileSystem.writeAsStringAsync(localSearchPath(title), `${lines.join('\n')}\n`);
    } else {
      await remove(localSearchPath(title));
    }
    return Array.from(seen).sort();
  } catch (e) {
    return null;
  } finally {
    await remove(dir);
  }
}

// ------------------------------------------------------------- hosted versions

const HOSTED_FILE = `${LOCAL_SEARCH_DIR}_hosted_versions.json`;  // too big for AsyncStorage

const versionOf = key => {
  const i = key.indexOf('|');
  return {language: key.slice(0, i), versionTitle: key.slice(i + 1)};
};

/** The "lang|versionTitle"s of a search file's lines. */
export function fileVersions(content) {
  const out = new Set();
  const re = /^[^\t\n]*\t[^\t\n]*\t([^\t\n]*)\t([^\t\n]*)\t/gm;
  let m;
  while ((m = re.exec(content)) !== null) { out.add(`${m[1]}|${m[2]}`); }
  return Array.from(out).sort();
}

/**
 * {title: ["lang|vtitle", ...]} for every hosted search file on the phone.  Each file is
 * read once; the answer is remembered (HOSTED_FILE) until the file changes.
 */
async function hostedVersions() {
  let cache = {};
  try { cache = JSON.parse(await FileSystem.readAsStringAsync(HOSTED_FILE)) || {}; } catch (e) { cache = {}; }
  const next = {};
  let changed = false;
  const write = async () => {
    await FileSystem.makeDirectoryAsync(LOCAL_SEARCH_DIR, {intermediates: true}).catch(() => {});
    await FileSystem.writeAsStringAsync(HOSTED_FILE, JSON.stringify(next)).catch(() => {});
  };
  let read = 0;
  for (const name of await listDir(LIBRARY_DIR)) {
    if (!name.endsWith(SEARCH_SUFFIX)) { continue; }
    const title = name.slice(0, -SEARCH_SUFFIX.length);
    const uri = `${LIBRARY_DIR}${name}`;
    let info = {exists: false};
    try { info = await FileSystem.getInfoAsync(uri); } catch (e) { continue; }
    if (!info.exists) { continue; }
    const stamp = `${info.modificationTime}:${info.size}`;
    const known = cache[title];
    if (known && known.stamp === stamp) {
      next[title] = known;
      continue;
    }
    let content;
    try { content = await FileSystem.readAsStringAsync(uri); } catch (e) { continue; }
    next[title] = {stamp, versions: fileVersions(content)};
    content = null;
    changed = true;
    if (++read % 50 === 0) { await write(); }  // an interrupted first pass is not lost
    await pause();
  }
  if (changed || Object.keys(cache).length !== Object.keys(next).length) { await write(); }
  const out = {};
  for (const [title, entry] of Object.entries(next)) { out[title] = entry.versions; }
  return out;
}

/** The versions (of the "lang|vtitle" `keys`) the filter hides, as one stable string. */
function hiddenKey(keys, isVersionHidden) {
  if (!isVersionHidden || !Array.isArray(keys)) { return ''; }
  return keys.filter(k => hiddenSafe(isVersionHidden, versionOf(k))).join('\n');
}

// ------------------------------------------------------------- sync

const shomerBookHidden = title => shomer.isBookHidden(title);
const shomerVersionHidden = version => shomer.isActive() && shomer.isVersionHidden(version);

let running = null;
let again = null;

/**
 * Bring local_search/ in line with the books on the phone and the content filter.
 * titles: the manifest's search.local_titles (null: the ones of the last run).
 * options.isHidden(title), options.isVersionHidden(version): the content filter (default:
 * shomer's current setting).
 * Returns {built: [...], removed: [...]}.  Calls made while it runs are merged into one
 * more pass afterwards.
 */
export function syncLocalSearch(titles, options = {}) {
  if (running) {
    again = [titles, options];
    return running;
  }
  running = _syncLocalSearch(titles, options).finally(() => {
    running = null;
    if (again) {
      const [t, o] = again;
      again = null;
      syncLocalSearch(t, o).catch(() => {});
    }
  });
  return running;
}

async function _syncLocalSearch(titles, options) {
  const isHidden = options.isHidden || shomerBookHidden;
  const isVersionHidden = options.isVersionHidden || shomerVersionHidden;
  const filterOn = options.isVersionHidden ? true : shomer.isActive();

  let run = null;
  try { run = JSON.parse(await AsyncStorage.getItem(RUN_KEY)); } catch (e) { run = null; }
  if (!Array.isArray(titles)) { titles = (run && Array.isArray(run.titles)) ? run.titles : []; }
  await AsyncStorage.setItem(RUN_KEY, JSON.stringify({titles, done: false})).catch(() => {});

  let state = {};
  try { state = JSON.parse(await AsyncStorage.getItem(STATE_KEY)) || {}; } catch (e) { state = {}; }
  const built = [];
  const removed = [];
  const hidden = t => { try { return !!isHidden(t); } catch (e) { return false; } };
  const save = () => AsyncStorage.setItem(STATE_KEY, JSON.stringify(state)).catch(() => {});

  // the manifest's books, and the books whose hosted (primary) version the filter hides
  const wanted = new Set(titles);
  if (filterOn) {
    for (const [title, versions] of Object.entries(await hostedVersions())) {
      if (hiddenKey(versions, isVersionHidden)) { wanted.add(title); }
    }
  }

  // files of books that are gone, hidden or no longer need local lines
  for (const name of await listDir(LOCAL_SEARCH_DIR)) {
    if (!name.endsWith(SEARCH_SUFFIX)) { continue; }
    const title = name.slice(0, -SEARCH_SUFFIX.length);
    if (!wanted.has(title) || hidden(title)) {
      await remove(`${LOCAL_SEARCH_DIR}${name}`);
      removed.push(title);
      delete state[title];
    }
  }
  for (const title of Object.keys(state)) {
    if (!wanted.has(title)) { delete state[title]; }
  }

  for (const title of Array.from(wanted).sort()) {
    const zipUri = `${LIBRARY_DIR}${title}.zip`;
    let info = {exists: false};
    try { info = await FileSystem.getInfoAsync(zipUri); } catch (e) { /* missing */ }
    if (!info.exists || hidden(title)) {
      if (state[title]) {
        await remove(localSearchPath(title));
        delete state[title];
        if (!removed.includes(title)) { removed.push(title); }
      }
      continue;
    }
    const stamp = `${info.modificationTime}:${info.size}`;
    const known = state[title];
    if (known && known.stamp === stamp && known.hidden === hiddenKey(known.versions, isVersionHidden)) {
      continue;  // same zip, and the filter hides the same versions of it
    }
    const versions = await buildBook(title, zipUri, isVersionHidden);
    if (versions) {
      state[title] = {stamp, versions, hidden: hiddenKey(versions, isVersionHidden)};
      built.push(title);
      await save();
    }
    await pause();
  }
  await save();
  await AsyncStorage.setItem(RUN_KEY, JSON.stringify({titles, done: true})).catch(() => {});
  if (built.length || removed.length) { clearOfflineSearchCache(); }
  return {built, removed};
}

/**
 * Keep local_search/ in step with the content filter: re-run in the background whenever
 * the filter changes, and once after start-up if the last run did not finish (the app was
 * closed while it ran).  Returns the unsubscribe function.
 */
export function watchContentFilter({startupDelay = 20000} = {}) {
  const unsubscribe = shomer.subscribe(() => {
    clearOfflineSearchCache();
    syncLocalSearch(null).catch(() => {});
  });
  const timer = startupDelay === null ? null : setTimeout(async () => {
    try {
      const run = JSON.parse(await AsyncStorage.getItem(RUN_KEY));
      if (run && run.done === false) { syncLocalSearch(null).catch(() => {}); }
    } catch (e) { /* nothing to resume */ }
  }, startupDelay);
  return () => {
    if (timer) { clearTimeout(timer); }
    unsubscribe();
  };
}
