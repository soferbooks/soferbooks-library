'use strict';

/**
 * Browser-style reader tabs: pure state logic (no React, no storage), so it can be unit tested.
 *
 * State shape:
 *   {
 *     tabs:        [Tab],          // open tabs, in the order shown in the tab bar
 *     activeTabId: string | null,
 *     archived:    [ArchivedTab],  // newest first. Fully unloaded: only book + place.
 *     recentlyClosed: [ClosedTab], // tabs the user closed, newest first (like Chrome's "Recently closed")
 *   }
 *   Tab         = { id, title, heTitle, ref, heRef, segmentRef, versions, textLanguage,
 *                   textListVisible, connectionsMode, lastUsed, openedAt, pinned? }
 *   ArchivedTab = { id, title, heTitle, ref, heRef, versions, archivedAt }
 *   ClosedTab   = { id, title, heTitle, ref, heRef, versions, closedAt }   (ref = the exact place)
 *
 * At most MAX_OPEN_TABS are open. Opening one more moves the least-recently-used tab that is
 * not the active one to the front of `archived` (like Chrome's tab discarding, but visible).
 *
 * Pinned tabs (`pinned: true`, at most MAX_PINNED_TABS) sit at the front of `tabs`, are never
 * archived and do not count toward MAX_OPEN_TABS: the limit is on the unpinned tabs. They are
 * saved with the other tabs, so they survive a restart at their latest place.
 * Every function returns a new state object and never mutates its input.
 */

export const MAX_OPEN_TABS = 10;
export const MAX_PINNED_TABS = 10;
export const MAX_ARCHIVED_TABS = 50;
export const MAX_RECENTLY_CLOSED_TABS = 50;
export const TABS_STORAGE_KEY = 'readerTabs.v1';

// Fields describing "where the reader is" in a tab. Anything else passed in is ignored.
// `schedule`: set on a tab opened from a learning schedule (learningSchedules/scheduleSequence.js).
const PLACE_KEYS = ['title', 'heTitle', 'ref', 'heRef', 'segmentRef', 'versions', 'textLanguage',
  'textListVisible', 'connectionsMode', 'schedule'];

let _idCounter = 0;
export const newTabId = (now = Date.now()) => `t${now.toString(36)}${(_idCounter++).toString(36)}`;

export const emptyTabsState = () => ({ tabs: [], activeTabId: null, archived: [], recentlyClosed: [] });

const pickPlace = place => {
  const out = {};
  if (!place) { return out; }
  for (const k of PLACE_KEYS) {
    if (typeof place[k] !== 'undefined') { out[k] = place[k]; }
  }
  return out;
};

/** The ref a tab should reopen at: the exact segment if known, else the section/ref. */
export const tabResumeRef = tab => (tab && (tab.segmentRef || tab.ref)) || null;

export const getActiveTab = state => state.tabs.find(t => t.id === state.activeTabId) || null;

export const findTab = (state, id) => state.tabs.find(t => t.id === id) || null;

/**
 * Most recently used open tab showing `title` (a book title), or null. A learning schedule's tab
 * is not "the book's tab": it belongs to its schedule and is reused only by it (findTabForSchedule).
 */
export const findTabForBook = (state, title) => {
  if (!title) { return null; }
  return mostRecentlyUsed(state.tabs.filter(t => t.title === title && !t.schedule));
};

/** Most recently used unpinned tab showing `title` (not a schedule's), or null */
export const mostRecentUnpinnedTabForBook = (state, title) => {
  if (!title) { return null; }
  return mostRecentlyUsed(state.tabs.filter(t => t.title === title && !t.schedule && !t.pinned));
};

/** The open tab of learning schedule `key` (e.g. "Chok LeYisrael"), or null. */
export const findTabForSchedule = (state, key) => {
  if (!key) { return null; }
  return mostRecentlyUsed(state.tabs.filter(t => t.schedule && t.schedule.key === key));
};

function mostRecentlyUsed(tabs) {
  return tabs.reduce((best, t) => (!best || (t.lastUsed || 0) > (best.lastUsed || 0) ? t : best), null);
}

const toArchived = (tab, now) => ({
  id: tab.id,
  title: tab.title,
  heTitle: tab.heTitle,
  ref: tabResumeRef(tab),
  heRef: tab.heRef,
  versions: tab.versions || null,
  archivedAt: now,
});

