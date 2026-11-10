/**
 * Autocomplete without the network: book titles, categories and simple refs from the
 * library's own TOC (Sefaria.toc / booksDict / index, already narrowed by the content
 * filter), in the shape of Sefaria's Name API (/api/name) so AutocompleteList can show
 * either.
 *
 * The Name API is only worth asking when the phone is online; while offline (or right
 * after it failed) the search box uses these results alone, so typing does not fire a
 * failing request per keystroke.
 */
import NetInfo from '@react-native-community/netinfo';

export const NAME_DEBOUNCE_MS = 300;    // wait for a pause in typing before asking the API
export const NAME_RETRY_MS = 30000;     // after a failure, do not ask again for this long
const MAX_COMPLETIONS = 10;
const HEBREW = /[א-ת]/;
const REF_TAIL = /^(\d+[ab]?)((?:[:. ]\d+)*)$/;   // "1", "1:1", "2a", "2a 5", "1.3"

let lastFailure = 0;

export function noteNameApiFailure(now = Date.now()) { lastFailure = now; }
export function noteNameApiSuccess() { lastFailure = 0; }

/** Whether to ask the Name API now: online, and no failure in the last NAME_RETRY_MS. */
export async function shouldCallNameApi(now = Date.now()) {
  if (lastFailure && now - lastFailure < NAME_RETRY_MS) { return false; }
  try {
    const state = await NetInfo.fetch();
    if (state && (state.isConnected === false || state.isInternetReachable === false)) { return false; }
  } catch (e) {
    // unknown: try the API
  }
  return true;
}

function books() {
  const S = global.Sefaria;
  if (!S || !S.booksDict) { return []; }
  return Object.keys(S.booksDict).map(title => {
    let index = null;
    try { index = S.index(title); } catch (e) { index = null; }
    return {title, heTitle: (index && index.heTitle) || null};
  });
}

function categories() {
  const out = [];
  const walk = (nodes, path) => {
    for (const node of nodes || []) {
      if (!node || !node.contents || !node.category) { continue; }
      const p = path.concat(node.category);
      out.push({title: node.category, heTitle: node.heCategory || null, key: p});
      walk(node.contents, p);
    }
  };
  try { walk(global.Sefaria && global.Sefaria.toc, []); } catch (e) { /* no TOC */ }
  return out;
}

/** 0: starts with the query, 1: a word starts with it, 2: contains it, -1: no match. */
function score(name, q) {
  if (!name) { return -1; }
  const n = name.toLowerCase();
  if (n.startsWith(q)) { return 0; }
  if (n.split(/[\s,\-]+/).some(w => w.startsWith(q))) { return 1; }
  return n.includes(q) ? 2 : -1;
}

/** "Genesis 1:3" -> the ref parts of a query that starts with a book title, else null. */
function parseRef(query, all) {
  const low = query.toLowerCase();
  let best = null;
  for (const b of all) {
    for (const name of [b.title, b.heTitle]) {
      if (!name) { continue; }
      const n = name.toLowerCase();
      if ((low === n || low.startsWith(`${n} `)) && (!best || n.length > best.name.length)) {
        best = {book: b.title, name: n};
      }
    }
  }
  if (!best) { return null; }
  const rest = query.slice(best.name.length).trim();
  if (!rest) { return {book: best.book, ref: best.book, sections: [], is_book: true}; }
  const m = REF_TAIL.exec(rest);
  if (!m) { return null; }
  const sections = rest.split(/[:. ]/).filter(Boolean);
  return {book: best.book, ref: `${best.book} ${sections.join(':')}`, sections, is_book: false};
}

/** Name API-shaped results for `query`, from the library on the phone. */
export function localNameResults(query) {
  const q = (query || '').trim();
  const isHe = HEBREW.test(q);
  const out = {lang: isHe ? 'he' : 'en', completion_objects: [], completions: [], is_ref: false, offline: true};
  if (!q) { return out; }
  const low = q.toLowerCase();
  const all = books();

  const ref = parseRef(q, all);
  if (ref) {
    Object.assign(out, {
      is_ref: true, ref: ref.ref, book: ref.book, index: ref.book, sections: ref.sections,
      is_book: ref.is_book, is_section: !ref.is_book && ref.sections.length === 1,
      is_segment: !ref.is_book && ref.sections.length > 1,
    });
  }

  const found = [];
  const consider = (item, type) => {
    const s = isHe ? score(item.heTitle, low) : score(item.title, low);
    if (s < 0) { return; }
    found.push({s, len: item.title.length, c: {
      title: isHe && item.heTitle ? item.heTitle : item.title,
      key: item.key || item.title,
      type,
      is_primary: s === 0,
    }});
  };
  all.forEach(b => consider(b, 'ref'));
  categories().forEach(c => consider(c, 'toc'));
  found.sort((a, b) => (a.s - b.s) || (a.len - b.len));
  out.completion_objects = found.slice(0, MAX_COMPLETIONS).map(f => f.c)
    .filter(c => !(out.is_ref && out.is_book && c.key === out.ref));  // shown as the ref already
  out.completions = out.completion_objects.map(c => c.title);
  return out;
}
