/**
 * Hebrew Wikisource as an extra source (extras/wikisource.js, extras/wikisourceParse.js): the
 * site's rendered pages converted on the phone as Sofer converts them, the editors' notes as a
 * book of their own, the catalogue (Sofer's list), one copy of each sefer, the download through
 * the site's API, the update check by revision, and where a correction goes; the same books
 * hosted as one GitHub release (extras/wikisource.js HOSTED_TAG, built by
 * tools/library-export/build_wikisource_release.js): one download a book, the files the phone
 * would have made, the site's pages when the release does not have the book.
 *
 * The conversion fixtures (__tests__/fixtures/wikisource/*.json) are books as Sofer's download
 * keeps them (the site's pages, CC BY-SA); their expected results are made by Sofer's own importer
 * (tools/library-export/wikisource_fixtures.py -> *.sofer.json).
 */
import fs from 'fs';
import path from 'path';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {zip} from 'react-native-zip-archive';
import {wikiTree, wikiAuthor, pageParse, wikiKeys, withoutLead, unquote} from '../extras/wikisourceParse';
import wikisource, {
  exportOf, parseCatalog, entryFor, subLinks, fetchPages, apiClient, revisions, loadCatalog, versionOf,
  installRecord, notesBook, noteEntry, pageUrl, historyUrl, USER_AGENT, NOTES_PREFIX, formBody,
  convertPages, convert, treeOf, HOSTED_URL, HOSTED_INDEX, HOSTED_FORMAT, CONVERTER_VERSION, _forgetHostedIndex,
} from '../extras/wikisource';
import {sectionsOf} from '../extras/schema7';
import * as links from '../extras/links';
import CATALOG_DATA from '../extras/wikisourceBooks.json';
import {chooseBooks} from '../extras/catalog';
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
    // ("zips" are JSON objects {name: content}, as in soferLibrary.test.js)
    unzip: jest.fn(async (zipPath, dest) => {
      const entries = JSON.parse(await fsMock.readAsStringAsync(zipPath));
      for (const [name, content] of Object.entries(entries)) {
        await fsMock.writeAsStringAsync(`${dest}${name}`, content);
      }
      return dest;
    }),
  };
});

// (the bundled catalogue, and the made-up book of the fixtures as one more of its books)
jest.mock('../extras/wikisourceBooks.json', () => {
  const real = jest.requireActual('../extras/wikisourceBooks.json');
  return {...real, books: real.books.concat({page: 'ספר בדיקה', category: 'Musar', names: ['בדיקה', 'ספר בדיקה'], pages: 6})};
});

const FIXTURES = path.join(__dirname, 'fixtures', 'wikisource');
const fixture = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
const SYNTHETIC = fixture('synthetic.json');

// ---------------------------------------------------------------- the conversion

describe('converted as Sofer converts it (fixtures made by Sofer\'s importer)', () => {
  const names = fs.readdirSync(FIXTURES).filter(n => n.endsWith('.json') && !n.endsWith('.sofer.json'));
  test('there are fixtures', () => { expect(names.length).toBeGreaterThanOrEqual(4); });
  for (const name of names) {
    test(name, () => {
      const book = fixture(name);
      const want = fixture(name.replace(/\.json$/, '.sofer.json'));
      const tree = wikiTree(book);
      expect(exportOf(tree)).toEqual({text: want.text, nodes: want.nodes});
      expect(wikiAuthor(book)).toBe(want.author);
      expect(tree.hasNotes()).toBe(!!want.notes);
      if (want.notes) { expect(exportOf(tree, true)).toEqual({text: want.notes, nodes: want.notesNodes}); }
    });
  }

  test('the site\'s furniture is left out; the opening first; notes at their places', () => {
    const {text, nodes} = exportOf(wikiTree(SYNTHETIC));
    // (the contents page, the "about this edition" page, navigation, "see also" are not the book)
    expect(nodes.map(n => n.heTitle)).toEqual(['הקדמה', 'פרק א', 'פרק ב']);
    expect(JSON.stringify(text)).not.toMatch(/ממה נפשך|לוקה בחסר|קישור אחר|הושלם|על המהדורה/);
    expect(text.S2[2]).toBe('ועוד<i data-commentator="הערות" data-order="1"></i> אמר & הוסיף'
      + '<i data-commentator="הערות" data-order="2"></i>:');
    expect(text.S3[0]).toMatch(/^תחילת הדברים/);       // (the page's name opening its text, dropped)
  });

  test('page_parse: the three styles of the editors\' notes', () => {
    const [blocks, notes] = pageParse('<p>א<sup class="reference"><a href="#cite_note-x">1</a></sup></p>'
      + '<p>ב<a href="#fn_1">1</a></p><div class="mw-heading mw-heading2"><h2 id="הערות">הערות</h2></div>'
      + '<p><cite id="fn_1">1</cite> הערה ב</p><ol><li id="cite_note-x"><span class="reference-text">הערה א</span></li></ol>');
    expect(blocks).toEqual([['p', 'א<i data-commentator="הערות" data-order="1"></i>'],
      ['p', 'ב<i data-commentator="הערות" data-order="1"></i>1']]);   // (as Sofer's: a bare marker's number stays)
    expect(notes).toEqual({0: ['הערה א'], 1: ['הערה ב']});
  });

  test('Sofer\'s helpers', () => {
    expect(wikiKeys('ספר תניא מנוקד/חלק א')).toEqual(['ספר תניא', 'ספר תניא מנוקד', 'תניא']);
    expect(withoutLead('<b>פרק</b> א תניא', 'פרק א')).toBe('תניא');
    expect(withoutLead('<b>פרק א תניא</b>', 'פרק א')).toBe('<b>תניא</b>');
    expect(unquote('%D7%90_%ZZ%D7')).toBe('א_%ZZ�');
  });
});

