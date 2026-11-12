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

/**
 * The owner's order for the English line the reader picks by itself (2026-11-12): the more religious
 * translations, plain translations before ones with explanations woven in. Tanakh only - a
 * commentary's translation-with-explanation (Rashi, Bartenura) keeps Sefaria's order. Matched by the
 * version's title; the first rule a version matches is its rank, versions matching none come after
 * in Sefaria's order. A translation the reader picked by name always wins (this is only the default).
 */
const EXPLAINED = /onkelos|rashi|commentary|explanation|elucidat/i;
export const PREFERRED_TANAKH_ENGLISH = [
  t => /metsudah/i.test(t) && !EXPLAINED.test(t),       // Metsudah, the translation alone
  t => /metsudah/i.test(t),                              // Metsudah with Onkelos / Rashi
  t => /koren/i.test(t),                                 // The Koren Jerusalem Bible
  t => /jps,? 1985|1985 jps|tanakh: the holy scriptures/i.test(t),   // JPS 1985
];

const rankOf = title => {
  const i = PREFERRED_TANAKH_ENGLISH.findIndex(test => test(String(title || '')));
  return i < 0 ? PREFERRED_TANAKH_ENGLISH.length : i;
};

/** Is `categories` a book of Tanakh itself (not a commentary or targum on it)? */
export const isTanakhText = categories => Array.isArray(categories) && categories[0] === 'Tanakh'
  && !categories.some(c => c === 'Commentary' || c === 'Targum' || c === 'Modern Commentary on Tanakh');

/**
 * The English version the reader picks by itself: of `versions` (Sefaria's order), the ones really in
 * English that `isHidden` (the content filter) leaves, in the owner's order for a book of Tanakh
 * (categories), else the first. null: none.
 */
export function preferredEnglishVersion(versions, {categories = null, isHidden = () => false} = {}) {
  const ok = (versions || []).filter(v => isEnglishTranslation(v) && !isHidden(v));
  if (!ok.length) { return null; }
  if (!isTanakhText(categories)) { return ok[0]; }
  return ok.reduce((best, v) => (rankOf(v.versionTitle) < rankOf(best.versionTitle) ? v : best), ok[0]);
}
