/**
 * The Sofer Library as an extra source (extras/sofer.js): the books only Sofer has, hosted as
 * one SoferBooks GitHub Release (tools/library-export/build_sofer_library.py), downloaded ready
 * made and put in the library as every extra book is.
 *
 * SYNTHETIC TEST FIXTURE: the catalogue and the books' files below are made up (not real texts);
 * they have the shape build_sofer_library.py writes.
 */
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {unzip} from 'react-native-zip-archive';
import sofer, {
  ID, RELEASE_TAG, RELEASE_URL, CATALOG_URL, parseCatalog, entryFor, bookUrl, convert, withSource,
} from '../extras/sofer';
import * as extras from '../extras';
import {addToToc, chooseBooks} from '../extras/catalog';
import * as shomer from '../shomer';
import {correctionEmail, FALLBACK_EMAIL} from '../reportError';
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

const POEMS = 'שירי בדיקה';
const NOTES = `הערות המהדיר על ${POEMS}`;

/** A book's schema-7 files (made up), as export_v7.py writes them (8a3818b5: md5 of "Test edition") */
function filesOf(title, heTitle, text) {
  const version = {language: 'he', title, versionTitle: 'Test edition', license: 'Public Domain'};
  return {
    [`${title}_index.json`]: {title, heTitle, schema: {nodeType: 'JaggedArrayNode', depth: 1}, versions: [version]},
    [`${title}.metadata.json`]: {ref: title, heRef: heTitle, versions: [{versionTitle: 'Test edition', language: 'he'}]},
    [`${title}.8a3818b5.he.json`]: [text],
  };
}
const zipOf = files => JSON.stringify(Object.fromEntries(Object.entries(files).map(([n, d]) => [n, JSON.stringify(d)])));

const BOOKS = {
  [POEMS]: filesOf(POEMS, POEMS, 'שיר בדיקה'),
  [NOTES]: filesOf(NOTES, NOTES, 'הערה'),
  'Tur, Test Part': filesOf('Tur, Test Part', 'טור, חלק בדיקה', 'טקסט בדיקה'),
};

const CATALOG = {
  format: 1,
  source: ID,
  tag: RELEASE_TAG,
  books: [
    {
      title: POEMS, heTitle: POEMS, kind: 'ben-yehuda', categories: ['Poetry and Piyyut'], heCategories: ['שירה ופיוט'],
      license: ['Public Domain'], file: 'book-11111111.zip', size: 300, sha256: 'a'.repeat(64), md5: null,
      firstSection: POEMS,
      companions: [{
        title: NOTES, heTitle: NOTES, kind: 'ben-yehuda', categories: ['Poetry and Piyyut'], heCategories: ['שירה ופיוט'],
        license: ['Public Domain'], file: 'book-22222222.zip', size: 100, sha256: 'b'.repeat(64), md5: null,
        firstSection: NOTES, dependence: 'Commentary', base_text_titles: [POEMS], companionOf: POEMS,
      }],
    },
    {
      title: 'Tur, Test Part', heTitle: 'טור, חלק בדיקה', kind: 'split', categories: ['Halakhah', 'Tur'],
      heCategories: ['הלכה', 'טור'], license: ['CC0', 'Public Domain'], file: 'Tur-Test-Part-33333333.zip', size: 200,
      sha256: 'c'.repeat(64), md5: null, firstSection: 'Tur, Test Part',
    },
    // (a title the library would change - "/" - cannot name its files: not offered)
    {title: 'A/B', heTitle: 'א/ב', categories: ['Halakhah'], file: 'A-B.zip', license: ['CC0']},
  ],
};

const fileFor = title => CATALOG.books.flatMap(b => [b, ...(b.companions || [])]).find(b => b.title === title).file;