// ---------------------------------------------------------------- the editors' notes book

describe('the editors\' notes: a book of their own, linked to the text', () => {
  const entry = {...entryFor({page: 'ספר בדיקה', category: 'Musar'}), title: 'ספר בדיקה'};
  const tree = wikiTree(SYNTHETIC);
  const version = versionOf(entry, SYNTHETIC);
  const main = bookFiles(tree, {...entry, version});

  test('"הערות המהדיר על ...", a commentary laid out like the book, under its shelf\'s Notes', () => {
    const [notes] = notesBook(tree, entry, main, version);
    expect(notes.entry).toMatchObject({
      title: `${NOTES_PREFIX}ספר בדיקה`, heTitle: `${NOTES_PREFIX}ספר בדיקה`, dependence: 'Commentary',
      base_text_titles: ['ספר בדיקה'], categories: ['Musar', 'Wikisource', 'Notes'], heCategories: ['ספרי מוסר', 'ויקיטקסט', 'הערות'],
    });
    const index = notes.files[`${NOTES_PREFIX}ספר בדיקה_index.json`];
    expect(index).toMatchObject({dependence: 'Commentary', base_text_titles: ['ספר בדיקה'], sofer_notes: true});
    // only the sections with notes (the introduction has none), each under the book's own key
    expect(index.schema.nodes.map(n => [n.key, n.heTitle])).toEqual([['S2', 'פרק א'], ['S3', 'פרק ב']]);
    expect(index.schema.nodes.map(n => n.key)).toEqual(main.files['ספר בדיקה_index.json'].schema.nodes.slice(1).map(n => n.key));
    expect(Object.keys(notes.files).some(n => n.startsWith(`${NOTES_PREFIX}ספר בדיקה, S1.`))).toBe(false);
    expect(notes.firstSection).toBe(`${NOTES_PREFIX}ספר בדיקה, S2`);
    const meta = name => notes.files[`${NOTES_PREFIX}ספר בדיקה, ${name}.metadata.json`];
    expect([meta('S2').prev, meta('S2').next, meta('S3').next]).toEqual([null, `${NOTES_PREFIX}ספר בדיקה, S3`, null]);
    const he = name => Object.entries(notes.files).find(([n]) => n.startsWith(`${NOTES_PREFIX}ספר בדיקה, ${name}.`) && n.endsWith('.he.json'))[1];
    // one entry for each of the book's paragraphs (empty where it has none: the numbers stay the book's)
    expect(he('S2')).toEqual(['הערה ראשונה', '', '(1) הערה שניה<br>(2) הערה שלישית']);
    expect(he('S3')).toEqual(['הערת המעתיק', '']);
    expect(noteEntry(['x'])).toBe('x');
  });

  test('a section whose notes are all on later paragraphs: no blank first row in the reader', () => {
    // (TextColumn skips empty segments; the first is kept only when the whole section is empty)
    const src = fs.readFileSync(path.join(__dirname, '..', 'TextColumn.js'), 'utf8');
    expect(src).toMatch(/const keepFirst = data\[sectionIndex\]\.every\(isEmpty\);/);
    expect(src).toMatch(/if \(\(segmentIndex !== 0 \|\| !keepFirst\) && isEmpty\(data\[sectionIndex\]\[segmentIndex\]\)\) \{ continue; \}/);
  });

  test('each paragraph with notes links to them (and back), as a commentary', () => {
    const files = JSON.parse(JSON.stringify(main.files));
    notesBook(tree, entry, {files, sections: main.sections}, version);
    const meta = files['ספר בדיקה, S2.metadata.json'];
    expect(meta.links).toEqual([
      [{sourceRef: `${NOTES_PREFIX}ספר בדיקה, S2 1`, sourceHeRef: `${NOTES_PREFIX}ספר בדיקה, פרק א 1`, category: 'Commentary', sourceHasEn: false}],
      [],
      [{sourceRef: `${NOTES_PREFIX}ספר בדיקה, S2 3`, sourceHeRef: `${NOTES_PREFIX}ספר בדיקה, פרק א 3`, category: 'Commentary', sourceHasEn: false}],
    ]);
  });

  test('a book without notes has no notes book', () => {
    const plainTree = wikiTree(fixture('kevod_melachim.json'));
    expect(notesBook(plainTree, entry, bookFiles(plainTree, {...entry, version}), version)).toEqual([]);
  });
});

