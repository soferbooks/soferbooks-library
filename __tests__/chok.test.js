/**
 * Chok LeYisrael: the sefer from Otzaria's library (extras/chok.js), converted on the phone into
 * one book laid out by parsha, day and part, and the day's learning read from it as one unit
 * (learningSchedules/chokDay.js, scheduleSequence.js's bounded sequences).
 * The volumes below are cut-down copies of Otzaria's files, in their markup.
 */
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {cleanLine, chokTree, dayName, hashFromManifest, catalogEntry, VOLUMES, TITLE, INTRO_HE, PRAYERS_HE} from '../extras/chok';
import {bookFiles} from '../extras/schema7';
import {chooseBooks} from '../extras/catalog';
import {entryForPath} from '../extras/otzaria';
import * as extras from '../extras';
import {
  weekParshiot, chokDayInfo, chokCalendarItem, chokDaySequence, partKind, dateLabel, PARSHIOT_EN, PARSHIOT_HE,
} from '../learningSchedules/chokDay';
import {boundedNeighbours, isLastReading, isBounded, readingIndexOf} from '../learningSchedules/scheduleSequence';
import {tabLabel} from '../tabs/ReaderTabBar';

jest.mock('react-native-zip-archive', () => {
  const fsMock = require('expo-file-system/legacy');
  return {
    zip: jest.fn(async (dir, target) => {
      const entries = {};
      for (const name of await fsMock.readDirectoryAsync(dir)) {
        entries[name] = await fsMock.readAsStringAsync(`${dir}${name}`);
      }
      await fsMock.writeAsStringAsync(target, JSON.stringify(entries));
      return target;
    }),
    unzip: jest.fn(),
  };
});

const day = (y, m, d) => new Date(y, m - 1, d);

const RASHI = '<span style="color:#3377CC; font-size:70%;"><span style="background-color:#3377CC; color:#fff;"><small>רש"י</small></span> בראשית. אמר רבי יצחק</span>';
const VERSE = '<big><b>א</b></big> <small><small>(א)</small></small> <span style="font-size:150%;">בְּרֵאשִׁית בָּרָא:</span> <span style="font-size:90%;">בְּקַדְמִין בְּרָא:פפפ:</span>';

const INTRO = [
  '<h2>הקדמות</h2>',
  '<h3>הקדמת מהרח"ו</h3>', 'זה לשון הרב',
  '<h3>תפלה לאומרה קודם קריאת התורה</h3>', 'לשם יחוד קודשא בריך הוא',
  '<h3>תפלה לאומרה קודם לימוד משנה</h3>', 'הריני קורא משנה',
  '<h3>נוסחי דווקני</h3>', '<img src="data:image/png;base64,AAAA">',
];
const dayLines = (parsha, d, parts) => [`<h3>${parsha} ${d}</h3>`].concat(...parts.map(p => [`<h4>${p}</h4>`, `${p} - טקסט`]));
const WEEKDAY_PARTS = ['תורה', 'נביאים - מלאכי - פרק א', 'כתובים - משלי - פרק ו', 'משנה יבמות פרק ו', 'גמרא יבמות דף ס"ב ע"ב', 'זוהר תולדות דף קל"ז ע"א', 'הלכה פסוקה', 'מוסר'];
const parshaLines = parsha => [`<h2>פרשת ${parsha}</h2>`].concat(
  ...['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי'].map(d => dayLines(parsha, d, WEEKDAY_PARTS)),
  dayLines(parsha, 'ליל שישי', ['תורה']),
  dayLines(parsha, 'יום שישי', ['תורה', `הפטרת ${parsha} - מלאכי א`, 'משנה מקואות פרק ו', 'מוסר']),
);
const volume = (name, parshiot) => ['﻿<h1>חק לישראל - ' + name + '</h1>'].concat(INTRO, ...parshiot.map(parshaLines)).join('\r\n');
const TEXTS = {
  'בראשית': volume('בראשית', ['תולדות']),
  'שמות': volume('שמות', ['ויקהל', 'פקודי']),
  'ויקרא': volume('ויקרא', []),
  'במדבר': volume('במדבר', []),
  'דברים': volume('דברים', ['וזאת הברכה']),
};
const BOOK = {volumes: VOLUMES.map(v => TEXTS[v.he.split(' - ')[1]])};

