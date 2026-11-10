/**
 * Hebrew Wikisource ("Wikitext", he.wikisource.org) as an extra source.
 *
 * Which books: Sofer's (C:\Users\morde\Sofer\src\sofer\wikisource.py) - the whole sefarim the
 * site marks complete (category "ספרים מושלמים"), sefarim only, plus the ones the owner chose
 * (CHOSEN, PREFERRED), less the books the library has from Sefaria (IN_LIBRARY). The phone cannot
 * tell "complete" or "a sefer" itself, so the list is data: extras/wikisourceBooks.json, made by
 * tools/library-export/wikisource_books.py from Sofer's own code. One copy of each sefer
 * (extras/catalog.js): Sefaria, Dicta and Otzaria come first, except the PREFERRED books, which
 * are used instead of the copies they name ("רוקח על שיר השירים" for Dicta's).
 *
 * Where it comes from (the site's own API, nothing hosted by SoferBooks):
 *   one page    POST https://he.wikisource.org/w/api.php  action=parse&page=<page>&prop=text|revid
 *               (the page as the site renders it, as Sofer reads it; one request a page - the API
 *                renders one page a request)
 *   revisions   POST ... action=query&prop=info&titles=<up to 50 pages>  (lastrevid of each: the
 *               update check of a downloaded book, one request per 50 of its pages)
 * Every request: format=json, formatversion=2, maxlag=5 (waits when the site is busy, as it
 * asks), one at a time, a descriptive User-Agent (Wikimedia's API etiquette).
 *
 * A book is its title page, then its parts in the order the title page links to them (sub-pages
 * "צרור החיים/ח" or pages named "ספר חלק", up to three levels; a redirect to a part already taken
 * is not taken twice): wikisource.fetch_book. Converted by extras/wikisourceParse.js as Sofer's
 * importer converts it. The editors' footnotes become a book of their own, "הערות המהדיר על
 * <book>", laid out like the book (the same sections, one entry for each paragraph), linked to
 * each paragraph as a commentary.
 *
 * Licence: CC BY-SA (the site's texts); the edition names the page, the site, the date it was
 * fetched and the page history (the contributors), as the licence asks.
 */
import {Node, safe} from './tree';
import {bookFiles} from './schema7';
import {wikiTree, wikiAuthor, wikiKeys, unquote, WikiNode} from './wikisourceParse';
import {CATEGORY_HE as OTZARIA_CATEGORY_HE} from './otzaria';
import CATALOG from './wikisourceBooks.json';

export const ID = 'wikisource';
export const HOST = 'https://he.wikisource.org';
export const API = `${HOST}/w/api.php`;
export const SITE = `${HOST}/wiki/`;
// The converter's own version: books converted by an older one are converted again (as an update)
export const CONVERTER_VERSION = 1;
// Wikimedia asks for an agent naming the program and how to reach its makers
export const USER_AGENT = 'SoferBooksLibrary/1.0 (https://github.com/soferbooks/soferbooks-library)';
export const LICENSE = 'CC-BY-SA';
export const CATEGORY = 'Wikitext';         // the books are filed under <top category>/Wikitext
export const CATEGORY_HE = {...OTZARIA_CATEGORY_HE, Wikitext: 'ויקיטקסט', Notes: 'הערות'};
export const NOTES_PREFIX = 'הערות המהדיר על ';
export const MAX_DEPTH = 3;                 // wikisource.fetch_book
export const BATCH = 50;                    // titles in one query (the API's limit)

// ---------------------------------------------------------------- the catalogue

export const pageUrl = page => `${SITE}${encodeURIComponent(page.replace(/ /g, '_')).replace(/%2F/g, '/')}`;
export const historyUrl = page => `${HOST}/w/index.php?title=${encodeURIComponent(page.replace(/ /g, '_'))}&action=history`;

/** One book of wikisourceBooks.json as a catalogue entry */
export function entryFor(b) {
  const he = b.page.split('/')[0];
  return {
    source: ID,
    id: b.page,
    hash: null,
    heTitle: he,
    title: safe(he),
    categories: [b.category, CATEGORY],
    heCategories: [CATEGORY_HE[b.category] || b.category, CATEGORY_HE[CATEGORY]],
    // the names it may have in the library (importers.wiki_keys), and the copies it is used instead of
    names: b.names || wikiKeys(b.page),
    ...(b.preferred ? {preferred: true, replaces: b.replaces || []} : {}),
    license: LICENSE,
    pageCount: b.pages || 0,
  };
}

