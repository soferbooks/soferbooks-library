// Settings: the content filter (choose a preset, then switch single groups) and the list of
// library sources. Deliberately plain; styling is left to the app's theme work.
import React, { useContext, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { GlobalStateContext, DispatchContext, STATE_ACTIONS, getTheme } from '../StateManager';
import strings, { countString, isolate } from '../LocalizedStrings';
import styles from '../Styles';
import { CHOICES, GROUPS, configForPreset, toggleGroup } from './presets';
import { SOURCES } from '../sources';
import * as extras from '../extras';
import { ExtraDownloadStatus } from '../ExtraDownloadProgress';
// What each group really hides in the library (tools/library-export/shomer_group_examples.js):
// groups with nothing in the library are not listed
import GROUP_EXAMPLES from './groupExamples.json';

export const useSetContentFilter = () => {
  const dispatch = useContext(DispatchContext);
  return config => dispatch({ type: STATE_ACTIONS.setContentFilter, value: config });
};

export const PresetButton = ({ preset, selected, onPress, theme, langStyle, detail }) => (
  <TouchableOpacity
    accessibilityRole="radio"
    accessibilityState={{ selected }}
    onPress={onPress}
    style={[local.preset, selected ? local.presetSelected : null]}
  >
    <Text style={[langStyle, theme.text, local.presetName]}>{selected ? '◉ ' : '○ '}{presetName(preset)}</Text>
    {detail ? <Text style={[langStyle, theme.tertiaryText, local.detail]}>{detail}</Text> : null}
  </TouchableOpacity>
);

// Names in the interface language (i18n/*.json), falling back to the English in presets.js.
// Spelled out (not built from the id) so the i18n tests can see every id in use.
const PRESET_NAMES = {
  off: 'filter.preset_off', centrist_mo: 'filter.preset_centrist_mo', rwmo: 'filter.preset_rwmo',
  yeshivish: 'filter.preset_yeshivish', strict_charedi: 'filter.preset_strict_charedi',
};
const GROUP_NAMES = {
  reform: ['filter.group_reform', 'filter.group_reform_short'],
  reconstructionist: ['filter.group_reconstructionist', 'filter.group_reconstructionist_short'],
  conservative: ['filter.group_conservative', 'filter.group_conservative_short'],
  biblical_criticism: ['filter.group_biblical_criticism', 'filter.group_biblical_criticism_short'],
  christian_translations: ['filter.group_christian_translations', 'filter.group_christian_translations_short'],
  sefarim_chitzoniim: ['filter.group_sefarim_chitzoniim', 'filter.group_sefarim_chitzoniim_short'],
  polemics: ['filter.group_polemics', 'filter.group_polemics_short'],
  non_orthodox_translations: ['filter.group_non_orthodox_translations', 'filter.group_non_orthodox_translations_short'],
  open_orthodox: ['filter.group_open_orthodox', 'filter.group_open_orthodox_short'],
  haskalah_secular: ['filter.group_haskalah_secular', 'filter.group_haskalah_secular_short'],
  feminist_translations: ['filter.group_feminist_translations', 'filter.group_feminist_translations_short'],
  jps_1917: ['filter.group_jps_1917', 'filter.group_jps_1917_short'],
  academic_orthodox: ['filter.group_academic_orthodox', 'filter.group_academic_orthodox_short'],
  community_sheets: ['filter.group_community_sheets', 'filter.group_community_sheets_short'],
  women_authors: ['filter.group_women_authors', 'filter.group_women_authors_short'],
  religious_zionist_thought: ['filter.group_religious_zionist_thought', 'filter.group_religious_zionist_thought_short'],
};
const localized = (id, fallback) => (id && strings.getString(id)) || fallback;
export const presetName = p => localized(PRESET_NAMES[p.id], p.name);
export const groupName = g => localized(GROUP_NAMES[g.id]?.[0], g.name);
export const groupShort = g => localized(GROUP_NAMES[g.id]?.[1], g.short);

/** The groups that hide something in the library, and what ("A, B, C and 4 more") */
export const LISTED_GROUPS = GROUPS.filter(g => GROUP_EXAMPLES.groups[g.id]);
export const groupExamples = (g, hebrew) => {
  const found = GROUP_EXAMPLES.groups[g.id];
  if (!found) { return ''; }
  // (each example is [English] or [English, Hebrew])
  const shown = found.examples.slice(0, 4).map(e => (hebrew && e[1]) || e[0]);
  const more = found.count - shown.length;
  return shown.join(', ') + (more > 0 ? ' ' + countString(strings.filter.more_count, strings.filter.more_count_one, more) : '');
};

// What each preset adds on top of the one before it ("Off": nothing)
export const presetDetail = preset => (preset.id === 'off' ? strings.filter.off_detail
  : LISTED_GROUPS.filter(g => g.level === preset.level).map(groupShort).join(', '));

export const ContentFilterSettings = ({ langStyle }) => {
  const { themeStr, contentFilter } = useContext(GlobalStateContext);
  const theme = getTheme(themeStr);
  const setContentFilter = useSetContentFilter();
  const preset = contentFilter ? contentFilter.preset : null;
  return (
    <View style={styles.settingsSection} testID="content-filter-settings">
      <Text style={[langStyle, styles.settingsSectionHeader, theme.tertiaryText]}>{strings.filter.section_header}</Text>
      <Text style={[langStyle, theme.secondaryText, local.detail]}>{strings.filter.description}</Text>
      {CHOICES.map(p => (
        <PresetButton key={p.id} preset={p} selected={preset === p.id} theme={theme} langStyle={langStyle}
          detail={presetDetail(p)} onPress={() => setContentFilter(configForPreset(p.id))} />
      ))}
      {preset === 'custom' ? <Text style={[langStyle, theme.text, local.presetName]}>{'◉ '}{strings.filter.custom}</Text> : null}
      <Text style={[langStyle, styles.settingsSectionHeader, theme.tertiaryText, local.groupsHeader]}>{strings.filter.groups_header}</Text>
      <Text style={[langStyle, theme.secondaryText, local.detail]}>{strings.filter.groups_hint}</Text>
      {/* On = shown, off = hidden (the switch says whether you see the group) */}
      {LISTED_GROUPS.map(g => {
        const hidden = !!(contentFilter && contentFilter.active !== false && contentFilter.groups && contentFilter.groups[g.id]);
        return (
          <View key={g.id} style={local.groupRow}>
            <View style={local.groupText}>
              <Text style={[langStyle, theme.text]}>{groupName(g)}</Text>
              <Text style={[langStyle, theme.tertiaryText, local.detail]}>{groupExamples(g, strings.getLanguage() === 'he')}</Text>
            </View>
            <Switch
              accessibilityLabel={groupName(g)}
              accessibilityHint={hidden ? strings.filter.group_hidden : strings.filter.group_shown}
              value={!hidden}
              onValueChange={shown => setContentFilter(toggleGroup(contentFilter, g.id, !shown))}
            />
          </View>
        );
      })}
    </View>
  );
};

/** An extra source (Otzaria ...): on/off, how many of its books are on the phone, updates. */
export const ExtraSourceRow = ({ source, langStyle, theme, interfaceLanguage }) => {
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => extras.subscribe(() => setTick(t => t + 1)), []);
  const on = extras.isEnabled(source.id);
  const name = interfaceLanguage === 'hebrew' ? source.heName : source.name;
  const downloaded = extras.downloadedBooks(source.id).length;   // (not the notes books made with them)
  const underWay = extras.downloadsUnderWay().filter(t => (extras.extraBook(t) || {}).source === source.id);
  const bookName = t => {
    const b = extras.extraBook(t) || {};
    return (interfaceLanguage === 'hebrew' ? b.heTitle : b.title) || t;
  };
  const run = async (job) => {
    setBusy(true);
    try { await job(); } catch (e) {
      if (!(e instanceof extras.DownloadCancelledError)) {      // (Cancel is not an error)
        Alert.alert(strings.download.download_error, strings.extras.download_failed_message, [{text: strings.common.ok}]);
      }
    } finally { setBusy(false); }
  };
  const toggle = value => {
    if (value) { run(() => extras.setSourceEnabled(source.id, true)); return; }
    if (!downloaded) { run(() => extras.setSourceEnabled(source.id, false)); return; }
    Alert.alert(name, countString(strings.extras.turn_off_message, strings.extras.turn_off_message_one, downloaded), [
      {text: strings.common.cancel, style: 'cancel'},
      {text: strings.common.yes, onPress: () => run(() => extras.setSourceEnabled(source.id, false))},
    ]);
  };
  const checkUpdates = () => run(async () => {
    const changed = await extras.checkUpdates(source.id);
    if (!changed.length) {
      Alert.alert(name, strings.extras.up_to_date, [{text: strings.common.ok}]);
      return;
    }
    Alert.alert(name, countString(strings.extras.updates_message, strings.extras.updates_message_one, changed.length), [
      {text: strings.common.not_now, style: 'cancel'},
      {text: strings.download.download, onPress: () => run(async () => {
        for (const title of changed) { await extras.downloadBook(title); }
      })},
    ]);
  });
  return (
    <View>
      <View style={local.groupRow}>
        <View style={local.groupText}>
          <Text style={[langStyle, theme.text]}>{name}</Text>
          <Text style={[langStyle, theme.secondaryText, local.detail]}>{strings.extras.source_detail}</Text>
          {on ? <Text style={[langStyle, theme.secondaryText, local.detail]}>
            {countString(strings.extras.downloaded_count, strings.extras.downloaded_count_one, downloaded)}
          </Text> : null}
        </View>
        {busy && !underWay.length ? <ActivityIndicator /> : null}
        <Switch value={on} disabled={busy} onValueChange={toggle} accessibilityLabel={name} />
      </View>
      {/* (the books of this source downloading now: how far, and Cancel) */}
      {underWay.map(t => (
        <View key={t}>
          <Text style={[langStyle, theme.secondaryText, local.detail]}>
            {strings.formatString(strings.extras.downloading, {title: isolate(bookName(t))})}
          </Text>
          <ExtraDownloadStatus title={t} theme={theme} langStyle={langStyle} />
        </View>
      ))}
      {on && downloaded ? (
        <TouchableOpacity onPress={checkUpdates} disabled={busy} accessibilityRole="button" style={local.link}>
          <Text style={[langStyle, theme.text, local.linkText]}>{strings.download.check_for_updates}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

export const LibrarySourcesSettings = ({ langStyle }) => {
  const { themeStr, interfaceLanguage } = useContext(GlobalStateContext);
  const theme = getTheme(themeStr);
  return (
    <View style={styles.settingsSection} testID="library-sources-settings">
      <Text style={[langStyle, styles.settingsSectionHeader, theme.tertiaryText]}>{strings.library_sources.header}</Text>
      <Text style={[langStyle, theme.secondaryText, local.detail]}>{strings.library_sources.description}</Text>
      {SOURCES.map(s => (s.extra
        ? <ExtraSourceRow key={s.id} source={s} langStyle={langStyle} theme={theme} interfaceLanguage={interfaceLanguage} />
        : (
        <View key={s.id} style={local.groupRow}>
          <View style={local.groupText}>
            <Text style={[langStyle, theme.text]}>
              {interfaceLanguage === 'hebrew' ? s.heName : s.name}
              {s.available ? '' : `  (${strings.library_sources.coming_soon})`}
            </Text>
            {s.enabled ? <Text style={[langStyle, theme.secondaryText, local.detail]}>{strings.library_sources.always_on}</Text> : null}
          </View>
          {/* Sefaria is always on: shown as on (not greyed out as disabled); switching it off
              does nothing */}
          {s.enabled
            ? <Switch value onValueChange={() => {}} accessibilityLabel={s.name} accessibilityHint={strings.library_sources.always_on} />
            : <Switch value={false} disabled accessibilityLabel={s.name} />}
        </View>
      )))}
    </View>
  );
};

const local = StyleSheet.create({
  preset: { paddingVertical: 8, paddingHorizontal: 4 },
  presetSelected: { opacity: 1 },
  presetName: { fontSize: 16 },
  detail: { fontSize: 13, marginTop: 2 },
  groupsHeader: { marginTop: 16 },
  groupRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  groupText: { flex: 1, paddingRight: 8 },
  link: { paddingVertical: 4 },
  linkText: { fontSize: 14, textDecorationLine: 'underline' },
});

export default ContentFilterSettings;
