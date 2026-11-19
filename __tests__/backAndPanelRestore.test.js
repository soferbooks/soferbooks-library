/**
 * Emulator QA (2026-11-11): Back after "Open here" brought the Niddah panel back stuck on
 * "Loading...", Android's Back left the reader with the "Aa" menu open, and (once seen) taps on a
 * passage did nothing after switching tabs.
 */
import Sefaria from '../sefaria';
import ReaderApp, { settledPanelState, keepLoadedLinkContents } from '../ReaderApp';
import TextList, { reloadPositions } from '../TextList';
import { LinkFilter } from '../Filter';
import { ERRORS } from '../errors';

const tosafotRid = refs => new LinkFilter('Tosafot Rid on Niddah', 'תוספות רי"ד על נדה', 'Tosafot Rid', 'תוספות רי"ד',
  refs, refs, 'Commentary');
const loaded = ref => ({ en: '', he: `text of ${ref}`, sectionRef: ref });

const makeApp = (state, { realLoadRelated = false } = {}) => {
  const app = new ReaderApp({ textLanguage: 'hebrew', dispatch: jest.fn(), showErrorBoundary: jest.fn(),
    theme: {}, themeStr: 'white', biLayout: 'stacked', fontSize: 20, interfaceLanguage: 'english' });
  app.setState = (u, cb) => {
    const part = typeof u === 'function' ? u(app.state, app.props) : u;
    app.state = { ...app.state, ...part };
    if (cb) { cb(); }
  };
  app.forceUpdate = () => {};
  if (!realLoadRelated) { app.loadRelated = jest.fn(); }
  app.state = { ...app.state, footerTab: 'Texts', data: [[{}, {}, {}]], sectionArray: ['Niddah 2a'],
    linksLoaded: [true], linkRecentFilters: [], versionRecentFilters: [], textListFlex: 0.5,
    textListAnimating: false, textListVisible: true, segmentIndexRef: 0, sectionIndexRef: 0,
    segmentRef: 'Niddah 2a:1', menuOpen: null, ...state };
  return app;
};

beforeEach(() => { jest.spyOn(Sefaria.history, 'saveHistoryItem').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); Sefaria.links.reset(); });
// (opening the panel animates on the next frame: let it run before the environment is torn down)
afterAll(() => new Promise(resolve => setTimeout(resolve, 100)));