// ---------------------------------------------------------------- the catalogue and the library

describe('the catalogue: Sofer\'s list of whole sefarim', () => {
  const entries = parseCatalog();

  test('each book filed under its shelf, then Wikisource (as Settings names it); CC BY-SA; its names as Sofer compares them', () => {
    expect(entries.length).toBe(CATALOG_DATA.books.length);
    expect(entries.length).toBeGreaterThan(20);
    const e = entries.find(x => x.id === 'ספר הרקמה');
    expect(e).toMatchObject({source: 'wikisource', heTitle: 'ספר הרקמה', title: 'ספר הרקמה',
      categories: ['Reference', 'Wikisource'], heCategories: ['ספרות עזר', 'ויקיטקסט'], license: 'CC-BY-SA'});
    expect(e.names).toEqual(['הרקמה', 'ספר הרקמה']);
    // (Sofer's: books the library has from Sefaria, vowelled editions and the two kinds the phone
    //  does not convert yet are not offered)
    const ids = new Set(entries.map(x => x.id));
    for (const left of ['ספר התניא', 'יד רמ"ה על הש"ס', 'תניא מנוקד/חלק א', 'חשוקי חמד']) { expect(ids.has(left)).toBe(false); }
    expect(CATALOG_DATA.others).toEqual(expect.arrayContaining(['תניא מנוקד/חלק א', 'ספר הרקמה']));
  });

  test('turning it on needs no download; it is off at first', async () => {
    expect(SOURCES.find(s => s.id === 'wikisource')).toMatchObject({extra: true, available: true, enabled: false});
    global.fetch = jest.fn();
    expect((await loadCatalog()).length).toBe(entries.length);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(extras.EXTRA_SOURCES.wikisource).toBe(wikisource);
  });
});

const SEFARIA_TOC = [{category: 'Tanakh', heCategory: 'תנ״ך', contents: [
  {title: 'Genesis', heTitle: 'בראשית', categories: ['Tanakh']},
  {title: 'Sefer HaRikmah', heTitle: 'ספר הרקמה', categories: ['Reference']},
]}];
const other = (source, id, heTitle) => ({source, id, heTitle, categories: ['Tanakh', 'X', 'Y'], heCategories: []});

describe('one copy of each sefer: Sefaria > Dicta > Otzaria > Wikisource, but Sofer\'s PREFERRED win', () => {
  const ws = parseCatalog({books: [
    {page: 'ספר הרקמה', category: 'Reference'},                              // Sefaria has it
    {page: 'ספר מאורות', category: 'Musar'},                                 // Otzaria has it as "מאורות"
    {page: 'ספר ייחודי', category: 'Musar'},
    {page: 'רוקח על שיר השירים', category: 'Jewish Thought', preferred: true, replaces: ['פירוש הרוקח על שיר השירים']},
  ]});

  test('Sefaria first, then the others; names without "ספר" count', () => {
    const {books} = chooseBooks(SEFARIA_TOC, {wikisource: ws, otzaria: [other('otzaria', 'o', 'מאורות')]});
    expect(books['ספר מאורות']).toBeUndefined();
    expect(books['מאורות'].source).toBe('otzaria');
    expect(books['ספר הרקמה']).toBeUndefined();
    expect(books['ספר ייחודי'].source).toBe('wikisource');
  });

  test('a PREFERRED book is used instead of the copy it replaces (Dicta\'s Rokeach), never Sefaria\'s', () => {
    const {books} = chooseBooks(SEFARIA_TOC, {
      dicta: [other('dicta', 'd', 'פירוש הרוקח על שיר השירים'), other('dicta', 'd2', 'ספר ייחודי')],
      wikisource: ws,
    });
    expect(books['רוקח על שיר השירים'].source).toBe('wikisource');
    expect(books['פירוש הרוקח על שיר השירים']).toBeUndefined();
    expect(books['ספר ייחודי'].source).toBe('dicta');          // (not preferred: Dicta comes first)
    const real = parseCatalog().find(e => e.id === 'רוקח על שיר השירים');
    expect(real).toMatchObject({preferred: true, replaces: ['פירוש הרוקח על שיר השירים']});
  });
});

