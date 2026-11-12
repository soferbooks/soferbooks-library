/**
 * QA round 14 (2026-11-12): the full-library download filled the phone and crashed it, and the
 * Sofer Library's books could not be read on from section to section. SYNTHETIC TEST FIXTURES:
 * the books below are made-up stand-ins laid out as the Sofer Library's files are (names, refs,
 * the "<title>, default 1" files of a default node), not real texts.
 */
import * as FileSystem from 'expo-file-system/legacy';
import {unzip} from 'react-native-zip-archive';
import md5 from 'md5';
import * as storage from '../storage';
import {defaultAlias, withoutDefault, leafStems, orderStems, sectionsOfFile} from '../reader/sectionOrder';
import {withOwnBooks} from '../search/localAutocomplete';
import {displayRef, setEnglishNameLookup} from '../extras/schema7';

// (the phone: file names are not URI-encoded as on iOS, DownloadControl.loadJSONFile)
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const P = {OS: 'android', Version: 34, select: o => (o.android !== undefined ? o.android : o.default)};
  return {__esModule: true, default: P, ...P};
});

jest.mock('react-native-zip-archive', () => ({
  __esModule: true,
  unzip: jest.fn(async () => 'ok'),
  zip: jest.fn(async () => 'ok'),
}));

beforeEach(() => {
  FileSystem.clear();
  storage._setFreeBytes(null);
  unzip.mockClear();
});

describe('storage: free space, safe unzips, whole files', () => {
  test('the free space decides whether a download fits, with a margin', async () => {
    storage._setFreeBytes(1000 * storage.MB);
    expect(await storage.hasRoom(600 * storage.MB)).toBe(true);           // (600 + 300 margin)
    expect(await storage.hasRoom(800 * storage.MB)).toBe(false);
    await expect(storage.ensureRoom(800 * storage.MB)).rejects.toMatchObject({name: 'LowSpaceError', free: 1000 * storage.MB});
    storage._setFreeBytes(null);                                           // (the phone's own answer)
    expect(await storage.freeBytes()).toBe(64e9);
  });

  test('work files are kept in the documents folder, not the cache folder Android empties', () => {
    expect(storage.WORK_DIR.startsWith(FileSystem.documentDirectory)).toBe(true);
    expect(storage.WORK_DIR).toContain('work/');
  });

  test('a zip that is not there, or empty, is not unzipped: an error, never a crash', async () => {
    await expect(storage.safeUnzip('gone.zip', 'out/')).rejects.toMatchObject({name: 'UnzipError'});
    expect(unzip).not.toHaveBeenCalled();
    FileSystem.getInfoAsync.mockImplementationOnce(async () => ({exists: true, size: 0}));
    await expect(storage.safeUnzip('empty.zip', 'out/')).rejects.toMatchObject({name: 'UnzipError'});
    expect(unzip).not.toHaveBeenCalled();
  });

  test('a failed unzip (the native module rejects) is an UnzipError the caller handles', async () => {
    await FileSystem.writeAsStringAsync('book.zip', 'PK...');
    unzip.mockImplementationOnce(async () => { throw new Error('Failed to extract file'); });
    await expect(storage.safeUnzip('book.zip', 'out/')).rejects.toMatchObject({name: 'UnzipError'});
    await expect(storage.safeUnzip('book.zip', 'out/')).resolves.toBe('ok');
  });

  test('a file is replaced only by a complete new one, and kept when the move fails', async () => {
    await FileSystem.writeAsStringAsync('library/Genesis.zip', 'old');
    await FileSystem.writeAsStringAsync('work/Genesis.zip', 'new');
    await storage.replaceFile('work/Genesis.zip', 'library/Genesis.zip');
    expect(await FileSystem.readAsStringAsync('library/Genesis.zip')).toBe('new');
    expect((await FileSystem.getInfoAsync('library/Genesis.zip.old')).exists).toBe(false);

    await FileSystem.writeAsStringAsync('work/Rashi.zip', 'new');
    await FileSystem.writeAsStringAsync('library/Rashi.zip', 'old');
    const realMove = FileSystem.moveAsync.getMockImplementation();
    FileSystem.moveAsync
      .mockImplementationOnce(realMove)                                   // (old -> aside)
      .mockImplementationOnce(async () => { throw new Error('disk full'); });
    await expect(storage.replaceFile('work/Rashi.zip', 'library/Rashi.zip')).rejects.toThrow('disk full');
    expect(await FileSystem.readAsStringAsync('library/Rashi.zip')).toBe('old');
  });
});

