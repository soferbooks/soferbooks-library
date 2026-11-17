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
 * made by Sofer's scripts/library_app/build_sofer_library.py:
 *   catalogue  <release>/sofer-library-catalog.json   each book: title, heTitle, kind, its shelf
 *              (Sofer's catalog.shelf_of), licences, file, size, sha256, md5, firstSection, and
 *              the editors' notes book that comes with it (companions)
 *   one book   <release>/<file>   the book's schema-7 files, zipped (export_v7.py: Sofer's
 *              corrections in, only editions whose licence allows giving them out)
 * The books come ready made, so nothing is converted: they are unzipped, their editions marked
 * as this library's (librarySource: "Report an error" goes to SoferBooks) and put in the library
 * as every extra book is (extras/index.js: convert). Their own connections (the links in their
 * sections' metadata: each piece of Chashukei Chemed on its Gemara line) are kept with the other
 * extra books' (linksOf, extras/links.js), so they show on the other end too - under the Gemara's
 * passage, in its Commentary and "Under each passage".
 */
import * as FileSystem from 'expo-file-system/legacy';
import {safeUnzip as unzip, WORK_DIR} from '../storage';
import {withRetry, mapLimit, CONCURRENCY} from '../downloadPool';
import md5 from 'md5';
import {safe} from './tree';

export const ID = 'sofer_library';
export const REPO = 'soferbooks/soferbooks-library-data';
// THE ONE LINE a new release of the Sofer Library changes (made with --latest=false: the
// repository's "latest" release is the Sefaria search packs' one, packs.js)
export const RELEASE_TAG = 'sofer-library-2026-11-17';
export const RELEASE_URL = `https://github.com/${REPO}/releases/download/${RELEASE_TAG}`;
export const CATALOG_NAME = 'sofer-library-catalog.json';
export const CATALOG_URL = `${RELEASE_URL}/${CATALOG_NAME}`;
export const CATALOG_FORMAT = 1;
export const HOME_URL = `https://github.com/${REPO}`;
// (a book of an older release is downloaded again as an update when its sha256 changes; this
//  only when what the phone does with the files changes)
export const CONVERTER_VERSION = 1;

const SEPARATED_TUR = /^(?:Tur|Beit Yosef|Bach|Darkhei Moshe|Drisha|Prisha), (?:Orach Chayim|Yoreh De'ah|Even HaEzer|Choshen Mishpat)$/i;
const SEPARATED_SPLIT = /^(?:Ben Ish Hai (?:Drashot|Halachot)|Shaar HaBitachon|.*, Gate of Trust)$/i;

/** One book of the catalogue as a catalogue entry (null: not usable) */
export function entryFor(b) {
  if (!b || !b.title || !b.heTitle || !b.file || !Array.isArray(b.categories) || !b.categories.length) { return null; }
  if (b.kind === 'combined' || b.kind === 'split' || /\(Combined editions\)$/i.test(b.title) || /\(מהדורות משולבות\)$/.test(b.heTitle)) {
    return null;
  }
  if (SEPARATED_TUR.test(b.title) || SEPARATED_SPLIT.test(b.title)) {
    return null;
  }
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
  // its English name (English interfaces show it) and its other names (a title search finds the
  // book by them: "Return to Your Homes" -> Shuvu Lachem LeOhaleichem, whose English edition it is)
  if (typeof b.enTitle === 'string' && b.enTitle) { entry.enTitle = b.enTitle; }
  const names = list => (Array.isArray(list) ? list.filter(n => typeof n === 'string' && n) : []);
  if (names(b.titleVariants).length) { entry.titleVariants = names(b.titleVariants); }
  if (names(b.heTitleVariants).length) { entry.heTitleVariants = names(b.heTitleVariants); }
  // the zips of earlier releases whose text is this one's (only the sections' metadata changed:
  // prev/next, names, Hebrew refs - which the reader works out itself): a phone that has one is
  // not sent the book again (extras/index.js booksToUpdate)
  if (names(b.sameTextAs).length) { entry.sameTextAs = names(b.sameTextAs); }
  const companions = (b.companions || []).map(entryFor).filter(Boolean);
  if (companions.length) { entry.companions = companions; }
  return entry;
}

let lastBundle = null;

/** sofer-library-catalog.json -> the catalogue's entries */
export function parseCatalog(text) {
  const catalog = typeof text === 'string' ? JSON.parse(text) : text;
  if (!catalog || catalog.format !== CATALOG_FORMAT || !Array.isArray(catalog.books)) {
    throw new Error('sofer library: not a catalogue this app reads');
  }
  lastBundle = catalog.bundle && catalog.bundle.file ? catalog.bundle : null;
  return catalog.books.map(entryFor).filter(Boolean);
}

export async function hostedBundle(fetchFn = (...a) => fetch(...a)) {
  if (lastBundle) { return lastBundle; }
  try {
    const res = await fetchFn(CATALOG_URL);
    if (!res || !res.ok) { return null; }
    parseCatalog(await res.json());
    return lastBundle;
  } catch (e) {
    return null;
  }
}

export const _resetBundleCache = () => { lastBundle = null; };

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

export async function readZipFiles(zipPath, title, expectedMd5 = null) {
  if (expectedMd5) {
    const info = await FileSystem.getInfoAsync(zipPath, {md5: true});
    if (info && info.md5 && info.md5 !== expectedMd5) { throw new Error(`sofer library: ${title} did not arrive whole`); }
  }
  const filesDir = `${WORK_DIR}extras/sofer-${md5(`${zipPath}|${title}`)}/`;
  await FileSystem.makeDirectoryAsync(filesDir, {intermediates: true}).catch(() => {});
  try {
    await unzip(zipPath, filesDir);
    const files = {};
    for (const name of (await FileSystem.readDirectoryAsync(filesDir)).filter(n => n.endsWith('.json'))) {
      files[name] = JSON.parse(await FileSystem.readAsStringAsync(`${filesDir}${name}`));
    }
    if (!files[`${title}_index.json`]) { throw new Error(`sofer library: ${title} has no index`); }
    return files;
  } finally {
    await FileSystem.deleteAsync(filesDir, {idempotent: true}).catch(() => {});
  }
}

export async function downloadBundleArchive(url, expectedMd5 = null, {isCancelled = () => false} = {}) {
  const dir = `${WORK_DIR}extras/`;
  const base = `${dir}bundle-${md5(url)}`;
  const zipPath = `${base}.zip`;
  const outDir = `${base}/`;
  await FileSystem.makeDirectoryAsync(dir, {intermediates: true}).catch(() => {});
  await FileSystem.deleteAsync(outDir, {idempotent: true}).catch(() => {});
  try {
    const res = await withRetry(async () => {
      if (isCancelled()) { throw new Error('cancelled'); }
      const r = await download(url, zipPath, null, null);
      if (r.status >= 500) { throw new Error(`bundle: HTTP ${r.status} for ${url}`); }
      return r;
    }, {shouldRetry: e => !isCancelled()});
    if (res.status < 200 || res.status >= 300) { throw new Error(`bundle: HTTP ${res.status} for ${url}`); }
    if (expectedMd5) {
      const info = await FileSystem.getInfoAsync(zipPath, {md5: true});
      if (info && info.md5 && info.md5 !== expectedMd5) { throw new Error(`bundle ${url} did not arrive whole`); }
    }
    await FileSystem.makeDirectoryAsync(outDir, {intermediates: true}).catch(() => {});
    await unzip(zipPath, outDir);
    return {
      dir: outDir,
      cleanup: () => FileSystem.deleteAsync(outDir, {idempotent: true}).catch(() => {}),
    };
  } finally {
    await FileSystem.deleteAsync(zipPath, {idempotent: true}).catch(() => {});
  }
}

export async function fetchBundleDocs(entries, {onBook, isCancelled = () => false} = {}) {
  const bundle = await hostedBundle();
  if (!bundle || !bundle.file || !entries.length) { return false; }
  let unpacked;
  try {
    unpacked = await downloadBundleArchive(fileUrl(bundle.file), bundle.md5 || null, {isCancelled});
  } catch (e) {
    console.log('sofer library: bundle fallback to per-book downloads:', e && e.message);
    return false;
  }
  try {
    for (const entry of entries) {
      if (isCancelled()) { break; }
      try {
        const mainFiles = await readZipFiles(`${unpacked.dir}${entry.file}`, entry.title, entry.md5 || null);
        const companions = [];
        for (const c of entry.companions || []) {
          companions.push({entry: c, files: await readZipFiles(`${unpacked.dir}${c.file}`, c.title, c.md5 || null)});
        }
        await onBook(entry, {book: {entry, files: mainFiles}, companions});
      } catch (e) {
        console.log('sofer library: bundle entry skipped for', entry.title, e && e.message);
      }
    }
    return true;
  } finally {
    await unpacked.cleanup();
  }
}

/**
 * One book's zip: downloaded, checked (md5), unzipped and read -> {file name: its JSON}.
 * entry: {title, file, md5}; url: where it is (this release's, or another's: extras/wikisource.js)
 */
export async function bookZipFiles(entry, {job = null, share = null, url = bookUrl(entry)} = {}) {
  const dir = `${WORK_DIR}extras/`;   // (not the cache folder, which Android empties when space runs low)
  const base = `${dir}sofer-${md5(entry.file)}`;
  const zipPath = `${base}.zip`;
  await FileSystem.makeDirectoryAsync(dir, {intermediates: true}).catch(() => {});
  try {
    // (a dropped connection or a server error is tried again; a missing file or a cancel is not)
    const res = await withRetry(async () => {
      if (job) { job.check(); }
      const r = await download(url, zipPath, job, share);
      if (r.status >= 500) { throw new Error(`sofer library: HTTP ${r.status} for ${url}`); }
      return r;
    }, {shouldRetry: e => !(job && job.cancelled) && !(e && e.name === 'DownloadCancelledError')});
    if (res.status < 200 || res.status >= 300) { throw new Error(`sofer library: HTTP ${res.status} for ${url}`); }
    if (share) { share(1); }
    return await readZipFiles(zipPath, entry.title, entry.md5 || null);
  } finally {
    await FileSystem.deleteAsync(zipPath, {idempotent: true}).catch(() => {});
  }
}

/**
 * The book and the books that come with it (its editors' notes), several zips at once
 * (downloadPool.js), each a share of the whole by size
 */
export async function fetchBook(entry, job = null) {
  const all = [entry, ...(entry.companions || [])];
  const total = all.reduce((n, e) => n + (e.size || 1), 0);
  const got = all.map(() => 0);
  if (job) { job.progress(0, 100, 'percent'); }
  const out = await mapLimit(all, CONCURRENCY.files, async (e, i) => {
    const share = f => {
      got[i] = f * (e.size || 1);
      if (job) { job.progress(Math.round((100 * got.reduce((a, b) => a + b, 0)) / total), 100, 'percent'); }
    };
    if (job) { job.check(); }
    return {entry: e, files: await bookZipFiles(e, {job, share})};
  });
  if (job) { job.check(); }
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

/**
 * The book's own connections, as its files give them (export: each section's metadata, a list of
 * links for each passage - build_sofer_library.py puts there the links Sofer's library has: each
 * piece of Chashukei Chemed tied to its Gemara line, 2026-11-12) -> extras/links.js's links
 * [{a, ah, t, th, r}]: 'base' (the passage explains the other end) when the other end is in a book
 * it is on (base_text_titles), else 'cite'.
 */
export function ownLinks(entry, files) {
  const bases = (entry.base_text_titles || []).map(b => (typeof b === 'string' ? b : b && b.en)).filter(Boolean);
  const out = [];
  const metaSections = [];
  for (const [name, doc] of Object.entries(files || {})) {
    if (!name.endsWith('.metadata.json') || !doc) { continue; }
    const list = doc.sections ? Object.values(doc.sections) : [doc];
    for (const meta of list) {
      if (!meta || !meta.ref) { continue; }
      metaSections.push(meta);
      if (!Array.isArray(meta.links)) { continue; }
      meta.links.forEach((seg, j) => {
        for (const l of seg || []) {
          if (!l || !l.sourceRef) { continue; }
          const t = String(l.sourceRef);
          out.push({a: `${meta.ref}:${j + 1}`, ah: `${meta.heRef || meta.ref} ${j + 1}`, t, th: l.sourceHeRef || t,
            r: bases.some(b => t.startsWith(`${b} `) || t.startsWith(`${b},`)) ? 'base' : 'cite'});
        }
      });
    }
  }
  // Some Sofer Library commentaries (e.g. Rabbi Eliezer Ben-David's sefarim on Shir HaShirim & Mishlei)
  // were exported with empty links_index ({}): derive their base-verse links from their section structure.
  if (!out.length && (entry.dependence === 'Commentary' || entry.dependence === 'Targum') && bases.length) {
    const base = bases[0];
    const prefix = `${entry.title} `;
    const metaByRef = new Map(metaSections.map(m => [m.ref, m]));
    const segsByRef = new Map();
    for (const [name, doc] of Object.entries(files || {})) {
      if (!name.endsWith('.json') || name.endsWith('.metadata.json') || name.endsWith('_index.json') || !doc) { continue; }
      if (doc.sections && typeof doc.sections === 'object') {
        for (const [sRef, sData] of Object.entries(doc.sections)) {
          if (!segsByRef.has(sRef) && Array.isArray(sData)) { segsByRef.set(sRef, sData); }
        }
      } else if (Array.isArray(doc) || Array.isArray(doc.content)) {
        const stem = name.replace(/\.[0-9a-f]+\.(?:he|en)\.json$/, '').replace(/\.(?:he|en)\.json$/, '');
        const segs = Array.isArray(doc) ? doc : doc.content;
        if (stem && !segsByRef.has(stem)) { segsByRef.set(stem, segs); }
      }
    }
    for (const [sRef, segs] of segsByRef.entries()) {
      if (!sRef.startsWith(prefix)) { continue; }
      const coord = sRef.slice(prefix.length).trim();
      const meta = metaByRef.get(sRef);
      const heSec = (meta && meta.heRef) || sRef;
      const isDepth3 = coord.includes(':');
      segs.forEach((seg, j) => {
        const hasText = typeof seg === 'string' ? seg.trim().length > 0 : !!(seg && (seg.he || seg.text));
        if (!hasText) { return; }
        const target = isDepth3 ? `${base} ${coord}` : `${base} ${coord}:${j + 1}`;
        out.push({a: `${sRef}:${j + 1}`, ah: `${heSec}:${j + 1}`, t: target, th: '', r: 'base'});
      });
    }
  }
  return out;
}

/** Where the book's connections are (extras/index.js collectLinks): its own files */
export function linksOf(entry, doc) {
  const links = doc && doc.book ? ownLinks(entry, doc.book.files) : [];
  return links.length ? {ownLinks: links} : {};
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
  fetchBundleDocs,
  convert,
  // (never called: convert takes the place of the conversion)
  toTree: () => { throw new Error('sofer library: its books come ready made'); },
  // (the licences are checked when the release is built: build_sofer_library.py)
  isRestricted: () => false,
  versionOf,
  linksOf,
};
