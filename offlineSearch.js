/**
 * Offline text search.
 *
 * The export writes one `<Title>_search.txt` per book next to its zip (see
 * tools/library-export/build_search.py).  Every line is one segment:
 *
 *     enRef <TAB> heRef <TAB> lang <TAB> versionTitle <TAB> text
 *
 * The app scans the files of the books it has actually downloaded.  Hebrew is
 * matched with the vowel points ignored, so an unpointed query finds pointed
 * text.
 *
 * Scanning is the slow part (the whole downloaded library is several GB), so
 * every file first goes through a cheap whole-file check: if one of the query
 * words does not occur anywhere in the file, the per-line work is skipped.
 * Files are read a few at a time and the result of a scan is cached, so
 * paging through results does not read the library again.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';

const LIBRARY_DIR = `${FileSystem.documentDirectory}library/`;
const LOCAL_SEARCH_DIR = `${FileSystem.documentDirectory}local_search/`;  // localSearch.js
const SEARCH_SUFFIX = '_search.txt';
const INDEX_SUFFIX = '_search.idx';
const MAX_RESULTS = 1000;      // stop scanning once this many segments matched
const SNIPPET_CONTEXT = 70;    // characters around the match shown in results
const READ_CONCURRENCY = 3;    // search files read in parallel
const MAX_CACHE_ENTRIES = 6;   // recent query results kept in memory

const HEBREW_LETTER = /[\u05D0-\u05EA]/;
const NIQQUD = /[\u0591-\u05C7\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g;
const HEBREW_PUNCT = /[\u05F3\u05F4'"׳״]/g;

/** Strip vowel points and Hebrew quote marks from a query word. */
export function normalizeQueryWord(word) {
  return word.replace(NIQQUD, '').replace(HEBREW_PUNCT, '').trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A regex for one query word.
 * Hebrew letters may carry vowel points in the text ("בְּרֵאשִׁית"), so the
 * vowel points are allowed between every two letters of the word.
 */
function wordSource(word) {
  let source = '';
  for (const letter of Array.from(word)) {
    source += escapeRegExp(letter);
    if (HEBREW_LETTER.test(letter)) { source += '[\\u0591-\\u05C7]*'; }
  }
  return source;
}

// a word's letters (Hebrew with its points) and what may stand between two words of a phrase
const WORD_CHAR = 'A-Za-z0-9\\u05D0-\\u05EA\\u0591-\\u05C7';
const BETWEEN_WORDS = `[^${WORD_CHAR}]+`;

/**
 * The query as an exact phrase: these words, whole (no Hebrew prefixes, no longer English
 * word), one after the other.  `whole` false: the first word may carry a prefix and the
 * last may go on ("ברא" in "בראשית") - still the words next to each other.
 */
export function phraseRegExp(words, whole = true) {
  const parts = words.map(normalizeQueryWord).filter(Boolean);
  if (!parts.length) { return null; }
  const body = parts.map(wordSource).join(BETWEEN_WORDS);
  const hebrew = parts.some(w => HEBREW_LETTER.test(w));
  if (!whole) {
    return hebrew ? new RegExp(body) : new RegExp(`(^|\\W)${body}`, 'i');
  }
  return new RegExp(`(^|[^${WORD_CHAR}])${body}(?![${WORD_CHAR}])`, hebrew ? '' : 'i');
}

export function wordRegExp(word) {
  const letters = Array.from(normalizeQueryWord(word));
  if (!letters.length) { return null; }
  const source = wordSource(letters.join(''));
  const isHebrew = letters.some(letter => HEBREW_LETTER.test(letter));
  // English words match at a word start ("begin" finds "beginning") but not
  // in the middle of a word; Hebrew has prefixes attached, so it is a plain
  // substring search.
  return isHebrew ? new RegExp(source) : new RegExp(`(^|\\W)${source}`, 'i');
}

/**
 * One query word: the regex used on matching lines plus a plain spelling used
 * for the fast whole-file check.
 */
function queryTerm(word) {
  const normalized = normalizeQueryWord(word);
  if (!normalized) { return null; }
  return {
    word: normalized,
    plain: normalized.toLowerCase(),
    hebrew: HEBREW_LETTER.test(normalized),
    regexp: wordRegExp(normalized),
  };
}

export function parseQuery(query) {
  return (query || '')
      .split(/\s+/)
      .map(queryTerm)
      .filter(Boolean)
      .map(term => term.regexp);
}

function parseTerms(query) {
  return (query || '')
      .split(/\s+/)
      .map(queryTerm)
      .filter(Boolean);
}

function folderUri(uri) {
  return uri.endsWith('/') ? uri : `${uri}/`;
}

/**
 * All search files, as [title, uri] pairs: the downloaded ones (library/) and the ones
 * the phone made itself for versions the release may not host (local_search/, see
 * localSearch.js).  A book can have one of each; both are scanned.
 */
async function searchFiles() {
  const out = [];
  for (const dir of [LIBRARY_DIR, LOCAL_SEARCH_DIR]) {
    let names;
    try {
      names = await FileSystem.readDirectoryAsync(folderUri(dir));
    } catch (e) {
      continue;
    }
    for (const name of names) {
      if (name.endsWith(SEARCH_SUFFIX)) {
        out.push([name.slice(0, -SEARCH_SUFFIX.length), `${folderUri(dir)}${name}`]);
      }
    }
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

function bookPath(title) {
  try {
    const cats = global.Sefaria.categoriesForTitle(title);
    return cats ? cats.join('/') : '';
  } catch (e) {
    return '';
  }
}

function passesFilters(title, filters) {
  if (!filters || !filters.length) { return true; }
  const path = bookPath(title);
  return filters.some(filter => path === filter || path.startsWith(`${filter}/`)
      || filter.startsWith(`${path}/`));
}

// ------------------------------------------------------------- content filter + ranking

function shomer() {
  const s = global.Sefaria && global.Sefaria.shomer;
  return s && typeof s.isActive === 'function' ? s : null;
}

/** Books and versions the reader's content filter hides (shomer/index.js). */
function contentFilter() {
  const s = shomer();
  if (!s || !s.isActive()) { return {key: 'off', bookHidden: () => false, versionHidden: () => false}; }
  const memo = new Map();
  return {
    key: JSON.stringify(s.getConfig()),
    bookHidden: title => { try { return s.isBookHidden(title); } catch (e) { return false; } },
    versionHidden: (lang, versionTitle) => {
      const k = `${lang}|${versionTitle}`;
      if (!memo.has(k)) {
        let hidden = false;
        try { hidden = !!s.isVersionHidden({language: lang, versionTitle}); } catch (e) { hidden = false; }
        memo.set(k, hidden);
      }
      return memo.get(k);
    },
  };
}

/**
 * Where a book goes in the results: main texts before commentaries (and other texts that
 * depend on a base text), then the library's own order (the TOC, as Sefaria.booksDict
 * keeps it).
 */
function bookRanks() {
  const order = new Map();
  try {
    Object.keys((global.Sefaria && global.Sefaria.booksDict) || {}).forEach((t, i) => order.set(t, i));
  } catch (e) { /* no TOC: alphabetical */ }
  const cache = new Map();
  return title => {
    if (cache.has(title)) { return cache.get(title); }
    let dependent = 0;
    try {
      const index = global.Sefaria.index && global.Sefaria.index(title);
      const cats = global.Sefaria.categoriesForTitle(title) || [];
      if ((index && index.dependence) || cats.some(c => /Commentar/.test(c))) { dependent = 1; }
    } catch (e) { /* unknown: main */ }
    const rank = [dependent, order.has(title) ? order.get(title) : order.size];
    cache.set(title, rank);
    return rank;
  };
}

/** "Genesis 10:2" after "Genesis 2:5": numbers compared as numbers. */
function compareRefs(a, b) {
  const re = /(\d+)|(\D+)/g;
  const pa = a.match(re) || [];
  const pb = b.match(re) || [];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) { continue; }
    const na = /^\d/.test(pa[i]);
    const nb = /^\d/.test(pb[i]);
    if (na && nb) { return Number(pa[i]) - Number(pb[i]); }
    return pa[i] < pb[i] ? -1 : 1;
  }
  return pa.length - pb.length;
}

/** Best first: exact phrase, then the words next to each other, then anywhere. */
function compareHits(a, b) {
  return (a.tier - b.tier) || (a.rank[0] - b.rank[0]) || (a.rank[1] - b.rank[1])
      || compareRefs(a.hit._source.ref, b.hit._source.ref) || (a.seq - b.seq);
}

// ------------------------------------------------------------- search index
//
// Each downloaded package ships `<PACKAGE>_search.idx` (built by
// tools/library-export/build_search_index.py): a trigram index over the
// normalized text of its books.  A query word can only occur in a book that
// contains every trigram of that word, so the index narrows the scan to a few
// files instead of the whole library.

const indexCache = new Map();

function isWordCode(code) {
  return (code >= 48 && code <= 57)      // 0-9
      || (code >= 65 && code <= 90)      // A-Z
      || (code >= 97 && code <= 122)     // a-z
      || (code >= 0x05D0 && code <= 0x05EA);  // Hebrew letters
}

function isSurrogate(code) {
  return code >= 0xD800 && code <= 0xDFFF;
}

/** 16-bit FNV-1a of three UTF-16 code units; mirrors build_search_index.py. */
function trigramHash(a, b, c) {
  let h = 2166136261;
  h = (Math.imul(h ^ a, 16777619)) >>> 0;
  h = (Math.imul(h ^ b, 16777619)) >>> 0;
  h = (Math.imul(h ^ c, 16777619)) >>> 0;
  return (h ^ (h >>> 16)) & 0xFFFF;
}

/** The indexable trigrams of a normalized query word. */
export function termTrigrams(word) {
  const hashes = new Set();
  for (let i = 0; i + 2 < word.length; i++) {
    const a = word.charCodeAt(i);
    const b = word.charCodeAt(i + 1);
    const c = word.charCodeAt(i + 2);
    if (isSurrogate(a) || isSurrogate(b) || isSurrogate(c)) { continue; }
    if (!isWordCode(a) || !isWordCode(b) || !isWordCode(c)) { continue; }
    hashes.add(trigramHash(a, b, c));
  }
  return Array.from(hashes);
}

/** Minimal UTF-8 decoder (Hermes does not always provide TextDecoder). */
function utf8Decode(bytes, start, end) {
  let out = '';
  let i = start;
  while (i < end) {
    const b = bytes[i++];
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b < 0xE0) {
      out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i++] & 0x3F));
    } else if (b < 0xF0) {
      out += String.fromCharCode(
          ((b & 0x0F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F));
    } else {
      let cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3F) << 12)
          | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F);
      cp -= 0x10000;
      out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
    }
  }
  return out;
}

