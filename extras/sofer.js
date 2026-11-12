/**
 * The Sofer Library (ספריית סופר) as an extra source: the books only Sofer has.
 *
 * Owner's decision (2026-11-11): SoferBooks hosts ONLY the books the app cannot get from
 * their own source (every other book still comes from its source's server): the books Sofer
 * splits out of a Sefaria book (Ben Ish Hai's Derashos and Halachos, the Tur and its
 * commentaries in parts, Shaar HaBitachon), the Ben-Yehuda collections, Rabbi Eliezer
 * Ben-David's sefarim, Sofer's combined editions, and the like - and two Wikisource books
 * Sofer makes into other books than the site's page, which extras/wikisource.js does not
 * convert (kind "wikisource", 2026-11-12): Megillat Antiochus in Rabbi Menashe Zelicha's
 * edition with its Targum ("(מהדורת הרב מנשה זליכה)" in its Hebrew name, so it stays beside
 * Sefaria's "מגילת אנטיוכוס"), and Chashukei Chemed on each masechta, by amud ("... 2a").
 *
 * Where it comes from: one GitHub Release of github.com/soferbooks/soferbooks-library-data,
 * made by tools/library-export/build_sofer_library.py:
 *   catalogue  <release>/sofer-library-catalog.json   each book: title, heTitle, kind, its shelf
 *              (Sofer's catalog.shelf_of), licences, file, size, sha256, md5, firstSection, and
 *              the editors' notes book that comes with it (companions)
 *   one book   <release>/<file>   the book's schema-7 files, zipped (export_v7.py: Sofer's
 *              corrections in, only editions whose licence allows giving them out)
 * The books come ready made, so nothing is converted: they are unzipped, their editions marked
 * as this library's (librarySource: "Report an error" goes to SoferBooks) and put in the library
 * as every extra book is (extras/index.js: convert).
 */
import * as FileSystem from 'expo-file-system/legacy';
import {unzip} from 'react-native-zip-archive';
import md5 from 'md5';
import {safe} from './tree';

export const ID = 'sofer_library';
export const REPO = 'soferbooks/soferbooks-library-data';
// THE ONE LINE a new release of the Sofer Library changes (made with --latest=false: the
// repository's "latest" release is the Sefaria search packs' one, packs.js)
export const RELEASE_TAG = 'sofer-library-2026-11-11b';
export const RELEASE_URL = `https://github.com/${REPO}/releases/download/${RELEASE_TAG}`;
export const CATALOG_NAME = 'sofer-library-catalog.json';
export const CATALOG_URL = `${RELEASE_URL}/${CATALOG_NAME}`;
export const CATALOG_FORMAT = 1;
export const HOME_URL = `https://github.com/${REPO}`;
// (a book of an older release is downloaded again as an update when its sha256 changes; this
//  only when what the phone does with the files changes)
export const CONVERTER_VERSION = 1;

/** One book of the catalogue as a catalogue entry (null: not usable) */
export function entryFor(b) {
  if (!b || !b.title || !b.heTitle || !b.file || !Array.isArray(b.categories) || !b.categories.length) { return null; }
  // (the book's files name it by its title: a title the library would change cannot be used)
  if (safe(b.title) !== b.title) { return null; }
  const entry = {
    source: ID,
    id: b.title,
    hash: b.sha256 || null,
    title: b.title,
    heTitle: b.heTitle,
    categories: b.categories,
    heCategories: b.heCategories || [],
    kind: b.kind || 'sofer',
    license: (b.license || []).join(' / '),
    file: b.file,
    size: b.size || 0,
    md5: b.md5 || null,
    firstSection: b.firstSection || b.title,
  };
  if (b.dependence) { entry.dependence = b.dependence; }
  if (b.base_text_titles) { entry.base_text_titles = b.base_text_titles; }
  const companions = (b.companions || []).map(entryFor).filter(Boolean);
  if (companions.length) { entry.companions = companions; }
  return entry;
}

/** sofer-library-catalog.json -> the catalogue's entries */
export function parseCatalog(text) {
  const catalog = typeof text === 'string' ? JSON.parse(text) : text;
  if (!catalog || catalog.format !== CATALOG_FORMAT || !Array.isArray(catalog.books)) {
    throw new Error('sofer library: not a catalogue this app reads');
  }
  return catalog.books.map(entryFor).filter(Boolean);
}

export const fileUrl = file => `${RELEASE_URL}/${encodeURIComponent(file)}`;
export const bookUrl = entry => fileUrl(entry.file);

