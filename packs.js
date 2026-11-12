/**
 * SoferBooks packs for Sefaria's books: offline search and Sofer's corrections.
 *
 * Sefaria's mobile export (DownloadControl.js) has no search files, and Sofer's text
 * corrections are not in it. tools/library-export/build_sefaria_packs.py builds both from
 * Sefaria's own zips and publishes them as one GitHub Release (sources.js:
 * SOFERBOOKS_RELEASES). Its manifest.json lists:
 *
 *   corrections                  corrections.zip -> library/_corrections/<Title>.json
 *   search.shards[id].assets     search-<id>[-n].zip -> library/<Title>_search.txt
 *   search.packages[name]        the shards of a Sefaria package + its trigram index
 *                                (index-<slug>.idx -> library/<name>_search.idx)
 *   search.local_titles          books with versions whose licence does not let us host
 *                                their text; localSearch.js makes those lines on the phone
 *
 * After a package download (or update) finishes, syncPacks() fetches the manifest and
 * downloads only what the chosen packages need and the phone does not have yet (assets
 * are compared by sha256, so an unchanged shard is not downloaded again in a new release).
 * offlineSearch.js reads the files as they are; offline.js applies the corrections as it
 * reads each section (corrections.js).
 *
 * Nothing here is required for reading: if GitHub cannot be reached, or the repository is
 * not set up yet, the library works as before and search goes online.
 */
import * as FileSystem from 'expo-file-system/legacy';
import {safeUnzip as unzip, WORK_DIR, hasRoom, LOW_SPACE_BYTES} from './storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {releasesBaseUrl} from './sources';
import {CORRECTIONS_DIR, clearCorrectionsCache} from './corrections';
import {clearOfflineSearchCache} from './offlineSearch';
import {syncLocalSearch} from './localSearch';

export const MANIFEST_FORMAT = 1;
export const STATE_KEY = 'soferbooksPacks';
const LIBRARY_DIR = `${FileSystem.documentDirectory}library`;
// (work files in the documents folder: Android empties the cache folder when space runs low)
const TMP_DIR = `${WORK_DIR}soferbooks`;
// a search shard's zip, and its lines unzipped beside it (measured: 683 MB of zips, 1.54 GB of lines)
const SEARCH_UNZIP_FACTOR = 3.3;
const SEARCH_SUFFIX = '_search.txt';
const COMPLETE = 'COMPLETE LIBRARY';

/**
 * Where the release's files are. ".../releases/latest/download" follows the newest
 * release, which may change while we download, so files are fetched from the tag the
 * manifest names (".../releases/download/<tag>").
 */
export function assetBaseUrl(base, manifest) {
  const m = /^(.*)\/releases\/latest\/download$/.exec(base);
  if (m && manifest && manifest.tag) {
    return `${m[1]}/releases/download/${encodeURIComponent(manifest.tag)}`;
  }
  return base;
}

const assetsKey = assets => (assets || []).map(a => a.sha256 || `${a.name}:${a.size}`).join(',');

/**
 * What to download and what to remove (pure; tested in __tests__/packs.test.js).
 *
 * selected: package names the reader chose (DownloadControl's selection)
 * state:    what was installed before ({shards: {id: key}, indexes: {pkg: {sha256, file}},
 *           corrections: sha256})
 * present:  what is really on disk ({probes: Set of titles with a search file,
 *           indexes: Set of index file names, corrections: bool, anyBooks: bool})
 */
