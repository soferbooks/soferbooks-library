'use strict';

import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { loadWidgetSnapshot } from './pinnedTabsWidget';
import { renderOneTabWidget, saveOneTabChoice } from './AndroidTabsWidget';

/**
 * Android: the screen shown when a one-tab widget is added (or changed, on launchers that offer it):
 * the open tabs, the pinned first; the one tapped becomes the widget's.
 * (react-native-android-widget's registerWidgetConfigurationScreen: index.js)
 */

const COLORS = {
  light: { bg: '#FBF4E4', text: '#2B2116', sub: '#8F8270', line: '#E3D5B8' },
  dark: { bg: '#333331', text: '#FFFFFF', sub: '#BBBBBB', line: '#555553' },
};
const WORDS = {
  english: { title: 'Choose a tab for the widget', cancel: 'Cancel', none: 'Open a book in SoferBooks Library first: its tab can then go on the home screen.', pinned: 'Pinned' },
  hebrew: { title: 'בחירת כרטיסייה לווידג׳ט', cancel: 'ביטול', none: 'יש לפתוח קודם ספר בספריית SoferBooks: אז אפשר להוסיף את הכרטיסייה שלו למסך הבית.', pinned: 'מוצמדת' },
};

export default function OneTabChooser({ widgetInfo, renderWidget, setResult }) {
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => { loadWidgetSnapshot().then(setSnapshot); }, []);
  if (!snapshot) { return <View style={[styles.page, { backgroundColor: COLORS.light.bg }]} />; }

  const c = snapshot.dark ? COLORS.dark : COLORS.light;
  const w = snapshot.hebrew ? WORDS.hebrew : WORDS.english;
  const rtl = snapshot.hebrew ? { textAlign: 'right', writingDirection: 'rtl' } : null;
  const pinnedIds = new Set((snapshot.items || []).map(i => i.tabId));
  const tabs = [...snapshot.tabs].sort((a, b) => (pinnedIds.has(b.tabId) ? 1 : 0) - (pinnedIds.has(a.tabId) ? 1 : 0));

  const choose = async item => {
    await saveOneTabChoice(widgetInfo.widgetId, item);
    renderWidget(renderOneTabWidget(snapshot, item));
    setResult('ok');
  };

  return (
    <View style={[styles.page, { backgroundColor: c.bg }]}>
      <Text style={[styles.title, { color: c.text }, rtl]}>{w.title}</Text>
      {tabs.length ? (
        <FlatList
          data={tabs}
          keyExtractor={t => t.tabId}
          renderItem={({ item }) => (
            <TouchableOpacity accessibilityRole="button" onPress={() => choose(item)} style={[styles.row, { borderColor: c.line }]}>
              <Text style={[styles.label, { color: c.text }, rtl]} numberOfLines={1}>{item.label}</Text>
              <Text style={[styles.sub, { color: c.sub }, rtl]} numberOfLines={1}>
                {pinnedIds.has(item.tabId) ? `${w.pinned} · ` : ''}{item.sublabel}
              </Text>
            </TouchableOpacity>
          )}
        />
      ) : <Text style={[styles.none, { color: c.text }, rtl]}>{w.none}</Text>}
      <TouchableOpacity accessibilityRole="button" onPress={() => setResult('cancel')} style={styles.cancel}>
        <Text style={[styles.cancelText, { color: c.sub }]}>{w.cancel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 20, paddingTop: 32 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 12 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 18, fontWeight: 'bold' },
  sub: { fontSize: 14, marginTop: 2 },
  none: { fontSize: 16, marginTop: 12 },
  cancel: { alignSelf: 'center', padding: 16 },
  cancelText: { fontSize: 16 },
});
