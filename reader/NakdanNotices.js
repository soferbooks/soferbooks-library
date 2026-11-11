'use strict';

/**
 * What the reader shows about nikud by computer (reader/nakdan.js), as the owner's extension does:
 * - NakdanText: a Hebrew text with Dicta's nikud when it has none (the commentary under each passage).
 * - NakdanAskCard: on a text without nikud, a card asking (Add nikud / Always / Not now / Never).
 * - NakdanCredit: "Nikud added by computer (Dicta)" while its nikud shows ("Adding nikud…" while
 *   Dicta is asked); a tap opens dicta.org.il.
 * - NakdanSettings: the two settings ("Always add nikud", "Ask on texts without nikud").
 */

import React, { useContext } from 'react';
import PropTypes from 'prop-types';
import { Linking, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { GlobalStateContext, getTheme } from '../StateManager';
import strings from '../LocalizedStrings';
import styles from '../Styles';
import { DICTA_SITE, useNakdan, useNakdanBusy } from './nakdan';
import { notNowNakdan, setNakdanForBook, setNakdanSettings, useNakdanPrefs } from './nakdanPrefs';

export const NakdanText = ({ text, on, style }) => {
  const vowelled = useNakdan(text, on);
  return <Text style={style}>{vowelled || text}</Text>;
};
NakdanText.propTypes = { text: PropTypes.string, on: PropTypes.bool, style: PropTypes.any };

const openDicta = () => { Linking.openURL(DICTA_SITE).catch(() => {}); };

export const NakdanCredit = ({ theme, queue }) => {
  const busy = useNakdanBusy(queue);
  return (
    <TouchableOpacity
      testID="nakdan-credit"
      accessibilityRole="link"
      onPress={openDicta}
      style={[local.credit, theme && theme.mainTextPanel, theme && theme.lighterGreyBorder]}
    >
      <Text style={[local.creditText, theme && theme.tertiaryText]}>
        {busy ? strings.reader.nakdan_working : strings.reader.nakdan_credit}
      </Text>
    </TouchableOpacity>
  );
};
NakdanCredit.propTypes = { theme: PropTypes.object, queue: PropTypes.object };

export const NakdanAskCard = ({ book, theme, interfaceLanguage }) => {
  const isHeb = interfaceLanguage === 'hebrew';
  const langStyle = isHeb ? styles.heInt : styles.enInt;
  const align = { textAlign: isHeb ? 'right' : 'left' };
  const button = (label, onPress, primary, testID) => (
    <TouchableOpacity testID={testID} onPress={onPress} style={[local.button, primary ? local.primary : null]}>
      <Text style={[langStyle, local.buttonText, primary ? local.primaryText : theme && theme.secondaryText]}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <View testID="nakdan-ask" accessibilityRole="alert" style={[local.card, theme && theme.mainTextPanel, theme && theme.lighterGreyBorder]}>
      <Text style={[langStyle, local.title, align, theme && theme.text]}>{strings.reader.nakdan_ask_title}</Text>
      <Text style={[langStyle, local.body, align, theme && theme.secondaryText]}>{strings.reader.nakdan_ask_text}</Text>
      <View style={[local.buttons, { flexDirection: isHeb ? 'row-reverse' : 'row' }]}>
        {button(strings.reader.nakdan_add, () => setNakdanForBook(book, true), true, 'nakdan-add')}
        {button(strings.reader.nakdan_always, () => setNakdanSettings({ always: true }), false, 'nakdan-always')}
        {button(strings.reader.nakdan_not_now, () => notNowNakdan(book), false, 'nakdan-not-now')}
      </View>
      <View style={[local.footer, { flexDirection: isHeb ? 'row-reverse' : 'row' }]}>
        <TouchableOpacity testID="nakdan-never" onPress={() => setNakdanSettings({ neverAsk: true })}>
          <Text style={[langStyle, local.never, theme && theme.tertiaryText]}>{strings.reader.nakdan_never_ask}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="link" onPress={openDicta}>
          <Text style={[local.creditText, theme && theme.tertiaryText]}>Dicta</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
NakdanAskCard.propTypes = { book: PropTypes.string, theme: PropTypes.object, interfaceLanguage: PropTypes.string };

export const NakdanSettings = ({ langStyle }) => {
  const { themeStr } = useContext(GlobalStateContext);
  const theme = getTheme(themeStr);
  const prefs = useNakdanPrefs();
  const row = (label, detail, value, onChange, testID) => (
    <View style={local.row}>
      <View style={local.rowText}>
        <Text style={[langStyle, theme.text]}>{label}</Text>
        {detail ? <Text style={[langStyle, theme.secondaryText, local.detail]}>{detail}</Text> : null}
      </View>
      <Switch testID={testID} value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
  return (
    <View style={styles.settingsSection} testID="nakdan-settings">
      <Text style={[langStyle, styles.settingsSectionHeader, theme.tertiaryText]}>{strings.settings.nakdan_header}</Text>
      {row(strings.settings.nakdan_always, strings.settings.nakdan_always_detail, !!prefs.settings.always,
        on => setNakdanSettings({ always: on }), 'nakdan-always-switch')}
      {row(strings.settings.nakdan_ask, null, !prefs.settings.neverAsk,
        on => setNakdanSettings({ neverAsk: !on }), 'nakdan-ask-switch')}
      <TouchableOpacity accessibilityRole="link" onPress={openDicta}>
        <Text style={[langStyle, theme.tertiaryText, local.detail]}>{strings.settings.nakdan_credit}</Text>
      </TouchableOpacity>
    </View>
  );
};
NakdanSettings.propTypes = { langStyle: PropTypes.any };

const local = StyleSheet.create({
  credit: {
    position: 'absolute', left: 8, bottom: 8, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, opacity: 0.92,
  },
  creditText: { fontSize: 11 },
  card: {
    position: 'absolute', left: 16, right: 16, bottom: 20, padding: 14, borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth, elevation: 6,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  title: { fontSize: 16, fontWeight: 'bold' },
  body: { fontSize: 14, marginTop: 4, marginBottom: 10 },
  buttons: { flexWrap: 'wrap' },
  button: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6, marginEnd: 6, marginBottom: 4 },
  primary: { backgroundColor: '#1F3366' },
  primaryText: { color: '#fff' },
  buttonText: { fontSize: 14 },
  footer: { justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  never: { fontSize: 12, textDecorationLine: 'underline' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  rowText: { flex: 1, paddingRight: 8 },
  detail: { fontSize: 13, marginTop: 2 },
});
