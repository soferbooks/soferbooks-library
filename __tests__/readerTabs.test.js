import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MAX_OPEN_TABS,
  TABS_STORAGE_KEY,
  emptyTabsState,
  openTab,
  switchTab,
  updateTabPlace,
  closeTab,
  closeOtherTabs,
  restoreArchivedTab,
  removeArchivedTab,
  clearArchivedTabs,
  findTabForBook,
  findTabForSchedule,
  restoreRecentlyClosedTab,
  removeRecentlyClosedTab,
  clearRecentlyClosedTabs,
  MAX_RECENTLY_CLOSED_TABS,
  getActiveTab,
  tabResumeRef,
  serializeTabs,
  deserializeTabs,
} from '../tabs/tabState';
import { loadTabs, saveTabs, makeDebouncedTabSaver } from '../tabs/tabStorage';

const place = (title, ref, extra = {}) => ({ title, ref, ...extra });

// open n tabs "Book 1".."Book n", tab i opened (and last used) at time i
const openN = (n, state = emptyTabsState()) => {
  for (let i = 1; i <= n; i++) {
    state = openTab(state, place(`Book ${i}`, `Book ${i} 1`), { now: i, id: `id${i}` });
  }
  return state;
};

describe('reader tabs: open and switch', () => {
  test('opening a tab makes it active and keeps only place fields', () => {
    const s = openTab(emptyTabsState(), { title: 'Genesis', ref: 'Genesis 1', junk: 'x' }, { now: 5, id: 'a' });
    expect(s.activeTabId).toBe('a');
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toEqual({ id: 'a', title: 'Genesis', ref: 'Genesis 1', lastUsed: 5, openedAt: 5 });
  });

  test('a new tab is inserted right after the active tab', () => {
    let s = openN(3);                       // id1 id2 id3, active id3
    s = switchTab(s, 'id1', 10);
    s = openTab(s, place('Exodus', 'Exodus 1'), { now: 11, id: 'new' });
    expect(s.tabs.map(t => t.id)).toEqual(['id1', 'new', 'id2', 'id3']);
    expect(s.activeTabId).toBe('new');
  });

  test('switching updates the active tab and its last-used time; unknown ids are ignored', () => {
    let s = openN(3);
    s = switchTab(s, 'id2', 50);
    expect(getActiveTab(s).id).toBe('id2');
    expect(s.tabs.find(t => t.id === 'id2').lastUsed).toBe(50);
    expect(switchTab(s, 'nope', 60)).toBe(s);
  });

  test('each tab keeps its own place', () => {
    let s = openN(2);
    s = updateTabPlace(s, 'id1', { ref: 'Book 1 7', segmentRef: 'Book 1 7:3', textLanguage: 'hebrew', textListVisible: true, connectionsMode: 'Commentary' });
    s = updateTabPlace(s, 'id2', { ref: 'Book 2 4', segmentRef: 'Book 2 4:9', textLanguage: 'bilingual' });
    const t1 = s.tabs.find(t => t.id === 'id1');
    const t2 = s.tabs.find(t => t.id === 'id2');
    expect(tabResumeRef(t1)).toBe('Book 1 7:3');
    expect(t1).toMatchObject({ textLanguage: 'hebrew', textListVisible: true, connectionsMode: 'Commentary' });
    expect(tabResumeRef(t2)).toBe('Book 2 4:9');
    expect(t2.textLanguage).toBe('bilingual');
  });

  test('updateTabPlace returns the same object when nothing changed', () => {
    const s = updateTabPlace(openN(1), 'id1', { ref: 'Book 1 2', versions: { en: 'X' } });
    expect(updateTabPlace(s, 'id1', { ref: 'Book 1 2', versions: { en: 'X' } })).toBe(s);
    expect(updateTabPlace(s, 'id1', { ref: 'Book 1 3' })).not.toBe(s);
  });

  test('findTabForBook returns the most recently used tab of that book', () => {
    let s = openTab(emptyTabsState(), place('Genesis', 'Genesis 1'), { now: 1, id: 'g1' });
    s = openTab(s, place('Genesis', 'Genesis 30'), { now: 2, id: 'g2' });
    s = openTab(s, place('Exodus', 'Exodus 1'), { now: 3, id: 'e' });
    expect(findTabForBook(s, 'Genesis').id).toBe('g2');
    s = switchTab(s, 'g1', 4);
    expect(findTabForBook(s, 'Genesis').id).toBe('g1');
    expect(findTabForBook(s, 'Leviticus')).toBeNull();
  });
});

