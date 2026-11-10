/**
 * Dicta as an extra source (extras/dicta.js): its books listed from Dicta's books.json,
 * downloaded from Dicta's server (or Otzaria's layout of them) and converted on the phone
 * as Sofer's importer converts them.
 *
 * The fixtures (__tests__/fixtures/dicta/<name>.json: a book's books.json entry, Dicta's pages
 * and Otzaria's copies) have their expected results made by Sofer's own importer
 * (tools/library-export/dicta_fixtures.py -> <name>.sofer.json). synthetic_* are made up
 * (SYNTHETIC TEST FIXTURE - not a real text); the others are real books from Sofer's data.
 */
import fs from 'fs';
import path from 'path';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {unzip} from 'react-native-zip-archive';
import dicta, {
  parseCatalog, otzariaCopies, choose, versionOf, versionTitle, dictaTree, shareIn, bookUrl,
  CATALOG_URL, OTZARIA_MANIFEST_URL, LICENSE,
} from '../extras/dicta';
import {COLLECTIONS, bookUrlForPath} from '../extras/otzaria';
import {chooseBooks, addToToc} from '../extras/catalog';
import {bookFiles} from '../extras/schema7';
import * as extras from '../extras';
import {correctionEmail} from '../reportError';
import {SOURCES} from '../sources';

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
    // ("zips" are JSON objects {name: content}, as in extras.test.js)
    unzip: jest.fn(async (zipPath, dest) => {
      const entries = JSON.parse(await fsMock.readAsStringAsync(zipPath));
      for (const [name, content] of Object.entries(entries)) {
        await fsMock.writeAsStringAsync(`${dest}${name}`, content);
      }
      return dest;
    }),
  };
});

