import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import {
  MAX_OPEN_TABS,
  MAX_PINNED_TABS,
  emptyTabsState,
  openTab,
  switchTab,
  updateTabPlace,
  closeTab,
  closeOtherTabs,
  pinTab,
  unpinTab,
  canPinTab,
  isPinned,
  restoreArchivedTab,
  resolveTabShortcut,
  serializeTabs,
  deserializeTabs,
  tabResumeRef,
} from '../tabs/tabState';
import { loadTabs, saveTabs } from '../tabs/tabStorage';
import {
  tabShortcutUrl, parseTabShortcutUrl, shortcutIdForTab, addTabShortcut, canAddTabShortcut,
} from '../tabs/tabShortcuts';
import { tabLabel, tabMenuOptions, closeWithCare } from '../tabs/ReaderTabBar';
import DeepLinkRouter from '../DeepLinkRouter';
import ReaderApp from '../ReaderApp';
import Sefaria from '../sefaria';
import strings from '../LocalizedStrings';
import { Alert } from 'react-native';

const place = (title, ref, extra = {}) => ({ title, ref, ...extra });

// open n tabs "Book 1".."Book n", tab i opened (and last used) at time i
const openN = (n, state = emptyTabsState()) => {
  for (let i = 1; i <= n; i++) {
    state = openTab(state, place(`Book ${i}`, `Book ${i} 1`), { now: i, id: `id${i}` });
  }
  return state;
};
const ids = s => s.tabs.map(t => t.id);

describe('pinned tabs', () => {
  test('pinning moves a tab to the front, after the tabs already pinned; unpinning puts it after them', () => {
    let s = openN(4);
    s = pinTab(s, 'id3');
    expect(ids(s)).toEqual(['id3', 'id1', 'id2', 'id4']);
    s = pinTab(s, 'id4');
    expect(ids(s)).toEqual(['id3', 'id4', 'id1', 'id2']);
    expect(isPinned(s.tabs[0]) && isPinned(s.tabs[1])).toBe(true);
    expect(pinTab(s, 'id3')).toBe(s);           // already pinned
    expect(pinTab(s, 'nope')).toBe(s);
    s = unpinTab(s, 'id3', 100);
    expect(ids(s)).toEqual(['id4', 'id3', 'id1', 'id2']);
    expect(isPinned(s.tabs[1])).toBe(false);
    expect(unpinTab(s, 'id1')).toBe(s);         // not pinned
  });

  test('a new tab is never put among the pinned tabs', () => {
    let s = openN(3);
    s = pinTab(s, 'id1');
    s = pinTab(s, 'id2');
    s = switchTab(s, 'id1', 10);                // the active tab is pinned
    s = openTab(s, place('Exodus', 'Exodus 1'), { now: 11, id: 'new' });
    expect(ids(s)).toEqual(['id1', 'id2', 'new', 'id3']);
  });

  test('pinned tabs are never archived and do not count toward the open-tab limit', () => {
    let s = openN(3);
    s = pinTab(s, 'id1');
    s = pinTab(s, 'id2');                       // the two least recently used tabs are pinned
    for (let i = 4; i <= MAX_OPEN_TABS + 5; i++) {
      s = openTab(s, place(`Book ${i}`, `Book ${i} 1`), { now: i, id: `id${i}` });
    }
    expect(s.tabs.filter(t => !isPinned(t))).toHaveLength(MAX_OPEN_TABS);
    expect(s.tabs).toHaveLength(MAX_OPEN_TABS + 2);
    expect(ids(s).slice(0, 2)).toEqual(['id1', 'id2']);
    expect(s.archived.map(a => a.id)).not.toContain('id1');
    expect(s.archived.map(a => a.id)).not.toContain('id2');
    expect(s.archived.map(a => a.id)).toEqual(['id5', 'id4', 'id3']);
  });

  test('unpinning a tab over the limit archives the least recently used unpinned tab', () => {
    let s = pinTab(openN(MAX_OPEN_TABS), 'id1');
    s = openTab(s, place('Exodus', 'Exodus 1'), { now: 50, id: 'id11' });  // 10 unpinned: nothing archived
    expect(s.archived).toEqual([]);
    s = unpinTab(s, 'id1', 100);
    expect(s.tabs).toHaveLength(MAX_OPEN_TABS);
    expect(s.archived.map(a => a.id)).toEqual(['id1']);
  });

  test(`at most ${MAX_PINNED_TABS} tabs can be pinned`, () => {
    let s = emptyTabsState();
    for (let i = 1; i <= MAX_PINNED_TABS + 1; i++) {
      s = openTab(s, place(`Book ${i}`, `Book ${i} 1`), { now: i, id: `id${i}` });
      if (i <= MAX_PINNED_TABS) { s = pinTab(s, `id${i}`); }
    }
    expect(s.tabs.filter(isPinned)).toHaveLength(MAX_PINNED_TABS);
    expect(canPinTab(s)).toBe(false);
    expect(pinTab(s, `id${MAX_PINNED_TABS + 1}`)).toBe(s);
  });

  test('"Close other tabs" keeps the pinned tabs', () => {
    let s = openN(4);
    s = pinTab(s, 'id1');
    s = closeOtherTabs(s, 'id3', 50);
    expect(ids(s)).toEqual(['id1', 'id3']);
    expect(s.activeTabId).toBe('id3');
    expect(s.recentlyClosed.map(c => c.id)).toEqual(['id4', 'id2']);
  });

  test('a closed pinned tab goes to Recently closed unpinned', () => {
    let s = pinTab(openN(2), 'id1');
    s = closeTab(s, 'id1', 9);
    expect(s.recentlyClosed[0]).toMatchObject({ id: 'id1', ref: 'Book 1 1' });
    expect(s.recentlyClosed[0].pinned).toBeUndefined();
  });

  test('a place update keeps the pin, and its ref is where the tab reopens', () => {
    let s = pinTab(openN(2), 'id1');
    s = updateTabPlace(s, 'id1', { ref: 'Book 1 7', segmentRef: 'Book 1 7:4', pinned: false });
    expect(isPinned(s.tabs[0])).toBe(true);     // pinned is not a place field
    expect(tabResumeRef(s.tabs[0])).toBe('Book 1 7:4');
  });
});