const toClosed = (tab, now) => {
  const { archivedAt, ...entry } = toArchived(tab, now);
  return { ...entry, closedAt: now };
};

/** Put closed tabs at the top of `recentlyClosed` (newest first, capped). */
const addRecentlyClosed = (state, closedTabs, now) => {
  const ids = new Set(closedTabs.map(t => t.id));
  const rest = (state.recentlyClosed || []).filter(c => !ids.has(c.id));
  return [...closedTabs.map(t => toClosed(t, now)), ...rest].slice(0, MAX_RECENTLY_CLOSED_TABS);
};

export const isPinned = tab => !!(tab && tab.pinned);

/** Pinned tabs first, each group keeping its order. Returns the same array when already so. */
export const pinnedFirst = tabs => {
  const pinned = tabs.filter(isPinned);
  if (tabs.slice(0, pinned.length).every(isPinned)) { return tabs; }
  return [...pinned, ...tabs.filter(t => !isPinned(t))];
};

/**
 * Archive least-recently-used non-active, unpinned tabs until at most MAX_OPEN_TABS unpinned
 * tabs remain open. Pinned tabs are never archived and do not count.
 */
export const enforceTabLimit = (state, now = Date.now(), maxOpen = MAX_OPEN_TABS) => {
  const unpinnedCount = tabs => tabs.filter(t => !isPinned(t)).length;
  if (unpinnedCount(state.tabs) <= maxOpen) { return state; }
  let tabs = [...state.tabs];
  let archived = [...state.archived];
  while (unpinnedCount(tabs) > maxOpen) {
    const candidates = tabs.filter(t => t.id !== state.activeTabId && !isPinned(t));
    const lru = candidates.reduce((worst, t) => (!worst || (t.lastUsed || 0) < (worst.lastUsed || 0) ? t : worst), null);
    if (!lru) { break; }
    tabs = tabs.filter(t => t.id !== lru.id);
    archived = [toArchived(lru, now), ...archived.filter(a => a.id !== lru.id)];
  }
  return { ...state, tabs, archived: archived.slice(0, MAX_ARCHIVED_TABS) };
};

/**
 * Open a new tab at `place` and (by default) make it active. It is inserted right after the
 * active tab, as browsers do for tabs opened from a page.
 */
export const openTab = (state, place, { now = Date.now(), id = newTabId(now), activate = true } = {}) => {
  const tab = { ...pickPlace(place), id, lastUsed: now, openedAt: now };
  const tabs = [...state.tabs];
  const activeIdx = tabs.findIndex(t => t.id === state.activeTabId);
  const afterPinned = tabs.filter(isPinned).length;  // a new tab is never put among the pinned ones
  tabs.splice(activeIdx === -1 ? tabs.length : Math.max(activeIdx + 1, afterPinned), 0, tab);
  return enforceTabLimit({ ...state, tabs, activeTabId: activate ? id : (state.activeTabId || id) }, now);
};

export const switchTab = (state, id, now = Date.now()) => {
  if (!findTab(state, id)) { return state; }
  return {
    ...state,
    activeTabId: id,
    tabs: state.tabs.map(t => (t.id === id ? { ...t, lastUsed: now } : t)),
  };
};

/** Record a new place for tab `id`. Returns the same object when nothing changed. */
export const updateTabPlace = (state, id, place) => {
  const tab = findTab(state, id);
  if (!tab) { return state; }
  const patch = pickPlace(place);
  const changed = Object.keys(patch).some(k => JSON.stringify(patch[k]) !== JSON.stringify(tab[k]));
  if (!changed) { return state; }
  return { ...state, tabs: state.tabs.map(t => (t.id === id ? { ...t, ...patch } : t)) };
};

/** Close tab `id`; it goes to the top of the Recently closed list, with its place. */
export const closeTab = (state, id, now = Date.now()) => {
  const closing = findTab(state, id);
  if (!closing) { return state; }
  const tabs = state.tabs.filter(t => t.id !== id);
  let activeTabId = state.activeTabId;
  if (activeTabId === id) {
    const next = mostRecentlyUsed(tabs);
    activeTabId = next ? next.id : null;
  }
  return { ...state, tabs, activeTabId, recentlyClosed: addRecentlyClosed(state, [closing], now) };
};

