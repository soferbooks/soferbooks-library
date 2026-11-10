/**
 * SoferBooks packs (packs.js): choosing what to download from the release manifest, and
 * installing search shards, package indexes and corrections into library/.
 *
 * Zips are simulated: a "zip" here is a JSON object {path inside the zip: content}, and
 * the react-native-zip-archive mock writes its entries into the in-memory file system.
 */
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {unzip} from 'react-native-zip-archive';
import {
  planPacks, syncPacks, assetBaseUrl, removeHiddenSearchFiles, STATE_KEY, loadPackState,
} from '../packs';
import {applyCorrections, textHash} from '../corrections';

jest.mock('react-native-zip-archive', () => {
  const fs = require('expo-file-system/legacy');
  return {
    unzip: jest.fn(async (zipPath, dest) => {
      const entries = JSON.parse(await fs.readAsStringAsync(zipPath));
      for (const [name, content] of Object.entries(entries)) {
        await fs.writeAsStringAsync(`${dest}/${name}`, content);
      }
      return dest;
    }),
  };
});

const BASE = 'https://github.com/soferbooks/soferbooks-library-data/releases/latest/download';
const TAGGED = 'https://github.com/soferbooks/soferbooks-library-data/releases/download/library-2026-11-10';

const asset = (name, sha256, extra = {}) => ({name, size: 0, sha256, ...extra});

function manifest(overrides = {}) {
  return {
    format: 1,
    tag: 'library-2026-11-10',
    sefaria: {last_updated: '2026-10-23T21:43:25'},
    corrections: asset('corrections.zip', 'c1', {books: 1, ops: 1}),
    search: {
      shards: {
        'tanakh-with-rashi': {packages: ['TANAKH and all commentaries', 'TANAKH with Rashi'],
          probe: 'Genesis', assets: [asset('search-tanakh-with-rashi.zip', 's1')]},
        'tanakh-and-all-commentaries': {packages: ['TANAKH and all commentaries'],
          probe: 'Ibn Ezra on Genesis', assets: [asset('search-tanakh-and-all-commentaries.zip', 's2'),
            asset('search-tanakh-and-all-commentaries-2.zip', 's3')]},
        other: {packages: [], probe: 'Some Book', assets: [asset('search-other.zip', 's4')]},
      },
      packages: {
        'COMPLETE LIBRARY': {shards: ['other', 'tanakh-and-all-commentaries', 'tanakh-with-rashi'],
          index: asset('index-complete-library.idx', 'i0', {file: 'COMPLETE LIBRARY_search.idx'})},
        'TANAKH and all commentaries': {shards: ['tanakh-and-all-commentaries', 'tanakh-with-rashi'],
          index: asset('index-tanakh-and-all-commentaries.idx', 'i1',
            {file: 'TANAKH and all commentaries_search.idx'})},
        'TANAKH with Rashi': {shards: ['tanakh-with-rashi'],
          index: asset('index-tanakh-with-rashi.idx', 'i2', {file: 'TANAKH with Rashi_search.idx'})},
      },
    },
    ...overrides,
  };
}

const zipOf = entries => JSON.stringify(entries);

function serveRelease(m = manifest()) {
  global.fetch = jest.fn(async url => (url === `${BASE}/manifest.json`
    ? {ok: true, json: async () => m}
    : {ok: false, json: async () => null}));
  FileSystem.setRemote(`${TAGGED}/corrections.zip`, zipOf({
    '_corrections/Genesis.json': JSON.stringify({title: 'Genesis',
      files: {'Genesis 1.abcdef12.he': [[[0], textHash('old'), 'new']]}}),
  }));
  FileSystem.setRemote(`${TAGGED}/search-tanakh-with-rashi.zip`, zipOf({
    'Genesis_search.txt': 'Genesis 1:1\tבראשית א׳:1\the\tv\tבראשית',
    'Hidden Book_search.txt': 'Hidden Book 1:1\tx:1\ten\tv\ttext',
  }));
  FileSystem.setRemote(`${TAGGED}/search-tanakh-and-all-commentaries.zip`, zipOf({
    'Ibn Ezra on Genesis_search.txt': 'Ibn Ezra on Genesis 1:1:1\tx\the\tv\tטקסט',
  }));
  FileSystem.setRemote(`${TAGGED}/search-tanakh-and-all-commentaries-2.zip`, zipOf({
    'Radak on Genesis_search.txt': 'Radak on Genesis 1:1:1\tx\the\tv\tטקסט',
  }));
  FileSystem.setRemote(`${TAGGED}/search-other.zip`, zipOf({'Some Book_search.txt': 'a\tb\ten\tv\tc'}));
  for (const name of ['index-complete-library.idx', 'index-tanakh-and-all-commentaries.idx',
    'index-tanakh-with-rashi.idx']) {
    FileSystem.setRemote(`${TAGGED}/${name}`, `idx:${name}`);
  }
}

