// Sefaria Shomer content filter - the app's runtime side.
//
// Holds the reader's filter settings and applies the pure matcher (./matcher.js) to the app's
// data. Most of the app is covered by one step: the TOC itself is filtered (Sefaria.toc,
// Sefaria.booksDict, Sefaria.search_toc), and the reader already drops anything not in
// booksDict (library lists, commentary/links panels, autocomplete "book" hits, opening a ref).
// The helpers below cover what does not go through the TOC: versions/translations, search hits,
// autocomplete, related sheets, downloads, and the "hidden by your filter" message.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalize } from './presets';
import {
  match, filterToc, versionMatch, filterVersions as filterVersionList, sheetMatch,
} from './matcher';

export const STORAGE_KEY = 'contentFilter';  // same key StateManager persists the setting under

let config = null;          // normalized config, or null while the reader has not chosen yet
let hiddenBooks = {};       // title -> reason, every book the filter took out of the TOC
let fullToc = null;         // the unfiltered toc.json
let fullSearchToc = null;   // the unfiltered search_toc.json
const listeners = new Set();

export const getConfig = () => config;
export const isActive = () => !!(config && config.active);
export const getHiddenBooks = () => hiddenBooks;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Read the saved setting before the TOC loads, so the library never flashes hidden books.
export async function loadConfig() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    setConfig(raw ? JSON.parse(raw) : null);
  } catch (e) {
    console.log('content filter: could not read settings', e);
  }
  return config;
}

// Apply a new setting (already persisted by the caller). Returns true if anything changed.
export function setConfig(stored) {
  const next = normalize(stored);
  if (JSON.stringify(next) === JSON.stringify(config)) { return false; }
  config = next;
  reapply();
  listeners.forEach(fn => { try { fn(config); } catch (e) { console.log(e); } });
  return true;
}

// ---------- TOC ----------

export function applyToToc(toc) {
  fullToc = toc;
  const hidden = {};
  const filtered = filterToc(config, toc, hidden);
  hiddenBooks = hidden;
  return filtered;
}

export function applyToSearchToc(searchToc) {
  fullSearchToc = searchToc;
  return filterToc(config, searchToc, {});
}

function reapply() {
  if (typeof Sefaria === 'undefined') { return; }
  if (fullToc) {
    Sefaria.toc = applyToToc(fullToc);
    Sefaria._cacheIndexFromToc(Sefaria.toc, true);
  }
  if (fullSearchToc) { Sefaria.search_toc = applyToSearchToc(fullSearchToc); }
  // caches built from the old book list / old default translations
  Sefaria._commentatorListBySection = {};
  Sefaria._jsonSectionData = {};
}

// Every book title in the unfiltered library (downloads need these to delete hidden books)
export function allBookTitles() {
  const titles = Object.keys(Sefaria.booksDict || {});
  return titles.concat(Object.keys(hiddenBooks).filter(t => !(t in Sefaria.booksDict)));
}

export const isBookHidden = title => !!title && title in hiddenBooks;

// {title, reason} if `ref` (or a book title) belongs to a hidden book, else null
export function hiddenBookForRef(ref) {
  if (!ref || typeof ref !== 'string' || !isActive()) { return null; }
  const books = (typeof Sefaria !== 'undefined' && Sefaria.booksDict) || {};
  // longest title first, as Sefaria.textTitleForRef does: "Orot Chaim 1" is not "Orot"
  for (let i = ref.length; i > 0; i--) {
    const t = ref.slice(0, i);
    const next = ref[i];
    if (next !== undefined && !/[\s,:.]/.test(next)) { continue; }
    if (t in books) { return null; }
    if (t in hiddenBooks) { return { title: t, reason: hiddenBooks[t] }; }
  }
  return null;
}

const blocks = text => {
  const m = match(config, text);
  return !!(m && !m.translation);
};

// ---------- Versions / translations ----------

export const isVersionHidden = version => !!versionMatch(config, version);
export const filterVersions = versions => filterVersionList(config, versions);

// Translations API shape: {versions: [...]}
export function filterTranslations(translations) {
  if (!translations || !Array.isArray(translations.versions) || !isActive()) { return translations; }
  return { ...translations, versions: filterVersions(translations.versions) };
}

/**
 * A loaded section whose English comes from a hidden translation: return a copy with the
 * English taken out (the Hebrew stays), as the extension does in the reader.
 */