describe('pinned tabs survive a restart', () => {
  beforeEach(() => AsyncStorage.clear());

  test('pinned flag, order and latest place come back from storage', async () => {
    let s = openN(3);
    s = pinTab(s, 'id2');
    s = updateTabPlace(s, 'id2', { ref: 'Book 2 9', segmentRef: 'Book 2 9:3' });
    await saveTabs(s);
    const back = await loadTabs();
    expect(ids(back)).toEqual(['id2', 'id1', 'id3']);
    expect(isPinned(back.tabs[0])).toBe(true);
    expect(tabResumeRef(back.tabs[0])).toBe('Book 2 9:3');
  });

  test('a saved list with a pinned tab out of place is put back in order; pinned tabs are not archived on load', () => {
    const tabs = [];
    for (let i = 1; i <= MAX_OPEN_TABS + 1; i++) { tabs.push({ id: `id${i}`, title: `B${i}`, ref: `B${i} 1`, lastUsed: i }); }
    tabs[MAX_OPEN_TABS].lastUsed = 0;
    tabs[MAX_OPEN_TABS].pinned = true;          // least recently used, and pinned
    const back = deserializeTabs(JSON.stringify({ tabs, activeTabId: 'id1', archived: [] }), 100);
    expect(back.tabs[0].id).toBe(`id${MAX_OPEN_TABS + 1}`);
    expect(back.tabs).toHaveLength(MAX_OPEN_TABS + 1);
    expect(back.archived).toEqual([]);
  });
});

describe('home-screen shortcut links', () => {
  test('a shortcut link carries the tab id and book title, and reads back', () => {
    const url = tabShortcutUrl('tk3x9', 'Shulchan Arukh, Orach Chayim');
    expect(url).toBe('soferbooks://tab/tk3x9?title=Shulchan%20Arukh%2C%20Orach%20Chayim');
    expect(parseTabShortcutUrl(url)).toEqual({ tabId: 'tk3x9', title: 'Shulchan Arukh, Orach Chayim' });
    expect(parseTabShortcutUrl(tabShortcutUrl('a1', 'חבור יפה מהישועה'))).toEqual({ tabId: 'a1', title: 'חבור יפה מהישועה' });
    expect(parseTabShortcutUrl('soferbooks://tab/a1')).toEqual({ tabId: 'a1', title: null });
    expect(parseTabShortcutUrl('https://www.sefaria.org/Genesis.1')).toBeNull();
    expect(parseTabShortcutUrl('soferbooks://tab/')).toBeNull();
    expect(parseTabShortcutUrl(null)).toBeNull();
    expect(shortcutIdForTab('a1')).toBe('tab-a1');
  });

  test('DeepLinkRouter sends a shortcut link to openTabShortcut, never to the browser', () => {
    const props = {
      openNav: jest.fn(), openMenu: jest.fn(), openRef: jest.fn(), openUri: jest.fn(),
      openTextTocDirectly: jest.fn(), openSearch: jest.fn(), setSearchOptions: jest.fn(),
      setTextLanguage: jest.fn(), setNavigationCategories: jest.fn(), openTabShortcut: jest.fn(),
    };
    const router = new DeepLinkRouter(props);
    router.route(tabShortcutUrl('t1', 'Niddah'), true);
    expect(props.openTabShortcut).toHaveBeenCalledWith({ tabId: 't1', title: 'Niddah' });
    expect(props.openUri).not.toHaveBeenCalled();
    expect(props.openRef).not.toHaveBeenCalled();
  });
});

