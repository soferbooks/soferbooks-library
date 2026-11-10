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
 * Only the books the manifest lists (search.local_titles) are looked at.  A book is
 * redone when its zip changes (a Sefaria update re-downloads it), one book at a time,
 * pausing between small batches of section files so the UI stays responsive.
 */
import * as FileSystem from 'expo-file-system/legacy';
import {unzip} from 'react-native-zip-archive';
import AsyncStorage from '@react-native-async-storage/async-storage';
import md5 from 'md5';
import {decodeHTML} from 'entities';
import {clearOfflineSearchCache} from './offlineSearch';

export const LOCAL_SEARCH_DIR = `${FileSystem.documentDirectory}local_search/`;
export const STATE_KEY = 'soferbooksLocalSearch';
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

function primaryVersions(versions) {
  const seen = new Set();
  const out = [];
  for (const v of versions) {
    if (!v || !v.language || !v.versionTitle || seen.has(v.language)) { continue; }
    seen.add(v.language);
    out.push([v.language, v.versionTitle]);
  }
  return out;
}

const pause = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * The search lines of the not-hostable versions of one unpacked book.
 * names: the file names of the book zip; read(name): that file's text.
 */
export async function bookLines(names, read) {
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
      for (const [lang, vtitle] of primaryVersions(versions)) {
        if (isOpenLicense(licenses.get(`${lang}|${vtitle}`))) { continue; }  // hosted
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

/** Unpack one book into a scratch folder and write its local search file. */
async function buildBook(title, zipUri) {
  const dir = `${TMP_DIR}${md5(title)}/`;
  await remove(dir);
  try {
    await FileSystem.makeDirectoryAsync(dir, {intermediates: true});
    await unzip(zipUri, dir);
    const names = await listDir(dir);
    const lines = await bookLines(names, name => FileSystem.readAsStringAsync(`${dir}${name}`));
    if (lines.length) {
      await FileSystem.makeDirectoryAsync(LOCAL_SEARCH_DIR, {intermediates: true}).catch(() => {});
      await FileSystem.writeAsStringAsync(localSearchPath(title), `${lines.join('\n')}\n`);
    } else {
      await remove(localSearchPath(title));
    }
    return true;
  } catch (e) {
    return false;
  } finally {
    await remove(dir);
  }
}

let running = null;
let again = null;

/**
 * Bring local_search/ in line with the books on the phone.
 * titles: the manifest's search.local_titles; isHidden(title): the content filter.
 * Returns {built: [...], removed: [...]}.  Calls made while it runs are merged into one
 * more pass afterwards.
 */
export function syncLocalSearch(titles, options = {}) {
  if (running) {
    again = [titles, options];
    return running;
  }
  running = _syncLocalSearch(titles || [], options).finally(() => {
    running = null;
    if (again) {
      const [t, o] = again;
      again = null;
      syncLocalSearch(t, o);
    }
  });
  return running;
}

async function _syncLocalSearch(titles, {isHidden = null} = {}) {
  let state = {};
  try { state = JSON.parse(await AsyncStorage.getItem(STATE_KEY)) || {}; } catch (e) { state = {}; }
  const wanted = new Set(titles);
  const built = [];
  const removed = [];
  const hidden = t => { try { return !!(isHidden && isHidden(t)); } catch (e) { return false; } };
  const save = () => AsyncStorage.setItem(STATE_KEY, JSON.stringify(state)).catch(() => {});

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

  for (const title of titles) {
    const zipUri = `${LIBRARY_DIR}${title}.zip`;
    let info = {exists: false};
    try { info = await FileSystem.getInfoAsync(zipUri); } catch (e) { /* missing */ }
    if (!info.exists || hidden(title)) {
      if (state[title]) {
        await remove(localSearchPath(title));
        delete state[title];
        removed.push(title);
      }
      continue;
    }
    const stamp = `${info.modificationTime}:${info.size}`;
    if (state[title] === stamp) { continue; }
    if (await buildBook(title, zipUri)) {
      state[title] = stamp;
      built.push(title);
      await save();
    }
    await pause();
  }
  await save();
  if (built.length || removed.length) { clearOfflineSearchCache(); }
  return {built, removed};
}