export function planPacks(manifest, selected, state = {}, present = {}) {
  const plan = {
    shards: [], indexes: [], removeIndexes: [], corrections: null,
    keep: {shards: {}, indexes: {}, corrections: null},
  };
  if (!manifest || manifest.format !== MANIFEST_FORMAT) { return plan; }
  const probes = present.probes || new Set();
  const indexFiles = present.indexes || new Set();
  const packages = (manifest.search && manifest.search.packages) || {};
  const shards = (manifest.search && manifest.search.shards) || {};

  let wanted = (selected || []).filter(name => name in packages);
  if (wanted.includes(COMPLETE)) { wanted = [COMPLETE]; }  // its index and shards cover the rest

  const shardIds = [];
  for (const name of wanted) {
    for (const id of packages[name].shards || []) {
      if (!shardIds.includes(id) && shards[id]) { shardIds.push(id); }
    }
  }
  for (const id of shardIds) {
    const shard = shards[id];
    const key = assetsKey(shard.assets);
    const onDisk = !shard.probe || probes.has(shard.probe);
    if ((state.shards || {})[id] === key && onDisk) {
      plan.keep.shards[id] = key;
    } else {
      plan.shards.push({id, key, assets: shard.assets || []});
    }
  }

  for (const name of wanted) {
    const index = packages[name].index;
    if (!index || !index.file) { continue; }
    const had = (state.indexes || {})[name];
    if (had && had.sha256 === index.sha256 && indexFiles.has(index.file)) {
      plan.keep.indexes[name] = had;
    } else {
      plan.indexes.push({name, asset: index});
    }
  }
  for (const [name, had] of Object.entries(state.indexes || {})) {
    if (!wanted.includes(name) && had && had.file) { plan.removeIndexes.push(had.file); }
  }

  const corrections = manifest.corrections;
  if (corrections && (wanted.length || present.anyBooks)) {
    if (state.corrections === corrections.sha256 && present.corrections) {
      plan.keep.corrections = state.corrections;
    } else {
      plan.corrections = corrections;
    }
  } else if (state.corrections && present.corrections) {
    plan.keep.corrections = state.corrections;
  }
  return plan;
}

async function exists(path) {
  try {
    return (await FileSystem.getInfoAsync(path)).exists;
  } catch (e) {
    return false;
  }
}

async function remove(path) {
  try {
    await FileSystem.deleteAsync(path, {idempotent: true});
  } catch (e) {
    // already gone
  }
}

async function listDir(path) {
  try {
    return await FileSystem.readDirectoryAsync(path);
  } catch (e) {
    return [];
  }
}

