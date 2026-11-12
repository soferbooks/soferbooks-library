// QA round 12 (2026-11-11): Mishnah's "English" line showed the German translation.
// Sefaria files every non-Hebrew version under language 'en'; Mishnah's default English
// (Kulp, Conservative Yeshiva) is hidden at the default RWMO preset, and the fallback took the
// next 'en' version: "Mischnajot mit deutscher Übersetzung ... [de]". The English line is now
// chosen only from versions really in English, else the section is Hebrew only.
jest.mock('../offline', () => ({
  ...jest.requireActual('../offline'),
  loadTextOffline: jest.fn(() => Promise.reject('Missing offline data')),
}));

import Sefaria from '../sefaria';
import api from '../api';
import * as shomer from '../shomer';
import { configForPreset } from '../shomer/presets';
import { loadText } from '../offlineOnline';
import { getDefaultVersionForLang } from '../offline';
import {
  actualLanguageOf, isEnglishTranslation, isForeignTitle, stripForeignEnglish, stripForeignPreviewEnglish,
} from '../translationLanguage';

const KULP = 'Mishnah Yomit by Dr. Joshua Kulp';
const GERMAN = 'Mischnajot mit deutscher Übersetzung und Erklärung. Berlin 1887-1933 [de]';
const GOLDSCHMIDT = 'Talmud Bavli. German. Lazarus Goldschmidt. 1929 [de]';
const COMMUNITY = 'Sefaria Community Translation';
const FRENCH = 'Le Talmud de Jérusalem, traduit par Moise Schwab, 1878-1890 [fr]';

// The versions API for Mishnah Bikkurim (2026-11-11), in Sefaria's order
const BIKKURIM = [
  { language: 'he', actualLanguage: 'he', versionTitle: 'Torat Emet 357' },
  { language: 'he', actualLanguage: 'he', versionTitle: 'Mishnah, ed. Romm, Vilna 1913' },
  { language: 'en', actualLanguage: 'en', versionTitle: KULP, versionSource: 'http://learn.conservativeyeshiva.org/mishnah/' },
  { language: 'en', actualLanguage: 'de', versionTitle: GERMAN },
  { language: 'en', actualLanguage: 'de', versionTitle: GOLDSCHMIDT },
  { language: 'en', actualLanguage: 'en', versionTitle: COMMUNITY },
  { language: 'en', actualLanguage: 'fr', versionTitle: FRENCH },
];