describe('a shortcut opens its tab at the latest place read in it', () => {
  const lastRead = refs => title => refs[title] || null;

  test('an open tab: that tab (it reopens at its latest place)', () => {
    let s = pinTab(openN(3), 'id2');
    s = updateTabPlace(s, 'id2', { ref: 'Book 2 40', segmentRef: 'Book 2 40:2' });
    expect(resolveTabShortcut(s, 'id2', 'Book 2', lastRead({}))).toEqual({ kind: 'tab', id: 'id2' });
  });

  test('an archived tab (unpinned since): reopened from the archive', () => {
    let s = openN(MAX_OPEN_TABS + 1);           // id1 archived
    expect(resolveTabShortcut(s, 'id1', 'Book 1')).toEqual({ kind: 'archived', id: 'id1' });
    s = restoreArchivedTab(s, 'id1', 200);
    expect(resolveTabShortcut(s, 'id1', 'Book 1')).toEqual({ kind: 'tab', id: 'id1' });
  });

  test("a closed tab: the book's last-read place, else where the tab was closed", () => {
    let s = updateTabPlace(openN(2), 'id1', { ref: 'Book 1 5', segmentRef: 'Book 1 5:6' });
    s = closeTab(s, 'id1', 50);
    expect(resolveTabShortcut(s, 'id1', 'Book 1', lastRead({ 'Book 1': 'Book 1 12:1' })))
      .toEqual({ kind: 'ref', ref: 'Book 1 12:1', title: 'Book 1' });
    expect(resolveTabShortcut(s, 'id1', 'Book 1', lastRead({})))
      .toEqual({ kind: 'ref', ref: 'Book 1 5:6', title: 'Book 1' });
  });

  test("a tab no longer known: the book's last-read place, else the book's start", () => {
    const s = openN(1);
    expect(resolveTabShortcut(s, 'gone', 'Niddah', lastRead({ Niddah: 'Niddah 13a:4' })))
      .toEqual({ kind: 'ref', ref: 'Niddah 13a:4', title: 'Niddah' });
    expect(resolveTabShortcut(s, 'gone', 'Niddah', lastRead({}))).toEqual({ kind: 'book', title: 'Niddah' });
    expect(resolveTabShortcut(s, 'gone', null)).toEqual({ kind: 'none' });
    expect(resolveTabShortcut(s, 'gone', 'Niddah', () => { throw new Error('history'); })).toEqual({ kind: 'book', title: 'Niddah' });
  });

  describe('ReaderApp.openTabShortcut', () => {
    const makeApp = readerTabs => {
      const app = new ReaderApp({ dispatch: () => {}, showErrorBoundary: () => {}, theme: {}, themeStr: 'white', biLayout: 'stacked', textLanguage: 'hebrew' });
      app.state = { ...app.state, readerTabs };
      app.switchToTab = jest.fn(() => Promise.resolve());
      app.restoreArchivedReaderTab = jest.fn();
      app.openRefInNewTab = jest.fn(() => Promise.resolve());
      app.openTextTocDirectly = jest.fn();
      app.openNav = jest.fn();
      return app;
    };
    let historySpy;
    beforeEach(() => { historySpy = jest.spyOn(Sefaria.history, 'getHistoryRefForTitle').mockReturnValue(null); });
    afterEach(() => historySpy.mockRestore());

    test('shows the open tab (no fixed ref: it opens where the tab is now)', () => {
      const app = makeApp(pinTab(openN(2), 'id1'));
      app.openTabShortcut({ tabId: 'id1', title: 'Book 1' });
      expect(app.switchToTab).toHaveBeenCalledWith('id1');
    });

    test("a closed tab opens the book's last-read place in a new tab", () => {
      historySpy.mockReturnValue({ ref: 'Book 9 3:2' });
      const app = makeApp(openN(2));
      app.openTabShortcut({ tabId: 'gone', title: 'Book 9' });
      expect(app.openRefInNewTab).toHaveBeenCalledWith('Book 9 3:2');
    });

    test("the book's own tab is reused for its last-read place", () => {
      historySpy.mockReturnValue({ ref: 'Book 2 8:1' });
      const app = makeApp(openN(2));
      app.openTabShortcut({ tabId: 'gone', title: 'Book 2' });
      expect(app.switchToTab).toHaveBeenCalledWith('id2', { ref: 'Book 2 8:1' });
    });

    test("nothing read in the book: its contents page; no book: home", () => {
      const app = makeApp(openN(1));
      app.openTabShortcut({ tabId: 'gone', title: 'Niddah' });
      expect(app.openTextTocDirectly).toHaveBeenCalledWith('Niddah');
      app.openTabShortcut({ tabId: 'gone' });
      expect(app.openNav).toHaveBeenCalled();
    });
  });
});

