/**
 * Emulator QA round 11 (2026-11-11): reading Mishnah Bikkurim, chapter 4 (Androginos) silently
 * came from another edition - it is in neither Torat Emet nor the Vilna edition, only in
 * "Version of the Gemara" and others. A section shown from another edition than the one being
 * read now says so at its start (reader/editionNotes.js, reader/EditionNote.js).
 * QA round 13 (2026-11-12): only when the reader chose that edition - read with the default
 * editions, the book is one continuous text, as on Sefaria.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import Sefaria from '../sefaria';
import strings from '../LocalizedStrings';
import * as shomer from '../shomer';
import EditionNote from '../reader/EditionNote';
import {
  readingEditions, editionNoteFor, editionNotesFor, editionNoteText, sectionsAreChapters,
} from '../reader/editionNotes';

const BOOK = 'Mishnah Bikkurim';
const TORAT_EMET = 'Torat Emet 357';
const VILNA = 'Mishnah, ed. Romm, Vilna 1913';
const GEMARA = 'Version of the Gemara - vocalized';
const KAUFMANN = "Mishnah based on the Kaufmann manuscript, edited by Dan Be'eri";
const GERMAN = 'Mischnajot mit deutscher Übersetzung und Erklärung. Berlin 1887-1933 [de]';

const have = (...titles) => titles.map(versionTitle => ({ versionTitle, language: versionTitle === GERMAN ? 'en' : 'he' }));

beforeEach(() => {
  jest.spyOn(Sefaria, 'textTitleForRef').mockImplementation(ref => ref.replace(/ \d+(:\d+)?$/, ''));
  Sefaria._currVersionsBySection = {};
  Sefaria._versionsAvailableBySection = {};
  Sefaria._versionObjectsByTitle = {};
  Sefaria.cacheVersionObjectByTitle([
    { versionTitle: GEMARA, versionTitleInHebrew: 'נוסחת הגמרא -- מנוקד', language: 'he' },
    { versionTitle: TORAT_EMET, versionTitleInHebrew: 'תורת אמת 357', language: 'he' },
    { versionTitle: VILNA, versionTitleInHebrew: 'משנה, מהדורת בית דפוס ראם, וילנא 1913', language: 'he' },
    { versionTitle: KAUFMANN, language: 'he' },
    { versionTitle: GERMAN, language: 'en' },
  ], BOOK);
  // as the export has it: chapters 1-3 in Torat Emet and Vilna, chapter 4 only in other editions
  for (const n of [1, 2, 3]) {
    Sefaria.cacheVersionsAvailableBySection(`${BOOK} ${n}`, have(TORAT_EMET, VILNA, KAUFMANN, GERMAN));
    Sefaria.cacheCurrVersionsBySection({ he: TORAT_EMET, en: GERMAN }, `${BOOK} ${n}`);
  }
  Sefaria.cacheVersionsAvailableBySection(`${BOOK} 4`, have(GEMARA, KAUFMANN, GERMAN));
  Sefaria.cacheCurrVersionsBySection({ he: GEMARA, en: GERMAN }, `${BOOK} 4`);
});

afterEach(() => { jest.restoreAllMocks(); strings.setLanguage('en'); });

describe('the edition being read', () => {
  test('read with the default editions, the book is one text: no note anywhere (as on Sefaria)', () => {
    const reading = readingEditions({ sectionRef: `${BOOK} 3` });
    expect(reading).toEqual({});
    for (const n of [1, 2, 3, 4]) {
      expect(editionNotesFor(`${BOOK} ${n}`, reading, 'bilingual')).toEqual([]);
    }
  });

  test('a chosen edition is the one being read; a section without it says so', () => {
    const reading = readingEditions({ sectionRef: `${BOOK} 3`, selected: { he: VILNA } });
    expect(reading).toEqual({ he: VILNA });
    expect(editionNoteFor(`${BOOK} 3`, reading, 'he')).toBeNull();
    const note = editionNoteFor(`${BOOK} 4`, reading, 'he');
    expect(note.missing.versionTitle).toBe(VILNA);
    expect(note.shown.versionTitle).toBe(GEMARA);
    expect(editionNoteFor(`${BOOK} 4`, reading, 'en')).toBeNull();  // no translation was chosen
  });

  test('a chosen edition the section has: no note', () => {
    const reading = readingEditions({ sectionRef: `${BOOK} 2`, selected: { he: KAUFMANN } });
    Sefaria.cacheCurrVersionsBySection({ he: KAUFMANN }, `${BOOK} 4`);
    expect(editionNoteFor(`${BOOK} 4`, reading, 'he')).toBeNull();
  });

  test('a chosen edition the content filter hides is not the one being read', () => {
    jest.spyOn(shomer, 'isVersionHidden').mockImplementation(v => v.versionTitle === VILNA);
    expect(readingEditions({ sectionRef: `${BOOK} 2`, selected: { he: VILNA } })).toEqual({});
  });

  test('a text merged from several editions has no note', () => {
    Sefaria.cacheCurrVersionsBySection({ he: 'Merged from A, B' }, `${BOOK} 4`);
    expect(editionNoteFor(`${BOOK} 4`, { he: TORAT_EMET }, 'he')).toBeNull();
  });

  test('only the languages shown get a note', () => {
    Sefaria.cacheCurrVersionsBySection({ he: GEMARA, en: 'Another translation' }, `${BOOK} 4`);
    Sefaria.cacheVersionsAvailableBySection(`${BOOK} 4`, have(GEMARA, KAUFMANN));  // (no German here)
    const reading = { he: TORAT_EMET, en: GERMAN };
    expect(editionNotesFor(`${BOOK} 4`, reading, 'hebrew').map(n => n.lang)).toEqual(['he']);
    expect(editionNotesFor(`${BOOK} 4`, reading, 'english').map(n => n.lang)).toEqual(['en']);
    expect(editionNotesFor(`${BOOK} 4`, reading, 'bilingual').map(n => n.lang)).toEqual(['he', 'en']);
    expect(editionNotesFor(`${BOOK} 4`, null, 'bilingual')).toEqual([]);
  });
});

describe('the note', () => {
  const note = () => editionNoteFor(`${BOOK} 4`, { he: TORAT_EMET }, 'he');

  test('names the editions, in Hebrew in the Hebrew interface', () => {
    strings.setLanguage('en');
    expect(editionNoteText(note(), { hebrew: false, chapters: true }))
      .toBe('This chapter is not in Torat Emet 357; shown from Version of the Gemara - vocalized.');
    strings.setLanguage('he');
    expect(editionNoteText(note(), { hebrew: true, chapters: true }))
      .toBe('פרק זה אינו בתורת אמת 357; מובא מתוך נוסחת הגמרא -- מנוקד.');
  });

  test('a book whose sections are not chapters says "section"; a Latin name gets a hyphen after ב', () => {
    const n = { lang: 'he', missing: { versionTitle: KAUFMANN }, shown: { versionTitle: GEMARA, versionTitleInHebrew: 'נוסחת הגמרא' } };
    strings.setLanguage('en');
    expect(editionNoteText(n, { hebrew: false, chapters: false })).toMatch(/^This section is not in Mishnah based on/);
    strings.setLanguage('he');
    expect(editionNoteText(n, { hebrew: true, chapters: false })).toBe(`קטע זה אינו ב-${KAUFMANN}; מובא מתוך נוסחת הגמרא.`);
  });

  test("the book's index says whether its sections are chapters", () => {
    expect(sectionsAreChapters({ schema: { sectionNames: ['Chapter', 'Mishnah'] } })).toBe(true);
    expect(sectionsAreChapters({ sectionNames: ['Daf', 'Line'] })).toBe(false);
    expect(sectionsAreChapters({ schema: { nodes: [] } })).toBe(false);
    expect(sectionsAreChapters(null)).toBe(false);
  });

  test('renders one line per language', () => {
    const notes = [note(), { lang: 'en', missing: { versionTitle: 'A' }, shown: { versionTitle: 'B' } }];
    let inst;
    act(() => { inst = renderer.create(<EditionNote notes={notes} interfaceLanguage="english" chapters theme={{}} />); });
    const texts = inst.root.findAllByType(Text).map(t => t.props.children);
    expect(texts).toEqual([
      'This chapter is not in Torat Emet 357; shown from Version of the Gemara - vocalized.',
      'This chapter is not in A; shown from B.',
    ]);
    act(() => { inst.update(<EditionNote notes={[]} interfaceLanguage="english" />); });
    expect(inst.toJSON()).toBeNull();
  });
});

describe('a book read online (not downloaded)', () => {
  test("the server's list of the editions that have the section, and their Hebrew names, are kept", () => {
    const textContent = Sefaria.api._toMobileFormat({
      text: [''], he: ['אנדרוגינוס'], sectionRef: `${BOOK} 4`, indexTitle: BOOK,
      versionTitle: GERMAN, heVersionTitle: GEMARA, heVersionTitleInHebrew: 'נוסחת הגמרא -- מנוקד',
      versions: [{ versionTitle: GEMARA, language: 'he', status: 'locked' }, { versionTitle: GERMAN, language: 'en' }],
    }, `${BOOK} 4`);
    Sefaria._versionsAvailableBySection = {};
    Sefaria._versionObjectsByTitle = {};
    Sefaria.cacheVersionInfoOldFormat({ textContent });
    const note = editionNoteFor(`${BOOK} 4`, { he: TORAT_EMET }, 'he');
    expect(note.shown).toMatchObject({ versionTitle: GEMARA, versionTitleInHebrew: 'נוסחת הגמרא -- מנוקד' });
    expect(editionNoteFor(`${BOOK} 4`, { he: GEMARA, en: GERMAN }, 'en')).toBeNull();
  });
});
