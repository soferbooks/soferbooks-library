import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DICTA_NAKDAN, BETWEEN, SPLIT, lacksNikud, forDicta, prepareNakdan, mergeNakdan, nakdanRequestBody,
  joinTokens, parseNakdanAnswer, createNakdan, useNakdan,
} from '../reader/nakdan';
import {
  NAKDAN_SETTINGS_KEY, NAKDAN_BOOKS_KEY, nakdanWanted, shouldAskNakdan, sectionLacksNikud,
  loadNakdanPrefs, setNakdanSettings, setNakdanForBook, notNowNakdan, getNakdanPrefs, _resetNakdanPrefs,
} from '../reader/nakdanPrefs';
import { VOCALIZATION } from '../VocalizationEnum';
import {
  availableInlineConnections, itemsForSource, refsForSource, isConnectionKey, MAX_CONNECTIONS_PER_PASSAGE,
} from '../reader/inlineCommentaryPrefs';

const PLAIN = 'בראשית ברא אלהים את השמים ואת הארץ';
const VOWELLED = 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ';
const flush = () => new Promise(r => setTimeout(r, 0));

// Dicta's answer as the Nakdan gives it: each word a token whose first option is the word with nikud
const vowelOf = word => {
  const i = PLAIN.split(' ').indexOf(word);
  return i === -1 ? null : VOWELLED.split(' ')[i];
};
const dictaAnswer = data => ({
  data: data.split(/( |\n|<!!?>)/).filter(s => s !== '').map(str => {
    const w = vowelOf(str);
    return w ? { str, nakdan: { options: [{ w: w.replace('ר', '|ר') }] } } : { str, sep: true };
  }),
});
const fakeFetch = (answer = dictaAnswer) => jest.fn(async (url, opts) => {
  const body = JSON.parse(opts.body);
  return { ok: true, status: 200, json: async () => answer(body.data) };
});
const queues = [];
afterEach(() => { queues.splice(0).forEach(q => q._dispose()); });
const track = q => { queues.push(q); return q; };
const memoryStorage = (initial = {}) => {
  const box = { saved: initial, writes: 0 };
  return { box, read: async () => box.saved, write: async obj => { box.saved = obj; box.writes++; } };
};

describe('which texts get nikud by computer (as the extension)', () => {
  test('only Hebrew with almost no vowels, and enough of it', () => {
    expect(lacksNikud(PLAIN)).toBe(true);
    expect(lacksNikud(VOWELLED)).toBe(false);
    expect(lacksNikud('אב גד')).toBe(false);            // too short
    expect(lacksNikud('In the beginning')).toBe(false);
  });

  test('two apostrophes or curly quotes in an abbreviation are sent as "', () => {
    expect(forDicta("רש''י אמר")).toBe('רש"י אמר');
    expect(forDicta('רש”י')).toBe('רש"י');
  });

  test('the text pieces of a passage are sent, its tags and footnotes stay', () => {
    const html = `<b>בראשית ברא</b> אלהים את השמים<sup>1</sup><i class="footnote">הערה <b>כאן</b></i> ואת הארץ`;
    const item = prepareNakdan(html);
    expect(item.text).toBe(['בראשית ברא', ' אלהים את השמים', ' ואת הארץ'].join(SPLIT));
    const done = ['בְּרֵאשִׁית בָּרָא', ' אֱלֹהִים אֵת הַשָּׁמַיִם', ' וְאֵת הָאָרֶץ'].join(SPLIT);
    expect(mergeNakdan(item, done)).toBe(
      `<b>בְּרֵאשִׁית בָּרָא</b> אֱלֹהִים אֵת הַשָּׁמַיִם<sup>1</sup><i class="footnote">הערה <b>כאן</b></i> וְאֵת הָאָרֶץ`);
    expect(mergeNakdan(item, 'one piece only')).toBeNull();
    expect(prepareNakdan(VOWELLED)).toBeNull();
    expect(prepareNakdan('')).toBeNull();
  });

  test("Dicta's request is the extension's", () => {
    expect(DICTA_NAKDAN.url).toBe('https://nakdan-5-3.loadbalancer.dicta.org.il/addnikud');
    expect(nakdanRequestBody(['א', 'ב'], 'k')).toEqual({
      task: 'nakdan', useTokenization: true, genre: 'rabbinic', data: `\nא\n${BETWEEN}\nב\n`,
      addmorph: false, matchpartial: true, keepmetagim: true, keepqq: false, apiKey: 'k',
    });
  });

  test('only marks are added: a word or a text whose letters came back different stays as it was', () => {
    expect(joinTokens([{ str: 'ברא', nakdan: { options: [{ w: 'בָּ|רָא' }] } }, { str: ' ', sep: true },
      { str: 'אלהים', nakdan: { options: [{ w: 'אֱלוֹהִים' }] } }])).toBe('בָּרָא אלהים');
    expect(joinTokens([{ str: 'ברא', nakdan: { options: [{ w: 'בָּרָֽא' }] } }])).toBe('בָּרָא');   // meteg dropped
    expect(parseNakdanAnswer({ data: [{ str: '\nאב\n' }, { str: BETWEEN }, { str: '\nגד\n' }] }, ['אב', 'גה']))
      .toEqual(['אב', null]);
    expect(() => parseNakdanAnswer({ data: [{ str: 'אב' }] }, ['אב', 'גד'])).toThrow();
  });
});

