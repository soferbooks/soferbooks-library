/**
 * Sofer's corrections applied to Sefaria's section files (corrections.js), and the hook in
 * offline.js that applies them on every read.
 */
import * as FileSystem from 'expo-file-system/legacy';
import md5 from 'md5';
import {applyOps, applyCorrections, textHash, clearCorrectionsCache} from '../corrections';

const OLD = 'וַיֹּ֥אמֶר קַ֖יִן אֶל־יְהֹוָ֑ה גָּד֥וֹל עֲוֺנִ֖י מִנְּשֹֽׂא׃';
const NEW = 'וַיֹּ֥אמֶר קַ֖יִן אֶל־יְהֹוָ֑ה גָּד֥וֹל עֲוֺנִ֖י מִנְּשֽׂוֹא׃';

beforeEach(() => {
  FileSystem.clear();
  clearCorrectionsCache();
});

test('hashes match the Python builder (md5 of UTF-8, first 12 hex digits)', () => {
  // values from sofer_corrections.text_hash
  expect(textHash('בְּרֵאשִׁית')).toBe('d6e86cd7efdb');
  expect(textHash('Hello')).toBe('8b1a9953c461');
});

test('replaces a passage only while Sefaria still has the text the patch was made from', () => {
  const chapter = ['first', OLD, 'third'];
  expect(applyOps(chapter, [[[1], textHash(OLD), NEW]])).toBe(1);
  expect(chapter).toEqual(['first', NEW, 'third']);

  // Sefaria changed the verse since: the operation does nothing
  const changed = ['first', 'a newer text from Sefaria', 'third'];
  expect(applyOps(changed, [[[1], textHash(OLD), NEW]])).toBe(0);
  expect(changed[1]).toBe('a newer text from Sefaria');
});

test('a fill goes in only where the edition has nothing, extending the section if needed', () => {
  const short = ['one', 'two'];
  expect(applyOps(short, [[[3], '', 'four']])).toBe(1);
  expect(short).toEqual(['one', 'two', '', 'four']);

  const has = ['one', 'the edition has it now'];
  expect(applyOps(has, [[[1], '', 'fill']])).toBe(0);
  expect(has[1]).toBe('the edition has it now');
});

test('paths reach into nested and wrapped section files; bad paths are ignored', () => {
  const payload = {ref: 'Zohar 1', sections: {'Zohar 1:2': ['a. ?', 'b']}};
  const ops = [
    [['sections', 'Zohar 1:2', 0], textHash('a. ?'), 'a?'],
    [['sections', 'missing', 0], textHash('b'), 'x'],
    [['sections', 'Zohar 1:2', 9, 1], textHash('b'), 'x'],
    'not an op',
  ];
  expect(applyOps(payload, ops)).toBe(1);
  expect(payload.sections['Zohar 1:2']).toEqual(['a?', 'b']);
});

test('applyCorrections reads library/_corrections/<Title>.json once and patches the right file', async () => {
  const name = `Genesis 4.${md5('Miqra according to the Masorah').substring(0, 8)}.he`;
  await FileSystem.writeAsStringAsync('library/_corrections/Genesis.json', JSON.stringify({
    title: 'Genesis',
    files: {[name]: [[[12], textHash(OLD), NEW]]},
  }));
  const verses = Array(13).fill('x');
  verses[12] = OLD;
  const out = await applyCorrections('Genesis', name, verses);
  expect(out[12]).toBe(NEW);

  // another version of the same section is left alone
  const other = Array(13).fill('x');
  other[12] = OLD;
  await applyCorrections('Genesis', 'Genesis 4.12345678.he', other);
  expect(other[12]).toBe(OLD);

  // no file for the book, or a damaged one: the text as Sefaria has it
  expect(await applyCorrections('Exodus', 'Exodus 1.abc.he', ['y'])).toEqual(['y']);
  await FileSystem.writeAsStringAsync('library/_corrections/Psalms.json', '{not json');
  expect(await applyCorrections('Psalms', 'Psalms 1.abc.en', ['z'])).toEqual(['z']);
});