export function stripHiddenEnglish(textContent) {
  if (!textContent || !isActive() || !textContent.versionTitle) { return textContent; }
  if (!versionMatch(config, { versionTitle: textContent.versionTitle, versionSource: textContent.versionSource })) {
    return textContent;
  }
  return {
    ...textContent,
    shomerHiddenTranslation: textContent.versionTitle,
    versionTitle: null,
    versionNotes: null,
    versionSource: null,
    license: null,
    content: (textContent.content || []).map(seg => ({ ...seg, text: '' })),
  };
}

/**
 * Preview text whose English version is unknown (the bulktext API used by History/Saved does not
 * say which translation it used, and the server default may be a hidden one): while the filter
 * is on, keep the Hebrew only. Takes the bulktext shape {ref: {en, he, ...}}.
 */
export function stripPreviewEnglish(previews) {
  if (!previews || !isActive()) { return previews; }
  const out = {};
  for (const [ref, p] of Object.entries(previews)) {
    out[ref] = p && typeof p === 'object' ? { ...p, en: '' } : p;
  }
  return out;
}

/**
 * A single-ref preview ({en, he, versionTitle, versionSource}, as api._text returns without
 * context) whose English comes from a hidden translation: the same with the English taken out.
 */
export function stripHiddenPreviewEnglish(result) {
  if (!result || !isActive()) { return result; }
  if (!result.versionTitle) { return result.en ? { ...result, en: '' } : result; }  // unknown version: be safe
  if (!versionMatch(config, { versionTitle: result.versionTitle, versionSource: result.versionSource })) { return result; }
  return { ...result, en: '', versionTitle: null, versionSource: null };
}

// ---------- Search ----------

// Raw search response ({hits: {hits, total}, aggregations}) -> the same without hidden hits
export function filterSearchResponse(type, data) {
  if (!data || !data.hits || !Array.isArray(data.hits.hits) || !isActive()) { return data; }
  const keep = hit => {
    const s = hit && hit._source;
    if (!s) { return true; }
    if (type === 'sheet') {
      return !sheetMatch(config, { title: s.title, owner_name: s.owner_name, organization: s.organization, id: hit._id });
    }
    if (hiddenBookForRef(s.ref)) { return false; }
    return !(s.version && versionMatch(config, { versionTitle: s.version }));
  };
  const hits = data.hits.hits.filter(keep);
  const removed = data.hits.hits.length - hits.length;
  const total = data.hits.total;
  const newTotal = typeof total === 'number' ? Math.max(0, total - removed)
    : (total && typeof total.value === 'number') ? { ...total, value: Math.max(0, total.value - removed) } : total;
  const out = { ...data, hits: { ...data.hits, hits, total: newTotal } };
  if (data.aggregations && data.aggregations.path && Array.isArray(data.aggregations.path.buckets)) {
    out.aggregations = {
      ...data.aggregations,
      path: {
        ...data.aggregations.path,
        buckets: data.aggregations.path.buckets.filter(b => !hiddenBookForRef(String(b.key).split('/').pop())),
      },
    };
  }
  return out;
}

// Name (autocomplete) API response -> the same without hidden books, authors or categories
export function filterNameResponse(results) {
  if (!results || !isActive()) { return results; }
  const out = { ...results };
  if (Array.isArray(results.completion_objects)) {
    out.completion_objects = results.completion_objects.filter(c => {
      if (hiddenBookForRef(c.key) || hiddenBookForRef(c.title)) { return false; }
      return !blocks([c.title, c.key].filter(Boolean).join(' | '));
    });
  }
  if (Array.isArray(results.completions)) {
    out.completions = results.completions.filter(t => !hiddenBookForRef(t) && !blocks(t));
  }
  if (results.is_ref && (hiddenBookForRef(results.ref) || hiddenBookForRef(results.book) || hiddenBookForRef(results.index))) {
    out.is_ref = false;
    out.is_book = false;
    out.ref = null;
  }
  return out;
}

// ---------- Related (connections panel) ----------

// Links to hidden books are already dropped (they are not in booksDict); this takes out sheets.
export function filterRelated(related) {
  if (!related || !isActive() || !Array.isArray(related.sheets)) { return related; }
  return { ...related, sheets: related.sheets.filter(s => !sheetMatch(config, s)) };
}