/** Close every tab but `id` and the pinned tabs (a pinned tab is closed only on its own). */
export const closeOtherTabs = (state, id, now = Date.now()) => {
  const keep = findTab(state, id);
  if (!keep) { return state; }
  // most recently used first, so the list reads newest first
  const others = state.tabs.filter(t => t.id !== id && !isPinned(t)).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  const tabs = state.tabs.filter(t => t.id === id || isPinned(t));
  return { ...state, tabs, activeTabId: id, recentlyClosed: addRecentlyClosed(state, others, now) };
};

/**
 * Pin tab `id`: it moves to the end of the pinned tabs at the front. Returns the same state
 * when the tab is missing, already pinned, or MAX_PINNED_TABS are pinned (see canPinTab).
 */
export const pinTab = (state, id) => {
  const tab = findTab(state, id);
  if (!tab || isPinned(tab) || !canPinTab(state)) { return state; }
  const pinned = state.tabs.filter(isPinned);
  const rest = state.tabs.filter(t => !isPinned(t) && t.id !== id);
  return { ...state, tabs: [...pinned, { ...tab, pinned: true }, ...rest] };
};

export const canPinTab = state => state.tabs.filter(isPinned).length < MAX_PINNED_TABS;

/** Unpin tab `id`: it becomes the first unpinned tab (it may then be archived as usual). */
export const unpinTab = (state, id, now = Date.now()) => {
  const tab = findTab(state, id);
  if (!tab || !isPinned(tab)) { return state; }
  const { pinned: _drop, ...unpinned } = tab;
  const pinned = state.tabs.filter(t => isPinned(t) && t.id !== id);
  const rest = state.tabs.filter(t => !isPinned(t));
  return enforceTabLimit({ ...state, tabs: [...pinned, unpinned, ...rest] }, now);
};

/**
 * Where a home-screen shortcut for tab `tabId` (book `title`) should open, decided when it is
 * tapped, not when it was made:
 *   { kind: 'tab', id }        the tab is open: show it at its latest place
 *   { kind: 'archived', id }   it was archived since: reopen it at its place
 *   { kind: 'ref', ref, title } it was closed: the book's last-read place (`lastReadRef(title)`,
 *                              e.g. from reading history), else where the tab was closed
 *   { kind: 'book', title }    nothing known: the book's start
 *   { kind: 'none' }           no tab and no book
 */
export const resolveTabShortcut = (state, tabId, title = null, lastReadRef = () => null) => {
  if (tabId && findTab(state, tabId)) { return { kind: 'tab', id: tabId }; }
  if (tabId && (state.archived || []).some(a => a.id === tabId)) { return { kind: 'archived', id: tabId }; }
  const closed = tabId ? (state.recentlyClosed || []).find(c => c.id === tabId) : null;
  const book = title || (closed && closed.title) || null;
  if (!book) { return { kind: 'none' }; }
  let ref = null;
  try { ref = lastReadRef(book) || null; } catch (e) { ref = null; }
  if (!ref && closed && closed.title === book) { ref = closed.ref; }
  return ref ? { kind: 'ref', ref, title: book } : { kind: 'book', title: book };
};

/** Reopen an archived tab as an open, active tab (may archive another LRU tab). */
export const restoreArchivedTab = (state, archivedId, now = Date.now()) => {
  const entry = state.archived.find(a => a.id === archivedId);
  if (!entry) { return state; }
  const archived = state.archived.filter(a => a.id !== archivedId);
  const tab = {
    id: entry.id, title: entry.title, heTitle: entry.heTitle, ref: entry.ref, heRef: entry.heRef,
    segmentRef: null, versions: entry.versions || null, lastUsed: now, openedAt: now,
  };
  const tabs = [...state.tabs.filter(t => t.id !== entry.id), tab];
  return enforceTabLimit({ ...state, tabs, archived, activeTabId: tab.id }, now);
};

