// Settings: the full library - its parts (Sefaria's library and each extra source) as tick boxes,
// each with its download and its space on the phone, the total, and Download. Sefaria's part is
// its COMPLETE LIBRARY package (the package list's own download); the others go to the
// background queue (extrasQueue.js), shown here with how far each source is, Pause / Resume /
// Cancel and the Wi-Fi switch. All parts are ticked when it opens (owner, 2026-11-11).
//
// Space (QA round 14: 6.3 GB started with 2 GB free and filled the phone): the free space and
// what the library takes are shown; a part that does not fit cannot be ticked, and Download is
// offered only while the parts ticked fit (with a margin, storage.js). A part already on the
// phone says so. Pause and Resume act on Sefaria's download and the queue together; Cancel
// deletes what was half downloaded and keeps the books that came whole, and says so.
import React, { useContext, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { GlobalStateContext, getTheme } from './StateManager';
import strings from './LocalizedStrings';
import styles from './Styles';
import * as extras from './extras';
import * as queue from './extrasQueue';
import { PackagesState, Tracker, sefariaLibraryStatus } from './DownloadControl';
import {
  FULL_LIBRARY, SEFARIA, fullLibraryParts, estimateAll, formatSize, partName,
} from './fullLibrary';
import { freeBytes, sizeOf, MARGIN_BYTES } from './storage';
import { useOnline, downloadNeedsConnection } from './connectivity';

const sefariaBytes = () => {
  const p = PackagesState && PackagesState[FULL_LIBRARY];
  return (p && p.jsonData && p.jsonData.size) || 0;
};

const sefariaStatus = () => {
  try { return (sefariaLibraryStatus && sefariaLibraryStatus()) || {chosen: false}; } catch (e) { return {chosen: false}; }
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

/** Whether a part is all on the phone already */
export function partComplete(id) {
  if (id === SEFARIA) { return !!sefariaStatus().complete; }
  if (!extras.isEnabled(id)) { return false; }
  const p = queue.progressOf(id);
  return p.total > 0 && p.done === p.total;
}

/** Whether a part's space on the phone, with the margin, fits in `free` bytes (null: not known) */
export const partFits = (part, free) => free === null || free === undefined
  || part.phoneKB * 1024 + MARGIN_BYTES <= free;

const kB = bytes => (bytes || 0) / 1024;

const QueueStatus = ({ langStyle, theme, isHebrew, onCancel }) => {
  const st = queue.getState();
  const sef = sefariaStatus();
  const sefariaUnderWay = sef.chosen && sef.downloading;
  if (!st.sources.length && !sefariaUnderWay) { return null; }
  const pausedBy = st.pausedBy || (sefariaUnderWay ? Tracker.pausedBy : null);
  const paused = (st.sources.length ? st.paused : true) && (!sefariaUnderWay || !!Tracker.pausedBy);
  const pause = () => {
    queue.pause();
    if (sefariaUnderWay) { Tracker.pause('user'); }
  };
  const resume = () => {
    queue.resume();
    if (sefariaUnderWay) { Tracker.resume().catch(e => console.log('full library: resume', e)); }
  };
  return (
    <View testID="full-library-queue">
      {sefariaUnderWay ? (
        <Text style={[langStyle, theme.secondaryText, local.detail]}>
          {`${partName(SEFARIA, strings, isHebrew)}: ${strings.formatString(strings.full_library.part_progress,
            {done: sef.done.toLocaleString(), total: sef.total.toLocaleString()})}`}
        </Text>
      ) : null}
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
      {paused ? (
        <Text style={[langStyle, theme.secondaryText, local.detail]} testID="full-library-paused">
          {pausedBy === 'low_space'
            ? strings.formatString(strings.full_library.paused_low_space, {free: formatSize(kB(st.freeAtPause))})
            : strings.full_library.paused}
        </Text>
      ) : null}
      <View style={local.row}>
        {paused
          ? <Link text={strings.full_library.resume} onPress={resume} langStyle={langStyle} theme={theme} testID="full-library-resume" />
          : <Link text={strings.full_library.pause} onPress={pause} langStyle={langStyle} theme={theme} testID="full-library-pause" />}
        <Link text={strings.full_library.cancel} onPress={onCancel} langStyle={langStyle} theme={theme} testID="full-library-cancel" />
      </View>
    </View>
  );
};

const Link = ({ text, onPress, langStyle, theme, testID }) => (
  <TouchableOpacity onPress={onPress} accessibilityRole="button" style={local.link} testID={testID}>
    <Text style={[langStyle, theme.text, local.linkText]}>{text}</Text>
  </TouchableOpacity>
);

export const FullLibraryPanel = ({ langStyle, onDownloadSefaria }) => {
  const { themeStr, interfaceLanguage } = useContext(GlobalStateContext);
  const theme = getTheme(themeStr);
  const isHebrew = interfaceLanguage === 'hebrew';
  const ids = fullLibraryParts();
  const online = useOnline();
  // (Dicta's books are made from its server's pages: not offered while offline - owner, 2026-11-12)
  const offline = id => !online && downloadNeedsConnection(id);
  const [ticked, setTicked] = useState(() => Object.fromEntries(ids.map(id => [id, true])));
  const [space, setSpace] = useState({free: null, used: null});
  const [, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    let last = 0;
    const measure = async (force = false) => {
      const now = Date.now();
      if (!force && now - last < 5000) { return; }
      last = now;
      const [free, used] = await Promise.all([freeBytes(), sizeOf(`${FileSystem.documentDirectory}library`)]);
      if (alive) { setSpace({free, used}); }
    };
    measure(true);
    const changed = () => { setTick(t => t + 1); measure(); };
    const a = extras.subscribe(changed);
    const b = queue.subscribe(changed);
    const c = 'full-library-panel';
    if (Tracker && Tracker.subscribe) { Tracker.subscribe(c, changed); }
    return () => {
      alive = false; a(); b();
      if (Tracker && Tracker.unsubscribe) { Tracker.unsubscribe(c); }
    };
  }, []);
  const {parts} = partLines(ids, isHebrew);
  const complete = Object.fromEntries(ids.map(id => [id, partComplete(id)]));
  const fits = Object.fromEntries(ids.map(id => [id, partFits(parts[id], space.free)]));
  // (what Download brings: the parts ticked that fit and are not on the phone already)
  const chosen = ids.filter(id => ticked[id] && fits[id] && !complete[id] && !offline(id));
  const {totalLine, total} = partLines(chosen, isHebrew);
  const totalFits = partFits(total, space.free);
  const st = queue.getState();
  const sef = sefariaStatus();
  const underWay = (st.running && !st.paused) || (sef.chosen && sef.downloading && !Tracker.pausedBy);
  const download = async () => {
    if (!totalFits) { return; }
    if (chosen.includes(SEFARIA) && onDownloadSefaria) { await onDownloadSefaria(); }
    const others = chosen.filter(id => id !== SEFARIA);
    if (others.length) { await queue.start(others); }
  };
  const cancel = async () => {
    const sefariaKept = sef.chosen ? sef.done : 0;
    if (sef.chosen && sef.downloading) { Tracker.cancelDownload(true); }
    const kept = (await queue.cancel()) + sefariaKept;
    Alert.alert(strings.full_library.cancelled_title,
      strings.formatString(strings.full_library.cancelled_message, {count: kept.toLocaleString()}),
      [{text: strings.common.ok}]);
  };
  const rowDetail = id => {
    if (complete[id]) {
      return strings.formatString(strings.full_library.part_done, {phone: formatSize(parts[id].phoneKB)});
    }
    const size = strings.formatString(strings.full_library.part_size,
      {download: formatSize(parts[id].downloadKB), phone: formatSize(parts[id].phoneKB)});
    const books = parts[id].books ? `  ·  ${strings.formatString(strings.full_library.part_books, {count: parts[id].books.toLocaleString()})}` : '';
    const room = fits[id] ? '' : `  ·  ${strings.full_library.part_no_room}`;
    const connection = offline(id) ? `  ·  ${strings.extras.needs_connection}` : '';
    return `${size}${books}${room}${connection}`;
  };
  return (
    <View style={styles.settingsSection} testID="full-library-panel">
      <Text style={[langStyle, theme.text, local.title]}>{strings.full_library.header}</Text>
      <Text style={[langStyle, theme.secondaryText, local.detail]}>{strings.full_library.description}</Text>
      {space.free !== null ? (
        <Text style={[langStyle, theme.secondaryText, local.detail]} testID="full-library-space">
          {strings.formatString(strings.full_library.space, {free: formatSize(kB(space.free)), used: formatSize(kB(space.used))})}
        </Text>
      ) : null}
      {ids.map(id => {
        const disabled = complete[id] || !fits[id] || offline(id);
        const checked = !!ticked[id] && !disabled;
        return (
          <TouchableOpacity
            key={id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked, disabled }}
            disabled={disabled}
            onPress={() => setTicked(t => ({...t, [id]: !t[id]}))}
            style={local.part}
            testID={`full-library-part-${id}`}
          >
            <Text style={[langStyle, disabled ? theme.secondaryText : theme.text]}>
              {complete[id] ? '✓ ' : (checked ? '☑ ' : '☐ ')}{partName(id, strings, isHebrew)}
            </Text>
            <Text style={[langStyle, theme.secondaryText, local.detail]}>{rowDetail(id)}</Text>
          </TouchableOpacity>
        );
      })}
      {chosen.length ? <Text style={[langStyle, theme.text, local.total]} testID="full-library-total">{totalLine}</Text> : null}
      {chosen.length && !totalFits ? (
        <Text style={[langStyle, theme.text, local.detail]} testID="full-library-no-room">
          {strings.formatString(strings.full_library.not_enough_space,
            {needed: formatSize(total.phoneKB + kB(MARGIN_BYTES)), free: formatSize(kB(space.free))})}
        </Text>
      ) : null}
      <View style={local.row}>
        <Text style={[langStyle, theme.text, local.grow]}>{strings.full_library.wifi_only}</Text>
        <Switch value={st.wifiOnly !== false} onValueChange={v => queue.setWifiOnly(v)} accessibilityLabel={strings.full_library.wifi_only} />
      </View>
      {chosen.length && totalFits && !underWay
        ? <Link text={strings.full_library.download} onPress={download} langStyle={langStyle} theme={theme} testID="full-library-download" />
        : null}
      <QueueStatus langStyle={langStyle} theme={theme} isHebrew={isHebrew} onCancel={cancel} />
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