describe('a Sefaria bundle is unzipped beside the library, then swapped in', () => {
  const {unzipBundle} = require('../DownloadControl');

  test('the books arrive only once the whole bundle unzipped', async () => {
    await FileSystem.writeAsStringAsync('library/Genesis.zip', 'old Genesis');
    await FileSystem.writeAsStringAsync('work/sefaria/1.zip', 'bundle');
    unzip.mockImplementationOnce(async (from, dest) => {
      expect(dest).toBe(`${storage.WORK_DIR}sefaria-unzip/`);           // (not the library itself)
      await FileSystem.writeAsStringAsync(`${dest}Genesis.zip`, 'new Genesis');
      await FileSystem.writeAsStringAsync(`${dest}Exodus.zip`, 'new Exodus');
    });
    await unzipBundle('work/sefaria/1.zip');
    expect(await FileSystem.readAsStringAsync('library/Genesis.zip')).toBe('new Genesis');
    expect(await FileSystem.readAsStringAsync('library/Exodus.zip')).toBe('new Exodus');
  });

  test('a bundle that does not unzip leaves the books as they were', async () => {
    await FileSystem.writeAsStringAsync('library/Genesis.zip', 'old Genesis');
    await FileSystem.writeAsStringAsync('work/sefaria/2.zip', 'broken');
    unzip.mockImplementationOnce(async (from, dest) => {
      await FileSystem.writeAsStringAsync(`${dest}Genesis.zip`, 'half');
      throw new Error('Failed to extract file: No space left on device');
    });
    await expect(unzipBundle('work/sefaria/2.zip')).rejects.toMatchObject({name: 'UnzipError'});
    expect(await FileSystem.readAsStringAsync('library/Genesis.zip')).toBe('old Genesis');
  });
});

// ---------------------------------------------------------------- reading on from file to file
const BY = 'Beit Yosef, Orach Chayim';
const BY_INDEX = {
  title: BY,
  schema: {nodeType: 'SchemaNode', key: BY, nodes: [
    {nodeType: 'JaggedArrayNode', depth: 1, title: 'Introduction', key: 'Introduction'},
    {nodeType: 'JaggedArrayNode', depth: 3, key: 'default', default: true},
  ]},
};
const SL = 'Shuvu Lachem LeOhaleichem';
const SL_INDEX = {
  title: SL,
  schema: {nodeType: 'SchemaNode', key: SL, nodes: [
    {nodeType: 'JaggedArrayNode', depth: 1, title: 'S1', key: 'S1'},
    {nodeType: 'SchemaNode', title: 'S2', key: 'S2', nodes: [
      {nodeType: 'JaggedArrayNode', depth: 1, title: 'S1', key: 'S1'},
      {nodeType: 'JaggedArrayNode', depth: 1, title: 'S2', key: 'S2'},
    ]},
    {nodeType: 'JaggedArrayNode', depth: 1, title: 'S10', key: 'S10'},
  ]},
};

