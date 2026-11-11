// "Report a mistake": where a correction for the text on screen is sent.
//
// The routing is one table, by the library the text came from (sources.js ids). A source with
// its own corrections address gets the report; any other goes to SoferBooks, which passes it on.
//
// Which library a text came from is read from its version's metadata: `librarySource` (the
// sources.js id the loader stamps on versions it downloads). It is NOT guessed from
// `versionSource`: Sefaria's own copies of texts cite where Sefaria got them (he.wikisource.org,
// Dicta...), and an error in Sefaria's copy is fixed by Sefaria. Until another library can be
// downloaded, every version without `librarySource` is Sefaria's.

export const FALLBACK_EMAIL = 'corrections@soferbooks.com';

export const CORRECTIONS = {
  // as Sefaria's own app does (Sefaria-Mobile ReaderApp.reportError)
  sefaria: { name: 'Sefaria', email: 'corrections@sefaria.org', subject: 'Sefaria Text Correction' },
  // no dedicated corrections address found (2026-11); general feedback: dicta@dicta.org.il
  dicta: { name: 'Dicta', email: null },
  // no dedicated corrections address found (2026-11); general support: otzaria.1@gmail.com,
  // or issues at github.com/otzaria/otzaria
  otzaria: { name: 'Otzaria', email: null },
  // a wiki: corrections are made on the page itself; no email
  wikisource: { name: 'Wikisource', email: null },
  // the Sofer Library (extras/sofer.js): SoferBooks' own copies
  sofer_library: { name: 'Sofer Library', email: FALLBACK_EMAIL },
};

export const sourceOfVersion = version => (version && version.librarySource) || 'sefaria';

/**
 * The version the reader is looking at: the Hebrew one unless only English is shown.
 * @param {{en: object|null, he: object|null}} currVersionObjects
 * @param {string} textLanguage  "hebrew" | "english" | "bilingual"
 */
export function versionOnScreen(currVersionObjects, textLanguage) {
  const { en, he } = currVersionObjects || {};
  return textLanguage === 'english' ? (en || he || null) : (he || en || null);
}

/**
 * The email for a correction: {to, subject, body, source}.
 * @param {object} p
 * @param {string} p.ref         the segment ref
 * @param {string} p.text        the displayed text (with its URL)
 * @param {object|null} p.version  the version on screen (versionOnScreen)
 * @param {string} p.platform    Platform.OS
 */
export function correctionEmail({ ref, text, version, platform }) {
  const source = sourceOfVersion(version);
  const entry = CORRECTIONS[source] || { name: source, email: null };
  const to = entry.email || FALLBACK_EMAIL;
  const subject = `${entry.subject || `Text Correction (${entry.name})`} from SoferBooks Library (${platform})`;
  const versionLine = version && version.versionTitle
    ? `\n\nVersion: ${version.versionTitle}${version.versionSource ? ` (${version.versionSource})` : ''}` : '';
  const body = `${ref}\n\n${text}${versionLine}\n\nDescribe the error:`;
  return { to, subject, body, source };
}