// ---------------------------------------------------------------- the site's API

/**
 * A fake he.wikisource.org: {page: html}, redirects {from: to}; records each request's form.
 * hosted: the release's index (GET; none: 404), its requests in calls.gets.
 */
function fakeSite(pages, {redirects = {}, revs = {}, busy = 0, hosted = null} = {}) {
  const calls = [];
  calls.gets = [];
  let left = busy;
  global.fetch = jest.fn(async (url, init) => {
    if (!init || init.method !== 'POST') {
      calls.gets.push(url);
      if (hosted && url === `${HOSTED_URL}/${HOSTED_INDEX}`) { return {ok: true, status: 200, json: async () => hosted}; }
      return {ok: false, status: 404, json: async () => ({})};
    }
    const form = {};
    init.body.split('&').forEach(kv => { const [k, v] = kv.split('='); form[decodeURIComponent(k)] = decodeURIComponent(v); });
    calls.push({url, form, headers: init.headers, method: init.method});
    const json = data => ({ok: true, status: 200, headers: {get: () => null}, json: async () => data});
    if (left > 0) { left -= 1; return json({error: {code: 'maxlag', info: 'lagged'}}); }
    if (form.action === 'parse') {
      const title = redirects[form.page] || form.page;
      if (!(title in pages)) { return json({error: {code: 'missingtitle', info: 'no page'}}); }
      return json({parse: {title, revid: revs[title] || 10, text: pages[title]}});
    }
    const titles = form.titles.split('|');
    return json({batchcomplete: true, query: {pages: titles.map(t => ({title: t, lastrevid: revs[t] || 10}))}});
  });
  return calls;
}
const link = (page, text) => `<a href="/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}" title="${page}">${text}</a>`;