describe('reader tabs: 10-tab limit and archive', () => {
  test(`at most ${MAX_OPEN_TABS} tabs; the 11th archives the least recently used`, () => {
    let s = openN(MAX_OPEN_TABS);
    expect(s.tabs).toHaveLength(10);
    expect(s.archived).toHaveLength(0);
    s = switchTab(s, 'id1', 100);           // id1 is now recently used; id2 is the LRU
    s = updateTabPlace(s, 'id2', { segmentRef: 'Book 2 1:4', heRef: 'ספר ב א' });
    s = openTab(s, place('Book 11', 'Book 11 1'), { now: 101, id: 'id11' });
    expect(s.tabs).toHaveLength(10);
    expect(s.tabs.map(t => t.id)).not.toContain('id2');
    expect(s.activeTabId).toBe('id11');
    // archived tabs remember only book + place
    expect(s.archived).toEqual([{
      id: 'id2', title: 'Book 2', heTitle: undefined, ref: 'Book 2 1:4', heRef: 'ספר ב א', versions: null, archivedAt: 101,
    }]);
  });

  test('the active tab is never archived', () => {
    let s = openN(MAX_OPEN_TABS);
    // make the active tab the oldest by time
    s = { ...s, tabs: s.tabs.map(t => (t.id === s.activeTabId ? { ...t, lastUsed: -1 } : t)) };
    const active = s.activeTabId;
    s = openTab(s, place('X', 'X 1'), { now: 200, id: 'x', activate: false });
    expect(s.tabs.map(t => t.id)).toContain(active);
    expect(s.tabs).toHaveLength(MAX_OPEN_TABS);
  });

  test('archived tabs are newest first', () => {
    let s = openN(12);
    expect(s.archived.map(a => a.id)).toEqual(['id2', 'id1']);
  });

  test('restoring an archived tab reopens it (active) and archives the next LRU', () => {
    let s = openN(11);                       // id1 archived
    expect(s.archived.map(a => a.id)).toEqual(['id1']);
    s = restoreArchivedTab(s, 'id1', 300);
    expect(s.activeTabId).toBe('id1');
    expect(s.tabs).toHaveLength(MAX_OPEN_TABS);
    expect(s.tabs.find(t => t.id === 'id1')).toMatchObject({ title: 'Book 1', ref: 'Book 1 1', lastUsed: 300 });
    expect(s.archived.map(a => a.id)).toEqual(['id2']);
    expect(restoreArchivedTab(s, 'missing', 301)).toBe(s);
  });

  test('archived tabs can be removed one by one or all at once', () => {
    let s = openN(13);
    expect(s.archived).toHaveLength(3);
    s = removeArchivedTab(s, 'id2');
    expect(s.archived.map(a => a.id)).toEqual(['id3', 'id1']);
    expect(clearArchivedTabs(s).archived).toEqual([]);
  });
});

describe('reader tabs: close', () => {
  test('closing the active tab activates the most recently used remaining tab', () => {
    let s = openN(3);
    s = switchTab(s, 'id1', 10);
    s = switchTab(s, 'id3', 11);
    s = closeTab(s, 'id3');
    expect(s.tabs.map(t => t.id)).toEqual(['id1', 'id2']);
    expect(s.activeTabId).toBe('id1');
  });

  test('closing a background tab keeps the active tab; closing the last leaves none', () => {
    let s = openN(2);
    s = closeTab(s, 'id1');
    expect(s.activeTabId).toBe('id2');
    s = closeTab(s, 'id2');
    expect(s.tabs).toEqual([]);
    expect(s.activeTabId).toBeNull();
  });

  test('close other tabs keeps only that tab, active', () => {
    let s = openN(4);
    s = closeOtherTabs(s, 'id2');
    expect(s.tabs.map(t => t.id)).toEqual(['id2']);
    expect(s.activeTabId).toBe('id2');
  });
});

