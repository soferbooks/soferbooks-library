/**
 * Owner, 2026-11-12: the reader's top-left Back button "makes me lose my spot" - it stepped back
 * through the reading history (or left the reader). It is a Home button now: the home page opens
 * and the tab stays exactly where it was. Android's Back still goes back through the history,
 * but a tab returned to is shown where it is now, never at an older place.
 * And pinned tabs are marked by a thin gold bar along the top of the tab (choice "B"), no 📌.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import Sefaria from '../sefaria';
import ReaderApp from '../ReaderApp';
import ReaderControls from '../ReaderControls';
import ReaderAppContext from '../context';
import ReaderTabBar from '../tabs/ReaderTabBar';
import OpenTabsStrip from '../tabs/OpenTabsStrip';
import TestContextWrapper from '../TestContextWrapper';
import strings from '../LocalizedStrings';
import { BRAND_GOLD } from '../Styles';
import { emptyTabsState, openTab, switchTab, updateTabPlace, findTab, closeTab } from '../tabs/tabState';
import * as extras from '../extras';

const READER = { menuOpen: null, loaded: true, sheet: null, data: [[{}, {}, {}]], linksLoaded: [true],
  linkRecentFilters: [], versionRecentFilters: [], segmentIndexRef: 0, sectionIndexRef: 0,
  textListVisible: false, connectionsMode: null };
const genesisAt = seg => ({ ...READER, textTitle: 'Genesis', textReference: 'Genesis 1', sectionArray: ['Genesis 1'],
  segmentRef: seg, offsetRef: null });

const makeApp = () => {
  const app = new ReaderApp({ textLanguage: 'hebrew', dispatch: jest.fn(), showErrorBoundary: jest.fn(),
    theme: {}, themeStr: 'white', biLayout: 'stacked', fontSize: 20, interfaceLanguage: 'english' });
  app.setState = (u, cb) => {
    const part = typeof u === 'function' ? u(app.state, app.props) : u;
    if (part) { app.state = { ...app.state, ...part }; }
    if (cb) { cb(); }
  };
  app.forceUpdate = () => {};
  app.loadRelated = jest.fn();
  app.clearAllSearchFilters = jest.fn();
  let tabs = openTab(emptyTabsState(), { title: 'Genesis', ref: 'Genesis 1', segmentRef: 'Genesis 1:3' }, { now: 1, id: 'A' });
  tabs = openTab(tabs, { title: 'Exodus', ref: 'Exodus 1' }, { now: 2, id: 'B' });
  tabs = switchTab(tabs, 'A', 3);
  app.state = { ...app.state, footerTab: 'Texts', readerTabs: tabs, ...genesisAt('Genesis 1:3') };
  return app;
};
// what TextColumn reports as the reader scrolls (and componentDidUpdate records on the tab)
const readTo = (app, seg) => {
  app.setState({ segmentRef: seg });
  app.setState({ readerTabs: updateTabPlace(app.state.readerTabs, app.state.readerTabs.activeTabId, { segmentRef: seg }) });
};

beforeEach(() => {
  jest.spyOn(Sefaria.history, 'saveHistoryItem').mockImplementation(() => {});
  jest.spyOn(extras, 'needsDownload').mockReturnValue(false);
});
afterEach(() => { jest.restoreAllMocks(); Sefaria.links.reset(); });

describe("the reader's top button is Home", () => {
  test('a button a screen reader calls "Home"; tapping it calls goHome (no Back there)', () => {
    const goHome = jest.fn();
    let inst;
    act(() => {
      inst = renderer.create(<TestContextWrapper child={ReaderControls} childProps={{
        enRef: 'Genesis 1:1', heRef: 'בראשית א׳:א׳', categories: ['Tanakh', 'Torah'], openTextToc: jest.fn(), goHome,
        toggleReaderDisplayOptionsMenu: jest.fn(), openUri: jest.fn(), sheet: null,
        getHistoryObject: () => ({ ref: 'Genesis 1:1', versions: {} }), showToast: jest.fn(),
      }} />);
    });
    const home = inst.root.findAll(n => n.props.accessibilityLabel === strings.nav.home && n.props.onPress);
    expect(home.length).toBeGreaterThan(0);
    expect(inst.root.findAll(n => n.props.accessibilityLabel === strings.common.back)).toHaveLength(0);
    act(() => { home[0].props.onPress(); });
    expect(goHome).toHaveBeenCalledTimes(1);
    act(() => { inst.unmount(); });
  });

  test('Home opens the home page and keeps the tab exactly where it was', () => {
    const app = makeApp();
    readTo(app, 'Genesis 1:7');
    app.goHomeFromReader();
    expect(app.state.menuOpen).toBe('navigation');
    expect(findTab(app.state.readerTabs, 'A').segmentRef).toBe('Genesis 1:7');
    expect(app.state.readerTabs.activeTabId).toBe('A');
    // back to the tab from the home page: at its place
    app.openReaderTabFromHome('A');
    expect(app.state.menuOpen).toBe(null);
    expect(app.state.textTitle).toBe('Genesis');
    expect(app.state.segmentRef).toBe('Genesis 1:7');
    expect(app.state.offsetRef).toBe('Genesis 1:7');
  });
});

describe('to the pixel: the passage is put back where it was on screen', () => {
  test('Home and back to the tab: the place on screen goes with it', () => {
    const app = makeApp();
    readTo(app, 'Genesis 1:7');
    app._getTextColumnRef({ getScrollPlace: () => ({ ref: 'Genesis 1:7', inset: -640 }) });  // deep in its commentary
    app.goHomeFromReader();
    app._getTextColumnRef(null);
    app.openReaderTabFromHome('A');
    expect(app.state.offsetRef).toBe('Genesis 1:7');
    expect(app.state.offsetPlace).toEqual({ ref: 'Genesis 1:7', inset: -640 });
  });

  test('Back to a page of the reader: the same', () => {
    const app = makeApp();
    readTo(app, 'Genesis 1:5');
    app._getTextColumnRef({ getScrollPlace: () => ({ ref: 'Genesis 1:5', inset: 37 }) });
    app.modifyHistory({ dir: 'forward', state: app.state });
    app.setState({ ...READER, textTitle: 'Rashi on Genesis', textReference: 'Rashi on Genesis 1:1',
      sectionArray: ['Rashi on Genesis 1:1'], segmentRef: 'Rashi on Genesis 1:1:1' });
    app.manageBack();
    expect(app.state.offsetRef).toBe('Genesis 1:5');
    expect(app.state.offsetPlace).toEqual({ ref: 'Genesis 1:5', inset: 37 });
    expect(app.state.scrollPlace).toBeUndefined();
  });

  test("a place that is not the reader's passage is not used", () => {
    const app = makeApp();
    app._getTextColumnRef({ getScrollPlace: () => ({ ref: 'Genesis 1:9', inset: 10 }) });
    expect(app._currentScrollPlace()).toBe(null);
  });
});

describe("Android's Back never puts a tab back at an older place", () => {
  test('home -> the tab -> read on -> home: Back shows the tab where it is now', () => {
    const app = makeApp();
    app.goHomeFromReader();                       // history: the reader at 1:3
    app.openReaderTabFromHome('A');               // history: + home
    readTo(app, 'Genesis 1:20');
    app.goHomeFromReader();                       // history: + the reader at 1:20
    app.manageBack();                             // -> the tab
    expect(app.state.menuOpen).toBe(null);
    expect(app.state.segmentRef).toBe('Genesis 1:20');
    app.manageBack();                             // -> home
    expect(app.state.menuOpen).toBe('navigation');
    app.manageBack();                             // -> the reader as left first (1:3): now at 1:20
    expect(app.state.menuOpen).toBe(null);
    expect(app.state.textTitle).toBe('Genesis');
    expect(app.state.segmentRef).toBe('Genesis 1:20');
    expect(app.state.offsetRef).toBe('Genesis 1:20');
    expect(findTab(app.state.readerTabs, 'A').segmentRef).toBe('Genesis 1:20');
  });

  test('Back after following a link in the tab ("Open here") returns to the previous text, at its place', () => {
    const app = makeApp();
    readTo(app, 'Genesis 1:5');
    app.modifyHistory({ dir: 'forward', state: app.state });   // (what openRef does before "Open here")
    app.setState({ ...READER, textTitle: 'Rashi on Genesis', textReference: 'Rashi on Genesis 1:1',
      sectionArray: ['Rashi on Genesis 1:1'], segmentRef: 'Rashi on Genesis 1:1:1' });
    app.setState({ readerTabs: updateTabPlace(app.state.readerTabs, 'A', { title: 'Rashi on Genesis', ref: 'Rashi on Genesis 1:1' }) });
    app.manageBack();
    expect(app.state.menuOpen).toBe(null);
    expect(app.state.textTitle).toBe('Genesis');
    expect(app.state.offsetRef).toBe('Genesis 1:5');
    expect(app.state.readerTabs.activeTabId).toBe('A');
  });

  test("an earlier text of another tab is shown in that tab, not in the tab showing now", () => {
    const app = makeApp();
    app.modifyHistory({ dir: 'forward', state: app.state });   // Genesis 1:3 in tab A, then a link followed in A
    app.setState({ ...READER, textTitle: 'Rashi on Genesis', textReference: 'Rashi on Genesis 1:1',
      sectionArray: ['Rashi on Genesis 1:1'], segmentRef: 'Rashi on Genesis 1:1:1' });
    app.setState({ readerTabs: updateTabPlace(app.state.readerTabs, 'A', { title: 'Rashi on Genesis', ref: 'Rashi on Genesis 1:1' }) });
    // tab B is made active from elsewhere, keeping the history (as from the home page)
    app.setState({ menuOpen: 'navigation', readerTabs: switchTab(app.state.readerTabs, 'B', 10) });
    app.manageBack();
    expect(app.state.readerTabs.activeTabId).toBe('A');
    expect(app.state.textTitle).toBe('Genesis');
    expect(findTab(app.state.readerTabs, 'B').ref).toBe('Exodus 1');
  });

  test('a page of a tab that has since been closed is passed over', () => {
    const app = makeApp();
    app.goHomeFromReader();                                      // history: tab A's reader
    app.setState({ readerTabs: closeTab(app.state.readerTabs, 'A') });
    expect(app.manageBack()).toBe(false);                        // nothing else behind it: as on home before
    expect(app.state.textTitle).toBe('Genesis');                 // (no text put into tab B)
    expect(findTab(app.state.readerTabs, 'B').ref).toBe('Exodus 1');
  });
});

describe('a pinned tab is marked by a gold bar along its top', () => {
  const tabs = [
    { id: 'p', title: 'Genesis', ref: 'Genesis 1', pinned: true },
    { id: 'a', title: 'Exodus', ref: 'Exodus 1' },
  ];
  const noop = () => {};
  const bars = inst => inst.root.findAll(n => n.props.testID === 'pinned-tab-bar' && typeof n.type === 'string');
  const allText = inst => inst.root.findAllByType(Text).map(t => [].concat(t.props.children).join('')).join('|');

  test('in the tab bar: one bar, on the pinned tab, labelled "Pinned tab"; no pin emoji', () => {
    let inst;
    act(() => {
      inst = renderer.create(<TestContextWrapper child={ReaderTabBar} childProps={{
        tabs, activeTabId: 'a', archived: [], onSelect: noop, onClose: noop, onCloseOthers: noop, onNewTab: noop,
        onRestoreArchived: noop, onRemoveArchived: noop, onClearArchived: noop,
      }} />);
    });
    const found = bars(inst);
    expect(found).toHaveLength(1);
    const style = StyleSheet.flatten(found[0].props.style);
    expect(style).toMatchObject({ position: 'absolute', top: 0, height: 3, backgroundColor: BRAND_GOLD });
    expect(found[0].props.accessibilityLabel).toBe(strings.tabs.pinned_tab);
    expect(allText(inst)).not.toContain('📌');
    // the chip's top edge is the bar: square corners there
    const chip = inst.root.findAll(n => n.props.accessibilityRole === 'tab' && n.props.onLongPress)[0];
    expect(StyleSheet.flatten(chip.props.style)).toMatchObject({ borderTopWidth: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 });
    act(() => { inst.unmount(); });
  });

  test("on the home page's Open Tabs cards too", () => {
    let inst;
    act(() => {
      inst = renderer.create(
        <ReaderAppContext.Provider value={{ readerTabs: { tabs, activeTabId: 'a', archived: [] }, openReaderTab: jest.fn() }}>
          <TestContextWrapper child={OpenTabsStrip} childProps={{}} />
        </ReaderAppContext.Provider>);
    });
    expect(bars(inst)).toHaveLength(1);
    expect(allText(inst)).not.toContain('📌');
    act(() => { inst.unmount(); });
  });
});