export async function loadPackState() {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

export async function fetchManifest(base = releasesBaseUrl()) {
  try {
    const response = await fetch(`${base}/manifest.json`, {cache: 'no-store'});
    if (!response.ok) { return null; }
    const manifest = await response.json();
    return manifest && manifest.format === MANIFEST_FORMAT ? manifest : null;
  } catch (e) {
    return null;  // offline, or the release is not published yet
  }
}

/** Download one release asset into the tmp folder; returns its path or null. */
async function downloadAsset(base, asset) {
  const dest = `${TMP_DIR}/${asset.name}`;
  try {
    await FileSystem.makeDirectoryAsync(TMP_DIR, {intermediates: true});
  } catch (e) {
    // exists
  }
  try {
    const result = await FileSystem.downloadAsync(`${base}/${encodeURIComponent(asset.name)}`, dest);
    if (!result || result.status < 200 || result.status >= 300) {
      await remove(dest);
      return null;
    }
    const info = await FileSystem.getInfoAsync(dest);
    if (!info.exists || (asset.size && typeof info.size === 'number' && info.size !== asset.size)) {
      await remove(dest);
      return null;
    }
    return dest;
  } catch (e) {
    await remove(dest);
    return null;
  }
}

/** Delete the search files of books the reader's content filter hides. */
export async function removeHiddenSearchFiles(isHidden) {
  if (!isHidden) { return 0; }
  let removed = 0;
  for (const name of await listDir(LIBRARY_DIR)) {
    if (!name.endsWith(SEARCH_SUFFIX)) { continue; }
    const title = name.slice(0, -SEARCH_SUFFIX.length);
    let hidden = false;
    try { hidden = isHidden(title); } catch (e) { hidden = false; }
    if (hidden) {
      await remove(`${LIBRARY_DIR}/${name}`);
      removed += 1;
    }
  }
  return removed;
}

async function presentOnDisk(manifest) {
  const names = new Set(await listDir(LIBRARY_DIR));
  const probes = new Set();
  for (const shard of Object.values((manifest.search && manifest.search.shards) || {})) {
    if (shard.probe && names.has(`${shard.probe}${SEARCH_SUFFIX}`)) { probes.add(shard.probe); }
  }
  const indexes = new Set([...names].filter(n => n.endsWith('_search.idx')));
  const corrections = (await listDir(CORRECTIONS_DIR)).length > 0;
  const anyBooks = [...names].some(n => n.endsWith('.zip'));
  return {probes, indexes, corrections, anyBooks};
}

let running = null;

/**
 * Bring the search packs and corrections in line with the chosen packages.
 * Returns {tag, downloaded: [...asset names], failed: [...]} or null (no release reachable).
 * Safe to call often: it only downloads what changed.
 */
export function syncPacks(selected, options = {}) {
  if (running) { return running; }
  running = _syncPacks(selected, options).finally(() => { running = null; });
  return running;
}

async function _syncPacks(selected, {isHidden = null, base = releasesBaseUrl()} = {}) {
  const manifest = await fetchManifest(base);
  if (!manifest) { return null; }
  const state = await loadPackState();
  const plan = planPacks(manifest, selected, state, await presentOnDisk(manifest));
  const assetBase = assetBaseUrl(base, manifest);
  const next = {
    tag: manifest.tag,
    shards: {...plan.keep.shards},
    indexes: {...plan.keep.indexes},
    corrections: plan.keep.corrections,
  };
  const downloaded = [];
  const failed = [];
  const save = () => AsyncStorage.setItem(STATE_KEY, JSON.stringify(next));

  // corrections first: small, and they matter for reading
  if (plan.corrections) {
    const file = await downloadAsset(assetBase, plan.corrections);
    if (file) {
      await remove(CORRECTIONS_DIR);  // (books no longer corrected lose their file)
      try {
        await unzip(file, LIBRARY_DIR);
        next.corrections = plan.corrections.sha256;
        downloaded.push(plan.corrections.name);
      } catch (e) {
        failed.push(plan.corrections.name);
      }
      await remove(file);
      clearCorrectionsCache();
    } else {
      failed.push(plan.corrections.name);
    }
    await save();
  }

  for (const file of plan.removeIndexes) {
    await remove(`${LIBRARY_DIR}/${file}`);
  }
  for (const {name, asset} of plan.indexes) {
    const file = await downloadAsset(assetBase, asset);
    if (!file) { failed.push(asset.name); continue; }
    try {
      await remove(`${LIBRARY_DIR}/${asset.file}`);
      await FileSystem.moveAsync({from: file, to: `${LIBRARY_DIR}/${asset.file}`});
      next.indexes[name] = {sha256: asset.sha256, file: asset.file};
      downloaded.push(asset.name);
    } catch (e) {
      failed.push(asset.name);
      await remove(file);
    }
  }
  await save();

  for (const shard of plan.shards) {
    let ok = true;
    // (a shard's zip and its search lines - about 2.3 times the zip - must fit, with room to spare:
    //  QA round 14, the search packs after the whole library filled the phone. Search falls back on
    //  Sefaria's online search for what is not on the phone.)
    const zipBytes = shard.assets.reduce((n, a) => n + (a.size || 0), 0);
    if (!(await hasRoom(SEARCH_UNZIP_FACTOR * zipBytes, LOW_SPACE_BYTES))) {
      shard.assets.forEach(a => failed.push(a.name));
      console.log('SoferBooks packs: no room for', shard.id || shard.assets.map(a => a.name).join(', '));
      continue;
    }
    for (const asset of shard.assets) {
      const file = await downloadAsset(assetBase, asset);
      if (!file) { ok = false; failed.push(asset.name); break; }
      try {
        await unzip(file, LIBRARY_DIR);
        downloaded.push(asset.name);
      } catch (e) {
        ok = false;
        failed.push(asset.name);
      }
      await remove(file);
      if (!ok) { break; }
    }
    if (ok) {
      next.shards[shard.id] = shard.key;
      await save();
    }
  }
  if (plan.shards.length) { await removeHiddenSearchFiles(isHidden); }
  await save();
  clearOfflineSearchCache();
  // the versions the release may not host: their search lines are made on the phone, from
  // its own Sefaria zips, in the background (localSearch.js)
  syncLocalSearch((manifest.search && manifest.search.local_titles) || [], {isHidden}).catch(() => {});
  return {tag: manifest.tag, downloaded, failed};
}