/** The zip at url saved at path; share(0..1) as it comes; stopped by job's Cancel */
async function download(url, path, job, share) {
  if (!FileSystem.createDownloadResumable) { return FileSystem.downloadAsync(url, path); }
  const transfer = FileSystem.createDownloadResumable(url, path, {}, p => {
    if (share && p.totalBytesExpectedToWrite > 0) { share(Math.min(1, p.totalBytesWritten / p.totalBytesExpectedToWrite)); }
  });
  if (job) { job.onCancel(() => { transfer.cancelAsync().catch(() => {}); }); }
  const res = await transfer.downloadAsync();
  if (job) { job.check(); }
  if (!res) { throw new Error(`sofer library: the download of ${url} stopped`); }
  return res;
}

/**
 * One book's zip: downloaded, checked (md5), unzipped and read -> {file name: its JSON}.
 * entry: {title, file, md5}; url: where it is (this release's, or another's: extras/wikisource.js)
 */
export async function bookZipFiles(entry, {job = null, share = null, url = bookUrl(entry)} = {}) {
  const dir = `${FileSystem.cacheDirectory}extras/`;
  const base = `${dir}sofer-${md5(entry.file)}`;
  const zipPath = `${base}.zip`;
  const filesDir = `${base}/`;
  await FileSystem.makeDirectoryAsync(dir, {intermediates: true}).catch(() => {});
  try {
    const res = await download(url, zipPath, job, share);
    if (res.status < 200 || res.status >= 300) { throw new Error(`sofer library: HTTP ${res.status} for ${url}`); }
    if (entry.md5) {
      const info = await FileSystem.getInfoAsync(zipPath, {md5: true});
      if (info && info.md5 && info.md5 !== entry.md5) { throw new Error(`sofer library: ${entry.title} did not arrive whole`); }
    }
    if (share) { share(1); }
    await FileSystem.makeDirectoryAsync(filesDir, {intermediates: true}).catch(() => {});
    await unzip(zipPath, filesDir);
    const files = {};
    for (const name of (await FileSystem.readDirectoryAsync(filesDir)).filter(n => n.endsWith('.json'))) {
      files[name] = JSON.parse(await FileSystem.readAsStringAsync(`${filesDir}${name}`));
    }
    if (!files[`${entry.title}_index.json`]) { throw new Error(`sofer library: ${entry.title} has no index`); }
    return files;
  } finally {
    await FileSystem.deleteAsync(zipPath, {idempotent: true}).catch(() => {});
    await FileSystem.deleteAsync(filesDir, {idempotent: true}).catch(() => {});
  }
}

/** The book and the books that come with it (its editors' notes), each zip a share of the whole by size */
export async function fetchBook(entry, job = null) {
  const all = [entry, ...(entry.companions || [])];
  const total = all.reduce((n, e) => n + (e.size || 1), 0);
  let before = 0;
  const out = [];
  if (job) { job.progress(0, 100, 'percent'); }
  for (const e of all) {
    const start = before;
    const share = f => { if (job) { job.progress(Math.round((100 * (start + f * (e.size || 1))) / total), 100, 'percent'); } };
    out.push({entry: e, files: await bookZipFiles(e, {job, share})});
    before += e.size || 1;
    if (job) { job.check(); }
  }
  return {book: out[0], companions: out.slice(1)};
}

/** The book's editions marked as this library's (its error reports go to SoferBooks) */
export function withSource(files, title) {
  const name = `${title}_index.json`;
  const index = files[name];
  if (!index) { return files; }
  return {
    ...files,
    [name]: {...index, librarySource: ID, versions: (index.versions || []).map(v => ({...v, librarySource: ID}))},
  };
}

/** What extras/index.js puts in the library: the files as they came (nothing to convert) */
export function convert(entry, doc) {
  return {
    files: withSource(doc.book.files, entry.title),
    firstSection: entry.firstSection || entry.title,
    companions: (doc.companions || []).map(c => ({
      entry: {title: c.entry.title, heTitle: c.entry.heTitle, categories: c.entry.categories,
        heCategories: c.entry.heCategories, ...(c.entry.dependence ? {dependence: c.entry.dependence} : {}),
        ...(c.entry.base_text_titles ? {base_text_titles: c.entry.base_text_titles} : {})},
      files: withSource(c.files, c.entry.title),
      firstSection: c.entry.firstSection || c.entry.title,
    })),
  };
}

export function versionOf(entry) {
  return {versionTitle: 'Sofer Library', versionSource: HOME_URL, license: entry.license, librarySource: ID};
}

export default {
  id: ID,
  converterVersion: CONVERTER_VERSION,
  catalogUrl: CATALOG_URL,
  parseCatalog,
  bookUrl,
  fetchBook,
  convert,
  // (never called: convert takes the place of the conversion)
  toTree: () => { throw new Error('sofer library: its books come ready made'); },
  // (the licences are checked when the release is built: build_sofer_library.py)
  isRestricted: () => false,
  versionOf,
};