describe('the order of a book\'s section files (reader/sectionOrder.js)', () => {
  test('the default node\'s files are "<title>, default 1" where the reader says "<title> 1"', () => {
    expect(defaultAlias(`${BY} 12`, BY)).toBe(`${BY}, default 12`);
    expect(defaultAlias(`${BY}, Introduction`, BY)).toBe(null);
    expect(withoutDefault(`${BY}, default 12:3`, BY)).toBe(`${BY} 12:3`);
    expect(withoutDefault(`${BY}, Introduction`, BY)).toBe(`${BY}, Introduction`);
  });

  test('the schema\'s leaves, then each leaf\'s files by number (10 after 9)', () => {
    expect(leafStems(BY_INDEX)).toEqual([{stem: `${BY}, Introduction`, alias: null}, {stem: BY, alias: `${BY}, default`}]);
    const names = [`${BY}, default 10`, `${BY}, default 2`, `${BY}, Introduction`, `${BY}, default 1`, 'Beit Yosef, Orach Chayim Other'];
    expect(orderStems(BY_INDEX, names, {includeUnplaced: false}))
      .toEqual([`${BY}, Introduction`, `${BY}, default 1`, `${BY}, default 2`, `${BY}, default 10`]);
    expect(orderStems(SL_INDEX, [`${SL}, S10`, `${SL}, S2, S2`, `${SL}, S1`, `${SL}, S2, S1`]))
      .toEqual([`${SL}, S1`, `${SL}, S2, S1`, `${SL}, S2, S2`, `${SL}, S10`]);
  });

  test('a file of many sections, or of one', () => {
    expect(sectionsOfFile({sections: {'X 1:1': {}, 'X 1:2': {}}})).toEqual(['X 1:1', 'X 1:2']);
    expect(sectionsOfFile({ref: 'X, S1'})).toEqual(['X, S1']);
  });
});

describe('reading a Sofer Library book offline', () => {
  const V = 'Sofer Library';
  const hash = md5(V).substring(0, 8);
  const put = (name, data) => FileSystem.writeAsStringAsync(`/${name}.json`, JSON.stringify(data));
  const section = (ref, prev, next) => ({ref, sectionRef: ref, heRef: ref, indexTitle: BY, heTitle: 'בית יוסף',
    versions: [{versionTitle: V, language: 'he'}], links: [[]], prev, next});
  let offline;

  beforeEach(async () => {
    const titles = [BY, SL];
    global.Sefaria = {
      _jsonSectionData: {}, _jsonData: {},
      textTitleForRef: ref => titles.filter(t => ref === t || ref.startsWith(`${t} `) || ref.startsWith(`${t},`))
        .sort((a, b) => b.length - a.length)[0] || null,
      refUpOne: ref => ref.replace(/[:.]\d+$/, ''),
      refMissingColon: ref => ref,
      cacheCurrVersionsBySection: jest.fn(),
      cacheVersionsAvailableBySection: jest.fn(),
      primaryCategoryForTitle: () => 'Halakhah',
      debugNoLibrary: false,
      util: {objectHasNonNullValues: o => !!o && Object.values(o).some(v => v !== null && v !== undefined)},
    };
    await put(`${BY}_index`, BY_INDEX);
    await FileSystem.writeAsStringAsync(`/library/${BY}.zip`, 'zip');
    await put(`${BY}, default 1.metadata`, {ref: `${BY}, default 1`, sections: {
      [`${BY}, default 1:1`]: section(`${BY}, default 1:1`, null, `${BY}, default 1:2`),
      [`${BY}, default 1:2`]: section(`${BY}, default 1:2`, `${BY}, default 1:1`, null),
    }});
    await put(`${BY}, default 1.${hash}.he`, {ref: `${BY}, default 1`, sections: {
      [`${BY}, default 1:1`]: ['א', 'ב'], [`${BY}, default 1:2`]: ['ג'],
    }});
    await put(`${BY}, default 2.metadata`, {ref: `${BY}, default 2`, sections: {
      [`${BY}, default 2:1`]: section(`${BY}, default 2:1`, null, null),
    }});
    await put(`${BY}, default 2.${hash}.he`, {ref: `${BY}, default 2`, sections: {[`${BY}, default 2:1`]: ['ד']}});
    offline = require('../offline');
  });

  afterEach(() => { delete global.Sefaria; });

  test('"Beit Yosef, Orach Chayim 1:1" is read from the "default" files, named as the reader names it', async () => {
    const {textContent} = await offline.loadTextOffline(`${BY} 1:1`, {}, true);
    expect(textContent.sectionRef).toBe(`${BY} 1:1`);
    expect(textContent.content.map(c => c.he)).toEqual(['א', 'ב']);
    expect(textContent.next).toBe(`${BY} 1:2`);
    expect(textContent._fileSectionRef).toBeUndefined();
  });

  test('the last section of a file goes on to the first of the next file, and back', async () => {
    const last = (await offline.loadTextOffline(`${BY} 1:2`, {}, true)).textContent;
    expect(last.next).toBe(`${BY} 2:1`);
    const next = (await offline.loadTextOffline(`${BY} 2:1`, {}, true)).textContent;
    expect(next.prev).toBe(`${BY} 1:2`);
    expect(next.next).toBe(null);                                          // (the end of the book)
  });

  test('a ref above the file\'s sections opens its first section, not an empty "section" with no book', async () => {
    const {textContent} = await offline.loadTextOffline(`${BY} 2`, {}, true);
    expect(textContent.sectionRef).toBe(`${BY} 2:1`);
    expect(textContent.indexTitle).toBe(BY);
  });
});

