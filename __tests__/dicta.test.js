/**
 * Dicta as an extra source (extras/dicta.js): its books listed from Dicta's books.json,
 * downloaded from Dicta's server (or Otzaria's layout of them) and converted on the phone
 * as Sofer's importer converts them.
 *
 * The fixtures (__tests__/fixtures/dicta/<name>.json: a book's books.json entry, Dicta's pages
 * and Otzaria's copies) have their expected results made by Sofer's own importer
 * (tools/library-export/dicta_fixtures.py -> <name>.sofer.json). synthetic_* are made up
 * (SYNTHETIC TEST FIXTURE - not a real text); the others are real books from Sofer's data.
 * devash_tamar, iggeret_hateshuvah and rishon_letziyon_taanit also have nikudPages: the pages of
 * Dicta's __nikud_meteg_files.zip of the book (downloaded 2026-11-10; CC BY-SA, Dicta), and its
 * nikudMetegFileURL in book - added to the fixtures after dicta_fixtures.py made them.
 */
import fs from 'fs';
import path from 'path';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {unzip} from 'react-native-zip-archive';
import dicta, {
  parseCatalog, otzariaCopies, choose, versionOf, versionTitle, dictaTree, shareIn, bookUrl,
  CATALOG_URL, OTZARIA_MANIFEST_URL, LICENSE, CREDIT_HE_DICTA,
  vowelize, nikudWords, nikudEdition, versionsOf, putMarks, NIKUD_MIN, pagesBase,
} from '../extras/dicta';
import {Node} from '../extras/tree';
import md5 from 'md5';
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
    nikud: fx.nikudPages || null,
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

// ---------------------------------------------------------------- the edition with nikud

const MARKS = /[֑-ׇֽֿׁׂׅׄ]/g;
const unmarked = s => s.replace(MARKS, '');
const allParas = tree => [...tree.paras, ...[].concat(...tree.children.map(allParas))];