beforeEach(() => {
  shomer.setConfig(configForPreset('rwmo'));
  api._textCache = {};
  api._versions = {};
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => shomer.setConfig(null));

describe('a translation\'s real language', () => {
  test('from actualLanguage or the "[de]" title suffix; Hebrew stays Hebrew', () => {
    expect(actualLanguageOf(BIKKURIM[3])).toBe('de');
    expect(actualLanguageOf({ language: 'en', versionTitle: GERMAN })).toBe('de');      // no actualLanguage
    expect(actualLanguageOf({ language: 'en', versionTitle: KULP })).toBe('en');
    expect(actualLanguageOf(BIKKURIM[0])).toBe('he');
    expect(isEnglishTranslation(BIKKURIM[2])).toBe(true);
    expect(isEnglishTranslation(BIKKURIM[3])).toBe(false);
    expect(isEnglishTranslation(BIKKURIM[6])).toBe(false);
    expect(isEnglishTranslation(BIKKURIM[0])).toBe(false);
    expect(isForeignTitle(GERMAN)).toBe(true);
    expect(isForeignTitle(KULP)).toBe(false);
    expect(isForeignTitle(null)).toBe(false);
  });

  test('stripping a non-English line keeps the Hebrew and leaves English alone', () => {
    const tc = { versionTitle: GERMAN, content: [{ text: 'Es gibt solche', he: 'יֵשׁ מְבִיאִין' }] };
    const out = stripForeignEnglish(tc);
    expect(out.content[0]).toEqual({ text: '', he: 'יֵשׁ מְבִיאִין' });
    expect(out.versionTitle).toBeNull();
    expect(tc.content[0].text).toBe('Es gibt solche');
    const en = { versionTitle: COMMUNITY, content: [] };
    expect(stripForeignEnglish(en)).toBe(en);
    expect(stripForeignPreviewEnglish({ en: 'Es gibt', he: 'יש', versionTitle: GERMAN }).en).toBe('');
  });
});

describe('offline: the default English line', () => {
  test('Kulp hidden: the next version really in English, never the German', () => {
    expect(shomer.isVersionHidden(BIKKURIM[2])).toBe(true);
    expect(getDefaultVersionForLang(BIKKURIM, 'en').versionTitle).toBe(COMMUNITY);
    expect(getDefaultVersionForLang(BIKKURIM, 'he').versionTitle).toBe('Torat Emet 357');
  });

  test('no English left: no English line at all (Hebrew only)', () => {
    const noEnglish = BIKKURIM.filter(v => v.versionTitle !== COMMUNITY);
    expect(getDefaultVersionForLang(noEnglish, 'en')).toBeUndefined();
  });

  test('filter off: the default English is Kulp again', () => {
    shomer.setConfig({ preset: 'off' });
    expect(getDefaultVersionForLang(BIKKURIM, 'en').versionTitle).toBe(KULP);
    // and with no English at all, still no German
    expect(getDefaultVersionForLang(BIKKURIM.filter(v => v.actualLanguage !== 'en'), 'en')).toBeUndefined();
  });

  test('Tanakh with the default English hidden falls back on the next English one', () => {
    const genesis = [
      { language: 'he', versionTitle: 'Miqra according to the Masorah' },
      { language: 'en', actualLanguage: 'en', versionTitle: 'Tanakh: The Holy Scriptures, published by JPS' },
      { language: 'en', actualLanguage: 'de', versionTitle: 'Die Tora, übersetzt von Moses Mendelssohn [de]' },
      { language: 'en', actualLanguage: 'en', versionTitle: 'The Koren Jerusalem Bible' },
    ];
    shomer.setConfig(configForPreset('yeshivish'));
    expect(getDefaultVersionForLang(genesis, 'en').versionTitle).toBe('The Koren Jerusalem Bible');
  });
});

describe('online: the English line the server chose', () => {
  const section = (versionTitle, text) => ({
    textContent: {
      sectionRef: 'Mishnah Bikkurim 1', versionTitle, heVersionTitle: 'Torat Emet 357',
      content: [{ segmentNumber: '1', text, he: 'יֵשׁ מְבִיאִין בִּכּוּרִים' }],
    },
    links: [],
  });

  const mockServer = (byEn) => {
    jest.spyOn(api, 'versions').mockResolvedValue(BIKKURIM);
    jest.spyOn(api, 'processTextApiData').mockImplementation(() => {});
    return jest.spyOn(api, 'textApi').mockImplementation(async (ref, context, versions) =>
      byEn[(versions && versions.en) || 'default']);
  };

  test('hidden default (Kulp): loads the Sefaria Community Translation, not the German', async () => {
    const textApi = mockServer({
      default: section(KULP, 'There are those who bring first fruits (Kulp)'),
      [COMMUNITY]: section(COMMUNITY, 'Some bring first fruits'),
    });
    const { textContent } = await loadText('Mishnah Bikkurim 1', true, null);
    expect(textContent.versionTitle).toBe(COMMUNITY);
    expect(textContent.content[0].text).toBe('Some bring first fruits');
    expect(textApi.mock.calls.map(c => c[2] && c[2].en)).not.toContain(GERMAN);
  });

  test('the server sends German (no English for the section): Hebrew only', async () => {
    mockServer({
      default: section(GERMAN, 'Es gibt solche, welche Erstlinge bringen'),
      [COMMUNITY]: section(GERMAN, 'Es gibt solche, welche Erstlinge bringen'),
    });
    const { textContent } = await loadText('Mishnah Bikkurim 1', true, null);
    expect(textContent.content[0].text).toBe('');
    expect(textContent.content[0].he).toBe('יֵשׁ מְבִיאִין בִּכּוּרִים');
    expect(Sefaria._currVersionsBySection['Mishnah Bikkurim 1']).toEqual({ en: null, he: 'Torat Emet 357' });
  });

  test('a German translation picked from the menu is shown as asked', async () => {
    const textApi = mockServer({ [GERMAN]: section(GERMAN, 'Es gibt solche') });
    const { textContent } = await loadText('Mishnah Bikkurim 1', true, { en: GERMAN });
    expect(textContent.versionTitle).toBe(GERMAN);
    expect(textContent.content[0].text).toBe('Es gibt solche');
    expect(textApi).toHaveBeenCalledTimes(1);
  });

  test('a preview (links panel, inline) in German keeps only the Hebrew; one asked for by name stays', async () => {
    jest.spyOn(api, 'processTextApiData').mockImplementation(() => {});
    jest.spyOn(api, 'textApi').mockResolvedValue({ result: { en: 'Es gibt', he: 'יֵשׁ', versionTitle: GERMAN } });
    expect((await loadText('Mishnah Bikkurim 1:1', false)).result.en).toBe('');
    expect((await loadText('Mishnah Bikkurim 1:1', false, { en: GERMAN })).result.en).toBe('Es gibt');
  });

  test('the versions list never marks a German version as the default English', async () => {
    jest.spyOn(api, '_request').mockResolvedValue([
      { language: 'he', versionTitle: 'Torat Emet 357' },
      { language: 'en', actualLanguage: 'de', versionTitle: GERMAN },
      { language: 'en', actualLanguage: 'en', versionTitle: COMMUNITY },
    ]);
    const versions = await api.versions('Mishnah Test 1', true);
    expect(versions.filter(v => v.default).map(v => v.versionTitle)).toEqual(['Torat Emet 357', COMMUNITY]);
  });
});
