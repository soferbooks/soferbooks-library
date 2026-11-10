// Settings: the content filter (choose a preset, then switch single groups) and the list of
// library sources. Deliberately plain; styling is left to the app's theme work.
import React, { useContext } from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import { GlobalStateContext, DispatchContext, STATE_ACTIONS, getTheme } from '../StateManager';
import strings from '../LocalizedStrings';
import styles from '../Styles';
import { CHOICES, GROUPS, configForPreset, toggleGroup } from './presets';
import { SOURCES } from '../sources';

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

// What each preset adds on top of the one before it ("Off": nothing)
export const presetDetail = preset => (preset.id === 'off' ? strings.filter.off_detail
  : GROUPS.filter(g => g.level === preset.level).map(groupShort).join(', '));

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
          onPress={() => setContentFilter(configForPreset(p.id))} />
      ))}
      {preset === 'custom' ? <Text style={[langStyle, theme.text, local.presetName]}>{'◉ '}{strings.filter.custom}</Text> : null}
      <Text style={[langStyle, styles.settingsSectionHeader, theme.tertiaryText, local.groupsHeader]}>{strings.filter.groups_header}</Text>
      {GROUPS.map(g => (
        <View key={g.id} style={local.groupRow}>
          <View style={local.groupText}>
            <Text style={[langStyle, theme.text]}>{groupName(g)}</Text>
            <Text style={[langStyle, theme.tertiaryText, local.detail]}>{g.examples}</Text>
          </View>
          <Switch
            accessibilityLabel={groupName(g)}
            value={!!(contentFilter && contentFilter.groups && contentFilter.groups[g.id])}
            onValueChange={hidden => setContentFilter(toggleGroup(contentFilter, g.id, hidden))}
          />
        </View>
      ))}
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
      {SOURCES.map(s => (
        <View key={s.id} style={local.groupRow}>
          <View style={local.groupText}>
            <Text style={[langStyle, theme.text]}>
              {interfaceLanguage === 'hebrew' ? s.heName : s.name}
              {s.available ? '' : `  (${strings.library_sources.coming_soon})`}
            </Text>
            {s.enabled ? <Text style={[langStyle, theme.secondaryText, local.detail]}>{strings.library_sources.always_on}</Text> : null}
          </View>
          {/* only Sefaria can be downloaded today and it is always on: shown as on (not greyed
              out as disabled); switching it off does nothing */}
          {s.enabled
            ? <Switch value onValueChange={() => {}} accessibilityLabel={s.name} accessibilityHint={strings.library_sources.always_on} />
            : <Switch value={false} disabled accessibilityLabel={s.name} />}
        </View>
      ))}
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
});

export default ContentFilterSettings;