export const parseCatalog = (data = CATALOG) => (data.books || []).map(entryFor);

// ---------------------------------------------------------------- the site's API

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
/** application/x-www-form-urlencoded (React Native's URLSearchParams is a small subset) */
export const formBody = params => Object.entries(params)
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');

/**
 * A client for the site's API: {call(params), requests}. Requests one at a time (the caller awaits
 * each), with maxlag; waits and tries again when the site is busy (maxlag, HTTP 429/503) or the
 * network fails, as wikisource.api does.
 */
export function apiClient({fetchFn = (...a) => fetch(...a), sleep = wait, tries = 6} = {}) {
  const client = {requests: 0};
  client.call = async params => {
    const body = formBody({...params, format: 'json', formatversion: '2', maxlag: '5'});
    for (let attempt = 0; attempt < tries; attempt++) {
      let response;
      try {
        client.requests += 1;
        response = await fetchFn(API, {
          method: 'POST',
          headers: {'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded'},
          body,
        });
      } catch (e) {
        if (attempt === tries - 1) { throw e; }
        await sleep(3000 * (attempt + 1));
        continue;
      }
      const retry = response.headers && response.headers.get ? parseInt(response.headers.get('Retry-After'), 10) : NaN;
      if (response.status === 429 || response.status === 503) {
        if (attempt === tries - 1) { throw new Error(`Wikisource: HTTP ${response.status}`); }
        await sleep((retry > 0 ? retry : 30) * 1000);    // too many requests: wait as asked
        continue;
      }
      if (!response.ok) { throw new Error(`Wikisource: HTTP ${response.status}`); }
      const data = await response.json();
      if (data.error && data.error.code === 'maxlag') {   // the site is busy: wait, as it asks
        await sleep((retry > 0 ? retry : 5) * 1000);
        continue;
      }
      if (data.error) { throw new Error(`Wikisource: ${data.error.info || data.error.code}`); }
      return data;
    }
    throw new Error('Wikisource is busy; try again later.');
  };
  return client;
}

/** wikisource.page_html: {html, revid, title} - the page as the site renders it; title: its own
 *  title (a link may be a redirect to it) */
export async function pageHtml(client, title) {
  const r = (await client.call({action: 'parse', page: title, prop: 'text|revid', disablelimitreport: '1',
    disableeditsection: '1', redirects: '1'})).parse;
  return {html: r.text, revid: r.revid, title: r.title || title};
}

/** wikisource.revisions: {page: its latest revision number}, 50 pages a request */
export async function revisions(client, titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += BATCH) {
    const data = await client.call({action: 'query', prop: 'info', titles: titles.slice(i, i + BATCH).join('|')});
    for (const p of (data.query && data.query.pages) || []) {
      if ('lastrevid' in p) { out[p.title] = p.lastrevid; }
    }
  }
  return out;
}

const HREF = /<a\b[^>]*\bhref="\/wiki\/([^"#?]+)(?:#[^"]*)?"[^>]*>([\s\S]*?)<\/a>/g;

/**
 * wikisource.sub_links: [page, link text] of the links to the parts of `under`, in order, once
 * each: its sub-pages ("צרור החיים/ח") or pages named after it ("דרך אמת א"); `also`: another name
 * its parts go by; `skip`: books of their own.
 */
export function subLinks(html, under, also = '', skip = new Set()) {
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(HREF)) {
    const page = unquote(m[1]).replace(/_/g, ' ');
    if (page.split('/')[0].includes(':') || skip.has(page) || [...skip].some(t => t.startsWith(`${page}/`))) {
      continue;                                // (other namespaces: authors, files, categories)
    }
    if ([under, also].some(n => n && (page.startsWith(`${n}/`) || page.startsWith(`${n} `))) && !seen.has(page)) {
      seen.add(page);
      out.push([page, m[2].replace(/<[^>]+>/g, '').trim()]);
    }
  }
  return out;
}

const bare = html => html.replace(/<!--[\s\S]*?-->/g, '');      // (hidden notes differ on every copy)