function parseIndexBytes(bytes) {
  if (!bytes || bytes.length < 9) { return null; }
  if (bytes[0] !== 0x53 || bytes[1] !== 0x46 || bytes[2] !== 0x49 || bytes[3] !== 0x31) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 4;
  const titleCount = view.getUint32(off, true);
  off += 4;
  const titles = new Array(titleCount);
  for (let i = 0; i < titleCount; i++) {
    const len = view.getUint16(off, true);
    off += 2;
    titles[i] = utf8Decode(bytes, off, off + len);
    off += len;
  }
  const entryCount = view.getUint32(off, true);
  off += 4;
  const hashIndex = new Map();
  const counts = new Uint16Array(entryCount);
  const offsets = new Uint32Array(entryCount);
  for (let e = 0; e < entryCount; e++) {
    const hash = view.getUint16(off, true);
    const count = view.getUint16(off + 2, true);
    off += 4;
    hashIndex.set(hash, e);
    counts[e] = count;
    offsets[e] = off;
    off += count * 2;
  }
  return { titles, hashIndex, counts, offsets, view };
}

/** Parsed search indexes, cached until the file size changes. */
async function loadIndexes() {
  let names;
  try {
    names = await FileSystem.readDirectoryAsync(folderUri(LIBRARY_DIR));
  } catch (e) {
    return [];
  }
  const indexes = [];
  for (const name of names) {
    if (!name.endsWith(INDEX_SUFFIX)) { continue; }
    const uri = `${folderUri(LIBRARY_DIR)}${name}`;
    try {
      const file = new File(uri);
      const cacheKey = `${uri}:${file.size}`;
      let index = indexCache.get(cacheKey);
      if (!index) {
        index = parseIndexBytes(await file.bytes());
        if (!index) { continue; }
        index.cacheKey = cacheKey;
        indexCache.set(cacheKey, index);
      }
      indexes.push(index);
    } catch (e) {
      // No index for this file: fall back to scanning everything.
    }
  }
  return indexes;
}

