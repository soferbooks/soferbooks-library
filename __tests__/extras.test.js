/**
 * Extra sources (extras/): Otzaria's books converted on the phone as Sofer converts them,
 * merged into the library with Sefaria first, restricted books left out, downloaded on demand.
 *
 * The conversion fixtures (__tests__/fixtures/otzaria/*.txt) have their expected results made
 * by Sofer's own importer (tools/library-export/otzaria_fixtures.py -> *.sofer.json).
 * "Zips" are JSON objects {name: content}, as in localSearch.test.js.
 */
import fs from 'fs';
import path from 'path';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {zip} from 'react-native-zip-archive';
import md5 from 'md5';
import {Alert} from 'react-native';
import {safe, normTitle, hebrewNumber, restricted, permission, Node, inlineRun} from '../extras/tree';
import {sectionsOf, bookFiles, tocItem} from '../extras/schema7';
import {chooseBooks, addToToc, PRECEDENCE} from '../extras/catalog';
import otzaria, {otzariaTree, parseCatalog, entryForPath, bookUrl, versionOf, COLLECTIONS} from '../extras/otzaria';
import * as extras from '../extras';
import {ERRORS} from '../errors';
import {correctionEmail} from '../reportError';
import {bookLines} from '../localSearch';

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
    unzip: jest.fn(async (zipPath, dest) => {
      const entries = JSON.parse(await fsMock.readAsStringAsync(zipPath));
      for (const [name, content] of Object.entries(entries)) {
        await fsMock.writeAsStringAsync(dest ? `${dest}${name}` : `/${name}`, content);
      }
      return dest;
    }),
  };
});

const FIXTURES = path.join(__dirname, 'fixtures', 'otzaria');
const fixture = name => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

/** The book's sections as the fixtures' expected files list them: [{path, paras}] */
function sectionsForCompare(tree) {
  const out = [];
  const walk = (node, trail) => {
    const parts = [];
    if (node.paras.length) { parts.push({title: '', paras: node.paras, children: []}); }
    node.children.forEach(c => { if (!c.empty()) { parts.push(c); } });
    for (const c of parts) {
      if (c.children.length) { walk(c, trail.concat(c.title)); } else { out.push({path: trail.concat(c.title), paras: c.paras}); }
    }
  };
  walk(tree, []);
  return out;
}

// ---------------------------------------------------------------- the text rules (tree.js)

describe('Sofer\'s text rules', () => {
  test('names: safe() and normTitle() as importers.safe / norm_title', () => {
    expect(safe('שו"ת חתם סופר: חלק א.')).toBe('שו-ת חתם סופר- חלק א');
    expect(safe('  a   b  ')).toBe('a b');
    expect(safe('')).toBe('untitled');
    // nikud, maqaf, quotes and punctuation do not make another sefer
    expect(normTitle('שׁוּ״ת  חתם־סופר')).toBe(normTitle('שו"ת חתם סופר'));
    expect(normTitle('(ספר) הַחִנּוּךְ.')).toBe('ספר החנוך');
  });

  test('Hebrew numbers', () => {
    expect(hebrewNumber('קס"ה')).toBe(165);
    expect(hebrewNumber('טו')).toBe(15);
    expect(hebrewNumber('יה')).toBe(15);    // (letters in order: a number, as Sofer's)
    expect(hebrewNumber('אב')).toBeNull();
    expect(hebrewNumber('abc')).toBeNull();
  });

  test('a book\'s own notice (importers.restricted), Pninim\'s GNU notice is free', () => {
    expect(restricted('ספר\nללימוד אישי בלבד\nטקסט')).toBe(true);
    expect(restricted('Licensed CC BY-NC-SA 4.0')).toBe(true);
    expect(restricted('כל הזכויות שמורות למחבר')).toBe(true);
    expect(restricted('כל הזכויות שמורות, ומופץ תחת רישיון GNU FDL החופשי')).toBe(false);
    expect(restricted('© פרויקט פנינים - GFDL')).toBe(false);
    expect(restricted('ספר רגיל בלי שום הודעה')).toBe(false);
    // only the start of the book counts
    expect(restricted(`${'א'.repeat(20001)} כל הזכויות שמורות`)).toBe(false);
    // "NC" counts only as a word of its own (Python's \b: a Hebrew letter is a word letter)
    expect(restricted('אNC')).toBe(false);
  });

  test('Rav Yosef Peretz\'s books: restricted, but by permission', () => {
    const text = 'כל הזכויות שמורות להרב יוסף פרץ\nתוכן';
    expect(restricted(text)).toBe(true);
    expect(permission(text)).toMatch(/Rav Yosef Peretz/);
    expect(otzaria.isRestricted(text)).toBe(false);
    expect(otzaria.isRestricted('כל הזכויות שמורות')).toBe(true);
  });

  test('headings inside the text need a run of at least five numbered in order', () => {
    const four = ['סימן א טקסט. סימן ב טקסט. סימן ג טקסט. סימן ד טקסט.'];
    expect(inlineRun(four)).toEqual([]);
    const five = ['פתיחה: סימן א טקסט. סימן ב טקסט. סימן ג טקסט. סימן ד טקסט. סימן ה סוף.'];
    expect(inlineRun(five).map(r => r[3])).toEqual(['סימן א', 'סימן ב', 'סימן ג', 'סימן ד', 'סימן ה']);
  });
});

// ---------------------------------------------------------------- Otzaria's text (fixtures)

