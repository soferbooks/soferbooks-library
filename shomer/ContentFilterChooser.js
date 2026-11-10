// First launch: a full-screen chooser for the content filter. Shown while no preset has been
// chosen (the setting is null); nothing is picked for the reader silently.
import React, { useContext } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { GlobalStateContext, getTheme } from '../StateManager';
import strings from '../LocalizedStrings';
import styles from '../Styles';
import { CHOICES, configForPreset } from './presets';
import { PresetButton, presetDetail, useSetContentFilter } from './ContentFilterSettings';

const ContentFilterChooser = () => {
  const { themeStr, interfaceLanguage } = useContext(GlobalStateContext);
  const theme = getTheme(themeStr);
  const setContentFilter = useSetContentFilter();
  const langStyle = interfaceLanguage === 'hebrew' ? styles.heInt : styles.enInt;
  return (
    <View style={[StyleSheet.absoluteFill, theme.mainTextPanel, local.root]} testID="content-filter-chooser">
      <ScrollView contentContainerStyle={local.content}>
        <Text style={[langStyle, theme.text, local.title]}>{strings.filter.chooser_title}</Text>
        <Text style={[langStyle, theme.secondaryText, local.message]}>{strings.filter.chooser_message}</Text>
        {CHOICES.map(p => (
          <PresetButton key={p.id} preset={p} selected={false} theme={theme} langStyle={langStyle}
            detail={presetDetail(p)} onPress={() => setContentFilter(configForPreset(p.id))} />
        ))}
      </ScrollView>
    </View>
  );
};

const local = StyleSheet.create({
  root: { zIndex: 1000, elevation: 1000 },
  content: { padding: 24, paddingTop: 48 },
  title: { fontSize: 22, marginBottom: 12 },
  message: { fontSize: 15, marginBottom: 20 },
});

export default ContentFilterChooser;