/** Reopen a recently closed tab at the place it was closed (as an open, active tab). */
export const restoreRecentlyClosedTab = (state, closedId, now = Date.now()) => {
  const entry = (state.recentlyClosed || []).find(c => c.id === closedId);
  if (!entry) { return state; }
  const recentlyClosed = state.recentlyClosed.filter(c => c.id !== closedId);
  const tab = {
    id: entry.id, title: entry.title, heTitle: entry.heTitle, ref: entry.ref, heRef: entry.heRef,
    segmentRef: null, versions: entry.versions || null, lastUsed: now, openedAt: now,
  };
  const tabs = [...state.tabs.filter(t => t.id !== entry.id), tab];
  return enforceTabLimit({ ...state, tabs, recentlyClosed, activeTabId: tab.id }, now);
};

export const removeRecentlyClosedTab = (state, closedId) => ({ ...state, recentlyClosed: (state.recentlyClosed || []).filter(c => c.id !== closedId) });

export const clearRecentlyClosedTabs = state => ({ ...state, recentlyClosed: [] });

export const removeArchivedTab = (state, archivedId) => ({ ...state, archived: state.archived.filter(a => a.id !== archivedId) });

export const clearArchivedTabs = state => ({ ...state, archived: [] });

/* ---------- persistence (JSON) ---------- */

export const serializeTabs = state => JSON.stringify({
  v: 1,
  tabs: state.tabs,
  activeTabId: state.activeTabId,
  archived: state.archived,
  recentlyClosed: state.recentlyClosed || [],
});

const isValidEntry = x => !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.ref === 'string' && !!x.ref;

/** Parse what serializeTabs wrote. Anything malformed is dropped; never throws. */
export const deserializeTabs = (raw, now = Date.now()) => {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return emptyTabsState();
  }
  if (!parsed || typeof parsed !== 'object') { return emptyTabsState(); }
  const seen = new Set();
  const tabs = pinnedFirst((Array.isArray(parsed.tabs) ? parsed.tabs : []).filter(isValidEntry).filter(t => {
    if (seen.has(t.id)) { return false; }
    seen.add(t.id);
    return true;
  }));
  const archived = (Array.isArray(parsed.archived) ? parsed.archived : []).filter(isValidEntry).filter(a => !seen.has(a.id));
  const recentlyClosed = (Array.isArray(parsed.recentlyClosed) ? parsed.recentlyClosed : []).filter(isValidEntry).filter(c => !seen.has(c.id));
  let activeTabId = tabs.some(t => t.id === parsed.activeTabId) ? parsed.activeTabId : null;
  if (!activeTabId && tabs.length) { activeTabId = mostRecentlyUsed(tabs).id; }
  return enforceTabLimit({
    tabs, activeTabId,
    archived: archived.slice(0, MAX_ARCHIVED_TABS),
    recentlyClosed: recentlyClosed.slice(0, MAX_RECENTLY_CLOSED_TABS),
  }, now);
};

/**
 * Pinned tabs keep their place (owner, 2026-11-12). What to do when something is opened that would
 * land in a pinned tab - `pinned`, the book's tab outside the reader, or the reader's own tab:
 *   'switch'   go to the pinned tab, at its own place: the book opened as a book (the library shelf,
 *              its contents page, Continue reading, a home-screen shortcut: calledFrom 'navigation',
 *              'text toc' from outside the reader), or its own place asked for (isResume)
 *   'new-tab'  a particular place of it opened from elsewhere (the connections panel, a search result,
 *              a link, Today's learning ...), or "Open here" in a pinned tab: a new unpinned tab, and
 *              the pinned one stays where it was
 *   'here'     not a pinned tab's business (not pinned; or the reader moving in its own book: its
 *              contents, prev/next, another translation of it)
 * insideReader: the pinned tab is the one being read. sameBook: ref is in the tab's book.
 */
export const BOOK_OPENING = new Set(['navigation', 'text toc']);
export function pinnedTabAction({pinned, calledFrom, isResume = false, insideReader = false, sameBook = true,
  loadNewVersions = false}) {
  if (!isPinned(pinned)) { return 'here'; }
  if (calledFrom === 'tab') { return 'here'; }                     // (the tab itself: switching to it, prev/next)
  if (insideReader) {
    if (calledFrom === 'text toc' && sameBook) { return 'here'; }   // (its own contents, from the reader)
    if (loadNewVersions && sameBook) { return 'here'; }             // (another translation of it)
    return 'new-tab';
  }
  if (isResume || BOOK_OPENING.has(calledFrom)) { return 'switch'; }
  return 'new-tab';
}
