'use strict';

import React from 'react';
import { FlexWidget, ListWidget, TextWidget } from 'react-native-android-widget';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadWidgetSnapshot, WIDGET_NAME, ONE_TAB_WIDGET_NAME } from './pinnedTabsWidget';

/**
 * Android's home-screen widget of the pinned tabs (widgets/pinnedTabsWidget.js), drawn with
 * react-native-android-widget: the app's cream page (or its black one), a row per pinned tab.
 */

const COLORS = {
  light: { bg: '#FBF4E4', text: '#2B2116', sub: '#8F8270', line: '#E3D5B8' },
  dark: { bg: '#333331', text: '#FFFFFF', sub: '#BBBBBB', line: '#555553' },
};

// (the app's own words for a pinned tab: i18n tabs.pin_tab)
const TITLE = { english: 'Pinned tabs', hebrew: 'כרטיסיות מוצמדות' };
const EMPTY = {
  english: 'Pin a tab in SoferBooks Library (long-press it in the tab bar) to see it here.',
  hebrew: 'אפשר להצמיד כרטיסייה בספריית SoferBooks (לחיצה ארוכה עליה בשורת הכרטיסיות) כדי לראות אותה כאן.',
};

export function PinnedTabsWidget({ snapshot }) {
  const { hebrew, dark, items } = snapshot;
  const c = dark ? COLORS.dark : COLORS.light;
  const align = hebrew ? 'right' : 'left';
  const lang = hebrew ? 'hebrew' : 'english';
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.bg, borderRadius: 16, padding: 12, flexDirection: 'column' }}
    >
      <TextWidget
        text={TITLE[lang]}
        style={{ width: 'match_parent', fontSize: 13, fontWeight: 'bold', color: c.sub, textAlign: align, marginBottom: 6 }}
      />
      {items.length ? (
        <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
          {items.map(item => (
            <FlexWidget
              key={item.tabId}
              clickAction="OPEN_URI"
              clickActionData={{ uri: item.url }}
              accessibilityLabel={item.label}
              style={{ width: 'match_parent', flexDirection: 'column', paddingVertical: 8, borderBottomWidth: 1, borderColor: c.line }}
            >
              <TextWidget
                text={item.label}
                maxLines={1}
                truncate="END"
                style={{ width: 'match_parent', fontSize: 17, fontWeight: 'bold', color: c.text, textAlign: align }}
              />
              {item.sublabel ? (
                <TextWidget
                  text={item.sublabel}
                  maxLines={1}
                  truncate="END"
                  style={{ width: 'match_parent', fontSize: 13, color: c.sub, textAlign: align }}
                />
              ) : null}
            </FlexWidget>
          ))}
        </ListWidget>
      ) : (
        <TextWidget
          text={EMPTY[lang]}
          style={{ width: 'match_parent', fontSize: 14, color: c.text, textAlign: align }}
        />
      )}
    </FlexWidget>
  );
}

export const renderPinnedTabsWidget = snapshot => <PinnedTabsWidget snapshot={snapshot} />;

/*
 * The one-tab widget (ONE_TAB_WIDGET_NAME): a button for one tab, chosen when it is added
 * (widgets/OneTabChooser.js). Each widget's tab is kept by its widget id.
 */
export const ONE_TAB_CHOICES_KEY = 'oneTabWidgets.v1';

export const loadOneTabChoices = async () => {
  try {
    const parsed = JSON.parse((await AsyncStorage.getItem(ONE_TAB_CHOICES_KEY)) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
};

export const saveOneTabChoice = async (widgetId, item) => {
  const choices = await loadOneTabChoices();
  if (item) { choices[widgetId] = item; } else { delete choices[widgetId]; }
  try { await AsyncStorage.setItem(ONE_TAB_CHOICES_KEY, JSON.stringify(choices)); } catch (e) {}
  return choices;
};

/** The chosen tab as it is now (its place read last), or as it was chosen if it has since been closed */
export const currentOneTab = (snapshot, chosen) =>
  (chosen && (snapshot.tabs || []).find(t => t.tabId === chosen.tabId)) || chosen || null;

export function OneTabWidget({ snapshot, item }) {
  const c = snapshot.dark ? COLORS.dark : COLORS.light;
  const align = 'center';
  return (
    <FlexWidget
      clickAction={item ? 'OPEN_URI' : 'OPEN_APP'}
      clickActionData={item ? { uri: item.url } : undefined}
      accessibilityLabel={item ? item.label : 'SoferBooks Library'}
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: c.bg, borderRadius: 16, padding: 8,
               flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}
    >
      <TextWidget
        text={item ? item.label : 'SoferBooks'}
        maxLines={2}
        truncate="END"
        style={{ width: 'match_parent', fontSize: 16, fontWeight: 'bold', color: c.text, textAlign: align }}
      />
      {item && item.sublabel && item.sublabel !== item.label ? (
        <TextWidget
          text={item.sublabel}
          maxLines={1}
          truncate="END"
          style={{ width: 'match_parent', fontSize: 12, color: c.sub, textAlign: align, marginTop: 2 }}
        />
      ) : null}
    </FlexWidget>
  );
}

export const renderOneTabWidget = (snapshot, chosen) => <OneTabWidget snapshot={snapshot} item={currentOneTab(snapshot, chosen)} />;

/** The widgets drawn with the app closed (added, resized, Android's periodic update) */
export async function pinnedTabsWidgetTaskHandler({ widgetInfo, widgetAction, renderWidget }) {
  if (widgetInfo.widgetName === ONE_TAB_WIDGET_NAME) {
    if (widgetAction === 'WIDGET_DELETED') { await saveOneTabChoice(widgetInfo.widgetId, null); return; }
    const choices = await loadOneTabChoices();
    renderWidget(renderOneTabWidget(await loadWidgetSnapshot(), choices[widgetInfo.widgetId]));
    return;
  }
  if (widgetInfo.widgetName !== WIDGET_NAME || widgetAction === 'WIDGET_DELETED') { return; }
  renderWidget(renderPinnedTabsWidget(await loadWidgetSnapshot()));
}
