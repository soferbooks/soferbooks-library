import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestWidgetUpdate } from 'react-native-android-widget';
import {
  pinnedTabWidgetItems, widgetSnapshot, updatePinnedTabsWidget, loadWidgetSnapshot,
  WIDGET_STORAGE_KEY, WIDGET_NAME, ONE_TAB_WIDGET_NAME, _resetWidgetForTests,
} from '../widgets/pinnedTabsWidget';
import {
  pinnedTabsWidgetTaskHandler, renderPinnedTabsWidget, currentOneTab, saveOneTabChoice, loadOneTabChoices,
} from '../widgets/AndroidTabsWidget';

const TABS = [
  { id: 'a', title: 'Shabbat', heTitle: 'שבת', ref: 'Shabbat 8a', heRef: 'שבת ח.', pinned: true },
  { id: 'b', title: 'Genesis', heTitle: 'בראשית', ref: 'Genesis 1:1', heRef: 'בראשית א:א' },
  { id: 'c', title: 'Psalms', heTitle: 'תהלים', ref: 'Psalms 23', heRef: 'תהלים כג', pinned: true },
];

describe('pinned tabs widget', () => {
  beforeEach(() => { _resetWidgetForTests(); AsyncStorage.clear && AsyncStorage.clear(); requestWidgetUpdate.mockClear(); });

  test('rows are the pinned tabs only, in tab-bar order, each opening its tab', () => {
    const items = pinnedTabWidgetItems(TABS, 'english');
    expect(items.map(i => i.tabId)).toEqual(['a', 'c']);
    expect(items[0]).toEqual({ tabId: 'a', label: 'Shabbat', sublabel: 'Shabbat 8a', url: 'soferbooks://tab/a?title=Shabbat' });
    expect(pinnedTabWidgetItems(TABS, 'hebrew')[1]).toMatchObject({ label: 'תהלים', sublabel: 'תהלים כג' });
    expect(pinnedTabWidgetItems([], 'english')).toEqual([]);
  });

  test('the snapshot carries the language and the dark theme', () => {
    expect(widgetSnapshot(TABS, 'hebrew', 'black')).toMatchObject({ hebrew: true, dark: true });
    expect(widgetSnapshot(TABS, 'english', 'cream')).toMatchObject({ hebrew: false, dark: false });
  });

  test('Android: saved for the closed app and redrawn, once per change', async () => {
    Platform.OS = 'android';
    expect(await updatePinnedTabsWidget(TABS, 'english', 'cream')).toBe(true);
    expect(requestWidgetUpdate).toHaveBeenCalledWith(expect.objectContaining({ widgetName: WIDGET_NAME }));
    expect(JSON.parse(await AsyncStorage.getItem(WIDGET_STORAGE_KEY)).items).toHaveLength(2);
    expect(await updatePinnedTabsWidget(TABS, 'english', 'cream')).toBe(false);
    // (both widgets once: the pinned tabs and the one-tab ones)
    expect(requestWidgetUpdate).toHaveBeenCalledTimes(2);
    expect(requestWidgetUpdate).toHaveBeenCalledWith(expect.objectContaining({ widgetName: ONE_TAB_WIDGET_NAME }));
    expect((await loadWidgetSnapshot()).items[1].tabId).toBe('c');
  });

  test('Android: the task handler draws the saved rows (nothing for a deleted widget)', async () => {
    Platform.OS = 'android';
    await updatePinnedTabsWidget(TABS, 'english', 'cream');
    const renderWidget = jest.fn();
    await pinnedTabsWidgetTaskHandler({ widgetInfo: { widgetName: WIDGET_NAME }, widgetAction: 'WIDGET_ADDED', renderWidget });
    expect(renderWidget.mock.calls[0][0].props.snapshot.items).toHaveLength(2);
    renderWidget.mockClear();
    await pinnedTabsWidgetTaskHandler({ widgetInfo: { widgetName: WIDGET_NAME }, widgetAction: 'WIDGET_DELETED', renderWidget });
    expect(renderWidget).not.toHaveBeenCalled();
    expect(renderPinnedTabsWidget({ hebrew: false, dark: false, items: [] })).toBeTruthy();
  });

  test('one-tab widget: every open tab can be chosen; it shows the tab as now, or as chosen once closed', async () => {
    const snap = widgetSnapshot(TABS, 'english', 'cream');
    expect(snap.tabs.map(t => t.tabId)).toEqual(['a', 'b', 'c']);
    const chosen = { ...snap.tabs[1], sublabel: 'Genesis 1:1 (old)' };
    expect(currentOneTab(snap, chosen).sublabel).toBe('Genesis 1:1');
    expect(currentOneTab({ ...snap, tabs: [] }, chosen).sublabel).toBe('Genesis 1:1 (old)');
    expect(currentOneTab(snap, undefined)).toBeNull();

    Platform.OS = 'android';
    await updatePinnedTabsWidget(TABS, 'english', 'cream');
    await saveOneTabChoice(7, chosen);
    const renderWidget = jest.fn();
    await pinnedTabsWidgetTaskHandler({ widgetInfo: { widgetName: ONE_TAB_WIDGET_NAME, widgetId: 7 }, widgetAction: 'WIDGET_ADDED', renderWidget });
    expect(renderWidget.mock.calls[0][0].props.item.url).toBe('soferbooks://tab/b?title=Genesis');
    await pinnedTabsWidgetTaskHandler({ widgetInfo: { widgetName: ONE_TAB_WIDGET_NAME, widgetId: 7 }, widgetAction: 'WIDGET_DELETED', renderWidget });
    expect(await loadOneTabChoices()).toEqual({});
  });

  test('iOS: handed to the native widget module', async () => {
    Platform.OS = 'ios';
    NativeModules.PinnedTabsWidget = { setSnapshot: jest.fn() };
    await updatePinnedTabsWidget(TABS, 'english', 'white');
    expect(JSON.parse(NativeModules.PinnedTabsWidget.setSnapshot.mock.calls[0][0]).items).toHaveLength(2);
    delete NativeModules.PinnedTabsWidget;
    Platform.OS = 'android';
  });
});
