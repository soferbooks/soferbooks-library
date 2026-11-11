// Settings: the full library - its parts (Sefaria's library and each extra source) as tick boxes,
// each with its download and its space on the phone, the total, and Download. Sefaria's part is
// its COMPLETE LIBRARY package (the package list's own download); the others go to the
// background queue (extrasQueue.js), shown here with how far each source is, Pause / Resume /
// Cancel and the Wi-Fi switch. All parts are ticked when it opens (owner, 2026-11-11).
import React, { useContext, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import { GlobalStateContext, getTheme } from './StateManager';
import strings from './LocalizedStrings';
import styles from './Styles';
import * as extras from './extras';
import * as queue from './extrasQueue';
import { PackagesState } from './DownloadControl';
import {
  FULL_LIBRARY, SEFARIA, fullLibraryParts, estimateAll, formatSize, partName,
} from './fullLibrary';

const sefariaBytes = () => {
  const p = PackagesState && PackagesState[FULL_LIBRARY];
  return (p && p.jsonData && p.jsonData.size) || 0;
};

/** Each part's size as a line: "Dicta: 1.2 GB download, about 5.2 GB on the phone (1,156 books)" */
export function partLines(ids, isHebrew, options = {}) {
  const {parts, total} = estimateAll(ids, {sefariaBytes: sefariaBytes(), ...options});
  const size = e => strings.formatString(strings.full_library.part_size,
    {download: formatSize(e.downloadKB), phone: formatSize(e.phoneKB)});
  const lines = ids.map(id => `${partName(id, strings, isHebrew)}: ${size(parts[id])}`);
  const totalLine = strings.formatString(strings.full_library.total,
    {download: formatSize(total.downloadKB), phone: formatSize(total.phoneKB)});
  return {lines, totalLine, parts, total};
}

const QueueStatus = ({ langStyle, theme, isHebrew }) => {
  const st = queue.getState();
  if (!st.sources.length) { return null; }
  return (
    <View testID="full-library-queue">
      {st.sources.map(id => {
        const p = queue.progressOf(id);
        return (
          <Text key={id} style={[langStyle, theme.secondaryText, local.detail]}>
            {strings.formatString(strings.full_library.progress, {
              source: partName(id, strings, isHebrew), done: p.done.toLocaleString(), total: p.total.toLocaleString(),
              done_size: formatSize(p.doneKB), total_size: formatSize(p.totalKB),
            })}
          </Text>
        );
      })}
      {st.status === 'waiting_network' ? <Text style={[langStyle, theme.secondaryText, local.detail]}>{strings.full_library.waiting_wifi}</Text> : null}
      {st.paused ? <Text style={[langStyle, theme.secondaryText, local.detail]}>{strings.full_library.paused}</Text> : null}
      <View style={local.row}>
        {st.running && !st.paused
          ? <Link text={strings.full_library.pause} onPress={() => queue.pause()} langStyle={langStyle} theme={theme} />
          : <Link text={strings.full_library.resume} onPress={() => queue.resume()} langStyle={langStyle} theme={theme} />}
        <Link text={strings.full_library.cancel} onPress={() => queue.cancel()} langStyle={langStyle} theme={theme} />
      </View>
    </View>
  );
};

const Link = ({ text, onPress, langStyle, theme }) => (
  <TouchableOpacity onPress={onPress} accessibilityRole="button" style={local.link}>
    <Text style={[langStyle, theme.text, local.linkText]}>{text}</Text>
  </TouchableOpacity>
);

export const FullLibraryPanel = ({ langStyle, onDownloadSefaria }) => {
  const { themeStr, interfaceLanguage } = useContext(GlobalStateContext);
  const theme = getTheme(themeStr);
  const isHebrew = interfaceLanguage === 'hebrew';
  const ids = fullLibraryParts();
  const [ticked, setTicked] = useState(() => Object.fromEntries(ids.map(id => [id, true])));
  const [, setTick] = useState(0);
  useEffect(() => {
    const a = extras.subscribe(() => setTick(t => t + 1));
    const b = queue.subscribe(() => setTick(t => t + 1));
    return () => { a(); b(); };
  }, []);
  const chosen = ids.filter(id => ticked[id]);
  const {parts} = partLines(ids, isHebrew);
  const {totalLine} = partLines(chosen, isHebrew);
  const st = queue.getState();
  const download = async () => {
    if (ticked[SEFARIA] && onDownloadSefaria) { await onDownloadSefaria(); }
    const others = chosen.filter(id => id !== SEFARIA);
    if (others.length) { await queue.start(others); }
  };
  return (
    <View style={styles.settingsSection} testID="full-library-panel">
      <Text style={[langStyle, theme.text, local.title]}>{strings.full_library.header}</Text>
      <Text style={[langStyle, theme.secondaryText, local.detail]}>{strings.full_library.description}</Text>
      {ids.map(id => (
        <TouchableOpacity
          key={id}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: !!ticked[id] }}
          onPress={() => setTicked(t => ({...t, [id]: !t[id]}))}
          style={local.part}
          testID={`full-library-part-${id}`}
        >
          <Text style={[langStyle, theme.text]}>{ticked[id] ? '☑ ' : '☐ '}{partName(id, strings, isHebrew)}</Text>
          <Text style={[langStyle, theme.secondaryText, local.detail]}>
            {strings.formatString(strings.full_library.part_size,
              {download: formatSize(parts[id].downloadKB), phone: formatSize(parts[id].phoneKB)})}
            {parts[id].books ? `  ·  ${strings.formatString(strings.full_library.part_books, {count: parts[id].books.toLocaleString()})}` : ''}
          </Text>
        </TouchableOpacity>
      ))}
      <Text style={[langStyle, theme.text, local.total]} testID="full-library-total">{totalLine}</Text>
      <View style={local.row}>
        <Text style={[langStyle, theme.text, local.grow]}>{strings.full_library.wifi_only}</Text>
        <Switch value={st.wifiOnly !== false} onValueChange={v => queue.setWifiOnly(v)} accessibilityLabel={strings.full_library.wifi_only} />
      </View>
      {chosen.length ? <Link text={strings.full_library.download} onPress={download} langStyle={langStyle} theme={theme} /> : null}
      <QueueStatus langStyle={langStyle} theme={theme} isHebrew={isHebrew} />
    </View>
  );
};

const local = StyleSheet.create({
  title: { fontSize: 16, marginTop: 6 },
  detail: { fontSize: 13, marginTop: 2 },
  part: { paddingVertical: 6 },
  total: { fontSize: 14, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  grow: { flex: 1 },
  link: { paddingVertical: 8, marginEnd: 18 },
  linkText: { fontSize: 15, textDecorationLine: 'underline' },
});