describe('the download: the site\'s API, as Wikimedia asks', () => {
  const T = 'ספר בדיקה';
  const site = {
    [T]: `<p>${link(`${T}/א`, 'א')} ${link(`${T}/ב`, 'ב')} ${link('ספר אחר/א', 'אחר')} ${link('מחבר:פלוני', 'פלוני')} ${link(`${T}/ג`, 'ג')}</p>`,
    [`${T}/א`]: `<p>טקסט א</p>${link(`${T}/א/1`, 'תת')}`,
    [`${T}/א/1`]: '<p>עמוק</p>',
    [`${T}/ב`]: '<p>טקסט ב</p>',
  };

  test('the title page, then its parts in order (sub-pages; redirects and other books not taken twice)', async () => {
    const calls = fakeSite(site, {redirects: {[`${T}/ג`]: `${T}/ב`}});
    const book = await fetchPages(T, {client: apiClient({sleep: async () => {}}), skip: new Set(['ספר אחר'])});
    expect(book.pages.map(p => [p.page, p.name, p.depth])).toEqual([
      [T, T, 0], [`${T}/א`, 'א', 1], [`${T}/א/1`, 'תת', 2], [`${T}/ב`, 'ב', 1]]);
    expect(book.requests).toBe(5);                                // (one a page, and the redirect)
    // POST, one at a time, maxlag, JSON v2, a descriptive agent
    expect(calls.every(c => c.method === 'POST' && c.url === 'https://he.wikisource.org/w/api.php')).toBe(true);
    expect(calls[0].form).toMatchObject({action: 'parse', page: T, prop: 'text|revid', redirects: '1',
      format: 'json', formatversion: '2', maxlag: '5', disableeditsection: '1'});
    expect(calls[0].headers['User-Agent']).toBe(USER_AGENT);
    expect(calls[0].headers['Api-User-Agent']).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^SoferBooksLibrary\/1\.0 \(https:\/\/github\.com\/soferbooks\/soferbooks-library\)$/);
  });

  test('the site busy (maxlag): it waits and asks again', async () => {
    fakeSite(site, {busy: 2});
    const sleep = jest.fn(async () => {});
    const book = await fetchPages(`${T}/ב`, {client: apiClient({sleep})});
    expect(book.pages).toHaveLength(1);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  test('sub_links: parts by sub-page or by name, once each, not other namespaces', () => {
    const html = link('דרך אמת א', 'א') + link('דרך אמת א', 'א') + link('דרך אמתי', 'x') + link('קטגוריה:דרך אמת/א', 'c');
    expect(subLinks(html, 'דרך אמת')).toEqual([['דרך אמת א', 'א']]);
  });

  test('revisions: 50 pages a request', async () => {
    const calls = fakeSite({}, {revs: {p3: 99}});
    const titles = Array.from({length: 120}, (_, i) => `p${i}`);
    const now = await revisions(apiClient(), titles);
    expect(calls).toHaveLength(3);
    expect(calls[0].form.titles.split('|')).toHaveLength(50);
    expect(now.p3).toBe(99);
    expect(formBody({a: 'א b'})).toBe('a=%D7%90%20b');
  });
});

// ---------------------------------------------------------------- on the phone (index.js)

describe('downloading a Wikisource book, its notes, and the update check', () => {
  const T = SYNTHETIC.title;
  const site = Object.fromEntries(SYNTHETIC.pages.map(p => [p.page, p.html]));
  const revs = Object.fromEntries(SYNTHETIC.pages.map(p => [p.page, p.revid]));
  const CAT = parseCatalog().filter(e => e.id === T);
  const NOTES = `${NOTES_PREFIX}${T}`;

  beforeEach(async () => {
    FileSystem.clear();
    await AsyncStorage.clear();
    zip.mockClear();
    _forgetHostedIndex();
    extras._reset({enabled: {wikisource: true}, catalogs: {wikisource: {fetchedAt: Date.now(), entries: CAT}}});
    extras.applyToToc(SEFARIA_TOC);
    global.Sefaria = {_loadTOC: jest.fn(async () => { toc = extras.applyToToc(SEFARIA_TOC); })};
  });
  afterEach(() => { delete global.Sefaria; });
  let toc = null;

  test('download: every page from the site, converted, its notes book beside it; delete: both go', async () => {
    fakeSite(site, {revs});
    expect(extras.needsDownload(T)).toBe(true);
    const first = await extras.downloadBook(T);
    expect(first).toBe(`${T}, S1`);
    const zipped = JSON.parse(await FileSystem.readAsStringAsync(`library/${T}.zip`));
    const index = JSON.parse(zipped[`${T}_index.json`]);
    expect(index.categories).toEqual(['Musar', 'Wikisource']);
    expect(index.authors).toEqual([{he: 'יעקב חאגיז', en: ''}]);
    expect(index.versions[0]).toMatchObject({versionTitle: 'Wikitext', license: 'CC-BY-SA', librarySource: 'wikisource',
      versionSource: pageUrl(T)});
    expect(index.versions[0].versionNotes).toContain(historyUrl(T));
    expect(index.versions[0].versionNotesInHebrew).toContain('ויקיטקסט');
    // (the title page's navigation box links to part א first, so it is named by that link, as in Sofer)
    expect([].concat(...JSON.parse(zipped[`${T}, S2.metadata.json`]).links).map(l => l.sourceRef))
      .toEqual([`${NOTES}, S2 2`, `${NOTES}, S2 4`]);
    // the notes book: its own zip, in the library with the book
    expect((await FileSystem.getInfoAsync(`library/${NOTES}.zip`)).exists).toBe(true);
    expect(extras.isExtraTitle(NOTES)).toBe(true);
    expect(extras.isDownloaded(NOTES)).toBe(true);
    expect(extras.extraBook(NOTES)).toMatchObject({dependence: 'Commentary', base_text_titles: [T]});
    const state = JSON.parse(await FileSystem.readAsStringAsync('library/_extras/state.json'));
    expect(state.installed[T]).toMatchObject({source: 'wikisource', id: T, hash: '105', converter: 1});
    expect(state.installed[T].pages).toHaveLength(6);
    expect(state.installed[NOTES]).toMatchObject({companionOf: T});
    expect(extras.booksToUpdate('wikisource')).toEqual([]);
    // in the library's table of contents beside the book: Musar > Wikisource > Notes
    const shelf = toc.find(c => c.category === 'Musar').contents.find(c => c.category === 'Wikisource');
    expect(shelf.contents.map(x => x.title || x.category)).toEqual([T, 'Notes']);
    expect(shelf.contents[1].contents[0]).toMatchObject({title: NOTES, dependence: 'Commentary', base_text_titles: [T],
      firstSection: `${NOTES}, S2`});    // (its first section with notes)

    await extras.deleteBook(T);
    expect((await FileSystem.getInfoAsync(`library/${NOTES}.zip`)).exists).toBe(false);
    expect(extras.isExtraTitle(NOTES)).toBe(false);
    expect(extras.needsDownload(T)).toBe(true);
  });

  test('"Check for updates": the revisions of the book\'s pages; an edited page is an update', async () => {
    fakeSite(site, {revs});
    await extras.downloadBook(T);
    // unchanged: one request (its 6 pages), nothing to update
    let calls = fakeSite(site, {revs});
    expect(await extras.checkUpdates('wikisource')).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].form).toMatchObject({action: 'query', prop: 'info'});
    // a part edited on the site
    calls = fakeSite(site, {revs: {...revs, [`${T}/ב`]: 2000}});
    expect(await extras.checkUpdates('wikisource')).toEqual([T]);
  });

  test('progress: pages done of the pages the list gives, told as they come; nothing left after', async () => {
    fakeSite(site, {revs});
    const seen = [];
    const off = extras.subscribe(() => { const p = extras.downloadProgress(T); if (p) { seen.push(p); } });
    const done = extras.downloadBook(T);
    expect(extras.downloadsUnderWay()).toEqual([T]);
    expect(extras.downloadBook(T)).toBe(done);          // (asked again: the same download)
    await done;
    off();
    expect(seen[0]).toEqual({done: 0, total: 0, unit: null});                  // (started: nothing known yet)
    expect(seen.slice(1).length).toBeGreaterThan(0);
    expect(seen.slice(1).every(p => p.unit === 'pages' && p.total === 6)).toBe(true);   // (the list: 6 pages)
    expect(seen[seen.length - 1].done).toBe(6);
    expect(extras.downloadProgress(T)).toBeNull();
    expect(extras.downloadsUnderWay()).toEqual([]);
  });

  test('Cancel: no more requests, nothing written, the book still to download', async () => {
    const calls = fakeSite(site, {revs});
    const real = global.fetch;
    global.fetch = jest.fn(async (...a) => {           // (cancelled while the 3rd page is on its way)
      if (calls.length === 2 && a[1]) { extras.cancelDownload(T); }
      return real(...a);
    });
    await expect(extras.downloadBook(T)).rejects.toBeInstanceOf(extras.DownloadCancelledError);
    expect(calls).toHaveLength(3);
    expect((await FileSystem.getInfoAsync(`library/${T}.zip`)).exists).toBe(false);
    expect(extras.needsDownload(T)).toBe(true);
    expect(extras.downloadProgress(T)).toBeNull();
    // (and it can be downloaded again)
    fakeSite(site, {revs});
    expect(await extras.downloadBook(T)).toBe(`${T}, S1`);
  });

  test('Settings counts the books downloaded, not the notes books made with them', async () => {
    fakeSite(site, {revs});
    await extras.downloadBook(T);
    expect(extras.installedTitles('wikisource').sort()).toEqual([T, NOTES].sort());
    expect(extras.downloadedBooks('wikisource')).toEqual([T]);
    const React = require('react');
    const renderer = require('react-test-renderer');
    const {Text} = require('react-native');
    const strings = require('../LocalizedStrings').default;
    const {ExtraSourceRow} = require('../shomer/ContentFilterSettings');
    let inst;
    renderer.act(() => {
      inst = renderer.create(React.createElement(ExtraSourceRow, {source: SOURCES.find(s => s.id === 'wikisource'),
        langStyle: {}, theme: {}, interfaceLanguage: 'english'}));
    });
    const texts = inst.root.findAllByType(Text).map(t => [].concat(t.props.children).join(''));
    expect(texts).toContain(strings.extras.downloaded_count_one);   // ("1 book downloaded", not "1 books")
    renderer.act(() => inst.unmount());
  });

  test('the progress as the reader sees it: pages for Wikisource, a share for a file, nothing when not known', () => {
    const {progressText} = require('../ExtraDownloadProgress');
    const strings = require('../LocalizedStrings').default;
    const flat = x => [].concat(x).join('');
    strings.setLanguage('en');
    expect(flat(progressText({done: 12, total: 340, unit: 'pages'}))).toBe('12 of 340 pages');
    expect(flat(progressText({done: 42, total: 100, unit: 'percent'}))).toBe('42% downloaded');
    expect(progressText({done: 0, total: 0, unit: null})).toBeNull();
    expect(progressText(null)).toBeNull();
  });

  test('"Report a mistake" on a Wikisource book goes to SoferBooks (the wiki has no address)', () => {
    const version = versionOf(CAT[0], SYNTHETIC);
    expect(version.librarySource).toBe('wikisource');
    const e = correctionEmail({ref: `${T}, S2:1`, text: 't', version, platform: 'android'});
    expect(e.source).toBe('wikisource');
    expect(e.to).toBe('corrections@soferbooks.com');
    expect(e.subject).toContain('Wikisource');
  });

  test('the installed record and the hash: the newest revision among the book\'s pages', () => {
    expect(installRecord(CAT[0], {pages: [{page: 'a', revid: 5}, {page: 'b', revid: 9}]})).toEqual({hash: '9', pages: ['a', 'b']});
  });
});