async function exists(path) {
  return (await FileSystem.getInfoAsync(path)).exists;
}

beforeEach(async () => {
  FileSystem.clear();
  await AsyncStorage.clear();
  unzip.mockClear();
  FileSystem.downloadAsync.mockClear();
  // (the shared mock's moveAsync drops the file; a real move here)
  FileSystem.moveAsync.mockImplementation(async ({from, to}) => {
    const content = await FileSystem.readAsStringAsync(from);
    await FileSystem.writeAsStringAsync(to, content);
    await FileSystem.deleteAsync(from);
  });
});

describe('planPacks', () => {
  const none = {probes: new Set(), indexes: new Set(), corrections: false, anyBooks: false};

  test('a package brings its shards, its index and the corrections', () => {
    const plan = planPacks(manifest(), ['TANAKH with Rashi'], {}, none);
    expect(plan.shards.map(s => s.id)).toEqual(['tanakh-with-rashi']);
    expect(plan.indexes.map(i => i.name)).toEqual(['TANAKH with Rashi']);
    expect(plan.corrections.name).toBe('corrections.zip');
  });

  test('COMPLETE LIBRARY takes every shard and only its own index', () => {
    const plan = planPacks(manifest(), ['COMPLETE LIBRARY', 'TANAKH with Rashi'], {}, none);
    expect(plan.shards.map(s => s.id).sort())
        .toEqual(['other', 'tanakh-and-all-commentaries', 'tanakh-with-rashi']);
    expect(plan.indexes.map(i => i.name)).toEqual(['COMPLETE LIBRARY']);
  });

  test('what is installed and still on disk is kept; a deleted probe means download again', () => {
    const state = {
      shards: {'tanakh-with-rashi': 's1'},
      indexes: {'TANAKH with Rashi': {sha256: 'i2', file: 'TANAKH with Rashi_search.idx'}},
      corrections: 'c1',
    };
    const onDisk = {probes: new Set(['Genesis']), indexes: new Set(['TANAKH with Rashi_search.idx']),
      corrections: true, anyBooks: true};
    let plan = planPacks(manifest(), ['TANAKH with Rashi'], state, onDisk);
    expect(plan.shards).toEqual([]);
    expect(plan.indexes).toEqual([]);
    expect(plan.corrections).toBeNull();
    expect(plan.keep.shards).toEqual({'tanakh-with-rashi': 's1'});

    plan = planPacks(manifest(), ['TANAKH with Rashi'], state, {...onDisk, probes: new Set()});
    expect(plan.shards.map(s => s.id)).toEqual(['tanakh-with-rashi']);
  });

  test('a new release only re-downloads the assets whose hash changed', () => {
    const state = {shards: {'tanakh-with-rashi': 's1', 'tanakh-and-all-commentaries': 's2,s3'},
      indexes: {}, corrections: 'c1'};
    const onDisk = {probes: new Set(['Genesis', 'Ibn Ezra on Genesis']), indexes: new Set(),
      corrections: true, anyBooks: true};
    const m = manifest();
    m.search.shards['tanakh-and-all-commentaries'].assets[1].sha256 = 's3-new';
    m.corrections.sha256 = 'c2';
    const plan = planPacks(m, ['TANAKH and all commentaries'], state, onDisk);
    expect(plan.shards.map(s => s.id)).toEqual(['tanakh-and-all-commentaries']);
    expect(plan.corrections.sha256).toBe('c2');
  });

  test('an index of a package no longer chosen is removed', () => {
    const state = {indexes: {'TANAKH with Rashi': {sha256: 'i2', file: 'TANAKH with Rashi_search.idx'}}};
    const plan = planPacks(manifest(), ['COMPLETE LIBRARY'], state, none);
    expect(plan.removeIndexes).toEqual(['TANAKH with Rashi_search.idx']);
  });

  test('nothing for an unknown manifest format or no release', () => {
    expect(planPacks(null, ['COMPLETE LIBRARY']).shards).toEqual([]);
    expect(planPacks(manifest({format: 99}), ['COMPLETE LIBRARY']).shards).toEqual([]);
  });

  test('corrections are fetched for books already on disk even with no package chosen', () => {
    expect(planPacks(manifest(), [], {}, {...none, anyBooks: true}).corrections.name).toBe('corrections.zip');
    expect(planPacks(manifest(), [], {}, none).corrections).toBeNull();
  });
});