describe('Back after "Open here": the panel comes back with its text, not "Loading..." for good', () => {
  const refs = ['Tosafot Rid on Niddah 2a:1:1', 'Tosafot Rid on Niddah 2a:1:2'];

  test('the links arriving again keep the list\'s loaded texts', () => {
    const contents = refs.map(loaded);
    const app = makeApp({ connectionsMode: 'filter', filterIndex: 0, linkRecentFilters: [tosafotRid(refs)],
      linkContents: contents });
    const reset = jest.spyOn(Sefaria.links, 'reset');
    // (what refreshSummary -> updateLinkSummary does once the restored page's links load)
    app.updateLinkCat(null, [{ category: 'Commentary', refList: refs, heRefList: refs,
      books: [{ title: 'Tosafot Rid on Niddah', refList: refs, heRefList: refs }] }]);
    expect(app.state.linkContents).toBe(contents);
    expect(app.state.filterIndex).toBe(0);
    expect(reset).not.toHaveBeenCalled();
  });

  test('a list that changed, or was still loading, is loaded afresh as before', () => {
    const app = makeApp({ connectionsMode: 'filter', filterIndex: 0, linkRecentFilters: [tosafotRid(refs)],
      linkContents: [loaded(refs[0]), null] });
    app.updateLinkCat(null, [{ category: 'Commentary', refList: refs, heRefList: refs,
      books: [{ title: 'Tosafot Rid on Niddah', refList: refs, heRefList: refs }] }]);
    expect(app.state.linkContents).toEqual([null, null]);
  });

  test('keepLoadedLinkContents', () => {
    const a = tosafotRid(refs);
    expect(keepLoadedLinkContents(a, tosafotRid([...refs]), refs.map(loaded))).toBe(true);
    expect(keepLoadedLinkContents(a, tosafotRid([...refs]), [loaded(refs[0]), null])).toBe(false);
    expect(keepLoadedLinkContents(a, tosafotRid([refs[0]]), [loaded(refs[0])])).toBe(false);
    expect(keepLoadedLinkContents(a, tosafotRid([refs[1], refs[0]]), refs.map(loaded))).toBe(false);
    expect(keepLoadedLinkContents(undefined, a, refs.map(loaded))).toBe(false);
    expect(keepLoadedLinkContents(tosafotRid([]), tosafotRid([]), [])).toBe(false);
  });

  test('a list emptied again asks again for the sources on screen', () => {
    const filter = tosafotRid(refs);
    const loadContent = jest.fn();
    const props = { recentFilters: [filter], filterIndex: 0, listContents: refs.map(loaded), openRef: jest.fn(),
      loadContent, textLanguage: 'hebrew', themeStr: 'white', fontSize: 20, segmentRef: 'Niddah 2a:1',
      connectionsMode: 'filter' };
    const list = new TextList(props);
    list.setState = () => {};
    list._visibleSegments = [{ item: { ref: refs[0], pos: 0 }, loaded: true }];
    const prevProps = list.props;
    list.props = { ...props, recentFilters: [tosafotRid([...refs])], listContents: [null, null] };
    list.componentDidUpdate(prevProps, list.state);
    expect(loadContent).toHaveBeenCalledTimes(1);
    expect(loadContent.mock.calls[0].slice(0, 2)).toEqual([refs[0], 0]);
    // (a text arriving does not ask again for the ones still on their way)
    loadContent.mockClear();
    const prev2 = list.props;
    list.props = { ...list.props, listContents: [loaded(refs[0]), null] };
    list._visibleSegments = [{ item: { ref: refs[0], pos: 0 } }, { item: { ref: refs[1], pos: 1 } }];
    list.componentDidUpdate(prev2, list.state);
    expect(loadContent).not.toHaveBeenCalled();
  });

  test('another list (a new filter) is left to the FlatList', () => {
    const loadContent = jest.fn();
    const props = { recentFilters: [tosafotRid(refs)], filterIndex: 0, listContents: refs.map(loaded), openRef: jest.fn(),
      loadContent, textLanguage: 'hebrew', themeStr: 'white', fontSize: 20, segmentRef: 'Niddah 2a:1',
      connectionsMode: 'filter' };
    const list = new TextList(props);
    list.setState = () => {};
    list._visibleSegments = [{ item: { ref: refs[0], pos: 0 } }];
    const prevProps = list.props;
    list.props = { ...props, recentFilters: [tosafotRid(['Rashi on Niddah 2a:1:1'])], listContents: [null] };
    list.componentDidUpdate(prevProps, list.state);
    expect(loadContent).not.toHaveBeenCalled();
  });

  test('reloadPositions', () => {
    const A = loaded('a');
    expect(reloadPositions([A, A, A], [null, null, null], [1])).toEqual([1]);
    expect(reloadPositions([A, A, A], [null, null, null], [])).toEqual([0, 1, 2]);
    expect(reloadPositions([A, null], [A, null], [0, 1])).toEqual([]);
    expect(reloadPositions([A, null, A], [A, null, null], [0, 1, 2])).toEqual([2]);
    expect(reloadPositions([null, null], [null, null], [0, 1])).toEqual([0, 1]);  // emptied anew (another array)
    expect(reloadPositions([A], [], [0])).toEqual([]);
  });

  test('a source that fails to load does not leave the rest of the list waiting (bounded concurrency)', async () => {
    Sefaria.links.reset();
    const moreRefs = [
      'Tosafot Rid on Niddah 2a:1:1',
      'Tosafot Rid on Niddah 2a:1:2',
      'Tosafot Rid on Niddah 2a:1:3',
      'Tosafot Rid on Niddah 2a:1:4',
      'Tosafot Rid on Niddah 2a:1:5',
    ];
    const loadText = jest.spyOn(Sefaria.offlineOnline, 'loadText')
      .mockImplementationOnce(() => Promise.reject('network'))
      .mockImplementation(ref => Promise.resolve({ result: loaded(ref) }));
    const done = [];
    const first = Sefaria.links.loadLinkData(moreRefs[0], 0, null, null).catch(e => done.push(['failed', e]));
    const inFlight = [
      Sefaria.links.loadLinkData(moreRefs[1], 1, null, null).then(d => done.push(['loaded', d.sectionRef])),
      Sefaria.links.loadLinkData(moreRefs[2], 2, null, null).then(d => done.push(['loaded', d.sectionRef])),
      Sefaria.links.loadLinkData(moreRefs[3], 3, null, null).then(d => done.push(['loaded', d.sectionRef])),
    ];
    const fifth = Sefaria.links.loadLinkData(moreRefs[4], 4, d => done.push(['loaded', d.sectionRef]), e => done.push(['rejected', e]))
      .catch(e => e);
    expect(await fifth).toBe('inQueue');  // queued once 4 concurrent loads are in flight
    await Promise.all([first, ...inFlight]);
    await new Promise(r => setTimeout(r, 0));
    expect(done).toContainEqual(['failed', 'network']);
    expect(done).toContainEqual(['loaded', moreRefs[4]]);
    expect(loadText).toHaveBeenCalledTimes(5);
    expect(Sefaria.links._linkContentLoadingStack).toHaveLength(0);
  });

  test('tapping a passage while links are still loading sets loadingLinks, loads them, and populates commentaries on first tap', async () => {
    const app = makeApp({
      data: [[{ segmentNumber: '1' }, { segmentNumber: '2' }, { segmentNumber: '3' }]],
      textListVisible: false,
      linksLoaded: [false],
      loadingLinks: false,
    }, { realLoadRelated: true });
    app.animateTextList = jest.fn();
    app.updateVersionCat = jest.fn();
    app._getTranslationForSegment = () => null;
    jest.spyOn(Sefaria, 'cacheCommentatorListBySection').mockImplementation(() => {});
    const savedIndex = Sefaria._index;
    const savedBooksDict = Sefaria.booksDict;
    Sefaria._index = { ...savedIndex, Niddah: { title: 'Niddah', heTitle: 'נדה' }, 'Rashi on Niddah': { title: 'Rashi on Niddah', heTitle: 'רש"י על נדה', categories: ['Talmud', 'Bavli', 'Rishonim on Talmud'] } };
    Sefaria.booksDict = { ...savedBooksDict, 'Rashi on Niddah': 1 };
    let resolveLinks;
    jest.spyOn(Sefaria.offlineOnline, 'loadRelated').mockImplementation(() => new Promise(r => { resolveLinks = r; }));
    try {
      app.textSegmentPressed(0, 0, 'Niddah 2a:1', true);
      expect(app.state.textListVisible).toBe(true);
      expect(app.state.loadingLinks).toBe(true);
      expect(Sefaria.offlineOnline.loadRelated).toHaveBeenCalledWith('Niddah 2a', false);
      resolveLinks({ links: [{ category: 'Commentary', index_title: 'Rashi on Niddah', sourceRef: 'Rashi on Niddah 2a:1:1', sourceHeRef: 'רש"י', anchorRef: 'Niddah 2a:1', sourceHasEn: false }] });
      await new Promise(r => setTimeout(r, 0));
      expect(app.state.loadingLinks).toBe(false);
      expect(app.state.linksLoaded[0]).toBe(true);
      expect(app.state.linkSummary.some(c => c.category === 'Commentary' && c.count > 0)).toBe(true);
    } finally {
      Sefaria._index = savedIndex;
      Sefaria.booksDict = savedBooksDict;
    }
  });

  test('prepending a previous section while links are in flight does not drop the links or break summary refresh', async () => {
    const app = makeApp({
      data: [[{ segmentNumber: '1' }, { segmentNumber: '2' }, { segmentNumber: '3' }]],
      sectionArray: ['Niddah 2b'],
      sectionIndexRef: 0,
      segmentIndexRef: 1,
      segmentRef: 'Niddah 2b:2',
      linksLoaded: [false],
      loadingLinks: true,
    }, { realLoadRelated: true });
    jest.spyOn(Sefaria, 'cacheCommentatorListBySection').mockImplementation(() => {});
    const savedIndex = Sefaria._index;
    const savedBooksDict = Sefaria.booksDict;
    Sefaria._index = { ...savedIndex, Niddah: { title: 'Niddah', heTitle: 'נדה' }, 'Rashi on Niddah': { title: 'Rashi on Niddah', heTitle: 'רש"י על נדה', categories: ['Talmud', 'Bavli', 'Rishonim on Talmud'] } };
    Sefaria.booksDict = { ...savedBooksDict, 'Rashi on Niddah': 1 };
    let resolveLinks;
    jest.spyOn(Sefaria.offlineOnline, 'loadRelated').mockImplementation(() => new Promise(r => { resolveLinks = r; }));
    try {
      const promise = app._loadRelatedOnlineAndOffline('Niddah 2b', false, true);
      // simulate updateDataPrev prepending Niddah 2a while Niddah 2b links are still in flight
      app.setState(prev => ({
        data: [[{ segmentNumber: '1' }, { segmentNumber: '2' }], ...prev.data],
        sectionArray: ['Niddah 2a', ...prev.sectionArray],
        sectionIndexRef: prev.sectionIndexRef + 1,
        linksLoaded: [false, ...prev.linksLoaded],
      }));
      resolveLinks({ links: [{ category: 'Commentary', index_title: 'Rashi on Niddah', sourceRef: 'Rashi on Niddah 2b:2:1', sourceHeRef: 'רש"י', anchorRef: 'Niddah 2b:2', sourceHasEn: false }] });
      await promise;
      expect(app.state.linksLoaded).toEqual([false, true]);
      expect(app.state.relatedBySectionRef['Niddah 2b']).toBeDefined();
      expect(app.state.loadingLinks).toBe(false);
      expect(app.state.linkSummary.some(c => c.category === 'Commentary' && c.count > 0)).toBe(true);
    } finally {
      Sefaria._index = savedIndex;
      Sefaria.booksDict = savedBooksDict;
    }
  });

  test('concurrent section link loads keep both sections in relatedBySectionRef', async () => {
    const app = makeApp({
      data: [[{ segmentNumber: '1' }], [{ segmentNumber: '1' }]],
      sectionArray: ['Niddah 2a', 'Niddah 2b'],
      sectionIndexRef: 0,
      segmentIndexRef: 0,
      segmentRef: 'Niddah 2a:1',
      linksLoaded: [false, false],
    }, { realLoadRelated: true });
    jest.spyOn(Sefaria, 'cacheCommentatorListBySection').mockImplementation(() => {});
    jest.spyOn(Sefaria.offlineOnline, 'loadRelated').mockImplementation(ref =>
      Promise.resolve({ links: [{ category: 'Commentary', index_title: 'Rashi on Niddah', sourceRef: `Rashi on ${ref}:1:1`, sourceHeRef: 'רש"י', anchorRef: `${ref}:1`, sourceHasEn: false }] })
    );
    await Promise.all([
      app._loadRelatedOnlineAndOffline('Niddah 2a', false, true),
      app._loadRelatedOnlineAndOffline('Niddah 2b', false, true),
    ]);
    expect(app.state.linksLoaded).toEqual([true, true]);
    expect(app.state.relatedBySectionRef['Niddah 2a']).toBeDefined();
    expect(app.state.relatedBySectionRef['Niddah 2b']).toBeDefined();
  });

  test('a book not downloaded: its links are read online without a "Related load error" warning', async () => {
    const app = makeApp({}, { realLoadRelated: true });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const calls = [];
    app._loadRelatedOnlineAndOffline = jest.fn((ref, isSheet, online) => {
      calls.push(online);
      return online ? Promise.resolve() : Promise.reject(ERRORS.MISSING_OFFLINE_DATA);
    });
    await app.loadRelated('Niddah 2a');
    expect(calls).toEqual([false, true]);
    expect(warn).not.toHaveBeenCalled();
    expect(app.state.linksLoaded).toEqual([true]);
  });
});

