// Library sources: where the app downloads its libraries from.
//
// Each source is a separate download the reader turns on in Settings. Only Sefaria works today;
// the others are registered so the Settings list can show them as "coming soon", and so adding
// one later means filling in its entry (and, if its layout differs, a loader) rather than
// threading new hosts through DownloadControl.
//
// Sefaria's layout (the one upstream Sefaria-Mobile's DownloadControl.js uses, schema 7):
//   {baseUrl}/static/ios-export/{schema}/{toc,search_toc,topic_toc,hebrew_categories,people,
//                                         packages,calendar,last_updated}.json
//   {baseUrl}/static/ios-export/{schema}/{Title}.zip                    one book
//   {baseUrl}/static/ios-export/{schema}/bundles/{Package}/{n}.zip      prebuilt package bundles
//   GET  {baseUrl}/packageData?package={Package}&schema_version={schema} -> ["static/.../1.zip", ...]
//   POST {baseUrl}/makeBundle?schema_version={schema}  {"books": [...]}
//        -> 202 while building, then {"bundleArray": ["static/..."], "downloadSize": n}
import Config from 'react-native-config';

export const SCHEMA_VERSION = '7';

export const SOURCES = [
  {
    id: 'sefaria',
    name: 'Sefaria',
    heName: 'ספריא',
    baseUrl: 'https://readonly.sefaria.org',
    layout: 'sefaria-mobile-v7',
    enabled: true,
    available: true,
  },
  { id: 'dicta', name: 'Dicta', heName: 'דיקטה', baseUrl: null, layout: null, enabled: false, available: false },
  { id: 'otzaria', name: 'Otzaria', heName: 'אוצריא', baseUrl: null, layout: null, enabled: false, available: false },
  { id: 'wikisource', name: 'Wikisource', heName: 'ויקיטקסט', baseUrl: null, layout: null, enabled: false, available: false },
  // planned: GitHub Releases of the SoferBooks project (SOFERBOOKS_RELEASES below)
  { id: 'soferbooks_extras', name: 'SoferBooks extras', heName: 'תוספות SoferBooks', baseUrl: null, layout: null, enabled: false, available: false },
];

/**
 * SoferBooks' own material for Sefaria's books - offline search packs and Sofer's text
 * corrections - published as one GitHub Release by tools/library-export/build_sefaria_packs.py
 * (see packs.js). THE ONE PLACE that names the repository
 * (github.com/soferbooks/soferbooks-library-data). ".../releases/latest/download" always serves the newest release's
 * manifest.json; the app then fetches that release's other files by its tag.
 * Developers can point it elsewhere (e.g. a folder served by tools/server/serve.py) with
 * SOFERBOOKS_RELEASES=http://127.0.0.1:5200/release in .env.
 */
export const SOFERBOOKS_RELEASES = 'https://github.com/soferbooks/soferbooks-library-data/releases/latest/download';

export function releasesBaseUrl() {
  const override = Config?.SOFERBOOKS_RELEASES;
  return String(override || SOFERBOOKS_RELEASES).replace(/\/+$/, '');
}

export const sourceById = id => SOURCES.find(s => s.id === id);

/**
 * Developer override for a source's server, e.g. the local export server from
 * tools/server/serve.py. Set in .env (read at build time by react-native-config):
 *   SEFARIA_DOWNLOAD_SERVER=http://127.0.0.1:5200   (USB device: `adb reverse tcp:5200 tcp:5200`;
 *                                                    Android emulator: http://10.0.2.2:5200)
 */
const DEV_OVERRIDES = {
  sefaria: () => Config?.SEFARIA_DOWNLOAD_SERVER,
};

export function serverFor(id) {
  const override = DEV_OVERRIDES[id] && DEV_OVERRIDES[id]();
  if (override) { return String(override).replace(/\/+$/, ''); }
  const source = sourceById(id);
  return source ? source.baseUrl : null;
}

// Where a Sefaria-layout source keeps its export files
export const exportPathFor = (id, schema = SCHEMA_VERSION) => `${serverFor(id)}/static/ios-export/${schema}`;
