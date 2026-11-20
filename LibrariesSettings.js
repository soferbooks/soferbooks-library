// Settings: "Libraries" - one place for every library's books (owner, 2026-11-20: the three
// download areas - library sources, the full library panel and Sefaria's package list - looked
// complicated). Each library is a row that opens into a dropdown, as Sefaria's packages do:
//
//   Not downloaded   Sefaria's books are read online; another library's book downloads when opened
//   All books        downloaded now (Sefaria: its COMPLETE LIBRARY package; the others: the
//                    background queue, extrasQueue.js)
//   Some books       Sefaria: its packages (Tanach, Talmud ...); the others: their categories
//
// Nothing is chosen until the reader chooses (Sefaria included). Under the rows: the free space,
// Wi-Fi only, and the downloads under way (Pause / Resume / Cancel: FullLibraryPanel's QueueStatus).
// An extra library can also be hidden from the library altogether (its old on/off switch).
import React, { useContext, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { GlobalStateContext, getTheme } from './StateManager';
import strings, { countString } from './LocalizedStrings';
import styles from './Styles';
import * as extras from './extras';
import * as queue from './extrasQueue';
import { SOURCES } from './sources';
import { PackagesState, Tracker, sefariaLibraryStatus } from './DownloadControl';
import { FULL_LIBRARY, SEFARIA, formatSize, partName, estimate } from './fullLibrary';
import { QueueStatus } from './FullLibraryPanel';
import { freeBytes, sizeOf } from './storage';
import { useOnline, downloadNeedsConnection } from './connectivity';

const kB = bytes => (bytes || 0) / 1024;

const sefariaStatus = () => {
  try { return (sefariaLibraryStatus && sefariaLibraryStatus()) || {chosen: false}; } catch (e) { return {chosen: false}; }
};

const sefariaPackages = () => Object.values(PackagesState || {}).sort((a, b) => a.order - b.order);

/** 'none' | 'all' | 'some' for Sefaria's books (its chosen packages) */
export function sefariaChoice(packages = sefariaPackages()) {
  if (packages.some(p => p.name === FULL_LIBRARY && p.clicked)) { return 'all'; }
  return packages.some(p => p.clicked) ? 'some' : 'none';
}

const Radio = ({ selected, text, detail, onPress, langStyle, theme, testID, disabled }) => (
  <TouchableOpacity accessibilityRole="radio" accessibilityState={{ selected, disabled }} disabled={disabled}
    onPress={onPress} style={local.option} testID={testID}>
    <Text style={[langStyle, disabled ? theme.secondaryText : theme.text]}>{selected ? '◉ ' : '○ '}{text}</Text>
    {detail ? <Text style={[langStyle, theme.secondaryText, local.detail]}>{detail}</Text> : null}
  </TouchableOpacity>
);

const Check = ({ checked, text, detail, onPress, langStyle, theme, testID, disabled }) => (
  <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} disabled={disabled}
    onPress={onPress} style={local.check} testID={testID}>
    <Text style={[langStyle, disabled ? theme.secondaryText : theme.text]}>{checked ? '☑ ' : '☐ '}{text}</Text>
    {detail ? <Text style={[langStyle, theme.secondaryText, local.detail]}>{detail}</Text> : null}
  </TouchableOpacity>
);

const Link = ({ text, onPress, langStyle, theme, testID, disabled }) => (
  <TouchableOpacity onPress={onPress} disabled={disabled} accessibilityRole="button" style={local.link} testID={testID}>
    <Text style={[langStyle, disabled ? theme.secondaryText : theme.text, local.linkText]}>{text}</Text>
  </TouchableOpacity>
);

/** A library's row: its name and how it stands, opening into its choices */
const LibraryRow = ({ id, name, status, open, onToggle, langStyle, theme, children }) => (
  <View style={local.library} testID={`library-${id}`}>
    <TouchableOpacity onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}
      style={local.libraryHead} testID={`library-${id}-toggle`}>
      <View style={local.grow}>
        <Text style={[langStyle, theme.text, local.libraryName]}>{name}</Text>
        <Text style={[langStyle, theme.secondaryText, local.detail]}>{status}</Text>
      </View>
      <Text style={[theme.secondaryText, local.chevron]}>{open ? '▾' : '▸'}</Text>
    </TouchableOpacity>
    {open ? <View style={local.dropdown}>{children}</View> : null}
  </View>
);