describe('the Sofer Library source', () => {
  test('one release tag names every address (a new release changes one line)', () => {
    expect(RELEASE_URL).toBe(`https://github.com/soferbooks/soferbooks-library-data/releases/download/${RELEASE_TAG}`);
    expect(CATALOG_URL).toBe(`${RELEASE_URL}/sofer-library-catalog.json`);
    expect(sofer.catalogUrl).toBe(CATALOG_URL);
    expect(RELEASE_TAG).toMatch(/^sofer-library-\d{4}-\d\d-\d\d[a-z]?$/);
  });

  test('registered as an extra source, off by default, named Sofer Library / ספריית סופר', () => {
    expect(extras.EXTRA_SOURCES[ID]).toBe(sofer);
    const s = SOURCES.find(x => x.id === ID);
    expect(s).toMatchObject({name: 'Sofer Library', heName: 'ספריית סופר', extra: true, available: true, enabled: false});
  });

  test('the catalogue: each book with its shelf, licence and the notes book that comes with it', () => {
    const entries = parseCatalog(JSON.stringify(CATALOG));
    expect(entries.map(e => e.title)).toEqual([POEMS, 'Tur, Test Part']);
    const [poems, tur] = entries;
    expect(poems).toMatchObject({
      source: ID, id: POEMS, hash: 'a'.repeat(64), categories: ['Poetry and Piyyut'], heCategories: ['שירה ופיוט'],
      license: 'Public Domain', kind: 'ben-yehuda',
    });
    expect(poems.companions.map(c => c.title)).toEqual([NOTES]);
    expect(tur.license).toBe('CC0 / Public Domain');
    expect(bookUrl(tur)).toBe(`${RELEASE_URL}/Tur-Test-Part-33333333.zip`);
    expect(() => parseCatalog(JSON.stringify({format: 2, books: []}))).toThrow();
    expect(entryFor({title: 'x'})).toBeNull();
  });

  test('its books are listed on the shelves of their kind (a new "שירה ופיוט" shelf for poems)', () => {
    const sefariaToc = [{category: 'Halakhah', heCategory: 'הלכה', contents: [{title: 'Tur', heTitle: 'טור'}]}];
    const {books} = chooseBooks(sefariaToc, {[ID]: parseCatalog(CATALOG)});
    expect(Object.keys(books).sort()).toEqual([POEMS, 'Tur, Test Part'].sort());
    const toc = addToToc(sefariaToc, books);
    const halakhah = toc.find(c => c.category === 'Halakhah');
    expect(halakhah.contents.find(c => c.category === 'Tur').contents[0])
      .toMatchObject({title: 'Tur, Test Part', librarySource: ID});
    const poetry = toc.find(c => c.category === 'Poetry and Piyyut');
    expect(poetry.heCategory).toBe('שירה ופיוט');
    expect(poetry.contents[0].title).toBe(POEMS);
  });

  test('the books go through the content filter like every other book', () => {
    const toc = addToToc([], chooseBooks([], {[ID]: parseCatalog(CATALOG)}).books);
    shomer.setConfig({preset: 'rwmo'});
    try {
      const filtered = shomer.applyToToc(toc);
      expect(JSON.stringify(filtered)).toContain(POEMS);
      expect(shomer.isBookHidden(POEMS)).toBe(false);
    } finally {
      shomer.setConfig(null);
    }
  });

  test('the books come ready made: their editions are marked as this library\'s', () => {
    const files = BOOKS['Tur, Test Part'];
    const marked = withSource(files, 'Tur, Test Part');
    expect(marked['Tur, Test Part_index.json'].librarySource).toBe(ID);
    expect(marked['Tur, Test Part_index.json'].versions.every(v => v.librarySource === ID)).toBe(true);
    expect(files['Tur, Test Part_index.json'].librarySource).toBeUndefined();    // (the files given are not changed)
    const entry = parseCatalog(CATALOG)[1];
    const out = convert(entry, {book: {entry, files}, companions: []});
    expect(out.firstSection).toBe('Tur, Test Part');
    expect(out.companions).toEqual([]);
    expect(Object.keys(out.files).sort()).toEqual(Object.keys(files).sort());
  });

  test('"Report an error" on its texts goes to SoferBooks', () => {
    const e = correctionEmail({ref: 'Tur, Test Part 1', text: 't', version: {librarySource: ID, versionTitle: 'v'}, platform: 'android'});
    expect(e.to).toBe(FALLBACK_EMAIL);
    expect(FALLBACK_EMAIL).toBe('corrections@soferbooks.com');
  });
});