describe("Dicta is asked gently, and every answer is kept on the phone", () => {
  test('texts waiting together go in one request; an answer kept is not asked for again', async () => {
    const fetchImpl = fakeFetch();
    const storage = memoryStorage();
    const q = track(createNakdan({ fetchImpl, storage, wait: 0, saveDelay: 0 }));
    const got = [];
    q.want('בראשית ברא אלהים', d => got.push(d));
    q.want('את השמים ואת הארץ', d => got.push(d));
    await flush(); await flush(); await flush();
    await new Promise(r => setTimeout(r, 5));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).data.split(BETWEEN)).toHaveLength(2);
    expect(got.sort()).toEqual(['אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ', 'בְּרֵאשִׁית בָּרָא אֱלֹהִים'].sort());
    expect(q.cached('בראשית ברא אלהים')).toBe('בְּרֵאשִׁית בָּרָא אֱלֹהִים');
    await new Promise(r => setTimeout(r, 5));
    expect(storage.box.saved['בראשית ברא אלהים']).toBe('בְּרֵאשִׁית בָּרָא אֱלֹהִים');

    // offline afterwards: a new start reads the answers from the phone, without asking Dicta
    const offline = jest.fn(async () => { throw new Error('offline'); });
    const q2 = track(createNakdan({ fetchImpl: offline, storage, wait: 0 }));
    const got2 = [];
    q2.want('בראשית ברא אלהים', d => got2.push(d));
    await new Promise(r => setTimeout(r, 5));
    expect(got2).toEqual(['בְּרֵאשִׁית בָּרָא אֱלֹהִים']);
    expect(offline).not.toHaveBeenCalled();
  });

  test('one request at a time, and the next only after the wait', async () => {
    let release;
    const fetchImpl = jest.fn(() => new Promise(r => { release = r; }));
    let t = 1000;
    const q = track(createNakdan({ fetchImpl, storage: memoryStorage(), now: () => t, wait: 12000 }));
    q.want('בראשית ברא', () => {});
    await new Promise(r => setTimeout(r, 5));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(q.isBusy()).toBe(true);
    q.want('את השמים', () => {});
    await new Promise(r => setTimeout(r, 5));
    expect(fetchImpl).toHaveBeenCalledTimes(1);     // (not while the first is under way)
    release({ ok: true, json: async () => dictaAnswer('\nבראשית ברא\n') });
    await new Promise(r => setTimeout(r, 5));
    expect(q.isBusy()).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);     // (12 seconds not yet passed)
    expect(q._waiting()).toEqual(['את השמים']);
  });

  test('a failed or slow request leaves the plain text, and Dicta is left alone for a while', async () => {
    const fetchImpl = jest.fn(() => new Promise(() => {}));   // never answers
    const q = track(createNakdan({ fetchImpl, storage: memoryStorage(), wait: 0, timeout: 10, pause: 60000 }));
    const got = [];
    q.want('בראשית ברא', d => got.push(d));
    await new Promise(r => setTimeout(r, 40));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
    expect(q.isBusy()).toBe(false);
    expect(got).toEqual([]);                        // nothing changes: the text shows as it is
    expect(q.cached('בראשית ברא')).toBeUndefined();  // (asked again later)
  });

  test('a passage nobody waits for any more is not sent', async () => {
    const fetchImpl = fakeFetch();
    const q = track(createNakdan({ fetchImpl, storage: memoryStorage(), wait: 0 }));
    const stop = q.want('בראשית ברא', () => {});
    stop();
    await new Promise(r => setTimeout(r, 5));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('useNakdan shows the text with nikud once Dicta answers', async () => {
    const q = track(createNakdan({ fetchImpl: fakeFetch(), storage: memoryStorage(), wait: 0 }));
    const Show = ({ on }) => <Text>{useNakdan(`<b>${PLAIN}</b>`, on, q) || 'plain'}</Text>;
    let inst;
    await act(async () => { inst = renderer.create(<Show on={false} />); });
    expect(inst.root.findByType(Text).props.children).toBe('plain');
    await act(async () => { inst.update(<Show on />); });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(inst.root.findByType(Text).props.children).toBe(`<b>${VOWELLED}</b>`);
    act(() => inst.unmount());
  });
});

