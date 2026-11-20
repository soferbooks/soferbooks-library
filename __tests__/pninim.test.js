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