describe('Otzaria conversion = Sofer\'s importer (fixtures)', () => {
  const names = fs.readdirSync(FIXTURES).filter(n => n.endsWith('.txt'));
  test.each(names)('%s', name => {
    const expected = JSON.parse(fixture(name.replace(/\.txt$/, '.sofer.json')));
    const [tree, author] = otzariaTree(fixture(name));
    expect(author).toBe(expected.author);
    expect(sectionsForCompare(tree)).toEqual(expected.sections);
  });

  test('the reader\'s files: an index, a metadata and a text file a section, prev/next across sections', () => {
    const [tree, author] = otzariaTree(fixture('synthetic_nested.txt'));
    expect(author).toBe('מאת המחבר');
    const entry = {
      title: 'ספר בדיקה', heTitle: 'ספר בדיקה', categories: ['Halakhah', 'Otzaria', 'אחרונים'],
      heCategories: ['הלכה', 'אוצריא', 'אחרונים'], collection: 'Ben-Yehuda', license: 'Public Domain',
    };
    const {files, firstSection, sections} = bookFiles(tree, {...entry, version: versionOf(entry, '')});
    // the unnamed opening is a named section (S0, named after the book); Sofer's keys otherwise
    expect(sections).toEqual([
      'ספר בדיקה, S0', 'ספר בדיקה, S1, S1', 'ספר בדיקה, S1, S2, S0', 'ספר בדיקה, S1, S2, S1',
      'ספר בדיקה, S2, S0', 'ספר בדיקה, S2, S1',
    ]);
    expect(firstSection).toBe('ספר בדיקה, S0');
    const index = files['ספר בדיקה_index.json'];
    expect(index.schema.nodes.map(n => [n.key, n.heTitle, n.nodeType])).toEqual([
      ['S0', 'ספר בדיקה', 'JaggedArrayNode'], ['S1', 'חלק ראשון', 'SchemaNode'], ['S2', 'חלק שני', 'SchemaNode'],
    ]);
    expect(index.versions[0]).toMatchObject({
      versionTitle: 'Otzaria (Ben-Yehuda)', language: 'he', license: 'Public Domain', librarySource: 'otzaria',
    });
    const meta = files['ספר בדיקה, S1, S2, S1.metadata.json'];
    expect(meta).toMatchObject({
      heRef: 'ספר בדיקה, חלק ראשון, פרק ב, הערה', sectionRef: 'ספר בדיקה, S1, S2, S1',
      prev: 'ספר בדיקה, S1, S2, S0', next: 'ספר בדיקה, S2, S0',
    });
    const hash = md5('Otzaria (Ben-Yehuda)').substring(0, 8);
    expect(files[`ספר בדיקה, S1, S1.${hash}.he.json`]).toEqual(['<b>תחילת</b> הפסקה הראשונה של פרק א.', 'פסקה שנייה של פרק א.']);
    // a heading's markup is left out of its name
    expect(files['ספר בדיקה, S2, S1.metadata.json'].heRef).toBe('ספר בדיקה, חלק שני, סימן א');
  });

  test('a book with no headings is one section', () => {
    const t = new Node('');
    t.paras = ['אחת', 'שתיים'];
    const {leaves} = sectionsOf(t, 'שם');
    expect(leaves).toEqual([{keys: ['S0'], heTitles: ['שם'], paras: ['אחת', 'שתיים']}]);
  });

  test('offline search lines in localSearch.js\'s format', async () => {
    const [tree] = otzariaTree(fixture('synthetic_nested.txt'));
    const entry = {title: 'ספר בדיקה', heTitle: 'ספר בדיקה', categories: ['X', 'Otzaria', 'Y'], collection: 'Pninim', license: 'GFDL'};
    const {files} = bookFiles(tree, {...entry, version: versionOf(entry, '')});
    const lines = await extras.searchLines(files);
    expect(lines).toContain('ספר בדיקה, S1, S1:1\tספר בדיקה, חלק ראשון, פרק א:1\the\tOtzaria (Pninim)\tתחילת הפסקה הראשונה של פרק א.');
    expect(lines).toHaveLength(7);
    // (the same function Sefaria's books use)
    expect(typeof bookLines).toBe('function');
  });
});

// ---------------------------------------------------------------- Otzaria's catalogue