describe('reader tabs: persistence', () => {
  beforeEach(() => AsyncStorage.clear());

  test('serialize / deserialize round trip', () => {
    let s = openN(11);
    s = updateTabPlace(s, 'id5', { segmentRef: 'Book 5 1:2', versions: { en: 'Some Translation' } });
    const back = deserializeTabs(serializeTabs(s), 1000);
    expect(back).toEqual(s);
  });

  test('deserialize drops malformed entries and repairs the active tab', () => {
    const raw = JSON.stringify({
      tabs: [{ id: 'a', ref: 'Genesis 1', title: 'Genesis', lastUsed: 1 }, { id: 'b' }, null, { id: 'a', ref: 'dup' },
        { id: 'c', ref: 'Exodus 2', title: 'Exodus', lastUsed: 9 }],
      activeTabId: 'gone',
      archived: [{ id: 'z', ref: 'Numbers 3' }, { ref: 'no id' }, { id: 'a', ref: 'also open' }],
    });
    const s = deserializeTabs(raw);
    expect(s.tabs.map(t => t.id)).toEqual(['a', 'c']);
    expect(s.activeTabId).toBe('c');
    expect(s.archived.map(a => a.id)).toEqual(['z']);
    expect(deserializeTabs('not json')).toEqual(emptyTabsState());
    expect(deserializeTabs(null)).toEqual(emptyTabsState());
  });

  test('deserialize enforces the open-tab limit', () => {
    const tabs = Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, ref: `R ${i}`, title: `B${i}`, lastUsed: i }));
    const s = deserializeTabs(JSON.stringify({ tabs, activeTabId: 't0', archived: [] }), 99);
    expect(s.tabs).toHaveLength(MAX_OPEN_TABS);
    expect(s.tabs.map(t => t.id)).toContain('t0');
    expect(s.archived.map(a => a.id)).toEqual(['t4', 't3', 't2', 't1']);
  });

  test('tabs survive a restart through AsyncStorage', async () => {
    let s = openN(3);
    s = updateTabPlace(s, 'id2', { segmentRef: 'Book 2 3:1' });
    await saveTabs(s);
    expect(JSON.parse(await AsyncStorage.getItem(TABS_STORAGE_KEY)).tabs).toHaveLength(3);
    expect(await loadTabs()).toEqual(s);
  });

  test('loading with nothing saved (or junk saved) gives no tabs', async () => {
    expect(await loadTabs()).toEqual(emptyTabsState());
    await AsyncStorage.setItem(TABS_STORAGE_KEY, '{broken');
    expect(await loadTabs()).toEqual(emptyTabsState());
  });

  test('debounced saver writes only the last state', () => {
    jest.useFakeTimers();
    const save = jest.fn(() => Promise.resolve());
    const debounced = makeDebouncedTabSaver(500, save);
    debounced(openN(1));
    debounced(openN(2));
    expect(save).not.toHaveBeenCalled();
    jest.advanceTimersByTime(600);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].tabs).toHaveLength(2);
    debounced(openN(3));
    debounced.flush();
    expect(save).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});

