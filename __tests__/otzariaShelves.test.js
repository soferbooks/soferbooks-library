import { currentEntry, entryForPath } from '../extras/otzaria';
import { addToToc } from '../extras/catalog';

const PATH = 'National-LibraryToOtzaria/ספרים/אוצריא/הלכה/משנה תורה/מפרשים/המאיר לארץ.txt';

test('an Otzaria commentary on the Rambam stands with the Rambam\'s commentaries (owner, 2026-11-20)', () => {
  const e = currentEntry(entryForPath(PATH, 'h'));
  expect(e.categories).toEqual(['Halakhah', 'Mishneh Torah', 'Commentary']);
  // (a catalogue kept on the phone from before: moved too)
  const old = {id: PATH, categories: ['Halakhah', 'Otzaria', 'משנה תורה'], heCategories: ['הלכה', 'אוצריא', 'משנה תורה']};
  expect(currentEntry(old).categories).toEqual(['Halakhah', 'Mishneh Torah', 'Commentary']);
  // (the toc's own group is used: no second "Commentary")
  const toc = [{category: 'Halakhah', heCategory: 'הלכה', contents: [{category: 'Mishneh Torah', heCategory: 'משנה תורה', contents: [
    {category: 'Commentary', heCategory: 'מפרשים', contents: [{title: 'Kessef Mishneh', heTitle: 'כסף משנה'}]}]}]}];
  const out = addToToc(toc, {'המאיר לארץ': {...e, title: 'המאיר לארץ'}});
  const group = out[0].contents[0].contents;
  expect(group).toHaveLength(1);
  expect(group[0].contents.map(x => x.title)).toEqual(['Kessef Mishneh', 'המאיר לארץ']);
});

test('a book that is not in a commentary folder, or on a book Sefaria does not group, stays on Otzaria\'s shelf', () => {
  const plain = currentEntry(entryForPath('National-LibraryToOtzaria/ספרים/אוצריא/הלכה/ספר כלשהו.txt', 'h'));
  expect(plain.categories[1]).toBe('Otzaria');
  const yetzira = currentEntry(entryForPath('National-LibraryToOtzaria/ספרים/אוצריא/קבלה/ספר יצירה/מפרשים/פירוש.txt', 'h'));
  expect(yetzira.categories[1]).toBe('Otzaria');
});