describe('Otzaria catalogue', () => {
  const RULES = {
    restricted: ['KSK|ספר מוגבל'],
    permitted: {'MoreBooks|ספר ברשות': 'By permission of Rav Yosef Peretz'},
    in_sefaria: ['National-Library|תורת משה'],
  };
  const manifest = {
    'Ben-YehudaToOtzaria/ספרים/אוצריא/מחשבת ישראל/ראשונים/ספר העצמים.txt': {hash: 'h1'},
    'Ben-YehudaToOtzaria/links/ספר העצמים_links.json': {hash: 'x'},
    'KSK/ספרים/אוצריא/תלמוד בבלי/ראשונים/ספר מוגבל.txt': {hash: 'h2'},
    'KSK/ספרים/אוצריא/תלמוד בבלי/ראשונים/ספר חופשי.txt': {hash: 'h3'},
    'MoreBooks/ספרים/אוצריא/הלכה/אחרונים/ספר ברשות.txt': {hash: 'h4'},
    'MoreBooks/ספרים/אוצריא/הלכה/אחרונים/ספר אחר.txt': {hash: 'h5'},
    'DictaToOtzaria/ערוך/ספרים/אוצריא/שות/אחרונים/ספר של דיקטה.txt': {hash: 'h6'},
    'wikiJewishBooksToOtzaria/ספרים/אוצריא/מדרש/ספר בהרשאה.txt': {hash: 'h7'},
    'tashmaToOtzaria/ספרים/אוצריא/הלכה/ספר תא שמע.txt': {hash: 'h8'},
    'MoreBooks/ספרים/אוצריא/אודות התוכנה/מדריך.txt': {hash: 'h9'},
    'National-LibraryToOtzaria/ספרים/אוצריא/הלכה/משנה תורה/מפרשים/תורת משה.txt': {hash: 'h10'},
    'pninimToOtzaria/ספרים/אוצריא/תנך/ספר בלי קטגוריה.txt': {hash: 'h11'},
    'NewCollection/ספרים/אוצריא/הלכה/ספר חדש.txt': {hash: 'h12'},
  };

  test('which books are offered, under which categories and licences', () => {
    const entries = parseCatalog(JSON.stringify(manifest), RULES);
    expect(entries.map(e => e.heTitle).sort()).toEqual(['ספר בלי קטגוריה', 'ספר ברשות', 'ספר העצמים', 'ספר חופשי'].sort());
    const atzamim = entries.find(e => e.heTitle === 'ספר העצמים');
    expect(atzamim).toMatchObject({
      source: 'otzaria', hash: 'h1', collection: 'Ben-Yehuda', license: 'Public Domain',
      categories: ['Jewish Thought', 'Otzaria', 'ראשונים'], heCategories: ['מחשבת ישראל', 'אוצריא', 'ראשונים'],
    });
    expect(entries.find(e => e.heTitle === 'ספר ברשות').license).toMatch(/Rav Yosef Peretz/);
    expect(entries.find(e => e.heTitle === 'ספר בלי קטגוריה').categories).toEqual(['Tanakh', 'Otzaria', 'General']);
  });

  test('a book is downloaded from Otzaria\'s own repository, one file', () => {
    const e = entryForPath('Ben-YehudaToOtzaria/ספרים/אוצריא/מחשבת ישראל/ראשונים/ספר העצמים.txt', 'h', RULES);
    expect(bookUrl(e)).toBe('https://raw.githubusercontent.com/Otzaria/otzaria-library/main/Ben-YehudaToOtzaria/'
      + `${encodeURIComponent('ספרים')}/${encodeURIComponent('אוצריא')}/${encodeURIComponent('מחשבת ישראל')}/`
      + `${encodeURIComponent('ראשונים')}/${encodeURIComponent('ספר העצמים')}.txt`);
  });

  test('every collection named in the README is decided', () => {
    expect(Object.keys(COLLECTIONS)).toEqual(expect.arrayContaining([
      'MoreBooks', 'KSK', 'DictaToOtzaria', 'wikiJewishBooksToOtzaria', 'tashmaToOtzaria', 'BeitAharonVeYisraelToOtzaria']));
    expect(COLLECTIONS.wikiJewishBooksToOtzaria.offered).toBe(false);
    expect(COLLECTIONS.BeitAharonVeYisraelToOtzaria.offered).toBe(false);
  });
});

// ---------------------------------------------------------------- the library (catalog.js)

const SEFARIA_TOC = [
  {category: 'Halakhah', heCategory: 'הלכה', contents: [
    {title: 'Mishneh Torah, Prayer', heTitle: 'משנה תורה, הלכות תפילה', categories: ['Halakhah']},
    {title: 'Kitzur Shulchan Arukh', heTitle: 'קיצור שולחן ערוך', categories: ['Halakhah']},
  ]},
];
const entry = (source, id, heTitle, cats = ['Halakhah', 'Otzaria', 'אחרונים']) => ({
  source, id, heTitle, categories: cats, heCategories: [null, source === 'dicta' ? 'ספריית דיקטה' : 'אוצריא', cats[2]], hash: `${id}-hash`,
});