describe("Android's Back closes the open \"Aa\" menu first", () => {
  test('with the menu open, Back closes it and stays in the reader', () => {
    const app = makeApp({ ReaderDisplayOptionsMenuVisible: true });
    app.manageBack = jest.fn(() => true);
    app._readerDisplayOptionsMenuRef = { hide: cb => cb() };
    expect(app.onHardwareBack()).toBe(true);
    expect(app.state.ReaderDisplayOptionsMenuVisible).toBe(false);
    expect(app.manageBack).not.toHaveBeenCalled();
  });

  test('with no menu open, Back goes back as before', () => {
    const app = makeApp({ ReaderDisplayOptionsMenuVisible: false });
    app.manageBack = jest.fn(() => false);
    expect(app.onHardwareBack()).toBe(false);
    expect(app.manageBack).toHaveBeenCalledTimes(1);
  });

  test('the menu closes even when its view is not mounted', () => {
    const app = makeApp({ ReaderDisplayOptionsMenuVisible: true });
    app._readerDisplayOptionsMenuRef = null;
    app.closeReaderDisplayOptionsMenu();
    expect(app.state.ReaderDisplayOptionsMenuVisible).toBe(false);
  });
});

describe('a panel saved while it was closing comes back closed', () => {
  test('settledPanelState', () => {
    expect(settledPanelState({ textListVisible: true, textListFlex: 0.0001 })).toEqual({ textListVisible: false, textListFlex: 0.0001 });
    expect(settledPanelState({ textListVisible: true, textListFlex: 0.5 })).toEqual({});
    expect(settledPanelState({ textListVisible: false, textListFlex: 0.0001 })).toEqual({});
    expect(settledPanelState({ textListVisible: true })).toEqual({});
  });

  test('Back to such a page: one tap on a passage opens the panel', () => {
    const app = makeApp({ textListVisible: false });
    app.animateTextList = jest.fn();
    app.updateLinkSummary = jest.fn();
    app.updateVersionCat = jest.fn();
    app._getTranslationForSegment = () => null;
    app._applyPreviousState({ menuOpen: null, textListVisible: true, textListFlex: 0.0001, textListAnimating: true,
      segmentRef: 'Niddah 2a:1', segmentIndexRef: 0, sectionIndexRef: 0, sectionArray: ['Niddah 2a'],
      data: [[{}, {}, {}]], linksLoaded: [true], linkRecentFilters: [], versionRecentFilters: [] });
    expect(app.state.textListVisible).toBe(false);
    app.textSegmentPressed(0, 0, 'Niddah 2a:1', true);
    expect(app.state.textListVisible).toBe(true);
  });
});
