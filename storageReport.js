/**
 * Where the app's storage goes: written to the device log once a session (a minute after start),
 * so a phone's space can be looked at with `adb logcat | grep "Storage report"` without making
 * a debuggable build. Read-only; never throws.
 *
 *   top level of the app's files (library, local_search, work, the loose unzipped files ...)
 *   library/: its .zip books, search files (_search.txt), corrections, _extras (by subfolder)
 */
import * as FileSystem from 'expo-file-system/legacy';

const MB = n => Math.round((n || 0) / 1e5) / 10;

async function sizeOf(uri) {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    return (info && info.exists && info.size) || 0;
  } catch (e) {
    return 0;
  }
}

async function list(uri) {
  try { return await FileSystem.readDirectoryAsync(uri); } catch (e) { return []; }
}

/** {name: MB} of the entries of a folder, grouped by `group(name, isDir)` */
async function grouped(dir, group) {
  const out = {};
  const count = {};
  for (const name of await list(dir)) {
    const uri = `${dir}${name}`;
    const info = await FileSystem.getInfoAsync(uri, { size: true }).catch(() => null);
    if (!info || !info.exists) { continue; }
    const key = group(name, !!info.isDirectory);
    out[key] = (out[key] || 0) + (info.size || 0);
    count[key] = (count[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, `${MB(v)} MB (${count[k]})`]));
}

export async function storageReport() {
  const root = FileSystem.documentDirectory;
  const top = await grouped(root, (name, isDir) => (isDir ? `${name}/` : name.endsWith('.json') ? '(loose unzipped .json)' : '(other loose files)'));
  console.log('Storage report: app files', JSON.stringify(top));
  const lib = await grouped(`${root}library/`, (name, isDir) => (isDir ? `${name}/`
    : name.endsWith('_search.txt') ? '*_search.txt' : name.endsWith('.zip') ? '*.zip' : '(other)'));
  console.log('Storage report: library/', JSON.stringify(lib));
  // the search files: the extra sources' books (made on the phone) and Sefaria's (the SoferBooks pack)
  try {
    const ex = require('./extras');
    await ex.loadExtras();
    const bySource = await grouped(`${root}library/`, name => {
      if (!name.endsWith('_search.txt')) { return 'not search'; }
      const t = name.slice(0, -'_search.txt'.length);
      const b = ex.isExtraTitle(t) ? ex.extraBook(t) : null;
      return b ? `search: ${b.via || b.source}${b.source === 'dicta' && /nikud|ניקוד/i.test(JSON.stringify(b)) ? ' (nikud)' : ''}` : 'search: Sefaria';
    });
    console.log('Storage report: search by source', JSON.stringify(bySource));
  } catch (e) { console.log('Storage report: search split failed', String(e)); }
  const extras = await grouped(`${root}library/_extras/`, (name, isDir) => (isDir ? `${name}/` : name.replace(/^.*\./, '*.')));
  console.log('Storage report: library/_extras/', JSON.stringify(extras));
  console.log('Storage report: work/', MB(await sizeOf(`${root}work/`)), 'MB; local_search/', MB(await sizeOf(`${root}local_search/`)), 'MB');
}

let started = false;
/** Once a session, `delay` ms after start (the app's own start work first) */
export function scheduleStorageReport(delay = 60000) {
  if (started) { return; }
  started = true;
  setTimeout(() => { storageReport().catch(e => console.log('Storage report failed', e)); }, delay);
}