describe('the native shortcut module', () => {
  const realOS = Platform.OS;
  afterEach(() => { Platform.OS = realOS; delete NativeModules.PinnedShortcuts; });

  test('asks Android for a pinned shortcut that carries the tab id', async () => {
    Platform.OS = 'android';
    NativeModules.PinnedShortcuts = { isSupported: jest.fn(async () => true), requestPin: jest.fn(async () => true) };
    expect(await canAddTabShortcut()).toBe(true);
    expect(await addTabShortcut({ id: 't7', title: 'Niddah' }, 'נדה')).toBe(true);
    expect(NativeModules.PinnedShortcuts.requestPin).toHaveBeenCalledWith('tab-t7', 'נדה', 'soferbooks://tab/t7?title=Niddah');
  });

  test('no module, another platform or an error: false, never a throw', async () => {
    Platform.OS = 'ios';
    expect(await canAddTabShortcut()).toBe(false);
    expect(await addTabShortcut({ id: 't7', title: 'Niddah' })).toBe(false);
    Platform.OS = 'android';
    expect(await addTabShortcut({ id: 't7', title: 'Niddah' })).toBe(false);
    NativeModules.PinnedShortcuts = { isSupported: jest.fn(async () => { throw new Error('x'); }), requestPin: jest.fn(async () => { throw new Error('x'); }) };
    expect(await canAddTabShortcut()).toBe(false);
    expect(await addTabShortcut({ id: 't7', title: 'Niddah' })).toBe(false);
  });
});

describe('the tab strip', () => {
  test('a tab is titled by its book and section, not the passage scrolled to', () => {
    const tab = { title: 'Niddah', ref: 'Niddah 2a', heRef: 'נדה ב׳ א', segmentRef: 'Niddah 2a:2' };
    expect(tabLabel(tab, false)).toBe('Niddah 2a');
    expect(tabLabel(tab, true)).toBe('נדה ב׳ א');
    expect(tabLabel({ ...tab, segmentRef: 'Niddah 2a:7' }, false)).toBe('Niddah 2a');
  });

  test('the long-press menu offers Pin, or Unpin and Add to home screen (Android)', () => {
    const handlers = { onClose: jest.fn(), onCloseOthers: jest.fn(), onPin: jest.fn(), onUnpin: jest.fn(), onAddToHomeScreen: jest.fn() };
    const labels = (tab, os) => tabMenuOptions(tab, { ...handlers, os }).map(o => o.label);
    expect(labels({ id: 'a' }, 'android')).toEqual([strings.tabs.pin_tab, strings.tabs.add_to_home_screen, strings.tabs.close_tab, strings.tabs.close_other_tabs]);
    expect(labels({ id: 'a', pinned: true }, 'android')).toEqual([strings.tabs.unpin_tab, strings.tabs.add_to_home_screen, strings.tabs.close_tab, strings.tabs.close_other_tabs]);
    expect(labels({ id: 'a', pinned: true }, 'ios')).toEqual([strings.tabs.unpin_tab, strings.tabs.close_tab, strings.tabs.close_other_tabs]);
    tabMenuOptions({ id: 'a' }, { ...handlers, os: 'android' })[1].onPress();
    expect(handlers.onAddToHomeScreen).toHaveBeenCalledWith('a');
  });

  test('closing a pinned tab asks first; an unpinned one closes at once', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      const onClose = jest.fn();
      closeWithCare({ id: 'a' }, onClose);
      expect(onClose).toHaveBeenCalledWith('a');
      onClose.mockClear();
      closeWithCare({ id: 'p', pinned: true }, onClose);
      expect(onClose).not.toHaveBeenCalled();
      const buttons = alert.mock.calls[0][2];
      buttons.find(b => b.style === 'cancel').onPress?.();
      expect(onClose).not.toHaveBeenCalled();
      buttons.find(b => b.style === 'destructive').onPress();
      expect(onClose).toHaveBeenCalledWith('p');
    } finally {
      alert.mockRestore();
    }
  });
});