/** Sefaria's dropdown: read online, all, or some of its packages (SettingsPage's own package code) */
const SefariaLibrary = ({ langStyle, theme, isHebrew, open, onToggle, sefaria }) => {
  const packages = sefariaPackages();
  const choice = sefariaChoice(packages);
  const [some, setSome] = useState(choice === 'some');
  const full = packages.find(p => p.name === FULL_LIBRARY);
  const sizeOfPkg = p => formatSize(kB((p.jsonData && p.jsonData.size) || 0));
  const sef = sefariaStatus();
  const shown = some ? 'some' : choice;
  const status = sef.chosen && sef.downloading
    ? strings.formatString(strings.libraries.downloading, {done: sef.done.toLocaleString(), total: sef.total.toLocaleString()})
    : choice === 'all' ? strings.formatString(strings.libraries.status_all, {size: full ? sizeOfPkg(full) : ''})
      : choice === 'some' ? strings.formatString(strings.libraries.status_some, {
        parts: packages.filter(p => p.clicked).map(p => (isHebrew ? p.jsonData.he : p.name)).join(', ')})
        : strings.libraries.status_online;
  const toNone = () => {
    setSome(false);
    if (choice === 'none') { return; }
    Alert.alert(strings.libraries.sefaria, strings.libraries.delete_sefaria_confirm, [
      { text: strings.common.cancel, style: 'cancel' },
      { text: strings.common.ok, onPress: () => sefaria.deleteLibrary() },
    ]);
  };
  // (withExtras: false - Sefaria's books only; each other library is chosen in its own row)
  const toAll = () => { setSome(false); if (full && !full.clicked) { sefaria.onPackagePress(full, { withExtras: false }); } };
  return (
    <LibraryRow id={SEFARIA} name={strings.libraries.sefaria} status={status} open={open} onToggle={onToggle}
      langStyle={langStyle} theme={theme}>
      <Radio selected={shown === 'none'} text={strings.libraries.sefaria_online} onPress={toNone}
        langStyle={langStyle} theme={theme} testID="library-sefaria-none" />
      <Radio selected={shown === 'all'} text={strings.libraries.all_books}
        detail={full ? strings.formatString(strings.libraries.size_download, {size: sizeOfPkg(full)}) : null}
        onPress={toAll} langStyle={langStyle} theme={theme} testID="library-sefaria-all" />
      <Radio selected={shown === 'some'} text={strings.libraries.some_books} onPress={() => setSome(true)}
        langStyle={langStyle} theme={theme} testID="library-sefaria-some" />
      {shown === 'some' ? packages.filter(p => p.name !== FULL_LIBRARY).map(p => (
        <Check key={p.name} checked={!!p.clicked} text={isHebrew ? p.jsonData.he : p.name} detail={sizeOfPkg(p)}
          onPress={() => sefaria.onPackagePress(p)} langStyle={langStyle} theme={theme} testID={`library-sefaria-pkg-${p.name}`} />
      )) : null}
      {choice !== 'none' ? (
        <Link text={sefaria.updatesBusy ? strings.download.checking : strings.download.check_for_updates}
          onPress={sefaria.checkUpdates} disabled={sefaria.updatesBusy} langStyle={langStyle} theme={theme} testID="library-sefaria-updates" />
      ) : null}
    </LibraryRow>
  );
};

