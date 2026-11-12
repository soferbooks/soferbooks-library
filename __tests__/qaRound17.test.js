/**
 * Fixes from the 16th emulator QA round and the owner's requests of 2026-11-12: Chashukei Chemed on
 * the Gemara's side, the download size in kB, taps that open a closed panel, the full title in
 * search, the Rokeach's English names, a note anchor that made the rest italic, Dicta offline, the
 * English translation picked by itself, and pinned tabs that keep their place.
 */
import Sefaria from '../sefaria';
import ReaderApp, { panelIsShown, panelAnimationStuck, PANEL_ANIMATION_STALE_MS } from '../ReaderApp';
import { buildIndex, relatedFromIndex } from '../extras/links';
import { ownLinks } from '../extras/sofer';
import { formatBookSize, bookSizeText, knownBookSize } from '../fullLibrary';
import { withOwnBooks, localNameResults } from '../search/localAutocomplete';
import { entryFor as wikisourceEntry, englishNames, withBundledNames } from '../extras/wikisource';
import { isOnlineState, downloadNeedsConnection } from '../connectivity';
import { preferredEnglishVersion, isTanakhText } from '../translationLanguage';
import { pinnedTabAction, mostRecentUnpinnedTabForBook } from '../tabs/tabState';

describe('1. Chashukei Chemed shows under its Gemara line', () => {
  // (the release's CC on Berakhot: its three pieces of 2a on 2a:1, of 3a on 3a:12 and 3a:14 -
  //  links_wikitext_Chashukei Chemed.csv)
  const entry = { title: 'Chashukei Chemed on Berakhot', base_text_titles: ['Berakhot'] };
  const meta = (ref, targets) => ({ ref, heRef: ref, links: targets.map(t => [{ sourceRef: t }]) });
  const files = {
    'Chashukei Chemed on Berakhot 2a.metadata.json': meta('Chashukei Chemed on Berakhot 2a',
      ['Berakhot 2a:1', 'Berakhot 2a:1', 'Berakhot 2a:1']),
    'Chashukei Chemed on Berakhot 3a.metadata.json': meta('Chashukei Chemed on Berakhot 3a',
      ['Berakhot 3a:12', 'Berakhot 3a:12', 'Berakhot 3a:14', 'Berakhot 3a:14', 'Berakhot 3a:14']),
  };

  test('its own links, reversed, are the Gemara section\'s commentary', () => {
    const own = ownLinks(entry, files);
    expect(own.every(l => l.r === 'base')).toBe(true);
    const index = buildIndex([{ title: entry.title, heTitle: 'חשוקי חמד על ברכות', links: own, pending: [] }]);
    const realTitle = Sefaria.textTitleForRef;
    Sefaria.textTitleForRef = ref => (ref.startsWith('Chashukei') ? 'Chashukei Chemed on Berakhot' : 'Berakhot');
    try {
      const on2a = relatedFromIndex(index, 'Berakhot 2a');
      expect(on2a.map(l => [l.anchorRef, l.sourceRef, l.category])).toEqual([
        ['Berakhot 2a:1', 'Chashukei Chemed on Berakhot 2a:1', 'Commentary'],
        ['Berakhot 2a:1', 'Chashukei Chemed on Berakhot 2a:2', 'Commentary'],
        ['Berakhot 2a:1', 'Chashukei Chemed on Berakhot 2a:3', 'Commentary'],
      ]);
      const on3a = relatedFromIndex(index, 'Berakhot 3a');
      expect(on3a.filter(l => l.anchorRef === 'Berakhot 3a:12')).toHaveLength(2);
      expect(on3a.filter(l => l.anchorRef === 'Berakhot 3a:14')).toHaveLength(3);
    } finally {
      Sefaria.textTitleForRef = realTitle;
    }
  });

  test('a book that comes ready made keeps its links (they were dropped before)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'extras', 'index.js'), 'utf8');
    const body = src.slice(src.indexOf('async function collectLinks'), src.indexOf('export function refreshInferred'));
    expect(body).toMatch(/if \(!tree\) \{\s*try \{[\s\S]*links\.collect\(\{title, heTitle: entry\.heTitle, tree: null, where\}\)/);
  });
});

describe('2. the download size of a small book', () => {
  test('kB under a megabyte, one decimal under 10 MB', () => {
    expect(formatBookSize(12)).toBe('12 KB');
    expect(formatBookSize(0.4)).toBe('1 KB');
    expect(formatBookSize(1500)).toBe('1.5 MB');
    expect(formatBookSize(0)).toBe(null);
  });

  test('the Sofer Library\'s 12 kB Megillat (with its 5 kB notes) is not "about 1 MB"', () => {
    const b = { source: 'sofer_library', size: 12457, companions: [{ size: 5489 }] };
    const size = knownBookSize(b, { ratios: { sofer_library: 3.6 } });
    expect(size).toMatchObject({ downloadKB: 18 });
    expect(bookSizeText(size)).toEqual({ download: '18 KB', stored: '67 KB' });
    // (a source's own estimate in MB still reads)
    expect(bookSizeText({ downloadMB: 8, storedMB: 26 })).toEqual({ download: '8 MB', stored: '26 MB' });
  });
});

describe('3 and 8. a tap on a passage opens a panel that cannot be seen', () => {
  const makeApp = state => {
    const app = new ReaderApp({ textLanguage: 'hebrew', dispatch: jest.fn(), showErrorBoundary: jest.fn(),
      theme: {}, themeStr: 'white', biLayout: 'stacked', fontSize: 20 });
    app.setState = (u, cb) => {
      const part = typeof u === 'function' ? u(app.state, app.props) : u;
      app.state = { ...app.state, ...part };
      if (cb) { cb(); }
    };
    app.forceUpdate = () => {};
    app.animateTextList = jest.fn();
    app.updateLinkSummary = jest.fn();
    app.updateVersionCat = jest.fn();
    app._getTranslationForSegment = () => null;
    app.state = { ...app.state, footerTab: 'Texts', data: [[{}, {}, {}]], sectionArray: ['Berakhot 2a'],
      linksLoaded: [true], linkRecentFilters: [], versionRecentFilters: [], textListFlex: 0.5,
      textListAnimating: false, textListVisible: true, segmentIndexRef: 0, sectionIndexRef: 0,
      segmentRef: 'Berakhot 2a:1', menuOpen: null, ...state };
    return app;
  };
  beforeEach(() => { jest.spyOn(Sefaria.history, 'saveHistoryItem').mockImplementation(() => {}); });
  afterEach(() => { jest.restoreAllMocks(); });
  afterAll(() => new Promise(resolve => setTimeout(resolve, 100)));

  test('panelIsShown and a stuck animation', () => {
    expect(panelIsShown({ textListVisible: true, textListFlex: 0.5 })).toBe(true);
    expect(panelIsShown({ textListVisible: true, textListFlex: 0.0001 })).toBe(false);
    expect(panelIsShown({ textListVisible: false, textListFlex: 0.5 })).toBe(false);
    expect(panelAnimationStuck(true, 1000, 1000 + PANEL_ANIMATION_STALE_MS + 1)).toBe(true);
    expect(panelAnimationStuck(true, 1000, 1100)).toBe(false);
    expect(panelAnimationStuck(false, 1000, 999999)).toBe(false);
  });

  test('open at ~0 height (restored so): a tap on the selected passage opens it, in one tap', () => {
    const app = makeApp({ textListFlex: 0.0001 });
    app.textSegmentPressed(0, 0, 'Berakhot 2a:1', true);
    expect(app.state.textListVisible).toBe(true);
    // (it was opened - animated up from closed - not "closed")
    return new Promise(resolve => setTimeout(resolve, 50)).then(() => {
      expect(app.animateTextList).toHaveBeenCalledWith(0.0001, expect.any(Number), 200);
      expect(app.animateTextList).not.toHaveBeenCalledWith(0.0001, 0.0001, 200);
    });
  });

  test('an animation whose end never came does not swallow taps', () => {
    const app = makeApp({ textListVisible: false, textListFlex: 0.0001, textListAnimating: true });
    app._panelAnimationStartedAt = Date.now() - PANEL_ANIMATION_STALE_MS - 10;
    app.textSegmentPressed(0, 1, 'Berakhot 2a:2', true);
    expect(app.state.textListAnimating).toBe(false);
    expect(app.state.textListVisible).toBe(true);
    expect(app.state.segmentRef).toBe('Berakhot 2a:2');
  });

  test('a panel that is shown still closes on a tap on its passage', () => {
    const app = makeApp();
    app.textSegmentPressed(0, 0, 'Berakhot 2a:1', true);
    expect(app.animateTextList).toHaveBeenCalledWith(0.5, 0.0001, 200);
  });
});

describe('5. the full title of an extra book stays in the suggestions', () => {
  beforeEach(() => {
    global.Sefaria = {
      booksDict: { Berakhot: 1, 'Chashukei Chemed on Berakhot': 1 },
      index: t => ({ title: t, heTitle: t === 'Berakhot' ? 'ברכות' : 'חשוקי חמד על ברכות' }),
      toc: [],
    };
  });

  test('typed in full, Sefaria\'s API not knowing it', () => {
    const own = t => t === 'Chashukei Chemed on Berakhot';
    const api = { completion_objects: [], completions: [], is_ref: false, lang: 'en' };
    const out = withOwnBooks('Chashukei Chemed on Berakhot', api, own);
    expect(out).toMatchObject({ is_ref: true, ref: 'Chashukei Chemed on Berakhot', book: 'Chashukei Chemed on Berakhot', is_book: true });
    // (one letter short: listed as a book, as before)
    const partial = withOwnBooks('Chashukei Chemed on Berakho', api, own);
    expect(partial.completion_objects.map(c => c.key)).toContain('Chashukei Chemed on Berakhot');
  });
});

describe('6. the Rokeach on Shir HaShirim has English names', () => {
  const book = { page: 'רוקח על שיר השירים', category: 'Jewish Thought', names: ['רוקח על שיר השירים'], pages: 9,
    preferred: true, replaces: ['פירוש הרוקח על שיר השירים', 'Rokeach on Song of Songs', 'Rokeach on Shir HaShirim'] };

  test('taken from the copies it replaces', () => {
    expect(englishNames(book)).toEqual({ enTitle: 'Rokeach on Song of Songs',
      titleVariants: ['Rokeach on Song of Songs', 'Rokeach on Shir HaShirim'] });
    expect(wikisourceEntry(book)).toMatchObject({ enTitle: 'Rokeach on Song of Songs' });
    expect(englishNames({ page: 'x', names: [] })).toEqual({});
  });

  test('a catalogue kept on the phone gets them from the bundled list', () => {
    const kept = { source: 'wikisource', id: 'רוקח על שיר השירים', title: 'רוקח על שיר השירים' };
    expect(withBundledNames(kept)).toMatchObject({ enTitle: 'Rokeach on Song of Songs' });
  });

  test('an English search finds it, shown by its English name', () => {
    global.Sefaria = {
      booksDict: { 'רוקח על שיר השירים': 1 },
      index: () => ({ title: 'רוקח על שיר השירים', heTitle: 'רוקח על שיר השירים',
        titleVariants: ['Rokeach on Song of Songs', 'Rokeach on Shir HaShirim'] }),
      toc: [],
    };
    for (const q of ['Rokeach', 'Rokeach on Song of Songs', 'Rokeach on Shir HaShirim']) {
      const found = localNameResults(q).completion_objects;
      expect(found).toEqual([expect.objectContaining({ key: 'רוקח על שיר השירים', title: 'Rokeach on Song of Songs' })]);
    }
  });
});

describe('7. an empty note anchor does not make the rest of the passage italic', () => {
  test('clickable words keep an empty element closed, and quote attributes', () => {
    const html = '<div class="hebrew"><b>שיר</b> – ש\'<i data-commentator="הערות" data-order="1"></i> בגי\' נזר<br>גדול</div>';
    const out = Sefaria.util.wrapWordsWithClickableHTML(html);
    expect(out).toContain('<i data-commentator="הערות" data-order="1"></i>');
    expect(out).toContain('<br>');
    expect(out).not.toContain('</br>');
  });
});

describe('9. Dicta\'s downloads need a connection', () => {
  test('offline is only what NetInfo says is offline', () => {
    expect(isOnlineState({ isConnected: false })).toBe(false);
    expect(isOnlineState({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(isOnlineState({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(isOnlineState(null)).toBe(true);
    expect(downloadNeedsConnection('dicta')).toBe(true);
    expect(downloadNeedsConnection('sofer_library')).toBe(false);
  });
});

describe('10. the English translation picked by itself', () => {
  const v = (versionTitle, extra = {}) => ({ versionTitle, language: 'en', ...extra });
  const TANAKH = ['Tanakh', 'Torah'];
  const genesis = [
    v('The Contemporary Torah, Jewish Publication Society, 2006'),
    v('Tanakh: The Holy Scriptures, published by JPS'),
    v('The Koren Jerusalem Bible'),
    v('Metsudah Chumash, with Onkelos and Rashi, Metsudah Publications'),
    v('Metsudah Chumash, Metsudah Publications, 2009'),
    v('Die Tora [de]', { actualLanguage: 'de' }),
  ];

  test('Genesis 1: Metsudah, the translation alone', () => {
    expect(preferredEnglishVersion(genesis, { categories: TANAKH }).versionTitle)
      .toBe('Metsudah Chumash, Metsudah Publications, 2009');
  });

  test('a book without Metsudah: Koren, then JPS 1985, then Sefaria\'s order', () => {
    const noMetsudah = genesis.filter(x => !/Metsudah/.test(x.versionTitle));
    expect(preferredEnglishVersion(noMetsudah, { categories: ['Tanakh', 'Prophets'] }).versionTitle).toBe('The Koren Jerusalem Bible');
    const noKoren = noMetsudah.filter(x => !/Koren/.test(x.versionTitle));
    expect(preferredEnglishVersion(noKoren, { categories: TANAKH }).versionTitle).toBe('Tanakh: The Holy Scriptures, published by JPS');
    expect(preferredEnglishVersion([v('Other A'), v('Other B')], { categories: TANAKH }).versionTitle).toBe('Other A');
  });

  test('the content filter and the English-only rule come first', () => {
    const hidden = x => /Metsudah/.test(x.versionTitle);
    expect(preferredEnglishVersion(genesis, { categories: TANAKH, isHidden: hidden }).versionTitle).toBe('The Koren Jerusalem Bible');
    expect(preferredEnglishVersion([v('Die Tora [de]', { actualLanguage: 'de' })], { categories: TANAKH })).toBe(null);
  });

  test('a commentary (Rashi, Bartenura) keeps Sefaria\'s order', () => {
    expect(isTanakhText(['Tanakh', 'Commentary', 'Rashi'])).toBe(false);
    const rashi = [v('Rashi Chumash, Metsudah Publications'), v('Pentateuch with Rashi\'s commentary')];
    expect(preferredEnglishVersion(rashi.slice().reverse(), { categories: ['Tanakh', 'Commentary', 'Rashi'] }).versionTitle)
      .toBe('Pentateuch with Rashi\'s commentary');
    expect(preferredEnglishVersion([v('B'), v('Koren x')], { categories: ['Mishnah'] }).versionTitle).toBe('B');
  });
});

describe('11. a pinned tab keeps its place', () => {
  const pinned = { id: 'p', title: 'Genesis', pinned: true };
  const plain = { id: 'q', title: 'Genesis' };

  test('the book opened as a book goes to the pinned tab', () => {
    expect(pinnedTabAction({ pinned, calledFrom: 'navigation' })).toBe('switch');      // library, Continue reading
    expect(pinnedTabAction({ pinned, calledFrom: 'text toc' })).toBe('switch');        // its contents page
    expect(pinnedTabAction({ pinned, calledFrom: 'search', isResume: true })).toBe('switch');
  });

  test('a particular place of it from elsewhere opens a new tab', () => {
    for (const calledFrom of ['search', 'deep link', 'text list', undefined]) {
      expect(pinnedTabAction({ pinned, calledFrom })).toBe('new-tab');
    }
  });

  test('"Open here" and a link inside a pinned tab open a new tab; its own contents and versions do not', () => {
    expect(pinnedTabAction({ pinned, calledFrom: 'text list', insideReader: true, sameBook: false })).toBe('new-tab');
    expect(pinnedTabAction({ pinned, calledFrom: 'deep link', insideReader: true })).toBe('new-tab');
    expect(pinnedTabAction({ pinned, calledFrom: 'text toc', insideReader: true, sameBook: true })).toBe('here');
    expect(pinnedTabAction({ pinned, calledFrom: 'text list', insideReader: true, sameBook: true, loadNewVersions: true })).toBe('here');
    expect(pinnedTabAction({ pinned, calledFrom: 'tab', insideReader: true })).toBe('here');
  });

  test('an unpinned tab is not its business', () => {
    expect(pinnedTabAction({ pinned: plain, calledFrom: 'search', insideReader: true })).toBe('here');
    const state = { tabs: [{ ...pinned, lastUsed: 5 }, { ...plain, lastUsed: 3 }, { id: 'r', title: 'Exodus', lastUsed: 9 }] };
    expect(mostRecentUnpinnedTabForBook(state, 'Genesis').id).toBe('q');
    expect(mostRecentUnpinnedTabForBook({ tabs: [pinned] }, 'Genesis')).toBe(null);
  });

  test('in the app: a search result in the pinned tab\'s book opens a new tab with the notice', () => {
    const app = new ReaderApp({ textLanguage: 'english', dispatch: jest.fn(), showErrorBoundary: jest.fn(),
      theme: {}, themeStr: 'white', biLayout: 'stacked', fontSize: 20 });
    app.setState = (u, cb) => { app.state = { ...app.state, ...(typeof u === 'function' ? u(app.state) : u) }; if (cb) { cb(); } };
    app.state = { ...app.state, menuOpen: 'search',
      readerTabs: { ...app.state.readerTabs, tabs: [{ ...pinned, ref: 'Genesis 1', lastUsed: 1 }], activeTabId: null } };
    const realTitle = Sefaria.textTitleForRef;
    Sefaria.textTitleForRef = () => 'Genesis';
    app.openRefInNewTab = jest.fn(() => Promise.resolve());
    app.switchToTab = jest.fn(() => Promise.resolve());
    jest.spyOn(Sefaria.history, 'getHistoryRefForTitle').mockImplementation(() => null);
    try {
      app._openRefFromOutside('Genesis 30:2', 'search', null, false);
      expect(app.openRefInNewTab).toHaveBeenCalledWith('Genesis 30:2', null, { quiet: true });
      expect(app.switchToTab).not.toHaveBeenCalled();
      expect(app.state.actionToast).toMatchObject({ text: expect.any(String), actionLabel: expect.any(String) });
      app.state.actionToast.onAction();
      expect(app.switchToTab).toHaveBeenCalledWith('p');
      app.switchToTab.mockClear();
      app._openRefFromOutside('Genesis 1', 'navigation', null, false);     // (the book from the library)
      expect(app.switchToTab).toHaveBeenCalledWith('p', null, { keepHistory: true });
    } finally {
      Sefaria.textTitleForRef = realTitle;
      jest.restoreAllMocks();
    }
  });
});

describe('4. placing a commentary on a whole masechta lets the app answer between steps', () => {
  const { talmudUnits, looseComments, looseCommentsAsync, runStepsAsync } = require('../extras/inferred');
  const L = 'ועוד מילים אחרות כאן לשורה';
  const amudim = [];
  for (let d = 2; d < 40; d++) {
    for (const s of ['a', 'b']) { amudim.push([`${d}${s}`, [`אמר רבי פלוני בדף ${d} ${s} ${L}`, `תנו רבנן בשורה שניה ${d} ${s} ${L}`]]); }
  }
  const units = talmudUnits('Masechet', 'מסכת', amudim);
  const comm = amudim.slice(0, 30).map(([label], i) => ({ path: [`S${i}`], heTitles: [''],
    openings: [`גמ' אמר רבי פלוני בדף ${label.slice(0, -1)} ${label.slice(-1)} כו'`] }));

  test('the same places, in steps', async () => {
    let pauses = 0;
    const got = await looseCommentsAsync(comm, units, {}, () => { pauses += 1; return Promise.resolve(); });
    expect(got).toEqual(looseComments(comm, units));
    expect(got.length).toBe(30);
    expect(pauses).toBeGreaterThanOrEqual(0);
  });

  test('a long run is cut into slices with a pause between', async () => {
    function* slow() { for (let i = 0; i < 40; i++) { const end = Date.now() + 2; while (Date.now() < end) { /* work */ } yield; } return 'done'; }
    let pauses = 0;
    expect(await runStepsAsync(slow(), () => { pauses += 1; return Promise.resolve(); })).toBe('done');
    expect(pauses).toBeGreaterThanOrEqual(4);
  });
});
