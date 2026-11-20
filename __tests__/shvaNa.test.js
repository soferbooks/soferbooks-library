import { markVerse, markSection, hashOf, _setMarks } from '../tanach/shvaNa';
import { marksOf } from '../tools/shvaNa/buildShvaNaMarks';

const MARKED = '<big>בּ׈</big>רֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשׁ׉ָמַ֖יִם ו׈אֵ֥ת הָאָֽרֶץ׃';
const entryFor = marked => {
  const m = marksOf(marked);
  return { plain: m.plain, entry: `${hashOf(m.plain)}|${m.na.map(i => i.toString(36)).join(',')}|${m.chazak.map(i => i.toString(36)).join(',')}` };
};

test('a pasuk as Sefaria has it gets the shva na and dagesh chazak SoferBooks prints', () => {
  const { plain, entry } = entryFor(MARKED);
  expect(plain).not.toMatch(/[׈׉]/);
  expect(markVerse(plain, entry)).toBe(MARKED);
});

test('the kamatz katan Sefaria marks does not stop it', () => {
  const marked = 'כׇּל׈ ב׈נֵי';    // (a made-up pasuk: a kamatz katan and two shva na)
  const { entry } = entryFor(marked.replace('ׇ', 'ָ'));
  expect(markVerse(marked.replace(/׈/g, 'ְ'), entry)).toBe(marked);
});

test('a different text is left alone unless every mark falls on its shva or dagesh', () => {
  const { plain, entry } = entryFor(MARKED);
  expect(markVerse(`${plain} עוד`, entry)).toBe(`${MARKED} עוד`);    // (longer: the places still fit)
  expect(markVerse(plain.slice(3), entry)).toBe(plain.slice(3));       // (shifted: left as it is)
});

test('a section of a Tanach book is marked by chapter and verse; other books are not touched', () => {
  const { plain, entry } = entryFor(MARKED);
  _setMarks({ books: { Genesis: { '1:1': entry } } });
  const tc = { sectionRef: 'Genesis 1', content: [{ segmentNumber: 1, he: plain, text: 'In the beginning' }, { segmentNumber: 2, he: 'x', text: '' }] };
  expect(markSection(tc, 'Genesis').content[0].he).toBe(MARKED);
  expect(markSection(tc, 'Genesis').content[1].he).toBe('x');
  expect(markSection(tc, 'Rashi on Genesis')).toBe(tc);
  _setMarks(null);
});

test('the marks file covers all of Tanach', () => {
  const data = require('../tanach/shvaNaMarks.json');
  expect(Object.keys(data.books).length).toBe(39);
  expect(Object.keys(data.books.Genesis).length).toBeGreaterThan(1500);
});