describe('downloading a Sofer Library book', () => {
  beforeEach(async () => {
    FileSystem.clear();
    FileSystem.downloadAsync.mockClear();
    unzip.mockClear();
    await AsyncStorage.clear();
    for (const [title, files] of Object.entries(BOOKS)) {
      FileSystem.setRemote(`${RELEASE_URL}/${fileFor(title)}`, zipOf(files));
    }
    extras._reset({enabled: {[ID]: true}, catalogs: {[ID]: {fetchedAt: Date.now(), entries: parseCatalog(CATALOG)}}});
    extras.applyToToc([]);
  });

  test('the book and its editors\' notes come from the release, are put in the library, and the temporary files go', async () => {
    expect(extras.needsDownload(POEMS)).toBe(true);
    const first = await extras.downloadBook(POEMS);
    expect(first).toBe(POEMS);
    expect(FileSystem.downloadAsync.mock.calls.map(c => c[0]))
      .toEqual([`${RELEASE_URL}/book-11111111.zip`, `${RELEASE_URL}/book-22222222.zip`]);
    const zip = JSON.parse(await FileSystem.readAsStringAsync(`library/${POEMS}.zip`));
    const index = JSON.parse(zip[`${POEMS}_index.json`]);
    expect(index.librarySource).toBe(ID);
    expect(index.versions[0]).toMatchObject({versionTitle: 'Test edition', license: 'Public Domain', librarySource: ID});
    expect(JSON.parse(zip[`${POEMS}.8a3818b5.he.json`])).toEqual(['שיר בדיקה']);
    // (its offline search lines, as for every extra book)
    expect(await FileSystem.readAsStringAsync(`library/${POEMS}_search.txt`)).toContain('שיר בדיקה');
    // the notes book is downloaded with it and listed beside it
    expect(extras.isDownloaded(NOTES)).toBe(true);
    expect(extras.extraBook(NOTES)).toMatchObject({categories: ['Poetry and Piyyut'], source: ID});
    expect(extras.downloadedBooks(ID)).toEqual([POEMS]);
    // nothing left in the cache
    const left = (await FileSystem.readDirectoryAsync('')).filter(n => n.includes('sofer-'));
    expect(left).toEqual([]);
    // deleting the book deletes its notes too
    await extras.deleteBook(POEMS);
    expect(extras.isDownloaded(NOTES)).toBe(false);
    expect(extras.needsDownload(POEMS)).toBe(true);
  });

  test('progress is shown as a share of the bytes, and Cancel leaves nothing behind', async () => {
    const fsMock = FileSystem;
    const seen = [];
    const off = extras.subscribe(() => { const p = extras.downloadProgress(POEMS); if (p) { seen.push(p); } });
    let cancelOn = null;
    fsMock.createDownloadResumable = jest.fn((url, to, opts, onProgress) => ({
      downloadAsync: async () => {
        onProgress({totalBytesWritten: 50, totalBytesExpectedToWrite: 100});
        if (fsMock.createDownloadResumable.mock.calls.length === cancelOn) {
          extras.cancelDownload(POEMS);
          return undefined;
        }
        onProgress({totalBytesWritten: 100, totalBytesExpectedToWrite: 100});
        return fsMock.downloadAsync(url, to);
      },
      cancelAsync: jest.fn(async () => {}),
    }));
    try {
      await extras.downloadBook(POEMS);
      const shares = seen.filter(p => p.unit === 'percent').map(p => p.done);
      expect(shares[shares.length - 1]).toBe(100);
      expect(seen.filter(p => p.unit).every(p => p.unit === 'percent' && p.total === 100)).toBe(true);
      await extras.deleteBook(POEMS);
      fsMock.createDownloadResumable.mockClear();
      cancelOn = 2;                  // (during the notes book's zip)
      await expect(extras.downloadBook(POEMS)).rejects.toBeInstanceOf(extras.DownloadCancelledError);
      expect((await FileSystem.getInfoAsync(`library/${POEMS}.zip`)).exists).toBe(false);
      expect(extras.needsDownload(POEMS)).toBe(true);
      expect(extras.downloadProgress(POEMS)).toBeNull();
    } finally {
      off();
      delete fsMock.createDownloadResumable;
    }
  });

  test('a zip that did not arrive whole (md5) is not put in the library', async () => {
    const entries = parseCatalog(CATALOG).map(e => (e.title === 'Tur, Test Part' ? {...e, md5: 'f'.repeat(32)} : e));
    extras._reset({enabled: {[ID]: true}, catalogs: {[ID]: {fetchedAt: Date.now(), entries}}});
    extras.applyToToc([]);
    FileSystem.getInfoAsync.mockImplementationOnce(async uri => ({exists: true, uri, md5: '0'.repeat(32)}));
    await expect(extras.downloadBook('Tur, Test Part')).rejects.toThrow(/did not arrive whole/);
    expect(extras.isDownloaded('Tur, Test Part')).toBe(false);
  });

  test('a book missing from the release is an error, not an empty book', async () => {
    FileSystem.setRemote(`${RELEASE_URL}/Tur-Test-Part-33333333.zip`, '', 404);
    await expect(extras.downloadBook('Tur, Test Part')).rejects.toThrow(/HTTP 404/);
    expect(extras.isDownloaded('Tur, Test Part')).toBe(false);
  });
});