describe('Recently closed tabs (like Chrome)', () => {
  test('a closed tab goes to the top of Recently closed with its exact place', () => {
    let s = openN(3);
    s = updateTabPlace(s, 'id2', { segmentRef: 'Book 2 1:7' });
    s = closeTab(s, 'id2', 50);
    expect(s.tabs.map(t => t.id)).toEqual(['id1', 'id3']);
    expect(s.recentlyClosed).toEqual([{ id: 'id2', title: 'Book 2', heTitle: undefined, ref: 'Book 2 1:7', heRef: undefined, versions: null, closedAt: 50 }]);
    s = closeTab(s, 'id1', 60);
    expect(s.recentlyClosed.map(c => c.id)).toEqual(['id1', 'id2']);
    expect(s.archived).toEqual([]);  // the Archived section is only for tabs moved out by the 10-tab limit
  });

  test('close other tabs puts all the others there, most recently used first', () => {
    let s = openN(4);
    s = closeOtherTabs(s, 'id2', 70);
    expect(s.tabs.map(t => t.id)).toEqual(['id2']);
    expect(s.recentlyClosed.map(c => c.id)).toEqual(['id4', 'id3', 'id1']);
  });

  test('the list is capped', () => {
    let s = emptyTabsState();
    for (let i = 0; i < MAX_RECENTLY_CLOSED_TABS + 5; i++) {
      s = openTab(s, place('Genesis', `Genesis ${i + 1}`), { now: i, id: `c${i}` });
      s = closeTab(s, `c${i}`, i);
    }
    expect(s.recentlyClosed.length).toBe(MAX_RECENTLY_CLOSED_TABS);
    expect(s.recentlyClosed[0].id).toBe(`c${MAX_RECENTLY_CLOSED_TABS + 4}`);
  });

  test('reopening restores the tab at its place, active, and removes it from the list', () => {
    let s = openN(2);
    s = updateTabPlace(s, 'id1', { segmentRef: 'Book 1 1:4' });
    s = closeTab(s, 'id1', 10);
    s = restoreRecentlyClosedTab(s, 'id1', 20);
    expect(s.activeTabId).toBe('id1');
    expect(tabResumeRef(getActiveTab(s))).toBe('Book 1 1:4');
    expect(s.recentlyClosed).toEqual([]);
    expect(restoreRecentlyClosedTab(s, 'nope')).toBe(s);
  });

  test('entries can be removed or cleared, and survive a restart', () => {
    let s = openN(3);
    s = closeTab(s, 'id1', 5);
    s = closeTab(s, 'id2', 6);
    const back = deserializeTabs(serializeTabs(s), 100);
    expect(back.recentlyClosed.map(c => c.id)).toEqual(['id2', 'id1']);
    expect(removeRecentlyClosedTab(s, 'id2').recentlyClosed.map(c => c.id)).toEqual(['id1']);
    expect(clearRecentlyClosedTabs(s).recentlyClosed).toEqual([]);
    // saved before this list existed
    expect(deserializeTabs(JSON.stringify({ tabs: [], archived: [] })).recentlyClosed).toEqual([]);
  });
});

describe('learning schedule tabs', () => {
  const chok = { key: 'Chok LeYisrael', title: { en: 'Chok LeYisrael', he: 'חק לישראל' }, items: [{ ref: 'Genesis 25:29-34' }, { ref: 'Malachi 1:1-5' }], index: 0 };

  test("a schedule tab is not the book's tab, so it never takes over the reader's own tab", () => {
    let s = openTab(emptyTabsState(), place('Genesis', 'Genesis 1'), { now: 1, id: 'mine' });
    s = openTab(s, place('Genesis', 'Genesis 25:29-34', { schedule: chok }), { now: 2, id: 'chok' });
    expect(findTabForBook(s, 'Genesis').id).toBe('mine');
    expect(findTabForSchedule(s, 'Chok LeYisrael').id).toBe('chok');
    expect(findTabForSchedule(s, 'Mishnah Berurah Yomi')).toBeNull();
    expect(s.tabs.find(t => t.id === 'mine').ref).toBe('Genesis 1');
  });

  test("a place update keeps the tab's schedule, and it is saved", () => {
    let s = openTab(emptyTabsState(), place('Genesis', 'Genesis 25', { schedule: chok }), { now: 1, id: 'chok' });
    s = updateTabPlace(s, 'chok', { title: 'Malachi', ref: 'Malachi 1' });
    expect(s.tabs[0].schedule).toEqual(chok);
    expect(deserializeTabs(serializeTabs(s)).tabs[0].schedule).toEqual(chok);
  });
});
