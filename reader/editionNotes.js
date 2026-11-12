'use strict';

/**
 * A section shown from another edition than the one the reader is reading.
 *
 * Each section is loaded in the edition the reader asked for, or else in the first edition
 * that section has (offline.js populateMissingVersions; the server does the same online).
 * Mishnah Bikkurim 4 (Androginos) is in neither Torat Emet nor the Vilna edition, only in
 * "Version of the Gemara" and others, so it comes from another edition.
 *
 * Read with the default editions, the book is one continuous text, as on Sefaria (whose text
 * API also gives chapter 4 from "Version of the Gemara" with no remark): no note (owner, QA
 * round 13: "Sefaria does not have 2 Bikkurim"). Only a reader who chose an edition (in
 * Translations, or a link with a version) is told when a section is not in it: "This chapter
 * is not in Mishnah, ed. Romm, Vilna 1913; shown from Version of the Gemara - vocalized." (QA round 11).
 *
 * The edition the reader is reading (per language): the one asked for, unless the content
 * filter hides it; none when none was asked for.
 */

import Sefaria from '../sefaria';
import strings from '../LocalizedStrings';
import * as shomer from '../shomer';

const LANGS = ['en', 'he'];

// The text API names a text merged from several editions "Merged from A, B"; a book's exported
// merged edition is "merged" - a mix of editions is not one edition to name in a note
const isMergedTitle = vtitle => !vtitle || vtitle === 'merged' || /^Merged from /.test(vtitle);

const bookOf = ref => { try { return Sefaria.textTitleForRef(ref); } catch (e) { return null; } };

const versionObject = (vtitle, lang, title) =>
  (title && Sefaria.getVersionObject(vtitle, lang, title)) || { versionTitle: vtitle, language: lang };

const isHidden = (vtitle, lang, title) => {
  try { return shomer.isVersionHidden(versionObject(vtitle, lang, title)); } catch (e) { return false; }
};

/** The editions loaded for `sectionRef` ({en, he}), as the loaders recorded them. */
export const loadedEditions = sectionRef => (sectionRef && Sefaria._currVersionsBySection[sectionRef]) || {};

/** Whether `sectionRef` is known to have `vtitle` (null: not known, e.g. online). */
const sectionHas = (sectionRef, lang, vtitle) => {
  const available = Sefaria._versionsAvailableBySection[sectionRef];
  if (!Array.isArray(available)) { return null; }
  return available.some(v => v && v.language === lang && v.versionTitle === vtitle);
};

/**
 * The edition the reader chose, per language ({en, he}), for a text opened at `sectionRef`
 * with the versions asked for (`selected`; the default editions are not listed there).
 */
export const readingEditions = ({ sectionRef, selected }) => {
  const title = bookOf(sectionRef);
  const reading = {};
  for (const lang of LANGS) {
    const asked = selected && selected[lang];
    if (asked && !isHidden(asked, lang, title)) { reading[lang] = asked; }
  }
  return reading;
};

/**
 * The note for `sectionRef` in `lang`, or null: {lang, missing, shown} (version objects) when
 * the section is shown from another edition than `reading[lang]`, which it does not have.
 */
export const editionNoteFor = (sectionRef, reading, lang) => {
  const want = reading && reading[lang];
  const shown = loadedEditions(sectionRef)[lang];
  if (!want || !shown || want === shown || isMergedTitle(want) || isMergedTitle(shown)) { return null; }
  if (sectionHas(sectionRef, lang, want)) { return null; }  // there, and another was chosen
  const title = bookOf(sectionRef);
  if (isHidden(shown, lang, title)) { return null; }  // the filter leaves this text out anyway
  return { lang, missing: versionObject(want, lang, title), shown: versionObject(shown, lang, title) };
};

/** The notes for `sectionRef` in the languages shown (`textLanguage`). */
export const editionNotesFor = (sectionRef, reading, textLanguage) => {
  if (!reading) { return []; }
  const langs = textLanguage === 'hebrew' ? ['he'] : textLanguage === 'english' ? ['en'] : ['he', 'en'];
  return langs.map(lang => editionNoteFor(sectionRef, reading, lang)).filter(Boolean);
};

const HEBREW_LETTER = /[א-ת]/;

/** An edition's name in the interface language: its Hebrew name in Hebrew, when it has one. */
export const editionName = (version, hebrew) =>
  (hebrew && version.versionTitleInHebrew) || version.versionTitle;

/** Whether the book's sections are chapters (Mishnah, Tanakh ...), from its index. */
export const sectionsAreChapters = textToc => {
  const names = (textToc && ((textToc.schema && textToc.schema.sectionNames) || textToc.sectionNames)) || null;
  return Array.isArray(names) && names.length >= 2 && names[names.length - 2] === 'Chapter';
};

/** The note's sentence in the interface language. */
export const editionNoteText = (note, { hebrew, chapters }) => {
  let edition = editionName(note.missing, hebrew);
  const other = editionName(note.shown, hebrew);
  // "ב" joined to a name in Latin letters: "ב-Kaufmann"
  if (hebrew && !HEBREW_LETTER.test(edition.charAt(0))) { edition = `-${edition}`; }
  const template = chapters ? strings.reader.edition_note_chapter : strings.reader.edition_note_section;
  const text = strings.formatString(template, { edition, other });
  return Array.isArray(text) ? text.join('') : String(text);
};

/** A key of the notes, so the section header is drawn again when they change. */
export const editionNotesKey = notes => notes.map(n =>
  `${n.lang}:${n.missing.versionTitle}>${n.shown.versionTitle}|${!!n.missing.versionTitleInHebrew}${!!n.shown.versionTitleInHebrew}`).join(',');