test('assets come from the release the manifest names, not from "latest"', () => {
  expect(assetBaseUrl(BASE, {tag: 'library-2026-11-10'})).toBe(TAGGED);
  expect(assetBaseUrl('http://127.0.0.1:5200/release', {tag: 'x'})).toBe('http://127.0.0.1:5200/release');
});

describe('syncPacks', () => {
  test('installs search files, the index and the corrections, then reads them', async () => {
    serveRelease();
    const result = await syncPacks(['TANAKH with Rashi'], {base: BASE, isHidden: t => t === 'Hidden Book'});
    expect(result.failed).toEqual([]);
    expect(result.downloaded.sort()).toEqual(
        ['corrections.zip', 'index-tanakh-with-rashi.idx', 'search-tanakh-with-rashi.zip']);

    expect(await exists('library/Genesis_search.txt')).toBe(true);
    expect(await exists('library/Hidden Book_search.txt')).toBe(false);   // content filter
    expect(await FileSystem.readAsStringAsync('library/TANAKH with Rashi_search.idx'))
        .toBe('idx:index-tanakh-with-rashi.idx');
    expect(await exists('soferbooks/search-tanakh-with-rashi.zip')).toBe(false);  // tmp cleaned

    const out = await applyCorrections('Genesis', 'Genesis 1.abcdef12.he', ['old']);
    expect(out).toEqual(['new']);

    const state = await loadPackState();
    expect(state.tag).toBe('library-2026-11-10');
    expect(state.shards).toEqual({'tanakh-with-rashi': 's1'});
    expect(state.corrections).toBe('c1');
  });

  test('a second sync downloads nothing; a deleted search file is fetched again', async () => {
    serveRelease();
    await syncPacks(['TANAKH with Rashi'], {base: BASE});
    FileSystem.downloadAsync.mockClear();
    let result = await syncPacks(['TANAKH with Rashi'], {base: BASE});
    expect(result.downloaded).toEqual([]);
    expect(FileSystem.downloadAsync).not.toHaveBeenCalled();

    await FileSystem.deleteAsync('library/Genesis_search.txt');   // e.g. the book was deleted
    result = await syncPacks(['TANAKH with Rashi'], {base: BASE});
    expect(result.downloaded).toEqual(['search-tanakh-with-rashi.zip']);
  });

  test('a shard in two parts is recorded only when both parts installed', async () => {
    serveRelease();
    FileSystem.setRemote(`${TAGGED}/search-tanakh-and-all-commentaries-2.zip`, '', 500);
    const result = await syncPacks(['TANAKH and all commentaries'], {base: BASE});
    expect(result.failed).toEqual(['search-tanakh-and-all-commentaries-2.zip']);
    const state = JSON.parse(await AsyncStorage.getItem(STATE_KEY));
    expect(state.shards).toEqual({'tanakh-with-rashi': 's1'});
  });

  test('a download of the wrong size is not installed', async () => {
    const m = manifest();
    m.search.packages['TANAKH with Rashi'].index.size = 123456;   // the mock reports 5 bytes
    serveRelease(m);
    const result = await syncPacks(['TANAKH with Rashi'], {base: BASE});
    expect(result.failed).toContain('index-tanakh-with-rashi.idx');
    expect(await exists('library/TANAKH with Rashi_search.idx')).toBe(false);
  });

  test('no release reachable: nothing happens', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline'); });
    expect(await syncPacks(['COMPLETE LIBRARY'], {base: BASE})).toBeNull();
    expect(FileSystem.downloadAsync).not.toHaveBeenCalled();
  });
});

test('removeHiddenSearchFiles deletes only hidden books', async () => {
  await FileSystem.writeAsStringAsync('library/A_search.txt', 'a');
  await FileSystem.writeAsStringAsync('library/B_search.txt', 'b');
  await FileSystem.writeAsStringAsync('library/B.zip', 'zip');
  expect(await removeHiddenSearchFiles(t => t === 'B')).toBe(1);
  expect(await exists('library/A_search.txt')).toBe(true);
  expect(await exists('library/B_search.txt')).toBe(false);
  expect(await exists('library/B.zip')).toBe(true);
});