// ---------------------------------------------------------------- the release (hosted copies)

describe('the books hosted as one release: one download a book, the files the phone would make', () => {
  const T = SYNTHETIC.title;
  const NOTES = `${NOTES_PREFIX}${T}`;
  const site = Object.fromEntries(SYNTHETIC.pages.map(p => [p.page, p.html]));
  const revs = Object.fromEntries(SYNTHETIC.pages.map(p => [p.page, p.revid]));
  const CAT = parseCatalog().filter(e => e.id === T);
  const FILE = 'ws-000000000000.zip';
  let book = null;           // (the book's pages as the phone's download gives them: beforeAll)

  /** The release as build_wikisource_release.js makes it: the book's zip and its index */
  function release({hash = '105', file = FILE} = {}) {
    const made = convertPages(CAT[0], book);
    const all = {...made.files};
    made.companions.forEach(c => Object.assign(all, c.files));
    const zipText = JSON.stringify(Object.fromEntries(Object.entries(all).map(([n, d]) => [n, JSON.stringify(d)])));
    FileSystem.setRemote(`${HOSTED_URL}/${FILE}`, zipText);
    return {format: HOSTED_FORMAT, converterVersion: CONVERTER_VERSION, books: {[T]: {
      title: T, file, size: zipText.length, md5: null, sha256: 'x', hash, fetched: book.fetched,
      pages: SYNTHETIC.pages.map(p => p.page), firstSection: made.firstSection,
      companions: made.companions.map(c => ({entry: c.entry, firstSection: c.firstSection})),
    }}};
  }
  const libraryZip = async title => {
    const z = JSON.parse(await FileSystem.readAsStringAsync(`library/${title}.zip`));
    return Object.fromEntries(Object.entries(z).map(([n, t]) => [n, JSON.parse(t)]));
  };
  /** The book downloaded from the site's pages, as before: its files, its notes', its links file */
  async function fromTheSite() {
    fakeSite(site, {revs});
    await extras.downloadBook(T);
    const out = {book: await libraryZip(T), notes: await libraryZip(NOTES),
      links: JSON.parse(await FileSystem.readAsStringAsync(links.linksFile(T)))};
    await extras.deleteBook(T);
    _forgetHostedIndex();
    return out;
  }

  beforeAll(async () => {
    fakeSite(site, {revs});
    book = await fetchPages(T, {client: apiClient({sleep: async () => {}})});
  });
  beforeEach(async () => {
    FileSystem.clear();
    await AsyncStorage.clear();
    _forgetHostedIndex();
    extras._reset({enabled: {wikisource: true}, catalogs: {wikisource: {fetchedAt: Date.now(), entries: CAT}}});
    extras.applyToToc(SEFARIA_TOC);
    global.Sefaria = {_loadTOC: jest.fn(async () => { extras.applyToToc(SEFARIA_TOC); })};
  });
  afterEach(() => { delete global.Sefaria; });

  test('the build converts as the phone does (convertPages = extras convertBook)', () => {
    const phone = extras.convertBook(CAT[0], book);
    const built = convertPages(CAT[0], book);
    expect(built.files).toEqual(phone.files);
    expect(built.firstSection).toBe(phone.firstSection);
    expect(built.companions).toEqual(phone.companions);
    expect(convert(CAT[0], book)).toBeNull();          // (pages from the site: converted as before)
  });

  test('download: the index and one zip, no request to the site; the same files, notes and links as from the site', async () => {
    const before = await fromTheSite();
    const calls = fakeSite(site, {revs, hosted: release()});
    FileSystem.downloadAsync.mockClear();
    expect(await extras.downloadBook(T)).toBe(`${T}, S1`);
    expect(calls).toHaveLength(0);                                   // (no page from the site)
    expect(calls.gets).toEqual([`${HOSTED_URL}/${HOSTED_INDEX}`]);
    expect(FileSystem.downloadAsync.mock.calls.map(c => c[0])).toEqual([`${HOSTED_URL}/${FILE}`]);
    expect(await libraryZip(T)).toEqual(before.book);
    expect(await libraryZip(NOTES)).toEqual(before.notes);
    expect(JSON.parse(await FileSystem.readAsStringAsync(links.linksFile(T)))).toEqual(before.links);
    expect(extras.extraBook(NOTES)).toMatchObject({dependence: 'Commentary', base_text_titles: [T]});
    const state = JSON.parse(await FileSystem.readAsStringAsync('library/_extras/state.json'));
    expect(state.installed[T]).toMatchObject({source: 'wikisource', id: T, hash: '105', converter: 1});
    expect(state.installed[T].pages).toHaveLength(6);
    expect(state.installed[NOTES]).toMatchObject({companionOf: T});
    // (nothing left in the cache)
    expect((await FileSystem.readDirectoryAsync('')).filter(n => n.includes('sofer-'))).toEqual([]);
  });

  test('the release does not have the book, or its zip does not come: the site\'s pages, as before', async () => {
    let calls = fakeSite(site, {revs, hosted: {...release(), books: {}}});
    expect(await extras.downloadBook(T)).toBe(`${T}, S1`);
    expect(calls.length).toBeGreaterThan(5);
    await extras.deleteBook(T);
    _forgetHostedIndex();
    calls = fakeSite(site, {revs, hosted: release({file: 'ws-missing.zip'})});
    expect(await extras.downloadBook(T)).toBe(`${T}, S1`);
    expect(calls.length).toBeGreaterThan(5);
    expect(extras.isDownloaded(NOTES)).toBe(true);
  });

  test('"Check for updates": the release\'s hash, no request to the site; a newer copy from the site is kept', async () => {
    fakeSite(site, {revs, hosted: release()});
    await extras.downloadBook(T);
    _forgetHostedIndex();
    let calls = fakeSite(site, {revs, hosted: release()});
    expect(await extras.checkUpdates('wikisource')).toEqual([]);
    expect(calls).toHaveLength(0);
    _forgetHostedIndex();
    calls = fakeSite(site, {revs, hosted: release({hash: '200'})});
    expect(await extras.checkUpdates('wikisource')).toEqual([T]);
    expect(calls).toHaveLength(0);
    // a copy taken from the site after the release was made: not "updated" back to the older one
    await extras.deleteBook(T);
    _forgetHostedIndex();
    fakeSite(site, {revs: {...revs, [`${T}/ב`]: 2000}});
    await extras.downloadBook(T);
    _forgetHostedIndex();
    fakeSite(site, {revs, hosted: release()});
    expect(await extras.checkUpdates('wikisource')).toEqual([]);
  });

  test('nothing downloaded: the catalogue needs no request', async () => {
    global.fetch = jest.fn();
    await loadCatalog();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a book from the release: its sections as a tree, as the links read them (treeOf)', () => {
    const leaves = (tree, he) => sectionsOf(tree, he).leaves.map(l => [l.keys, l.heTitles, l.paras]);
    for (const name of fs.readdirSync(FIXTURES).filter(n => n.endsWith('.json') && !n.endsWith('.sofer.json'))) {
      const b = fixture(name);
      const entry = entryFor({page: b.title, category: 'Musar'});
      const made = convertPages(entry, b);
      expect(leaves(treeOf(made.files, entry.title, entry.heTitle), entry.heTitle)).toEqual(leaves(made.tree, entry.heTitle));
    }
  });

  test('a release made by another converter is not used', async () => {
    const calls = fakeSite(site, {revs, hosted: {...release(), converterVersion: CONVERTER_VERSION + 1}});
    await extras.downloadBook(T);
    expect(calls.length).toBeGreaterThan(5);
  });
});

afterAll(() => { delete global.fetch; });