describe('the edition with nikud (Dicta\'s computer nikud), shown first', () => {
  // devash_tamar, rishon_letziyon_taanit, iggeret_hateshuvah: real books, with Dicta's real nikud
  // pages (nikudPages: the __nikud_meteg_files.zip of each, one line a page)
  test('the nikud pages have no line breaks: the plain pages\' layout is not in them', () => {
    const fx = load('devash_tamar');
    expect(fx.nikudPages).toHaveLength(fx.pages.length);
    expect(fx.nikudPages.every(p => !p.trim().includes('\n'))).toBe(true);
    expect(fx.pages.every(p => p.trim().includes('\n'))).toBe(true);
  });

  test('Dicta\'s own pages: every word vowelled, laid out exactly as the plain edition', () => {
    const fx = load('devash_tamar');
    const doc = docOf(fx);
    const c = choose(doc);
    expect(c.kind).toBe('Dicta');
    const v = vowelize(c.tree, nikudWords(fx.nikudPages));
    expect(v.share).toBe(1);
    expect(sectionsForCompare(v.tree).map(s => s.path)).toEqual(sectionsForCompare(c.tree).map(s => s.path));
    // (nothing but marks added: without them, the plain text exactly)
    expect(allParas(v.tree).map(unmarked)).toEqual(allParas(c.tree));
    expect(allParas(v.tree).join(' ')).toContain('הִלְכוֹת');
  });

  test('Otzaria\'s layout of a Dicta book: Dicta\'s nikud put on Otzaria\'s words (its headings and bold kept)', () => {
    const fx = load('rishon_letziyon_taanit');
    const doc = docOf(fx);
    const c = choose(doc);
    expect(c.kind).toBe('Dicta/Otzaria');
    const ed = nikudEdition(doc);
    expect(ed.share).toBeGreaterThan(0.99);
    expect(allParas(ed.tree).map(unmarked)).toEqual(allParas(c.tree));
    expect(allParas(c.tree)[0]).toMatch(/^<b>גמ'<\/b> ואילו /);
    expect(allParas(ed.tree)[0]).toMatch(/^<b>ג[֑-ׇ]+מ[֑-ׇ]+'<\/b> ו[֑-ׇ]+א/);
  });

  test('another collection\'s text under its own licence: no nikud edition (not Dicta\'s text)', () => {
    const doc = docOf(load('iggeret_hateshuvah'));
    expect(choose(doc).librarySource).toBe('otzaria');
    expect(nikudEdition(doc)).toBeNull();
    expect(versionsOf(entryOf(load('iggeret_hateshuvah')), doc)).toHaveLength(1);
  });

  test('two editions: "... - with nikud (Dicta)" first, its notes saying the nikud is the computer\'s; then the plain', () => {
    const fx = load('devash_tamar');
    const entry = entryOf(fx);
    const doc = docOf(fx);
    const [nikud, plain] = versionsOf(entry, doc);
    expect(plain.version).toEqual(versionOf(entry, doc));
    expect(nikud.version).toMatchObject({
      versionTitle: 'Dicta Library (Warsaw, 1897) - with nikud (Dicta)',
      versionTitleInHebrew: 'ספריית דיקטה (ורשה, 1897) - מנוקד (ניקוד ממוחשב של דיקטה)',
      license: 'CC-BY-SA', librarySource: 'dicta',
    });
    expect(nikud.version.versionNotes).toMatch(/^Nikud added by computer \(Dicta\)/);
    expect(nikud.version.versionNotesInHebrew).toMatch(/^ניקוד נוסף על ידי מחשב \(דיקטה\)/);
    expect(nikud.version.versionNotesInHebrew).toContain(CREDIT_HE_DICTA);
    expect(nikud.version.versionSource).toMatch(/nikud added by computer \(Dicta\)$/);
    // (the book's files: both editions in every section, the one with nikud the default)
    const {files, sections} = bookFiles(plain.tree, {...entry, title: 'x', versions: versionsOf(entry, doc)});
    const index = files['x_index.json'];
    expect(index.versions.map(v => [v.versionTitle, v.isPrimary, v.priority])).toEqual([
      [nikud.version.versionTitle, true, 0], [plain.version.versionTitle, false, 1]]);
    const meta = files[`${sections[0]}.metadata.json`];
    expect(meta.versions.map(v => v.versionTitle)).toEqual([nikud.version.versionTitle, plain.version.versionTitle]);
    const he = vt => files[`${sections[0]}.${md5(vt).substring(0, 8)}.he.json`];
    expect(he(nikud.version.versionTitle).map(unmarked)).toEqual(he(plain.version.versionTitle));
    expect(he(nikud.version.versionTitle)).not.toEqual(he(plain.version.versionTitle));
  });

  test('no nikud pages, or too few of the words found in them: the plain edition alone', () => {
    const fx = load('devash_tamar');
    const entry = entryOf(fx);
    expect(versionsOf(entry, {...docOf(fx), nikud: null})).toHaveLength(1);
    const other = load('rishon_letziyon_taanit').nikudPages;     // (another book's nikud)
    const doc = {...docOf(fx), nikud: other};
    expect(vowelize(choose(doc).tree, nikudWords(other)).share).toBeLessThan(NIKUD_MIN);
    expect(versionsOf(entry, doc)).toHaveLength(1);
  });

  test('matching: running heads and words one side lacks skipped; out of step, found again ahead', () => {
    // SYNTHETIC TEST FIXTURE - not a real text
    const tree = new Node('');
    tree.paras = ['שלום עולם <b>ומלואו</b>: טוב', 'ומילה חדשה פה ואחר כך המשך הדברים'];
    const words = nikudWords(['כּוֹתֶרֶת שָׁלוֹם עוֹלָם וּמְלוֹאוֹ: טוֹב', 'וְאַחַר כָּךְ הֶמְשֵׁךְ הַדְּבָרִים']);
    const v = vowelize(tree, words);
    expect(v.tree.paras).toEqual(['שָׁלוֹם עוֹלָם <b>וּמְלוֹאוֹ</b>: טוֹב', 'ומילה חדשה פה וְאַחַר כָּךְ הֶמְשֵׁךְ הַדְּבָרִים']);
    expect(v.share).toBeCloseTo(8 / 11);
    // parts in another order (and far apart): out of step, then found again where four words agree
    const L = 'אבגדהוזחטיכלמנסעפצקרשת';
    const w = i => `${L[i % 22]}${L[Math.floor(i / 22) % 22]}ב`;
    const vw = i => [...w(i)].map(ch => `${ch}ַ`).join('');
    const swapped = new Node('');
    swapped.paras = [[...Array(100).keys()].map(i => w(i + 100)).join(' '), [...Array(100).keys()].map(w).join(' ')];
    const r = vowelize(swapped, nikudWords([[...Array(200).keys()].map(vw).join(' ')]));
    expect(r.share).toBeCloseTo(176 / 200);     // (12 words each time before it is found again)
    expect(r.tree.paras[0].split(' ').slice(-1)[0]).toBe(vw(199));
    expect(r.tree.paras[1].split(' ').slice(-1)[0]).toBe(vw(99));
    expect(putMarks('ר"ת', 'רַ"תּ')).toBe('רַ"תּ');
    expect(putMarks('אבג', 'אבג')).toBe('אבג');
  });

  test('an edition not laid out as the book is refused', () => {
    const a = new Node('');
    a.paras = ['א', 'ב'];
    const b = new Node('');
    b.paras = ['א'];
    expect(() => bookFiles(a, {title: 'x', heTitle: 'x', categories: [], versions: [
      {version: {versionTitle: 'one'}, tree: b}, {version: {versionTitle: 'two'}, tree: a}]})).toThrow(/not laid out/);
  });

  test('the reader shows full nikud (vowels and cantillation) unless the reader turns it off', () => {
    const {VOCALIZATION} = require('../VocalizationEnum');
    const src = fs.readFileSync(path.join(__dirname, '..', 'StateManager.js'), 'utf8');
    const m = /vocalization: \{\s*default: (\d+),/.exec(src);
    expect(Number(m[1])).toBe(VOCALIZATION.TAAMIM_AND_NIKKUD);
    expect(src).toMatch(/vocalization: ASYNC_STORAGE_DEFAULTS\.vocalization\.default/);
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

  test('each book is downloaded from Dicta\'s own server, its pages with computer nikud too', () => {
    const [a, b] = parseCatalog(BOOKS, null, NO_RULES);
    expect(bookUrl(a)).toBe('https://files.dicta.org.il/library-1-0/a/a__text_files.zip');
    expect(CATALOG_URL).toBe('https://raw.githubusercontent.com/Dicta-Israel-Center-for-Text-Analysis/Dicta-Library-Download/main/books.json');
    expect(a.nikudUrl).toBe('https://files.dicta.org.il/library-1-0/a/a__nikud_meteg_files.zip');
    expect(b.nikudUrl).toBeNull();
    // (a new nikud file at Dicta is an update of the book)
    const [a2] = parseCatalog([{...BOOKS[0], nikudMetegFileURL: 'https://files.dicta.org.il/library-1-0/a/new.zip'}], null, NO_RULES);
    expect(a2.hash).not.toBe(a.hash);
  });

  test('Otzaria\'s copies: its layout of the book, and other collections the app offers', () => {
    const copies = otzariaCopies(MANIFEST, NO_RULES);
    expect(copies['ספר א'].otzaria).toEqual({path: 'DictaToOtzaria/ערוך/ספרים/אוצריא/שות/אחרונים/ספר א.txt', hash: 'o1', links: true});
    // (not wiki Jewish books, Beit Aharon VeYisrael, MoreBooks without permission, or a restricted book)
    expect(copies['ספר ב'].copies).toEqual([
      {collection: 'Orayta', path: 'OraytaToOtzaria/ספרים/אוצריא/שות/ספר ב.txt', hash: 'o2', links: false, license: 'unknown'}]);
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
// the requests for the book (not its connections: Dicta's page citations, extras/links.js)
const bookFetches = () => global.fetch.mock.calls.map(c => c[0]).filter(u => !u.endsWith('/pages.json'));

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

  test('Dicta\'s pages and its pages with nikud: both zips from files.dicta.org.il, two editions, the temporary files gone', async () => {
    const fx = load('devash_tamar');
    const entry = setUp(fx, null);
    FileSystem.setRemote(fx.book.textFileURL, zipOf(fx.pages));
    FileSystem.setRemote(fx.book.nikudMetegFileURL, zipOf(fx.nikudPages));
    serve({});
    const first = await extras.downloadBook(entry.title);
    expect(FileSystem.downloadAsync.mock.calls.map(c => c[0])).toEqual([fx.book.textFileURL, fx.book.nikudMetegFileURL]);
    FileSystem.downloadAsync.mock.calls.forEach(c => expect(c[0]).toMatch(/^https:\/\/files\.dicta\.org\.il\//));
    // (only the page citations, in the background after the book: extras/links.js)
    expect(global.fetch.mock.calls.map(c => c[0])).toEqual([`${pagesBase(entry)}pages.json`]);
    expect(first).toBe(`${entry.title}, S1`);
    const zipped = JSON.parse(await FileSystem.readAsStringAsync(`library/${entry.title}.zip`));
    const index = JSON.parse(zipped[`${entry.title}_index.json`]);
    expect(index.librarySource).toBe('dicta');
    expect(index.versions.map(v => v.versionTitle)).toEqual([
      'Dicta Library (Warsaw, 1897) - with nikud (Dicta)', 'Dicta Library (Warsaw, 1897)']);
    index.versions.forEach(v => expect(v).toMatchObject({license: 'CC-BY-SA', librarySource: 'dicta'}));
    expect(index.versions[0].versionNotes).toMatch(/^Nikud added by computer \(Dicta\)/);
    expect(index.schema.nodes).toHaveLength(expected('devash_tamar').sections.length);
    // (the reader opens a section in its first edition: the one with nikud)
    const meta = JSON.parse(zipped[`${first}.metadata.json`]);
    expect(meta.versions[0].versionTitle).toBe(index.versions[0].versionTitle);
    const text = JSON.parse(zipped[`${first}.${md5(index.versions[0].versionTitle).substring(0, 8)}.he.json`]);
    expect(text.join(' ')).toMatch(/[ְ-ּ]/);
    for (const [, tmp] of FileSystem.downloadAsync.mock.calls) {
      expect((await FileSystem.getInfoAsync(tmp)).exists).toBe(false);
    }
    const state = JSON.parse(await FileSystem.readAsStringAsync('library/_extras/state.json'));
    expect(state.installed[entry.title]).toMatchObject({source: 'dicta', id: fx.book.fileName, converter: 3});
    // (offline search: the edition shown, the one with nikud; an unvowelled query still finds it)
    const lines = (await FileSystem.readAsStringAsync(`library/${entry.title}_search.txt`)).trim().split('\n');
    expect(lines.every(l => l.split('\t')[3] === index.versions[0].versionTitle)).toBe(true);
  });

  test('books downloaded before the nikud edition are updates (a newer converter)', () => {
    const fx = load('devash_tamar');
    const entry = setUp(fx, null);
    extras._reset({enabled: {dicta: true}, catalogs: {dicta: {fetchedAt: Date.now(), entries: [entry]}},
      state: {installed: {[entry.title]: {source: 'dicta', id: entry.id, hash: entry.hash, converter: 1, firstSection: 'x'}}}});
    extras.applyToToc(TOC);
    expect(extras.booksToUpdate('dicta')).toEqual([entry.title]);
  });

  test('the nikud zip missing at Dicta: the book still comes, its plain edition alone', async () => {
    const fx = load('devash_tamar');
    const entry = setUp(fx, null);
    FileSystem.setRemote(fx.book.textFileURL, zipOf(fx.pages));
    serve({});
    await extras.downloadBook(entry.title);
    const index = JSON.parse(JSON.parse(await FileSystem.readAsStringAsync(`library/${entry.title}.zip`))[`${entry.title}_index.json`]);
    expect(index.versions.map(v => v.versionTitle)).toEqual(['Dicta Library (Warsaw, 1897)']);
  });

  test('Otzaria\'s layout of the book: fetched from Otzaria\'s repository; of Dicta\'s, only the pages with nikud', async () => {
    const fx = load('rishon_letziyon_taanit');
    const p = `DictaToOtzaria/ערוך/ספרים/אוצריא/תלמוד בבלי/${fx.otzaria[0].name}.txt`;
    const entry = setUp(fx, {[p]: {hash: 'h'}});
    serve({[bookUrlForPath(p)]: fx.otzaria[0].text});
    FileSystem.setRemote(fx.book.nikudMetegFileURL, zipOf(fx.nikudPages));
    await extras.downloadBook(entry.title);
    expect(bookFetches()).toEqual([bookUrlForPath(p)]);
    expect(global.fetch.mock.calls[0][0]).toMatch(/^https:\/\/raw\.githubusercontent\.com\/Otzaria\/otzaria-library\/main\/DictaToOtzaria\//);
    expect(FileSystem.downloadAsync.mock.calls.map(c => c[0])).toEqual([fx.book.nikudMetegFileURL]);
    const index = JSON.parse(JSON.parse(await FileSystem.readAsStringAsync(`library/${entry.title}.zip`))[`${entry.title}_index.json`]);
    expect(index.versions).toHaveLength(2);
    index.versions.forEach(v => {
      expect(v.versionSource).toMatch(/laid out by the Otzaria library/);
      expect(v.librarySource).toBe('dicta');
    });
    expect(index.versions[0].versionTitle).toMatch(/with nikud \(Dicta\)$/);
  });

  test('progress: the share of Dicta\'s zips done; Cancel stops the transfer and leaves nothing', async () => {
    const fx = load('devash_tamar');
    const entry = setUp(fx, null);
    FileSystem.setRemote(fx.book.textFileURL, zipOf(fx.pages));
    FileSystem.setRemote(fx.book.nikudMetegFileURL, zipOf(fx.nikudPages));
    serve({});
    const fsMock = require('expo-file-system/legacy');
    const seen = [];
    const off = extras.subscribe(() => { const p = extras.downloadProgress(entry.title); if (p) { seen.push(p); } });
    let cancelOn = null;            // (the n-th zip: cancelled half way through it)
    const cancelled = [];
    fsMock.createDownloadResumable = jest.fn((url, to, opts, onProgress) => ({
      downloadAsync: async () => {
        onProgress({totalBytesWritten: 50, totalBytesExpectedToWrite: 100});
        if (fsMock.createDownloadResumable.mock.calls.length === cancelOn) {
          extras.cancelDownload(entry.title);
          return undefined;          // (expo: a cancelled transfer gives nothing)
        }
        onProgress({totalBytesWritten: 100, totalBytesExpectedToWrite: 100});
        return fsMock.downloadAsync(url, to);
      },
      cancelAsync: jest.fn(async () => { cancelled.push(url); }),
    }));
    try {
      await extras.downloadBook(entry.title);
      const shares = seen.filter(p => p.unit === 'percent').map(p => p.done);
      expect(seen.filter(p => p.unit).every(p => p.unit === 'percent' && p.total === 100)).toBe(true);
      expect(shares[shares.length - 1]).toBe(100);
      expect(Math.max(...shares)).toBe(100);
      expect(extras.downloadProgress(entry.title)).toBeNull();

      await extras.deleteBook(entry.title);
      fsMock.createDownloadResumable.mockClear();
      cancelOn = 2;                  // (during the nikud zip)
      await expect(extras.downloadBook(entry.title)).rejects.toBeInstanceOf(extras.DownloadCancelledError);
      expect(cancelled).toContain(fx.book.nikudMetegFileURL);
      expect((await FileSystem.getInfoAsync(`library/${entry.title}.zip`)).exists).toBe(false);
      expect(extras.needsDownload(entry.title)).toBe(true);
      expect(extras.downloadProgress(entry.title)).toBeNull();
    } finally {
      off();
      delete fsMock.createDownloadResumable;
    }
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
    expect(bookFetches()).toEqual([bookUrlForPath(p)]);
    const index = JSON.parse(JSON.parse(await FileSystem.readAsStringAsync(`library/${entry.title}.zip`))[`${entry.title}_index.json`]);
    expect(index.versions[0]).toMatchObject({versionTitle: 'Otzaria (Orayta)', license: 'CC-BY-SA', librarySource: 'dicta'});

    const withSections = load('synthetic_inline');
    const e2 = setUp(withSections, {'OraytaToOtzaria/ספרים/אוצריא/שות/ספר בדיקה דיקטה א.txt': {hash: 'h'}});
    serve({});
    FileSystem.setRemote(withSections.book.textFileURL, zipOf(withSections.pages));
    await extras.downloadBook(e2.title);
    expect(bookFetches()).toEqual([]);
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
