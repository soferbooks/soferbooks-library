/**
 * Local search lines (localSearch.js) for versions the SoferBooks release may not host,
 * and offline search over hosted + locally made files together.
 *
 * Zips are simulated as in packs.test.js: a "zip" is a JSON object {name: content}, and
 * the react-native-zip-archive mock writes its entries into the in-memory file system.
 */
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {unzip} from 'react-native-zip-archive';
import md5 from 'md5';
import {
  isOpenLicense, bookLines, syncLocalSearch, localSearchPath, STATE_KEY,
} from '../localSearch';
import {executeOfflineQuery, clearOfflineSearchCache} from '../offlineSearch';

jest.mock('react-native-zip-archive', () => {
  const fs = require('expo-file-system/legacy');
  return {
    unzip: jest.fn(async (zipPath, dest) => {
      const entries = JSON.parse(await fs.readAsStringAsync(zipPath));
      for (const [name, content] of Object.entries(entries)) {
        await fs.writeAsStringAsync(`${dest}${name}`, content);
      }
      return dest;
    }),
  };
});

global.Sefaria = {categoriesForTitle: () => ['Tanakh', 'Torah', 'Genesis']};

const OPEN = 'Open Hebrew';
const CLOSED = 'Closed English, All rights reserved';
const vfile = (stem, vt, lang) => `${stem}.${md5(vt).substring(0, 8)}.${lang}.json`;

/** A Sefaria mobile zip of "Genesis" with one open (he) and one closed (en) version. */
function genesisZip(enText = ['In the <b>beginning</b> &amp; then', '', 'the earth']) {
  const versions = [{versionTitle: CLOSED, language: 'en'}, {versionTitle: OPEN, language: 'he'}];
  return {
    'Genesis_index.json': JSON.stringify({title: 'Genesis', versions: [
      {versionTitle: CLOSED, language: 'en', license: 'Copyright: Someone'},
      {versionTitle: OPEN, language: 'he', license: 'Public Domain'},
    ]}),
    'Genesis 1.metadata.json': JSON.stringify({ref: 'Genesis 1', heRef: 'בראשית א', versions}),
    [vfile('Genesis 1', CLOSED, 'en')]: JSON.stringify(enText),
    [vfile('Genesis 1', OPEN, 'he')]: JSON.stringify(['בְּרֵאשִׁית בָּרָא']),
  };
}

async function putZip(title, entries, seconds) {
  await FileSystem.writeAsStringAsync(`library/${title}.zip`, JSON.stringify(entries));
  FileSystem.setTimestamp(`library/${title}.zip`, seconds * 1000);
}

beforeEach(async () => {
  FileSystem.clear();
  await AsyncStorage.clear();
  unzip.mockClear();
  clearOfflineSearchCache();
});

test('licences: open (incl. non-commercial) vs everything else', () => {
  ['Public Domain', 'PD', 'CC0', 'CC-BY', 'CC-BY-SA', 'CC-BY-NC', 'CC-BY-NC-SA', 'CC BY-SA 4.0']
    .forEach(l => expect(isOpenLicense(l)).toBe(true));
  ['Copyright: Steinsaltz Center', 'Copyright', 'unknown', 'CC-BY-NC-ND', 'All rights reserved', '', null, undefined]
    .forEach(l => expect(isOpenLicense(l)).toBe(false));
});

test('bookLines makes build_search.py lines for the closed versions only', async () => {
  const zip = genesisZip();
  const lines = await bookLines(Object.keys(zip), async name => zip[name]);
  expect(lines).toEqual([
    `Genesis 1:1\tבראשית א:1\ten\t${CLOSED}\tIn the beginning & then`,
    `Genesis 1:3\tבראשית א:3\ten\t${CLOSED}\tthe earth`,
  ]);
});

test('a version missing from the index (no licence) is made locally too', async () => {
  const zip = genesisZip();
  zip['Genesis_index.json'] = JSON.stringify({versions: []});
  const lines = await bookLines(Object.keys(zip), async name => zip[name]);
  expect(lines.map(l => l.split('\t')[2]).sort()).toEqual(['en', 'en', 'he']);
});

test('search finds hosted and locally made lines together', async () => {
  // hosted file (release): the open version
  await FileSystem.writeAsStringAsync('library/Genesis_search.txt',
      `Genesis 1:1\tבראשית א:1\the\t${OPEN}\tבְּרֵאשִׁית בָּרָא\n`);
  await putZip('Genesis', genesisZip(), 100);
  const result = await syncLocalSearch(['Genesis']);
  expect(result.built).toEqual(['Genesis']);

  const en = await executeOfflineQuery({query: 'earth', type: 'text', size: 10, start: 0});
  expect(en.hits.hits.map(h => [h._source.ref, h._source.version])).toEqual([['Genesis 1:3', CLOSED]]);
  const he = await executeOfflineQuery({query: 'בראשית', type: 'text', size: 10, start: 0});
  expect(he.hits.hits.map(h => h._source.version)).toEqual([OPEN]);
});

test('an unchanged zip is not redone; a Sefaria update regenerates its lines', async () => {
  await putZip('Genesis', genesisZip(), 100);
  await syncLocalSearch(['Genesis']);
  expect(unzip).toHaveBeenCalledTimes(1);

  expect((await syncLocalSearch(['Genesis'])).built).toEqual([]);
  expect(unzip).toHaveBeenCalledTimes(1);

  await putZip('Genesis', genesisZip(['A new translation of the beginning']), 200);
  expect((await syncLocalSearch(['Genesis'])).built).toEqual(['Genesis']);
  const text = await FileSystem.readAsStringAsync(localSearchPath('Genesis'));
  expect(text).toBe(`Genesis 1:1\tבראשית א:1\ten\t${CLOSED}\tA new translation of the beginning\n`);
  expect(JSON.parse(await AsyncStorage.getItem(STATE_KEY)).Genesis).toBe('200:5');
});

test('deleted, hidden or no longer listed books lose their local file', async () => {
  await putZip('Genesis', genesisZip(), 100);
  await syncLocalSearch(['Genesis']);
  expect(await syncLocalSearch(['Genesis'], {isHidden: t => t === 'Genesis'}))
    .toEqual({built: [], removed: ['Genesis']});
  expect((await FileSystem.getInfoAsync(localSearchPath('Genesis'))).exists).toBe(false);

  await syncLocalSearch(['Genesis']);
  expect((await syncLocalSearch([])).removed).toEqual(['Genesis']);
  expect((await FileSystem.getInfoAsync(localSearchPath('Genesis'))).exists).toBe(false);
});
