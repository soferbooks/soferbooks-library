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

  test('a source that fails to load does not leave the rest of the list waiting', async () => {
    Sefaria.links.reset();
    const loadText = jest.spyOn(Sefaria.offlineOnline, 'loadText')
      .mockImplementationOnce(() => Promise.reject('network'))
      .mockImplementation(ref => Promise.resolve({ result: loaded(ref) }));
    const done = [];
    const first = Sefaria.links.loadLinkData(refs[0], 0, null, null).catch(e => done.push(['failed', e]));
    const second = Sefaria.links.loadLinkData(refs[1], 1, d => done.push(['loaded', d.sectionRef]), e => done.push(['rejected', e]))
      .catch(e => e);
    expect(await second).toBe('inQueue');  // queued behind the first
    await first;
    await new Promise(r => setTimeout(r, 0));
    expect(done).toContainEqual(['failed', 'network']);
    expect(done).toContainEqual(['loaded', refs[1]]);
    expect(loadText).toHaveBeenCalledTimes(2);
    expect(Sefaria.links._linkContentLoadingStack).toHaveLength(0);
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
