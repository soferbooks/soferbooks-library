/**
 * Offline search: query parsing, the scan over <Title>_search.txt files, and
 * the per-package trigram index.
 *
 * `expo-file-system/legacy` is mapped by jest.config.js to
 * __mocks__/expo-file-system.js; its in-memory testCache and File class stand
 * in for the device's files.
 */
import * as FileSystem from 'expo-file-system/legacy';
import {
  executeOfflineQuery, parseQuery, normalizeQueryWord, wordRegExp, termTrigrams,
  clearOfflineSearchCache,
} from '../offlineSearch';

global.Sefaria = {
  categoriesForTitle: title => (title === 'Genesis' ? ['Tanakh', 'Torah', 'Genesis'] : ['Temple', 'Siddur']),
};

const LIB = 'library/';
const LINE = (ref, heRef, lang, version, text) => `${ref}\t${heRef}\t${lang}\t${version}\t${text}`;

const GENESIS = [
  LINE('Genesis 1:1', 'בראשית א׳:א׳', 'he', 'merged', 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ'),
  LINE('Genesis 1:1', 'בראשית א׳:א׳', 'en', 'merged', 'When God began to create heaven and earth'),
  LINE('Genesis 1:2', 'בראשית א׳:ב׳', 'he', 'merged', 'וְהָאָרֶץ הָיְתָה תֹהוּ וָבֹהוּ'),
].join('\n');

const SIDDUR = LINE('Siddur Ashkenaz, Weekday, Modeh Ani:1', 'סידור, מודה אני:1', 'he', 'merged', 'מוֹדֶה אֲנִי לְפָנֶיךָ');

function write(name, content) {
  return FileSystem.writeAsStringAsync(`${LIB}${name}`, content);
}

/** Build a package index in the format build_search_index.py writes. */
function encodeIndex(titles, postings) {
  const encoder = new TextEncoder();
  const titleBytes = titles.map(title => encoder.encode(title));
  const size = 4 + 4
      + titleBytes.reduce((sum, b) => sum + 2 + b.length, 0)
      + 4
      + postings.reduce((sum, p) => sum + 4 + p.ids.length * 2, 0);
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  let off = 0;
  [0x53, 0x46, 0x49, 0x31].forEach(b => { view.setUint8(off++, b); });
  view.setUint32(off, titles.length, true); off += 4;
  for (const bytes of titleBytes) {
    view.setUint16(off, bytes.length, true); off += 2;
    new Uint8Array(buf, off, bytes.length).set(bytes); off += bytes.length;
  }
  view.setUint32(off, postings.length, true); off += 4;
  for (const posting of postings) {
    view.setUint16(off, posting.hash, true); off += 2;
    view.setUint16(off, posting.ids.length, true); off += 2;
    for (const id of posting.ids) { view.setUint16(off, id, true); off += 2; }
  }
  return new Uint8Array(buf);
}

function installIndex(titles, postings, name = 'PACK_search.idx') {
  return write(name, encodeIndex(titles, postings));
}

function postingsFor(word, ids) {
  return termTrigrams(word).map(hash => ({ hash, ids }));
}

beforeEach(async () => {
  FileSystem.clear();
  FileSystem.readAsStringAsync.mockClear();
  clearOfflineSearchCache();
  await write('Genesis_search.txt', GENESIS);
  await write('Siddur Ashkenaz_search.txt', SIDDUR);
});

test('normalizes Hebrew vowel points and quote marks', () => {
  expect(normalizeQueryWord('בְּרֵאשִׁית')).toBe('בראשית');
  expect(normalizeQueryWord('רש״י')).toBe('רשי');
});

test('Hebrew words match pointed text', () => {
  const re = wordRegExp('בראשית');
  expect(re.test('בְּרֵאשִׁית בָּרָא')).toBe(true);
});

test('English words match at a word start only', () => {
  expect(wordRegExp('beg').test('When God began to create')).toBe(true);
  expect(wordRegExp('egan').test('When God began to create')).toBe(false);
});

test('trigram hashes match build_search_index.py', () => {
  // Values produced by tools/library-export/build_search_index.py; if these
  // drift, books would look like they cannot contain a word (false negative).
  expect(termTrigrams('heaven').sort((a, b) => a - b)).toEqual([9134, 10231, 19345, 44225]);
  expect(termTrigrams('1656').sort((a, b) => a - b)).toEqual([20639, 48069]);
  expect(termTrigrams('בראשית').sort((a, b) => a - b)).toEqual([374, 2363, 25412, 34692]);
  expect(termTrigrams('מודה').sort((a, b) => a - b)).toEqual([34484, 55498]);
  expect(termTrigrams('began').sort((a, b) => a - b)).toEqual([6155, 11270, 20369]);
});

test('finds Hebrew hits and reports the category path', async () => {
  const result = await executeOfflineQuery({query: 'בראשית', type: 'text', size: 10, start: 0});
  expect(result.hits.total).toBe(1);   // only the Hebrew text contains the word
  const refs = result.hits.hits.map(hit => hit._source.ref);
  expect(refs.every(ref => ref === 'Genesis 1:1')).toBe(true);
  const bucket = result.aggregations.path.buckets.find(b => b.key === 'Tanakh/Torah/Genesis');
  expect(bucket.doc_count).toBe(1);
});

test('multiple words must all appear in the same segment', async () => {
  const result = await executeOfflineQuery({query: 'ברא אלהים', type: 'text', size: 10, start: 0});
  expect(result.hits.total).toBe(1);
  expect(result.hits.hits[0]._source.ref).toBe('Genesis 1:1');
});

test('filters restrict the searched books', async () => {
  const result = await executeOfflineQuery({
    query: 'מודה', type: 'text', size: 10, start: 0,
    applied_filters: ['Temple'],
  });
  expect(result.hits.total).toBe(1);
  expect(result.hits.hits[0]._source.ref.startsWith('Siddur Ashkenaz')).toBe(true);
});

test('returns null when nothing is downloaded (caller falls back to the API)', async () => {
  FileSystem.clear();
  expect(await executeOfflineQuery({query: 'anything', type: 'text'})).toBeNull();
});

test('paginates without rescanning order changes', async () => {
  const first = await executeOfflineQuery({query: 'בראשית', type: 'text', size: 1, start: 0});
  const past = await executeOfflineQuery({query: 'בראשית', type: 'text', size: 1, start: 1});
  expect(first.hits.hits[0]._source.ref).toBe('Genesis 1:1');
  expect(past.hits.hits).toHaveLength(0);
  expect(past.hits.total).toBe(1);
  expect(parseQuery('modeh ani')).toHaveLength(2);
});

test('keeps enough hits for later pages of the same query', async () => {
  await write('Genesis_search.txt', `${GENESIS}\n${Array.from({length: 25}, (_, i) => (
    LINE(`Genesis 2:${i + 1}`, `בראשית ב׳:${i + 1}`, 'en', 'merged', `begin number ${i + 1}`)
  )).join('\n')}`);
  const first = await executeOfflineQuery({query: 'begin', type: 'text', size: 10, start: 0});
  const second = await executeOfflineQuery({query: 'begin', type: 'text', size: 10, start: 10});
  expect(first.hits.hits).toHaveLength(10);
  expect(second.hits.hits).toHaveLength(10);
  expect(second.hits.total).toBe(25);
  expect(second.hits.hits[0]._source.ref).toBe('Genesis 2:11');
});

test('mixed Hebrew/English queries survive the whole-file pre-check', async () => {
  await write('Genesis_search.txt', `${GENESIS}\n${LINE(
      'Genesis 3:1', 'בראשית ג׳:א׳', 'en', 'merged', 'בְּרֵאשִׁית Heaven was created')}`);
  const result = await executeOfflineQuery({query: 'בראשית Heaven', type: 'text', size: 5, start: 0});
  expect(result.hits.total).toBe(1);
  expect(result.hits.hits[0]._source.ref).toBe('Genesis 3:1');
});

test('the package index skips books that cannot contain the word', async () => {
  await installIndex(['Genesis', 'Siddur Ashkenaz'], postingsFor('heaven', [0]));
  const result = await executeOfflineQuery({query: 'heaven', type: 'text', size: 10, start: 0});
  expect(result.hits.total).toBe(1);
  expect(result.hits.hits[0]._source.ref).toBe('Genesis 1:1');
  const read = FileSystem.readAsStringAsync.mock.calls.map(call => call[0].split('/').pop());
  expect(read).toEqual(['Genesis_search.txt']);
});

test('an index without the query trigram returns no hits and reads nothing', async () => {
  await installIndex(['Genesis', 'Siddur Ashkenaz'], postingsFor('heaven', [0]));
  const result = await executeOfflineQuery({query: 'zebra', type: 'text', size: 10, start: 0});
  expect(result.hits.total).toBe(0);
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
});

test('two-letter queries fall back to scanning every book', async () => {
  await installIndex(['Genesis'], postingsFor('heaven', [0]));
  await executeOfflineQuery({query: 'he', type: 'text', size: 10, start: 0});
  expect(FileSystem.readAsStringAsync).toHaveBeenCalled();
});

test('books missing from an index are still searched', async () => {
  await installIndex(['Genesis'], postingsFor('heaven', [0]));
  const result = await executeOfflineQuery({query: 'מודה', type: 'text', size: 10, start: 0});
  expect(result.hits.total).toBe(1);
  expect(result.hits.hits[0]._source.ref.startsWith('Siddur Ashkenaz')).toBe(true);
});

describe('ranking, exact matches and the content filter', () => {
  const RASHI = [
    LINE('Rashi on Genesis 1:1:1', 'רש"י על בראשית א׳:א׳:א׳', 'he', 'merged', 'בראשית ברא - אין המקרא הזה אומר אלא דרשני'),
    LINE('Rashi on Genesis 1:1:2', 'רש"י על בראשית א׳:א׳:ב׳', 'he', 'merged', 'ברא את השמים, לבראשית'),
  ].join('\n');
  const BOOKS = {
    'Genesis': {cats: ['Tanakh', 'Torah', 'Genesis']},
    'Rashi on Genesis': {cats: ['Tanakh', 'Rishonim on Tanakh', 'Rashi', 'Torah'], dependence: 'Commentary'},
    'Siddur Ashkenaz': {cats: ['Temple', 'Siddur']},
  };
  let saved;
  beforeEach(async () => {
    saved = global.Sefaria;
    global.Sefaria = {
      // Rashi comes first in this TOC: the main text must still win
      booksDict: {'Rashi on Genesis': 1, 'Genesis': 1, 'Siddur Ashkenaz': 1},
      categoriesForTitle: t => (BOOKS[t] || {}).cats,
      index: t => BOOKS[t],
    };
    // the phrase also in a later verse (file order: 10 before 2), the words apart in another
    await write('Genesis_search.txt', [
      LINE('Genesis 10:1', 'בראשית י׳:א׳', 'he', 'merged', 'בְּרֵאשִׁית בָּרָא שוב'),
      LINE('Genesis 2:4', 'בראשית ב׳:ד׳', 'he', 'merged', 'בְּהִבָּרְאָם וגו בְּרֵאשִׁית'),
      GENESIS,
    ].join('\n'));
    await write('Rashi on Genesis_search.txt', RASHI);
  });
  afterEach(() => { global.Sefaria = saved; });

  test('exact phrase first, main texts before commentaries, then canonical order', async () => {
    const r = await executeOfflineQuery({query: 'בראשית ברא', type: 'text', size: 10, start: 0});
    expect(r.hits.hits.map(h => h._source.ref)).toEqual([
      'Genesis 1:1', 'Genesis 10:1', 'Rashi on Genesis 1:1:1',   // the phrase
      'Genesis 2:4', 'Rashi on Genesis 1:1:2',                    // both words, apart
    ]);
    expect(r.hits.total).toBe(5);
  });

  test('"Exact matches only" keeps the exact phrase only, and the counts follow', async () => {
    const r = await executeOfflineQuery({query: 'בראשית ברא', type: 'text', size: 10, start: 0, field: 'exact', exact: true});
    expect(r.hits.hits.map(h => h._source.ref)).toEqual(['Genesis 1:1', 'Genesis 10:1', 'Rashi on Genesis 1:1:1']);
    expect(r.hits.total).toBe(3);
    expect(r.aggregations.path.buckets.find(b => b.key === 'Tanakh').doc_count).toBe(3);
    expect(r.hits.hits[0].highlight.exact).toBeTruthy();   // ReaderApp reads highlight[field]
    const broad = await executeOfflineQuery({query: 'בראשית ברא', type: 'text', size: 10, start: 0});
    expect(broad.hits.total).toBe(5);
  });

  test('exact English is whole words', async () => {
    expect((await executeOfflineQuery({query: 'heave', type: 'text', exact: true})).hits.total).toBe(0);
    expect((await executeOfflineQuery({query: 'heaven', type: 'text', exact: true})).hits.total).toBe(1);
  });

  test('lines of versions and books the content filter hides are left out', async () => {
    await write('Genesis_search.txt', [
      LINE('Genesis 1:6', 'בראשית א׳:ו׳', 'en', 'THE JPS TANAKH: Gender-Sensitive Edition', 'Let there be an expanse'),
      LINE('Genesis 1:6', 'בראשית א׳:ו׳', 'en', 'The Koren Jerusalem Bible', 'Let there be a firmament'),
      LINE('Genesis 1:7', 'בראשית א׳:ז׳', 'en', 'THE JPS TANAKH: Gender-Sensitive Edition', 'Let there be a firmament'),
    ].join('\n'));
    global.Sefaria.shomer = {
      isActive: () => true,
      getConfig: () => ({preset: 'yeshivish'}),
      isBookHidden: t => t === 'Rashi on Genesis',
      isVersionHidden: v => /Gender-Sensitive/.test(v.versionTitle),
    };
    const r = await executeOfflineQuery({query: 'firmament', type: 'text'});
    expect(r.hits.hits.map(h => [h._source.ref, h._source.version])).toEqual([['Genesis 1:6', 'The Koren Jerusalem Bible']]);
    expect(r.hits.total).toBe(1);
    expect((await executeOfflineQuery({query: 'ברא', type: 'text'})).hits.hits
      .some(h => h._source.ref.startsWith('Rashi'))).toBe(false);
  });
});