describe('when nikud is added: the vowel setting, the sefer switch, Always, and the card that asks', () => {
  beforeEach(async () => { await AsyncStorage.clear(); _resetNakdanPrefs(); });

  const prefs = (settings = {}, books = {}, notNow = new Set()) => ({ settings: { always: false, neverAsk: false, ...settings }, books, notNow });

  test('off until asked for, never while vowels are hidden, and a sefer switch beats Always', () => {
    const full = VOCALIZATION.TAAMIM_AND_NIKKUD;
    expect(nakdanWanted(prefs(), 'Rashi on Genesis', full)).toBe(false);
    expect(nakdanWanted(prefs({ always: true }), 'Rashi on Genesis', full)).toBe(true);
    expect(nakdanWanted(prefs({ always: true }), 'Rashi on Genesis', VOCALIZATION.NIKKUD)).toBe(true);
    expect(nakdanWanted(prefs({ always: true }), 'Rashi on Genesis', VOCALIZATION.NONE)).toBe(false);
    expect(nakdanWanted(prefs({ always: true }, { 'Rashi on Genesis': false }), 'Rashi on Genesis', full)).toBe(false);
    expect(nakdanWanted(prefs({}, { 'Rashi on Genesis': true }), 'Rashi on Genesis', full)).toBe(true);
    expect(nakdanWanted(prefs({ always: true }), null, full)).toBe(false);
  });

  test('the card asks on a text without nikud, unless answered, "Not now" or "Never"', () => {
    const full = VOCALIZATION.TAAMIM_AND_NIKKUD;
    expect(shouldAskNakdan(prefs(), 'Book', full, true)).toBe(true);
    expect(shouldAskNakdan(prefs(), 'Book', full, false)).toBe(false);
    expect(shouldAskNakdan(prefs(), 'Book', VOCALIZATION.NONE, true)).toBe(false);
    expect(shouldAskNakdan(prefs({}, { Book: false }), 'Book', full, true)).toBe(false);
    expect(shouldAskNakdan(prefs({ always: true }), 'Book', full, true)).toBe(false);
    expect(shouldAskNakdan(prefs({ neverAsk: true }), 'Book', full, true)).toBe(false);
    expect(shouldAskNakdan(prefs({}, {}, new Set(['Book'])), 'Book', full, true)).toBe(false);
  });

  test("a section's text without nikud", () => {
    expect(sectionLacksNikud([{ he: `<b>${PLAIN}</b>` }, { he: PLAIN }])).toBe(true);
    expect(sectionLacksNikud([{ he: VOWELLED }])).toBe(false);
    expect(sectionLacksNikud([])).toBe(false);
  });

  test('the choices are kept on the phone', async () => {
    await loadNakdanPrefs();
    await setNakdanSettings({ always: true });
    await setNakdanForBook('Rashi on Berakhot', false);
    notNowNakdan('Tosafot on Berakhot');
    expect(JSON.parse(await AsyncStorage.getItem(NAKDAN_SETTINGS_KEY))).toEqual({ always: true, neverAsk: false });
    expect(JSON.parse(await AsyncStorage.getItem(NAKDAN_BOOKS_KEY))).toEqual({ 'Rashi on Berakhot': false });
    _resetNakdanPrefs();
    const loaded = await loadNakdanPrefs();
    expect(loaded.settings.always).toBe(true);
    expect(loaded.books).toEqual({ 'Rashi on Berakhot': false });
    expect(getNakdanPrefs().notNow.has('Tosafot on Berakhot')).toBe(false);   // ("Not now": this time only)
  });
});