/**
 * wikisource.fetch_book: the title page, then each part (and its parts) in the order the title
 * page links to them. {title, fetched, requests, pages: [{page, name, depth, revid, html}]}
 */
export async function fetchPages(title, {client = apiClient(), skip = new Set(CATALOG.others || []),
  maxDepth = MAX_DEPTH, onPage = null} = {}) {
  const pages = [];
  const done = new Set();
  const texts = new Set();
  const short = title.startsWith('ספר ') ? title.replace(/^ספר ה?/, '') : '';
  const visit = async (page, name, depth) => {
    if (done.has(page)) { return; }
    done.add(page);
    const {html, revid, title: real} = await pageHtml(client, page);
    const b = bare(html);
    if ((done.has(real) && real !== page) || texts.has(b)) { return; }   // (a redirect to a page already taken)
    done.add(real);
    texts.add(b);
    pages.push({page: real, name, depth, revid, html});
    if (onPage) { onPage(pages.length); }
    if (depth < maxDepth) {
      let subs = subLinks(html, real, '', skip);
      if (!subs.length && depth === 0 && short) {
        subs = subLinks(html, real, short, new Set([...skip, short, title]));
      }
      for (const [sub, text] of subs) { await visit(sub, text, depth + 1); }
    }
  };
  await visit(title, title, 0);
  return {title, fetched: new Date().toISOString().slice(0, 10), requests: client.requests, pages};
}

// ---------------------------------------------------------------- the editors' notes book

/** importers._to_export / _export_of: {text, nodes} in Sofer's complex-text form (for comparing) */
export function exportOf(tree, notes = false) {
  const defaultNode = () => ({key: 'default', title: '', enTitle: '', heTitle: '', default: true,
    nodeType: 'JaggedArrayNode', depth: 1, sectionNames: ['Paragraph'], addressTypes: ['Integer']});
  const toExport = node => {
    const text = {};
    const nodes = [];
    let n = 0;
    for (const c of node.children) {
      if (c.empty()) { continue; }
      let key = '';
      if (c.title) { n += 1; key = `S${n}`; }
      const sch = {key: key || 'default', title: key, enTitle: key, heTitle: c.title,
        titles: [{text: c.title || key, lang: 'he', primary: true}]};
      if (!key) { sch.default = true; }
      if (c.children.length) {
        let sub = toExport(c);
        if (c.paras.length) {
          sub = {text: {'': notes ? c.notesOf() : c.paras, ...sub.text}, nodes: [defaultNode(), ...sub.nodes]};
        }
        text[key] = sub.text;
        Object.assign(sch, {nodeType: 'SchemaNode', nodes: sub.nodes});
      } else {
        text[key] = notes ? c.notesOf() : c.paras;
        Object.assign(sch, {nodeType: 'JaggedArrayNode', depth: 1, sectionNames: ['Paragraph'], addressTypes: ['Integer']});
      }
      nodes.push(sch);
    }
    return {text, nodes};
  };
  let {text, nodes} = toExport(tree);
  if (!Object.keys(text).length && tree.paras.length) {
    text = {'': notes ? tree.notesOf() : tree.paras};
    nodes = [defaultNode()];
  }
  return {text, nodes};
}

/** The notes of each paragraph as one entry of the notes book ("(1) ...<br>(2) ..." when several) */
export const noteEntry = notes => notes.map((n, k) => (notes.length > 1 ? `(${k + 1}) ${n}` : n)).join('<br>');

/** A tree laid out as `tree` is, each paragraph the notes on that paragraph */
function notesTree(tree) {
  const out = new Node(tree.title);
  out.paras = (tree.notesOf ? tree.notesOf() : tree.paras.map(() => [])).map(noteEntry);
  out.children = tree.children.map(notesTree);
  return out;
}

/**
 * The book of the editors' notes (importers._write_notes): a commentary on the book, laid out like
 * it, linked to each paragraph that has notes. Adds the links to the book's own section files.
 * Returns [] when the book has no notes.
 */