const FIXTURES = path.join(__dirname, 'fixtures', 'dicta');
const NAMES = fs.readdirSync(FIXTURES).filter(f => f.endsWith('.json') && !f.endsWith('.sofer.json')).map(f => f.slice(0, -5));
const load = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
const expected = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.sofer.json`), 'utf8'));

/** The app's licence of an Otzaria collection Sofer names ('Orayta' ...) */
const licenceOf = source => Object.values(COLLECTIONS).find(c => c.source === source).license;

/** A fixture as what fetchBook gives the converter */
function docOf(fx) {
  const own = fx.otzaria.find(c => c.source === 'Dicta');
  return {
    otzaria: own ? own.text : null,
    pages: fx.pages,
    copies: fx.otzaria.filter(c => c.source !== 'Dicta').map(c => ({collection: c.source, license: licenceOf(c.source), text: c.text})),
  };
}

const entryOf = fx => parseCatalog([fx.book])[0];

/** The book's sections as the expected files list them: [{path, paras}] */
function sectionsForCompare(tree) {
  const out = [];
  const walk = (node, trail) => {
    const parts = [];
    if (node.paras.length) { parts.push({title: '', paras: node.paras, children: []}); }
    node.children.forEach(c => { if (!c.empty()) { parts.push(c); } });
    for (const c of parts) {
      if (c.children.length) {
        walk(c, trail.concat(c.title));
      } else {
        out.push({path: trail.concat(c.title), paras: c.paras});
      }
    }
  };
  walk(tree, []);
  return out;
}

// ---------------------------------------------------------------- the conversion

describe('Dicta conversion = Sofer\'s importer (fixtures)', () => {
  test('there are fixtures of every kind of choice', () => {
    const kinds = new Set(NAMES.map(n => expected(n).kind.split('/')[0] + (expected(n).kind.includes('/') ? '/' : '')));
    expect([...kinds].sort()).toEqual(['Dicta', 'Dicta/', 'Otzaria/']);
  });

  test.each(NAMES)('%s', name => {
    const fx = load(name);
    const want = expected(name);
    const doc = docOf(fx);
    const entry = entryOf(fx);
    const c = choose(doc);
    expect(c.kind).toBe(want.kind);
    expect(sectionsForCompare(c.tree)).toEqual(want.sections);
    const v = versionOf(entry, doc);
    expect(v.versionTitle).toBe(want.versionTitle);
    expect(v.versionSource).toBe(want.versionSource);
    expect(v.license).toBe(want.license);
    expect(dicta.toTree(doc, entry)[1]).toBe(want.author);
  });

  test('Dicta\'s pages: running heads dropped, punctuation put back, headings inside the text', () => {
    const tree = dictaTree(load('synthetic_inline').pages);
    expect(tree.children.map(c => c.title)).toEqual(['הקדמה', 'סימן א', 'סימן ב', 'סימן ג', 'סימן ד', 'סימן ה', 'סימן ו']);
    expect(JSON.stringify(tree)).not.toContain('ספר בדיקה לדוגמה');
    expect(tree.children[0].paras[0]).toMatch(/הראשונה:$/);
  });

  test('another copy with no stated licence: used only when most of Dicta\'s text is in it', () => {
    const near = docOf(load('synthetic_unknown_copy'));
    const far = docOf(load('synthetic_unknown_far'));
    const [otherNear] = require('../extras/otzaria').otzariaTree(near.copies[0].text);
    expect(shareIn(dictaTree(near.pages), otherNear)).toBeGreaterThanOrEqual(0.8);
    expect(choose(near).kind).toBe('Otzaria/Orayta');
    expect(choose(near).license).toBe(LICENSE);
    expect(choose(far).kind).toBe('Dicta');
  });
});

// ---------------------------------------------------------------- credit and licence

describe('credit and licence', () => {
  test('Dicta\'s own: CC BY-SA, credited to Dicta, corrections to Dicta', () => {
    const fx = load('devash_tamar');
    const v = versionOf(entryOf(fx), docOf(fx));
    expect(v).toMatchObject({license: 'CC-BY-SA', librarySource: 'dicta'});
    expect(v.versionTitle).toBe(`Dicta Library (${fx.book.printLocationEnglish}, ${fx.book.printYear})`);
    expect(v.versionSource).toBe('Dicta, the Israel Center for Text Analysis (https://library.dicta.org.il)');
    expect(v.versionNotesInHebrew).toContain('דיקטה');
    expect(v.versionNotesInHebrew).toContain('CC BY-SA 4.0');
  });

  test('Otzaria\'s layout of a Dicta book: still Dicta\'s (its licence and credit), "laid out by the Otzaria library"', () => {
    const fx = load('rishon_letziyon_taanit');
    const v = versionOf(entryOf(fx), docOf(fx));
    expect(v.license).toBe('CC-BY-SA');
    expect(v.librarySource).toBe('dicta');
    expect(v.versionTitle).toMatch(/^Dicta Library/);
    expect(v.versionSource).toMatch(/^Dicta, the Israel Center for Text Analysis .*; laid out by the Otzaria library/);
    expect(v.versionNotesInHebrew).toContain('אוצריא');   // (Otzaria's credit, as its README asks)
  });

  test('another collection\'s copy with a clear licence: its own source and licence, corrections to Otzaria', () => {
    const fx = load('synthetic_clear_copy');
    const v = versionOf(entryOf(fx), docOf(fx));
    expect(v).toMatchObject({versionTitle: 'Otzaria (wikiSource)', license: 'CC-BY-SA', librarySource: 'otzaria'});
    expect(v.versionSource).toMatch(/^Otzaria library, from wikiSource/);
  });

  test('the converted book carries librarySource "dicta": "Report a mistake" goes to Dicta', () => {
    const fx = load('devash_tamar');
    const entry = {...entryOf(fx), title: 'x'};
    const doc = docOf(fx);
    const {files} = bookFiles(choose(doc).tree, {...entry, version: versionOf(entry, doc)});
    expect(files['x_index.json'].librarySource).toBe('dicta');
    const version = files['x_index.json'].versions[0];
    expect(correctionEmail({ref: 'x, S1:1', text: 't', version, platform: 'android'}).source).toBe('dicta');
  });

  test('version names as Sofer\'s', () => {
    expect(versionTitle({printLocation: 'Vilna', printYear: 1900}, 'Dicta')).toBe('Dicta Library (Vilna, 1900)');
    expect(versionTitle({printLocation: '', printYear: ''}, 'Dicta/Otzaria')).toBe('Dicta Library');
    expect(versionTitle({printYear: 1900}, 'Otzaria/Orayta')).toBe('Otzaria (Orayta)');
  });
});

// ---------------------------------------------------------------- the catalogue

const BOOKS = [
  {fileName: 'a', displayName: 'ספר א', displayNameEnglish: 'Sefer A', categoryEnglish: 'Responsa', subcategory: 'אחרונים - מערב',
    subcategoryEnglish: 'Acharonim (West)', author: 'רבי א', printLocationEnglish: 'Vilna', printYear: 1900,
    textFileURL: 'https://files.dicta.org.il/library-1-0/a/a__text_files.zip',
    nikudMetegFileURL: 'https://files.dicta.org.il/library-1-0/a/a__nikud_meteg_files.zip'},
  {fileName: 'b', displayName: 'ספר ב', displayNameEnglish: '', categoryEnglish: 'Something new',
    textFileURL: 'https://files.dicta.org.il/library-1-0/b/b__text_files.zip'},
  {fileName: 'c', displayName: '', textFileURL: 'https://files.dicta.org.il/library-1-0/c/c__text_files.zip'},
  {fileName: 'd', displayName: 'ספר ד', categoryEnglish: 'Kabbala'},
];
const MANIFEST = {
  'DictaToOtzaria/ערוך/ספרים/אוצריא/שות/אחרונים/ספר א.txt': {hash: 'o1'},
  'OraytaToOtzaria/ספרים/אוצריא/שות/ספר ב.txt': {hash: 'o2'},
  'wikiJewishBooksToOtzaria/ספרים/אוצריא/שות/ספר ב.txt': {hash: 'o3'},
  'MoreBooks/ספרים/אוצריא/שות/ספר ב.txt': {hash: 'o4'},
  'BeitAharonVeYisraelToOtzaria/ספרים/אוצריא/שות/ספר ב.txt': {hash: 'o5'},
  'KSK/ספרים/אוצריא/שות/ספר ב.txt': {hash: 'o6'},
  'DictaToOtzaria/ערוך/links/ספר א_links.json': {hash: 'x'},
};
const NO_RULES = {restricted: ['KSK|ספר ב'], permitted: {}, in_sefaria: []};

describe('Dicta catalogue', () => {
  test('Dicta\'s own list, books with a file and a name, under Sofer\'s categories', () => {
    const entries = parseCatalog(JSON.stringify(BOOKS), null, NO_RULES);
    expect(entries.map(e => e.id)).toEqual(['a', 'b']);
    expect(entries[0]).toMatchObject({
      source: 'dicta', title: 'Sefer A', heTitle: 'ספר א', license: 'CC-BY-SA', author: 'רבי א',
      categories: ['Responsa', 'Dicta Library', 'Acharonim (West)'], heCategories: ['שו"ת', 'ספריית דיקטה', 'אחרונים - מערב'],
      otzaria: null, copies: [],
    });
    expect(entries[1]).toMatchObject({title: 'ספר ב', categories: ['Reference', 'Dicta Library', 'General']});
    expect(entries[0].hash).toEqual(expect.any(String));
  });

  test('each book is downloaded from Dicta\'s own server; the computer-nikud editions are not offered', () => {
    const [a] = parseCatalog(BOOKS, null, NO_RULES);
    expect(bookUrl(a)).toBe('https://files.dicta.org.il/library-1-0/a/a__text_files.zip');
    expect(CATALOG_URL).toBe('https://raw.githubusercontent.com/Dicta-Israel-Center-for-Text-Analysis/Dicta-Library-Download/main/books.json');
    expect(JSON.stringify(a)).not.toContain('nikud');
  });

  test('Otzaria\'s copies: its layout of the book, and other collections the app offers', () => {
    const copies = otzariaCopies(MANIFEST, NO_RULES);
    expect(copies['ספר א'].otzaria).toEqual({path: 'DictaToOtzaria/ערוך/ספרים/אוצריא/שות/אחרונים/ספר א.txt', hash: 'o1'});
    // (not wiki Jewish books, Beit Aharon VeYisrael, MoreBooks without permission, or a restricted book)
    expect(copies['ספר ב'].copies).toEqual([
      {collection: 'Orayta', path: 'OraytaToOtzaria/ספרים/אוצריא/שות/ספר ב.txt', hash: 'o2', license: 'unknown'}]);
    const [a, b] = parseCatalog(BOOKS, MANIFEST, NO_RULES);
    expect(a.otzaria.path).toMatch(/^DictaToOtzaria\//);
    expect(b.copies).toHaveLength(1);
    // (a change in Otzaria's copy is an update of the book)
    const [a2] = parseCatalog(BOOKS, {...MANIFEST, 'DictaToOtzaria/ערוך/ספרים/אוצריא/שות/אחרונים/ספר א.txt': {hash: 'o9'}}, NO_RULES);
    expect(a2.hash).not.toBe(a.hash);
  });
});

describe('one copy of each sefer: Sefaria, then Dicta, then Otzaria', () => {
  const TOC = [{category: 'Responsa', heCategory: 'שו״ת', contents: [{title: 'Sefaria Book', heTitle: 'ספר ב', categories: ['Responsa']}]}];
  test('Sefaria\'s copy wins over Dicta\'s; Dicta\'s over Otzaria\'s', () => {
    const d = parseCatalog(BOOKS, MANIFEST, NO_RULES);
    const otz = [{source: 'otzaria', id: 'x', heTitle: 'ספר א', categories: ['Responsa', 'Otzaria', 'X'], heCategories: []}];
    const {books} = chooseBooks(TOC, {otzaria: otz, dicta: d});
    expect(Object.keys(books)).toEqual(['Sefer A']);
    expect(books['Sefer A'].source).toBe('dicta');
    const toc = addToToc(TOC, books);
    const shelf = toc[0].contents.find(c => c.category === 'Dicta Library');
    expect(shelf.heCategory).toBe('ספריית דיקטה');
    expect(shelf.contents[0].contents[0]).toMatchObject({title: 'Sefer A', librarySource: 'dicta'});
  });

  test('registered as an extra source, off by default', () => {
    expect(extras.EXTRA_SOURCES.dicta).toBe(dicta);
    expect(SOURCES.find(s => s.id === 'dicta')).toMatchObject({extra: true, available: true, enabled: false});
  });
});

// ---------------------------------------------------------------- on the phone

/** global.fetch serving {url: text}; Dicta's zips through FileSystem.downloadAsync */
function serve(map) {
  global.fetch = jest.fn(async url => {
    if (!(url in map)) { return {ok: false, status: 404, text: async () => ''}; }
    return {ok: true, status: 200, text: async () => map[url]};
  });
}
const zipOf = pages => JSON.stringify(Object.fromEntries(pages.map((p, i) => [`p-${String(i + 1).padStart(3, '0')}.txt`, p])));

describe('downloading a Dicta book', () => {
  const TOC = [];
  beforeEach(async () => {
    FileSystem.clear();
    FileSystem.downloadAsync.mockClear();
    unzip.mockClear();
    await AsyncStorage.clear();
  });

  function setUp(fx, manifest) {
    const entries = parseCatalog([fx.book], manifest, NO_RULES);
    extras._reset({enabled: {dicta: true}, catalogs: {dicta: {fetchedAt: Date.now(), entries}}});
    extras.applyToToc(TOC);
    return entries[0];
  }

  test('Dicta\'s pages: the zip from files.dicta.org.il, unzipped, converted, the temporary files gone', async () => {
    const fx = load('devash_tamar');
    const entry = setUp(fx, null);
    FileSystem.setRemote(fx.book.textFileURL, zipOf(fx.pages));
    serve({});
    const first = await extras.downloadBook(entry.title);
    expect(FileSystem.downloadAsync.mock.calls[0][0]).toBe(fx.book.textFileURL);
    expect(FileSystem.downloadAsync.mock.calls[0][0]).toMatch(/^https:\/\/files\.dicta\.org\.il\//);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(first).toBe(`${entry.title}, S1`);
    const zipped = JSON.parse(await FileSystem.readAsStringAsync(`library/${entry.title}.zip`));
    const index = JSON.parse(zipped[`${entry.title}_index.json`]);
    expect(index.librarySource).toBe('dicta');
    expect(index.versions[0]).toMatchObject({license: 'CC-BY-SA', librarySource: 'dicta'});
    expect(index.schema.nodes).toHaveLength(expected('devash_tamar').sections.length);
    expect((await FileSystem.getInfoAsync(FileSystem.downloadAsync.mock.calls[0][1])).exists).toBe(false);
    const state = JSON.parse(await FileSystem.readAsStringAsync('library/_extras/state.json'));
    expect(state.installed[entry.title]).toMatchObject({source: 'dicta', id: fx.book.fileName, converter: 1});
  });

  test('Otzaria\'s layout of the book: fetched from Otzaria\'s repository, nothing from Dicta needed', async () => {
    const fx = load('rishon_letziyon_taanit');
    const p = `DictaToOtzaria/ערוך/ספרים/אוצריא/תלמוד בבלי/${fx.otzaria[0].name}.txt`;
    const entry = setUp(fx, {[p]: {hash: 'h'}});
    serve({[bookUrlForPath(p)]: fx.otzaria[0].text});
    await extras.downloadBook(entry.title);
    expect(global.fetch.mock.calls.map(c => c[0])).toEqual([bookUrlForPath(p)]);
    expect(global.fetch.mock.calls[0][0]).toMatch(/^https:\/\/raw\.githubusercontent\.com\/Otzaria\/otzaria-library\/main\/DictaToOtzaria\//);
    expect(FileSystem.downloadAsync).not.toHaveBeenCalled();
    const index = JSON.parse(JSON.parse(await FileSystem.readAsStringAsync(`library/${entry.title}.zip`))[`${entry.title}_index.json`]);
    expect(index.versions[0].versionSource).toMatch(/laid out by the Otzaria library/);
    expect(index.versions[0].librarySource).toBe('dicta');
  });

  test('Otzaria\'s layout restricted: Dicta\'s own pages instead', async () => {
    const fx = load('synthetic_restricted_layout');
    const p = 'DictaToOtzaria/ערוך/ספרים/אוצריא/שות/ספר בדיקה דיקטה ה.txt';
    const entry = setUp(fx, {[p]: {hash: 'h'}});
    serve({[bookUrlForPath(p)]: fx.otzaria[0].text});
    FileSystem.setRemote(fx.book.textFileURL, zipOf(fx.pages));
    await extras.downloadBook(entry.title);
    expect(FileSystem.downloadAsync).toHaveBeenCalledTimes(1);
    const index = JSON.parse(JSON.parse(await FileSystem.readAsStringAsync(`library/${entry.title}.zip`))[`${entry.title}_index.json`]);
    expect(index.schema.nodes.map(n => n.heTitle)).toEqual(expected('synthetic_restricted_layout').sections.map(s => s.path[0]));
  });

  test('another collection\'s copy is fetched only when Dicta\'s own has no sections', async () => {
    const fx = load('synthetic_unknown_copy');
    const p = 'OraytaToOtzaria/ספרים/אוצריא/שות/ספר בדיקה דיקטה ב.txt';
    const entry = setUp(fx, {[p]: {hash: 'h'}});
    serve({[bookUrlForPath(p)]: fx.otzaria[0].text});
    FileSystem.setRemote(fx.book.textFileURL, zipOf(fx.pages));
    await extras.downloadBook(entry.title);
    expect(global.fetch.mock.calls.map(c => c[0])).toEqual([bookUrlForPath(p)]);
    const index = JSON.parse(JSON.parse(await FileSystem.readAsStringAsync(`library/${entry.title}.zip`))[`${entry.title}_index.json`]);
    expect(index.versions[0]).toMatchObject({versionTitle: 'Otzaria (Orayta)', license: 'CC-BY-SA', librarySource: 'dicta'});

    const withSections = load('synthetic_inline');
    const e2 = setUp(withSections, {'OraytaToOtzaria/ספרים/אוצריא/שות/ספר בדיקה דיקטה א.txt': {hash: 'h'}});
    serve({});
    FileSystem.setRemote(withSections.book.textFileURL, zipOf(withSections.pages));
    await extras.downloadBook(e2.title);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('turning Dicta on downloads its list and Otzaria\'s list of copies', async () => {
    extras._reset({loaded: true});
    serve({[CATALOG_URL]: JSON.stringify(BOOKS), [OTZARIA_MANIFEST_URL]: JSON.stringify(MANIFEST)});
    global.Sefaria = {_loadTOC: jest.fn(async () => extras.applyToToc(TOC))};
    await extras.setSourceEnabled('dicta', true);
    expect(global.fetch.mock.calls.map(c => c[0])).toEqual([CATALOG_URL, OTZARIA_MANIFEST_URL]);
    expect(extras.isExtraTitle('Sefer A')).toBe(true);
    expect(extras.extraBook('Sefer A').otzaria).toBeTruthy();
    expect(extras.needsDownload('Sefer A')).toBe(true);
    delete global.Sefaria;
  });

  test('without Otzaria\'s list the catalogue is Dicta\'s alone', async () => {
    serve({[CATALOG_URL]: JSON.stringify(BOOKS)});
    const entries = await dicta.fetchCatalog();
    expect(entries.map(e => e.id)).toEqual(['a', 'b']);
    expect(entries[0].otzaria).toBeNull();
  });
});

afterAll(() => { delete global.fetch; });