describe('connections under each passage (as the extension offers them)', () => {
  const link = (category, sourceRef, sourceHeRef, collectiveTitle = null) => ({ category, sourceRef, sourceHeRef, collectiveTitle, textTitle: sourceRef.split(' ')[0] });
  const links = [
    link('Commentary', 'Rashi on Berakhot 2a:1:1', 'רש"י', 'Rashi'),
    link('Tanakh', 'Deuteronomy 6:7', 'דברים ו:ז'),
    link('Tanakh', 'Deuteronomy 6:7', 'דברים ו:ז'),
    link('Tanakh', 'Leviticus 22:7', 'ויקרא כב:ז'),
    link('Mishnah', 'Mishnah Berakhot 1:1', 'משנה ברכות א:א'),
  ];

  test('offered only for the kinds the loaded text has links of, in the extension\'s order', () => {
    const offered = availableInlineConnections({ 'Berakhot 2a': [{ links }] });
    expect(offered.map(c => c.key)).toEqual(['@Tanakh', '@Mishnah']);
    expect(isConnectionKey('@Tanakh')).toBe(true);
    expect(isConnectionKey('Rashi')).toBe(false);
  });

  test('a line shows its texts of that kind, each once, with its name, at most 8', () => {
    expect(itemsForSource(links, '@Tanakh')).toEqual([
      { ref: 'Deuteronomy 6:7', he: 'דברים ו:ז' }, { ref: 'Leviticus 22:7', he: 'ויקרא כב:ז' }]);
    expect(itemsForSource(links, 'Rashi')).toEqual([{ ref: 'Rashi on Berakhot 2a:1:1', he: null }]);
    expect(refsForSource(links, '@Mishnah')).toEqual(['Mishnah Berakhot 1:1']);
    const many = Array.from({ length: 12 }, (_, i) => link('Talmud', `Shabbat ${i + 2}a:1`, `שבת ${i}`));
    expect(itemsForSource(many, '@Talmud')).toHaveLength(MAX_CONNECTIONS_PER_PASSAGE);
  });
});

describe("the reader shows the sefer's switch and the card that asks", () => {
  beforeEach(async () => { await AsyncStorage.clear(); _resetNakdanPrefs(); });
  const { NakdanAskCard } = require('../reader/NakdanNotices');
  const ReaderDisplayOptionsMenu = require('../ReaderDisplayOptionsMenu').default;
  const strings = require('../LocalizedStrings').default;
  const texts = inst => inst.root.findAll(n => n.type === Text).map(n => [].concat(n.props.children).join(''));

  test('"Add nikud" on the card switches it on for the sefer; "Never" stops the asking', async () => {
    let inst;
    await act(async () => { inst = renderer.create(<NakdanAskCard book="Rashi on Berakhot" interfaceLanguage="english" />); });
    expect(texts(inst)).toContain(strings.reader.nakdan_ask_title);
    await act(async () => { inst.root.findByProps({ testID: 'nakdan-add' }).props.onPress(); });
    expect(getNakdanPrefs().books).toEqual({ 'Rashi on Berakhot': true });
    await act(async () => { inst.root.findByProps({ testID: 'nakdan-never' }).props.onPress(); });
    expect(getNakdanPrefs().settings.neverAsk).toBe(true);
    act(() => inst.unmount());
  });

  test("the Aa menu has the sefer's nikud switch and the connections under each passage", async () => {
    const theme = new Proxy({}, { get: () => ({}) });
    let inst;
    await act(async () => {
      inst = renderer.create(<ReaderDisplayOptionsMenu
        theme={theme} themeStr="white" interfaceLanguage="english" textLanguage="hebrew" textFlow="segmented"
        canHaveAliyot={false} canBeContinuous={false} showAliyot={false}
        vowelToggleAvailable={VOCALIZATION.TAAMIM_AND_NIKKUD} vocalization={VOCALIZATION.TAAMIM_AND_NIKKUD}
        inlineSources={[{ key: 'Rashi', en: 'Rashi', he: 'רש"י' }]}
        inlineConnections={[{ key: '@Tanakh', en: 'Tanakh: the pesukim quoted', he: 'תנ״ך' }]}
        setInlineCommentary={jest.fn()}
        nakdanAvailable nakdanForCommentary nakdan={false} setNakdan={jest.fn()}
      />);
    });
    const shown = texts(inst);
    expect(shown).toContain(strings.reader.nakdan_commentary_vowels);
    expect(shown).toContain(strings.reader.inline_connections);
    expect(shown).toContain('Tanakh: the pesukim quoted');
    act(() => inst.unmount());
  });
});