function intersectSets(a, b) {
  if (a.size > b.size) { const t = a; a = b; b = t; }
  const out = new Set();
  for (const value of a) { if (b.has(value)) { out.add(value); } }
  return out;
}

/** Package-local title ids that can contain every term, or null if unfiltered. */
function candidatesFromIndex(index, terms) {
  let result = null;
  for (const term of terms) {
    const hashes = termTrigrams(term.plain);
    if (!hashes.length) { continue; }
    let termSet = null;
    for (const hash of hashes) {
      const entry = index.hashIndex.get(hash);
      if (entry === undefined) { return new Set(); }
      const ids = new Set();
      const offset = index.offsets[entry];
      const count = index.counts[entry];
      for (let i = 0; i < count; i++) {
        ids.add(index.view.getUint16(offset + i * 2, true));
      }
      termSet = termSet === null ? ids : intersectSets(termSet, ids);
      if (!termSet.size) { return termSet; }
    }
    if (termSet === null) { continue; }
    result = result === null ? termSet : intersectSets(result, termSet);
    if (!result.size) { return result; }
  }
  return result;
}

/**
 * Titles that need scanning for this query.  Books without an index (old
 * downloads) are always included, so a missing/renamed index can only cost
 * time, never results.
 */
async function candidateTitles(indexes, files, terms) {
  if (!indexes.length) { return null; }
  const covered = new Set();
  const candidates = new Set();
  for (const index of indexes) {
    for (const title of index.titles) { covered.add(title); }
    const local = candidatesFromIndex(index, terms);
    if (local === null) {
      for (const title of index.titles) { candidates.add(title); }
    } else {
      for (const id of local) {
        if (id < index.titles.length) { candidates.add(index.titles[id]); }
      }
    }
  }
  for (const [title] of files) {
    if (!covered.has(title)) { candidates.add(title); }
  }
  return candidates;
}

