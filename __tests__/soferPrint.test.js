import AsyncStorage from '@react-native-async-storage/async-storage';
import {pickMatch, lookUp, printableTitle, orderUrl, _reset} from '../soferPrint';

// soferbooks.com's /api/library/search answers (as the live site answered, 2026-11-11)
const SITE = {
  'Genesis': [{title: 'Genesis', he_title: 'בראשית'}, {title: 'Bereshit Rabbah', he_title: 'בראשית רבה', matched: 'Genesis Rabbah'}],
  'Ben Ish Hai': [{title: 'Ben Ish Hai Halachot', he_title: 'בן איש חי - הלכות', matched: 'Ben Ish Hai'}, {title: 'Ben Ish Hai Drashot', he_title: 'בן איש חי - דרשות', matched: 'Ben Ish Chai Derashos'}],
  'Tur': [{title: 'Tur, Orach Chayim', he_title: 'טור אורח חיים'}, {title: 'Tur, Yoreh De\'ah', he_title: 'טור יורה דעה'}],
  'Book of Jubilees': [],
  'עוד יוסף חי (1)': [],
  'עוד יוסף חי': [{title: 'Od Yosef Chai', he_title: 'עוד יוסף חי'}],
};

beforeEach(async () => {
  _reset();
  await AsyncStorage.clear();
  global.fetch = jest.fn(async url => {
    const q = decodeURIComponent(url.match(/[?&]q=([^&]*)/)[1]);
    return {ok: true, json: async () => ({results: SITE[q] || []})};
  });
});

describe('which of the site\'s results is the book', () => {
  test('the same title, not a book that merely answers to a similar name', () => {
    expect(pickMatch(SITE.Genesis, 'Genesis', 'בראשית')).toBe('Genesis');
    expect(pickMatch(SITE.Genesis, 'Genesis Rabbah')).toBe('Bereshit Rabbah');   // (its other name)
    expect(pickMatch(SITE.Genesis, 'Exodus', 'שמות')).toBe(null);
  });
  test('a book Sofer splits: the part that answers to its name, or its first part', () => {
    expect(pickMatch(SITE['Ben Ish Hai'], 'Ben Ish Hai', 'בן איש חי')).toBe('Ben Ish Hai Halachot');
    expect(pickMatch(SITE.Tur, 'Tur', 'טור')).toBe('Tur, Orach Chayim');
  });
  test('an extra source\'s book by its Hebrew name', () => {
    expect(pickMatch(SITE['עוד יוסף חי'], 'עוד יוסף חי (1)', 'עוד יוֹסֵף חַי')).toBe('Od Yosef Chai');
  });
});

describe('asking the site', () => {
  test('a book Sofer does not sell is not offered', async () => {
    expect(await lookUp('Book of Jubilees', 'ספר היובלים')).toBe(null);
  });
  test('an extra book is looked up by its Hebrew name when its title finds nothing', async () => {
    expect(await lookUp('עוד יוסף חי (1)', 'עוד יוסף חי')).toBe('Od Yosef Chai');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
  test('the answer is kept on the phone for a week', async () => {
    const now = Date.now();
    expect(await printableTitle('Genesis', 'בראשית', now)).toBe('Genesis');
    _reset();                                      // (as after the app restarts)
    global.fetch.mockClear();
    expect(await printableTitle('Genesis', 'בראשית', now + 1000)).toBe('Genesis');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(await printableTitle('Genesis', 'בראשית', now + 8 * 24 * 3600 * 1000)).toBe('Genesis');
    expect(global.fetch).toHaveBeenCalled();
  });
  test('a "not sold" is kept for a day only, so a book the site adds shows up the next day', async () => {
    const now = Date.now();
    global.fetch = jest.fn(async () => ({ok: true, json: async () => ({results: []})}));
    expect(await printableTitle('Genesis', 'בראשית', now)).toBe(null);
    global.fetch = jest.fn(async () => ({ok: true, json: async () => ({results: SITE.Genesis})}));
    expect(await printableTitle('Genesis', 'בראשית', now + 3600 * 1000)).toBe(null);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(await printableTitle('Genesis', 'בראשית', now + 25 * 3600 * 1000)).toBe('Genesis');
  });
  test('answers kept by the first builds (a "not sold" for a week) are not used', async () => {
    await AsyncStorage.setItem('soferPrintable:v1', JSON.stringify({Genesis: {sofer: null, at: Date.now()}}));
    expect(await printableTitle('Genesis', 'בראשית')).toBe('Genesis');
  });
  test('offline: no link, and nothing kept', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline'); });
    expect(await printableTitle('Genesis', 'בראשית')).toBe(null);
    expect(await AsyncStorage.getItem('soferPrintable:v2')).toBe(null);
  });
});

test('the link opens the site\'s book editor on the sefer', () => {
  expect(orderUrl('Ben Ish Hai Drashot')).toBe('https://soferbooks.com/?tab=new&book=Ben%20Ish%20Hai%20Drashot');
});

test('the link is shown in the table of contents, "About this text" and the display menu', () => {
  // (a merge once dropped a mount; each screen must keep it)
  const fs = require('fs');
  const path = require('path');
  const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  expect(src('ReaderTextTableOfContents.js')).toMatch(/<PrintCopyLink title=\{title\}/);
  expect(src('AboutBox.js')).toMatch(/<PrintCopyLink title=\{d\.title\}/);
  expect(src('ReaderDisplayOptionsMenu.js')).toMatch(/<PrintCopyLink title=\{this\.props\.bookTitle\}/);
  expect(src('ReaderApp.js')).toMatch(/bookTitle=\{isSheet \? null : this\.state\.textTitle\}/);
});