export function notesBook(tree, entry, {files, sections}, version) {
  if (!tree.hasNotes || !tree.hasNotes()) { return []; }
  const nhe = NOTES_PREFIX + entry.heTitle;
  const ntitle = safe(nhe);
  const book = {
    title: ntitle,
    heTitle: nhe,
    categories: entry.categories.concat('Notes'),
    heCategories: (entry.heCategories || []).concat(CATEGORY_HE.Notes),
    dependence: 'Commentary',
    base_text_titles: [entry.title],
  };
  const ntree = notesTree(tree);
  const out = bookFiles(ntree, {...book, version, extra: {dependence: 'Commentary', base_text_titles: [entry.title],
    sofer_notes: true}});
  // (the two books' sections are the same, in the same order: link each paragraph to its notes)
  sections.forEach((ref, i) => {
    const meta = files[`${ref}.metadata.json`];
    const nref = out.sections[i];
    const nmeta = out.files[`${nref}.metadata.json`];
    const entries = out.files[Object.keys(out.files).find(n => n.startsWith(`${nref}.`) && n.endsWith('.he.json'))];
    if (!meta || !nmeta || !entries) { return; }
    meta.links = entries.map((text, j) => (text ? [{
      sourceRef: `${nref} ${j + 1}`, sourceHeRef: `${nmeta.heRef} ${j + 1}`, category: 'Commentary', sourceHasEn: false,
    }] : []));
    nmeta.links = entries.map((text, j) => (text ? [{
      sourceRef: `${ref} ${j + 1}`, sourceHeRef: `${meta.heRef} ${j + 1}`, sourceHasEn: false,
    }] : []));
  });
  return [{entry: book, files: out.files, firstSection: out.firstSection}];
}

// ---------------------------------------------------------------- the source

/** The edition's name, source and licence, with the credit the licence asks for */
export function versionOf(entry, book) {
  const page = (book && book.title) || entry.id;
  const fetched = (book && book.fetched) || '';
  return {
    versionTitle: 'Wikitext',
    versionSource: pageUrl(page),
    license: LICENSE,
    versionNotes: `From Hebrew Wikisource (Wikitext, he.wikisource.org), the page "${page}"`
      + `${fetched ? `, retrieved ${fetched}` : ''}. Licence CC BY-SA 4.0: written and edited by the site's`
      + ` volunteers (who they are: the page history, ${historyUrl(page)}); it may be shared and adapted`
      + ' with credit to them, under the same licence.',
    versionNotesInHebrew: `מתוך ויקיטקסט (he.wikisource.org), הדף "${page}"${fetched ? `, הורד ב־${fetched}` : ''}.`
      + ` רישיון CC BY-SA 4.0: נכתב ונערך בידי מתנדבי האתר (רשימתם בהיסטוריית הדף, ${historyUrl(page)});`
      + ' מותר להפיץ ולשנות בציון שמם ובאותו רישיון.',
    librarySource: ID,
  };
}

/** The installed book's record: its pages and the newest revision among them (the update check) */
export function installRecord(entry, book) {
  const revids = book.pages.map(p => p.revid || 0);
  return {hash: String(Math.max(0, ...revids)), pages: book.pages.map(p => p.page)};
}

/**
 * The catalogue: the bundled list; for the books on the phone, the newest revision of their pages
 * now (their hash), so "Check for updates" finds the books edited since they were downloaded.
 * installed: [{id, pages}] of this source's downloaded books.
 */
export async function loadCatalog({installed = [], client = apiClient(), data = CATALOG} = {}) {
  const entries = parseCatalog(data);
  const byId = {};
  entries.forEach(e => { byId[e.id] = e; });
  for (const rec of installed) {
    const e = byId[rec.id];
    if (!e || !rec.pages || !rec.pages.length) { continue; }
    const now = await revisions(client, rec.pages);
    const revids = Object.values(now);
    if (revids.length) { e.hash = String(Math.max(...revids)); }
  }
  return entries;
}

export default {
  id: ID,
  converterVersion: CONVERTER_VERSION,
  catalogUrl: null,
  parseCatalog: () => parseCatalog(),
  loadCatalog: installed => loadCatalog({installed}),
  fetchBook: entry => fetchPages(entry.id),
  bookUrl: entry => pageUrl(entry.id),
  toTree: book => [wikiTree(book), wikiAuthor(book)],
  isRestricted: () => false,           // (the site's texts are all CC BY-SA)
  versionOf,
  installRecord,
  companions: (tree, entry, main, book) => notesBook(tree, entry, main, versionOf(entry, book)),
};

export {WikiNode};