/** Another library's dropdown (Dicta, Otzaria ...): when opened, all, or some of its categories */
const ExtraLibrary = ({ source, langStyle, theme, isHebrew, open, onToggle }) => {
  const id = source.id;
  const name = isHebrew ? source.heName : source.name;
  const online = useOnline();
  const offline = !online && downloadNeedsConnection(id);
  const shownInLibrary = extras.isEnabled(id);
  const p = queue.progressOf(id);
  // (every book on the device - chosen so, or downloaded one by one: "All books")
  const complete = !!(p.total && p.done >= p.total);
  const chosen = queue.choiceOf(id);
  const choice = chosen === 'open' && complete ? 'all' : chosen;
  const [some, setSome] = useState(choice === 'some');
  // (a library all on the device starts with every category ticked)
  const [picked, setPicked] = useState(() => queue.chosenCategories(id)
    || (complete ? queue.categoriesOf(id).map(c => c.key) : []));
  const [busy, setBusy] = useState(false);
  const downloaded = extras.downloadedBooks(id).length;
  const shown = some || choice === 'some' ? 'some' : choice;
  const all = estimate(id);
  const run = async job => {
    setBusy(true);
    try { await job(); } catch (e) {
      if (!(e instanceof extras.DownloadCancelledError)) {
        Alert.alert(strings.download.download_error, strings.extras.download_failed_message, [{ text: strings.common.ok }]);
      }
    } finally { setBusy(false); }
  };
  // (all its books on the device - chosen so, or downloaded one by one - say so)
  const status = !shownInLibrary ? strings.libraries.status_hidden
    : choice === 'open' ? `${strings.libraries.status_when_opened}  ·  ${countString(strings.extras.downloaded_count, strings.extras.downloaded_count_one, downloaded)}`
      : strings.formatString(strings.libraries.status_books, {done: p.done.toLocaleString(), total: p.total.toLocaleString(), size: formatSize(p.doneKB)});
  const toOpen = () => {
    setSome(false);
    if (choice === 'open') { if (!shownInLibrary) { run(() => extras.setSourceEnabled(id, true)); } return; }
    run(() => queue.choose(id, 'open'));
  };
  const toAll = () => { setSome(false); run(() => queue.choose(id, 'all')); };
  const togglePick = key => {
    const unticking = picked.includes(key);
    const next = unticking ? picked.filter(k => k !== key) : [...picked, key];
    setPicked(next);
    run(() => (next.length ? queue.choose(id, 'some', next) : queue.choose(id, 'open')));
    // (a category taken off: its downloaded books may go, to free the space)
    const onDevice = unticking ? queue.booksOfCategory(id, key).filter(b => extras.isDownloaded(b.title)) : [];
    if (onDevice.length) {
      Alert.alert(name, countString(strings.libraries.delete_category_confirm, strings.libraries.delete_category_confirm_one, onDevice.length), [
        { text: strings.extras.keep_books, style: 'cancel' },
        { text: strings.extras.delete_books, style: 'destructive', onPress: () => run(async () => {
          for (const b of onDevice) { await extras.deleteBook(b.title); }
        }) },
      ]);
    }
  };
  const hide = () => Alert.alert(name, countString(strings.extras.turn_off_message, strings.extras.turn_off_message_one, downloaded), [
    { text: strings.common.cancel, style: 'cancel' },
    { text: strings.extras.keep_books, onPress: () => run(async () => { await queue.choose(id, 'open'); await extras.setSourceEnabled(id, false, { keepBooks: true }); }) },
    { text: strings.extras.delete_books, style: 'destructive', onPress: () => run(async () => { await queue.choose(id, 'open'); await extras.setSourceEnabled(id, false, { keepBooks: false }); }) },
  ]);
  const checkUpdates = () => run(async () => {
    const changed = await extras.checkUpdates(id);
    if (!changed.length) { Alert.alert(name, strings.extras.up_to_date, [{ text: strings.common.ok }]); return; }
    Alert.alert(name, countString(strings.extras.updates_message, strings.extras.updates_message_one, changed.length), [
      { text: strings.common.not_now, style: 'cancel' },
      { text: strings.download.download, onPress: () => run(async () => { for (const t of changed) { await extras.downloadBook(t); } }) },
    ]);
  });
  return (
    <LibraryRow id={id} name={name} status={status} open={open} onToggle={onToggle} langStyle={langStyle} theme={theme}>
      {offline ? <Text style={[langStyle, theme.text, local.detail]}>{strings.extras.needs_connection}</Text> : null}
      <Radio selected={shownInLibrary && shown === 'open'} text={strings.libraries.when_opened} onPress={toOpen}
        langStyle={langStyle} theme={theme} testID={`library-${id}-open`} disabled={busy} />
      <Radio selected={shownInLibrary && shown === 'all'} text={strings.libraries.all_books}
        detail={strings.formatString(strings.libraries.size_books, {books: (all.books || 0).toLocaleString(), size: formatSize(all.downloadKB)})}
        onPress={toAll} langStyle={langStyle} theme={theme} testID={`library-${id}-all`} disabled={busy || offline} />
      <Radio selected={shownInLibrary && shown === 'some'} text={strings.libraries.some_books} onPress={() => setSome(true)}
        langStyle={langStyle} theme={theme} testID={`library-${id}-some`} disabled={busy || offline} />
      {shown === 'some' ? queue.categoriesOf(id).map(c => (
        <Check key={c.key} checked={picked.includes(c.key)} text={isHebrew ? c.he : c.en}
          detail={strings.formatString(strings.libraries.size_books, {books: c.books.toLocaleString(), size: formatSize(c.kB)})}
          onPress={() => togglePick(c.key)} langStyle={langStyle} theme={theme} testID={`library-${id}-cat-${c.key}`} disabled={busy} />
      )) : null}
      <View style={local.row}>
        {downloaded ? <Link text={strings.download.check_for_updates} onPress={checkUpdates} disabled={busy || offline}
          langStyle={langStyle} theme={theme} testID={`library-${id}-updates`} /> : null}
        {shownInLibrary ? <Link text={strings.libraries.hide} onPress={hide} disabled={busy}
          langStyle={langStyle} theme={theme} testID={`library-${id}-hide`} /> : null}
        {busy ? <ActivityIndicator /> : null}
      </View>
    </LibraryRow>
  );
};

