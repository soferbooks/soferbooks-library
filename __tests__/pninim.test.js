import pninim, { parseCatalog, editionOf, ID, LICENSE, RELEASE_URL } from '../extras/pninim';
import { SOURCES, READY_MADE } from '../sources';
import { EXTRA_SOURCES } from '../extras';
import { sizeOfEntry } from '../fullLibrary';

const NOTICE = 'זכויות יוצרים\nכל הזכויות שמורות ל"פנינים".\nhttps://www.gnu.org/licenses/fdl-1.3.html';
const book = (title, heTitle, extra = {}) => ({
  title, heTitle, file: `${title.replace(/ /g, '-')}.zip`, size: 2048, md5: 'm', sha256: 's', kind: 'sofer',
  categories: ['Halakhah', 'Shulchan Arukh'], heCategories: ['הלכה', 'שולחן ערוך'], license: ['GFDL 1.3'],
  versionNotesInHebrew: NOTICE, firstSection: `${title}, S1`, ...extra,
});
const CATALOG = {
  format: 1, source: 'pninim', tag: 'pninim-2026-11-20',
  bundle: {file: 'pninim-all.zip', size: 10, md5: 'b'},
  books: [book('Birkei Yosef', 'ברכי יוסף', {companions: [book('הערות המהדיר על ברכי יוסף', 'הערות המהדיר על ברכי יוסף')]})],
};

describe('Pninim library (extras/pninim.js)', () => {
  test('is a library of its own in Settings, ready made like the Sofer Library', () => {
    expect(SOURCES.find(s => s.id === 'pninim')).toMatchObject({name: 'Pninim', heName: 'פנינים', extra: true, available: true});
    expect(EXTRA_SOURCES.pninim).toBe(pninim);
    expect(READY_MADE.has('pninim')).toBe(true);
  });

  test('its catalogue: the books (and their notes) as this library\'s, with their licence and notice', () => {
    const [e] = parseCatalog(JSON.stringify(CATALOG));
    expect(e).toMatchObject({source: ID, title: 'Birkei Yosef', heTitle: 'ברכי יוסף', license: LICENSE, versionNotesInHebrew: NOTICE});
    expect(e.companions[0]).toMatchObject({source: ID, license: LICENSE});
    expect(pninim.bookUrl(e)).toBe(`${RELEASE_URL}/Birkei-Yosef.zip`);
    expect(sizeOfEntry(e)).toBe(4);       // (the book and its notes, from the catalogue)
  });

  test('each edition carries their name, site, licence and notice; errors go to Pninim', () => {
    const [e] = parseCatalog(CATALOG);
    const files = {'Birkei Yosef_index.json': {title: 'Birkei Yosef', versions: [{versionTitle: 'Pninim', language: 'he'}]}};
    const notes = {'הערות המהדיר על ברכי יוסף_index.json': {versions: [{versionTitle: 'Pninim', language: 'he'}]}};
    const out = pninim.convert(e, {book: {entry: e, files}, companions: [{entry: e.companions[0], files: notes}]});
    const v = out.files['Birkei Yosef_index.json'].versions[0];
    expect(v).toMatchObject({versionTitle: 'Pninim', versionTitleInHebrew: 'פנינים', versionSource: 'https://pninim.org',
      license: LICENSE, versionNotesInHebrew: NOTICE, librarySource: 'pninim'});
    expect(out.companions[0].files['הערות המהדיר על ברכי יוסף_index.json'].versions[0].librarySource).toBe('pninim');
    expect(editionOf({})).not.toHaveProperty('versionNotesInHebrew');
  });
});

describe('Pninim\'s better copies (the owner, 2026-11-20: "always use better versions")', () => {
  const { chooseBooks } = require('../extras/catalog');
  const { currentEntry, BETTER_THAN } = require('../extras/pninim');
  const otz = (id, heTitle) => ({source: 'otzaria', id, title: heTitle, heTitle, categories: ['Halakhah']});

  test('used instead of Otzaria\'s copies of their text; Artzot HaChaim stays Otzaria\'s (its linked commentaries)', () => {
    const pn = parseCatalog({...CATALOG, books: [
      book('Birkei Yosef', 'ברכי יוסף'), book('Asifat Zekenim', 'אסיפת זקנים'), book('Artzot HaChaim', 'ארצות החיים')]});
    const catalogs = {
      otzaria: [otz('o1', 'ברכי יוסף על אורח חיים'), otz('o2', 'ברכי יוסף על יורה דעה'), otz('o3', 'אסיפת זקנים'),
        otz('o4', 'ארצות החיים'), otz('o5', 'הערות על אסיפת זקנים')],
      pninim: pn,
    };
    const installed = {'ברכי יוסף על אורח חיים': {source: 'otzaria', id: 'o1'}, 'אסיפת זקנים': {source: 'otzaria', id: 'o3'},
      'ארצות החיים': {source: 'otzaria', id: 'o4'}, 'הערות על אסיפת זקנים': {source: 'otzaria', id: 'o5'}};
    const {books, superseded} = chooseBooks([], catalogs, {installed});
    expect(books['Birkei Yosef'].source).toBe('pninim');
    expect(books['ברכי יוסף על אורח חיים']).toBeUndefined();
    expect(books['ברכי יוסף על יורה דעה']).toBeUndefined();
    expect(books['Asifat Zekenim'].source).toBe('pninim');
    expect(books['ארצות החיים'].source).toBe('otzaria');
    expect(books['Artzot HaChaim']).toBeUndefined();
    // (the downloaded copies the phone need not keep once Pninim's are there)
    expect(superseded).toEqual({'ברכי יוסף על אורח חיים': 'Birkei Yosef', 'אסיפת זקנים': 'Asifat Zekenim',
      'הערות על אסיפת זקנים': 'Asifat Zekenim'});
  });

  test('a catalogue kept on the phone from before gets the preference too', () => {
    expect(currentEntry({title: 'Birkei Yosef'})).toMatchObject({preferred: true, replaces: BETTER_THAN['Birkei Yosef']});
    expect(currentEntry({title: 'Artzot HaChaim'})).not.toHaveProperty('preferred');
  });
});
