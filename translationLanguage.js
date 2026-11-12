/**
 * Which language a translation is really in.
 *
 * Sefaria files every non-Hebrew version under language 'en' (German, French, Portuguese ...);
 * the real language is in `actualLanguage`, and the title carries it as a suffix
 * ("Mischnajot mit deutscher Übersetzung ... [de]"). The reader's English line is chosen
 * automatically only from versions that really are English: when there is none (or every one
 * is hidden by the content filter), it shows no translation rather than another language.
 * Other languages stay available from the versions / translations menu, picked explicitly.
 */

const SUFFIX = /\[([a-z]{2,3})\]\s*$/i;

// The ISO code of a version's real language ('en', 'de', 'he' ...), or null if unknown
export function actualLanguageOf(version) {
  if (!version) { return null; }
  const m = typeof version.versionTitle === 'string' && version.versionTitle.match(SUFFIX);
  if (m) { return m[1].toLowerCase(); }
  if (version.actualLanguage) { return String(version.actualLanguage).toLowerCase(); }
  return version.language || null;
}

// A version the reader may pick by itself for its English line
export function isEnglishTranslation(version) {
  return !!version && version.language === 'en' && actualLanguageOf(version) === 'en';
}

// A version title (of a loaded English line) that is not English: "... [de]"
export function isForeignTitle(versionTitle) {
  const m = typeof versionTitle === 'string' && versionTitle.match(SUFFIX);
  return !!m && m[1].toLowerCase() !== 'en';
}

/**
 * A section loaded with an automatically chosen English line in another language: a copy with
 * that line taken out (the Hebrew stays). Leaves anything else as it is.
 */
export function stripForeignEnglish(textContent) {
  if (!textContent || !isForeignTitle(textContent.versionTitle)) { return textContent; }
  return {
    ...textContent,
    foreignTranslation: textContent.versionTitle,
    versionTitle: null,
    versionNotes: null,
    versionSource: null,
    license: null,
    content: (textContent.content || []).map(seg => ({ ...seg, text: '' })),
  };
}

// The same for a single-ref preview ({en, he, versionTitle, ...})
export function stripForeignPreviewEnglish(result) {
  if (!result || !isForeignTitle(result.versionTitle)) { return result; }
  return { ...result, en: '', versionTitle: null, versionSource: null };
}