describe('one copy of each sefer, Sefaria first', () => {
  test('the order', () => { expect(PRECEDENCE).toEqual(['sefaria', 'dicta', 'otzaria', 'wikisource']); });

  test('Sefaria\'s book wins (names compared without nikud and quotes); Dicta beats Otzaria', () => {
    const {books, skipped} = chooseBooks(SEFARIA_TOC, {
      otzaria: [entry('otzaria', 'o1', 'קִיצוּר שׁוּלְחָן עָרוּךְ'), entry('otzaria', 'o2', 'ספר יחיד'), entry('otzaria', 'o3', 'שו"ת משותף')],
      dicta: [entry('dicta', 'd1', 'שו״ת משותף')],
    });
    expect(Object.keys(books).sort()).toEqual(['ספר יחיד', 'שו״ת משותף'].sort());
    expect(books['שו״ת משותף'].source).toBe('dicta');
    expect(skipped.duplicate).toBe(2);
  });

  test('blocked books are left out; a downloaded book keeps its title; titles stay unique', () => {
    const toc = [{category: 'Halakhah', contents: [{title: 'ספר', heTitle: 'other name'}]}];
    const {books} = chooseBooks(toc, {otzaria: [entry('otzaria', 'a', 'ספר'), entry('otzaria', 'b', 'אסור'), entry('otzaria', 'c', 'שמור')]}, {
      blocked: {'otzaria|b': 'notice'}, installed: {'שמור (ישן)': {source: 'otzaria', id: 'c'}},
    });
    expect(Object.keys(books).sort()).toEqual(['ספר (2)', 'שמור (ישן)'].sort());
  });

  test('placed under Sefaria\'s category, then the source, then its shelf; the toc given is not changed', () => {
    const {books} = chooseBooks(SEFARIA_TOC, {otzaria: [entry('otzaria', 'o2', 'ספר יחיד'), entry('otzaria', 'o4', 'מוסר', ['Musar', 'Otzaria', 'כללי'])]});
    const before = JSON.stringify(SEFARIA_TOC);
    const toc = addToToc(SEFARIA_TOC, books, {'ספר יחיד': 'ספר יחיד, S1'});
    expect(JSON.stringify(SEFARIA_TOC)).toBe(before);
    const halakhah = toc.find(c => c.category === 'Halakhah');
    const otz = halakhah.contents.find(c => c.category === 'Otzaria');
    expect(otz.heCategory).toBe('אוצריא');
    expect(otz.contents[0].contents[0]).toMatchObject({
      title: 'ספר יחיד', heTitle: 'ספר יחיד', firstSection: 'ספר יחיד, S1', librarySource: 'otzaria', primary_category: 'Halakhah',
    });
    const musar = toc.find(c => c.category === 'Musar');
    expect(musar.heCategory).toBe('מוסר');
    expect(musar.contents[0].contents[0].contents[0].firstSection).toBe('מוסר');   // not downloaded: its title
    expect(tocItem({...entry('otzaria', 'x', 'y'), title: 'y'})).toMatchObject({firstSection: 'y'});
  });
});

// ---------------------------------------------------------------- on the phone (index.js)

const BOOK_TEXT = fixture('synthetic_nested.txt');
const CATALOG = parseCatalog(JSON.stringify({
  'Ben-YehudaToOtzaria/ספרים/אוצריא/הלכה/אחרונים/ספר בדיקה מקונן.txt': {hash: 'v1'},
  'KSK/ספרים/אוצריא/הלכה/אחרונים/ספר שמור.txt': {hash: 'v1'},
}), {restricted: [], permitted: {}, in_sefaria: []});

function serve(map) {
  global.fetch = jest.fn(async url => {
    const hit = Object.entries(map).find(([k]) => url.endsWith(k));
    if (!hit) { return {ok: false, status: 404, text: async () => ''}; }
    return {ok: true, status: 200, text: async () => hit[1]};
  });
}

