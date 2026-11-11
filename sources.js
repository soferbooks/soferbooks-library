// Library sources: where the app downloads its libraries from.
//
// Sefaria is always on (read online, downloaded for offline use in Settings). The extra sources
// (`extra: true`, extras/index.js) are turned on one by one in Settings; their books come from
// the source's own server, one book at a time. The rest are registered so the Settings list can
// show them as "coming soon" (none now).
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
  { id: 'dicta', name: 'Dicta', heName: 'דיקטה', baseUrl: 'https://files.dicta.org.il', layout: 'extra', enabled: false, available: true, extra: true },
  // Extra sources (extras/): the reader turns each on in Settings; its books are listed in the
  // library and each is downloaded from the source's own server when opened, then converted on
  // the phone (layout 'extra': the source's module in extras/ does the work)
  {
    id: 'otzaria', name: 'Otzaria', heName: 'אוצריא',
    baseUrl: 'https://raw.githubusercontent.com/Otzaria/otzaria-library/main', layout: 'extra',
    enabled: false, available: true, extra: true,
  },
  { id: 'wikisource', name: 'Wikisource', heName: 'ויקיטקסט', baseUrl: 'https://he.wikisource.org', layout: 'extra', enabled: false, available: true, extra: true },
  // the books only Sofer has (his splits, Ben-Yehuda, Rabbi Ben-David's sefarim, combined editions),
  // hosted by SoferBooks as one GitHub Release: extras/sofer.js (RELEASE_TAG: the one line a new
  // release changes)
  {
    id: 'sofer_library', name: 'Sofer Library', heName: 'ספריית סופר',
    baseUrl: 'https://github.com/soferbooks/soferbooks-library-data', layout: 'extra',
    enabled: false, available: true, extra: true,
  },
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