/**
 * The Libraries section. sefaria: SettingsPage's own package handling - {onPackagePress,
 * isDisabledObj, deleteLibrary, checkUpdates, updatesBusy}.
 */
export const LibrariesSettings = ({ langStyle, sefaria }) => {
  const { themeStr, interfaceLanguage } = useContext(GlobalStateContext);
  const theme = getTheme(themeStr);
  const isHebrew = interfaceLanguage === 'hebrew';
  const [openId, setOpenId] = useState(null);
  const [space, setSpace] = useState({ free: null, used: null });
  const [, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    let last = 0;
    const measure = async (force = false) => {
      const now = Date.now();
      if (!force && now - last < 5000) { return; }
      last = now;
      const [free, used] = await Promise.all([freeBytes(), sizeOf(`${FileSystem.documentDirectory}library`)]);
      if (alive) { setSpace({ free, used }); }
    };
    measure(true);
    const changed = () => { setTick(t => t + 1); measure(); };
    const a = extras.subscribe(changed);
    const b = queue.subscribe(changed);
    const c = 'libraries-settings';
    if (Tracker && Tracker.subscribe) { Tracker.subscribe(c, changed); }
    return () => { alive = false; a(); b(); if (Tracker && Tracker.unsubscribe) { Tracker.unsubscribe(c); } };
  }, []);
  const toggle = id => setOpenId(o => (o === id ? null : id));
  const st = queue.getState();
  const cancel = async () => {
    const sef = sefariaStatus();
    if (sef.chosen && sef.downloading) { Tracker.cancelDownload(true); }
    const kept = (await queue.cancel()) + (sef.chosen ? sef.done : 0);
    Alert.alert(strings.full_library.cancelled_title,
      strings.formatString(strings.full_library.cancelled_message, { count: kept.toLocaleString() }), [{ text: strings.common.ok }]);
  };
  return (
    <View style={styles.settingsSection} testID="libraries-settings">
      <Text style={[langStyle, styles.settingsSectionHeader, theme.tertiaryText]}>{strings.libraries.header}</Text>
      <Text style={[langStyle, theme.secondaryText, local.detail]}>{strings.libraries.description}</Text>
      {space.free !== null ? (
        <Text style={[langStyle, theme.secondaryText, local.detail]} testID="libraries-space">
          {strings.formatString(strings.full_library.space, { free: formatSize(kB(space.free)), used: formatSize(kB(space.used)) })}
        </Text>
      ) : null}
      <SefariaLibrary langStyle={langStyle} theme={theme} isHebrew={isHebrew} open={openId === SEFARIA}
        onToggle={() => toggle(SEFARIA)} sefaria={sefaria || {}} />
      {SOURCES.filter(s => s.extra && s.available).map(s => (
        <ExtraLibrary key={s.id} source={s} langStyle={langStyle} theme={theme} isHebrew={isHebrew}
          open={openId === s.id} onToggle={() => toggle(s.id)} />
      ))}
      <View style={local.row}>
        <Text style={[langStyle, theme.text, local.grow]}>{strings.full_library.wifi_only}</Text>
        <Switch value={st.wifiOnly !== false} onValueChange={v => queue.setWifiOnly(v)} accessibilityLabel={strings.full_library.wifi_only} />
      </View>
      <QueueStatus langStyle={langStyle} theme={theme} isHebrew={isHebrew} onCancel={cancel} />
    </View>
  );
};

const local = StyleSheet.create({
  detail: { fontSize: 13, marginTop: 2 },
  library: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#C49A3C', paddingVertical: 4 },
  libraryHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  libraryName: { fontSize: 17 },
  chevron: { fontSize: 18, marginHorizontal: 8 },
  dropdown: { paddingStart: 12, paddingBottom: 8 },
  option: { paddingVertical: 6 },
  check: { paddingVertical: 4, paddingStart: 20 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap' },
  grow: { flex: 1 },
  link: { paddingVertical: 8, marginEnd: 18 },
  linkText: { fontSize: 15, textDecorationLine: 'underline' },
});

export default LibrariesSettings;
