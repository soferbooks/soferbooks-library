// Settings: the content filter (choose a preset, then switch single groups) and the list of
// library sources. Deliberately plain; styling is left to the app's theme work.
import React, { useContext } from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import { GlobalStateContext, DispatchContext, STATE_ACTIONS, getTheme } from '../StateManager';
import strings from '../LocalizedStrings';
import styles from '../Styles';
import { PRESETS, GROUPS, configForPreset, toggleGroup } from './presets';
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
    <Text style={[langStyle, theme.text, local.presetName]}>{selected ? '◉ ' : '○ '}{preset.name}</Text>
    {detail ? <Text style={[langStyle, theme.tertiaryText, local.detail]}>{detail}</Text> : null}
  </TouchableOpacity>
);

// What each preset adds on top of the one before it
export const presetDetail = preset => GROUPS.filter(g => g.level === preset.level).map(g => g.short).join(', ');

export const ContentFilterSettings = ({ langStyle }) => {
  const { themeStr, contentFilter } = useContext(GlobalStateContext);
  const theme = getTheme(themeStr);
  const setContentFilter = useSetContentFilter();
  const preset = contentFilter ? contentFilter.preset : null;
  return (
    <View style={styles.settingsSection} testID="content-filter-settings">
      <Text style={[langStyle, styles.settingsSectionHeader, theme.tertiaryText]}>{strings.filter.section_header}</Text>
      <Text style={[langStyle, theme.secondaryText, local.detail]}>{strings.filter.description}</Text>
      {PRESETS.map(p => (
        <PresetButton key={p.id} preset={p} selected={preset === p.id} theme={theme} langStyle={langStyle}
          onPress={() => setContentFilter(configForPreset(p.id))} />
      ))}
      {preset === 'custom' ? <Text style={[langStyle, theme.text, local.presetName]}>{'◉ '}{strings.filter.custom}</Text> : null}
      <Text style={[langStyle, styles.settingsSectionHeader, theme.tertiaryText, local.groupsHeader]}>{strings.filter.groups_header}</Text>
      {GROUPS.map(g => (
        <View key={g.id} style={local.groupRow}>
          <View style={local.groupText}>
            <Text style={[langStyle, theme.text]}>{g.name}</Text>
            <Text style={[langStyle, theme.tertiaryText, local.detail]}>{g.examples}</Text>
          </View>
          <Switch
            accessibilityLabel={g.name}
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
          <Text style={[langStyle, theme.text, local.groupText]}>
            {interfaceLanguage === 'hebrew' ? s.heName : s.name}
            {s.available ? '' : `  (${strings.library_sources.coming_soon})`}
          </Text>
          {/* only Sefaria can be downloaded today; it is always on */}
          <Switch value={s.enabled} disabled accessibilityLabel={s.name} />
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
