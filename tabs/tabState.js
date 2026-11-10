'use strict';

/**
 * Browser-style reader tabs: pure state logic (no React, no storage), so it can be unit tested.
 *
 * State shape:
 *   {
 *     tabs:        [Tab],          // open tabs, in the order shown in the tab bar
 *     activeTabId: string | null,
 *     archived:    [ArchivedTab],  // newest first. Fully unloaded: only book + place.
 *   }
 *   Tab         = { id, title, heTitle, ref, heRef, segmentRef, versions, textLanguage,
 *                   textListVisible, connectionsMode, lastUsed, openedAt }
 *   ArchivedTab = { id, title, heTitle, ref, heRef, versions, archivedAt }
 *
 * At most MAX_OPEN_TABS are open. Opening one more moves the least-recently-used tab that is
 * not the active one to the front of `archived` (like Chrome's tab discarding, but visible).
 * Every function returns a new state object and never mutates its input.
 */

export const MAX_OPEN_TABS = 10;
export const MAX_ARCHIVED_TABS = 50;
export const TABS_STORAGE_KEY = 'readerTabs.v1';

// Fields describing "where the reader is" in a tab. Anything else passed in is ignored.
const PLACE_KEYS = ['title', 'heTitle', 'ref', 'heRef', 'segmentRef', 'versions', 'textLanguage',
  'textListVisible', 'connectionsMode'];

let _idCounter = 0;
export const newTabId = (now = Date.now()) => `t${now.toString(36)}${(_idCounter++).toString(36)}`;

export const emptyTabsState = () => ({ tabs: [], activeTabId: null, archived: [] });

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

/** Most recently used open tab showing `title` (a book title), or null. */
export const findTabForBook = (state, title) => {
  if (!title) { return null; }
  const matches = state.tabs.filter(t => t.title === title);
  if (!matches.length) { return null; }
  return matches.reduce((best, t) => ((t.lastUsed || 0) > (best.lastUsed || 0) ? t : best));
};

const mostRecentlyUsed = tabs => tabs.reduce((best, t) => (!best || (t.lastUsed || 0) > (best.lastUsed || 0) ? t : best), null);

const toArchived = (tab, now) => ({
  id: tab.id,
  title: tab.title,
  heTitle: tab.heTitle,
  ref: tabResumeRef(tab),
  heRef: tab.heRef,
  versions: tab.versions || null,
  archivedAt: now,
});

/** Archive least-recently-used non-active tabs until at most MAX_OPEN_TABS remain open. */
export const enforceTabLimit = (state, now = Date.now(), maxOpen = MAX_OPEN_TABS) => {
  if (state.tabs.length <= maxOpen) { return state; }
  let tabs = [...state.tabs];
  let archived = [...state.archived];
  while (tabs.length > maxOpen) {
    const candidates = tabs.filter(t => t.id !== state.activeTabId);
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
  tabs.splice(activeIdx === -1 ? tabs.length : activeIdx + 1, 0, tab);
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

export const closeTab = (state, id) => {
  if (!findTab(state, id)) { return state; }
  const tabs = state.tabs.filter(t => t.id !== id);
  let activeTabId = state.activeTabId;
  if (activeTabId === id) {
    const next = mostRecentlyUsed(tabs);
    activeTabId = next ? next.id : null;
  }
  return { ...state, tabs, activeTabId };
};

export const closeOtherTabs = (state, id) => {
  const keep = findTab(state, id);
  if (!keep) { return state; }
  return { ...state, tabs: [keep], activeTabId: id };
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

export const removeArchivedTab = (state, archivedId) => ({ ...state, archived: state.archived.filter(a => a.id !== archivedId) });

export const clearArchivedTabs = state => ({ ...state, archived: [] });

/* ---------- persistence (JSON) ---------- */

export const serializeTabs = state => JSON.stringify({
  v: 1,
  tabs: state.tabs,
  activeTabId: state.activeTabId,
  archived: state.archived,
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
  const tabs = (Array.isArray(parsed.tabs) ? parsed.tabs : []).filter(isValidEntry).filter(t => {
    if (seen.has(t.id)) { return false; }
    seen.add(t.id);
    return true;
  });
  const archived = (Array.isArray(parsed.archived) ? parsed.archived : []).filter(isValidEntry).filter(a => !seen.has(a.id));
  let activeTabId = tabs.some(t => t.id === parsed.activeTabId) ? parsed.activeTabId : null;
  if (!activeTabId && tabs.length) { activeTabId = mostRecentlyUsed(tabs).id; }
  return enforceTabLimit({ tabs, activeTabId, archived: archived.slice(0, MAX_ARCHIVED_TABS) }, now);
};