describe('finding the extra sources\' books by title', () => {
  beforeEach(() => {
    global.Sefaria = {
      booksDict: {[SL]: 1, Genesis: 1},
      index: t => ({[SL]: {heTitle: 'שובו לכם לאהליכם'}, Genesis: {heTitle: 'בראשית'}}[t]),
      toc: [],
    };
  });
  afterEach(() => { delete global.Sefaria; });

  test('the Name API\'s answer keeps the Sofer Library\'s book it does not know', () => {
    const api = {lang: 'en', completion_objects: [{title: 'Shuvu', key: 'Shuvu', type: 'Topic'}], completions: ['Shuvu'], is_ref: false};
    const out = withOwnBooks('Shuvu Lachem', api, t => t === SL);
    expect(out.completion_objects[0]).toMatchObject({title: SL, key: SL, type: 'ref'});
    expect(out.completion_objects).toHaveLength(2);
    // (and in Hebrew)
    const he = withOwnBooks('שובו לכם', {...api, lang: 'he'}, t => t === SL);
    expect(he.completion_objects[0]).toMatchObject({key: SL});
    // (Sefaria's own books are left to the API)
    expect(withOwnBooks('Genesis', {...api}, t => t === SL).completion_objects).toHaveLength(1);
  });
});

describe('a Sofer Library book\'s English name in the reader\'s header', () => {
  afterEach(() => setEnglishNameLookup(null));

  test('its Hebrew name is replaced by its English one', () => {
    const ref = 'Out of the Iron Furnace, S1';
    expect(displayRef(ref, 'מכור הברזל, TRANSLATOR\'S PREFACE')).toBe('מכור הברזל, TRANSLATOR\'S PREFACE');
    setEnglishNameLookup(r => (r.startsWith('Out of the Iron Furnace') ? {en: 'Out of the Iron Furnace', he: 'מכור הברזל'} : null));
    expect(displayRef(ref, 'מכור הברזל, TRANSLATOR\'S PREFACE')).toBe('Out of the Iron Furnace, TRANSLATOR\'S PREFACE');
    expect(displayRef('אור, S1', 'אור, הקדמה')).toBe('אור, הקדמה');      // (a book without one)
  });
});

describe('several downloads at once (downloadPool.js)', () => {
  const pool = require('../downloadPool');
  beforeAll(() => pool._setBackoffScale(0));
  afterAll(() => pool._setBackoffScale(1));

  test('at most `limit` at once, results in order', async () => {
    let now = 0;
    let most = 0;
    const out = await pool.mapLimit([5, 1, 4, 2, 3, 0, 6], 3, async (ms, i) => {
      now += 1; most = Math.max(most, now);
      await new Promise(r => setTimeout(r, ms));
      now -= 1;
      return i;
    });
    expect(most).toBe(3);
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test('a failed request is tried again; one not worth retrying is not', async () => {
    let calls = 0;
    await expect(pool.withRetry(async () => { calls += 1; if (calls < 3) { throw new Error('reset'); } return 'ok'; })).resolves.toBe('ok');
    expect(calls).toBe(3);
    calls = 0;
    await expect(pool.withRetry(async () => { calls += 1; throw new Error('404'); }, {shouldRetry: () => false})).rejects.toThrow('404');
    expect(calls).toBe(1);
  });
});
