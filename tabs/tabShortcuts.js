'use strict';

import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Home-screen & app-icon long-press shortcuts for reader tabs.
 *
 * A shortcut carries only the tab's id and its book's title, as a link
 *   soferbooks://tab/<tab id>?title=<book title>
 * which Android/iOS hands to the app like a sefaria.org link (Linking -> DeepLinkRouter).
 * The app decides where to open when the shortcut is tapped (tabState.resolveTabShortcut),
 * so it opens the tab at the latest place read in it.
 */

export const TAB_SHORTCUT_PREFIX = 'soferbooks://tab/';
export const MAX_APP_ICON_SHORTCUTS = 4;
export const SHORTCUT_PINS_STORAGE_KEY = 'appIconShortcutTabIds.v1';

let _pinnedIds = [];
let _loaded = false;
const _listeners = new Set();

export const tabShortcutUrl = (tabId, title) =>
  `${TAB_SHORTCUT_PREFIX}${encodeURIComponent(tabId)}${title ? `?title=${encodeURIComponent(title)}` : ''}`;

const decode = s => {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) { return null; }
};

/** { tabId, title } for a tab shortcut link, or null for any other url. */
export const parseTabShortcutUrl = url => {
  if (typeof url !== 'string') { return null; }
  const m = url.match(/^soferbooks:\/\/tab\/([^?#/]+)\/?(?:\?([^#]*))?/i);
  if (!m) { return null; }
  const tabId = decode(m[1]);
  if (!tabId) { return null; }
  let title = null;
  for (const pair of (m[2] || '').split('&')) {
    const [k, v] = pair.split('=');
    if (k === 'title' && v) { title = decode(v); }
  }
  return { tabId, title };
};

/** The shortcut id of a tab's shortcut (one shortcut per tab). */
export const shortcutIdForTab = tabId => `tab-${tabId}`;

const emitPinnedIds = () => _listeners.forEach(fn => fn(_pinnedIds));

export const getShortcutPinnedIds = () => _pinnedIds;

export const subscribeShortcutPinnedIds = fn => {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
};

export const loadShortcutPinnedIds = async () => {
  if (_loaded) { return _pinnedIds; }
  try {
    const raw = await AsyncStorage.getItem(SHORTCUT_PINS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    _pinnedIds = Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
  } catch (e) {
    _pinnedIds = [];
  }
  _loaded = true;
  emitPinnedIds();
  return _pinnedIds;
};

export const saveShortcutPinnedIds = async (ids) => {
  const clean = [...new Set((ids || []).filter(id => typeof id === 'string'))].slice(0, MAX_APP_ICON_SHORTCUTS);
  _pinnedIds = clean;
  _loaded = true;
  emitPinnedIds();
  try {
    await AsyncStorage.setItem(SHORTCUT_PINS_STORAGE_KEY, JSON.stringify(clean));
  } catch (e) {}
  return clean;
};

export const toggleShortcutPinnedId = async (tabId) => {
  if (!tabId) { return _pinnedIds; }
  const exists = _pinnedIds.includes(tabId);
  const next = exists
    ? _pinnedIds.filter(id => id !== tabId)
    : [..._pinnedIds, tabId].slice(0, MAX_APP_ICON_SHORTCUTS);
  return saveShortcutPinnedIds(next);
};

export const _resetShortcutPinsForTests = () => {
  _pinnedIds = [];
  _loaded = false;
  _listeners.clear();
};

/**
 * Select up to `max` tabs for the app-icon long-press menu:
 * 1. Tabs explicitly pinned in Settings (`pinnedIds`, preserving order),
 * 2. Remaining slots filled with the most recently used open tabs (`lastUsed` descending).
 */
export const selectAppIconShortcuts = (
  tabs,
  pinnedIds = [],
  interfaceLanguage = 'english',
  max = MAX_APP_ICON_SHORTCUTS
) => {
  const validTabs = (Array.isArray(tabs) ? tabs : []).filter(t => t && t.id && t.title);
  if (!validTabs.length || max <= 0) { return []; }

  const byId = new Map(validTabs.map(t => [t.id, t]));
  const chosen = [];
  const usedIds = new Set();

  for (const id of (Array.isArray(pinnedIds) ? pinnedIds : [])) {
    if (chosen.length >= max) { break; }
    const tab = byId.get(id);
    if (tab && !usedIds.has(tab.id)) {
      usedIds.add(tab.id);
      chosen.push({ tab, pinnedToShortcut: true });
    }
  }

  const byRecent = [...validTabs]
    .filter(t => !usedIds.has(t.id))
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));

  for (const tab of byRecent) {
    if (chosen.length >= max) { break; }
    usedIds.add(tab.id);
    chosen.push({ tab, pinnedToShortcut: false });
  }

  const isHeb = interfaceLanguage === 'hebrew';
  return chosen.map(({ tab, pinnedToShortcut }) => ({
    id: shortcutIdForTab(tab.id),
    tabId: tab.id,
    pinnedToShortcut,
    label: (isHeb && tab.heTitle) ? tab.heTitle : tab.title,
    sublabel: (isHeb && tab.heRef) ? tab.heRef : (tab.ref || ''),
    url: tabShortcutUrl(tab.id, tab.title),
  }));
};

/** Push the current shortcut list to Android dynamic shortcuts or iOS UIApplication.shortcutItems. */
export const syncAppIconShortcuts = async (items) => {
  const list = Array.isArray(items) ? items.slice(0, MAX_APP_ICON_SHORTCUTS) : [];
  try {
    if (Platform.OS === 'android' && NativeModules.PinnedShortcuts?.setDynamicShortcuts) {
      await NativeModules.PinnedShortcuts.setDynamicShortcuts(list);
      return true;
    }
    if (Platform.OS === 'ios' && NativeModules.AppIconShortcuts?.setShortcuts) {
      NativeModules.AppIconShortcuts.setShortcuts(list);
      return true;
    }
  } catch (e) {
    console.log('syncAppIconShortcuts', e);
  }
  return false;
};

const nativeModule = () => (Platform.OS === 'android' ? NativeModules.PinnedShortcuts : null) || null;

/** Whether this phone's launcher can take a home-screen shortcut. Never rejects. */
export const canAddTabShortcut = async () => {
  const native = nativeModule();
  if (!native) { return false; }
  try { return !!(await native.isSupported()); } catch (e) { return false; }
};

/**
 * Ask the launcher to add a home-screen shortcut for `tab`, labelled `label` (the book's name).
 * Resolves true when the launcher was asked (it shows its own confirmation), false when the
 * phone cannot add shortcuts. Never rejects.
 */
export const addTabShortcut = async (tab, label) => {
  const native = nativeModule();
  if (!native || !tab || !tab.id) { return false; }
  try {
    return !!(await native.requestPin(shortcutIdForTab(tab.id), label || tab.title || 'SoferBooks', tabShortcutUrl(tab.id, tab.title)));
  } catch (e) {
    console.log('home-screen shortcut', e);
    return false;
  }
};
