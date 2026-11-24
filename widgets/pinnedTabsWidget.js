'use strict';

import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { selectAppIconShortcuts } from '../tabs/tabShortcuts';

/**
 * The home-screen widget of the pinned tabs (owner, 2026-11-24: "can we add widgets that are shortcuts
 * to pinned tabs (ios too)"). Each row opens its tab at the place last read in it, through the same
 * soferbooks://tab/<id> link as the app icon's shortcuts (tabs/tabShortcuts.js).
 *
 * The app keeps a small snapshot of the rows: in AsyncStorage for Android's widget (drawn by
 * react-native-android-widget from widgets/AndroidTabsWidget.js, also when the app is closed), and
 * handed to iOS's widget through the PinnedTabsWidget native module (ios/PinnedTabsWidget).
 */

export const WIDGET_NAME = 'PinnedTabs';
// (a widget of one tab, chosen when it is added: owner, 2026-11-24 "also add ability to have individual tabs
//  as a button/widget")
export const ONE_TAB_WIDGET_NAME = 'OneTab';
export const WIDGET_STORAGE_KEY = 'pinnedTabsWidget.v1';
export const MAX_WIDGET_TABS = 10;
export const MAX_CHOOSABLE_TABS = 40;

const rows = (tabs, interfaceLanguage, max) =>
  selectAppIconShortcuts(tabs, tabs.map(t => t.id), interfaceLanguage, max)
    .map(({ tabId, label, sublabel, url }) => ({ tabId, label, sublabel, url }));

/** The widget's rows: the pinned tabs, in their order in the tab bar */
export const pinnedTabWidgetItems = (tabs, interfaceLanguage = 'english') =>
  rows((Array.isArray(tabs) ? tabs : []).filter(t => t && t.pinned), interfaceLanguage, MAX_WIDGET_TABS);

/** Every open tab, in tab-bar order (what a one-tab widget can show) */
export const openTabWidgetItems = (tabs, interfaceLanguage = 'english') =>
  rows((Array.isArray(tabs) ? tabs : []).filter(Boolean), interfaceLanguage, MAX_CHOOSABLE_TABS);

/** Everything the widgets draw: `items` the pinned tabs, `tabs` every open tab */
export const widgetSnapshot = (tabs, interfaceLanguage, themeStr) => ({
  hebrew: interfaceLanguage === 'hebrew',
  dark: themeStr === 'black',
  items: pinnedTabWidgetItems(tabs, interfaceLanguage),
  tabs: openTabWidgetItems(tabs, interfaceLanguage),
});

let _last = null;

/** Keep the widgets in step with the tabs (the same snapshot twice is not sent again). Never rejects. */
export const updatePinnedTabsWidget = async (tabs, interfaceLanguage, themeStr) => {
  const snapshot = widgetSnapshot(tabs, interfaceLanguage, themeStr);
  const json = JSON.stringify(snapshot);
  if (json === _last) { return false; }
  _last = json;
  try {
    if (Platform.OS === 'android') {
      await AsyncStorage.setItem(WIDGET_STORAGE_KEY, json);
      const { requestWidgetUpdate } = require('react-native-android-widget');
      const { renderPinnedTabsWidget, renderOneTabWidget, loadOneTabChoices } = require('./AndroidTabsWidget');
      await requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => renderPinnedTabsWidget(snapshot) });
      const choices = await loadOneTabChoices();
      await requestWidgetUpdate({ widgetName: ONE_TAB_WIDGET_NAME,
        renderWidget: info => renderOneTabWidget(snapshot, choices[info.widgetId]) });
    } else if (Platform.OS === 'ios' && NativeModules.PinnedTabsWidget?.setSnapshot) {
      NativeModules.PinnedTabsWidget.setSnapshot(json);
    }
    return true;
  } catch (e) {
    console.log('pinned tabs widget', e);
    return false;
  }
};

/** The snapshot the app last saved (Android's widget, drawn with the app closed) */
export const loadWidgetSnapshot = async () => {
  try {
    const raw = await AsyncStorage.getItem(WIDGET_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.items)) { return { ...parsed, tabs: Array.isArray(parsed.tabs) ? parsed.tabs : parsed.items }; }
  } catch (e) {}
  return { hebrew: false, dark: false, items: [], tabs: [] };
};

export const _resetWidgetForTests = () => { _last = null; };