/** Drop cached scans and parsed indexes (tests, and after library updates). */
export function clearOfflineSearchCache() {
  scanCache.clear();
  indexCache.clear();
}

/**
 * Quick whole-file check.  The text is normalized the same way the query is
 * (lower case for English, vowel points removed for Hebrew and, since the
 * query words are already normalized, every word must occur somewhere).
 * A false positive only costs the per-line pass; a false negative cannot
 * happen, so results stay correct.
 */
// A global replace over a whole book (Tanakh's merged lines run to tens of MB, with millions of
// points) makes Hermes collect every match at once: "RangeError: Out of memory for regexp
// results", and Hebrew search found nothing (QA round 5). Points are single characters, so
// stripping them chunk by chunk gives exactly the same string with bounded regexp work.
const STRIP_CHUNK = 1 << 16;

/** `text` without vowel points and Hebrew quote marks, in bounded chunks (any length). */
export function stripPointsChunked(text, chunk = STRIP_CHUNK) {
  if (text.length <= chunk) { return text.replace(NIQQUD, '').replace(HEBREW_PUNCT, ''); }
  const parts = [];
  for (let i = 0; i < text.length; i += chunk) {
    parts.push(text.slice(i, i + chunk).replace(NIQQUD, '').replace(HEBREW_PUNCT, ''));
  }
  return parts.join('');
}

function mayContainAll(content, terms) {
  let hebrewHaystack = null;
  let asciiHaystack = null;
  for (const term of terms) {
    if (term.hebrew) {
      if (hebrewHaystack === null) {
        hebrewHaystack = stripPointsChunked(content);
      }
      if (!hebrewHaystack.includes(term.plain)) { return false; }
    } else {
      if (asciiHaystack === null) { asciiHaystack = content.toLowerCase(); }
      if (!asciiHaystack.includes(term.plain)) { return false; }
    }
  }
  return true;
}

function snippetAround(line, index, length) {
  const from = Math.max(0, index - SNIPPET_CONTEXT);
  const to = Math.min(line.length, index + length + SNIPPET_CONTEXT);
  let text = line.slice(from, to);
  if (from > 0) { text = `…${text}`; }
  if (to < line.length) { text = `${text}…`; }
  return text;
}

async function readSearchFile(uri) {
  try {
    return await FileSystem.readAsStringAsync(uri);
  } catch (e) {
    return null;
  }
}

/**
 * Scan a single file, appending matches.  Returns the new hit count.
 * Exact mode: only lines with the exact phrase.  Otherwise every line with all the words
 * matches, ranked by how close it is to the phrase (compareHits).
 */
function scanFile(content, terms, state) {
  const { phrase, nearPhrase, exact, filter } = state;
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line) { continue; }
    const fields = line.split('\t');
    if (fields.length < 5) { continue; }
    const text = fields[4];
    let firstIndex = -1;
    let tier = 2;
    const p = phrase.exec(text);
    if (p) {
      tier = 0;
      firstIndex = p.index + p[1].length;
    } else if (exact) {
      continue;
    } else {
      let matched = true;
      for (const term of terms) {
        const m = term.regexp.exec(text);
        if (!m) { matched = false; break; }
        if (firstIndex === -1) { firstIndex = m.index; }
      }
      if (!matched) { continue; }
      const n = terms.length > 1 && nearPhrase.exec(text);
      if (n) { tier = 1; firstIndex = n.index; }
    }
    const [ref, heRef, lang, versionTitle] = fields;
    if (filter.versionHidden(lang, versionTitle)) { continue; }  // the reader does not show it

    state.total += 1;
    state.addBucket(bookPath(state.title));
    if (state.hits.length < MAX_RESULTS) {
      const snippet = [snippetAround(text, Math.max(0, firstIndex), 0)];
      state.hits.push({
        tier,
        rank: state.rank,
        seq: state.hits.length,
        hit: {
          _id: `${ref}${lang === 'he' ? '[he]' : ''}`,
          _source: {
            ref,
            heRef,
            version: versionTitle,
            version_priority: 0,
          },
          // the reader reads the highlight of the field searched (naive_lemmatizer / exact)
          highlight: { naive_lemmatizer: snippet, exact: snippet },
        },
      });
    }
    if (state.total >= MAX_RESULTS) { return state.total; }
  }
  return state.total;
}