describe('downloading and deleting a book', () => {
  beforeEach(async () => {
    FileSystem.clear();
    await AsyncStorage.clear();
    zip.mockClear();
    extras._reset({enabled: {otzaria: true}, catalogs: {otzaria: {fetchedAt: Date.now(), entries: CATALOG}}});
    extras.applyToToc(SEFARIA_TOC);
  });

  test('the books are in the library, not downloaded', () => {
    expect(extras.isExtraTitle('ספר בדיקה מקונן')).toBe(true);
    expect(extras.needsDownload('ספר בדיקה מקונן')).toBe(true);
    expect(extras.isExtraTitle('Kitzur Shulchan Arukh')).toBe(false);
  });

  test('download: from the source, converted, zipped, searchable, remembered', async () => {
    serve({[encodeURIComponent('ספר בדיקה מקונן') + '.txt']: BOOK_TEXT});
    const first = await extras.downloadBook('ספר בדיקה מקונן');
    expect(first).toBe('ספר בדיקה מקונן, S0');
    expect(global.fetch.mock.calls[0][0]).toMatch(/^https:\/\/raw\.githubusercontent\.com\/Otzaria\/otzaria-library\/main\/Ben-YehudaToOtzaria\//);
    const zipped = JSON.parse(await FileSystem.readAsStringAsync('library/ספר בדיקה מקונן.zip'));
    expect(Object.keys(zipped)).toContain('ספר בדיקה מקונן_index.json');
    expect(Object.keys(zipped)).toHaveLength(1 + 2 * 6);
    const search = await FileSystem.readAsStringAsync('library/ספר בדיקה מקונן_search.txt');
    expect(search.split('\n').filter(Boolean)).toHaveLength(7);
    expect(extras.isDownloaded('ספר בדיקה מקונן')).toBe(true);
    expect(extras.firstSectionOf('ספר בדיקה מקונן')).toBe(first);
    const state = JSON.parse(await FileSystem.readAsStringAsync('library/_extras/state.json'));
    expect(state.installed['ספר בדיקה מקונן']).toMatchObject({source: 'otzaria', hash: 'v1', converter: 2});
    // nothing to update until the source changes the book
    expect(extras.booksToUpdate('otzaria')).toEqual([]);
    extras._reset({enabled: {otzaria: true}, state, catalogs: {otzaria: {entries: CATALOG.map(e => ({...e, hash: 'v2'}))}}});
    extras.applyToToc(SEFARIA_TOC);
    expect(extras.booksToUpdate('otzaria')).toEqual(['ספר בדיקה מקונן']);
  });

  test('a book whose own notice forbids it is refused and leaves the library', async () => {
    serve({[encodeURIComponent('ספר שמור') + '.txt']: '<h1>ספר שמור</h1>\nכל הזכויות שמורות\nטקסט'});
    await expect(extras.downloadBook('ספר שמור')).rejects.toBeInstanceOf(extras.RestrictedBookError);
    expect(zip).not.toHaveBeenCalled();
    extras.applyToToc(SEFARIA_TOC);
    expect(extras.isExtraTitle('ספר שמור')).toBe(false);
  });

  test('delete: the files go, the book stays in the library', async () => {
    serve({[encodeURIComponent('ספר בדיקה מקונן') + '.txt']: BOOK_TEXT});
    await extras.downloadBook('ספר בדיקה מקונן');
    await extras.deleteBook('ספר בדיקה מקונן');
    expect((await FileSystem.getInfoAsync('library/ספר בדיקה מקונן.zip')).exists).toBe(false);
    expect((await FileSystem.getInfoAsync('library/ספר בדיקה מקונן_search.txt')).exists).toBe(false);
    expect(extras.needsDownload('ספר בדיקה מקונן')).toBe(true);
  });

  test('turning a source on downloads its catalogue; off deletes its books', async () => {
    extras._reset({loaded: true});
    serve({'files_manifest.json': JSON.stringify({'Ben-YehudaToOtzaria/ספרים/אוצריא/הלכה/אחרונים/ספר בדיקה מקונן.txt': {hash: 'v1'}}),
      [encodeURIComponent('ספר בדיקה מקונן') + '.txt']: BOOK_TEXT});
    global.Sefaria = {_loadTOC: jest.fn(async () => extras.applyToToc(SEFARIA_TOC))};
    await extras.setSourceEnabled('otzaria', true);
    expect(JSON.parse(await AsyncStorage.getItem(extras.ENABLED_KEY))).toEqual({otzaria: true});
    expect(extras.isExtraTitle('ספר בדיקה מקונן')).toBe(true);
    await extras.downloadBook('ספר בדיקה מקונן');
    await extras.setSourceEnabled('otzaria', false);
    expect(extras.isExtraTitle('ספר בדיקה מקונן')).toBe(false);
    expect((await FileSystem.getInfoAsync('library/ספר בדיקה מקונן.zip')).exists).toBe(false);
    delete global.Sefaria;
  });

  test('"Report a mistake" goes to the book\'s source (librarySource on its version)', () => {
    const [tree] = otzariaTree(BOOK_TEXT);
    const e = CATALOG[0];
    const {files} = bookFiles(tree, {...e, title: 'x', version: versionOf(e, BOOK_TEXT)});
    const version = files['x_index.json'].versions[0];
    expect(correctionEmail({ref: 'x, S0:1', text: 't', version, platform: 'android'}).source).toBe('otzaria');
  });
});

// ---------------------------------------------------------------- reading one (offlineOnline, DownloadControl)

describe('the reader and the download controller', () => {
  test('a book not downloaded is never asked of Sefaria\'s API', async () => {
    jest.resetModules();
    jest.doMock('../offline', () => ({
      ...jest.requireActual('../offline'),
      loadTextOffline: jest.fn(() => Promise.reject('Missing offline data')),
    }));
    const Sefaria = require('../sefaria').default;
    const ex = require('../extras');
    const {loadText} = require('../offlineOnline');
    const {ERRORS: E} = require('../errors');
    ex._reset({enabled: {otzaria: true}, catalogs: {otzaria: {entries: CATALOG}}});
    Sefaria._cacheIndexFromToc(ex.applyToToc(SEFARIA_TOC), true);
    const api = jest.spyOn(Sefaria.api, 'textApi');
    await expect(loadText('ספר בדיקה מקונן, S1', true)).rejects.toBe(E.EXTRA_NOT_DOWNLOADED);
    expect(api).not.toHaveBeenCalled();
    api.mockRestore();
    jest.dontMock('../offline');
  });

  test('Sefaria\'s downloads and updates leave the extra books alone', () => {
    jest.resetModules();
    const Sefaria = require('../sefaria').default;
    const ex = require('../extras');
    const shomer = require('../shomer');
    const {getFullBookList} = require('../DownloadControl');
    ex._reset({enabled: {otzaria: true}, catalogs: {otzaria: {entries: CATALOG}}});
    Sefaria.toc = shomer.applyToToc(ex.applyToToc(SEFARIA_TOC));
    Sefaria._cacheIndexFromToc(Sefaria.toc, true);
    expect(Sefaria.booksDict['ספר בדיקה מקונן']).toBe(1);
    expect(getFullBookList()).toEqual(expect.arrayContaining(['Kitzur Shulchan Arukh']));
    expect(getFullBookList()).not.toContain('ספר בדיקה מקונן');
  });

  test('the content filter applies to the extra books too', () => {
    jest.resetModules();
    const ex = require('../extras');
    const shomer = require('../shomer');
    const {configForPreset} = require('../shomer/presets');
    const alter = parseCatalog(JSON.stringify({
      'Ben-YehudaToOtzaria/ספרים/אוצריא/תנך/פרשנות/תולדות ישו.txt': {hash: 'z'},
    }), {restricted: [], permitted: {}, in_sefaria: []});
    ex._reset({enabled: {otzaria: true}, catalogs: {otzaria: {entries: CATALOG.concat(alter)}}});
    shomer.setConfig(configForPreset('strict_charedi'));
    shomer.applyToToc(ex.applyToToc(SEFARIA_TOC));
    expect(shomer.isBookHidden('תולדות ישו')).toBe(true);
    expect(shomer.isBookHidden('ספר בדיקה מקונן')).toBe(false);
    shomer.setConfig(null);
  });
});

// ---------------------------------------------------------------- the warning

describe('opening a book that is not downloaded', () => {
  // (each test loads the whole ReaderApp afresh after jest.resetModules: in the full run, with the
  // other suites' workers busy, that took longer than jest's 5 s and the test failed now and then)
  const READER_APP_TIMEOUT = 60000;

  test('a warning with a Download button; Download fetches, converts, then opens it', async () => {
    jest.resetModules();
    const React = require('react');
    const renderer = require('react-test-renderer');
    const {act} = renderer;
    const TestContextWrapper = require('../TestContextWrapper').default;
    const ReaderApp = require('../ReaderApp').default;
    const Sefaria = require('../sefaria').default;
    const ex = require('../extras');
    const strings = require('../LocalizedStrings').default;
    const {Alert: RNAlert} = require('react-native');
    const FS = require('expo-file-system/legacy');
    FS.clear();
    ex._reset({enabled: {otzaria: true}, catalogs: {otzaria: {entries: CATALOG}}});
    Sefaria._cacheIndexFromToc(ex.applyToToc(SEFARIA_TOC), true);
    serve({[encodeURIComponent('ספר בדיקה מקונן') + '.txt']: BOOK_TEXT});

    let inst;
    act(() => {
      inst = renderer.create(React.createElement(TestContextWrapper,
        {passContextToChildren: true, child: ReaderApp, childProps: {showErrorBoundary: () => {}}}));
    });
    const app = inst.root.findByType(ReaderApp).instance;
    const alert = jest.spyOn(RNAlert, 'alert').mockImplementation(() => {});
    app.showToast = jest.fn();

    const opened = app.openRef('ספר בדיקה מקונן', 'navigation');
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toBe(strings.extras.not_downloaded_title);
    expect(message).toContain('ספר בדיקה מקונן');
    expect(message.toLowerCase()).not.toContain('server');
    expect(buttons.map(b => b.text)).toEqual([strings.common.cancel, strings.download.download]);

    app.openRef = jest.fn(async () => {});   // (the second open, after the download)
    const {ExtraDownloadModal, ExtraDownloadStatus} = require('../ExtraDownloadProgress');
    let pending;
    act(() => { pending = buttons[1].onPress(); });
    // (while it downloads: the book's name, how far it is - a spinner, Otzaria's size not known - and Cancel)
    expect(inst.root.findAllByType(ExtraDownloadModal)).toHaveLength(1);
    expect(inst.root.findByType(ExtraDownloadModal).props.title).toBe('ספר בדיקה מקונן');
    await act(async () => { await pending; });
    await opened;
    expect(inst.root.findAllByType(ExtraDownloadModal)).toHaveLength(0);
    expect(ex.isDownloaded('ספר בדיקה מקונן')).toBe(true);
    expect(app.openRef).toHaveBeenCalledWith('ספר בדיקה מקונן, S0', 'navigation', undefined, true, false, false);

    // Cancel: the download stops, nothing opens, no error
    await act(async () => { await ex.deleteBook('ספר בדיקה מקונן'); });
    alert.mockClear();
    app.openRef.mockClear();
    const again = app.extraBookAlert('ספר בדיקה מקונן', app.openRef);
    act(() => { pending = alert.mock.calls[0][2][1].onPress(); });
    const status = inst.root.findByType(ExtraDownloadStatus);
    const cancel = status.findAll(n => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function')[0];
    expect(cancel.findByType(require('react-native').Text).props.children).toBe(strings.common.cancel);
    act(() => { cancel.props.onPress(); });
    await act(async () => { await pending; });
    expect(await again).toBe(false);
    expect(app.openRef).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);               // (the warning only: no error after Cancel)
    expect(ex.isDownloaded('ספר בדיקה מקונן')).toBe(false);
    expect(inst.root.findAllByType(ExtraDownloadModal)).toHaveLength(0);

    // the same from anywhere a ref cannot be loaded (links, search results, history)
    alert.mockClear();
    ex._reset({enabled: {otzaria: true}, catalogs: {otzaria: {entries: CATALOG}}});
    ex.applyToToc(SEFARIA_TOC);
    app.textUnavailableAlert('ספר בדיקה מקונן, S1, S1:2');
    expect(alert.mock.calls[0][0]).toBe(strings.extras.not_downloaded_title);
    alert.mockRestore();
    act(() => inst.unmount());
  }, READER_APP_TIMEOUT);

  test('Back after a downloaded book opens does not bring the "Downloading" box back', async () => {
    jest.resetModules();
    const React = require('react');
    const renderer = require('react-test-renderer');
    const {act} = renderer;
    const TestContextWrapper = require('../TestContextWrapper').default;
    const ReaderApp = require('../ReaderApp').default;
    const Sefaria = require('../sefaria').default;
    const ex = require('../extras');
    const {Alert: RNAlert} = require('react-native');
    const FS = require('expo-file-system/legacy');
    FS.clear();
    ex._reset({enabled: {otzaria: true}, catalogs: {otzaria: {entries: CATALOG}}});
    Sefaria._cacheIndexFromToc(ex.applyToToc(SEFARIA_TOC), true);
    serve({[encodeURIComponent('ספר בדיקה מקונן') + '.txt']: BOOK_TEXT});

    let inst;
    act(() => {
      inst = renderer.create(React.createElement(TestContextWrapper,
        {passContextToChildren: true, child: ReaderApp, childProps: {showErrorBoundary: () => {}}}));
    });
    const app = inst.root.findByType(ReaderApp).instance;
    const alert = jest.spyOn(RNAlert, 'alert').mockImplementation(() => {});
    const {ExtraDownloadModal} = require('../ExtraDownloadProgress');

    // opening the book saves the page it came from for Back, as openRef does - right after the
    // download, before React has applied "the download is over" to this.state
    const open = jest.fn(async () => { app.modifyHistory({dir: 'forward', state: app.state}); });
    const done = app.extraBookAlert('ספר בדיקה מקונן', open);
    let pending;
    act(() => { pending = alert.mock.calls[0][2][1].onPress(); });
    await act(async () => { await pending; });
    expect(await done).toBe(true);
    expect(open).toHaveBeenCalled();
    expect(inst.root.findAllByType(ExtraDownloadModal)).toHaveLength(0);

    act(() => { expect(app.manageBack('main')).toBe(true); });
    expect(app.state.extraDownload).toBeFalsy();
    expect(inst.root.findAllByType(ExtraDownloadModal)).toHaveLength(0);
    alert.mockRestore();
    act(() => inst.unmount());
  }, READER_APP_TIMEOUT);

  test('ERRORS has the extra-book error', () => {
    expect(ERRORS.EXTRA_NOT_DOWNLOADED).toBeTruthy();
  });

  test('large Otzaria book with thousands of paragraphs does not overflow call stack in inlineSections', () => {
    const { Node, inlineSections } = require('../extras/tree');
    const root = new Node('');
    for (let i = 0; i < 6000; i++) {
      const c = root.addChild(`פרק ${i + 1}`);
      c.addPara(`תוכן פסקה ${i + 1}`);
    }
    expect(() => inlineSections(root)).not.toThrow();
  });

  test('setSourceEnabled(id, false, { keepBooks: true }) hides undownloaded books while keeping downloaded ones', async () => {
    jest.resetModules();
    const ex = require('../extras');
    const FS = require('expo-file-system/legacy');
    FS.clear();
    ex._reset({
      enabled: { otzaria: true },
      catalogs: { otzaria: { fetchedAt: Date.now(), entries: CATALOG } },
      state: { installed: { 'ספר בדיקה מקונן': { source: 'otzaria', id: CATALOG[0].id, firstSection: 'ספר בדיקה מקונן, S1' } }, blocked: {} },
    });
    const prevSefaria = global.Sefaria;
    global.Sefaria = { _loadTOC: jest.fn(async () => ex.applyToToc(SEFARIA_TOC)) };
    try {
      await ex.setSourceEnabled('otzaria', false, { keepBooks: true });
      expect(ex.isEnabled('otzaria')).toBe(false);
      expect(ex.isDownloaded('ספר בדיקה מקונן')).toBe(true);
      expect(ex.isExtraTitle('ספר בדיקה מקונן')).toBe(true);
      const undownloaded = CATALOG.find(c => c.heTitle !== 'ספר בדיקה מקונן');
      if (undownloaded) { expect(ex.isExtraTitle(undownloaded.heTitle)).toBe(false); }
    } finally {
      global.Sefaria = prevSefaria;
    }
  });

  test('cancelDownload during writeBook/searchLines rejects with DownloadCancelledError and cleans up partial files', async () => {
    jest.resetModules();
    const ex = require('../extras');
    const FS = require('expo-file-system/legacy');
    FS.clear();
    ex._reset({ enabled: { otzaria: true }, catalogs: { otzaria: { fetchedAt: Date.now(), entries: CATALOG } } });
    ex.applyToToc(SEFARIA_TOC);
    serve({ [encodeURIComponent('ספר בדיקה מקונן') + '.txt']: BOOK_TEXT });

    const prevImpl = FS.writeAsStringAsync.getMockImplementation();
    let fileWrites = 0;
    FS.writeAsStringAsync.mockImplementation(async (p, content) => {
      if (typeof p === 'string' && p.includes('extras/') && p.endsWith('.json')) {
        fileWrites += 1;
        if (fileWrites === 2) { ex.cancelDownload('ספר בדיקה מקונן'); }
      }
      return prevImpl(p, content);
    });
    try {
      await expect(ex.downloadBook('ספר בדיקה מקונן')).rejects.toBeInstanceOf(ex.DownloadCancelledError);
      expect(fileWrites).toBeGreaterThanOrEqual(2);
      expect(ex.isDownloaded('ספר בדיקה מקונן')).toBe(false);
      expect((await FS.getInfoAsync('library/ספר בדיקה מקונן.zip')).exists).toBe(false);
      expect((await FS.getInfoAsync('library/ספר בדיקה מקונן_search.txt')).exists).toBe(false);
    } finally {
      FS.writeAsStringAsync.mockImplementation(prevImpl);
    }
  });

  test('ExtraSourceRow asks Keep/Delete/Cancel when turning off a source with downloaded books, and Keep leaves books installed', async () => {
    jest.resetModules();
    const React = require('react');
    const renderer = require('react-test-renderer');
    const { act } = renderer;
    const { Alert: RNAlert, Switch } = require('react-native');
    const FS = require('expo-file-system/legacy');
    FS.clear();
    const ex = require('../extras');
    const strings = require('../LocalizedStrings').default;
    const { ExtraSourceRow } = require('../shomer/ContentFilterSettings');

    ex._reset({
      enabled: { otzaria: true },
      catalogs: { otzaria: { fetchedAt: Date.now(), entries: CATALOG } },
      state: { installed: { 'ספר בדיקה מקונן': { source: 'otzaria', id: CATALOG[0].id, firstSection: 'ספר בדיקה מקונן, S1' } }, blocked: {} },
    });
    const prevSefaria = global.Sefaria;
    global.Sefaria = { _loadTOC: jest.fn(async () => ex.applyToToc(SEFARIA_TOC)) };
    const alertSpy = jest.spyOn(RNAlert, 'alert').mockImplementation(() => {});
    let tree;
    try {
      await act(async () => {
        tree = renderer.create(
          <ExtraSourceRow
            source={{ id: 'otzaria', name: 'Otzaria', heName: 'אוצריא', extra: true }}
            langStyle={{}}
            theme={{}}
            interfaceLanguage="english"
          />
        );
      });
      const toggleSwitch = tree.root.findByType(Switch);
      act(() => { toggleSwitch.props.onValueChange(false); });
      expect(alertSpy).toHaveBeenCalledTimes(1);
      const buttons = alertSpy.mock.calls[0][2];
      expect(buttons.map(b => b.text)).toEqual([
        strings.common.cancel,
        strings.extras.keep_books,
        strings.extras.delete_books,
      ]);
      const keepBtn = buttons.find(b => b.text === strings.extras.keep_books);
      await act(async () => { keepBtn.onPress(); await new Promise(r => setImmediate(r)); });
      expect(ex.isEnabled('otzaria')).toBe(false);
      expect(ex.isDownloaded('ספר בדיקה מקונן')).toBe(true);
      expect(ex.isExtraTitle('ספר בדיקה מקונן')).toBe(true);
      act(() => { tree.unmount(); });
    } finally {
      alertSpy.mockRestore();
      global.Sefaria = prevSefaria;
    }
  });

  test('large Otzaria book (Ohr HaYashar scale) downloads, converts, zips, and indexes for search cleanly', async () => {
    jest.resetModules();
    require('../searchPrefs')._setOfflineSearchForTests(true);   // (the fresh module reads it again)
    const ex = require('../extras');
    const FS = require('expo-file-system/legacy');
    FS.clear();
    const largeCatalog = parseCatalog(JSON.stringify({
      'Ben-YehudaToOtzaria/ספרים/אוצריא/מחשבה/אור הישר הגדול.txt': { hash: 'big1' },
    }), { restricted: [], permitted: {}, in_sefaria: [] });
    ex._reset({ enabled: { otzaria: true }, catalogs: { otzaria: { fetchedAt: Date.now(), entries: largeCatalog } } });
    ex.applyToToc(SEFARIA_TOC);

    const lines = ['<h1>אור הישר הגדול</h1>'];
    for (let ch = 1; ch <= 5; ch++) {
      lines.push(`<h2>פרק ${ch}</h2>`);
      for (let sec = 1; sec <= 50; sec++) {
        lines.push(`<h3>סעיף ${ch}-${sec}</h3>`);
        for (let p = 1; p <= 10; p++) {
          lines.push(`פסקה ${ch}.${sec}.${p} בדברי מוסר ומחשבה.`);
        }
      }
    }
    expect(lines.length).toBeGreaterThan(2500);
    serve({ [encodeURIComponent('אור הישר הגדול') + '.txt']: lines.join('\n') });

    const first = await ex.downloadBook('אור הישר הגדול');
    expect(first).toBeTruthy();
    expect(ex.isDownloaded('אור הישר הגדול')).toBe(true);
    expect((await FS.getInfoAsync('library/אור הישר הגדול.zip')).exists).toBe(true);
    const search = await FS.readAsStringAsync('library/אור הישר הגדול_search.txt');
    expect(search.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(2500);
  }, 30000);

  test('installHostedBundle downloads and extracts shard zips for Dicta without per-book fetches', async () => {
    jest.resetModules();
    const FS = require('expo-file-system/legacy');
    const ex = require('../extras');
    const dicta = require('../extras/dicta');
    FS.clear();

    const prevFetch = global.fetch;
    const prevDownloadAsync = FS.downloadAsync;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        format: 1,
        converterVersion: dicta.CONVERTER_VERSION,
        shards: [{ file: 'dicta-shard-1.zip', size: 1024, titles: ['Dicta Bundle Book'] }],
        books: { 'Dicta Bundle Book': { id: 'dicta-1', hash: 'h1', firstSection: 'Dicta Bundle Book, S1', size: 500 } },
      }),
    }));
    FS.downloadAsync = jest.fn(async (url, dest) => {
      await FS.writeAsStringAsync(dest, JSON.stringify({ 'library/Dicta Bundle Book.zip': '{}' }));
      return { status: 200, uri: dest };
    });

    ex._reset({
      enabled: { dicta: true },
      books: { 'Dicta Bundle Book': { source: 'dicta', id: 'dicta-1', title: 'Dicta Bundle Book', heTitle: 'דיקטה', hash: 'h1' } },
    });
    dicta._forgetHostedManifest();
    try {
      const ok = await ex.installHostedBundle('dicta');
      expect(ok).toBe(true);
      expect(ex.isDownloaded('Dicta Bundle Book')).toBe(true);
      expect(FS.downloadAsync).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = prevFetch;
      FS.downloadAsync = prevDownloadAsync;
    }
  });
});

afterAll(() => { delete global.fetch; });
// (Alert is imported so the module mock of react-native is the same one the app uses)
void Alert;
