'use strict';

import { NativeModules, Platform } from 'react-native';

/**
 * Home-screen shortcuts for pinned tabs (Android pinned shortcuts).
 *
 * A shortcut carries only the tab's id and its book's title, as a link
 *   soferbooks://tab/<tab id>?title=<book title>
 * which Android hands to the app like a sefaria.org link (SplashActivity -> MainActivity ->
 * Linking -> DeepLinkRouter). The app decides where to open when the shortcut is tapped
 * (tabState.resolveTabShortcut), so it opens the tab at the latest place read in it.
 *
 * The native side is android/app/src/main/java/org/sefaria/sefaria/shortcuts/PinnedShortcutsModule.kt
 * (no maintained React Native library offers ShortcutManager.requestPinShortcut).
 */

export const TAB_SHORTCUT_PREFIX = 'soferbooks://tab/';

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

/** The Android shortcut id of a tab's shortcut (one shortcut per tab). */
export const shortcutIdForTab = tabId => `tab-${tabId}`;

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
