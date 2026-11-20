/**
 * Pninim (פנינים, pninim.org) as an extra library: the books Pninim publishes that no other source
 * gives (the owner, 2026-11-20: "add the pnimim library that we just added to the site") - Birkei
 * Yosef, Midrash Talpiot, Artzot HaChaim, Asifat Zekenim, Ezra LeHavin, Tzeidah LaDerekh, with
 * their editors' notes. (Pninim's other books reach the app through Otzaria: "Otzaria (Pninim)".)
 *
 * Hosted as the Sofer Library is (extras/sofer.js, whose code this uses): one GitHub Release of
 * github.com/soferbooks/soferbooks-library-data made by tools/pninim/build_pninim_release.py from
 * the website's own import (Sofer's pninim_import.py) - each book's schema-7 zip, all of them in
 * pninim-all.zip, and pninim-catalog.json (the Sofer Library's catalogue format).
 *
 * Their licence (GNU FDL 1.3 with Invariant Sections "פרויקט פנינים" and "הקדשות") asks that their
 * notice go with the text: each edition carries it (versionNotesInHebrew, shown under the edition
 * in the book's contents). Errors go to Pninim (reportError.js: contact@pninim.org, as they ask).
 */
import * as sofer from './sofer';

export const ID = 'pninim';
// THE ONE LINE a new release of the Pninim library changes (made with --latest=false)
export const RELEASE_TAG = 'pninim-2026-11-20';
export const RELEASE_URL = `https://github.com/${sofer.REPO}/releases/download/${RELEASE_TAG}`;
export const CATALOG_URL = `${RELEASE_URL}/pninim-catalog.json`;
export const HOME_URL = 'https://pninim.org';
export const LICENSE = 'GFDL 1.3';
export const CONVERTER_VERSION = 1;

let lastBundle = null;

/** pninim-catalog.json -> the catalogue's entries (the Sofer Library's format, this library's) */
export function parseCatalog(text) {
  const catalog = typeof text === 'string' ? JSON.parse(text) : text;
  if (!catalog || catalog.format !== sofer.CATALOG_FORMAT || !Array.isArray(catalog.books)) {
    throw new Error('pninim: not a catalogue this app reads');
  }
  lastBundle = catalog.bundle && catalog.bundle.file ? catalog.bundle : null;
  const ours = e => ({...e, source: ID, license: LICENSE,
    ...(e.companions ? {companions: e.companions.map(c => ({...c, source: ID, license: LICENSE}))} : {})});
  return catalog.books.map(sofer.entryFor).filter(Boolean).map(ours);
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

/** What each edition carries: their name, site, licence and notice */
export const editionOf = entry => ({
  versionTitle: 'Pninim', versionTitleInHebrew: 'פנינים', versionSource: HOME_URL, license: LICENSE,
  ...(entry.versionNotesInHebrew ? {versionNotesInHebrew: entry.versionNotesInHebrew} : {}),
});

export const versionOf = entry => ({...editionOf(entry), librarySource: ID});

export default {
  id: ID,
  converterVersion: CONVERTER_VERSION,
  catalogUrl: CATALOG_URL,
  parseCatalog,
  bookUrl,
  fetchBook: (entry, job) => sofer.fetchBook(entry, job, bookUrl),
  fetchBundleDocs: (entries, opts = {}) => sofer.fetchBundleDocs(entries, {...opts, bundleOf: hostedBundle, urlOf: fileUrl}),
  convert: (entry, doc) => sofer.convert(entry, doc, ID, editionOf),
  // (ready made: convert)
  toTree: () => [null, ''],
  // (the licence is checked when the release is built: GFDL, free)
  isRestricted: () => false,
  versionOf,
  linksOf: sofer.linksOf,
};
