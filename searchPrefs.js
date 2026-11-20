/**
 * "Offline search" (Settings): whether the phone keeps search files (owner, 2026-11-20: they were
 * 6.65 GB of the 9.6 GB the app took on the 32-bit tablet, the books themselves 2.5 GB).
 *
 *   On   Sefaria's books' search files (packs.js: the SoferBooks release), the lines made on the
 *        phone for versions the release may not host (localSearch.js), and every extra source's
 *        book's (extras: made when it is converted). Search works without internet.
 *   Off  (the default) none of them: search asks Sefaria's search API, so it needs internet, and
 *        the extra sources' books (Otzaria, Dicta, Wikisource, Sofer Library) are not searched.
 *        Turning it off deletes the files already on the phone.
 *
 * Turning it on downloads Sefaria's again (DownloadControl syncs the packs); an extra book's are
 * made again when it is next downloaded or updated.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

export const OFFLINE_SEARCH_KEY = 'offlineSearch.v1';
const LIBRARY_DIR = `${FileSystem.documentDirectory}library/`;
const LOCAL_SEARCH_DIR = `${FileSystem.documentDirectory}local_search/`;
const PACK_STATE_KEY = 'soferbooksPacks';      // (packs.js STATE_KEY: which search shards are on the phone)

let enabled = false;
let loaded = null;
const listeners = new Set();

/** Read the setting once (resolves to it); never rejects */
export function loadOfflineSearch() {
  if (!loaded) {
    loaded = AsyncStorage.getItem(OFFLINE_SEARCH_KEY)
      .then(v => { enabled = v === 'on'; return enabled; })
      .catch(() => enabled);
  }
  return loaded;
}

/** (tests: the setting as given, without storage) */
export const _setOfflineSearchForTests = on => { enabled = !!on; loaded = Promise.resolve(enabled); };

/** The setting as last read (false until loaded) */
export const isOfflineSearchOn = () => enabled;

export const subscribeOfflineSearch = fn => { listeners.add(fn); return () => listeners.delete(fn); };

/** Change the setting; turning it off deletes the search files (resolves once they are gone) */
export async function setOfflineSearch(on) {
  enabled = !!on;
  loaded = Promise.resolve(enabled);
  await AsyncStorage.setItem(OFFLINE_SEARCH_KEY, enabled ? 'on' : 'off').catch(() => {});
  for (const fn of listeners) { try { fn(enabled); } catch (e) { /* a listener's own problem */ } }
  if (!enabled) { await removeSearchFiles(); }
}

/**
 * Delete every search file on the phone ({files, bytes} removed). The packs' state forgets its
 * search shards and indexes, so turning search on again downloads them again. Never throws.
 */
export async function removeSearchFiles() {
  let files = 0;
  let names = [];
  try { names = await FileSystem.readDirectoryAsync(LIBRARY_DIR); } catch (e) { names = []; }
  for (const name of names) {
    if (!name.endsWith('_search.txt') && !name.endsWith('_search.idx')) { continue; }
    await FileSystem.deleteAsync(`${LIBRARY_DIR}${name}`, { idempotent: true }).catch(() => {});
    files += 1;
  }
  await FileSystem.deleteAsync(LOCAL_SEARCH_DIR, { idempotent: true }).catch(() => {});
  try {
    const raw = await AsyncStorage.getItem(PACK_STATE_KEY);
    const state = raw ? JSON.parse(raw) : null;
    if (state) {
      await AsyncStorage.setItem(PACK_STATE_KEY, JSON.stringify({ ...state, shards: {}, indexes: {} }));
    }
  } catch (e) { /* no pack state */ }
  try { require('./offlineSearch').clearOfflineSearchCache(); } catch (e) { /* not loaded */ }
  return { files };
}

/** At start: with offline search off, any search files still on the phone are deleted (in the background) */
export async function pruneSearchFilesIfOff() {
  if (await loadOfflineSearch()) { return null; }
  return removeSearchFiles();
}