function serve() {
  global.fetch = jest.fn(async url => {
    if (url.endsWith('files_manifest.json')) {
      return {ok: true, status: 200, text: async () => JSON.stringify(Object.fromEntries(VOLUMES.map((v, i) => [v.path, {hash: `h${i}`}])))};
    }
    const v = VOLUMES.find(x => url.endsWith(x.path.split('/').map(encodeURIComponent).join('/')));
    if (!v) { return {ok: false, status: 404, text: async () => ''}; }
    return {ok: true, status: 200, text: async () => TEXTS[v.he.split(' - ')[1]]};
  });
}
afterAll(() => { delete global.fetch; });

const INDEX = () => {
  const [tree] = chokTree(BOOK);
  return bookFiles(tree, {title: TITLE, heTitle: 'חק לישראל', categories: ['Reference'], heCategories: ['x'],
    version: {versionTitle: 'Otzaria (Orayta)', librarySource: 'chok'}});
};

describe('the sefer from Otzaria (extras/chok.js)', () => {
  test("Orayta's markup becomes the reader's: smaller Onkelos and Rashi, Rashi's name in bold, no pictures", () => {
    expect(cleanLine(VERSE)).toBe('<b>א</b> <small>(א)</small> בְּרֵאשִׁית בָּרָא: <small>בְּקַדְמִין בְּרָא:</small>');
    expect(cleanLine(RASHI)).toBe('<small><b>רש"י</b> בראשית. אמר רבי יצחק</small>');
    expect(cleanLine('<span style="font-size:97%;">אמר הקדוש ברוך הוא</span>')).toBe('אמר הקדוש ברוך הוא');
    expect(cleanLine('<img src="data:image/png;base64,AAAA">')).toBe('');
    expect(cleanLine('טקסט <b>פתוח')).toBe('טקסט <b>פתוח</b>');
  });

  test('day names lose the parsha', () => {
    expect(dayName('וירא יום רביעי')).toBe('יום רביעי');
    expect(dayName('לך לך ליל שישי')).toBe('ליל שישי');
  });

  test('the book: introductions once (prayers together), then parsha / day / part', () => {
    const {files, sections} = INDEX();
    const nodes = files[`${TITLE}_index.json`].schema.nodes;
    expect(nodes.map(n => n.heTitle)).toEqual([INTRO_HE, 'פרשת תולדות', 'פרשת ויקהל', 'פרשת פקודי', 'פרשת וזאת הברכה']);
    expect(nodes[0].nodes.map(n => n.heTitle)).toEqual(['הקדמת מהרח"ו', PRAYERS_HE]);   // (a picture alone is left out)
    expect(files[`${TITLE}, S1, S2.metadata.json`].heRef).toBe(`חק לישראל, ${INTRO_HE}, ${PRAYERS_HE}`);
    const prayers = Object.entries(files).find(([n]) => n.startsWith(`${TITLE}, S1, S2.`) && n.endsWith('.he.json'))[1];
    expect(prayers).toEqual(['<b>תפלה לאומרה קודם קריאת התורה</b>', 'לשם יחוד קודשא בריך הוא', '<b>תפלה לאומרה קודם לימוד משנה</b>', 'הריני קורא משנה']);
    expect(nodes[1].nodes.map(n => n.heTitle)).toEqual(['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'ליל שישי', 'יום שישי']);
    expect(nodes[1].nodes[2].nodes.map(n => n.heTitle)).toEqual(WEEKDAY_PARTS);
    expect(sections).toContain(`${TITLE}, S2, S3, S8`);
  });

  test('the catalogue: one book, its hash from Otzaria\'s manifest, in place of Otzaria\'s five volumes', () => {
    const manifest = Object.fromEntries(VOLUMES.map((v, i) => [v.path, {hash: `h${i}`}]));
    expect(hashFromManifest(manifest)).toBe('h0,h1,h2,h3,h4');
    expect(hashFromManifest({})).toBeNull();
    const otzariaVolumes = VOLUMES.map(v => entryForPath(v.path, 'x', {restricted: [], permitted: {}, in_sefaria: []}));
    expect(otzariaVolumes.every(Boolean)).toBe(true);
    const {books} = chooseBooks([], {otzaria: otzariaVolumes, chok: [catalogEntry('h')]});
    expect(Object.keys(books)).toEqual([TITLE]);
    expect(books[TITLE]).toMatchObject({source: 'chok', via: 'otzaria', license: 'unknown'});
  });

  test('turned on and downloaded like any extra book: five files from Otzaria, one book, offline', async () => {
    FileSystem.clear();
    await AsyncStorage.clear();
    extras._reset({loaded: true});
    serve();
    global.Sefaria = {_loadTOC: jest.fn(async () => extras.applyToToc([]))};
    await extras.setSourceEnabled('chok', true);
    expect(extras.isExtraTitle(TITLE)).toBe(true);
    expect(extras.needsDownload(TITLE)).toBe(true);
    const first = await extras.downloadBook(TITLE);
    expect(first).toBe(`${TITLE}, S1, S1`);
    const urls = global.fetch.mock.calls.map(c => c[0]).filter(u => !u.endsWith('files_manifest.json'));
    expect(urls).toHaveLength(5);
    urls.forEach(u => expect(u).toMatch(/^https:\/\/raw\.githubusercontent\.com\/Otzaria\/otzaria-library\/main\/OraytaToOtzaria\//));
    const zipped = JSON.parse(await FileSystem.readAsStringAsync(`library/${TITLE}.zip`));
    expect(Object.keys(zipped)).toContain(`${TITLE}_index.json`);
    expect(extras.isDownloaded(TITLE)).toBe(true);
    expect(extras.booksToUpdate('chok')).toEqual([]);
    delete global.Sefaria;
  });
});

describe("the week's parsha and the day (Hebrew calendar)", () => {
  test('the parsha of the coming Shabbat', () => {
    expect(weekParshiot(day(2026, 11, 11)).map(p => p.en)).toEqual(['Toldot']);
    expect(weekParshiot(day(2026, 11, 11))[0].he).toBe('תולדות');
    expect(PARSHIOT_EN).toHaveLength(PARSHIOT_HE.length);
  });

  test('a double week learns both parshiot', () => {
    // Shabbat 14 March 2026: Vayakhel-Pekudei
    expect(weekParshiot(day(2026, 3, 9)).map(p => p.en)).toEqual(['Vayakhel', 'Pekudei']);
  });

  test('a festival Shabbat: Sukkot is Vezot Haberakhah; otherwise the next parsha read', () => {
    expect(weekParshiot(day(2026, 9, 28)).map(p => p.en)).toEqual(['Vezot Haberakhah']);   // Sukkot 5787
    // Shabbat Chol HaMoed Pesach (24 April 2027): the next parsha read
    const pesach = weekParshiot(day(2027, 4, 19)).map(p => p.en);
    expect(pesach).toHaveLength(1);
    expect(PARSHIOT_EN).toContain(pesach[0]);
  });

  test('Thursday adds Thursday night; Shabbat has none', () => {
    expect(chokDayInfo(day(2026, 11, 12)).days.map(d => d.he)).toEqual(['יום חמישי', 'ליל שישי']);
    expect(chokDayInfo(day(2026, 11, 14))).toBeNull();
    expect(chokCalendarItem(day(2026, 11, 14))).toBeNull();
  });

  test('the date for the tab', () => {
    expect(dateLabel(day(2026, 11, 11))).toEqual({en: 'Wednesday, 11 Nov', he: 'יום רביעי, א׳ כסלו'});
  });
});

describe("the day's learning as one unit", () => {
  const index = () => INDEX().files[`${TITLE}_index.json`];

  test('prayers before learning, then every part of the day in order', () => {
    const seq = chokDaySequence(index(), chokCalendarItem(day(2026, 11, 10)));   // Tuesday, Toldot
    expect(seq.key).toBe('Chok LeYisrael');
    expect(isBounded(seq)).toBe(true);
    expect(seq.items.map(i => i.he)).toEqual([PRAYERS_HE, ...WEEKDAY_PARTS]);
    expect(seq.items.map(i => i.section)).toEqual([null, 'Torah', 'Prophets', 'Writings', 'Mishnah', 'Gemara', 'Zohar', 'Halakhah', 'Musar']);
    expect(seq.items[0].ref).toBe(`${TITLE}, S1, S2`);
    expect(seq.items[1].ref).toBe(`${TITLE}, S2, S3, S1`);
    expect(seq.tabLabel).toEqual({en: 'Chok LeYisrael — Tuesday, 10 Nov', he: 'חק לישראל — יום שלישי, ל׳ חשון'});
    expect(tabLabel({title: TITLE, ref: seq.items[1].ref, schedule: seq}, false)).toBe(seq.tabLabel.en);
    expect(tabLabel({title: TITLE, ref: seq.items[1].ref, schedule: seq}, true)).toBe(seq.tabLabel.he);
  });

  test('Thursday continues into Thursday night; Friday has the haftarah', () => {
    const thu = chokDaySequence(index(), chokCalendarItem(day(2026, 11, 12)));
    expect(thu.items[thu.items.length - 1]).toMatchObject({he: 'ליל שישי: תורה', en: 'Thursday night: Torah', ref: `${TITLE}, S2, S6, S1`});
    const fri = chokDaySequence(index(), chokCalendarItem(day(2026, 11, 13)));
    expect(fri.items.map(i => i.section)).toEqual([null, 'Torah', 'Haftarah', 'Mishnah', 'Musar']);
  });

  test('a double week: both parshiot, each part named with its parsha', () => {
    const seq = chokDaySequence(index(), chokCalendarItem(day(2026, 3, 9)));
    expect(seq.items).toHaveLength(1 + 2 * WEEKDAY_PARTS.length);
    expect(seq.items[1].he).toBe('ויקהל: תורה');
    expect(seq.items[1 + WEEKDAY_PARTS.length].en).toBe('Pekudei: Torah');
  });

  test('a day the book does not have: nothing to open', () => {
    expect(chokDaySequence(index(), chokCalendarItem(day(2027, 1, 4)))).toBeNull();   // Shemot: not in the cut-down book
    expect(chokDaySequence(null, chokCalendarItem(day(2026, 11, 10)))).toBeNull();
  });

  test("reading goes from one part to the next and ends after the day's last", () => {
    const seq = chokDaySequence(index(), chokCalendarItem(day(2026, 11, 10)));
    const refs = seq.items.map(i => i.ref);
    const book = {prev: 'book prev', next: 'book next'};
    expect(boundedNeighbours(seq, refs[0], book)).toEqual({prev: null, next: refs[1]});
    expect(boundedNeighbours(seq, refs[3], book)).toEqual({prev: refs[2], next: refs[4]});
    expect(boundedNeighbours(seq, refs[refs.length - 1], book)).toEqual({prev: refs[refs.length - 2], next: null});
    expect(isLastReading(seq, refs[refs.length - 1])).toBe(true);
    expect(isLastReading(seq, refs[1])).toBe(false);
    // elsewhere in the book (its contents), and in other schedules, the book's own order
    expect(boundedNeighbours(seq, `${TITLE}, S2, S5, S1`, book)).toBe(book);
    expect(boundedNeighbours({...seq, bounded: false}, refs[1], book)).toBe(book);
    expect(readingIndexOf(seq, refs[2])).toBe(2);
  });

  test('part kinds from their headings', () => {
    expect(partKind('גמרא ב"ק דף ט"ז ע"ב')).toBe('Gemara');
    expect(partKind('הפטרת בראשית - ישעיה מב')).toBe('Haftarah');
    expect(partKind('משהו אחר')).toBeNull();
  });
});

describe('weeks without a regular parsha: the upcoming one (Chok LeYisrael\'s custom)', () => {
  const week = (d, israel = false) => weekParshiot(d, israel).map(p => p.en);

  test('Pesach 5787: Acharei Mot in the week of Chol HaMoed and again in the week it is read', () => {
    // 15 Nisan 5787 is Thursday 22 April 2027: Shabbat 24 April is Chol HaMoed, 1 May Acharei Mot
    for (const israel of [false, true]) {
      for (let d = 18; d <= 23; d++) { expect(week(day(2027, 4, d), israel)).toEqual(['Achrei Mot']); }
      for (let d = 25; d <= 30; d++) { expect(week(day(2027, 4, d), israel)).toEqual(['Achrei Mot']); }
      expect(week(day(2027, 5, 2), israel)).toEqual(['Kedoshim']);
    }
    expect(chokCalendarItem(day(2027, 4, 22)).summary).toEqual({en: 'Achrei Mot, Thursday', he: 'אחרי מות, יום חמישי'});
  });

  test('Pesach 5788: Shemini in the week of Chol HaMoed, then Tazria-Metzora', () => {
    // 15 Nisan 5788 is Tuesday 11 April 2028: Shabbat 15 April is Chol HaMoed, 22 April Shemini
    for (const israel of [false, true]) {
      for (let d = 9; d <= 14; d++) { expect(week(day(2028, 4, d), israel)).toEqual(['Shmini']); }
      for (let d = 16; d <= 21; d++) { expect(week(day(2028, 4, d), israel)).toEqual(['Shmini']); }
      expect(week(day(2028, 4, 23), israel)).toEqual(['Tazria', 'Metzora']);
    }
  });

  test('Shavuot on Shabbat (diaspora 5787) and Yom Kippur on Shabbat (5789): the next parsha read', () => {
    // the second day of Shavuot is Shabbat 12 June 2027 in the diaspora; in Israel Naso is read then
    expect(week(day(2027, 6, 7))).toEqual(['Nasso']);
    expect(week(day(2027, 6, 14))).toEqual(['Nasso']);
    expect(week(day(2027, 6, 7), true)).toEqual(['Nasso']);
    expect(week(day(2027, 6, 14), true)).toEqual(["Beha'alotcha"]);
    // Yom Kippur 5789 is Shabbat 30 September 2028: Vezot Haberakhah, as in the week of Sukkot
    expect(week(day(2028, 9, 26))).toEqual(['Vezot Haberakhah']);
    expect(week(day(2028, 10, 3))).toEqual(['Vezot Haberakhah']);
    expect(week(day(2028, 10, 9))).toEqual(['Bereshit']);
    // Rosh Hashanah 5787 is Shabbat 12 September 2026: Ha'azinu, read on Shabbat Shuva
    expect(week(day(2026, 9, 8))).toEqual(["Ha'Azinu"]);
  });

  test('every day but Shabbat has a portion of the sefer, 5787-5789, in Israel and the diaspora', () => {
    const missing = [];
    for (const israel of [false, true]) {
      for (let d = day(2026, 9, 1); d < day(2029, 9, 1); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        const info = chokDayInfo(d, {israel});
        if (d.getDay() === 6) { if (info) { missing.push(`Shabbat ${d.toDateString()}`); } continue; }
        if (!info || !info.parshiot.length || info.parshiot.some(p => !PARSHIOT_HE.includes(p.he))) {
          missing.push(`${israel ? 'IL' : 'DI'} ${d.toDateString()}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('a Chol HaMoed day opens its parsha\'s day in the sefer', () => {
    const index = INDEX().files[`${TITLE}_index.json`];
    // (the cut-down book has Toldot: a weekday in Toldot's week is opened as any other)
    expect(chokDaySequence(index, chokCalendarItem(day(2026, 11, 10))).items.length).toBeGreaterThan(1);
    // Chol HaMoed Pesach 5787 learns Acharei Mot, not in the cut-down book: nothing to open, no wrong day
    expect(chokDaySequence(index, chokCalendarItem(day(2027, 4, 25)))).toBeNull();
  });
});