/** Results of recent scans, keyed by query + filters. */
const scanCache = new Map();

function cacheKey(terms, filters) {
  const query = terms.map(term => `${term.hebrew ? 'h' : 'e'}:${term.plain}`).join(' ');
  return `${query}|${(filters || []).slice().sort().join(',')}`;
}

function cachedResult(entry, start, size) {
  return {
    hits: { hits: entry.hits.slice(start, start + size), total: entry.total },
    aggregations: {
      path: {
        buckets: Array.from(entry.buckets, ([key, doc_count]) => ({ key, doc_count })),
      },
    },
    offline: true,
  };
}

function rememberScan(key, entry) {
  scanCache.set(key, entry);
  while (scanCache.size > MAX_CACHE_ENTRIES) {
    scanCache.delete(scanCache.keys().next().value);
  }
}

/**
 * Run a text query against the downloaded books.
 * Returns null when there is nothing to search (the caller then uses the API).
 * args.exact (or args.field === 'exact'): "Exact matches only".
 */
export async function executeOfflineQuery(args) {
  if (args.type && args.type !== 'text') { return null; }
  const terms = parseTerms(args.query);
  if (!terms.length) { return null; }
  const files = await searchFiles();
  if (!files.length) { return null; }

  const start = args.start || 0;
  const size = args.size || 20;
  const filters = args.applied_filters || [];
  const exact = !!(args.exact || args.field === 'exact');
  const filter = contentFilter();
  const indexes = await loadIndexes();
  const indexTag = indexes.map(index => index.cacheKey).join(',');
  const key = `${cacheKey(terms, filters)}|${exact ? 'exact' : 'broad'}|${filter.key}|${files.length}|${indexTag}`;

  const cached = scanCache.get(key);
  if (cached) {
    return cachedResult(cached, start, size);
  }

  const found = [];
  const buckets = new Map();
  let total = 0;

  const addBucket = path => {
    if (!path) { return; }
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const key = parts.slice(0, i).join('/');
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
  };

  const words = terms.map(term => term.word);
  const phrase = phraseRegExp(words, true);
  const nearPhrase = phraseRegExp(words, false);
  const rankOf = bookRanks();
  const allowed = await candidateTitles(indexes, files, terms);
  // main texts first, in the library's order, so the cap keeps the most relevant books
  const scanFiles = files.filter(([title]) => passesFilters(title, filters)
      && (!allowed || allowed.has(title)) && !filter.bookHidden(title))
      .map(([title, uri]) => [title, uri, rankOf(title)])
      .sort((a, b) => (a[2][0] - b[2][0]) || (a[2][1] - b[2][1]) || a[0].localeCompare(b[0]));

  let stoppedAtCap = false;
  for (let i = 0; i < scanFiles.length; i += READ_CONCURRENCY) {
    if (total >= MAX_RESULTS) { stoppedAtCap = true; break; }
    const batch = scanFiles.slice(i, i + READ_CONCURRENCY);
    const contents = await Promise.all(batch.map(([, uri]) => readSearchFile(uri)));
    for (let j = 0; j < batch.length; j++) {
      const content = contents[j];
      if (!content) { continue; }
      if (!mayContainAll(content, terms)) { continue; }
      const state = {
        title: batch[j][0], rank: batch[j][2], hits: found, addBucket, total,
        phrase, nearPhrase, exact, filter,
      };
      total = scanFile(content, terms, state);
      if (total >= MAX_RESULTS) { stoppedAtCap = true; break; }
    }
  }

  const entry = {
    hits: found.sort(compareHits).map(f => f.hit),
    buckets,
    total,
    complete: !stoppedAtCap,
  };
  rememberScan(key, entry);
  return cachedResult(entry, start, size);
}

/** Books that exist offline and can be searched. */
export async function offlineSearchBookCount() {
  return new Set((await searchFiles()).map(([title]) => title)).size;
}
